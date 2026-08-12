import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import type { AppSettings, AdSpendRow, AppointmentRow, AccountSummary } from '@/lib/types';
import { loadSettings, loadSettingsWithSource, isConfigured, type SettingsOrigin } from '@/lib/config';
import { checkMetaCompleteness, NOT_CHECKED, fetchMetaAdSpend, ALL_DATES, type CompletenessReport, type SpendWindow } from '@/lib/metaAdSpend';
import { judgeRefresh, snapshotOf, type RefreshVerdict, type RefreshSnapshot } from '@/lib/refreshValidation';
import { fetchAirtableData, buildAccountSummaries, detectExclusionState, type ExclusionReport } from '@/lib/dataService';
import { emptyAccountRegistry, fetchAccountRegistry, type AccountRegistry } from '@/lib/accountRegistry';
import { buildHonestNumbersReport, type HonestNumbersReport } from '@/lib/honestNumbers';
import { computeSetterPayouts } from '@/lib/payout';
import {
  refreshSources,
  initialStatuses,
  isSourceConfigured,
  needsAttention,
  hasUsableData,
  EMPTY_SOURCE_DATA,
  SOURCE_KEYS,
  type SourceData,
  type SourceFetchers,
  type SourceKey,
  type SourceStatus,
} from '@/lib/sourceStatus';

interface DataContextType {
  settings: AppSettings;
  setSettings: (s: AppSettings) => void;
  adSpend: AdSpendRow[];
  appointments: AppointmentRow[];
  accounts: AccountSummary[];
  /**
   * The curated ad-account mapping (`ad_accounts`), keyed by normalised Meta account name.
   * `known: false` means the read has not happened or failed — which is NOT the same as
   * "there are no mapped accounts", and callers must not treat it as such.
   */
  accountRegistry: AccountRegistry;
  unmatchedAppointments: AppointmentRow[];
  airtableFields: string[];
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  configured: boolean;
  /**
   * Whether the settings have finished loading from the database yet. Until this is true
   * "configured" is NOT KNOWN — it is not false. Rendering "Configure your data sources"
   * before this flips is a definite statement about the user's setup made before we have
   * looked, and on a cold browser it is usually wrong.
   */
  settingsLoaded: boolean;
  /**
   * WHERE the settings on screen came from. `configured: false` is only a statement about
   * the USER's setup when this is 'local-no-row'; in the two unverified origins we never
   * got an answer, and saying "configure your data sources" there blames the wrong party.
   */
  settingsOrigin: SettingsOrigin;
  /** Underlying error text for 'local-unreachable'. Null otherwise — never invented. */
  settingsDetail: string | null;
  /**
   * Is the ad spend feed COMPLETE — did we receive every row the database holds for the
   * window on screen?
   * ⚠️ 'unverifiable' is a real state and NOT a synonym for healthy — see metaAdSpend.
   */
  completeness: CompletenessReport;
  /** The date window the ad-spend query is currently filtered by, in SQL. */
  spendWindow: SpendWindow;
  /**
   * Narrow (or widen) the ad-spend query's date range. Triggers a refetch, because the
   * whole point is that the narrowing happens in SQL rather than over rows already in the
   * browser. Passing `ALL_DATES` asks for everything and gets everything, paged.
   */
  setSpendWindow: (w: SpendWindow) => void;
  /**
   * ③ Was the last refresh accepted? A REJECTED refresh leaves the previous data on screen
   * — `accept: false` means the numbers below are the LAST GOOD ones, not the newest.
   */
  refreshVerdict: RefreshVerdict | null;
  /** A — appointments whose client is an unresolved Airtable linked-record id. */
  unresolvedClients: number;
  /**
   * Is the campaign exclusion list actually filtering anything?
   *
   * @andrew accepted the loss of the 32 excluded campaigns, so performanceSpend ===
   * totalSpend is now PERMANENT and every cost-per-lead is computed across campaigns
   * that were excluded FOR burning spend without leads. The numbers are inflated and
   * silent. This is what makes that visible; @dash renders it.
   *
   * DERIVED, not stored — it is a pure function of the feed and the settings, so it
   * cannot drift out of sync with the numbers it describes.
   */
  exclusions: ExclusionReport;
  /**
   * @raccoon's COMPOSED report — both honest-numbers detectors turned into ordered,
   * user-facing sentences. This is what @dash renders as the banner; `exclusions` above
   * is the EVIDENCE behind the first of those sentences (which accounts, how much money),
   * which his composer cannot carry because it takes campaign ids rather than spend rows.
   *
   * Report for the message, evidence for the drill-down. Not two detectors.
   */
  honestNumbers: HonestNumbersReport;
  /** Per-source state. THIS is the honest one; the flat fields above are kept for existing callers. */
  sources: Record<SourceKey, SourceStatus>;
  refresh: (overrideSettings?: AppSettings) => Promise<void>;
}

