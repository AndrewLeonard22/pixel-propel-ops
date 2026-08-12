import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useData } from '@/hooks/useData';
import { saveSettings, saveAccountMappings, loadAccountMappings, loadAccountMappingsAsync, settingsAreUnverified } from '@/lib/config';
import { fetchAirtableData, CLOSED_WON_DEFAULT } from '@/lib/dataService';
import { fetchSelectChoices, tickedButMissing } from '@/lib/airtableChoices';
import type { AppSettings, AccountMapping } from '@/lib/types';
import { checkSettingsWrite } from '@/lib/settingsWriteGuard';
import { isJunkCompanyName } from '@/lib/accountDisplay';
import { CheckCircle, AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react';
import AccountsTable from '@/components/settings/AccountsTable';
import FreshnessSection from '@/components/settings/FreshnessIndicator';
import SettingsShell, { type SettingsSection } from '@/components/settings/SettingsShell';
import { Combobox } from '@/components/ui/combobox';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

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

// ── Small field primitives. One shape for every input on the page, so nothing here is a
// bespoke box with its own padding and its own focus treatment.

/**
 * ⚠️ A `<label>` WITH NO `for` AND NO NESTED CONTROL LABELS NOTHING — the same law
 * AccountEditPanel's `Field` was rewritten for, and this second copy never got it. It
 * emitted `<label htmlFor={undefined}>` unconditionally, and "Paused threshold" below
 * passes no `htmlFor`, so that field's only name pointed at nothing: a screen reader read
 * the number box as unlabelled while the page LOOKED labelled.
 *
 * When there is no id to point at, render a `<span>`. It carries the same weight visually
 * and at least does not CLAIM to name a control.
 */
function Field({ label, hint, htmlFor, children, error }: {
  label: string; hint?: React.ReactNode; htmlFor?: string; children: React.ReactNode; error?: React.ReactNode;
}) {
  const labelCls = 'block text-[13px] font-medium text-foreground';
  return (
    <div className="space-y-2 max-w-[520px]">
      {htmlFor
        ? <label htmlFor={htmlFor} className={labelCls}>{label}</label>
        : <span className={labelCls}>{label}</span>}
      {children}
      {hint && <div className="text-xs text-muted-foreground leading-relaxed">{hint}</div>}
      {error}
    </div>
  );
}

/**
 * One text input, everywhere. `focus:border-ring` and NOT `ring-2 ring-offset-2`: a 4px
 * halo outside the control is what makes a form read as a 2019 bootstrap admin, and it
 * collides with whatever sits beside it.
 */
function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm',
        'placeholder:text-muted-foreground transition-colors',
        'hover:border-border focus:border-ring focus:outline-none',
        props.className,
      )}
    />
  );
}

/** A settings toggle row: label + description on the left, control on the right. */
function ToggleRow({ label, description, checked, onChange }: {
  label: string; description?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-3.5 border-b border-divider last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm text-foreground">{label}</div>
        {description && <div className="mt-0.5 text-[13px] text-muted-foreground">{description}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} className="shrink-0" />
    </div>
  );
}

