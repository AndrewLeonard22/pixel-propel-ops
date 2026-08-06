import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useData } from '@/hooks/useData';
import { saveSettings, saveAccountMappings, loadAccountMappings, loadAccountMappingsAsync, settingsAreUnverified } from '@/lib/config';
import { fetchGoogleSheetData, fetchAirtableData, fetchCallCenterData, CLOSED_WON_DEFAULT } from '@/lib/dataService';
import { fetchSelectChoices, tickedButMissing } from '@/lib/airtableChoices';
import type { AppSettings, AccountMapping } from '@/lib/types';
import { checkSettingsWrite } from '@/lib/settingsWriteGuard';
import { DEFAULT_ADS_RAW_TAB } from '@/lib/sheetCompleteness';
import { CheckCircle, AlertCircle, Eye, EyeOff, Loader2, Search } from 'lucide-react';

function isJunkAccount(name: string): boolean {
  return /^[\d,\s]+(USD)?$/i.test(name.trim());
}

const STATUS_ORDER: Record<string, number> = { Active: 0, Paused: 1, Churned: 2 };

const REQUIRED_MAPPINGS = [
  'Client Name', 'Campaign Name', 'Campaign ID', 'Ad Set Name', 'Ad Set ID',
  'Ad Name', 'Ad ID', 'Appointment Date', 'Show Status', 'Lead Valid',
  'Closed Revenue', 'Amount Charged', 'Project Value',
];