const defaultDataContext: DataContextType = {
  settings: loadSettings(),
  setSettings: () => {},
  adSpend: [],
  appointments: [],
  accounts: [],
  accountRegistry: emptyAccountRegistry(),
  unmatchedAppointments: [],
  airtableFields: [],
  loading: false,
  error: null,
  lastUpdated: null,
  configured: false,
  settingsLoaded: false,
  // Not 'local-no-row': before we have looked, "the database had nothing" is a claim we
  // have not earned. The pre-load render is gated on settingsLoaded anyway.
  settingsOrigin: 'local-not-configured',
  settingsDetail: null,
  // Not 'complete': before anything has been probed, claiming the feed is whole is a
  // definite statement made before we have looked.
  completeness: NOT_CHECKED,
  spendWindow: ALL_DATES,
  setSpendWindow: () => {},
  refreshVerdict: null,
  unresolvedClients: 0,
  // Derived from the SAME settings the rest of this default uses, rather than hand-written
  // as 'active'. A hand-written default would say "exclusions are working" before anything
  // has loaded — a definite claim made before we have looked, which is the defect
  // `settingsLoaded` exists to prevent one line above.
  exclusions: detectExclusionState([], loadSettings()),
  honestNumbers: buildHonestNumbersReport({
    settings: loadSettings(),
    campaignIdsInData: [],
    fabricatedRateCount: 0,
    allRatesFabricated: false,
  }),
  sources: initialStatuses(loadSettings()),
  refresh: async () => {},
};

const DataContext = createContext<DataContextType>(defaultDataContext);

const FETCHERS: SourceFetchers = {
  fetchAdSpend: fetchMetaAdSpend,
  fetchAirtable: fetchAirtableData,
};

/**
 * `refresh` is passed straight to onClick handlers in places, and React hands a handler
 * its click event as the first argument. That event was being read as an override
 * settings object, which silently disabled the Retry button on the error banner — it
 * started no request and changed no state at all.
 *
 * Fixing the call sites is necessary and not sufficient: the next person to write
 * `onClick={refresh}` reintroduces it, and TypeScript cannot see it because
 * `() => void` accepts a function whose only parameter is optional. So the function
 * refuses anything that is not actually settings.
 */