export default function SettingsPage() {
  const { settings, setSettings, adSpend, accounts, appointments, refresh, settingsOrigin, settingsLoaded } = useData();
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
  const [accountMappings, setAccountMappings] = useState<AccountMapping[]>(loadAccountMappings);
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

  /**
   * The distinct account names in the ad-spend feed.
   *
   * ⚠️ THESE ARE META'S CURRENT DISPLAY NAMES since the Supabase cutover, not the Google
   * Sheet's names — the variable was called `uniqueAccountNames` and there is no sheet.
   * They are still the right key for the legacy alias store below, because
   * `buildAccountSummaries` looks that store up by the account's CURRENT name. The two must
   * stay keyed the same way; if one moves to `accountId`, so does the other.
   */
  const uniqueAccountNames = useMemo(() => {
    const names = new Set<string>();
    for (const row of adSpend) {
      if (row.accountName) names.add(row.accountName);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [adSpend]);

/**
 * ⚠️ HEADLESS BUT LOAD-BEARING — it looks like dead code and is not.
 *
 * Nothing on this page RENDERS `accountMappings` any more: the account table above reads
 * and writes `ad_accounts` in Supabase, keyed on account id. But the DASHBOARD still
 * resolves account -> company/program/media-buyer from `settings.accountAliases`
 * (dataService.ts), and this effect plus the autosave below are the only things that keep
 * that store populated. Deleting them would silently change what the dashboard shows.
 */
useEffect(() => {
  if (uniqueAccountNames.length === 0) return;
  setAccountMappings(prev => {
    const existing = new Map(prev.map(m => [m.sheetName.trim().toLowerCase(), m]));
    let changed = false;
    const updated = [...prev];

    for (const name of uniqueAccountNames) {
      const key = name.trim().toLowerCase();
      if (!existing.has(key)) {
        // Only add accounts that don't already exist — never touch existing ones
        updated.push({ sheetName: name, airtableName: name, program: 'Done For You' as const, mediaBuyer: '', status: isJunkCompanyName(name) ? 'Churned' as const : 'Active' as const });
        changed = true;
      }
    }

    // Return the same reference if nothing changed — prevents unnecessary re-renders and saves
    return changed ? updated : prev;
  });
}, [uniqueAccountNames]);

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

  /**
   * All setter names ever seen.
   * ⚠️ WAS a union of call-centre agent names and Airtable setters. The call-centre source
   * was removed on 2026-08-11 and its sheet had never been connected in production, so that
   * half of the union contributed nothing on any real render. Airtable is now the only
   * source, which is what it already was in practice.
   */
  const allSetterNames = useMemo(() => {
    const names = new Set<string>();
    for (const appt of appointments) {
      if (appt.setter?.trim()) names.add(appt.setter.trim());
    }
    return Array.from(names).sort();
  }, [appointments]);

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

  const testAirtable = async () => {
    setAirtableStatus('loading');
    setAirtableError('');
    try {
      const result = await fetchAirtableData(form);
      setAirtableFields(result.fields);
      setAirtableStatus('success');
    } catch (e) {
      setAirtableError(e instanceof Error ? e.message : String(e));
      setAirtableStatus('error');
    }
  };

  /**
   * SECTION ORDER IS THE ARGUMENT. Accounts is first and is the default landing section
   * because it is the entire reason this page gets opened. Freshness sits beside it because
   * both answer "is this real?". Connections is last: it is plumbing, not a daily surface.
   */
  const sections: SettingsSection[] = [
    {
      id: 'accounts', label: 'Accounts', group: 'Data',
      title: 'Accounts',
      description: 'Which company each Meta ad account belongs to. Matched on account ID, so renaming an account in Meta does not break the link.',
      render: () => <AccountsTable />,
    },
    {
      id: 'freshness', label: 'Data freshness', group: 'Data',
      title: 'Data freshness',
      description: 'When the ad spend on every screen was last pulled from Meta, and what happened on the last few pulls.',
      render: () => <FreshnessSection />,
    },
    {
      id: 'team', label: 'Team', group: 'People',
      title: 'Team',
      description: 'Setters detected from Airtable appointments. Inactive setters are hidden from the Agents page.',
      render: () => (
        <div className="space-y-8">
          {allSetterNames.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              No setters found yet. They appear automatically once appointments load from Airtable.
            </p>
          ) : (
            <div>
              <div className="h-9 flex items-center border-b border-divider text-xs font-medium text-muted-foreground">
                <span className="flex-1">Setter</span>
                <span className="w-24 text-right">Active</span>
              </div>
              {allSetterNames.map(name => {
                const isActive = !(form.inactiveSetters || []).includes(name);
                return (
                  <div key={name} className="flex items-center h-12 border-b border-divider last:border-b-0 hover:bg-row-hover transition-colors">
                    <span className="flex-1 min-w-0 truncate text-sm">{name}</span>
                    <div className="w-24 flex justify-end">
                      <Switch checked={isActive} onCheckedChange={() => toggleSetter(name)} aria-label={`${name} active`} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {uniqueSetters.length > 0 && (
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-medium">Bonus rates</h3>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  Paid per valid appointment. Used on the Agents page.
                </p>
              </div>
              <div>
                <div className="h-9 flex items-center border-b border-divider text-xs font-medium text-muted-foreground">
                  <span className="flex-1">Setter</span>
                  <span className="w-28 text-right">Per appointment</span>
                </div>
                {uniqueSetters.map(setterName => {
                  const rateConfig = (form.setterBonusRates || []).find(r => r.setterName === setterName);
                  const rate = rateConfig?.rate ?? 5;
                  return (
                    <div key={setterName} className="flex items-center h-12 border-b border-divider last:border-b-0 hover:bg-row-hover transition-colors">
                      <span className="flex-1 min-w-0 truncate text-sm">{setterName}</span>
                      <div className="w-28 flex items-center justify-end gap-1">
                        <span className="text-[13px] text-muted-foreground">$</span>
                        <input
                          type="number"
                          value={rate}
                          min={0}
                          onChange={e => updateSetterRate(setterName, parseFloat(e.target.value) || 0)}
                          className="h-8 w-16 rounded-md border border-input bg-background px-2 text-right text-[13px] font-mono-tabular hover:border-border focus:border-ring focus:outline-none transition-colors"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'display', label: 'Display', group: 'Preferences',
      title: 'Display',
      description: 'What appears on the dashboard by default.',
      render: () => (
        <div className="space-y-6">
          <div>
            <ToggleRow
              label="Show paused accounts"
              description="Accounts with no spend for longer than the threshold below."
              checked={form.showPausedAccounts}
              onChange={v => updateForm({ showPausedAccounts: v })}
            />
            <ToggleRow
              label="Show churned accounts"
              description="Accounts marked churned in the account mapping."
              checked={form.showChurnedAccounts}
              onChange={v => updateForm({ showChurnedAccounts: v })}
            />
          </div>
          <Field label="Paused threshold" htmlFor="paused-threshold" hint="Days without spend before an account counts as paused.">
            <div className="flex items-center gap-2">
              <TextInput
                id="paused-threshold"
                type="number"
                value={form.pausedThresholdDays}
                min={1}
                onChange={e => updateForm({ pausedThresholdDays: parseInt(e.target.value) || 1 })}
                className="w-24 font-mono-tabular"
              />
              <span className="text-[13px] text-muted-foreground">days</span>
            </div>
          </Field>
        </div>
      ),
    },
    {
      // ⚠️ THE RAIL LABEL AND THE HEADING ARE THE SAME WORDS. It was the only section of the
      // five where they differed ("Connections" in the rail, "Airtable connection" on the
      // page), so scroll-spy highlighted a word that was nowhere on screen.
      // NB this really is Airtable: it is where APPOINTMENTS are read from, and it is not
      // the account-mapping "airtableName" defect, which lived in the accounts table.
      id: 'connections', label: 'Airtable', group: 'Advanced',
      title: 'Airtable connection',
      description: 'Where appointments are read from, and which of its columns mean what.',
      render: () => (
        <div className="space-y-6">
          <Field
            label="Base ID"
            htmlFor="airtable-base"
            error={
              <>
                {/*
                  ⭐ THIS EXACT MISTAKE HAPPENED, 2026-08-05: a Personal Access Token was pasted into
                  the Base ID box. Nothing caught it — our credential guard matches KEY NAMES, and
                  `airtableBaseId` is not a credential key, so a token in the wrong field walks
                  straight through into a world-readable table. A name-based guard cannot see a
                  secret in the wrong box; this check looks at the VALUE's SHAPE instead.
                */}
                {form.airtableBaseId?.startsWith('pat') && (
                  <p className="text-xs text-destructive">
                    That looks like a Personal Access Token, not a Base ID — and it has just been
                    stored somewhere the browser can read. Move it to the token field below, put the
                    Base ID (starts with <code>app</code>) here, and rotate that token.
                  </p>
                )}
                {form.airtableBaseId && !form.airtableBaseId.startsWith('app') &&
                 !form.airtableBaseId.startsWith('pat') && (
                  <p className="text-xs text-warning-strong">
                    Airtable Base IDs normally start with <code>app</code>. Double-check this value.
                  </p>
                )}
              </>
            }
          >
            <TextInput
              id="airtable-base"
              type="text"
              value={form.airtableBaseId}
              onChange={e => updateForm({ airtableBaseId: e.target.value.trim() })}
              placeholder="appXXXXXXXXXXXXXX"
            />
          </Field>

          <Field label="Table name" htmlFor="airtable-table">
            <TextInput
              id="airtable-table"
              type="text"
              value={form.airtableTableName}
              onChange={e => updateForm({ airtableTableName: e.target.value })}
            />
          </Field>

          {/*
            ⛔ OWNER-ORDERED, 2026-08-05. The token input was removed when the secret moved
            server-side — but airtable-proxy was never deployed, so appointments went dark and
            there was NO WAY TO PUT THE TOKEN BACK from the UI. The field returns.
          */}
          <Field
            label="Personal access token"
            htmlFor="airtable-token"
            hint="Stored in application settings, which are readable by anyone with the app URL. Treat this token as public and rotate it if it leaks."
          >
            <div className="relative">
              <TextInput
                id="airtable-token"
                type={showToken ? 'text' : 'password'}
                value={form.airtableToken || ''}
                onChange={e => updateForm({ airtableToken: e.target.value.trim() })}
                placeholder="pat..."
                className="pr-10"
              />
              {/* Was a bare 16x16 icon: below the 24px WCAG 2.5.8 minimum, and the one
                  control on this page you press while holding a token in the clipboard.
                  The icon is unchanged; only the target grew. */}
              <button type="button" onClick={() => setShowToken(!showToken)}
                aria-label={showToken ? 'Hide token' : 'Show token'}
                aria-pressed={showToken}
                className="absolute right-1 top-1/2 -translate-y-1/2 grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-row-hover hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors">
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </Field>

          <div className="flex items-center gap-3 max-w-[520px]">
            <button onClick={testAirtable} disabled={!form.airtableBaseId || airtableStatus === 'loading'}
              className="h-9 px-3 text-[13px] font-medium rounded-md border border-input bg-background hover:bg-row-hover transition-colors disabled:opacity-50 flex items-center gap-2">
              {airtableStatus === 'loading' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Test connection
            </button>
            {airtableStatus === 'success' && <span className="flex items-center gap-1.5 text-success text-[13px]"><CheckCircle className="w-3.5 h-3.5" /> Connected</span>}
            {airtableStatus === 'error' && <span className="flex items-center gap-1.5 text-destructive text-[13px]"><AlertCircle className="w-3.5 h-3.5 shrink-0" /> {airtableError}</span>}
          </div>

          {/*
            🎯 WHICH STATUSES COUNT AS A CLOSED DEAL — @andrew: "yeah make it mappable".
            The COLUMN was already mappable; the VALUE was a hardcoded literal, so the rule
            deciding the number he judges accounts on was one he could neither see nor change.
            The options are read from HIS base rather than maintained here.
          */}
          <div className="space-y-2 max-w-[520px] pt-2">
            <div className="text-[13px] font-medium text-foreground">
              Which Lead Status values count as a closed deal
            </div>
            {leadStatusChoices === null ? (
              <p className="text-xs text-muted-foreground">
                Could not read the status options from Airtable. Closed deals are being counted
                with the built-in default: <strong>Closed Won</strong>.
              </p>
            ) : (
              <div>
                {leadStatusChoices.map(choice => {
                  const cur = form.closedWonStatuses ?? CLOSED_WON_DEFAULT;
                  const ticked = cur.some(s => s.trim().toLowerCase() === choice.trim().toLowerCase());
                  return (
                    // h-12, not h-11: one page had 56 / 48 / 48 / 44px rows across four
                    // tables. The two-line accounts row earns its 56; every single-line row
                    // on this page is now 48.
                    <label key={choice} className="flex items-center justify-between gap-4 h-12 border-b border-divider last:border-b-0 cursor-pointer">
                      <span className="text-sm truncate">{choice}</span>
                      <Switch
                        checked={ticked}
                        onCheckedChange={c => updateForm({
                          closedWonStatuses: c
                            ? [...cur, choice]
                            : cur.filter(s => s.trim().toLowerCase() !== choice.trim().toLowerCase()),
                        })}
                      />
                    </label>
                  );
                })}
              </div>
            )}
            {/* ⭐ A ticked status Airtable no longer has stops matching SILENTLY and the closed
                count drops with nothing on screen to say why. Named, not left to be discovered. */}
            {missingStatuses.length > 0 && (
              <p className="text-xs text-warning-strong">
                {missingStatuses.length} selected {missingStatuses.length === 1 ? 'status is' : 'statuses are'}{' '}
                no longer in Airtable: {missingStatuses.join(', ')}.{' '}
                {missingStatuses.length === 1 ? 'It is' : 'They are'} not counting toward closed deals.
              </p>
            )}
            {/* 🔴 THE ONE STATE WHERE THE CONTROL AND THE BEHAVIOUR DISAGREE — @apprentice.
                `?? CLOSED_WON_DEFAULT` does not catch `[]`, so un-ticking everything renders
                every box EMPTY while the system counts `Closed Won` via the fallback. */}
            {(form.closedWonStatuses?.length === 0) && (
              <p className="text-xs text-warning-strong">
                Nothing is selected, so closed deals are being counted with the built-in default:{' '}
                <strong>Closed Won</strong>. There is no setting for &ldquo;count nothing as
                won&rdquo;; an empty list would take every closed-deal figure to zero.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Un-ticking everything falls back to <strong>Closed Won</strong> rather than counting
              nothing. A deal marked <strong>Closed Lost</strong> is never counted as won, even if
              ticked here.
            </p>
          </div>

          {airtableFields.length > 0 && (
            <div className="space-y-3 pt-2">
              <div>
                <h3 className="text-sm font-medium">Column mappings</h3>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  Which Airtable column carries each value the dashboard needs.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 max-w-[720px]">
                {REQUIRED_MAPPINGS.map(key => {
                  const current = form.columnMappings?.[key] || '';
                  /**
                   * 🔴 A SAVED VALUE MISSING FROM THE LIST MUST STILL BE AN OPTION. A mapping
                   * whose column is absent from the current fetch — a renamed field, a table
                   * the user re-pointed — would otherwise render as unselected and the first
                   * interaction would BLANK a working mapping. The control must never present
                   * a correct saved value as if nothing were chosen.
                   */
                  const missing = current && !airtableFields.includes(current);
                  const options = missing ? [current, ...airtableFields] : airtableFields;
                  // `key` is a human label ("Client Name"), and a space in an id makes
                  // `htmlFor`/`aria-labelledby` reference NOTHING — the association fails
                  // silently and looks exactly like the bug it is supposed to fix.
                  const fieldId = `airtable-map-${key.replace(/[^A-Za-z0-9_-]+/g, '-')}`;
                  return (
                    <div key={key} className="space-y-1.5">
                      {/* ⚠️ THE `<label>` NAMED NOTHING — no `for`, no nested control — so
                          axe reported `button-name` (critical) on every row of this mapping
                          grid. A `role="combobox"` takes no name from its content; see the
                          `aria-label` docblock in ui/combobox.tsx. */}
                      <label id={`${fieldId}-label`} htmlFor={fieldId} className="block text-xs font-medium text-muted-foreground">{key}</label>
                      <Combobox
                        id={fieldId}
                        aria-labelledby={`${fieldId}-label`}
                        value={current || null}
                        onChange={v => updateMapping(key, v ?? '')}
                        options={options}
                        clearable
                        clearLabel="Not mapped"
                        placeholder="Not mapped"
                        searchPlaceholder="Search columns"
                        emptyLabel="No matching column."
                      />
                      {missing && (
                        <p className="text-xs text-warning-strong">Saved, but not in the current Airtable fetch.</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/*
            The Anthropic API key input is GONE ON PURPOSE — do not restore it. Anything typed
            there was saved into `app_settings`, a table readable by the anon role, i.e. by
            anyone on the internet. The key is a server-side secret now.
          */}
          <p className="text-xs text-muted-foreground max-w-[520px] pt-2">
            The Anthropic key used by the AI assistant is held in server-side secrets and
            cannot be entered here.
          </p>
        </div>
      ),
    },
  ];

  return (
    <SettingsShell
      sections={sections}
      header={
        <div className="flex items-center gap-3 min-h-[28px]">
          <h1 className="text-xl font-semibold tracking-[-0.015em]">Settings</h1>
          {saved && <span className="text-success text-[13px] flex items-center gap-1 animate-in fade-in"><CheckCircle className="w-3.5 h-3.5" /> Saved</span>}
          {/* The absence of a tick is not a signal — a user reads "nothing happened" as
              "nothing needed to happen". A refused write has to SAY it was refused. */}
          {saveError && (
            <span role="alert" className="text-destructive text-[13px] flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {saveError}
            </span>
          )}
        </div>
      }
    />
  );
}
