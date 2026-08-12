/**
 * THE TRUE PRODUCTION BASELINE vs THE CUTOVER.
 *
 * ⭐ WHY THIS EXISTS BESIDE `verify-cutover.mts`. That script runs a controlled A/B in which
 * BOTH arms are handed the curated registry, so the only variable is the feed. That is the
 * right instrument for "what did the source swap do", and the wrong one for "what will
 * @andrew see change", because PRODUCTION TODAY HAS NO REGISTRY AT ALL — measured in the
 * live bundle at adsdata.socialworkspro.com: `ad_account_airtable_names` 0,
 * `ad_insights` 0, `ad_insights_resolved` 0.
 *
 * So the acceptance bar in the brief — "any account that had appointments and now has zero
 * is a FAIL" — has to be judged against the arm that is actually deployed:
 *
 *     arm A0   sheet feed + EMPTY registry   ← what production serves right now
 *     arm B    ad_insights + live registry   ← what the cutover serves
 *
 * If A0 and A disagree, then a comparison against A is a comparison against something
 * nobody is running, and a regression could hide in the gap between them.
 *
 * Run: npx vite-node scripts/baseline-vs-cutover.mts
 */
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0,
};

const { buildAccountSummaries, mapAirtableRecords } = await import('../src/lib/dataService');
const { buildAccountRegistry, emptyAccountRegistry } = await import('../src/lib/accountRegistry');
const { metaRowToAdSpendRow } = await import('../src/lib/metaAdSpend');
type AdAccountRecord = import('../src/lib/accountRegistry').AdAccountRecord;
type AirtableNameLink = import('../src/lib/accountRegistry').AirtableNameLink;
type MetaSpendRecord = import('../src/lib/metaAdSpend').MetaSpendRecord;
type AppointmentRow = import('../src/lib/types').AppointmentRow;
type AppSettings = import('../src/lib/types').AppSettings;
type AdSpendRow = import('../src/lib/types').AdSpendRow;
type AccountSummary = import('../src/lib/types').AccountSummary;
const { readFileSync } = await import('node:fs');

const env = Object.fromEntries(
  readFileSync('/Users/andrewleonard/code/socialworks-ads/.env', 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const PROJECT = 'mlwoztsytapxjgfldyzv';
const FROM = '2025-01-01';
const TO = '2026-08-11';

async function sql<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error(`SQL failed: ${JSON.stringify(j).slice(0, 300)}`);
  return j as T[];
}

const money = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (s: string | number, n: number) => String(s).padStart(n);

/* ── arm A's CSV path, verbatim from the code in production today ─────────── */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; } else { inQuotes = !inQuotes; }
    } else if (char === ',' && !inQuotes) { result.push(current); current = ''; } else { current += char; }
  }
  result.push(current);
  return result;
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
  const n = parseFloat(val.replace(/[$,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}
const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));
function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function normalizeSourceDate(raw: string | undefined): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return isRealDate(+iso[1], +iso[2], +iso[3]) ? s : '';
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) { const [, m, d, y] = mdy; return isRealDate(+y, +m, +d) ? `${y}-${pad2(+m)}-${pad2(+d)}` : ''; }
  if (/^\d{1,6}$/.test(s)) {
    const serial = Number(s);
    if (serial >= 36526 && serial <= 73050) {
      const dt = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
    }
  }
  return '';
}
const SHEET_CSV =
  'https://docs.google.com/spreadsheets/d/1g6hqd1-8A_XNUVfcd13g36jVDdHnqR4o6gX2-eCuSBE/export?format=csv&gid=0';

async function fetchSheetRows(): Promise<AdSpendRow[]> {
  const text = await fetch(SHEET_CSV).then(r => {
    if (!r.ok) throw new Error(`sheet fetch ${r.status}`);
    return r.text();
  });
  const pick = (r: Record<string, string>, ...keys: string[]) => {
    for (const k of keys) if (r[k] !== undefined && r[k] !== '') return r[k];
    return '';
  };
  return parseCsv(text).map(row => ({
    month: pick(row, 'Month'),
    date: pick(row, 'Date'),
    dateISO: normalizeSourceDate(pick(row, 'Date')),
    campaign: pick(row, 'Campaign'),
    campaignId: pick(row, 'Campaign Id', 'Campaign ID'),
    adsetName: pick(row, 'Adset Name', 'Ad Set Name'),
    adsetId: pick(row, 'Adset Id', 'Ad Set ID'),
    adName: pick(row, 'Ad Name'),
    adId: pick(row, 'Ad Id', 'Ad ID'),
    spent: parseNumber(pick(row, 'Spent', 'Spend')),
    leads: parseNumber(pick(row, 'Leads')),
    accountName: pick(row, 'Account Name'),
  })) as AdSpendRow[];
}

