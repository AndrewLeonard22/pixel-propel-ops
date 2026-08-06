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
import type { AppSettings, AdSpendRow, AppointmentRow, CallRow } from './types';

export type SourceKey = 'windsor' | 'airtable' | 'callCenter';

export const SOURCE_KEYS: SourceKey[] = ['windsor', 'airtable', 'callCenter'];

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
  // fetchGoogleSheetData reads only settings.googleSheetUrl.
  windsor: {
    label: 'Ad spend (Google Sheet)',
    fields: [{ key: 'googleSheetUrl', label: 'Google Sheet URL' }],
  },
  // fetchAirtableData refuses on !airtableBaseId. The token is no longer a client field
  // at all — it is a server-side secret (order ②), so it cannot be a missing-setting the
  // user is asked to supply, and listing it here would send them to add what they must not.
  airtable: {
    label: 'Appointments (Airtable)',
    fields: [{ key: 'airtableBaseId', label: 'Airtable base ID' }],
  },
  // fetchCallCenterData now THROWS on an unusable URL or a non-OK response, so a dead
  // call centre reaches this as `failed` rather than as an empty success.
  callCenter: {
    label: 'Calls (call-centre sheet)',
    fields: [{ key: 'callCenterSheetUrl', label: 'Call centre sheet URL' }],
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
  if (!settings) return REQUIREMENTS[key].fields.map(f => f.label);
  return REQUIREMENTS[key].fields
    .filter(f => {
      const v = settings[f.key];
      return typeof v !== 'string' || v.trim() === '';
    })
    .map(f => f.label);
}

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
    windsor: initialStatus('windsor', settings),
    airtable: initialStatus('airtable', settings),
    callCenter: initialStatus('callCenter', settings),
  };
}

/** The payloads the three sources produce. */
export interface SourceData {
  adSpend: AdSpendRow[];
  appointments: AppointmentRow[];
  airtableFields: string[];
  callData: CallRow[];
}

export const EMPTY_SOURCE_DATA: SourceData = {
  adSpend: [],
  appointments: [],
  airtableFields: [],
  callData: [],
};

export interface SourceFetchers {
  fetchWindsor: (s: AppSettings) => Promise<AdSpendRow[]>;
  fetchAirtable: (s: AppSettings) => Promise<{ records: AppointmentRow[]; fields: string[] }>;
  fetchCallCenter: (s: AppSettings) => Promise<CallRow[]>;
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
 * ⚠️ KNOWN GAP, NOT MINE TO CLOSE HERE: `fetchCallCenterData` in dataService.ts never
 * throws — it returns [] for a 403, a 404, a network error and an unparseable URL alike.
 * So a call-centre FAILURE still arrives here as an empty success and will read `valid`
 * with zero rows. This function separates NOT-CONFIGURED from empty (which is most of the
 * confusion) but it cannot separate empty-because-broken from genuinely-empty until that
 * fetcher throws. Patch proposed to @anvil, who owns that file. When it throws, this code
 * needs no change.
 */
export async function refreshSources(
  settings: AppSettings,
  fetchers: SourceFetchers,
  previous?: Partial<Record<SourceKey, SourceStatus>>,
  previousData: SourceData = EMPTY_SOURCE_DATA,
  now: Date = new Date(),
): Promise<RefreshResult> {
  const statuses = {} as Record<SourceKey, SourceStatus>;
  const data: SourceData = { ...previousData };

  const configured: Record<SourceKey, boolean> = {
    windsor: isSourceConfigured('windsor', settings),
    airtable: isSourceConfigured('airtable', settings),
    callCenter: isSourceConfigured('callCenter', settings),
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

  const [windsor, airtable, callCenter] = await Promise.allSettled([
    configured.windsor ? fetchers.fetchWindsor(settings) : Promise.resolve(null),
    configured.airtable ? fetchers.fetchAirtable(settings) : Promise.resolve(null),
    configured.callCenter ? fetchers.fetchCallCenter(settings) : Promise.resolve(null),
  ]);

  if (configured.windsor) {
    if (windsor.status === 'fulfilled' && windsor.value) {
      data.adSpend = windsor.value;
      statuses.windsor = settle('windsor', null, previous && previous.windsor, now);
    } else {
      const reason = windsor.status === 'rejected' ? windsor.reason : null;
      statuses.windsor = settle(
        'windsor',
        messageOf(reason, 'Could not load ad spend'),
        previous && previous.windsor,
        now,
      );
    }
  }

  if (configured.airtable) {
    if (airtable.status === 'fulfilled' && airtable.value) {
      data.appointments = airtable.value.records;
      data.airtableFields = airtable.value.fields;
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

  if (configured.callCenter) {
    if (callCenter.status === 'fulfilled' && callCenter.value) {
      data.callData = callCenter.value;
      statuses.callCenter = settle('callCenter', null, previous && previous.callCenter, now);
    } else {
      const reason = callCenter.status === 'rejected' ? callCenter.reason : null;
      statuses.callCenter = settle(
        'callCenter',
        messageOf(reason, 'Could not load calls'),
        previous && previous.callCenter,
        now,
      );
    }
  }

  return { data, statuses };
}
