import { supabase, isSupabaseConfigured } from '@/integrations/supabase/client';
import type { AppSettings, AccountMapping } from './types';

const SETTINGS_KEY = 'socialworks_settings';
const ACCOUNT_MAPPINGS_KEY = 'accountMappings';

const DEFAULT_SETTINGS: AppSettings = {
  googleSheetUrl: '',
  googleSheetTab: 'Ads Data',
  // @fable measured both tabs on @andrew's live sheet by these exact names:
  // 'Ads Data' (derived) and 'Ads - Raw' (source), 38,997 rows each, differing sigs.
  adsRawTabName: 'Ads - Raw',
  callCenterSheetUrl: '',
  callCenterSheetTab: 'RAW DATA',
  airtableBaseId: '',
  airtableTableName: 'Appointments',
  columnMappings: {
    'Client Name': 'Client Name',
    'Campaign Name': 'Campaign Name',
    'Campaign ID': 'Campaign ID',
    'Ad Set Name': 'Ad Set Name',
    'Ad Set ID': 'Ad Set ID',
    'Ad Name': 'Ad Name',
    'Ad ID': 'Ad ID',
    'Appointment Date': 'Appointment Date',
    'Show Status': 'Show Status',
    'Lead Valid': 'Lead Valid',
    'Closed Revenue': 'Closed Revenue ($)',
    'Amount Charged': 'Amount Charged',
    'Project Value': 'Project Value',
    'Setter': 'Setter',
    'Lead Status': 'Lead Status',
    'Lead Quality': 'Lead Quality',
    'DQ Reason': 'DQ Reason',
    'Date Added': 'Date Added',
    'Billed': 'Billed?',
    'Client PPA Rate': 'Client PPA Rate',
    'Client Billing Model': 'Client Billing Model',
  },
  showPausedAccounts: true,
  showChurnedAccounts: true,
  pausedThresholdDays: 1,
  accountAliases: [],
  perfThresholds: {
    goodCpl: 25,
    goodLeadPercent: 5,
    poorCpl: 50,
    poorLeadPercent: 2,
  },
  excludedCampaigns: [],
  setterBonusRates: [],
  inactiveSetters: [],
};

// --- localStorage helpers (fallback/cache) ---

function loadSettingsFromLocal(): AppSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    const parsedSettings = stored ? JSON.parse(stored) : {};
    
    // Always prefer the dedicated accountMappings key — it's what Settings.tsx writes to
    const mappingsStored = localStorage.getItem(ACCOUNT_MAPPINGS_KEY);
    const aliasStored = localStorage.getItem('accountAliases');
    const parsedMappings = mappingsStored 
      ? JSON.parse(mappingsStored) 
      : aliasStored 
        ? JSON.parse(aliasStored) 
        : parsedSettings.accountAliases;

    // sanitizeSettings on the way IN: a browser that stored settings before this
    // change still has the tokens in localStorage. Without this they are read
    // back into memory and written out again on the next save.
    return sanitizeSettings({
      ...DEFAULT_SETTINGS,
      ...parsedSettings,
      accountAliases: Array.isArray(parsedMappings) ? parsedMappings : DEFAULT_SETTINGS.accountAliases,
    });
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettingsToLocal(settings: AppSettings): void {
  // sanitizeSettings on the way OUT: localStorage is plaintext and readable by
  // every script on the page, including any the host injects.
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(sanitizeSettings(settings)));
  localStorage.setItem('accountAliases', JSON.stringify(settings.accountAliases || []));
}

