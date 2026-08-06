import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import type { AppSettings, AdSpendRow, AppointmentRow, AccountSummary, CallRow } from '@/lib/types';
import { loadSettings, loadSettingsAsync, isConfigured } from '@/lib/config';
import { fetchGoogleSheetData, fetchAirtableData, fetchCallCenterData, buildAccountSummaries } from '@/lib/dataService';
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
  unmatchedAppointments: AppointmentRow[];
  airtableFields: string[];
  callData: CallRow[];
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
  unmatchedAppointments: [],
  airtableFields: [],
  callData: [],
  loading: false,
  error: null,
  lastUpdated: null,
  configured: false,
  settingsLoaded: false,
  sources: initialStatuses(loadSettings()),
  refresh: async () => {},
};

const DataContext = createContext<DataContextType>(defaultDataContext);

const FETCHERS: SourceFetchers = {
  fetchWindsor: fetchGoogleSheetData,
  fetchAirtable: fetchAirtableData,
  fetchCallCenter: fetchCallCenterData,
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
    typeof (v as AppSettings).googleSheetUrl === 'string' &&
    typeof (v as AppSettings).airtableBaseId === 'string'
  );
}

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [data, setData] = useState<SourceData>(EMPTY_SOURCE_DATA);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [unmatchedAppointments, setUnmatchedAppointments] = useState<AppointmentRow[]>([]);
  const [sources, setSources] = useState<Record<SourceKey, SourceStatus>>(() => initialStatuses(loadSettings()));
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
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
      const { data: nextData, statuses } = await refreshSources(s, FETCHERS, sourcesRef.current, dataRef.current);

      // A newer refresh started while this one was in the air. Its answer is the current
      // one; ours is stale by definition, so we drop it rather than overwrite.
      if (seq !== requestSeq.current) return;

      setData(nextData);
      setSources(statuses);

      // The SAME predicate the KPI tiles use (Dashboard.tsx:703-705), passed down so the
      // per-account rows cannot disagree with the tiles above them. That disagreement is
      // the defect: @bird measured tiles reading "—" beside a table reading $0.00 on one
      // screen, because the honest state existed only at the render layer.
      const result = buildAccountSummaries(nextData.adSpend, nextData.appointments, s, nextData.callData, {
        spend: hasUsableData(statuses.windsor.state),
        appts: hasUsableData(statuses.airtable.state),
        calls: hasUsableData(statuses.callCenter.state),
      });
      setAccounts(result.accounts);
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

  useEffect(() => {
    let cancelled = false;
    loadSettingsAsync().then(dbSettings => {
      if (cancelled) return;
      setSettings(dbSettings);
      setSources(initialStatuses(dbSettings));
      setSettingsLoaded(true);
      refresh(dbSettings);
    }).catch(() => {
      if (cancelled) return;
      // Even a failed settings load is an answer: stop claiming we are still looking.
      setSettingsLoaded(true);
    });
    return () => { cancelled = true; };
  }, [refresh]);

  // Legacy single error string, derived so existing ErrorBanner call sites keep working.
  // It names WHICH source failed, because "Airtable error: 401" on its own does not tell
  // a user that their spend numbers are still fine.
  const failed = SOURCE_KEYS.map(k => sources[k]).filter(s => s.error && needsAttention(s));
  const error = failed.length > 0 ? failed.map(s => `${s.label}: ${s.error}`).join(' · ') : null;

  return (
    <DataContext.Provider value={{
      settings,
      setSettings,
      adSpend: data.adSpend,
      appointments: data.appointments,
      accounts,
      unmatchedAppointments,
      airtableFields: data.airtableFields,
      callData: data.callData,
      loading,
      error,
      lastUpdated,
      configured,
      settingsLoaded,
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
