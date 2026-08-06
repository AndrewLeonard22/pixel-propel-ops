import { supabase } from '@/integrations/supabase/client';
import type { AppSettings, AdSpendRow, AppointmentRow, AccountSummary, CampaignSummary, AdSetSummary, AdSummary, TeamMember, PerformanceLevel, CallRow } from './types';
import { convertSheetUrlToCsv, isSourceConfigured } from './config';
import { resolveRecordId, resolveLinkedClientNames } from './airtableLinks';

// Parse CSV text into rows
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  
  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = (values[idx] || '').trim();
    });
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function parseNumber(val: string | undefined): number {
  if (!val) return 0;
  const cleaned = val.replace(/[$,\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Normalise a source date string to ISO `YYYY-MM-DD`. Returns '' when it cannot be
 * interpreted — an honest refusal, never a guess and never today's date.
 *
 * ACCEPTS, because all three are present in real exports of this feed:
 *   M/D/YYYY        the derived tab's rendered format
 *   YYYY-MM-DD      the raw Windsor tab's format
 *   a bare integer  a Google Sheets serial, emitted when a cell lost its date format.
 *                   Four such rows exist in the live feed. `new Date("45884")` reads that
 *                   as the YEAR 45884, so the naive parse produces a valid far-future date
 *                   and nothing downstream errors — it is a successful parse of the wrong
 *                   thing, which is why this is decoded explicitly against the Sheets epoch.
 *
 * REFUSES: anything else, including the empty string.
 */
export function normalizeSourceDate(raw: string | undefined | null): string {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (!s) return '';

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return isRealDate(+iso[1], +iso[2], +iso[3]) ? s : '';

  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const [, m, d, y] = mdy;
    return isRealDate(+y, +m, +d) ? `${y}-${pad2(+m)}-${pad2(+d)}` : '';
  }

  // Google Sheets serial: whole days since 1899-12-30. Bounded to a plausible era so a
  // stray identifier cannot be silently reinterpreted as a date.
  if (/^\d{1,6}$/.test(s)) {
    const serial = Number(s);
    if (serial >= 36526 && serial <= 73050) {          // 2000-01-01 .. 2099-12-31
      const ms = Date.UTC(1899, 11, 30) + serial * 86400000;
      const dt = new Date(ms);
      return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
    }
    return '';
  }

  return '';
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// resolveAccountName removed — matching now uses settings.accountAliases directly

/**
 * 🔴 A SHEET THAT ANSWERS WITH THE WRONG TAB IS A SUCCESSFUL FETCH THAT FABRICATES ZEROS.
 *
 * @apprentice measured this from the server side at ~22:00: an INVALID `sheet=` name
 * returns HTTP 200 CARRYING THE DEFAULT TAB'S SCHEMA. @fable measured the same mechanism by
 * content — `sheet=RAW DATA` and `sheet=Ads Data` return BYTE-IDENTICAL bodies. His words,
 * and they are the whole design of this function:
 *
 *   "ASSERT THE HEADER SET, NOT THE ROW COUNT. A fallback tab has the wrong headers and
 *    the right shape — every count-based check passes on it."
 *
 * ⭐ AND THE REASON IT IS BYTE-IDENTICAL IS IN OUR CODE, NOT GOOGLE'S: config.ts:609
 * `convertSheetUrlToCsv(url, tab)` ACCEPTS `tab` AND NEVER READS IT, falling back to
 * `gid=0` — the FIRST tab — whenever the URL carries no gid. The configured tab name has
 * never selected anything. That dead control is filed separately (CallCenter.tsx:698);
 * this function's job is to make its consequence LOUD instead of silent.
 *
 * ⚠️ WHY ONE COLUMN AND NOT THE WHOLE SET. The predicate must be the column whose absence
 * SILENTLY PRODUCES A ZERO, because that is the failure being prevented — not a schema
 * checksum, which would throw on a legitimately renamed spare column and teach everyone to
 * delete this check. For calls that column is `ghl_location_name`: without it every row
 * keys to '' , the dial map skips it, and the app reports 0 DIALS FROM A HEALTHY SOURCE.
 *
 * An EMPTY sheet is exempt on purpose: with no rows there are no fabricated numbers, and a
 * genuinely empty tab is a legitimate state this must not turn into an error.
 */
/**
 * ② THE COLUMN CONTRACT — item ②, and it is the half `assertSheetSchema` does NOT cover.
 *
 * @fable: "a misconfigured source CANNOT FAIL LOUDLY TODAY. It returns confident, complete,
 * WRONG data — one settings typo away at all times."
 *
 * ⭐ MY EXISTING GUARD COVERS THE *TAB* HALF AND MISSES THE *COLUMN* HALF, AND I SAID SO IN
 * ITS OWN DOCBLOCK WITHOUT NOTICING THE GAP. It asserts ONE column — enough to catch a
 * wrong tab, where ALL columns vanish at once. It is blind to DRIFT: if Windsor renames
 * `Spent` to `Amount Spent`, `Account Name` still resolves, the guard stays silent,
 * parseNumber('') returns 0, and EVERY SPEND TOTAL SILENTLY BECOMES ZERO.
 *
 * ⚠️ TWO TIERS, BECAUSE THEY FAIL DIFFERENTLY AND MUST BE TREATED DIFFERENTLY:
 *   CRITICAL  absence produces a WRONG NUMBER that renders confidently ⇒ THROW.
 *             A dead source is honest; a source reporting £0 spend is not.
 *   LABEL     absence loses a NAME, not a number ⇒ REPORT, never throw. Throwing here
 *             would take the dashboard down over a missing `Ad Name`, and a check that
 *             costs more than the defect is a check people delete.
 *
 * ⭐ THE ALTERNATES ARE NOT STYLE — THEY ARE READ OFF THE MAPPER. `campaignId` accepts
 * 'Campaign Id' OR 'Campaign ID'; a contract that demanded one spelling would throw on a
 * sheet that works today. Retyping the list from memory is how a guard starts disagreeing
 * with the code it guards, so every entry below mirrors a line in the map above it.
 */
/**
 * ③ CASE-FOLDED LOOKUP, AND IT HAD TO BE FIXED ON **BOTH** SIDES OR NOT AT ALL.
 *
 * @raccoon: "a capitalisation change from Windsor kills the dashboard on a sheet whose data
 * is intact." I measured it before agreeing, and the sheet is NOT intact:
 *
 *     r['Spent'] on { spent: '500' }  ->  undefined  ->  parseNumber -> 0
 *
 * ⇒ every spend total would be ZERO. The guard throwing was CORRECT — it converted a silent
 *   £0 into a named failure, which is its whole job.
 *
 * ⭐ SO THE FIX HE PROPOSED, APPLIED TO THE GUARD ALONE, WOULD HAVE BEEN STRICTLY WORSE: the
 * guard would pass, the mapper would still read `undefined`, and every total would be zero
 * SILENTLY. A guard and its mapper must share one matching rule; relaxing only the guard
 * converts a loud failure into a quiet wrong number.
 *
 * ⇒ Both sides fold case now, so a capitalisation change genuinely WORKS rather than merely
 *   passing the check — which is the outcome his framing assumed and the code did not have.
 */
function foldKeys(row: Record<string, string>): Map<string, string> {
  const m = new Map<string, string>();
  for (const k of Object.keys(row)) m.set(k.trim().toLowerCase(), row[k]);
  return m;
}

/** Case-insensitive column read. The mapper's counterpart to the guard's matcher. */
function pick(folded: Map<string, string>, ...names: string[]): string {
  for (const n of names) {
    const v = folded.get(n.trim().toLowerCase());
    if (v !== undefined) return v;
  }
  return '';
}

export interface ColumnSpec {
  /** Any one of these headers satisfies the column. Mirrors the mapper's `||` chain. */
  accept: string[];
  /** Absence produces a wrong NUMBER rather than a missing label. */
  critical: boolean;
}

/**
 * ② THE CALL-CENTRE CONTRACT. Same two tiers, same reasoning, DIFFERENT critical set —
 * because what makes a column critical is what its absence does to a NUMBER, and that is a
 * property of this feed, not a template copied across.
 *
 *   ghl_location_name  absent ⇒ every row keys to '' ⇒ the dial map skips it ⇒ 0 DIALS
 *                      from a source in state 'valid'. This is the exact silent zero
 *                      @apprentice's wrong-tab finding was about.
 *   Call Duration      absent ⇒ parseNumber('') ⇒ 0 ⇒ total talk time reads zero
 *   Timestamp          absent ⇒ parseDateSafe fails ⇒ EVERY call is dropped by any date
 *                      filter, so the calls silently vanish from a filtered view
 *   Agent Name /       absent ⇒ a missing LABEL. Nothing numeric moves.
 *   call_dispostion
 */
export const CALL_CENTRE_COLUMNS: ColumnSpec[] = [
  { accept: ['ghl_location_name'], critical: true },
  { accept: ['Call Duration'], critical: true },
  { accept: ['Timestamp'], critical: true },
  { accept: ['Agent Name'], critical: false },
  // The misspelling is the REAL header in @andrew's sheet; the corrected spelling is the
  // alternate. Ordering matters only for which name the error message prints.
  { accept: ['call_dispostion', 'call_disposition'], critical: false },
];

export const WINDSOR_COLUMNS: ColumnSpec[] = [
  { accept: ['Account Name'], critical: true },              // absent ⇒ ONE fake account
  { accept: ['Spent', 'Spend'], critical: true },            // absent ⇒ every total £0
  { accept: ['Leads'], critical: true },                     // absent ⇒ CPL divides by zero
  { accept: ['Date'], critical: true },                      // absent ⇒ freshness blind
  { accept: ['Month'], critical: false },
  { accept: ['Campaign'], critical: false },
  { accept: ['Campaign Id', 'Campaign ID'], critical: false },
  { accept: ['Adset Name', 'Ad Set Name'], critical: false },
  { accept: ['Adset Id', 'Ad Set ID'], critical: false },
  { accept: ['Ad Name'], critical: false },
  { accept: ['Ad Id', 'Ad ID'], critical: false },
];

export interface SchemaDrift {
  /** LABEL columns that are absent. The feed still works; something is unnamed. */
  missingLabels: string[];
  /** True when there were no rows to check. NOT a clean bill of health. */
  schemaUnverified?: boolean;
}

/**
 * Check a parsed sheet against a column contract.
 * THROWS when a CRITICAL column is missing; RETURNS the drift for the rest.
 */
export function checkColumnContract(
  rows: Record<string, string>[],
  columns: ColumnSpec[],
  label: string,
): SchemaDrift {
  /**
   * ① AN EMPTY SHEET NO LONGER READS AS "SCHEMA FINE" — @raccoon found this on the FIRST
   * LINE of the function. Zero rows returned a clean verdict, so a wrong tab that happens
   * to be EMPTY passed the guard built to catch a wrong tab. That is the POPULATION control
   * my own gates docblock documents, and it fakes a PASS rather than a suspicious zero.
   * ⚖️ Still not a THROW — a genuinely empty tab is legitimate and must not blank the app —
   * but the verdict now says UNVERIFIED, because "we could not look" is not "we looked and
   * it was fine", and the verdict is what a reader trusts.
   */
  if (rows.length === 0) return { missingLabels: [], schemaUnverified: true };

  const folded = foldKeys(rows[0]);
  const satisfied = (c: ColumnSpec) => c.accept.some(h => folded.has(h.trim().toLowerCase()));

  /**
   * ② PRESENCE IS NOT VALIDITY — my own law, one layer down, and @raccoon caught me with it.
   * { 'Account Name': 'A', Spent: '', Leads: '', Date: '' } passed: every column PRESENT,
   * every value EMPTY, parseNumber('') -> 0, and every spend total becomes zero — the exact
   * outcome this contract exists to prevent. A CRITICAL column must carry a real value in at
   * least ONE row; a column of nothing is the same as a column that is not there.
   * (At least one, not all: a legitimately blank cell in one row is normal.)
   */
  const hasAnyValue = (c: ColumnSpec) =>
    rows.some(r => c.accept.some(h => (foldKeys(r).get(h.trim().toLowerCase()) ?? '').trim() !== ''));

  const missingCritical = columns.filter(c => c.critical && (!satisfied(c) || !hasAnyValue(c)));
  if (missingCritical.length > 0) {
    const names = missingCritical.map(c => `"${c.accept[0]}"`).join(', ');
    throw new Error(
      `${label}: the sheet is missing the column${missingCritical.length > 1 ? 's' : ''} ${names}, ` +
        `which every total is computed from, or the column is present and ENTIRELY BLANK. ` +
        `This is either the WRONG TAB or a renamed column — ` +
        `the tab name in Settings does not select a tab, only the gid= in the sheet URL does. ` +
        `Columns found: ${Object.keys(rows[0]).slice(0, 10).join(', ')}. ` +
        `Refusing to report zeros drawn from columns that are not there.`,
    );
  }

  return { missingLabels: columns.filter(c => !c.critical && !satisfied(c)).map(c => c.accept[0]) };
}

export function assertSheetSchema(
  rows: Record<string, string>[],
  required: string[],
  label: string,
): void {
  if (rows.length === 0) return;
  const present = new Set(Object.keys(rows[0]));
  const missing = required.filter(h => !present.has(h));
  if (missing.length === 0) return;

  const found = Object.keys(rows[0]).slice(0, 8).join(', ');
  throw new Error(
    `${label}: the sheet returned ${rows.length} rows but is missing the column${missing.length > 1 ? 's' : ''} ` +
      `${missing.map(m => `"${m}"`).join(', ')}. This is almost certainly the WRONG TAB — ` +
      `the tab name in Settings does not select a tab, only the gid= in the sheet URL does. ` +
      `Columns found: ${found}. Reporting this rather than counting every row as zero.`,
  );
}

export async function fetchGoogleSheetData(settings: AppSettings): Promise<AdSpendRow[]> {
  const csvUrl = convertSheetUrlToCsv(settings.googleSheetUrl, settings.googleSheetTab);
  if (!csvUrl) throw new Error('Invalid Google Sheet URL');
  
  const response = await fetch(csvUrl);
  if (!response.ok) throw new Error(`Failed to fetch Google Sheet: ${response.status}`);
  
  const text = await response.text();
  const rows = parseCsv(text);
  // ② FULL COLUMN CONTRACT, not just one column. A wrong TAB loses every column at once
  // and the old single-column check caught that; COLUMN DRIFT loses one, keeps the rest,
  // and was completely invisible.
  const drift = checkColumnContract(rows, WINDSOR_COLUMNS, 'Ad spend sheet');
  if (drift.missingLabels.length > 0) {
    // Reported, not thrown: these lose a NAME, not a number. Taking the dashboard down over
    // a missing `Ad Name` is a check that costs more than the defect it prevents.
    console.warn(`Ad spend sheet: missing label columns ${drift.missingLabels.join(', ')}`);
  }

  return rows.map(row => {
    // Case-folded ONCE per row, and the guard above matches by exactly the same rule.
    const r = foldKeys(row);
    return {
      month: pick(r, 'Month'),
      date: pick(r, 'Date'),
      dateISO: normalizeSourceDate(pick(r, 'Date')),
      campaign: pick(r, 'Campaign'),
      campaignId: pick(r, 'Campaign Id', 'Campaign ID'),
      adsetName: pick(r, 'Adset Name', 'Ad Set Name'),
      adsetId: pick(r, 'Adset Id', 'Ad Set ID'),
      adName: pick(r, 'Ad Name'),
      adId: pick(r, 'Ad Id', 'Ad ID'),
      spent: parseNumber(pick(r, 'Spent', 'Spend')),
      leads: parseNumber(pick(r, 'Leads')),
      accountName: pick(r, 'Account Name'),
    };
  });
}

/**
 * A DEAD CALL-CENTRE SOURCE MUST NOT RENDER AS "no calls were made".
 *
 * This used to swallow FOUR distinct failures into the same empty array — never
 * configured, unparseable URL, HTTP error, and any network throw — so a 403 was
 * indistinguishable from a quiet day. @bird drove it on production: total dials went
 * 15,302 -> 0 with no error, no banner, and "Updated" still advancing.
 *
 * It now THROWS, which is safe because fetchAllSources() settles each source
 * independently and turns a throw into { status: 'failed' } for that source alone.
 * Before that isolation existed, throwing here would have taken the other two down.
 *
 * `not configured` stays a RETURN rather than a throw: it is a legitimate state, not a
 * failure, and fetchAllSources reports it as such before this function is ever called.
 */
export async function fetchCallCenterData(settings: AppSettings): Promise<CallRow[]> {
  if (!settings.callCenterSheetUrl) return [];

  const csvUrl = convertSheetUrlToCsv(settings.callCenterSheetUrl, settings.callCenterSheetTab);
  if (!csvUrl) throw new Error('Call centre sheet URL is not a valid Google Sheets link');

  const response = await fetch(csvUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch call centre sheet: ${response.status}`);
  }

  const text = await response.text();
  const rows = parseCsv(text);
  // ② FULL CONTRACT, replacing the one-column check. That check caught a wrong TAB and was
  // blind to DRIFT, to a PRESENT-BUT-BLANK column, and to case — all three of @raccoon's
  // holes, which were in this fetcher too and not only in the spend one.
  const callDrift = checkColumnContract(rows, CALL_CENTRE_COLUMNS, 'Call centre sheet');
  if (callDrift.missingLabels.length > 0) {
    console.warn(`Call centre sheet: missing label columns ${callDrift.missingLabels.join(', ')}`);
  }

  return rows.map(row => {
    const r = foldKeys(row);
    return {
      timestamp: pick(r, 'Timestamp'),
      ghlLocationName: pick(r, 'ghl_location_name'),
      agentName: pick(r, 'Agent Name'),
      callDuration: parseNumber(pick(r, 'Call Duration')),
      callDisposition: pick(r, 'call_dispostion', 'call_disposition'),
    };
  });
}

export async function fetchAirtableData(settings: AppSettings): Promise<{ records: AppointmentRow[], fields: string[], unresolvedLinks?: number }> {
  const { airtableBaseId, airtableTableName, columnMappings } = settings;

  if (!airtableBaseId) throw new Error('Airtable not configured');

  // ROUTED THROUGH @apprentice's EDGE FUNCTION. The browser holds no credential and never
  // sees one — the proxy reads AIRTABLE_TOKEN from its own environment. That is precisely
  // why this patch is credential-free: there is nothing here to leak.
  //
  // ⚠️ THE FAILURE CONTRACT IS THE POINT, AND IT IS ENFORCED AT BOTH ENDS. The proxy never
  // returns 200 on failure (proxy.contract.test.ts), and this function must not undo that
  // by turning an error into an empty list. `records: []` under status 'ok' means Airtable
  // genuinely returned nothing; ANY other outcome throws, so a dead source can never render
  // as "zero appointments". Safe to throw because fetchAllSources() isolates each source.
  //
  // The proxy paginates server-side and returns the complete set, so the client offset loop
  // is gone rather than left unreachable below a throw.
  //
  // ⚠️ LOAD-BEARING CONTRACT, NOT A CHECK — @bird's arm G. Because the loop is gone, this
  // client SILENTLY IGNORES an `offset` in the response. If the proxy ever starts
  // returning PARTIAL pages, a partial set renders as a complete one: no error, no dash,
  // no way to tell. It is safe today because the proxy returns everything, and that is a
  // CONTRACT rather than something this code verifies. Anyone changing the proxy's
  // pagination must change this function in the same commit.
  const { data: payload, error: invokeError } = await supabase.functions.invoke(
    'airtable-proxy',
    { body: { baseId: airtableBaseId, tableName: airtableTableName } },
  );

  // ⛔ OWNER-ORDERED DIRECT FALLBACK, 2026-08-05. The proxy is the intended path and stays
  // FIRST — this runs only when the proxy cannot answer AND a token is configured, which is
  // exactly the state we shipped Andrew into: relocation done, deployment not.
  //
  // ⚠️ IT IS A FALLBACK, NOT A REPLACEMENT. The moment airtable-proxy is deployed, the block
  // above succeeds and this code never executes — no flag to flip, no second rollback. Delete
  // `airtableToken` from ALLOWED_CONFIG_KEYS to retire it entirely.
  //
  // ⚠️ AND IT DOES NOT SOFTEN THE FAILURE CONTRACT. If the direct call fails it THROWS, same
  // as the proxy path. A dead Airtable must never render as "zero appointments" — that is the
  // whole point of this project and it survives the rollback intact.
  /**
   * ③ ONE RESOLUTION PER REFRESH, NOT PER ROW — fetched before either path maps, so the
   * proxy route and the direct fallback resolve identically. Two lookups would let the
   * routes disagree about a client's NAME, and the fallback only runs when the proxy is
   * broken, i.e. exactly when nobody is watching.
   *
   * ⛔ NEVER THROWS. resolveLinkedClientNames returns an empty map on any failure — a bad
   * PAT scope, a 404, a non-link field, a missing row — and an empty map is precisely
   * today's behaviour. The resolver cannot take the dashboard down to improve a label.
   */
  const linkField = columnMappings['Client Name'] || 'Client Name';
  const { names: linkNames } = await resolveLinkedClientNames(
    airtableBaseId, airtableTableName, linkField, settings.airtableToken,
  );

  if (invokeError && settings.airtableToken) {
    const records: { fields: Record<string, unknown> }[] = [];
    let offset: string | undefined;
    // Airtable pages at 100; the proxy did this server-side, so the loop returns here with it.
    do {
      const url = new URL(
        `https://api.airtable.com/v0/${encodeURIComponent(airtableBaseId)}/${encodeURIComponent(airtableTableName)}`,
      );
      url.searchParams.set('pageSize', '100');
      if (offset) url.searchParams.set('offset', offset);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${settings.airtableToken}` },
      });
      if (!res.ok) {
        throw new Error(
          `Airtable direct fetch failed: ${res.status} ${res.statusText}. ` +
            'The airtable-proxy Edge Function is also unavailable.',
        );
      }
      const body = await res.json();
      if (!Array.isArray(body?.records)) {
        throw new Error('Airtable direct fetch returned an unusable response');
      }
      records.push(...body.records);
      offset = body.offset;
    } while (offset);

    return mapAirtableRecords(records, columnMappings, [], linkNames);
  }

  if (invokeError) {
    // A non-2xx carries the proxy's own {status, message}; surface THAT, not the generic
    // "Edge Function returned a non-2xx status code", which names nothing a user can act on.
    let detail = invokeError.message;
    const ctx = (invokeError as { context?: Response }).context;

    // 404 MEANS THE FUNCTION IS NOT DEPLOYED, AND THAT IS A DIFFERENT PROBLEM ENTIRELY.
    // @apprentice measured that these 207 lines of Deno have NEVER executed — not run,
    // not typechecked, not called, in any environment. Step 1 of DEPLOY.md is their first
    // execution ever, so a failure there is EXPECTED at least once and must be legible.
    // "Edge Function returned a non-2xx status code" would send someone to debug a token
    // for a function that was never pasted.
    if (ctx?.status === 404) {
      throw new Error(
        'Airtable proxy: the airtable-proxy Edge Function is not deployed. ' +
          'Paste it and set AIRTABLE_TOKEN — see supabase/functions/DEPLOY.md. ' +
          'This is not a token problem.',
      );
    }

    if (ctx && typeof ctx.json === 'function') {
      try {
        const body = await ctx.json();
        if (body?.message) detail = String(body.message);
      } catch {
        // keep the generic message rather than inventing one
      }
    }
    throw new Error(`Airtable proxy: ${detail}`);
  }

  if (!payload || payload.status !== 'ok' || !Array.isArray(payload.records)) {
    throw new Error(
      `Airtable proxy returned an unusable response${payload?.message ? `: ${payload.message}` : ''}`,
    );
  }

  return mapAirtableRecords(
    (payload as { records: { fields: Record<string, unknown> }[] }).records,
    columnMappings,
    Array.isArray(payload.fields) ? payload.fields : [],
    linkNames,
  );
}

/**
 * Shared record mapper for BOTH Airtable paths — the proxy and the direct fallback.
 *
 * ⭐ IT IS SHARED ON PURPOSE. Two copies of this mapping would let the two paths disagree
 * about what an appointment IS, and the fallback only runs when the proxy is broken — i.e.
 * exactly when nobody is watching. One mapper means the numbers cannot depend on which
 * route fetched them.
 */
export function mapAirtableRecords(
  records: { fields: Record<string, unknown> }[],
  columnMappings: Record<string, string>,
  knownFields: string[] = [],
  /**
   * recordId → linked row's name, fetched ONCE per refresh by resolveLinkedClientNames.
   * Absent or empty ⇒ EXACTLY today's behaviour: the id is refused, the field reads
   * UNRESOLVED_CLIENT, the appointment is counted as unmatched. Resolution is layered ON
   * TOP of a refusal that already works; it never replaces it.
   */
  linkNames: Map<string, string> = new Map(),
): { records: AppointmentRow[]; fields: string[]; unresolvedLinks: number } {
  const allRecords: AppointmentRow[] = [];
  let fields: string[] = knownFields;
  // Counted, not swallowed: a silently blanked client is the same defect one layer down.
  let unresolvedLinks = 0;

  {
    const data = { records };

    /**
     * 🔴 D2 — THE UNION, NOT THE FIRST RECORD. @fable queried the live base directly.
     *
     * AIRTABLE OMITS EMPTY FIELDS PER RECORD. `Closed Revenue ($)` is populated on 46 of
     * 679 rows, so it is absent from record[0] and was therefore absent from this list —
     * which is the list the Settings column-mapping dropdown is built from.
     *
     * ⇒ THE CONSEQUENCE WAS NOT COSMETIC. The saved mapping
     *   'Closed Revenue' → 'Closed Revenue ($)' is CORRECT AND WORKING, and the select
     *   showed "— Select —" because the option did not exist. @andrew was about to pick
     *   something («this is where i should map it»); any choice would have overwritten a
     *   working mapping with a blank and taken his revenue to $0.
     *
     * ⭐ SAMPLING ONE ROW TO LEARN A SCHEMA IS THE DEFECT. A sparse column is exactly the
     * one a user needs to map, and exactly the one a single-row sample cannot see — the
     * rarer the field, the more likely it is missing from the sample AND the more likely
     * it matters. The union is O(records) once per refresh and cannot be wrong this way.
     */
    if (data.records.length > 0 && fields.length === 0) {
      const seen = new Set<string>();
      for (const rec of data.records) {
        for (const k of Object.keys(rec?.fields ?? {})) seen.add(k);
      }
      fields = Array.from(seen);
    }

    for (const rec of data.records) {
      // Degrade, never throw — the same contract the rest of this path follows. A record
      // with no `fields` yields empty values and an unmatched appointment; it must not take
      // the dashboard down. Caught by the union test, which constructed exactly that row.
      const f = rec?.fields ?? {};
      const getField = (key: string) => {
        const mapped = columnMappings[key] || key;
        const val = f[mapped];
        const first = Array.isArray(val) ? (val[0] || '') : (val || '');
        /**
         * 🔴 REFUSE A RECORD ID. Returning '' leaves the field UNRESOLVED, which the
         * matcher treats as "no client" — so the appointment lands in unmatchedAppointments
         * instead of being attributed to whatever account a fuzzy match happens to find.
         * An unresolved appointment is honest; one attributed on the strength of a record
         * id is a wrong number wearing a name.
         */
        /**
         * ⭐ RESOLVE BEFORE REFUSING. @andrew called the old banner «bs» and he was right:
         * it told him to add a Lookup field in Airtable to work around our limitation. If
         * we hold the linked row's name, this is a NAME, not an id, and nothing needs
         * saying at all.
         */
        const resolved = resolveRecordId(first, linkNames);
        if (resolved) return resolved;

        if (isAirtableRecordId(first)) {
          unresolvedLinks++;
          /**
           * 🔴 A READABLE SENTINEL, NOT ''. Returning an empty string was my over-correction
           * and it EMPTIED THE APPOINTMENTS PAGE: a blank client is falsy, so every consumer
           * that guards on `a.client` dropped the row — the tiles, the list AND the calendar.
           *
           * ⭐ AN UNRESOLVED CLIENT IS A FACT ABOUT THE ATTRIBUTION, NOT ABOUT THE
           * APPOINTMENT. I refused to answer "which account" and then stopped answering
           * "does this appointment exist" — the refusal-as-a-value law running BACKWARDS.
           * The appointment is real, it is counted, and only its ACCOUNT is unknown.
           */
          return UNRESOLVED_CLIENT;
        }
        return first;
      };
      
      const clientName = String(getField('Client Name'));

      allRecords.push({
        campaignName: String(getField('Campaign Name')),
        campaignId: String(getField('Campaign ID')),
        adSetName: String(getField('Ad Set Name')),
        adSetId: String(getField('Ad Set ID')),
        adName: String(getField('Ad Name')),
        adId: String(getField('Ad ID')),
        client: clientName,
        // Computed ONCE above: calling getField twice incremented unresolvedLinks twice and
        // the count read 5 where 3 was true. A counter inside a getter is order-sensitive.
        clientUnresolved: clientName === UNRESOLVED_CLIENT,
        appointmentDate: String(getField('Appointment Date')),
        dateAdded: String(getField('Date Added')),
        showStatus: String(getField('Show Status')),
        leadValid: String(getField('Lead Valid')),
        leadQuality: String(getField('Lead Quality')),
        dqReason: String(getField('DQ Reason')),
        projectValue: parseNumber(String(getField('Project Value'))),
        closedRevenue: parseNumber(String(getField('Closed Revenue'))),
        leadStatus: String(getField('Lead Status')),
        amountCharged: parseNumber(String(getField('Amount Charged'))),
        billed: String(getField('Billed')),
        clientPPARate: parseNumber(String(getField('Client PPA Rate'))),
        setter: String(getField('Setter')),
        clientBillingModel: String(getField('Client Billing Model')),
      });
    }
  }

  return { records: allRecords, fields, unresolvedLinks };
}

/**
 * ACCOUNT IDENTITY — the account column is UNTYPED and this names what is in it.
 *
 * The feed carries no account_id field. `Account Name` holds three different things:
 *   a human name          "Backyard Paradiso"
 *   a META ACCOUNT ID     "10170221, USD"   — Meta's display for an account nobody named.
 *                         4 of 61 labels, all historical: every one stopped on or before
 *                         2025-12-31, because each was NAMED and the id form then vanished.
 *   a whitespace twin     "Co-Lights " vs "Co-Lights" — 2 pairs in the live feed
 *
 * ⚠️ An id-form label is a PREDICTION, not just an observation: it marks an account nobody
 * has named in Meta, and the day somebody names it the history SPLITS — old rows keep the
 * id, new rows get the name. That is not hypothetical; it has already happened three times.
 */
export type AccountLabelKind = 'name' | 'meta-account-id';

export interface AccountLabel {
  raw: string;
  key: string;
  kind: AccountLabelKind;
  metaAccountId?: string;
}

/**
 * Grouping key. trim + lowercase — the same thing the aggregator does inline, so wiring a
 * call site to this changes no behaviour.
 *
 * ⛔ IT DOES **NOT** COLLAPSE INTERNAL WHITESPACE, AND THIS DOCBLOCK USED TO CLAIM IT DID.
 * @raccoon measured the lie and I reproduced it before removing it:
 *
 *     "Acme  Corp" -> "acme  corp"     "Acme Corp" -> "acme corp"     SPLIT, not collapsed
 *     "Acme\tCorp" -> "acme\tcorp"                                    SPLIT
 *
 * `trim()` removes OUTER whitespace only. ⭐ An aspirational docblock is worse than no
 * docblock: a reader who finds this function and trusts the old claim ships the twin bug
 * BELIEVING IT IS HANDLED. The claim is now deleted and the real behaviour is locked in
 * dataService.accountKey.test.ts, so it cannot drift back into a comment nobody runs.
 *
 * ⚠️ THE TWIN BUG IS STILL REACHABLE — this fix is the CLAIM, not the BEHAVIOUR. Making
 * this collapse twins is one `.replace`, but account identity is decided at 22 hand-written
 * `trim().toLowerCase()` sites (@raccoon's census; only 4 route through any shared
 * function), so changing it here alone would make this function DISAGREE with the 22 and
 * could merge or split live accounts on the dashboard. That is @fable's call, not a
 * side effect of a comment fix.
 *
 * ⚠️ AND THERE IS A SECOND FUNCTION OF THIS NAME: accounts.ts:34 DOES collapse internal
 * whitespace and has no real importers. Same name, different rule — do not assume which
 * one an unqualified `accountKey` refers to.
 */
/**
 * A — AN AIRTABLE RECORD ID MUST NEVER RENDER AS A NAME.
 *
 * @fable, from @andrew: the appointments ACCOUNT column was showing `recXXXXXXXXXXXXXX`.
 * Cause: `Client Name` is a LINKED-RECORD field, so Airtable returns an ARRAY OF RECORD
 * IDS, and `getField` did `val[0]` — handing the id straight through as the client name.
 *
 * ⭐ AN ID DISPLAYED AS A NAME IS A LABEL THAT IS NOT AN IDENTITY — the exact class this
 * whole branch has been killing. And it is worse than a blank, because the 4-tier matcher
 * then treats it as a real client name: Tier 3 caches it, Tier 4 fuzzy-matches it, and the
 * appointment gets ATTRIBUTED TO AN ACCOUNT ON THE STRENGTH OF A RECORD ID.
 *
 * ⚠️ THIS IS THE INVARIANT HALF ONLY, AND IT IS DELIBERATELY INDEPENDENT OF THE FIX.
 * @bird is pulling the raw payload to decide whether a text field already carries the name
 * (a columnMappings change, no code) or whether the link must be resolved against the
 * linked table. Either way an unresolved id must render as "—" and say so, so that half is
 * built now and does not wait on the answer.
 *
 * Shape: 'rec' + 14 chars, which is Airtable's documented record id format. Anchored, so a
 * legitimate client genuinely called "Recovery" cannot be mistaken for one.
 */
/** Displayed in place of an unresolved client. Truthy, human-readable, never an id. */
export const UNRESOLVED_CLIENT = '—';

export function isAirtableRecordId(value: unknown): boolean {
  return typeof value === 'string' && /^rec[A-Za-z0-9]{14}$/.test(value);
}

/**
 * 🔴 D1 — «CLOSED DEALS» COUNTED LOSSES AS WINS. Measured on @andrew's live Airtable by
 * @fable: 679 records, `Closed Lost` **107** · `Closed Won` **46**. The old predicate was
 * `leadStatus.toLowerCase().includes('closed') || closedRevenue > 0`, and
 * `'Closed Lost'.includes('closed')` is TRUE — so the app reported **153** closed deals of
 * which **107 were deals he LOST**. Backyard Paradiso's 96 was about one third real.
 *
 * ⭐ THE SHAPE: A SUBSTRING TEST STANDING IN FOR A CATEGORY TEST. It cannot distinguish an
 * outcome from its OPPOSITE, because both outcomes share a word. The two states are not
 * merely different, they are contradictory — and the test scores them identically.
 *
 * ⚠️ WHY THIS IS NOT `=== 'closed won'`. That is the naive repair and it is brittle in two
 * directions: a spelling variant (`Closed-Won`, double space, trailing blank) silently drops
 * a real win, and it says nothing about values nobody has enumerated. **12 of the 679 records
 * carry a Lead Status @fable's census did not list.** What IS known about those 12, by
 * deduction rather than assumption: the app's total is exactly 153 = 107 + 46, so **none of
 * them contains the substring `closed`** — otherwise the total would exceed 153.
 *
 * 🔑 AND THE TRAP INSIDE THE INSTRUCTION TO "KEEP THE `|| closedRevenue > 0` ARM": kept
 * NAIVELY, it reintroduces the defect through the back door — a `Closed Lost` row carrying a
 * non-zero Closed Revenue would be counted as a win again, by a different route. The revenue
 * arm must therefore be **subordinate to an explicit LOST test**, which is why `isClosedLost`
 * exists and is not merely the negation of won.
 *
 * ⇒ SO THE CLASSIFICATION IS THREE-VALUED, not two. `won` · `lost` · `unknown`. An
 * unrecognised status is NOT silently a loss: it is `unknown`, and `unknown` + revenue counts
 * as a win, while `lost` + revenue does not.
 */
const normalizeStatus = (raw: unknown): string =>
  String(raw ?? '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();

/** `Closed Won` and its spelling variants — never `Closed Lost`. */
export function isClosedWonStatus(leadStatus: unknown): boolean {
  const s = normalizeStatus(leadStatus);
  return s === 'closed won' || s === 'won' || s === 'closed and won';
}

/** `Closed Lost` and variants. Explicit, so a lost deal can never be counted by any route. */
export function isClosedLostStatus(leadStatus: unknown): boolean {
  const s = normalizeStatus(leadStatus);
  return s === 'closed lost' || s === 'lost' || s === 'closed and lost';
}

/**
 * THE ONE PREDICATE ALL FOUR CALL SITES USE. Previously the expression was written out four
 * times, so a repair could fix three and leave the fourth reporting a different number for
 * the same data — the defect class that put four separate line numbers in the D1 report.
 */
export function isClosedWon(appt: { leadStatus?: string; closedRevenue?: number }): boolean {
  if (isClosedWonStatus(appt.leadStatus)) return true;
  // Revenue is evidence of a win ONLY where the status has not already said "lost".
  if (isClosedLostStatus(appt.leadStatus)) return false;
  return (appt.closedRevenue ?? 0) > 0;
}

export function accountKey(raw: string | undefined | null): string {
  return String(raw ?? '').trim().toLowerCase();
}

export function classifyAccountLabel(raw: string | undefined | null): AccountLabel {
  const r = String(raw ?? '').trim();
  const m = r.match(/^(\d{6,})\s*,\s*[A-Z]{3}$/);
  return m
    ? { raw: r, key: accountKey(r), kind: 'meta-account-id', metaAccountId: m[1] }
    : { raw: r, key: accountKey(r), kind: 'name' };
}

/**
 * DETERMINISTIC ROW KEY, used to deduplicate BEFORE aggregating.
 *
 * Uses dateISO rather than the raw date string, so 8/4/2026 and 2026-08-04 — the same day
 * from two different tabs — collapse to one key instead of surviving as two rows.
 */
export function adSpendRowKey(r: AdSpendRow): string {
  return [
    r.dateISO || r.date,
    accountKey(r.accountName),
    (r.campaignId || '').trim(),
    (r.adsetId || '').trim(),
    (r.adId || '').trim(),
  ].join('\u0000');
}

export interface DedupeResult {
  rows: AdSpendRow[];
  /** ENUMERATED, not counted: a count says something was dropped, only the values say what. */
  removed: { key: string; accountName: string; date: string }[];
}

/**
 * Drop exact duplicate rows before they are summed.
 *
 * ⚠️ MEASURED BOUND, carry it: the live feed has ZERO duplicates on this key — 38,944 rows,
 * 38,944 distinct keys. So this is BEHAVIOUR-NEUTRAL TODAY and exists for the prospective
 * case: a re-export, an appended refresh or a Windsor backfill introduces them and nothing
 * else in the pipeline would notice. Do NOT report that we have a duplicate problem.
 */
export function dedupeAdSpendRows(rows: AdSpendRow[]): DedupeResult {
  const seen = new Set<string>();
  const out: AdSpendRow[] = [];
  const removed: DedupeResult['removed'] = [];
  for (const r of rows) {
    const k = adSpendRowKey(r);
    if (seen.has(k)) {
      removed.push({ key: k, accountName: r.accountName, date: r.dateISO || r.date });
      continue;
    }
    seen.add(k);
    out.push(r);
  }
  return { rows: out, removed };
}

/**
 * ONE OUTCOME PER SOURCE — the seam that stops a single failure taking the others down.
 *
 * `refresh()` currently awaits all three fetches inside a single Promise.all, which REJECTS
 * on the first rejection and therefore DISCARDS payloads that already arrived. Measured on
 * production: with a real sheet URL restored and Airtable unavailable, Windsor is fetched
 * successfully — one request — and the screen still renders $0.00 and an Airtable error.
 * A partial restore reads as total failure.
 *
 * This returns a SETTLED result per source, and distinguishes three states the old shape
 * could not tell apart:
 *   ok             we asked and got an answer
 *   not-configured we never asked, and that is a legitimate state, not a failure
 *   failed         we asked and it broke — carries the reason
 *
 * "not-configured" and "failed" being separate is Andrew's requirement that a dead source
 * must not render as a zero: an empty list is only honest when the status is `ok`.
 */
export type SourceOutcome<T> =
  | { status: 'ok'; data: T }
  | { status: 'not-configured' }
  | { status: 'failed'; error: string };

export interface AllSourcesResult {
  googleSheet: SourceOutcome<AdSpendRow[]>;
  airtable: SourceOutcome<{ records: AppointmentRow[]; fields: string[] }>;
  callCenter: SourceOutcome<CallRow[]>;
}

async function settle<T>(
  configured: boolean,
  fetcher: () => Promise<T>,
): Promise<SourceOutcome<T>> {
  if (!configured) return { status: 'not-configured' };
  try {
    return { status: 'ok', data: await fetcher() };
  } catch (e) {
    return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
}

export async function fetchAllSources(settings: AppSettings): Promise<AllSourcesResult> {
  // allSettled, never all — one rejection must not discard the others' payloads.
  const [googleSheet, airtable, callCenter] = await Promise.all([
    settle(isSourceConfigured(settings, 'googleSheet'), () => fetchGoogleSheetData(settings)),
    settle(isSourceConfigured(settings, 'airtable'), () => fetchAirtableData(settings)),
    settle(isSourceConfigured(settings, 'callCenter'), () => fetchCallCenterData(settings)),
  ]);
  return { googleSheet, airtable, callCenter };
}

function isBlank(val: string | null | undefined): boolean {
  return val == null || val.trim() === '';
}

export function getPerformance(
  cpl: number,
  leadPercent: number,
  thresholds?: AppSettings["perfThresholds"],
  program?: string,
  costPerAppt?: number,
  appointments?: number,
): PerformanceLevel {
  if (program !== undefined) {
    // Program-aware: mirrors getPerfByProgram in Dashboard.tsx
    if (program === 'Done With You') {
      if (cpl === 0) return 'fair';
      if (cpl < 35) return 'good';
      if (cpl <= 55) return 'fair';
      return 'poor';
    }
    // DFY / Other: judge on cost per appointment
    const cpa = costPerAppt ?? 0;
    const appts = appointments ?? 0;
    if (cpa === 0 || appts === 0) return 'fair';
    if (cpa < 180) return 'good';
    if (cpa <= 240) return 'fair';
    return 'poor';
  }
  const t = thresholds || { goodCpl: 35, goodLeadPercent: 15, poorCpl: 55, poorLeadPercent: 5 };
  if (cpl < t.goodCpl && leadPercent > t.goodLeadPercent) return 'good';
  if (cpl > t.poorCpl || leadPercent < t.poorLeadPercent) return 'poor';
  return 'fair';
}

// Levenshtein distance for fuzzy matching (Tier 4)
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

export function levenshteinSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/\s*&\s*/g, ' and ')               // "X & Y" → "x and y"
    .replace(/\b(llc|inc|corp|co\.?)\b/gi, '')  // strip legal suffixes
    .replace(/[^\w\s]/g, ' ')                    // remove remaining punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Which sources actually answered on the fetch that produced these arrays.
 *
 * ⚠️ ABSENT MEANS KNOWN, DELIBERATELY. A caller that has no source outcomes to offer must
 * keep the behaviour it has today — Targets.tsx:117 and TeamPerformance.tsx:89 both filter
 * arrays they already hold and have no notion of a fetch at all. Defaulting to "unknown"
 * would blank two pages that are working correctly, which is the mirror of the bug.
 */
export interface SourceKnown {
  spend?: boolean;
  appts?: boolean;
  calls?: boolean;
}

/**
 * May this metric be rendered as a NUMBER at all?
 *
 * Two DIFFERENT ways a figure can be meaningless, and both currently render as a confident
 * zero:
 *
 *   ① THE SOURCE DID NOT ANSWER — `known === false`. A failed fetch contributes `[]`, and
 *      every sum over `[]` is 0. @bird measured 61 of 61 accounts showing COST/APPT $0.00
 *      from a dead feed.
 *
 *   ② THE DENOMINATOR IS ZERO — cost-per-appointment with no appointments is not $0.00,
 *      it is UNDEFINED. `totalAppts > 0 ? spend/totalAppts : 0` collapses "cannot be
 *      computed" into "computed, and it is nothing". This one fires even when every source
 *      is perfectly healthy, which is why @raccoon measured that costPerAppt CANNOT
 *      discriminate a dead source from a live one — it reads $0.00 in both (RACC-031).
 *
 * ⚠️ THIS APPLIES TO RATIOS, NOT TO SUMS. A live source reporting 0 dials genuinely made
 * zero calls, and blanking that would hide a real and important fact. Only a quotient is
 * meaningless at a zero denominator.
 *
 * ⚠️ `known === false`, never `!known` — absent means known, and `!undefined` is true.
 */
export function metricIsMeaningful(known: boolean | undefined, denominator: number): boolean {
  if (known === false) return false;
  return denominator > 0;
}

/**
 * IS THE CAMPAIGN EXCLUSION LIST ACTUALLY FILTERING ANYTHING?
 *
 * @andrew accepted the data loss — the 32 excluded campaigns are gone and are not coming
 * back. That makes this detector the mission rather than a nicety: the software must not
 * lie about the CONSEQUENCES of a loss he agreed to.
 *
 * WHAT BREAKS, MECHANICALLY: `excludedCampaignIds` is built from settings.excludedCampaigns.
 * When it is empty the filter at the performanceSpend computation excludes NOTHING, so
 * performanceSpend === totalSpend, and `cpl = performanceSpend / performanceLeads` is then
 * computed across campaigns that were deliberately excluded — typically the ones burning
 * spend for no leads, which is WHY they were excluded. ⇒ EVERY cost-per-lead and
 * cost-per-appointment on the dashboard is inflated, and nothing on screen says so.
 *
 * ⚠️ WHY THREE STATES AND NOT A BOOLEAN. "performanceSpend === totalSpend" is the symptom
 * @fable named, and taken alone it is AMBIGUOUS — it is equally true when:
 *     ① nothing is configured                     ← the data loss. Numbers are unfiltered.
 *     ② a list IS configured but matches no row   ← stale ids; also silently unfiltered,
 *                                                   and a DIFFERENT thing to tell someone
 *     ③ the excluded campaigns spent nothing      ← perfectly healthy, MUST NOT WARN
 * A detector that cannot tell ① from ③ would cry wolf on a correctly-configured account,
 * and the fastest way to get a warning ignored is to show it when nothing is wrong.
 */
export type ExclusionState = 'none-configured' | 'configured-but-inert' | 'active';

export interface ExclusionReport {
  state: ExclusionState;
  /** How many ids the settings carry. 0 is the post-wipe state. */
  configuredCount: number;
  /** How many of those ids actually matched a spend row. */
  matchedCount: number;
  /** Spend that IS being counted toward CPL but would have been excluded. */
  unfilteredSpend: number;
  /** Named, not counted — a tally cannot be judged, and these go on screen. */
  affectedAccounts: string[];
}

export function detectExclusionState(
  adSpend: AdSpendRow[],
  settings?: AppSettings,
): ExclusionReport {
  const configured = (settings?.excludedCampaigns || []).map(c => String(c).trim()).filter(Boolean);
  const configuredIds = new Set(configured);

  const matched = new Set<string>();
  let unfilteredSpend = 0;
  const affected = new Set<string>();
  for (const r of adSpend) {
    const id = (r.campaignId || '').trim();
    if (id && configuredIds.has(id)) {
      matched.add(id);
      unfilteredSpend += r.spent;
      if (r.accountName) affected.add(r.accountName);
    }
  }

  // ③ first: a configured list that matched rows is working, whatever the spend totals say.
  if (configured.length > 0 && matched.size > 0) {
    return {
      state: 'active',
      configuredCount: configured.length,
      matchedCount: matched.size,
      unfilteredSpend: 0, // it IS being filtered — nothing is leaking into CPL
      affectedAccounts: [],
    };
  }

  // ② configured but nothing matched: the ids are stale, and the numbers are unfiltered
  // exactly as if the list were empty — but the cause, and so the message, is different.
  if (configured.length > 0) {
    return {
      state: 'configured-but-inert',
      configuredCount: configured.length,
      matchedCount: 0,
      unfilteredSpend: 0,
      affectedAccounts: [],
    };
  }

  // ① nothing configured. Only report accounts that actually HAVE spend — an account with
  // no spend has no inflated CPL, and naming it would be noise.
  const withSpend = new Set<string>();
  let total = 0;
  for (const r of adSpend) {
    if (r.spent > 0 && r.accountName) withSpend.add(r.accountName);
    total += r.spent;
  }
  return {
    state: 'none-configured',
    configuredCount: 0,
    matchedCount: 0,
    unfilteredSpend: total,
    affectedAccounts: Array.from(withSpend).sort(),
  };
}

/** Do these numbers need a caveat on screen? Only ① and ② — never a healthy config. */
export function exclusionsAreLying(r: ExclusionReport): boolean {
  return r.state !== 'active';
}

export function buildAccountSummaries(
  adSpend: AdSpendRow[],
  appointments: AppointmentRow[],
  settings?: AppSettings,
  callData?: CallRow[],
  known?: SourceKnown,
): { accounts: AccountSummary[], unmatchedAppointments: AppointmentRow[] } {
  // `?? true` and not `|| true`: an explicit `false` must survive. `||` would turn every
  // "this source is dead" back into "known", which is exactly the bug being fixed.
  const spendKnown = known?.spend ?? true;
  const apptsKnown = known?.appts ?? true;
  const callsKnown = known?.calls ?? true;
  const accountMap = new Map<string, { spendRows: AdSpendRow[]; appts: AppointmentRow[]; originalName: string }>();

  // 1. Group ad spend by normalized account name
  for (const row of adSpend) {
    const name = row.accountName || 'Unknown';
    const normalizedName = name.trim().toLowerCase();
    if (!accountMap.has(normalizedName)) {
      accountMap.set(normalizedName, { spendRows: [], appts: [], originalName: name });
    }
    accountMap.get(normalizedName)!.spendRows.push(row);
  }

  // 2. Build lookup maps — Campaign ID only (globally unique, zero false-match risk)
  const campaignIdToAccount = new Map<string, string>();
  for (const [normalizedName, data] of accountMap.entries()) {
    for (const row of data.spendRows) {
      const trimmedId = (row.campaignId || '').trim();
      if (trimmedId) campaignIdToAccount.set(trimmedId, normalizedName);
    }
  }

  // Build manual alias map from user-configured account aliases in Settings
  const manualMappingToAccount = new Map<string, string>();
  for (const mapping of settings?.accountAliases || []) {
    const airtableName = (mapping.airtableName || mapping.sheetName || '').trim();
    if (airtableName) {
      manualMappingToAccount.set(
        airtableName.toLowerCase(),
        mapping.sheetName.trim().toLowerCase()
      );
    }
  }

  // 3. Match appointments — 4-tier matching system
  const unmatchedAfterTier2: AppointmentRow[] = [];
  const clientNameToAccount = new Map<string, string>(); // for Tier 3 inference

  // First pass: Tier 1 & Tier 2
  for (const appt of appointments) {
    let matchedAccountKey: string | undefined;

    // Tier 1 — ID Matching
    const apptCampId = (appt.campaignId || '').trim();
    if (apptCampId) {
      matchedAccountKey = campaignIdToAccount.get(apptCampId);
    }

    /**
     * ⭐ TIER 1 (campaign id) STILL APPLIES to an unresolved appointment — a campaign id is
     * real attribution evidence and does not depend on the client name. Only the NAME-BASED
     * tiers are skipped, because the "name" is a placeholder. Attributing on a sentinel
     * would be worse than the record id it replaced: every unresolved appointment would
     * collapse onto one pseudo-account.
     */
    // Tier 2 — Manual Alias
    if (!matchedAccountKey && appt.client && !appt.clientUnresolved) {
      matchedAccountKey = manualMappingToAccount.get(appt.client.trim().toLowerCase());
    }

    if (matchedAccountKey && accountMap.has(matchedAccountKey)) {
      accountMap.get(matchedAccountKey)!.appts.push(appt);
      // Record this client name → account mapping for Tier 3
      if (appt.client && !appt.clientUnresolved) {
        clientNameToAccount.set(appt.client.trim().toLowerCase(), matchedAccountKey);
      }
    } else {
      unmatchedAfterTier2.push(appt);
    }
  }

  // Second pass: Tier 3 — Client Name Inference
  const unmatchedAfterTier3: AppointmentRow[] = [];
  for (const appt of unmatchedAfterTier2) {
    let matchedAccountKey: string | undefined;

    if (appt.client && !appt.clientUnresolved) {
      matchedAccountKey = clientNameToAccount.get(appt.client.trim().toLowerCase());
    }

    if (matchedAccountKey && accountMap.has(matchedAccountKey)) {
      accountMap.get(matchedAccountKey)!.appts.push(appt);
    } else {
      unmatchedAfterTier3.push(appt);
    }
  }

  // Third pass: Tier 4 — Fuzzy Name Matching
  const unmatchedAppointments: AppointmentRow[] = [];
  const accountKeys = Array.from(accountMap.keys());
  const normalizedAccountKeys = accountKeys.map(k => ({ key: k, normalized: normalizeName(accountMap.get(k)!.originalName) }));

  for (const appt of unmatchedAfterTier3) {
    let matchedAccountKey: string | undefined;

    if (appt.client && !appt.clientUnresolved) {
      const normalizedClient = normalizeName(appt.client);
      const scores = normalizedAccountKeys.map(ak => ({
        key: ak.key,
        score: levenshteinSimilarity(normalizedClient, ak.normalized),
      })).sort((a, b) => b.score - a.score);

      if (scores.length > 0 && scores[0].score >= 0.85) {
        const secondScore = scores.length > 1 ? scores[1].score : 0;
        // Only match if exactly one account above threshold with sufficient gap
        if (scores[0].score - secondScore >= 0.15) {
          matchedAccountKey = scores[0].key;
        }
      }
    }

    if (matchedAccountKey && accountMap.has(matchedAccountKey)) {
      accountMap.get(matchedAccountKey)!.appts.push(appt);
    } else {
      unmatchedAppointments.push(appt);
    }
  }

  // --- Dial counting from call center data ---
  // Keys use normalizeName so "&" vs "and", punctuation differences, and legal suffixes all collapse
  const dialMap = new Map<string, { dials: number; totalDuration: number }>();
  for (const call of callData || []) {
    const key = normalizeName(call.ghlLocationName || '');
    if (!key) continue;
    const entry = dialMap.get(key) || { dials: 0, totalDuration: 0 };
    entry.dials++;
    entry.totalDuration += call.callDuration;
    dialMap.set(key, entry);
  }

  // Build lookup keys per account using normalizeName for consistency
  const accountDialKeys = new Map<string, string[]>();
  for (const [normalizedKey, data] of accountMap) {
    const keys: string[] = [];
    const addKey = (raw: string) => {
      const n = normalizeName(raw);
      if (n && !keys.includes(n)) keys.push(n);
    };
    addKey(data.originalName);
    const alias = (settings?.accountAliases || []).find(a => a.sheetName.trim().toLowerCase() === normalizedKey);
    if (alias) addKey(alias.airtableName || alias.sheetName || '');
    for (const [clientKey, acctKey] of clientNameToAccount) {
      if (acctKey === normalizedKey) addKey(clientKey);
    }
    accountDialKeys.set(normalizedKey, keys);
  }

  // Pass 1 — exact match (after normalization)
  const claimedDialKeys = new Set<string>();
  const accountDialTotals = new Map<string, { dials: number; totalDuration: number }>();
  for (const [normalizedKey] of accountMap) {
    const keys = accountDialKeys.get(normalizedKey) || [];
    let dials = 0, totalDuration = 0;
    for (const dk of keys) {
      const entry = dialMap.get(dk);
      if (entry) {
        dials += entry.dials;
        totalDuration += entry.totalDuration;
        claimedDialKeys.add(dk);
      }
    }
    accountDialTotals.set(normalizedKey, { dials, totalDuration });
  }

  // Pass 2 — fuzzy match any ghlLocationName that wasn't claimed above
  const accountNameIndex = Array.from(accountMap.entries()).map(([key, data]) => ({
    key,
    normalized: normalizeName(data.originalName),
  }));

  for (const [dialKey, dialData] of dialMap) {
    if (claimedDialKeys.has(dialKey)) continue;
    const scores = accountNameIndex
      .map(an => ({ key: an.key, score: levenshteinSimilarity(dialKey, an.normalized) }))
      .sort((a, b) => b.score - a.score);
    if (!scores.length || scores[0].score < 0.75) continue;
    const secondScore = scores.length > 1 ? scores[1].score : 0;
    if (scores[0].score - secondScore < 0.10) continue; // require a clear winner
    const existing = accountDialTotals.get(scores[0].key) || { dials: 0, totalDuration: 0 };
    existing.dials += dialData.dials;
    existing.totalDuration += dialData.totalDuration;
    accountDialTotals.set(scores[0].key, existing);
  }

  // 4. Build final summaries
  const summaries: AccountSummary[] = [];
  const aliasMap = new Map((settings?.accountAliases || []).map(a => [a.sheetName.trim().toLowerCase(), a]));
  const thresholds = settings?.perfThresholds;
  const excludedCampaignIds = new Set((settings?.excludedCampaigns || []).map(id => id.trim()));

  for (const [normalizedKey, data] of accountMap) {
    const accountName = data.originalName;
    const alias = aliasMap.get(normalizedKey);

    // Total spend/leads from ALL campaigns (shown to client — matches their Facebook bill)
    const totalSpend = data.spendRows.reduce((s, r) => s + r.spent, 0);
    const totalLeads = data.spendRows.reduce((s, r) => s + r.leads, 0);

    // Performance spend/leads from non-excluded campaigns only
    const performanceSpend = data.spendRows
      .filter(r => !excludedCampaignIds.has((r.campaignId || '').trim()))
      .reduce((s, r) => s + r.spent, 0);
    const performanceLeads = data.spendRows
      .filter(r => !excludedCampaignIds.has((r.campaignId || '').trim()))
      .reduce((s, r) => s + r.leads, 0);

    // Build campaigns within this account
    const campaignMap = new Map<string, { spendRows: AdSpendRow[], appts: AppointmentRow[] }>();
    for (const r of data.spendRows) {
      const key = (r.campaignId || '').trim() || (r.campaign || '').trim();
      if (!key) continue;
      if (!campaignMap.has(key)) campaignMap.set(key, { spendRows: [], appts: [] });
      campaignMap.get(key)!.spendRows.push(r);
    }

    // Match appointments to campaigns using lookup maps
    const campIdMap = new Map<string, string>();
    const campNameMap = new Map<string, string>();
    const campAdSetNameMap = new Map<string, string>();
    const campAdNameMap = new Map<string, string>();
    const campAdIdMap = new Map<string, string>();
    for (const [cKey, cData] of campaignMap) {
      for (const r of cData.spendRows) {
        const cId = (r.campaignId || '').trim();
        const cName = (r.campaign || '').trim();
        const asName = (r.adsetName || '').trim();
        const aName = (r.adName || '').trim();
        const aId = (r.adId || '').trim();
        if (cId) campIdMap.set(cId, cKey);
        if (cName) campNameMap.set(cName.toLowerCase(), cKey);
        if (asName) campAdSetNameMap.set(asName.toLowerCase(), cKey);
        if (aName) campAdNameMap.set(aName.toLowerCase(), cKey);
        if (aId) campAdIdMap.set(aId, cKey);
      }
    }

    for (const a of data.appts) {
      const aAdId = (a.adId || '').trim();
      const aAdName = (a.adName || '').trim();
      const aAdSetId = (a.adSetId || '').trim();
      const aAdSetName = (a.adSetName || '').trim();
      const aCampId = (a.campaignId || '').trim();
      const aCampName = (a.campaignName || '').trim();

      let matchedCampaignKey: string | undefined;
      // Priority: campaign ID (most direct) > adset ID > adset name > ad ID > ad name > campaign name
      if (aCampId) matchedCampaignKey = campIdMap.get(aCampId);
      if (!matchedCampaignKey && aAdSetId) {
        for (const [cKey, cData] of campaignMap) {
          if (cData.spendRows.some(r => (r.adsetId || '').trim() === aAdSetId)) { matchedCampaignKey = cKey; break; }
        }
      }
      if (!matchedCampaignKey && aAdSetName) matchedCampaignKey = campAdSetNameMap.get(aAdSetName.toLowerCase());
      if (!matchedCampaignKey && aAdId) matchedCampaignKey = campAdIdMap.get(aAdId);
      if (!matchedCampaignKey && aAdName) matchedCampaignKey = campAdNameMap.get(aAdName.toLowerCase());
      if (!matchedCampaignKey && aCampName) matchedCampaignKey = campNameMap.get(aCampName.toLowerCase());

      if (matchedCampaignKey && campaignMap.has(matchedCampaignKey)) {
        campaignMap.get(matchedCampaignKey)!.appts.push(a);
      }
    }

    const campaigns: CampaignSummary[] = [];
    for (const [cKey, cData] of campaignMap) {
      const cSpend = cData.spendRows.reduce((s, r) => s + r.spent, 0);
      const cLeads = cData.spendRows.reduce((s, r) => s + r.leads, 0);
      const cAppts = cData.appts.length;
      const cClosed = cData.appts.filter(a => isClosedWon(a)).length;
      const cRevenue = cData.appts.reduce((s, a) => s + a.closedRevenue, 0);
      const cQualified = cData.appts.filter(a => a.leadValid?.toLowerCase() === 'valid').length;
      const cCpl = cLeads > 0 ? cSpend / cLeads : 0;
      const cLeadPct = cLeads > 0 ? (cAppts / cLeads) * 100 : 0;

      // Build ad sets
      const adSetMap = new Map<string, { spendRows: AdSpendRow[], appts: AppointmentRow[] }>();
      for (const r of cData.spendRows) {
        const key = (r.adsetId || '').trim() || (r.adsetName || '').trim();
        if (!key) continue;
        if (!adSetMap.has(key)) adSetMap.set(key, { spendRows: [], appts: [] });
        adSetMap.get(key)!.spendRows.push(r);
      }

      // Match campaign appointments to ad sets
      const asAdIdMap = new Map<string, string>();
      const asAdNameMap = new Map<string, string>();
      const asIdMap = new Map<string, string>();
      const asNameMap = new Map<string, string>();
      for (const [asKey, asData] of adSetMap) {
        for (const r of asData.spendRows) {
          const aId = (r.adId || '').trim();
          const aName = (r.adName || '').trim();
          const asId = (r.adsetId || '').trim();
          const asName = (r.adsetName || '').trim();
          if (aId) asAdIdMap.set(aId, asKey);
          if (aName) asAdNameMap.set(aName.toLowerCase(), asKey);
          if (asId) asIdMap.set(asId, asKey);
          if (asName) asNameMap.set(asName.toLowerCase(), asKey);
        }
      }

      for (const a of cData.appts) {
        const aAdId = (a.adId || '').trim();
        const aAdName = (a.adName || '').trim();
        const aAdSetId = (a.adSetId || '').trim();
        const aAdSetName = (a.adSetName || '').trim();

        let matchedAdSetKey: string | undefined;
        // Priority: adset ID (most direct) > adset name > ad ID > ad name
        if (aAdSetId) matchedAdSetKey = asIdMap.get(aAdSetId);
        if (!matchedAdSetKey && aAdSetName) matchedAdSetKey = asNameMap.get(aAdSetName.toLowerCase());
        if (!matchedAdSetKey && aAdId) matchedAdSetKey = asAdIdMap.get(aAdId);
        if (!matchedAdSetKey && aAdName) matchedAdSetKey = asAdNameMap.get(aAdName.toLowerCase());

        if (matchedAdSetKey && adSetMap.has(matchedAdSetKey)) {
          adSetMap.get(matchedAdSetKey)!.appts.push(a);
        }
      }

      const adSets: AdSetSummary[] = [];
      for (const [asKey, asData] of adSetMap) {
        const asSpend = asData.spendRows.reduce((s, r) => s + r.spent, 0);
        const asLeads = asData.spendRows.reduce((s, r) => s + r.leads, 0);
        const asAppts = asData.appts.length;
        const asClosed = asData.appts.filter(a => isClosedWon(a)).length;
        const asRevenue = asData.appts.reduce((s, a) => s + a.closedRevenue, 0);
        const asCpl = asLeads > 0 ? asSpend / asLeads : 0;
        const asLeadPct = asLeads > 0 ? (asAppts / asLeads) * 100 : 0;

        // Build individual ads within this ad set
        const adMap = new Map<string, { spendRows: AdSpendRow[], appts: AppointmentRow[] }>();
        for (const r of asData.spendRows) {
          const key = (r.adId || '').trim() || (r.adName || '').trim();
          if (!key) continue;
          if (!adMap.has(key)) adMap.set(key, { spendRows: [], appts: [] });
          adMap.get(key)!.spendRows.push(r);
        }

        const adIdMap2 = new Map<string, string>();
        const adNameMap2 = new Map<string, string>();
        for (const [adKey, adData] of adMap) {
          for (const r of adData.spendRows) {
            const aId = (r.adId || '').trim();
            const aName = (r.adName || '').trim();
            if (aId) adIdMap2.set(aId, adKey);
            if (aName) adNameMap2.set(aName.toLowerCase(), adKey);
          }
        }
        for (const a of asData.appts) {
          const aAdId = (a.adId || '').trim();
          const aAdName = (a.adName || '').trim();
          let matchedAdKey: string | undefined;
          if (aAdId) matchedAdKey = adIdMap2.get(aAdId);
          if (!matchedAdKey && aAdName) matchedAdKey = adNameMap2.get(aAdName.toLowerCase());
          if (matchedAdKey && adMap.has(matchedAdKey)) {
            adMap.get(matchedAdKey)!.appts.push(a);
          }
        }

        const ads: AdSummary[] = [];
        for (const [adKey, adData] of adMap) {
          const adSpend = adData.spendRows.reduce((s, r) => s + r.spent, 0);
          const adLeads = adData.spendRows.reduce((s, r) => s + r.leads, 0);
          const adAppts = adData.appts.length;
          const adClosed = adData.appts.filter(a => isClosedWon(a)).length;
          const adRevenue = adData.appts.reduce((s, a) => s + a.closedRevenue, 0);
          ads.push({
            adName: adData.spendRows[0]?.adName || adKey,
            adId: adData.spendRows[0]?.adId || adKey,
            spend: adSpend,
            leads: adLeads,
            cpl: adLeads > 0 ? adSpend / adLeads : 0,
            appointments: adAppts,
            costPerAppt: adAppts > 0 ? adSpend / adAppts : 0,
            closed: adClosed,
            revenue: adRevenue,
          });
        }

        adSets.push({
          adSetName: asData.spendRows[0]?.adsetName || asKey,
          adSetId: asData.spendRows[0]?.adsetId || asKey,
          spend: asSpend,
          leads: asLeads,
          cpl: asCpl,
          appointments: asAppts,
          leadPercent: asLeadPct,
          costPerAppt: asAppts > 0 ? asSpend / asAppts : 0,
          closed: asClosed,
          revenue: asRevenue,
          performance: getPerformance(asCpl, asLeadPct, thresholds, alias?.program, asAppts > 0 ? asSpend / asAppts : 0, asAppts),
          adCount: ads.length,
          ads,
        });
      }

      campaigns.push({
        campaignName: cData.spendRows[0]?.campaign || cKey,
        campaignId: cData.spendRows[0]?.campaignId || cKey,
        accountName,
        spend: cSpend,
        leads: cLeads,
        cpl: cCpl,
        appointments: cAppts,
        leadPercent: cLeadPct,
        costPerAppt: cAppts > 0 ? cSpend / cAppts : 0,
        qualified: cQualified,
        qualPercent: cAppts > 0 ? (cQualified / cAppts) * 100 : 0,
        closed: cClosed,
        revenue: cRevenue,
        performance: getPerformance(cCpl, cLeadPct, thresholds, alias?.program, cAppts > 0 ? cSpend / cAppts : 0, cAppts),
        adSets,
      });
    }

    // Collect appointments matched to excluded campaigns
    const excludedApptSet = new Set<AppointmentRow>();
    for (const [, cData] of campaignMap) {
      const campaignId = (cData.spendRows[0]?.campaignId || '').trim();
      if (excludedCampaignIds.has(campaignId)) {
        for (const a of cData.appts) excludedApptSet.add(a);
      }
    }

    // Performance appointments = only non-excluded campaigns
    const performanceAppts = data.appts.filter(a => !excludedApptSet.has(a));

    const totalAppts = performanceAppts.length;
    const closed = performanceAppts.filter(a => isClosedWon(a)).length;
    const revenue = performanceAppts.reduce((s, a) => s + a.closedRevenue, 0);
    const billed = performanceAppts.reduce((s, a) => s + a.amountCharged, 0);
    const qualified = performanceAppts.filter(a => a.leadValid?.toLowerCase() === 'valid').length;

    const cpl = performanceLeads > 0 ? performanceSpend / performanceLeads : 0;
    const leadPct = performanceLeads > 0 ? (totalAppts / performanceLeads) * 100 : 0;
    const costPerAppt = totalAppts > 0 ? performanceSpend / totalAppts : 0;
    const qualPercent = totalAppts > 0 ? (qualified / totalAppts) * 100 : 0;

    // Dial data — pre-computed above via exact + fuzzy matching
    const { dials: matchedDials, totalDuration: matchedDuration } =
      accountDialTotals.get(normalizedKey) || { dials: 0, totalDuration: 0 };

    summaries.push({
      accountName,
      program: alias?.program || 'Unknown',
      mediaBuyer: alias?.mediaBuyer || 'Unassigned',
      status: alias?.status || 'Active',
      spend: totalSpend,
      leads: totalLeads,
      performanceSpend,
      performanceLeads,
      cpl,
      appointments: totalAppts,
      leadPercent: leadPct,
      costPerAppt,
      qualified,
      qualPercent,
      closed,
      revenue,
      billed,
      /**
       * ⚠️ DO NOT DELETE AS UNUSED — the DASHBOARD stopped showing dials on 2026-08-05
       * (@andrew: "we store them on relay instead"), so a grep from that page finds no
       * consumer. IT HAS THREE LIVE ONES:
       *   Targets.tsx:156  dialsPerLead     — a target @andrew set ("sweet spot 5-20")
       *   Targets.tsx:158  dialBookingRate  — a target @andrew set ("above 8%")
       *   CallCenter.tsx   every setter-performance figure on that page
       * The display was removed; the metric was not. Deleting this silently zeroes two of
       * his targets and empties /call-center, which is why the removal was scoped to the
       * dashboard column and tile only. `src/pages/Targets.dials.test.tsx` goes RED if this
       * stops feeding the targets — verified by deleting this field, not assumed.
       */
      totalDials: matchedDials,
      dialToApptPercent: matchedDials > 0 ? (totalAppts / matchedDials) * 100 : 0,
      avgCallDuration: matchedDials > 0 ? matchedDuration / matchedDials : 0,
      spendKnown,
      apptsKnown,
      callsKnown,
      campaigns,
      appointmentList: data.appts,
    });
  }

  return { accounts: summaries.sort((a, b) => b.spend - a.spend), unmatchedAppointments };
}

export function buildTeamPerformance(accounts: AccountSummary[]): TeamMember[] {
  const teamMap = new Map<string, { name: string; accounts: AccountSummary[] }>();

  for (const account of accounts) {
    const buyer = account.mediaBuyer || 'Unassigned';
    if (!teamMap.has(buyer)) {
      teamMap.set(buyer, { name: buyer, accounts: [] });
    }
    teamMap.get(buyer)!.accounts.push(account);
  }

  return Array.from(teamMap.values()).map(tm => {
    const totalSpend = tm.accounts.reduce((s, a) => s + a.spend, 0);
    const totalLeads = tm.accounts.reduce((s, a) => s + a.leads, 0);
    const totalAppointments = tm.accounts.reduce((s, a) => s + a.appointments, 0);
    const closedDeals = tm.accounts.reduce((s, a) => s + a.closed, 0);
    const revenueGenerated = tm.accounts.reduce((s, a) => s + a.revenue, 0);

    return {
      name: tm.name,
      accountsManaged: tm.accounts.length,
      totalSpend,
      totalLeads,
      totalAppointments,
      closedDeals,
      revenueGenerated,
      avgCPL: totalLeads > 0 ? totalSpend / totalLeads : 0,
      avgLeadPercent: totalLeads > 0 ? (totalAppointments / totalLeads) * 100 : 0,
    };
  }).sort((a, b) => b.totalAppointments - a.totalAppointments);
}

export function formatCurrency(val: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
}

export function formatNumber(val: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(val));
}

export function formatPercent(val: number): string {
  return `${val.toFixed(1)}%`;
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