export function isAppSettingsLike(v: unknown): v is AppSettings {
  return (
    typeof v === 'object' &&
    v !== null &&
    !('nativeEvent' in v) &&
    typeof (v as AppSettings).airtableBaseId === 'string'
  );
}

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [data, setData] = useState<SourceData>(EMPTY_SOURCE_DATA);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  /**
   * The curated `ad_accounts` mapping behind the summaries above. Exposed so a screen can
   * resolve an account it holds by NAME rather than re-fetching the table, and so the
   * default value can honestly say `known: false` before anything has been read.
   */
  const [accountRegistry, setAccountRegistry] = useState<AccountRegistry>(emptyAccountRegistry());
  const [unmatchedAppointments, setUnmatchedAppointments] = useState<AppointmentRow[]>([]);
  const [sources, setSources] = useState<Record<SourceKey, SourceStatus>>(() => initialStatuses(loadSettings()));
  const [settingsOrigin, setSettingsOrigin] = useState<SettingsOrigin>('local-not-configured');
  const [settingsDetail, setSettingsDetail] = useState<string | null>(null);
  const [completeness, setCompleteness] = useState<CompletenessReport>(NOT_CHECKED);
  const [refreshVerdict, setRefreshVerdict] = useState<RefreshVerdict | null>(null);
  /** The snapshot of the last ACCEPTED refresh. A ref: the gate must not re-run a render. */
  const lastGoodRef = useRef<RefreshSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  /**
   * ⭐ THE DATE WINDOW THE AD-SPEND QUERY IS FILTERED BY, IN SQL.
   *
   * Half the point of leaving the sheet: the CSV had to be downloaded whole and filtered in
   * the browser, because a CSV cannot answer a WHERE clause. `ad_insights` can, so a page
   * asking for one month sends `date >= .. AND date <= ..` and receives that month.
   *
   * ⚠️ `ALL_DATES` IS A REAL ANSWER, NOT A MISSING FILTER. The Dashboard's default range is
   * All Time and that genuinely means every row; the fetcher PAGES for it rather than
   * truncating. Narrowing is what the window buys, not correctness.
   *
   * A ref beside the state because `refresh` is created once and must read the CURRENT
   * window, and because the completeness probe must be handed the window that was actually
   * fetched rather than whatever the user selected while the request was in the air.
   */
  const [spendWindow, setSpendWindowState] = useState<SpendWindow>(ALL_DATES);
  const spendWindowRef = useRef<SpendWindow>(ALL_DATES);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // "Configured" is now per-source. At the app level it means: is there ANY source we can
  // load? A missing Airtable token must not make Windsor's spend data unreachable — that
  // is the production incident of 2026-08-05, where one empty field produced zero requests
  // to two sources that never needed it.
  const configured = SOURCE_KEYS.some(k => isSourceConfigured(k, settings));

  const settingsRef = useRef<AppSettings>(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  // Latest values for the refresh closure, which is created once.
  const sourcesRef = useRef(sources);
  useEffect(() => { sourcesRef.current = sources; }, [sources]);
  const dataRef = useRef(data);
  useEffect(() => { dataRef.current = data; }, [data]);

  // Refreshes are triggered from six places, including a debounced autosave that fires
  // while the user types. Without a sequence number the LAST RESPONSE TO ARRIVE wins, so a
  // slow earlier request can overwrite a newer one — Andrew's "repeated refreshes produce
  // consistent totals" fails on exactly that race.
  const requestSeq = useRef(0);
  const inFlight = useRef(0);

  const refresh = useCallback(async (overrideSettings?: AppSettings) => {
    const s = isAppSettingsLike(overrideSettings) ? overrideSettings : settingsRef.current;
    const fetchedWindow = spendWindowRef.current;
    const seq = ++requestSeq.current;
    inFlight.current += 1;
    setLoading(true);

    // Mark configured sources as in flight. The old code returned here without touching
    // any state when nothing was configured — no spinner, no error, no signal at all.
    setSources(prev => {
      const next = { ...prev };
      for (const key of SOURCE_KEYS) {
        next[key] = isSourceConfigured(key, s)
          ? { ...prev[key], state: 'loading', configured: true, missingSettings: [] }
          : { ...prev[key], state: 'not-configured', configured: false };
      }
      return next;
    });

    try {
      /**
       * ⭐ THE CURATED ACCOUNT MAPPING IS FETCHED ON THE DATA PATH, not bolted on afterwards,
       * because it decides the NAME, PROGRAM and MEDIA BUYER of every summary built below.
       * Resolving it after the fact would mean one render with Meta's raw names and one with
       * the client's, on every refresh.
       *
       * ⛔ It cannot fail the refresh. `fetchAccountRegistry` swallows its own errors and
       * returns `known: false`, which falls the whole app back to the legacy alias store —
       * stale names, but real ones. An ad_accounts outage must not blank the dashboard.
       */
      const [{ data: nextData, statuses }, registry] = await Promise.all([
        refreshSources(s, FETCHERS, sourcesRef.current, dataRef.current, new Date(), fetchedWindow),
        fetchAccountRegistry(),
      ]);

      // A newer refresh started while this one was in the air. Its answer is the current
      // one; ours is stale by definition, so we drop it rather than overwrite.
      if (seq !== requestSeq.current) return;

      /**
       * ③ THE VALIDATION GATE. Compare THIS refresh to the LAST ACCEPTED one before it is
       * allowed to replace anything.
       *
       * ⭐ THE COMPARISON IS THE WHOLE VALUE: 19,000 rows and $320,000 are plausible on
       * their own and only look wrong beside the 38,997 and $655,675 that were there a
       * minute ago. A single-refresh check cannot see spend halving.
       *
       * ⛔ AND IT NEVER BLANKS THE PAGE — on rejection we simply do not call setData, so the
       * previous numbers stay exactly where they are and the banner says they are stale.
       */
      const nextAccounts = buildAccountSummaries(nextData.adSpend, nextData.appointments, s, undefined, registry).accounts;
      const verdict = judgeRefresh(snapshotOf(nextData.adSpend, nextAccounts.length), lastGoodRef.current);
      setRefreshVerdict(verdict);
      if (!verdict.accept) {
        // Statuses still update: the sources answered, and hiding that would replace one
        // lie with another. Only the DATA is withheld.
        setSources(statuses);
        return;
      }
      lastGoodRef.current = verdict.next;

      setData(nextData);
      setSources(statuses);

      // The SAME predicate the KPI tiles use (Dashboard.tsx:703-705), passed down so the
      // per-account rows cannot disagree with the tiles above them. That disagreement is
      // the defect: @bird measured tiles reading "—" beside a table reading $0.00 on one
      // screen, because the honest state existed only at the render layer.
      const result = buildAccountSummaries(nextData.adSpend, nextData.appointments, s, {
        spend: hasUsableData(statuses.meta.state),
        appts: hasUsableData(statuses.airtable.state),
      }, registry);
      setAccounts(result.accounts);
      setAccountRegistry(registry);

      /**
       * ⛔ DELIBERATELY NOT AWAITED AND NOT IN THE Promise.all ABOVE. @fable: "it must NOT
       * block rendering. Incomplete data with an honest banner beats a blank page." Joining
       * this to the data path would let a completeness probe delay — or, via a rejection,
       * take down — the numbers it is only supposed to describe. checkMetaCompleteness
       * cannot throw, and the .catch is belt-and-braces on that promise.
       *
       * ⭐ WHAT IT NOW ASKS, and why it is stronger than the probe it replaces. The sheet
       * detector compared the derived tab's row count to the raw tab's — two copies of one
       * drifting artefact, which is why it stayed GREEN through the whole period the sheet
       * was losing July 2026. This reconciles the rows we are COMPUTING TOTALS FROM against
       * `count(*)` over the SAME window from the SAME authenticated source, so it catches
       * the failure the old one structurally could not: a paging loop that stops early, or
       * PostgREST's 1000-row default cap silently keeping 2% of the data.
       *
       * ⚠️ THE WINDOW MUST BE THE ONE THAT WAS FETCHED, not the one that is current. A
       * narrower window compared against a wider fetch reports phantom extra rows.
       */
      void checkMetaCompleteness(nextData.adSpend.length, fetchedWindow)
        .then(setCompleteness)
        .catch(() => {});
      setUnmatchedAppointments(result.unmatchedAppointments);

      // Only claim a successful update if at least one source actually delivered.
      if (SOURCE_KEYS.some(k => statuses[k].state === 'valid')) setLastUpdated(new Date());
    } finally {
      inFlight.current -= 1;
      // Do not clear the spinner while another refresh is still running — the old code
      // cleared it when the FIRST of several completed and reported "done" mid-flight.
      if (inFlight.current === 0) setLoading(false);
    }
  }, []);

  /**
   * ⚠️ THE REF IS SET BEFORE THE REFETCH, NOT BY AN EFFECT WATCHING THE STATE.
   *
   * `refresh` is created once and reads `spendWindowRef`, so a window written only to React
   * state would not be visible to the request this call is starting — the query would run
   * against the PREVIOUS range and the screen would show one range's numbers under another
   * range's label. Writing the ref first makes the refetch and the label agree.
   *
   * An identical window is not re-fetched: the picker re-emits its value on re-render, and
   * without this every render would start another 48,000-row query.
   */
  const setSpendWindow = useCallback((w: SpendWindow) => {
    const cur = spendWindowRef.current;
    if (cur.from === w.from && cur.to === w.to) return;
    spendWindowRef.current = w;
    setSpendWindowState(w);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    loadSettingsWithSource().then(({ settings: dbSettings, origin, detail }) => {
      if (cancelled) return;
      setSettings(dbSettings);
      setSettingsOrigin(origin);
      setSettingsDetail(detail);
      setSources(initialStatuses(dbSettings));
      setSettingsLoaded(true);
      refresh(dbSettings);
    }).catch(e => {
      if (cancelled) return;
      // Even a failed settings load is an answer: stop claiming we are still looking.
      // ⭐ AND IT MUST SAY WHICH ANSWER. This arm previously recorded nothing, so an
      // unreachable database was indistinguishable from an empty one all the way to the
      // screen — the conflation @bird measured.
      setSettingsOrigin('local-unreachable');
      setSettingsDetail(e instanceof Error ? e.message : String(e));
      setSettingsLoaded(true);
    });
    return () => { cancelled = true; };
  }, [refresh]);

  // Legacy single error string, derived so existing ErrorBanner call sites keep working.
  // It names WHICH source failed, because "Airtable error: 401" on its own does not tell
  // a user that their spend numbers are still fine.
  const failed = SOURCE_KEYS.map(k => sources[k]).filter(s => s.error && needsAttention(s));
  const error = failed.length > 0 ? failed.map(s => `${s.label}: ${s.error}`).join(' · ') : null;

  // Derived from the CURRENT feed and the CURRENT settings on every render, so it can
  // never describe a state the numbers have already moved past.
  const exclusions = detectExclusionState(data.adSpend, settings);

  // Composed on every render from the same live data, so the banner cannot describe a
  // state the numbers have already left.
  //
  // ⚠️ POPULATION DIFFERS FROM Agents.tsx ON TWO AXES, SO THE COUNT CANNOT BE SHOWN.
  //    here          ALL appointments — a global statement about the configuration
  //    Agents.tsx:48 leadValid === 'valid'          ← @raccoon named this one; I missed it
  //    Agents.tsx:50 within the SELECTED PAY PERIOD
  // The second axis is the worse one: the banner could name a setter with no valid
  // appointments in ANY period — someone who would never appear on the page the banner
  // describes, in any configuration. The period axis at least resolves when you change
  // the period.
  //
  // RESOLVED IN THE MESSAGE, NOT IN A QUALIFIER. I proposed the copy say "across all
  // data"; @raccoon's repair is better and it is what shipped — honestNumbers emits NO
  // COUNT and points at the Agents page instead. A label would have explained the
  // contradiction rather than removing it, leaving a reader with an authoritative-looking
  // number the page disagrees with. That is the banner-vs-row disagreement this branch
  // spent the night removing.
  //
  // `allRatesFabricated` is unaffected: with no rate configured it is true of every
  // NON-EMPTY population, so it cannot contradict the page — and with appointments absent
  // it is false, so it stays silent while Airtable is down instead of crying wolf.
  //
  // The count is still passed because the composer needs `> 0` to decide whether to speak
  // at all; it simply never reaches the copy.
  const payoutForWarnings = computeSetterPayouts(data.appointments, settings);
  const honestNumbers = buildHonestNumbersReport({
    settings,
    campaignIdsInData: data.adSpend.map(r => (r.campaignId || '').trim()),
    fabricatedRateCount: payoutForWarnings.rows.filter(r => r.rateSource === 'fallback').length,
    allRatesFabricated: payoutForWarnings.allRatesFabricated,
  });

  return (
    <DataContext.Provider value={{
      settings,
      setSettings,
      adSpend: data.adSpend,
      appointments: data.appointments,
      accounts,
      accountRegistry,
      unmatchedAppointments,
      airtableFields: data.airtableFields,
      loading,
      error,
      lastUpdated,
      configured,
      settingsOrigin,
      settingsDetail,
      completeness,
      spendWindow,
      setSpendWindow,
      refreshVerdict,
      unresolvedClients: data.unresolvedClients,
      settingsLoaded,
      exclusions,
      honestNumbers,
      sources,
      refresh,
    }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  return useContext(DataContext);
}

/** Convenience for components that care about one source. */
export function useSource(key: SourceKey): SourceStatus {
  return useContext(DataContext).sources[key];
}

// Re-exported so pages do not each import from two places.
export { isConfigured };
