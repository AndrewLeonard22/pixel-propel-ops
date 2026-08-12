/**
 * INDEPENDENT CUTOVER PROOF — a THIRD instrument, written from the brief, not from the
 * implementation. It does not import scripts/verify-cutover.mts or scripts/qa-verify.mts
 * and does not reuse their reducers.
 *
 * It answers exactly four questions, each with a control:
 *   ① Does the sheet total reproduce the brief's $662,135.29?      (BEFORE, measured live)
 *   ② Does ad_insights reproduce the brief's $770,618.10?          (AFTER, measured live)
 *   ③ Does the dashboard number RISE by ~$108,469 / 14.1%?         (the delta that must move)
 *   ④ Do APPOINTMENT COUNTS SURVIVE the identity change?           (the trap)
 *
 * ④ is the one that matters. It runs the app's real `buildAccountSummaries` TWICE over the
 * SAME real Airtable records — once fed the sheet rows through the old name-keyed path, once
 * fed ad_insights rows through the new account_id-keyed path — and diffs attribution.
 */
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0,
};

const { fetchMetaAdSpend, ALL_DATES, checkMetaCompleteness } = await import('../src/lib/metaAdSpend');
const { fetchAccountRegistry, emptyAccountRegistry } = await import('../src/lib/accountRegistry');
const { buildAccountSummaries, fetchAirtableData, normalizeSourceDate } = await import('../src/lib/dataService');
const { supabase, isSupabaseConfigured } = await import('../src/integrations/supabase/client');

type AdSpendRow = import('../src/lib/types').AdSpendRow;
type AppSettings = import('../src/lib/types').AppSettings;
type AppointmentRow = import('../src/lib/types').AppointmentRow;

const usd = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number) => n.toFixed(2) + '%';
let FAILURES = 0;
const check = (label: string, ok: boolean, detail: string) => {
  if (!ok) FAILURES++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}\n        ${detail}`);
};

/* ───────────────────────── the OLD sheet path, verbatim from git HEAD ───────────────── */
function parseCSVLine(line: string): string[] {
  const result: string[] = []; let current = ''; let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; } else { inQuotes = !inQuotes; }
    } else if (char === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += char; }
  }
  result.push(current); return result;
}
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h.trim()] = (values[idx] || '').trim(); });
    rows.push(row);
  }
  return rows;
}
function parseNumber(val: string | undefined): number {
  if (!val) return 0;
  const num = parseFloat(val.replace(/[$,\s]/g, ''));
  return isNaN(num) ? 0 : num;
}
const foldKeys = (row: Record<string, string>) => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) out[k.trim().toLowerCase()] = v;
  return out;
};
const pick = (r: Record<string, string>, ...names: string[]) => {
  for (const n of names) { const v = r[n.trim().toLowerCase()]; if (v !== undefined && v !== '') return v; }
  return '';
};
function convertSheetUrlToCsv(url: string): string {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) return '';
  const gidMatch = url.match(/gid=(\d+)/);
  return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gidMatch ? gidMatch[1] : '0'}`;
}
async function fetchSheetRows(url: string): Promise<AdSpendRow[]> {
  const csvUrl = convertSheetUrlToCsv(url);
  if (!csvUrl) throw new Error('Invalid Google Sheet URL');
  const res = await fetch(csvUrl);
  if (!res.ok) throw new Error(`sheet fetch ${res.status}`);
  const rows = parseCsv(await res.text());
  return rows.map(row => {
    const r = foldKeys(row);
    return {
      month: pick(r, 'Month'), date: pick(r, 'Date'), dateISO: normalizeSourceDate(pick(r, 'Date')),
      campaign: pick(r, 'Campaign'), campaignId: pick(r, 'Campaign Id', 'Campaign ID'),
      adsetName: pick(r, 'Adset Name', 'Ad Set Name'), adsetId: pick(r, 'Adset Id', 'Ad Set ID'),
      adName: pick(r, 'Ad Name'), adId: pick(r, 'Ad Id', 'Ad ID'),
      spent: parseNumber(pick(r, 'Spent', 'Spend')), leads: parseNumber(pick(r, 'Leads')),
      accountName: pick(r, 'Account Name'),
    } as AdSpendRow;
  });
}

