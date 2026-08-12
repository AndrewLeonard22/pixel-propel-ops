/**
 * PER-SOURCE STATE — Andrew's Phase 3.
 *
 * THE DEFECT THIS EXISTS TO KILL: the app had ONE `loading`, ONE `error` and ONE
 * `configured` boolean for THREE independent sources, and fetched them under
 * `Promise.all`. A single rejection skipped every setState and DISCARDED the payloads
 * that had already arrived. Measured consequence, on the wire, in production on
 * 2026-08-05: an empty `airtableToken` produced ZERO requests to Windsor and ZERO to the
 * call-centre sheet — neither of which needs that token — and no error on screen.
 *
 * The root cause is a TYPE that cannot express "this source failed while that one is
 * fine". While the state cannot be expressed, rendering a confident zero is the only
 * legal move a component has. So the type comes first and the wiring follows it.
 *
 * Everything here is pure and synchronous except `refreshSources`, which is pure in the
 * sense that matters: it takes its fetchers as arguments. That is what makes
 * "one source failing must not take the others down" testable without a DOM.
 */
import type { AppSettings, AdSpendRow, AppointmentRow } from './types';
import { isSupabaseConfigured } from '@/integrations/supabase/client';
import type { SpendWindow } from './metaAdSpend';
import { ALL_DATES } from './metaAdSpend';

export type SourceKey = 'meta' | 'airtable';

export const SOURCE_KEYS: SourceKey[] = ['meta', 'airtable'];

/**
 * Andrew's six states, verbatim from the brief. All six are expressible on purpose,
 * including the one nothing produces yet — a type that cannot say "incomplete" is how
 * we would end up rendering incomplete data as complete.
 */
export type SourceState =
  | 'not-configured' // no connection details supplied for this source
  | 'loading'        // a fetch is in flight
  | 'valid'          // the last fetch succeeded; what is on screen came from it
  | 'stale'          // the last fetch FAILED but an earlier one succeeded — screen shows last-known-good
  | 'incomplete'     // fetched, but the payload failed validation.
                     //   ⛔ NOTHING PRODUCES THIS YET. It is Phase 2's data-quality report
                     //   (@anvil). Renderers handle it now so that wiring it up later is a
                     //   one-line change and not a UI project.
  | 'failed';        // the fetch failed and there is no earlier good data to fall back on

export interface SourceStatus {
  key: SourceKey;
  /** Human label used in any message about this source. */
  label: string;
  state: SourceState;
  /** Whether this source has the settings it needs. Independent of every other source. */
  configured: boolean;
  /**
   * WHICH settings are missing — enumerated, never counted. "2 settings missing" cannot
   * tell a user what to type; ["Google Sheet URL"] can.
   */
  missingSettings: string[];
  /** Why the last attempt failed, in the words the failure itself used. */
  error: string | null;
  /** When this source last returned data successfully. Null until it ever has. */
  lastSuccessAt: Date | null;
}

/** Settings each source genuinely needs, mirrored from what each fetcher actually checks. */
const REQUIREMENTS: Record<SourceKey, { label: string; fields: { key: keyof AppSettings; label: string }[] }> = {
  /**
   * ⭐ AD SPEND NEEDS NO USER SETTING AT ALL — that is the point of the Supabase cutover.
   *
   * It used to require `googleSheetUrl`. `ad_insights` is read with the app's own Supabase
   * connection, and the Meta credentials live in the meta-pull Edge Function, server-side.
   * There is nothing for a user to type, so there is no field to be missing and no
   * "Missing: ..." message that could point at a control that does not exist.
   *
   * ⚠️ AN EMPTY `fields` LIST IS NOT "ALWAYS CONFIGURED" BY ACCIDENT — see
   * `isSourceConfigured`, which keeps a FALSIFIABLE configured axis for this source by
   * asking whether Supabase itself is configured. A source that can never report itself
   * unconfigured is a signal that cannot fail, which is no signal at all.
   */
  meta: {
    label: 'Ad spend',
    fields: [],
  },
  // fetchAirtableData refuses on !airtableBaseId. The token is no longer a client field
  // at all — it is a server-side secret (order ②), so it cannot be a missing-setting the
  // user is asked to supply, and listing it here would send them to add what they must not.
  airtable: {
    label: 'Appointments (Airtable)',
    fields: [{ key: 'airtableBaseId', label: 'Airtable base ID' }],
  },
};

