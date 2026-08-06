import { supabase } from '@/integrations/supabase/client';
import type { AppSettings, AdSpendRow, AppointmentRow, AccountSummary, CampaignSummary, AdSetSummary, AdSummary, TeamMember, PerformanceLevel, CallRow } from './types';
import { convertSheetUrlToCsv, isSourceConfigured } from './config';

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
  // Without `Account Name` every row groups under 'Unknown' and the whole dashboard is one
  // fake account — a wrong tab that reads as a successful fetch.
  assertSheetSchema(rows, ['Account Name'], 'Ad spend sheet');

  return rows.map(r => ({
    month: r['Month'] || '',
    date: r['Date'] || '',
    dateISO: normalizeSourceDate(r['Date'] ?? r['date']),
    campaign: r['Campaign'] || '',
    campaignId: r['Campaign Id'] || r['Campaign ID'] || '',
    adsetName: r['Adset Name'] || r['Ad Set Name'] || '',
    adsetId: r['Adset Id'] || r['Ad Set ID'] || '',
    adName: r['Ad Name'] || '',
    adId: r['Ad Id'] || r['Ad ID'] || '',
    spent: parseNumber(r['Spent'] || r['Spend']),
    leads: parseNumber(r['Leads']),
    accountName: r['Account Name'] || '',
  }));
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
  // Without `ghl_location_name` every call keys to '' and the dial map skips it — the
  // source reports SUCCESS with N rows and the app shows 0 DIALS.
  assertSheetSchema(rows, ['ghl_location_name'], 'Call centre sheet');

  return rows.map(r => ({
    timestamp: r['Timestamp'] || '',
    ghlLocationName: r['ghl_location_name'] || '',
    agentName: r['Agent Name'] || '',
    callDuration: parseNumber(r['Call Duration']),
    callDisposition: r['call_dispostion'] || r['call_disposition'] || '',
  }));
}

export async function fetchAirtableData(settings: AppSettings): Promise<{ records: AppointmentRow[], fields: string[] }> {
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

    return mapAirtableRecords(records, columnMappings);
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
): { records: AppointmentRow[]; fields: string[] } {
  const allRecords: AppointmentRow[] = [];
  let fields: string[] = knownFields;

  {
    const data = { records };

    if (data.records.length > 0 && fields.length === 0) {
      fields = Object.keys(data.records[0].fields);
    }

    for (const rec of data.records) {
      const f = rec.fields;
      const getField = (key: string) => {
        const mapped = columnMappings[key] || key;
        const val = f[mapped];
        if (Array.isArray(val)) return val[0] || '';
        return val || '';
      };
      
      allRecords.push({
        campaignName: String(getField('Campaign Name')),
        campaignId: String(getField('Campaign ID')),
        adSetName: String(getField('Ad Set Name')),
        adSetId: String(getField('Ad Set ID')),
        adName: String(getField('Ad Name')),
        adId: String(getField('Ad ID')),
        client: String(getField('Client Name')),
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

  return { records: allRecords, fields };
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

/** Grouping key. trim+lowercase, which is what the aggregator already does — so this is
 *  behaviour-preserving, and it collapses the whitespace twins as a side effect. */
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

    // Tier 2 — Manual Alias
    if (!matchedAccountKey && appt.client) {
      matchedAccountKey = manualMappingToAccount.get(appt.client.trim().toLowerCase());
    }

    if (matchedAccountKey && accountMap.has(matchedAccountKey)) {
      accountMap.get(matchedAccountKey)!.appts.push(appt);
      // Record this client name → account mapping for Tier 3
      if (appt.client) {
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

    if (appt.client) {
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

    if (appt.client) {
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
      const cClosed = cData.appts.filter(a => a.leadStatus?.toLowerCase().includes('closed') || a.closedRevenue > 0).length;
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
        const asClosed = asData.appts.filter(a => a.leadStatus?.toLowerCase().includes('closed') || a.closedRevenue > 0).length;
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
          const adClosed = adData.appts.filter(a => a.leadStatus?.toLowerCase().includes('closed') || a.closedRevenue > 0).length;
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
    const closed = performanceAppts.filter(a => a.leadStatus?.toLowerCase().includes('closed') || a.closedRevenue > 0).length;
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