function loadAccountMappingsFromLocal(): any[] {
  try {
    const stored = localStorage.getItem(ACCOUNT_MAPPINGS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveAccountMappingsToLocal(mappings: any[]): void {
  localStorage.setItem(ACCOUNT_MAPPINGS_KEY, JSON.stringify(mappings));
}

// --- Database helpers ---

async function upsertSetting(key: string, value: any): Promise<void> {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) console.warn('Failed to save setting to DB:', error.message);
}

/**
 * WHY A FAILED READ IS NOT AN ABSENT VALUE — @bird measured the cost of conflating them.
 *
 * The old `fetchSetting` returned `null` for BOTH "the database says there is no such row"
 * and "we could not reach the database at all", and logged the difference to `console.warn`
 * — a surface no customer opens. Downstream, `loadSettingsAsync` fell back to an empty local
 * copy, `configured` computed FALSE, and every page rendered
 *
 *     "Configure your data sources — connect your Google Sheet and Airtable in Settings"
 *
 * ⭐ THAT SENTENCE NAMES THE WRONG PARTY. On 2026-08-05 the deployed build had no
 * VITE_SUPABASE_URL, so the client pointed at `unconfigured.invalid` and every read died
 * with ERR_NAME_NOT_RESOLVED. The app booted, looked healthy, and told @andrew HIS setup was
 * incomplete. @bird drove it: "a booted empty page reads as «@andrew's config is wrong»
 * rather than «our build has no database URL»", and it cost twenty minutes of misdiagnosis
 * pointed at the wrong system.
 *
 * ⛔ BOOTS ≠ WORKS. This is the mission sentence exactly: the software must not lie about
 * its consequences. A read that never happened must not be reported as an answer.
 */
/**
 * ⚠️ THE DISCRIMINANT IS A STRING, AND THAT IS NOT A STYLE CHOICE — MEASURED.
 * This repo sets `strictNullChecks: false` (tsconfig.json:13, tsconfig.app.json:25), and
 * under that flag TypeScript DOES NOT NARROW a union on a boolean-literal discriminant:
 * `if (!r.ok)` leaves `r` as the full union and every field access is an error. A string
 * discriminant narrows correctly under the same flag. Both were compiled side by side
 * before this was written, because the first version of it did not build.
 */
export type ReadOutcome<T> =
  /** The database answered. `value` may legitimately be null — that is a REAL absence. */
  | { status: 'answered'; value: T | null }
  /** This BUILD has no usable Supabase URL. Nothing was sent. Our fault, not the user's. */
  | { status: 'not-configured' }
  /** A request went out and failed — DNS, network, auth, RLS. We do not know the value. */
  | { status: 'unreachable'; detail: string };

async function fetchSettingChecked<T>(key: string): Promise<ReadOutcome<T>> {
  // Asked BEFORE the call: with no URL the SDK still resolves, so an unconfigured build is
  // otherwise indistinguishable from a network blip, and the two need different copy.
  if (!isSupabaseConfigured) return { status: 'not-configured' };

  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (error) return { status: 'unreachable', detail: error.message };
    return { status: 'answered', value: (data?.value ?? null) as T | null };
  } catch (e) {
    // supabase-js resolves network failures into `error` rather than rejecting, but a
    // THROW here would otherwise escape as an unhandled rejection and read as a hang.
    return { status: 'unreachable', detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The lossy form, kept for the WRITE paths that only ask "what is there now".
 *
 * ⚠️ IT IS STILL LOSSY, DELIBERATELY AND VISIBLY. `saveSettings` and `saveAccountMappings`
 * call this to read the current row before running the clobber guards, so an UNREACHABLE
 * read reaches those guards as "there is nothing there" and they find nothing to protect.
 * That is a SECOND defect of the same swallow, in the never-clobber lane, and it is NOT
 * fixed here — widening this change into the write paths during a freeze is how a scoped
 * fix turns into an unreviewed one. Reported rather than quietly bundled.
 */
async function fetchSetting<T>(key: string): Promise<T | null> {
  const r = await fetchSettingChecked<T>(key);
  if (r.status !== 'answered') {
    console.warn(`Failed to read setting "${key}" from DB:`, r.status === 'unreachable' ? r.detail : r.status);
    return null;
  }
  return r.value;
}

// --- Public API ---

/** Synchronous load from localStorage (used for initial render) */
export function loadSettings(): AppSettings {
  return loadSettingsFromLocal();
}

/**
 * WHERE THE SETTINGS ON SCREEN ACTUALLY CAME FROM.
 *
 *   'database'        the row was read and used. The only trustworthy state.
 *   'local-no-row'    the database ANSWERED and held no usable settings. ⭐ The ONLY state
 *                     in which "configure your data sources" is a true sentence.
 *   'local-unreachable'  a request went out and failed. We do not know what is configured.
 *   'local-not-configured'  this BUILD has no Supabase URL. Nothing was ever sent.
 *
 * ⚠️ THE LAST TWO ARE NOT CLAIMS ABOUT THE USER'S SETUP, and the whole point of separating
 * them is that the UI must stop making one. See fetchSettingChecked for what this cost.
 */
export type SettingsOrigin =
  | 'database'
  | 'local-no-row'
  | 'local-unreachable'
  | 'local-not-configured';

export interface SettingsLoad {
  settings: AppSettings;
  origin: SettingsOrigin;
  /** The underlying error text when origin is 'local-unreachable'. Never invented. */
  detail: string | null;
}

/** True when the settings on screen are a local guess rather than a database answer. */
export function settingsAreUnverified(origin: SettingsOrigin): boolean {
  return origin === 'local-unreachable' || origin === 'local-not-configured';
}

/** Async load: tries DB first, falls back to localStorage, caches result */
export async function loadSettingsAsync(): Promise<AppSettings> {
  return (await loadSettingsWithSource()).settings;
}

export async function loadSettingsWithSource(): Promise<SettingsLoad> {
  const local = (origin: SettingsOrigin, detail: string | null = null): SettingsLoad => ({
    settings: loadSettingsFromLocal(),
    origin,
    detail,
  });

  try {
    const [rSettings, rMappings] = await Promise.all([
      fetchSettingChecked<AppSettings>('app_settings'),
      fetchSettingChecked<any[]>('account_mappings'),
    ]);

    // ⭐ THE READ IS ANSWERED BEFORE THE VALUE IS INSPECTED. Asking "is this row usable"
    // of a read that never happened is the conflation this whole change exists to remove.
    // app_settings decides: it is the row `configured` is derived from.
    if (rSettings.status !== 'answered') {
      return rSettings.status === 'not-configured'
        ? local('local-not-configured')
        : local('local-unreachable', rSettings.detail);
    }

    const dbSettings = rSettings.value;
    const dbMappings = rMappings.status === 'answered' ? rMappings.value : null;

    // ⚠️ `!== undefined` accepts an EMPTY STRING, so a wiped row passes this gate
    // as authoritative and is then written over every browser's local copy by
    // saveSettingsToLocal below. That is how the 2026-08-05 config wipe erased
    // the last-known-good copy on each machine that opened the app afterwards.
    // NOT CHANGED HERE: making this a validity test rather than a presence test
    // is order item ①b / ⑥ and belongs to the lane that owns source state.
    if (dbSettings && typeof dbSettings === 'object' && dbSettings.googleSheetUrl !== undefined) {
      const merged = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        ...dbSettings,
        // Always use the latest default column mappings merged with any user customizations
        // This prevents stale column mappings from persisting in the DB
        columnMappings: {
          ...DEFAULT_SETTINGS.columnMappings,
          ...(dbSettings.columnMappings || {}),
        },
      });
      if (Array.isArray(dbMappings) && dbMappings.length > 0) {
        merged.accountAliases = dbMappings;
      }
      saveSettingsToLocal(merged);
      if (Array.isArray(dbMappings) && dbMappings.length > 0) {
        saveAccountMappingsToLocal(dbMappings);
      }
      return { settings: merged, origin: 'database', detail: null };
    }

    // The database answered and had nothing usable. This IS the user's setup, and it is
    // the one branch where the existing "configure your data sources" copy tells the truth.
    return local('local-no-row');
  } catch (e) {
    // Anything unexpected above (a throwing sanitize, a storage failure) is still a state
    // in which we cannot vouch for what is on screen — never a silent success.
    return local('local-unreachable', e instanceof Error ? e.message : String(e));
  }
}

/** Save to both DB and localStorage */
/**
 * Fields whose loss is DESTRUCTIVE rather than an ordinary edit. Enumerated deliberately:
 * these are the connection settings and the curated lists that no refresh can rebuild.
 */
const PROTECTED_SCALARS = ['googleSheetUrl', 'callCenterSheetUrl', 'airtableBaseId'] as const;
const PROTECTED_LISTS = [
  'excludedCampaigns',
  'setterBonusRates',
  'inactiveSetters',
  'accountAliases',
] as const;

export interface ClobberReport {
  blankedScalars: string[];
  emptiedLists: string[];
}

/**
 * Would writing `next` over `current` DESTROY curated configuration?
 *
 * saveSettings is a FULL-OBJECT REPLACE of a row shared by every browser. If component
 * state is stale — and it is, for the window between the synchronous localStorage read
 * and the asynchronous DB read — a single click writes DEFAULT_SETTINGS over the row and
 * every field it lacked is gone. That is not hypothetical: it happened at
 * 2026-08-05T22:18:48Z and destroyed 32 excluded campaigns, 6 setters and 4 inactive
 * setters, with no error and no warning.
 *
 * ⚠️ WHY A THRESHOLD AND NOT "REFUSE ANY BLANKING": clearing ONE field is a legitimate
 * edit a user may intend. Blanking SEVERAL AT ONCE is the signature of a whole-object
 * clobber, because a person does not empty three unrelated settings in a single save.
 * The threshold is the discriminator between an edit and an accident.
 */
export function detectClobber(current: AppSettings | null, next: AppSettings): ClobberReport {
  const blankedScalars: string[] = [];
  const emptiedLists: string[] = [];
  if (!current) return { blankedScalars, emptiedLists };

  for (const k of PROTECTED_SCALARS) {
    if (String(current[k] ?? '').trim() && !String(next[k] ?? '').trim()) blankedScalars.push(k);
  }
  for (const k of PROTECTED_LISTS) {
    const before = current[k];
    const after = next[k];
    if (Array.isArray(before) && before.length > 0 && Array.isArray(after) && after.length === 0) {
      emptiedLists.push(k);
    }
  }
  return { blankedScalars, emptiedLists };
}

export function isClobber(r: ClobberReport): boolean {
  return r.blankedScalars.length + r.emptiedLists.length >= 2;
}

/**
 * Save to both sinks — REFUSING a write that would wholesale-destroy curated config.
 *
 * The database has a trigger for this (order ②) but it is NOT YET APPLIED, so today this
 * client-side guard is the only thing standing between a stale render and the row.
 */
export async function saveSettings(settings: AppSettings): Promise<void> {
  // @anvil's clobber guard (order ①) and the credential sanitiser (order ②) are
  // DIFFERENT CHECKS and both belong here — they were written independently and the
  // rebase put them on the same lines. One asks "would this write DESTROY config?",
  // the other asks "does this write carry something we must never STORE?". A write can
  // fail either test alone.
  const current = await fetchSetting<AppSettings>('app_settings');
  const report = detectClobber(current, settings);
  if (isClobber(report)) {
    const lost = [...report.blankedScalars, ...report.emptiedLists].join(', ');
    throw new Error(
      `Refusing to save: this would erase configuration that is currently set (${lost}). ` +
        'This usually means the page saved before it finished loading. Reload and try again.',
    );
  }

  // Sanitised at BOTH sinks, not once before the call.
  // Stripping once and passing the clean object to both would be tidier and
  // would silently stop protecting whichever sink someone adds next.
  saveSettingsToLocal(settings);
  await upsertSetting('app_settings', sanitizeSettings(settings));
}

/** Synchronous load account mappings from localStorage */
export function loadAccountMappings(): AccountMapping[] {
  return loadAccountMappingsFromLocal() as AccountMapping[];
}

/** Look up program and status for a given account name */
export function getAccountMapping(accountName: string, mappings: AccountMapping[]): { program: string; status: string } {
  const match = mappings.find(m => m.sheetName.trim().toLowerCase() === accountName.trim().toLowerCase());
  return {
    program: match?.program || 'Done For You',
    status: match?.status || 'Active',
  };
}

/** Async load account mappings: DB first, localStorage fallback */
export async function loadAccountMappingsAsync(): Promise<any[]> {
  try {
    const dbMappings = await fetchSetting<any[]>('account_mappings');
    if (Array.isArray(dbMappings) && dbMappings.length > 0) {
      saveAccountMappingsToLocal(dbMappings);
      return dbMappings;
    }
  } catch {
    // fall through
  }
  return loadAccountMappingsFromLocal();
}

/**
 * Would writing `next` erase a populated mapping list outright?
 *
 * ⚠️ THIS ROW NEEDS ITS OWN GUARD, AND THE REASON IS NOT OBVIOUS: Settings.tsx:105 calls
 * saveSettings and saveAccountMappings inside a single `Promise.all`. A rejecting sibling
 * DOES NOT CANCEL the other call — measured, not assumed — so saveSettings refusing a
 * clobber leaves this write running to completion against a different row.
 *
 * ⭐ WHY THERE IS NO THRESHOLD HERE, unlike isClobber: emptying this list is not reachable
 * by intent. Census of every setAccountMappings call site at fa43996 — Settings.tsx:34
 * (localStorage init), :42 (DB load, itself gated on `length > 0`), :60 (an effect whose
 * own comment says "only ADD new accounts — never overwrite"), :189 (edits ONE field of
 * ONE mapping). None can produce an empty array from a populated one. So a populated→empty
 * transition has no legitimate producer, and refusing it costs no real edit.
 *
 * The transition that DOES produce it: `accountMappings` initialises from localStorage,
 * which on a cold browser is empty, while the DB holds the curated list. If `form` changes
 * before :42 lands, the debounced autosave fires performSave(form, []) and this row is
 * replaced with nothing.
 */
export function wouldEraseAllMappings(current: unknown, next: unknown): boolean {
  const had = Array.isArray(current) && current.length > 0;
  const willHave = Array.isArray(next) && next.length > 0;
  return had && !willHave;
}

/** Save account mappings to both DB and localStorage */
export async function saveAccountMappings(mappings: any[]): Promise<void> {
  const current = await fetchSetting<unknown[]>('account_mappings');
  if (wouldEraseAllMappings(current, mappings)) {
    const lostCount = Array.isArray(current) ? current.length : 0;
    throw new Error(
      `Refusing to save: this would erase all ${lostCount} account mappings. ` +
        'This usually means the page saved before it finished loading. Reload and try again.',
    );
  }

  // Local is written only AFTER the refusal check — writing it first would destroy the
  // cached copy that is the fallback for the very failure this guard exists to survive.
  saveAccountMappingsToLocal(mappings);
  await upsertSetting('account_mappings', mappings);
}

/** The three independent data sources the tracker reads. */
export type DataSource = 'googleSheet' | 'airtable' | 'callCenter';

export const DATA_SOURCES: DataSource[] = ['googleSheet', 'airtable', 'callCenter'];

/**
 * Is ONE source configured? Each source depends only on its OWN fields.
 *
 * This is the seam that lets a missing Airtable token stop Airtable WITHOUT stopping
 * the Windsor spend feed. `isConfigured` below still requires all three, on purpose —
 * see the warning there before changing it.
 */
export function isSourceConfigured(settings: AppSettings, source: DataSource): boolean {
  switch (source) {
    case 'googleSheet':
      return !!settings.googleSheetUrl;
    case 'airtable':
      // ⚠️ @raccoon wrote this as `airtableBaseId && airtableToken`. The token is GONE
      // from AppSettings — credentials are server-side now (order item ②), so the client
      // cannot answer "do we hold a token" and MUST NOT: that question is what put a live
      // PAT in a world-readable row. What the client CAN answer is "is Airtable pointed
      // at a base", and whether the credential works is the proxy's answer, surfaced as a
      // FETCH failure rather than a config state. Same seam, one fewer operand.
      return !!settings.airtableBaseId;
    case 'callCenter':
      return !!settings.callCenterSheetUrl;
  }
}

/** Which sources can be fetched with the config we actually have. */
export function configuredSources(settings: AppSettings): DataSource[] {
  return DATA_SOURCES.filter(s => isSourceConfigured(settings, s));
}

/**
 * ⚠️ REQUIRES ALL THREE SOURCES, ACROSS TWO UNRELATED VENDORS.
 *
 * This is why production renders "Configure your data sources" with ZERO requests and
 * NO error: `useData.tsx:63` returns early and silently when this is false, so a missing
 * Airtable credential suppresses the Google Sheets spend feed as well.
 *
 * 🔴 DO NOT relax this to `configuredSources(settings).length > 0` ON ITS OWN.
 * `refresh()` fetches all three inside a single `Promise.all`, and `fetchAirtableData`
 * THROWS 'Airtable not configured' when the token is absent. Relaxing the gate alone
 * turns a blank page into a red error banner with still-zero data, because Promise.all
 * discards the Google Sheets rows that WERE fetchable.
 *
 * True when AT LEAST ONE source can be fetched.
 *
 * ⚠️ Read the warning on `isConfigured` below before wiring this into `refresh()`:
 * relaxing the GATE without also making the FETCH per-source turns a blank page into an
 * error banner with still-zero data, because `Promise.all` discards the rows that WERE
 * fetchable. Gate and fetch must change together.
 */
export function anySourceConfigured(settings: AppSettings): boolean {
  return configuredSources(settings).length > 0;
}

/**
 * ⚠️ REQUIRES ALL THREE SOURCES, ACROSS TWO UNRELATED VENDORS.
 *
 * This is why production renders "Configure your data sources" with ZERO requests and
 * NO error: `useData.tsx:63` returns early and silently when this is false, so a missing
 * Airtable credential suppresses the Google Sheets spend feed as well.
 *
 * 🔴 DO NOT relax this to `configuredSources(settings).length > 0` ON ITS OWN.
 * `refresh()` fetches all three inside a single `Promise.all`, and `fetchAirtableData`
 * THROWS 'Airtable not configured' when the token is absent. Relaxing the gate alone
 * turns a blank page into a red error banner with still-zero data, because Promise.all
 * discards the Google Sheets rows that WERE fetchable.
 *
 * The gate and the fetch must be made per-source in the SAME change. Use
 * `isSourceConfigured` / `configuredSources` above to do it.
 */
export function isConfigured(settings: AppSettings): boolean {
  // ⚠️ `settings.airtableToken` was a third operand here. It is GONE from
  // AppSettings (credentials are server-side now), so it had to come out — this
  // is a change my removal FORCED, not a redesign of the gate.
  //
  // ⛔ THE GATE IS STILL WRONG AND FIXING IT IS NOT THIS CHANGE'S JOB.
  // It remains a SINGLE GLOBAL flag over THREE INDEPENDENT SOURCES: Windsor and
  // the call-centre sheet still cannot load unless `airtableBaseId` is set, and
  // neither of them uses Airtable at all. A missing Airtable config should
  // disable the Airtable panel, not the whole dashboard. Per-source state is
  // @dash's lane (order item ⑥) and the split is order item ①b.
  return !!(settings.googleSheetUrl && settings.airtableBaseId);
}

/**
 * Remove any credential-shaped field before a settings object is persisted or
 * adopted from the database.
 *
 * Defence in depth alongside the DB trigger `app_settings_reject_unsafe`: the
 * trigger stops a write reaching the table, this stops the client holding the
 * value at all. It also makes a LEGACY row safe — a row written before this
 * change still carries the two keys, and without this they would be read back
 * into memory and re-saved.
 *
 * Contract: returns a copy with the credential keys absent. Never throws.
 * Adding a credential to AppSettings in future must add its key here.
 */
/**
 * Every key the application is permitted to persist.
 *
 * ⭐ THIS IS AN ALLOWLIST AND THE INVERSION IS THE POINT. The first version of
 * this guard held a list of FORBIDDEN keys — a hand-maintained registry, where a
 * new `metaAccessToken` or `ghlToken` walks straight through because the safe
 * behaviour required somebody to remember to register it.
 *
 * A NEW FIELD MUST FAIL UNTIL IT IS DECLARED, NOT PASS UNTIL SOMEONE REMEMBERS.
 *
 * Kept deliberately in step with `allowed_config_keys` in
 * supabase/migrations/20260806000000_lock_down_app_settings.sql. The database is
 * the authority — this is the client half, so a bad write fails early and
 * visibly rather than as a 400 from PostgREST.
 */
export const ALLOWED_CONFIG_KEYS = [
  'googleSheetUrl', 'googleSheetTab',
  // The RAW tab, for the truncation detector (@anvil, item ① — the ~2026-08-12 capacity
  // cliff). It is a TAB NAME, not a credential: declared here because a key absent from
  // this list is STRIPPED ON EVERY SAVE and would never persist — the detector would
  // silently fall back to a hardcoded name and stop describing the sheet Andrew edits.
  'adsRawTabName',
  'callCenterSheetUrl', 'callCenterSheetTab',
  'airtableBaseId', 'airtableTableName',
  // ⛔⛔ OWNER-ORDERED EXCEPTION, 2026-08-05. Andrew, verbatim: «JUST PUT THE ACCESS TOKEN
  // BACK IN PIXEL, YOU FUCKING REMOVED IT SO NOW I CANT SEE MY AIRTABLE DATA».
  //
  // Relocating this token server-side was CORRECT security and it SHIPPED WITHOUT ITS OTHER
  // HALF: the airtable-proxy Edge Function was never deployed, so appointments went dark.
  // @apprentice predicted this exact outcome in APPR-020 — "relocating the secrets
  // server-side BLANKS THE ENTIRE DASHBOARD" — and we shipped it anyway. A half-migrated
  // credential is worse than either end state, and the owner is the one who paid for it.
  //
  // ⚠️ THE COST, STATED AND NOT HIDDEN: `app_settings` is readable by the anon role, so a
  // token stored here is readable by anyone on the internet. This key is knowingly
  // re-admitted to restore a working product, NOT because the exposure stopped being real.
  //
  // REMOVE THIS LINE the moment airtable-proxy is deployed and verified — the direct path in
  // fetchAirtableData is already a FALLBACK, so deleting this entry is the whole rollback.
  // The token in use while this line exists must be treated as compromised and rotated.
  'airtableToken',
  'columnMappings', 'accountAliases', 'perfThresholds',
  'excludedCampaigns', 'setterBonusRates',
  'activeSetters', 'inactiveSetters',
  'showPausedAccounts', 'showChurnedAccounts', 'pausedThresholdDays',
] as const;

/**
 * Keep only declared configuration keys.
 *
 * ⚠️ POPULATION, STATED RATHER THAN IMPLIED: this filters TOP-LEVEL KEYS with
 * EXACT CASE. It does NOT inspect nested objects — a credential hidden at
 * `columnMappings.token` passes this function. That case is covered in the
 * database by a credential-SHAPE check over the whole serialised value, which
 * sees nesting and casing because it matches the shape of the secret rather
 * than the name of its key. Neither check covers the other.
 *
 * Contract: returns a copy containing only allowed keys. Never throws.
 */
export function sanitizeSettings<T>(settings: T): T {
  if (!settings || typeof settings !== 'object') return settings;
  const allowed = new Set<string>(ALLOWED_CONFIG_KEYS as readonly string[]);
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings as Record<string, unknown>)) {
    if (allowed.has(key)) clean[key] = value;
  }
  return clean as T;
}

export function convertSheetUrlToCsv(url: string, tab?: string): string {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) return '';
  const spreadsheetId = match[1];
  const gidMatch = url.match(/gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : '0';
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
}

export { DEFAULT_SETTINGS };