export function sourceLabel(key: SourceKey): string {
  return REQUIREMENTS[key].label;
}

/**
 * Which required settings this source is missing, by their user-facing names.
 * Empty array = configured.
 */
export function missingSettingsFor(key: SourceKey, settings: AppSettings | null | undefined): string[] {
  /**
   * ⚠️ ENUMERATED, NEVER COUNTED — and that rule is exactly why this branch exists. `meta`
   * has no user-facing fields, so without it an unconfigured ad-spend source would render
   * "not configured" followed by an EMPTY list of what to fix: a state with no remedy named.
   * The missing thing is real and it has a name; it just lives in the build's environment
   * rather than in the Settings screen, so that is what it says.
   */
  if (key === 'meta') {
    return isSupabaseConfigured
      ? []
      : ['Supabase connection (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY)'];
  }
  if (!settings) return REQUIREMENTS[key].fields.map(f => f.label);
  return REQUIREMENTS[key].fields
    .filter(f => {
      const v = settings[f.key];
      return typeof v !== 'string' || v.trim() === '';
    })
    .map(f => f.label);
}

/**
 * ⭐ THE CONFIGURED AXIS MUST STAY FALSIFIABLE.
 *
 * `meta` requires no user-supplied settings, so `missingSettingsFor` is always empty for it
 * and a naive implementation would return a constant `true`. A predicate that cannot return
 * false is not a check — the suite's own sabotage harness rejects `always true` as a
 * poison — and the state it would erase is real: with no Supabase connection the fetcher
 * cannot read `ad_insights`, and the honest word for that is `not-configured`, not `failed`.
 */
export function isSourceConfigured(key: SourceKey, settings: AppSettings | null | undefined): boolean {
  return missingSettingsFor(key, settings).length === 0;
}

/**
 * The screen may show numbers from this source.
 * `stale` qualifies: the data is real, just older than we would like, and Andrew's brief
 * asks for the last-known-good snapshot to be RETAINED and LABELLED rather than blanked.
 */
export function hasUsableData(state: SourceState): boolean {
  return state === 'valid' || state === 'stale' || state === 'incomplete';
}

/**
 * A number from this source can be shown WITHOUT a qualifier. Anything else either has no
 * data behind it (render an em dash, never a zero) or has data that needs a caveat next to it.
 */
export function isFullyTrusted(state: SourceState): boolean {
  return state === 'valid';
}

/** Needs to be surfaced to the user. Everything except a clean, current read. */
export function needsAttention(status: SourceStatus): boolean {
  return status.state !== 'valid' && status.state !== 'loading';
}

export function initialStatus(key: SourceKey, settings: AppSettings | null | undefined): SourceStatus {
  const missing = missingSettingsFor(key, settings);
  return {
    key,
    label: sourceLabel(key),
    state: missing.length > 0 ? 'not-configured' : 'loading',
    configured: missing.length === 0,
    missingSettings: missing,
    error: null,
    lastSuccessAt: null,
  };
}

export function initialStatuses(settings: AppSettings | null | undefined): Record<SourceKey, SourceStatus> {
  return {
    meta: initialStatus('meta', settings),
    airtable: initialStatus('airtable', settings),
  };
}

/** The payloads the three sources produce. */
export interface SourceData {
  adSpend: AdSpendRow[];
  appointments: AppointmentRow[];
  airtableFields: string[];
  /**
   * A — appointments whose CLIENT could not be resolved because the Airtable field is a
   * LINKED RECORD and returned a record id. @bird measured 99 of 100 records in that state,
   * so this is not an edge case: it is potentially most of the appointment data, and it
   * must be VISIBLE rather than showing up as appointments quietly going unattributed.
   */
  unresolvedClients: number;
}

export const EMPTY_SOURCE_DATA: SourceData = {
  adSpend: [],
  appointments: [],
  airtableFields: [],
  unresolvedClients: 0,
};

export interface SourceFetchers {
  /**
   * ⭐ TAKES THE DATE WINDOW, so the filter runs IN SQL rather than over 48,000 rows in the
   * browser. The window reaches here from the page's date picker; `ALL_DATES` means the
   * user genuinely asked for everything, and the fetcher pages rather than truncating.
   */
  fetchAdSpend: (s: AppSettings, window: SpendWindow) => Promise<AdSpendRow[]>;
  fetchAirtable: (s: AppSettings) => Promise<{ records: AppointmentRow[]; fields: string[] }>;
}