/* ───────────────────────────────────── run ─────────────────────────────────────────── */
const TODAY = new Date().toISOString().slice(0, 10);
const FROM = '2025-01-01';
const inWindow = (r: AdSpendRow) => { const d = r.dateISO || r.date; return !!d && d >= FROM && d <= TODAY; };
const sum = (rows: AdSpendRow[], f: (r: AdSpendRow) => number) => rows.reduce((s, r) => s + f(r), 0);

console.log(`\n================ INDEPENDENT CUTOVER PROOF — window ${FROM}..${TODAY} ================`);
console.log(`supabase configured: ${isSupabaseConfigured}`);
console.log(`supabase url       : ${(process.env.VITE_SUPABASE_URL || '').replace(/https:\/\//, '')}`);

// settings straight from the DB — this is what production reads
const { data: settingsRow } = await (supabase as any).from('app_settings').select('key, value').eq('key', 'app_settings').maybeSingle();
const stored = (settingsRow?.value ?? {}) as Record<string, unknown>;
const settings = stored as unknown as AppSettings;
const sheetUrl = String(stored.googleSheetUrl ?? '');
console.log(`stored sheet url   : ${sheetUrl ? sheetUrl.slice(0, 62) + '…' : '(none)'}`);
console.log(`accountAliases     : ${(settings.accountAliases || []).length}`);

/* ① BEFORE — the sheet */
console.log('\n─── ① BEFORE: the Google Sheet (the number production shows today) ───');
let sheetRows: AdSpendRow[] = [];
try {
  sheetRows = await fetchSheetRows(sheetUrl);
} catch (e) {
  console.log(`  sheet fetch FAILED: ${(e as Error).message}`);
}
const sheetWin = sheetRows.filter(inWindow);
const sheetSpend = sum(sheetWin, r => r.spent);
const sheetLeads = sum(sheetWin, r => r.leads);
console.log(`  rows fetched  : ${sheetRows.length.toLocaleString()}   in window: ${sheetWin.length.toLocaleString()}`);
console.log(`  SHEET SPEND   : ${usd(sheetSpend)}`);
console.log(`  SHEET LEADS   : ${sheetLeads.toLocaleString()}`);
console.log(`  distinct names: ${new Set(sheetWin.map(r => r.accountName.trim().toLowerCase())).size}`);

/* ② AFTER — ad_insights through the app's own code + anon key */
console.log('\n─── ② AFTER: ad_insights_resolved via the app\'s real fetch path ───');
const metaRows = await fetchMetaAdSpend(settings, ALL_DATES);
const completeness = await checkMetaCompleteness(metaRows.length, ALL_DATES);
const metaWin = metaRows.filter(inWindow);
const metaSpend = sum(metaWin, r => r.spent);
const metaLeads = sum(metaWin, r => r.leads);
console.log(`  rows fetched  : ${metaRows.length.toLocaleString()}   in window: ${metaWin.length.toLocaleString()}`);
console.log(`  completeness  : ${completeness.state}  (source ${completeness.rawRows?.toLocaleString()} / held ${completeness.derivedRows?.toLocaleString()})`);
console.log(`  SUPABASE SPEND: ${usd(metaSpend)}`);
console.log(`  SUPABASE LEADS: ${metaLeads.toLocaleString()}`);
console.log(`  distinct ids  : ${new Set(metaWin.map(r => r.accountId)).size}`);

/* ③ THE DELTA THAT MUST MOVE UP */
console.log('\n─── ③ THE DELTA — the dashboard number must RISE ───');
const delta = metaSpend - sheetSpend;
const deltaPct = sheetSpend > 0 ? (delta / sheetSpend) * 100 : 0;
console.log(`  ${usd(sheetSpend)}  ->  ${usd(metaSpend)}`);
console.log(`  DELTA         : ${delta >= 0 ? '+' : ''}${usd(delta)}   (${delta >= 0 ? '+' : ''}${pct(deltaPct)})`);
check('spend RISES (unchanged or lower = silent failure)', delta > 0, `delta ${usd(delta)}`);
check('delta is the expected ~$108,469 / 14.1% (±$15k)', Math.abs(delta - 108469) < 15000, `expected ~$108,469, measured ${usd(delta)}`);
check('completeness is `complete`', completeness.state === 'complete', `state=${completeness.state}`);