const sumBy = (xs: AccountSummary[], f: (a: AccountSummary) => number) => xs.reduce((n, a) => n + f(a), 0);

/**
 * Appointments per AIRTABLE CLIENT NAME, which is the one identity that is stable across
 * both arms. Keying this table on the ACCOUNT would compare a name-keyed map (arm A0)
 * against an id-keyed one (arm B) and report every account as both lost and gained.
 */
function apptsByClient(r: { accounts: AccountSummary[] }): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of r.accounts) {
    // ⚠️ `appointmentList`. The first version of this function read `appointmentRows`, which
    // does not exist on AccountSummary, so every map came back EMPTY and the "no client went
    // to zero" verdict passed while the totals on the line above said -57. A check that
    // cannot fail is not a check — hence the control in `main` that asserts these maps
    // reconcile against the per-account counts before any verdict is read.
    for (const ap of a.appointmentList ?? []) {
      const c = (ap.client || '').trim();
      if (!c) continue;
      m.set(c, (m.get(c) ?? 0) + 1);
    }
  }
  return m;
}

/** Every campaign id this arm grouped under the accounts serving a given client. */
function campaignIdsForClient(r: { accounts: AccountSummary[] }, client: string): Set<string> {
  const camps = new Set<string>();
  for (const a of r.accounts) {
    if (!(a.appointmentList ?? []).some(ap => (ap.client || '').trim() === client)) continue;
    for (const c of a.campaigns ?? []) if (c.campaignId) camps.add(c.campaignId.trim());
  }
  return camps;
}