export interface RefreshResult {
  data: SourceData;
  statuses: Record<SourceKey, SourceStatus>;
}

/**
 * Build one source's resting status.
 *
 * `error === null` means the fetch succeeded. A discriminated union would read better but
 * this project compiles with `strict: false` / `strictNullChecks: false`, under which TS
 * does not narrow a boolean-literal discriminant — so the shape that survives the actual
 * compiler wins over the shape that reads best in a strict project.
 */
function settle(
  key: SourceKey,
  error: string | null,
  previous: SourceStatus | undefined,
  now: Date,
): SourceStatus {
  const base = {
    key,
    label: sourceLabel(key),
    configured: true,
    missingSettings: [] as string[],
  };
  if (error === null) {
    return { ...base, state: 'valid', error: null, lastSuccessAt: now };
  }
  // A failure does not erase the fact that this source once worked, and it does not erase
  // the data already on screen. "stale" is the honest word for last-known-good.
  const hadGoodData = previous && previous.lastSuccessAt != null;
  return {
    ...base,
    state: hadGoodData ? 'stale' : 'failed',
    error,
    lastSuccessAt: (previous && previous.lastSuccessAt) || null,
  };
}

function messageOf(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  return fallback;
}

/**
 * Fetch every configured source INDEPENDENTLY and report each one's own outcome.
 *
 * CONTRACT
 *  - Sources that are not configured are never fetched and are reported `not-configured`.
 *    They do not block, fail, or degrade any other source.
 *  - Every configured source is attempted. `Promise.allSettled`, never `Promise.all`:
 *    one rejection cannot discard another source's payload.
 *  - A source that fails KEEPS its previous data (`previous`), so a failed refresh never
 *    blanks a screen that was working. Its state becomes `stale` if it had ever succeeded,
 *    `failed` if it never had.
 *  - Returns on failure: the previous data plus a status carrying the failure's own
 *    message. It does not throw, and it never reports an empty array as a success for a
 *    source it did not fetch.
 *
 */
export async function refreshSources(
  settings: AppSettings,
  fetchers: SourceFetchers,
  previous?: Partial<Record<SourceKey, SourceStatus>>,
  previousData: SourceData = EMPTY_SOURCE_DATA,
  now: Date = new Date(),
  window: SpendWindow = ALL_DATES,
): Promise<RefreshResult> {
  const statuses = {} as Record<SourceKey, SourceStatus>;
  const data: SourceData = { ...previousData };

  const configured: Record<SourceKey, boolean> = {
    meta: isSourceConfigured('meta', settings),
    airtable: isSourceConfigured('airtable', settings),
  };

  for (const key of SOURCE_KEYS) {
    if (!configured[key]) {
      statuses[key] = {
        key,
        label: sourceLabel(key),
        state: 'not-configured',
        configured: false,
        missingSettings: missingSettingsFor(key, settings),
        error: null,
        lastSuccessAt: previous?.[key]?.lastSuccessAt ?? null,
      };
    }
  }

  const [meta, airtable] = await Promise.allSettled([
    configured.meta ? fetchers.fetchAdSpend(settings, window) : Promise.resolve(null),
    configured.airtable ? fetchers.fetchAirtable(settings) : Promise.resolve(null),
  ]);

  if (configured.meta) {
    if (meta.status === 'fulfilled' && meta.value) {
      data.adSpend = meta.value;
      statuses.meta = settle('meta', null, previous && previous.meta, now);
    } else {
      const reason = meta.status === 'rejected' ? meta.reason : null;
      statuses.meta = settle(
        'meta',
        messageOf(reason, 'Could not load ad spend'),
        previous && previous.meta,
        now,
      );
    }
  }

  if (configured.airtable) {
    if (airtable.status === 'fulfilled' && airtable.value) {
      data.appointments = airtable.value.records;
      data.airtableFields = airtable.value.fields;
      data.unresolvedClients = airtable.value.unresolvedLinks ?? 0;
      statuses.airtable = settle('airtable', null, previous && previous.airtable, now);
    } else {
      const reason = airtable.status === 'rejected' ? airtable.reason : null;
      statuses.airtable = settle(
        'airtable',
        messageOf(reason, 'Could not load appointments'),
        previous && previous.airtable,
        now,
      );
    }
  }

  return { data, statuses };
}