/**
 * ⚠️ KEY-ORDER-STABLE SERIALISATION — @raccoon measured this edge on my own fix.
 *
 *     {a:"x", b:"y"} vs {b:"y", a:"x"}   same VALUES, different key ORDER
 *     JSON.stringify comparison ... NOT equal  ⇒ reads as an EDIT ⇒ schedules a write
 *
 * He rated it low severity and did not ask me to change it, and he is right that it is
 * stable today: spreads preserve insertion order and the shape is seeded from
 * DEFAULT_SETTINGS. ⭐ FIXED ANYWAY, because the failure mode IS @bird's P0 — an upsert
 * with no user edit — and re-opening a P0 through a serialisation detail is not a class of
 * risk worth carrying for three lines.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v as object).sort().map(k => [k, (v as Record<string, unknown>)[k]]))
      : v,
  );
}

export default function SettingsPage() {
  const { settings, setSettings, adSpend, accounts, callData, appointments, refresh, settingsOrigin, settingsLoaded } = useData();
  const [form, setForm] = useState<AppSettings>(settings);
  // 🔴 THE 22:18:48Z WIPE. `form` used to be seeded ONCE from `settings` and NEVER
  // re-synced when loadSettingsAsync resolved, so on a cold browser it held
  // DEFAULT_SETTINGS permanently — and the autosave below then wrote those defaults
  // over the real config, with no click. Both halves are fixed here:
  //   ① hydrate `form` from the loaded config on the FIRST identity change of
  //      `settings` (loadSettingsAsync always calls setSettings with a new object)
  //   ② hold the autosave until that has happened.
  const [hydrated, setHydrated] = useState(false);
  /**
   * 🔴 THE BASELINE. Content of the form that is KNOWN to match what is stored. The autosave
   * fires only when `form` DIFFERS from this, which is the whole fix for @bird's P0.
   */
  /**
   * 🔴 TWO HALVES, SET INDEPENDENTLY BY THE LOADER THAT OWNS EACH — and the single combined
   * baseline this replaces was a REAL BUG I shipped, found by probing my own failing test.
   *
   * The mappings loader wrote `{form: <whatever the form held AT THAT MOMENT>, mappings}`.
   * The mappings promise resolves after mount, so if a user is TYPING when it lands, their
   * unsaved edit was captured into the baseline and RECORDED AS PERSISTED — the autosave
   * then skipped it forever. A load swallowing a concurrent edit is the same shape as the
   * defect this whole file exists to prevent.
   *
   * ⇒ A LOADER MAY ONLY VOUCH FOR THE HALF IT LOADED. The settings load speaks for `form`,
   *   the mappings load speaks for `mappings`, and a successful save speaks for both.
   */
  const baselineFormRef = useRef<AppSettings | null>(null);
  const baselineMapsRef = useRef<AccountMapping[]>(loadAccountMappings());
  /**
   * 🔴 BOTH LOADS MUST SETTLE BEFORE ANY WRITE. Measured race, not a precaution: with only
   * the settings load gated, an edit could schedule a save while the mappings load was still
   * in flight. The save persisted the EMPTY seed mappings and vouched for them, the real
   * mappings then landed, the baseline halves disagreed, and a SECOND unrequested write
   * fired. Two writes for one keystroke.
   *
   * ⇒ A baseline half can only be vouched for by a load that has FINISHED.
   */
  const [mappingsSettled, setMappingsSettled] = useState(false);

  /**
   * 🔴 @bird ISOLATED THIS ON THE DEPLOYED BUILD, ONE VARIABLE, SAME BUNDLE:
   *
   *     in-app CLICK to /settings  ->  0 writes
   *     DIRECT URL  to /settings   ->  52 writes, no edit, no click, no Save
   *
   * ⭐ AND THE SPA REWRITE ARMED IT. Before that landed, `/settings` returned a hard 404,
   * so a refresh, a bookmark or a shared link could not load the page at all. A correct fix
   * made an unreachable defect reachable, and nothing in its diff predicted that.
   *
   * THE OLD MECHANISM, exactly:
   *   full load  -> form seeded from localStorage; initialSettingsRef holds that object
   *              -> loadSettings resolves -> setSettings(NEW identity)
   *              -> this effect fired, setForm(settings), setHydrated(true)
   *              -> the autosave effect saw `form` and `hydrated` BOTH change and wrote.
   *   ⇒ HYDRATION ITSELF COUNTED AS A USER EDIT.
   *
   * AND THE MIRROR DEFECT NOBODY HAD NAMED: on the in-app path there is no remount, so
   * `settings` never changed identity, `hydrated` stayed FALSE FOREVER, and the autosave
   * was PERMANENTLY DEAD. @bird's 0 writes was safe AND non-functional — the same line
   * caused both, in opposite directions.
   *
   * ⚠️ NOW GATED ON THE LOAD HAVING RESOLVED rather than on an object identity changing,
   * because identity change is a property of HOW the page was reached, not of what is known.
   */
  useEffect(() => {
    if (hydrated || !settingsLoaded) return;
    setForm(settings);
    baselineFormRef.current = settings;
    setHydrated(true);
  }, [settings, settingsLoaded, hydrated]);
  const [showToken, setShowToken] = useState(false);
  const [sheetStatus, setSheetStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [sheetPreview, setSheetPreview] = useState<Record<string, string>[]>([]);
  const [sheetError, setSheetError] = useState('');
  const [airtableStatus, setAirtableStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [airtableFields, setAirtableFields] = useState<string[]>([]);

  /**
   * The Lead Status choices from @andrew's own base. `null` means "we could not read them" —
   * NOT "there are none". The control degrades to a sentence rather than rendering an empty
   * checkbox list, because an empty list would read as "no statuses exist" and invite
   * un-ticking everything.
   */
  const [leadStatusChoices, setLeadStatusChoices] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const { airtableBaseId, airtableTableName, airtableToken } = form;
    if (!airtableBaseId || !airtableTableName || !airtableToken) {
      setLeadStatusChoices(null);
      return;
    }
    // ⛔ DEGRADE, NEVER THROW: fetchSelectChoices resolves null on 403 / network / renamed
    // field, so this cannot reject and cannot take the settings page down.
    void fetchSelectChoices(airtableBaseId, airtableTableName, 'Lead Status', airtableToken)
      .then(choices => { if (!cancelled) setLeadStatusChoices(choices); });
    return () => { cancelled = true; };
  }, [form.airtableBaseId, form.airtableTableName, form.airtableToken]);

  /**
   * Ticked statuses the base no longer has. Empty when the fetch failed — an absence of
   * choices is not evidence of absence, and accusing every ticked status of being missing
   * because a token expired is the alarming-direction error.
   */
  const missingStatuses = useMemo(
    () => tickedButMissing(form.closedWonStatuses ?? [], leadStatusChoices),
    [form.closedWonStatuses, leadStatusChoices],
  );
  const [airtableError, setAirtableError] = useState('');
  const [saved, setSaved] = useState(false);
  /**
   * 🔴 THE REFUSAL HAS TO LAND SOMEWHERE. @raccoon: "a guard refusing by THROW has no fixed
   * outcome; the outcome belongs to the CALL SITE, and this call site drops it." The clobber
   * guard in saveSettings refuses BY THROW, BY DESIGN — and that throw used to surface as an
   * unhandled promise rejection: no state, no toast, nothing the user could see. The one
   * deliberate safety mechanism in the write path produced silence.
   */
  const [saveError, setSaveError] = useState<string | null>(null);
  const [callCenterStatus, setCallCenterStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [callCenterError, setCallCenterError] = useState('');
  const [callCenterCount, setCallCenterCount] = useState(0);
  const [accountMappings, setAccountMappings] = useState<AccountMapping[]>(loadAccountMappings);
  const [mappingSearch, setMappingSearch] = useState('');
  const isFirstRender = useRef(true);

  /**
   * 🔴 THE SECOND NO-EDIT TRIGGER, AND I SHIPPED IT MYSELF IN 97d60d3.
   *
   * `accountMappings` is an autosave dependency, so this arrival is indistinguishable from a
   * user editing an alias. Before 97d60d3 it was harmless BY ACCIDENT: the in-app path never
   * hydrated, the autosave was dead, and this could not fire. Arming the autosave — a real
   * fix for a real defect — made it reachable on EVERY entry path, INCLUDING the sidebar
   * click @bird measured as safe.
   *
   * ⚠️ TWO THINGS THIS EFFECT MUST NOT DO, both of which it DID, and both found by probing
   * a failing test rather than by reading:
   *   ① it must not vouch for the FORM. Reading the current form here captured a user's
   *      in-flight keystrokes as ALREADY PERSISTED and the autosave skipped them forever.
   *      A loader may only vouch for the half it loaded.
   *   ② it must SETTLE, and the autosave must wait for it. Otherwise an edit could schedule
   *      a save while this was in flight: the save persisted the EMPTY seed mappings and
   *      vouched for them, the real mappings landed, the halves disagreed, and a SECOND
   *      unrequested write fired. Two writes for one keystroke.
   */
  useEffect(() => {
    loadAccountMappingsAsync()
      .then(dbMappings => {
        if (dbMappings && dbMappings.length > 0) {
          setAccountMappings(dbMappings);
          baselineMapsRef.current = dbMappings;
        }
      })
      .catch(() => {
        // A failed mappings load must not wedge the page read-only forever. The seed value
        // is then what we hold, and the baseline already vouches for exactly that.
      })
      .finally(() => setMappingsSettled(true));
  }, []);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Derive unique account names from loaded adSpend data
  const uniqueSheetAccounts = useMemo(() => {
    const names = new Set<string>();
    for (const row of adSpend) {
      if (row.accountName) names.add(row.accountName);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [adSpend]);

// When unique accounts change, only ADD new accounts — never overwrite existing user-configured entries
useEffect(() => {
  if (uniqueSheetAccounts.length === 0) return;
  setAccountMappings(prev => {
    const existing = new Map(prev.map(m => [m.sheetName.trim().toLowerCase(), m]));
    let changed = false;
    const updated = [...prev];

    for (const name of uniqueSheetAccounts) {
      const key = name.trim().toLowerCase();
      if (!existing.has(key)) {
        // Only add accounts that don't already exist — never touch existing ones
        updated.push({ sheetName: name, airtableName: name, program: 'Done For You' as const, mediaBuyer: '', status: isJunkAccount(name) ? 'Churned' as const : 'Active' as const });
        changed = true;
      }
    }

    // Return the same reference if nothing changed — prevents unnecessary re-renders and saves
    return changed ? updated : prev;
  });
}, [uniqueSheetAccounts]);

  // Sorted + filtered view of accountMappings for display (does not affect stored order)
  const sortedMappings = useMemo(() => {
    return accountMappings
      .map((mapping, index) => ({ mapping, index }))
      .sort((a, b) => {
        const aJunk = isJunkAccount(a.mapping.sheetName);
        const bJunk = isJunkAccount(b.mapping.sheetName);
        if (aJunk !== bJunk) return aJunk ? 1 : -1;
        const statusDiff = (STATUS_ORDER[a.mapping.status] ?? 2) - (STATUS_ORDER[b.mapping.status] ?? 2);
        if (statusDiff !== 0) return statusDiff;
        return a.mapping.sheetName.localeCompare(b.mapping.sheetName);
      });
  }, [accountMappings]);

  const displayedMappings = useMemo(() => {
    const q = mappingSearch.trim().toLowerCase();
    if (!q) return sortedMappings;
    return sortedMappings.filter(({ mapping }) =>
      mapping.sheetName.toLowerCase().includes(q) ||
      mapping.airtableName.toLowerCase().includes(q)
    );
  }, [sortedMappings, mappingSearch]);

  // Autosave: debounce form + accountMappings changes
  const performSave = useCallback(async (formToSave: AppSettings, mappingsToSave: AccountMapping[]) => {
    const settingsWithAliases = { ...formToSave, accountAliases: mappingsToSave };
    await Promise.all([
      saveSettings(settingsWithAliases),
      saveAccountMappings(mappingsToSave),
    ]);
    setSettings(settingsWithAliases);
    // Now refresh will always use the latest settings via the ref
    await refresh(settingsWithAliases);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [setSettings, refresh]);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    // ① GATE: never autosave from an unhydrated form. This is the fix for the wipe —
    // the async mappings load fires setAccountMappings, which used to reach performSave
    // with `form` still holding DEFAULT_SETTINGS.
    if (!hydrated || !mappingsSettled) return;

    // ⛔ ②a NEVER WRITE FROM AN UNVERIFIED COPY. @raccoon's blocker: on a warm browser the
    // local settings can be STALE-BUT-POPULATED — 1 excluded campaign where the DB has 4 —
    // and his guard measured safe:true on that shape because it refuses POPULATED -> EMPTY,
    // not POPULATED -> FEWER. If we never read the database we cannot know which we hold,
    // so the only safe write is none.
    if (settingsAreUnverified(settingsOrigin)) {
      console.error('[settings] autosave REFUSED — settings were never read from the database');
      return;
    }

    // ⛔ ②b HYDRATION IS NOT AN EDIT. @bird's P0: `form` changing because we just loaded it
    // is indistinguishable, to a dependency array, from the user typing. Comparing CONTENT
    // to the baseline is what separates them — a full page load now writes nothing, and a
    // real edit still saves on the in-app path where the autosave used to be dead.
    const current = stableStringify({ form, mappings: accountMappings });
    const baseline = stableStringify({ form: baselineFormRef.current, mappings: baselineMapsRef.current });
    if (current === baseline) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      // ② NET: even hydrated, refuse a write that would blank populated config. The
      // gate protects this caller; the guard protects against the next one too.
      const verdict = checkSettingsWrite(form, settings);
      if (!verdict.safe) {
        /**
         * 🔴 THE REFUSAL WAS INVISIBLE. Found while building the arm @raccoon specified:
         * this path only wrote to console.error, so the guard that refuses the write which
         * destroyed production at 22:18:48Z did its job and the user saw NOTHING — the same
         * defect I fixed on the THROW path an hour ago and did not carry across to the
         * REFUSE path two lines away. A guard whose refusal reaches nobody is indis-
         * tinguishable, from the user's seat, from a save that quietly worked.
         */
        console.error('[settings] autosave REFUSED —', verdict.reason);
        setSaveError(`${verdict.reason} Your change was NOT saved.`);
        return;
      }
      /**
       * 🔴 ORDER IS LOAD-BEARING — @raccoon found this inside the P0 fix itself.
       *
       * This used to advance the baseline BEFORE attempting the write. If the clobber guard
       * refused, the edit was RECORDED AS SAVED while being rejected — and because the
       * baseline then matched, RE-MAKING THE SAME EDIT WOULD NOT RETRY IT. A refusal
       * designed to be loud became an edit that silently never persisted.
       *
       * ⇒ THE BASELINE NOW ADVANCES ONLY ON SUCCESS, so a refused write leaves the form
       *   DIRTY and the next keystroke tries again.
       *
       * ⚠️ AND performSave's Promise.all does NOT cancel siblings on rejection (measured):
       * a refused saveSettings still lets saveAccountMappings through. The error text says
       * so rather than implying nothing was written.
       */
      performSave(form, accountMappings)
        .then(() => {
          baselineFormRef.current = form;
          baselineMapsRef.current = accountMappings;
          setSaveError(null);
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[settings] autosave FAILED —', msg);
          setSaveError(
            `${msg} — your change was NOT saved and will be retried on your next edit. ` +
              `Account mappings may have saved separately.`,
          );
        });
    }, 800);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [form, accountMappings, performSave, hydrated, mappingsSettled, settings, settingsOrigin]);

  const updateForm = (patch: Partial<AppSettings>) => {
    setForm(prev => ({ ...prev, ...patch }));
  };

  const updateMapping = (key: string, value: string) => {
    setForm(prev => ({
      ...prev,
      columnMappings: { ...prev.columnMappings, [key]: value },
    }));
  };

  // Setters from Airtable appointments (for bonus rates section)
  const uniqueSetters = useMemo(() => {
    const names = new Set<string>();
    for (const account of accounts) {
      for (const appt of account.appointmentList) {
        if (appt.setter?.trim()) names.add(appt.setter.trim());
      }
    }
    return Array.from(names).sort();
  }, [accounts]);

  // All setter names ever seen across call data + Airtable appointments
  const allSetterNames = useMemo(() => {
    const names = new Set<string>();
    for (const row of callData) {
      if (row.agentName?.trim()) names.add(row.agentName.trim());
    }
    for (const appt of appointments) {
      if (appt.setter?.trim()) names.add(appt.setter.trim());
    }
    return Array.from(names).sort();
  }, [callData, appointments]);

  const toggleSetter = useCallback((name: string) => {
    setForm(prev => {
      const inactive = prev.inactiveSetters || [];
      const isInactive = inactive.includes(name);
      return {
        ...prev,
        inactiveSetters: isInactive
          ? inactive.filter(s => s !== name)   // re-activate
          : [...inactive, name].sort(),         // deactivate
      };
    });
  }, []);

  const updateSetterRate = (setterName: string, rate: number) => {
    setForm(prev => {
      const existing = prev.setterBonusRates || [];
      const idx = existing.findIndex(r => r.setterName === setterName);
      if (idx >= 0) {
        const updated = [...existing];
        updated[idx] = { setterName, rate };
        return { ...prev, setterBonusRates: updated };
      }
      return { ...prev, setterBonusRates: [...existing, { setterName, rate }] };
    });
  };

  const updateAccountMapping = (index: number, patch: Partial<AccountMapping>) => {
    setAccountMappings(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], ...patch };
      return updated;
    });
  };

  const testSheet = async () => {
    setSheetStatus('loading');
    setSheetError('');
    try {
      const data = await fetchGoogleSheetData(form);
      setSheetPreview(data.slice(0, 3).map(r => r as any));
      setSheetStatus('success');
    } catch (e: any) {
      setSheetError(e.message);
      setSheetStatus('error');
    }
  };

  const testAirtable = async () => {
    setAirtableStatus('loading');
    setAirtableError('');
    try {
      const result = await fetchAirtableData(form);
      setAirtableFields(result.fields);
      setAirtableStatus('success');
    } catch (e: any) {
      setAirtableError(e.message);
      setAirtableStatus('error');
    }
  };

  const testCallCenter = async () => {
    setCallCenterStatus('loading');
    setCallCenterError('');
    try {
      const data = await fetchCallCenterData(form);
      setCallCenterCount(data.length);
      setCallCenterStatus('success');
    } catch (e: any) {
      setCallCenterError(e.message || 'Failed to fetch call center data');
      setCallCenterStatus('error');
    }
  };

  return (
    <div className="space-y-8 max-w-4xl">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold">Settings</h1>
        {saved && <span className="text-success text-sm flex items-center gap-1 animate-in fade-in"><CheckCircle className="w-4 h-4" /> Saved</span>}
        {/* The absence of a tick is not a signal — a user reads "nothing happened" as
            "nothing needed to happen". A refused write has to SAY it was refused. */}
        {saveError && (
          <span role="alert" className="text-destructive text-sm flex items-start gap-1">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {saveError}
          </span>
        )}
      </div>

      {/* Section 1: Google Sheets */}
      <section className="card-elevated p-6 space-y-4">
        <h2 className="font-semibold text-base">Google Sheets Connection</h2>
        <div>
          <label className="text-sm font-medium text-muted-foreground">Google Sheet URL</label>
          <input
            type="url"
            value={form.googleSheetUrl}
            onChange={e => updateForm({ googleSheetUrl: e.target.value })}
            placeholder="https://docs.google.com/spreadsheets/d/..."
            className="mt-1 w-full px-3 py-2 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-muted-foreground">Tab/Sheet Name</label>
          <input
            type="text"
            value={form.googleSheetTab}
            onChange={e => updateForm({ googleSheetTab: e.target.value })}
            className="mt-1 w-full px-3 py-2 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-muted-foreground">Raw tab name (completeness check)</label>
          <input
            type="text"
            value={form.adsRawTabName ?? ''}
            onChange={e => updateForm({ adsRawTabName: e.target.value })}
            placeholder={DEFAULT_ADS_RAW_TAB}
            className="mt-1 w-full px-3 py-2 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
          {/* Says what it is FOR and what happens if it is wrong, because a name that
              silently addresses the wrong tab is the fail-open this detector exists to
              refuse — Google answers an unknown tab with the DEFAULT tab and HTTP 200. */}
          <p className="mt-1 text-xs text-muted-foreground">
            The tab your ad spend tab is generated FROM. Its row count is compared to the tab
            above; a difference means the sheet's array formula has run out of range and rows
            are being dropped. If this name is wrong the check reports &ldquo;could not be
            verified&rdquo; rather than claiming your data is complete.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={testSheet} disabled={!form.googleSheetUrl || sheetStatus === 'loading'}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50">
            {sheetStatus === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Test Connection'}
          </button>
          {sheetStatus === 'success' && <span className="flex items-center gap-1 text-success text-sm"><CheckCircle className="w-4 h-4" /> Connected</span>}
          {sheetStatus === 'error' && <span className="flex items-center gap-1 text-destructive text-sm"><AlertCircle className="w-4 h-4" /> {sheetError}</span>}
        </div>
        {sheetStatus === 'success' && sheetPreview.length > 0 && (
          <div className="overflow-x-auto">
            <p className="text-xs text-muted-foreground mb-2">Preview (first 3 rows):</p>
            <table className="text-xs">
              <thead>
                <tr className="border-b">
                  {Object.keys(sheetPreview[0]).slice(0, 6).map(h => (
                    <th key={h} className="py-1 px-2 text-left text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheetPreview.map((row, i) => (
                  <tr key={i} className="border-b border-border/50">
                    {Object.values(row).slice(0, 6).map((v, j) => (
                      <td key={j} className="py-1 px-2 font-mono-tabular">{String(v)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Section: Call Center Google Sheet */}
      <section className="card-elevated p-6 space-y-4">
        <h2 className="font-semibold text-base">Call Center Google Sheet</h2>
        <div>
          <label className="text-sm font-medium text-muted-foreground">Google Sheet URL</label>
          <input
            type="url"
            value={form.callCenterSheetUrl}
            onChange={e => updateForm({ callCenterSheetUrl: e.target.value })}
            placeholder="https://docs.google.com/spreadsheets/d/..."
            className="mt-1 w-full px-3 py-2 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-muted-foreground">Tab/Sheet Name</label>
          <input
            type="text"
            value={form.callCenterSheetTab}
            onChange={e => updateForm({ callCenterSheetTab: e.target.value })}
            className="mt-1 w-full px-3 py-2 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>
        <div className="flex items-center gap-3">
          <button onClick={testCallCenter} disabled={!form.callCenterSheetUrl || callCenterStatus === 'loading'}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50">
            {callCenterStatus === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Test Connection'}
          </button>
          {callCenterStatus === 'success' && <span className="flex items-center gap-1 text-success text-sm"><CheckCircle className="w-4 h-4" /> {callCenterCount} rows loaded</span>}
          {callCenterStatus === 'error' && <span className="flex items-center gap-1 text-destructive text-sm"><AlertCircle className="w-4 h-4" /> {callCenterError}</span>}
        </div>
      </section>

      {/* Section: AI Assistant */}
      <section className="card-elevated p-6 space-y-4">
        <h2 className="font-semibold text-base">AI Assistant</h2>
        {/*
          The Anthropic API key input is GONE ON PURPOSE — do not restore it.
          Anything typed here was saved into `app_settings`, a table readable by
          the anon role, i.e. by anyone on the internet. Leaving an empty box here
          would be worse than useless: a user seeing a blank key field on a broken
          dashboard re-enters the key, and that write re-opens the exact hole.
          The key is a server-side secret now. Rotation happens there.
        */}
        <div className="rounded-lg border border-muted bg-muted/30 p-3">
          <p className="text-sm font-medium text-foreground">API key is managed server-side</p>
          <p className="text-xs text-muted-foreground mt-1">
            The Anthropic key is no longer stored in application settings and cannot be
            entered here. It lives in server-side secrets, where the browser cannot read it.
          </p>
        </div>
      </section>

      {/* Section 2: Airtable */}
      <section className="card-elevated p-6 space-y-4">
        <h2 className="font-semibold text-base">Airtable Connection</h2>
        <div>
          <label className="text-sm font-medium text-muted-foreground">Base ID</label>
          <input
            type="text"
            value={form.airtableBaseId}
            onChange={e => updateForm({ airtableBaseId: e.target.value.trim() })}
            placeholder="appXXXXXXXXXXXXXX"
            className="mt-1 w-full px-3 py-2 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
          {/*
            ⭐ THIS EXACT MISTAKE HAPPENED, 2026-08-05: a Personal Access Token was pasted into
            the Base ID box. Nothing caught it — our credential guard matches KEY NAMES, and
            `airtableBaseId` is not a credential key, so a token in the wrong field walks
            straight through into a world-readable table. A name-based guard cannot see a
            secret in the wrong box; this check looks at the VALUE's SHAPE instead.
          */}
          {form.airtableBaseId?.startsWith('pat') && (
            <p className="text-xs text-destructive mt-1">
              That looks like a Personal Access Token, not a Base ID — and it has just been
              stored somewhere the browser can read. Move it to the token field below, put the
              Base ID (starts with <code>app</code>) here, and rotate that token.
            </p>
          )}
          {form.airtableBaseId && !form.airtableBaseId.startsWith('app') &&
           !form.airtableBaseId.startsWith('pat') && (
            <p className="text-xs text-warning mt-1">
              Airtable Base IDs normally start with <code>app</code>. Double-check this value.
            </p>
          )}
        </div>
        <div>
          <label className="text-sm font-medium text-muted-foreground">Table Name</label>
          <input
            type="text"
            value={form.airtableTableName}
            onChange={e => updateForm({ airtableTableName: e.target.value })}
            className="mt-1 w-full px-3 py-2 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>
        {/*
          🎯 WHICH STATUSES COUNT AS A CLOSED DEAL — @andrew: "yeah make it mappable".
          The COLUMN was already mappable; the VALUE was a hardcoded literal, so the rule
          deciding the number he judges accounts on was one he could neither see nor change.
          Rename the option in Airtable and there was nowhere to tell us.

          The options are read from HIS base rather than maintained here — a list we keep is
          the same defect one level up.
        */}
        <div>
          <label className="text-sm font-medium text-muted-foreground">
            Which Lead Status values count as a closed deal
          </label>
          {leadStatusChoices === null ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Could not read the status options from Airtable. Closed deals are being counted
              with the built-in default: <strong>Closed Won</strong>.
            </p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {leadStatusChoices.map(choice => {
                const cur = form.closedWonStatuses ?? CLOSED_WON_DEFAULT;
                const ticked = cur.some(s => s.trim().toLowerCase() === choice.trim().toLowerCase());
                return (
                  <label key={choice} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={ticked}
                      onChange={e => updateForm({
                        closedWonStatuses: e.target.checked
                          ? [...cur, choice]
                          : cur.filter(s => s.trim().toLowerCase() !== choice.trim().toLowerCase()),
                      })}
                    />
                    <span>{choice}</span>
                  </label>
                );
              })}
            </div>
          )}
          {/* ⭐ A ticked status Airtable no longer has stops matching SILENTLY and the closed
              count drops with nothing on screen to say why — the same rot as a saved-but-absent
              column mapping. Named, not left to be discovered. */}
          {missingStatuses.length > 0 && (
            <p className="mt-2 text-xs text-warning">
              {missingStatuses.length} selected {missingStatuses.length === 1 ? 'status is' : 'statuses are'}{' '}
              no longer in Airtable: {missingStatuses.join(', ')}.{' '}
              {missingStatuses.length === 1 ? 'It is' : 'They are'} not counting toward closed deals.
            </p>
          )}
          {/* 🔴 THE ONE STATE WHERE THE CONTROL AND THE BEHAVIOUR DISAGREE — @apprentice.
              `?? CLOSED_WON_DEFAULT` does not catch `[]`, so un-ticking everything renders
              every box EMPTY while the system counts `Closed Won` via the fallback. A reader
              who unticked all seven to mean "count nothing" sees a screen that agrees with
              them and a number that does not — and only the number reveals it.
              ⇒ The boxes still show the SETTING truthfully; this names the EFFECT. */}
          {(form.closedWonStatuses?.length === 0) && (
            <p className="mt-2 text-xs text-warning">
              Nothing is selected, so closed deals are being counted with the built-in default:{' '}
              <strong>Closed Won</strong>. There is no setting for &ldquo;count nothing as
              won&rdquo; &mdash; an empty list would take every closed-deal figure to zero.
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            Un-ticking everything falls back to <strong>Closed Won</strong> rather than counting
            nothing. A deal marked <strong>Closed Lost</strong> is never counted as won, even if
            ticked here.
          </p>
        </div>
        {/*
          ⛔ OWNER-ORDERED, 2026-08-05. The token input was removed when the secret moved
          server-side — but airtable-proxy was never deployed, so appointments went dark and
          there was NO WAY TO PUT THE TOKEN BACK from the UI. The field returns.
          The token is used ONLY by the direct fallback in fetchAirtableData, behind the
          proxy. When airtable-proxy is deployed this input can go again.
        */}
        <div>
          <label className="text-sm font-medium text-muted-foreground">Personal Access Token</label>
          <div className="relative mt-1">
            <input
              type={showToken ? 'text' : 'password'}
              value={form.airtableToken || ''}
              onChange={e => updateForm({ airtableToken: e.target.value.trim() })}
              placeholder="pat..."
              className="w-full px-3 py-2 pr-10 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
            <button type="button" onClick={() => setShowToken(!showToken)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Stored in application settings, which are readable by anyone with the app URL.
            Treat this token as public and rotate it if it leaks.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={testAirtable} disabled={!form.airtableBaseId || airtableStatus === 'loading'}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50">
            {airtableStatus === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Test Connection'}
          </button>
          {airtableStatus === 'success' && <span className="flex items-center gap-1 text-success text-sm"><CheckCircle className="w-4 h-4" /> Connected</span>}
          {airtableStatus === 'error' && <span className="flex items-center gap-1 text-destructive text-sm"><AlertCircle className="w-4 h-4" /> {airtableError}</span>}
        </div>
        {airtableStatus === 'success' && airtableFields.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Available columns:</p>
            <div className="flex flex-wrap gap-1.5">
              {airtableFields.map(f => (
                <span key={f} className="px-2 py-1 rounded-md bg-accent text-xs font-medium">{f}</span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Section 3: Column Mappings */}
      {airtableFields.length > 0 && (
        <section className="card-elevated p-6 space-y-4">
          <h2 className="font-semibold text-base">Column Mappings (Airtable)</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {REQUIRED_MAPPINGS.map(key => (
              <div key={key}>
                <label className="text-xs font-medium text-muted-foreground">{key}</label>
                <select
                  value={form.columnMappings[key] || ''}
                  onChange={e => updateMapping(key, e.target.value)}
                  className="mt-1 w-full px-3 py-2 text-sm rounded-lg border bg-background focus:outline-none"
                >
                  <option value="">— Select —</option>
                  {/**
                    * 🔴 D2, SECOND HALF: A SAVED VALUE MISSING FROM THE LIST MUST STILL BE
                    * AN OPTION. Even with the union fix, any mapping whose column is absent
                    * from the current fetch — a renamed field, a table the user re-pointed —
                    * would render as "— Select —" and the first interaction would BLANK a
                    * working mapping. The select must never present a correct saved value
                    * as if nothing were chosen.
                    */}
                  {form.columnMappings?.[key] && !airtableFields.includes(form.columnMappings[key]) && (
                    <option value={form.columnMappings[key]}>
                      {form.columnMappings[key]} (saved — not in the current Airtable fetch)
                    </option>
                  )}
                  {airtableFields.map(f => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Section 4: Account Mappings */}
      {uniqueSheetAccounts.length > 0 && (
        <section className="card-elevated p-6 space-y-4">
          <h2 className="font-semibold text-base">Account Mappings</h2>
          <p className="text-xs text-muted-foreground">
            Map each Ad Account Name to the matching Airtable Name. Set program, media buyer, and status for Dashboard grouping.
          </p>

          {/* Search */}
          <div className="relative w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Filter accounts..."
              value={mappingSearch}
              onChange={e => setMappingSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-ring/20 w-full"
            />
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <div style={{ minWidth: '760px' }}>
              {/* Header */}
              <div
                className="grid gap-2 text-xs font-medium text-muted-foreground mb-2 px-1"
                style={{ gridTemplateColumns: 'minmax(220px,1fr) minmax(220px,1fr) 144px 128px 112px' }}
              >
                <span>Ad Account Name</span>
                <span>Airtable Name</span>
                <span>Program</span>
                <span>Media Buyer</span>
                <span>Status</span>
              </div>

              {/* Rows */}
              <div className="space-y-2">
                {displayedMappings.map(({ mapping, index }) => (
                  <div
                    key={mapping.sheetName}
                    className="grid gap-2 items-center"
                    style={{ gridTemplateColumns: 'minmax(220px,1fr) minmax(220px,1fr) 144px 128px 112px' }}
                  >
                    <span className="px-3 py-2 text-sm rounded-lg border bg-muted/50 truncate" title={mapping.sheetName}>
                      {mapping.sheetName}
                    </span>
                    <input
                      type="text"
                      value={mapping.airtableName}
                      onChange={e => updateAccountMapping(index, { airtableName: e.target.value })}
                      className="px-3 py-2 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-ring/20 min-w-0"
                    />
                    <select
                      value={mapping.program || 'Done For You'}
                      onChange={e => updateAccountMapping(index, { program: e.target.value as AccountMapping['program'] })}
                      className="w-full px-3 py-2 text-sm rounded-lg border bg-background focus:outline-none"
                    >
                      <option value="Done For You">Done For You</option>
                      <option value="Done With You">Done With You</option>
                      <option value="Other">Other</option>
                    </select>
                    <input
                      type="text"
                      value={mapping.mediaBuyer || ''}
                      onChange={e => updateAccountMapping(index, { mediaBuyer: e.target.value })}
                      placeholder="Unassigned"
                      className="w-full px-3 py-2 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
                    />
                    <select
                      value={mapping.status || 'Active'}
                      onChange={e => updateAccountMapping(index, { status: e.target.value as AccountMapping['status'] })}
                      className="w-full px-3 py-2 text-sm rounded-lg border bg-background focus:outline-none"
                    >
                      <option value="Active">Active</option>
                      <option value="Paused">Paused</option>
                      <option value="Churned">Churned</option>
                    </select>
                  </div>
                ))}
                {displayedMappings.length === 0 && (
                  <p className="text-sm text-muted-foreground py-2">No accounts match your filter.</p>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Section 5: Setters */}
      {allSetterNames.length > 0 && (
        <section className="card-elevated p-6 space-y-4">
          <div>
            <h2 className="font-semibold text-base">Setters</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Auto-detected from call data and appointments. Inactive setters are hidden from the Call Center and Agents pages.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {allSetterNames.map(name => {
              const isActive = !(form.inactiveSetters || []).includes(name);
              return (
                <div key={name} className="flex items-center justify-between px-3 py-2.5 rounded-lg border bg-muted/20">
                  <span className="text-sm font-medium truncate">{name}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isActive}
                    onClick={() => toggleSetter(name)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${isActive ? 'bg-primary' : 'bg-muted'}`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${isActive ? 'translate-x-4' : 'translate-x-0'}`}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Section 5b: Setter Bonus Rates */}
      {uniqueSetters.length > 0 && (
        <section className="card-elevated p-6 space-y-4">
          <div>
            <h2 className="font-semibold text-base">Setter Bonus Rates</h2>
            <p className="text-xs text-muted-foreground mt-1">Dollar amount paid per valid appointment for each setter. Used on the Agents page.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {uniqueSetters.map(setterName => {
              const rateConfig = (form.setterBonusRates || []).find(r => r.setterName === setterName);
              const rate = rateConfig?.rate ?? 5;
              return (
                <div key={setterName} className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border bg-muted/20">
                  <span className="text-sm font-medium truncate">{setterName}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-sm text-muted-foreground">$</span>
                    <input
                      type="number"
                      value={rate}
                      min={0}
                      onChange={e => updateSetterRate(setterName, parseFloat(e.target.value) || 0)}
                      className="w-16 px-2 py-1 text-sm text-right rounded-md border bg-background focus:outline-none focus:ring-2 focus:ring-ring/20 font-mono-tabular"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Section 6: Account Groups */}
      <section className="card-elevated p-6 space-y-4">
        <h2 className="font-semibold text-base">Account Groups</h2>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={form.showPausedAccounts} onChange={e => updateForm({ showPausedAccounts: e.target.checked })}
            className="rounded border-input" />
          <span className="text-sm">Show Paused Accounts</span>
        </label>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={form.showChurnedAccounts} onChange={e => updateForm({ showChurnedAccounts: e.target.checked })}
            className="rounded border-input" />
          <span className="text-sm">Show Churned Accounts</span>
        </label>
        <div>
          <label className="text-sm font-medium text-muted-foreground">Paused Threshold (days)</label>
          <input
            type="number"
            value={form.pausedThresholdDays}
            onChange={e => updateForm({ pausedThresholdDays: parseInt(e.target.value) || 1 })}
            min={1}
            className="mt-1 w-24 px-3 py-2 text-sm rounded-lg border bg-background focus:outline-none"
          />
        </div>
      </section>
    </div>
  );
}