/* known-good day */
console.log('\n─── known-good day 2026-08-08 (brief: 83 rows, $1,878.78, 56 leads, 22 accounts) ───');
const day = metaRows.filter(r => (r.dateISO || r.date) === '2026-08-08');
const dSpend = sum(day, r => r.spent), dLeads = sum(day, r => r.leads);
const dAccts = new Set(day.map(r => r.accountId)).size;
console.log(`  measured: ${day.length} rows, ${usd(dSpend)}, ${dLeads} leads, ${dAccts} accounts`);
check('2026-08-08 reproduces the brief exactly', day.length === 83 && Math.abs(dSpend - 1878.78) < 0.005 && dLeads === 56 && dAccts === 22,
  `rows ${day.length}/83  spend ${usd(dSpend)}/$1,878.78  leads ${dLeads}/56  accounts ${dAccts}/22`);

/* ④ THE TRAP — appointments must not detach */
console.log('\n─── ④ THE TRAP: appointment attribution across the identity change ───');
const airtable = await fetchAirtableData(settings);
const appts: AppointmentRow[] = airtable.records;
console.log(`  Airtable records fetched: ${appts.length.toLocaleString()}  (unresolved links: ${airtable.unresolvedLinks ?? 0})`);

const registry = await fetchAccountRegistry();
console.log(`  registry: known=${registry.known}  accounts=${registry.size}  airtableNames=${registry.airtableNameCount}`);

// BEFORE: sheet rows, no registry — exactly the pre-cutover call
const before = buildAccountSummaries(sheetWin, appts, settings, undefined, emptyAccountRegistry());
// AFTER: supabase rows + the real registry — exactly what the app does now
const after = buildAccountSummaries(metaWin, appts, settings, undefined, registry);

const matched = (s: { accounts: { appointments: number }[] }) => s.accounts.reduce((n, a) => n + a.appointments, 0);
const bMatched = matched(before), aMatched = matched(after);
console.log(`  BEFORE: ${before.accounts.length} accounts, ${bMatched} appointments attributed, ${before.unmatchedAppointments.length} unmatched`);
console.log(`  AFTER : ${after.accounts.length} accounts, ${aMatched} appointments attributed, ${after.unmatchedAppointments.length} unmatched`);
check('attributed appointments do NOT drop', aMatched >= bMatched, `before ${bMatched} -> after ${aMatched} (${aMatched - bMatched >= 0 ? '+' : ''}${aMatched - bMatched})`);
check('unmatched appointments do NOT grow', after.unmatchedAppointments.length <= before.unmatchedAppointments.length,
  `before ${before.unmatchedAppointments.length} -> after ${after.unmatchedAppointments.length}`);

// conservation: every appointment is either attributed or unmatched, in both worlds
check('BEFORE conserves every appointment', bMatched + before.unmatchedAppointments.length === appts.length,
  `${bMatched} + ${before.unmatchedAppointments.length} = ${bMatched + before.unmatchedAppointments.length} vs ${appts.length}`);
check('AFTER conserves every appointment', aMatched + after.unmatchedAppointments.length === appts.length,
  `${aMatched} + ${after.unmatchedAppointments.length} = ${aMatched + after.unmatchedAppointments.length} vs ${appts.length}`);

