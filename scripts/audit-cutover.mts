/**
 * INDEPENDENT CUTOVER AUDIT — written by the verifying seat, not the implementing one.
 *
 * Differs from scripts/verify-cutover.mts on the one axis that matters: it drives
 * `fetchMetaAdSpend` over REAL PostgREST with the anon key — the browser's path, paging
 * loop included — instead of pulling rows over the management API. The 1000-row cap and a
 * paging loop that stops early can only be caught on that path.
 *
 * Run: npx vite-node scripts/audit-cutover.mts
 */
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0,
};

const { fetchMetaAdSpend, checkMetaCompleteness, ALL_DATES } = await import('../src/lib/metaAdSpend');
const { buildAccountSummaries } = await import('../src/lib/dataService');
const { buildAccountRegistry } = await import('../src/lib/accountRegistry');
const { isSupabaseConfigured } = await import('../src/integrations/supabase/client');
type AdSpendRow = import('../src/lib/types').AdSpendRow;
type AppSettings = import('../src/lib/types').AppSettings;
type AppointmentRow = import('../src/lib/types').AppointmentRow;
type AdAccountRecord = import('../src/lib/accountRegistry').AdAccountRecord;
type AirtableNameLink = import('../src/lib/accountRegistry').AirtableNameLink;

const { readFileSync } = await import('node:fs');
const env = Object.fromEntries(
  readFileSync('/Users/andrewleonard/code/socialworks-ads/.env', 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const PROJECT = 'mlwoztsytapxjgfldyzv';

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
const near = (a: number, b: number, tol = 0.005) => Math.abs(a - b) < tol;
const SPAN = { from: '2025-01-01', to: '2026-08-11' };
const results: [string, boolean, string][] = [];
const check = (name: string, pass: boolean, detail: string) => {
  results.push([name, pass, detail]);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`);
};

/** The sheet-era numbers, from reconciliation-baseline.md. */
const SHEET = { spend: 604025.09, leads: 26788, rows: 37006 };

async function main() {
  console.log(`supabase configured in this process: ${isSupabaseConfigured}`);
  if (!isSupabaseConfigured) throw new Error('VITE_ env not loaded — the harness would prove nothing.');

  // ── A. the REAL browser fetch path, paged ────────────────────────────────
  const t0 = Date.now();
  const rows: AdSpendRow[] = await fetchMetaAdSpend(undefined, SPAN);
  const ms = Date.now() - t0;
  const spend = rows.reduce((n, r) => n + r.spent, 0);
  const leads = rows.reduce((n, r) => n + r.leads, 0);

  const [truth] = await sql<{ rows: number; spend: string; leads: number; accts: number }>(
    `select count(*)::int rows, round(sum(spend)::numeric,2)::text spend, sum(leads)::int leads,
            count(distinct account_id)::int accts
     from ad_insights_resolved where date between '${SPAN.from}' and '${SPAN.to}'`);

  console.log(`\n──── A. fetchMetaAdSpend over live PostgREST (${ms} ms) ────`);
  check('A1 paging returns every row (no 1000-row cap, no early stop)',
    rows.length === truth.rows,
    `fetched ${rows.length.toLocaleString()} rows, database holds ${truth.rows.toLocaleString()}`);
  check('A2 spend over the fetched rows equals the database',
    near(spend, Number(truth.spend), 0.01),
    `app ${money(spend)} vs sql ${money(Number(truth.spend))}`);
  check('A3 leads over the fetched rows equals the database',
    leads === truth.leads, `app ${leads.toLocaleString()} vs sql ${truth.leads.toLocaleString()}`);

  const dupes = new Set<string>(); let dupCount = 0;
  for (const r of rows) { const k = `${r.dateISO}|${r.adId}`; if (dupes.has(k)) dupCount++; else dupes.add(k); }
  check('A4 no duplicated or overlapping rows across page boundaries',
    dupCount === 0, `${dupCount} duplicate (date, ad_id) keys in ${rows.length.toLocaleString()} rows`);

  const comp = await checkMetaCompleteness(rows.length, SPAN);
  check('A5 completeness probe reports complete',
    comp.state === 'complete', `state=${comp.state} raw=${comp.rawRows} derived=${comp.derivedRows} reason=${comp.reason ?? 'none'}`);

  // ── B. the headline must RISE ────────────────────────────────────────────
  console.log('\n──── B. the headline ────');
  const delta = spend - SHEET.spend;
  check('B1 all-time spend ROSE vs the sheet era',
    delta > 0, `${money(SHEET.spend)} -> ${money(spend)} = ${delta >= 0 ? '+' : ''}${money(delta)} (${((delta / SHEET.spend) * 100).toFixed(1)}%)`);
  check('B2 all-time spend matches the baseline $770,920.57',
    near(spend, 770920.57, 1.0), `${money(spend)} vs baseline $770,920.57`);
  check('B3 all-time leads match the baseline 30,964',
    leads === 30964, `${leads.toLocaleString()} vs baseline 30,964 (sheet era ${SHEET.leads.toLocaleString()})`);

  // ── C. month by month vs the baseline ────────────────────────────────────
  console.log('\n──── C. month by month (app-computed vs baseline) ────');
  const BASE: Record<string, [number, number]> = {
    '2025-01': [23958.84, 832], '2025-02': [16077.01, 791], '2025-03': [22402.94, 1045],
    '2025-04': [30517.36, 1352], '2025-05': [33184.04, 1285], '2025-06': [29248.12, 1147],
    '2025-07': [30336.44, 1395], '2025-08': [35693.95, 1579], '2025-09': [42157.44, 2168],
    '2025-10': [54701.28, 2413], '2025-11': [61357.16, 3213], '2025-12': [41813.41, 1488],
    '2026-01': [24332.60, 939], '2026-02': [28337.66, 1051], '2026-03': [44275.58, 1752],
    '2026-04': [49815.59, 1833], '2026-05': [56296.16, 1961], '2026-06': [61212.41, 1901],
    '2026-07': [63481.15, 2171], '2026-08': [21721.43, 648],
  };
  /** The sheet's month totals, so "it moved" is provable per month, not just in aggregate. */
  const SHEET_MONTH: Record<string, number> = {
    '2025-01': 17468.71, '2025-02': 12888.89, '2025-03': 13144.44, '2025-04': 26913.44,
    '2025-05': 28606.03, '2025-06': 30802.43, '2025-07': 32757.61, '2025-08': 34754.27,
    '2025-09': 39797.92, '2025-10': 45607.21, '2025-11': 51206.40, '2025-12': 31146.22,
    '2026-01': 21663.95, '2026-02': 24977.01, '2026-03': 39201.74, '2026-04': 43490.44,
    '2026-05': 48346.51, '2026-06': 53946.28, '2026-07': 0, '2026-08': 7305.59,
  };
  const byMonth = new Map<string, { s: number; l: number }>();
  for (const r of rows) {
    const m = r.dateISO.slice(0, 7);
    const c = byMonth.get(m) ?? { s: 0, l: 0 };
    c.s += r.spent; c.l += r.leads; byMonth.set(m, c);
  }
  let monthsOk = 0; const monthBad: string[] = [];
  console.log('month     app spend      baseline      sheet-era      move');
  for (const m of Object.keys(BASE)) {
    const got = byMonth.get(m) ?? { s: 0, l: 0 };
    const [eS, eL] = BASE[m];
    const ok = near(got.s, eS, 0.02) && got.l === eL;
    if (ok) monthsOk++; else monthBad.push(`${m} got ${money(got.s)}/${got.l} want ${money(eS)}/${eL}`);
    const mv = got.s - SHEET_MONTH[m];
    console.log(`${m}  ${money(got.s).padStart(12)}  ${money(eS).padStart(12)}  ${money(SHEET_MONTH[m]).padStart(12)}  ${(mv >= 0 ? '+' : '') + money(mv)}  ${ok ? '' : '  <-- MISMATCH'}`);
  }
  check('C1 every month reconciles to the baseline',
    monthBad.length === 0, `${monthsOk}/20 months exact${monthBad.length ? ' — ' + monthBad.join('; ') : ''}`);
  const jul = byMonth.get('2026-07') ?? { s: 0, l: 0 };
  check('C2 2026-07 renders, where the sheet had nothing',
    near(jul.s, 63481.15, 0.02) && jul.l === 2171, `${money(jul.s)} / ${jul.l} leads (sheet: absent)`);
  const jun25 = byMonth.get('2025-06')!, jul25 = byMonth.get('2025-07')!;
  check('C3 2025-06 and 2025-07 tick DOWN, as the baseline predicts',
    jun25.s < 30802.43 && jul25.s < 32757.61,
    `2025-06 $30,802.43 -> ${money(jun25.s)}, 2025-07 $32,757.61 -> ${money(jul25.s)}`);

  // ── D. the known-good day ────────────────────────────────────────────────
  console.log('\n──── D. known-good day 2026-08-08 ────');
  const day = rows.filter(r => r.dateISO === '2026-08-08');
  const dS = day.reduce((n, r) => n + r.spent, 0), dL = day.reduce((n, r) => n + r.leads, 0);
  const dA = new Set(day.map(r => r.accountId)).size;
  check('D1 2026-08-08 is exactly 83 rows / $1,878.78 / 56 leads / 22 accounts',
    day.length === 83 && near(dS, 1878.78) && dL === 56 && dA === 22,
    `rows ${day.length} · ${money(dS)} · ${dL} leads · ${dA} accounts`);

  const aug1to7 = rows.filter(r => r.dateISO >= '2026-08-01' && r.dateISO <= '2026-08-07');
  check('D2 2026-08-01..07 render non-zero (absent from the sheet entirely)',
    aug1to7.length > 0 && aug1to7.reduce((n, r) => n + r.spent, 0) > 0,
    `${aug1to7.length} rows, ${money(aug1to7.reduce((n, r) => n + r.spent, 0))}`);

  // ── E. a NARROW window must be filtered in SQL and still be right ────────
  console.log('\n──── E. SQL-side windowing ────');
  const wRows = await fetchMetaAdSpend(undefined, { from: '2026-08-08', to: '2026-08-08' });
  const wS = wRows.reduce((n, r) => n + r.spent, 0);
  check('E1 a one-day window returns that day only, and the same numbers',
    wRows.length === 83 && near(wS, 1878.78) && wRows.every(r => r.dateISO === '2026-08-08'),
    `${wRows.length} rows, ${money(wS)}, all dates == 2026-08-08: ${wRows.every(r => r.dateISO === '2026-08-08')}`);

  // ── F. the app's OWN aggregation ─────────────────────────────────────────
  console.log('\n──── F. buildAccountSummaries — what the pages render ────');
  const accountsRaw = await sql<AdAccountRecord>(
    'select account_id, meta_name, company_name, program, media_buyer, status from ad_accounts');
  let links: AirtableNameLink[] = [];
  let linkTableExists = true;
  try {
    links = await sql<AirtableNameLink>(
      'select airtable_name_key, airtable_name, account_id from ad_account_airtable_names');
  } catch { linkTableExists = false; }
  const registry = buildAccountRegistry(accountsRaw, links);

  const [sRow] = await sql<{ value: AppSettings }>("select value from app_settings where key='app_settings'");
  const [mRow] = await sql<{ value: AppSettings['accountAliases'] }>(
    "select value from app_settings where key='account_mappings'");
  const settings: AppSettings = { ...sRow.value, accountAliases: mRow?.value ?? sRow.value.accountAliases };

  const at = await fetch(`https://${PROJECT}.supabase.co/functions/v1/airtable-proxy`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseId: settings.airtableBaseId, tableName: settings.airtableTableName }),
  }).then(r => r.json());
  const cm = settings.columnMappings ?? {};
  const g = (f: Record<string, unknown>, k: string) => {
    const v = f[cm[k] || k];
    return String((Array.isArray(v) ? v[0] : v) ?? '').trim();
  };
  const appointments: AppointmentRow[] = (at.records ?? []).map((r: { fields: Record<string, unknown> }) => ({
    client: g(r.fields, 'Client Name'), campaignId: g(r.fields, 'Campaign ID'),
    campaignName: g(r.fields, 'Campaign Name'), adSetId: g(r.fields, 'Ad Set ID'),
    adSetName: g(r.fields, 'Ad Set Name'), adId: g(r.fields, 'Ad ID'), adName: g(r.fields, 'Ad Name'),
    appointmentDate: g(r.fields, 'Appointment Date'), dateAdded: g(r.fields, 'Date Added'),
  } as AppointmentRow));

  const res = buildAccountSummaries(rows, appointments, settings, undefined, registry);
  const sum = (xs: typeof res.accounts, f: (a: typeof res.accounts[number]) => number) => xs.reduce((n, a) => n + f(a), 0);
  const allSpend = sum(res.accounts, a => a.spend);
  const active = res.accounts.filter(a => a.status === 'Active');
  const tileSpend = sum(active, a => a.spend);
  const tileLeads = sum(active, a => a.leads);

  check('F1 summaries conserve every dollar the feed carries',
    near(allSpend, spend, 0.01), `summaries ${money(allSpend)} vs feed ${money(spend)}`);
  console.log(`      Dashboard "Total Spend" tile (status Active only): ${money(tileSpend)}, ${tileLeads.toLocaleString()} leads`);
  console.log(`      accounts: ${res.accounts.length} total, ${active.length} Active`);
  check('F2 the Dashboard tile itself is above the whole sheet-era total',
    tileSpend > SHEET.spend, `tile ${money(tileSpend)} vs sheet-era all-accounts ${money(SHEET.spend)}`);

  // ── G. THE TRAP — appointments must not drop ─────────────────────────────
  console.log('\n──── G. the appointment join ────');
  const matched = sum(res.accounts, a => a.appointments);
  const unmatched = res.unmatchedAppointments.length;
  check('G1 appointments are conserved: matched + unmatched == Airtable records',
    matched + unmatched === appointments.length,
    `${matched} matched + ${unmatched} unmatched = ${matched + unmatched} of ${appointments.length} Airtable records`);

  check('G2 the stable account_id -> airtable-name link table exists and is populated',
    linkTableExists && links.length > 0,
    linkTableExists ? `${links.length} names over ${new Set(links.map(l => l.account_id)).size} accounts` : 'ad_account_airtable_names DOES NOT EXIST');

  // The five renamed accounts must each be ONE summary and must keep appointments.
  const RENAMES: [string, string][] = [
    ['322974296642516', 'Washbroz'], ['10170221', 'Columbia Outdoor Restoration'],
    ['222178771', 'Pro Clean Mobile Wash'], ['103578393327348', 'TrueClean'],
    ['2264268834091190', 'Hydro Pro Wash'],
  ];
  const namesById = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!namesById.has(r.accountId)) namesById.set(r.accountId, new Set());
    namesById.get(r.accountId)!.add(r.accountName);
  }
  let collapseOk = true; const collapseDetail: string[] = [];
  for (const [id, label] of RENAMES) {
    const feedNames = [...(namesById.get(id) ?? [])];
    const summaries = res.accounts.filter(a => feedNames.includes(a.accountName));
    const spendHere = sum(summaries, a => a.spend);
    const apptsHere = sum(summaries, a => a.appointments);
    if (summaries.length !== 1) collapseOk = false;
    collapseDetail.push(`${label}: ${summaries.length} summary, ${money(spendHere)}, ${apptsHere} appts`);
  }
  check('G3 each renamed account collapses to ONE summary row',
    collapseOk, collapseDetail.join(' | '));

  // Isolate what the link table did: same data, empty link table.
  const noLink = buildAccountSummaries(rows, appointments, settings, undefined, buildAccountRegistry(accountsRaw, []));
  const noLinkMatched = sum(noLink.accounts, a => a.appointments);
  check('G4 the link table ATTACHES appointments rather than detaching them',
    matched >= noLinkMatched,
    `matched with links ${matched}, without links ${noLinkMatched} (delta ${matched - noLinkMatched})`);

  const byClient = new Map<string, number>();
  for (const a of res.unmatchedAppointments) byClient.set(a.client, (byClient.get(a.client) ?? 0) + 1);
  console.log('      unmatched appointments by client:');
  for (const [c, n] of [...byClient].sort((x, y) => y[1] - x[1]).slice(0, 20)) {
    console.log(`        ${String(n).padStart(4)}  ${c || '(blank)'}`);
  }

  console.log('\n      per-account appointments (top 30):');
  for (const a of res.accounts.filter(x => x.appointments > 0).sort((x, y) => y.appointments - x.appointments).slice(0, 30)) {
    console.log(`        ${String(a.appointments).padStart(4)}  ${(a.companyName ?? a.accountName).slice(0, 44)}`);
  }

  // ── SUMMARY ──────────────────────────────────────────────────────────────
  const failed = results.filter(([, p]) => !p);
  console.log(`\n════ ${results.length - failed.length}/${results.length} checks PASS ════`);
  for (const [n, , d] of failed) console.log(`  FAIL ${n}\n       ${d}`);
}

main().catch(e => { console.error(e); process.exit(1); });
export {};