async function main() {
  let fail = 0;
  const verdict = (ok: boolean, msg: string) => { if (!ok) fail++; return `${ok ? '✅' : '⛔'} ${msg}`; };

  const accountRows = await sql<AdAccountRecord>(
    'select account_id, meta_name, company_name, program, media_buyer, status from ad_accounts');
  const links = await sql<AirtableNameLink>(
    'select airtable_name_key, airtable_name, account_id from ad_account_airtable_names');
  const registry = buildAccountRegistry(accountRows, links);

  const [row] = await sql<{ value: AppSettings }>("select value from app_settings where key='app_settings'");
  const [maps] = await sql<{ value: AppSettings['accountAliases'] }>(
    "select value from app_settings where key='account_mappings'");
  const settings: AppSettings = { ...row.value, accountAliases: maps?.value ?? row.value.accountAliases };

  const at = await fetch(`https://${PROJECT}.supabase.co/functions/v1/airtable-proxy`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseId: settings.airtableBaseId, tableName: settings.airtableTableName }),
  }).then(r => r.json());
  if (at.status !== 'ok') throw new Error(`airtable-proxy: ${at.status} ${at.message}`);
  const mapped = mapAirtableRecords(at.records ?? [], settings.columnMappings ?? {}, at.fields ?? []);
  const appointments: AppointmentRow[] = mapped.records;

  const sheetAll = await fetchSheetRows();
  const sheetSpend = sheetAll.filter(r => r.dateISO >= FROM && r.dateISO <= TO);
  const raw = await sql<MetaSpendRecord>(
    `select date::text as date, ad_id, account_id, account_name, campaign_id, campaign_name,
            adset_id, adset_name, ad_name, spend::text as spend, leads
     from ad_insights_resolved where date >= '${FROM}' and date <= '${TO}'`);
  const metaSpend: AdSpendRow[] = raw.map(metaRowToAdSpendRow);

  /** ⭐ THE ARM PRODUCTION ACTUALLY SERVES: the sheet, and NO curated registry. */
  const A0 = buildAccountSummaries(sheetSpend, appointments, settings, undefined, emptyAccountRegistry());
  const A = buildAccountSummaries(sheetSpend, appointments, settings, undefined, registry);
  const B = buildAccountSummaries(metaSpend, appointments, settings, undefined, registry);

  console.log(`\nTHREE ARMS over ${FROM} .. ${TO}`);
  console.log(`  A0  sheet  + NO registry   ← production today   ${pad(sheetSpend.length.toLocaleString(), 7)} rows`);
  console.log(`  A   sheet  + registry      (feed isolated)      ${pad(sheetSpend.length.toLocaleString(), 7)} rows`);
  console.log(`  B   ad_insights + registry ← the cutover        ${pad(metaSpend.length.toLocaleString(), 7)} rows`);
  console.log(`  shared: ${appointments.length} Airtable appointments`);

  console.log('\n=== SPEND ==========================================================');
  console.log(`                          A0 (live today)      B (cutover)         delta`);
  const a0s = sumBy(A0.accounts, a => a.spend), bs = sumBy(B.accounts, a => a.spend);
  console.log(`  spend, all accounts    ${pad(money(a0s), 15)}   ${pad(money(bs), 15)}   ${money(bs - a0s)}`);
  console.log(`  leads, all accounts    ${pad(sumBy(A0.accounts, a => a.leads).toLocaleString(), 15)}   ${pad(sumBy(B.accounts, a => a.leads).toLocaleString(), 15)}`);
  console.log(`  RISE                   ${((bs - a0s) / a0s * 100).toFixed(1)}%`);
  console.log(`  ${verdict(bs > a0s, bs > a0s ? 'SPEND ROSE against the arm that is deployed' : 'SPEND DID NOT RISE')}`);

  console.log('\n=== APPOINTMENTS, A0 (deployed) vs B (cutover) =====================');
  const m0 = apptsByClient(A0), mB = apptsByClient(B);
  const tot0 = sumBy(A0.accounts, a => a.appointments), totB = sumBy(B.accounts, a => a.appointments);
  console.log(`  matched to an account   A0 ${tot0}   ->   B ${totB}   (${totB - tot0})`);
  console.log(`  unmatched               A0 ${A0.unmatchedAppointments.length}   ->   B ${B.unmatchedAppointments.length}`);
  console.log(`  ${verdict(tot0 + A0.unmatchedAppointments.length === appointments.length
    && totB + B.unmatchedAppointments.length === appointments.length,
    'CONSERVATION: matched + unmatched === 704 in both arms')}`);

  /**
   * ⭐ THE BRIEF'S ACCEPTANCE BAR, APPLIED LITERALLY: had appointments, now has zero.
   * Judged per Airtable client, against the DEPLOYED arm.
   */
  /**
   * ⛔ ANTI-VACUITY CONTROL — read this before any verdict below it.
   *
   * The per-client table is built by walking `appointmentList`. If that walk yields nothing
   * — a renamed field, an empty arm — then "no client went to zero" is TRUE about an empty
   * set and the whole section is decoration. It happened: the first run of this script
   * printed an empty table and a green verdict directly under `matched 704 -> 647`.
   *
   * So the maps must reconcile against `AccountSummary.appointments`, which is computed
   * independently by the aggregator. Two derivations of one quantity, and they must agree.
   */
  const sum = (m: Map<string, number>) => Array.from(m.values()).reduce((n, v) => n + v, 0);
  const recon0 = sum(m0) === tot0, reconB = sum(mB) === totB;
  console.log(`  ${verdict(recon0 && reconB && m0.size > 0,
    recon0 && reconB && m0.size > 0
      ? `CONTROL: the per-client table reconciles (${m0.size} clients, ${sum(m0)} = ${tot0} in A0, ${sum(mB)} = ${totB} in B)`
      : `CONTROL FAILED — the per-client table is not measuring the appointments: A0 ${sum(m0)} vs ${tot0}, B ${sum(mB)} vs ${totB}, ${m0.size} clients`)}`);

  const clients = Array.from(new Set([...m0.keys(), ...mB.keys()])).sort();
  console.log(`\n  per Airtable client — appointments attributed`);
  console.log(`     ${'client'.padEnd(42)} ${'A0'.padStart(5)} ${'B'.padStart(6)}   change`);
  const lost: string[] = [];
  for (const c of clients) {
    const a = m0.get(c) ?? 0, b = mB.get(c) ?? 0;
    const flag = a > 0 && b === 0 ? '   ⛔ LOST' : b > a ? `   +${b - a}` : b < a ? `   ${b - a}` : '';
    if (a > 0 && b === 0) lost.push(c);
    console.log(`     ${c.padEnd(42)} ${pad(a, 5)} ${pad(b, 6)}${flag}`);
  }
  /**
   * ⭐ THE NUMBER ON THE SCREEN, not the number in the aggregator.
   *
   * Dashboard.tsx computes TOTAL APPOINTMENTS as `sum(active accounts) + unmatched`, because
   * an appointment that matched no account is still an appointment. So a drop in ATTRIBUTION
   * does not have to be a drop in the TILE, and those two questions have to be asked
   * separately — reporting only the attribution delta would claim a regression the user
   * cannot see, and reporting only the tile would hide one they can.
   */
  const tile = (r: { accounts: AccountSummary[]; unmatchedAppointments: AppointmentRow[] }) =>
    r.accounts.filter(a => a.status === 'Active').reduce((n, a) => n + a.appointments, 0)
    + r.unmatchedAppointments.length;
  const t0 = tile(A0), tB = tile(B);
  console.log(`\n  Dashboard TOTAL APPOINTMENTS tile   A0 ${t0}   ->   B ${tB}   (${tB - t0 >= 0 ? '+' : ''}${tB - t0})`);
  console.log(`  ${verdict(tB >= t0, tB >= t0
    ? 'the tile the user reads does NOT drop'
    : `the tile DROPS by ${t0 - tB} — a visible appointment regression`)}`);

  console.log(`\n  ${verdict(lost.length === 0,
    lost.length === 0
      ? 'NO client lost all of its appointments'
      : `${lost.length} client(s) went to ZERO: ${lost.join(', ')}`)}`);

  /**
   * A client can only be attributed to an account that EXISTS in the feed. When one goes to
   * zero the question is which of two things happened, and they have opposite remedies:
   *   · the account is in ad_insights and the JOIN missed it   → a defect in this change
   *   · the account is not in ad_insights at all               → a coverage gap in the pull
   * Named by ACCOUNT ID and by CAMPAIGN ID, never by display name, because a rename is
   * exactly the thing a name-based answer would get wrong here.
   */
  if (lost.length) {
    console.log('\n=== WHY EACH LOST CLIENT LOST ATTRIBUTION ==========================');
    for (const c of lost) {
      const labels = new Set<string>();
      for (const a of A0.accounts) {
        if ((a.appointmentList ?? []).some(ap => (ap.client || '').trim() === c)) labels.add(a.accountName);
      }
      const campList = Array.from(campaignIdsForClient(A0, c));
      const hits = campList.length
        ? await sql<{ n: number }>(
          `select count(*)::int n from ad_insights where campaign_id in (${campList.map(x => `'${x}'`).join(',')})`)
        : [{ n: 0 }];
      const nameHits = await sql<{ n: number }>(
        `select count(*)::int n from ad_insights where ${Array.from(labels)
          .map(l => `account_name = '${l.replace(/'/g, "''")}'`).join(' or ') || 'false'}`);
      console.log(`  ${c} — ${m0.get(c)} appointments`);
      console.log(`     A0 attached them to  : ${Array.from(labels).map(l => `"${l}"`).join(', ')}`);
      console.log(`     in ad_insights by NAME     : ${nameHits[0].n} rows`);
      console.log(`     in ad_insights by CAMPAIGN : ${hits[0].n} rows  (${campList.length} campaign ids checked)`);
      console.log(`     => ${hits[0].n === 0 && nameHits[0].n === 0
        ? 'ABSENT FROM THE FEED — coverage gap in the Meta pull, not a join defect'
        : '🔴 PRESENT IN THE FEED AND STILL UNMATCHED — that is a JOIN DEFECT'}`);
    }
  }

  console.log(`\n${fail === 0 ? '✅ NO REGRESSION AGAINST THE DEPLOYED ARM' : `⛔ ${fail} CHECK(S) FAILED`}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