/* WHICH appointments detached, and WHY — the diagnostic, not just the count */
const bUnmatched = new Set(before.unmatchedAppointments);
const newlyUnmatched = after.unmatchedAppointments.filter(a => !bUnmatched.has(a));
const byClientName = new Map<string, number>();
for (const a of newlyUnmatched) {
  const c = (a.client || '(blank)').trim();
  byClientName.set(c, (byClientName.get(c) ?? 0) + 1);
}
console.log(`\n  appointments that were ATTRIBUTED before and are UNMATCHED after: ${newlyUnmatched.length}`);
console.log('  by Airtable client name:');
for (const [c, n] of [...byClientName.entries()].sort((x, y) => y[1] - x[1])) {
  const inRegistry = registry.airtableNameToAccountId(c);
  const sheetHasName = sheetWin.some(r => r.accountName.trim().toLowerCase() === c.trim().toLowerCase());
  const metaHasName = metaWin.some(r => r.accountName.trim().toLowerCase() === c.trim().toLowerCase());
  console.log(`     ${String(n).padStart(3)}  "${c}"`);
  console.log(`          registry->account_id: ${inRegistry ?? 'NONE'}   name in sheet: ${sheetHasName}   name in ad_insights: ${metaHasName}`);
}
check('no appointment is DETACHED by the cutover', newlyUnmatched.length === 0, `${newlyUnmatched.length} detached`);

/**
 * ⭐ THE NUMBER THE USER ACTUALLY SEES. Dashboard.tsx `totals`:
 *     appts = activeAccounts.reduce(a => a.appointments) + unmatchedInView
 * so an unmatched appointment IS in the headline, and a CHURNED account's appointments are
 * NOT. Attribution moving is not the same question as the tile moving, and only one of them
 * is what @andrew reads.
 */
console.log('\n─── the RENDERED tile: TOTAL APPTS = active accounts + unmatched ───');
const tileAppts = (s: typeof before) =>
  s.accounts.filter(a => a.status === 'Active').reduce((n, a) => n + a.appointments, 0) + s.unmatchedAppointments.length;
const tileSpend = (s: typeof before) =>
  s.accounts.filter(a => a.status === 'Active').reduce((n, a) => n + a.spend, 0);
const bTile = tileAppts(before), aTile = tileAppts(after);
console.log(`  TOTAL APPTS   BEFORE ${bTile}   AFTER ${aTile}   (${aTile - bTile >= 0 ? '+' : ''}${aTile - bTile})`);
console.log(`  TOTAL SPEND   BEFORE ${usd(tileSpend(before))}   AFTER ${usd(tileSpend(after))}`);
check('the RENDERED appointment tile does not drop', aTile >= bTile, `${bTile} -> ${aTile}`);
check('the RENDERED spend tile RISES', tileSpend(after) > tileSpend(before), `${usd(tileSpend(before))} -> ${usd(tileSpend(after))}`);

/* status of the three detached clients' old accounts — were they even in the tile before? */
console.log('\n  status of the accounts the 57 used to hang off (BEFORE world):');
for (const [c] of byClientName) {
  const hosts = before.accounts.filter(a => a.appointmentList?.some(x => (x.client || '').trim().toLowerCase() === c.trim().toLowerCase()));
  for (const h of hosts) console.log(`     "${c}" -> account "${h.accountName}"  status=${h.status}  spend=${usd(h.spend)}  appts=${h.appointments}`);
}

/* the renamed accounts named in the brief */
console.log('\n─── the renamed accounts (a name join would have split these) ───');
for (const probe of ['Washbroz', 'Columbia Outdoor Restoration', 'Hydro Pro Wash', 'TrueClean', 'Pro Clean Mobile Wash']) {
  const aHits = after.accounts.filter(a => (a.accountName || '').toLowerCase().includes(probe.toLowerCase()) || (a.companyName || '').toLowerCase().includes(probe.toLowerCase()));
  const bHits = before.accounts.filter(a => (a.accountName || '').toLowerCase().includes(probe.toLowerCase()));
  console.log(`  ${probe.padEnd(30)} BEFORE ${bHits.length} acct(s)/${bHits.reduce((s, a) => s + a.appointments, 0)} appts   AFTER ${aHits.length} acct(s)/${aHits.reduce((s, a) => s + a.appointments, 0)} appts`);
}

console.log(`\n================ ${FAILURES === 0 ? 'ALL CHECKS PASS' : FAILURES + ' CHECK(S) FAILED'} ================\n`);
process.exit(FAILURES === 0 ? 0 : 1);
