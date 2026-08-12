/**
 * INDEPENDENT CUTOVER VERIFICATION — written by the QA seat, not the implementer.
 *
 * Deliberately different instrument from scripts/verify-cutover.mts:
 *   · that script queries the MANAGEMENT API (service-role, bypasses RLS)
 *   · this one goes through `src/integrations/supabase/client.ts` — the SAME anon key
 *     the browser compiles into the bundle. If RLS blocks the anon role, the management
 *     API cannot see it and this can.
 *
 * It runs the app's real refresh path and then replicates Dashboard.tsx's `totals`
 * reducer exactly, so what it prints is what a tile renders.
 */
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0,
};

const { fetchMetaAdSpend, checkMetaCompleteness, ALL_DATES } = await import('../src/lib/metaAdSpend');
const { fetchAccountRegistry } = await import('../src/lib/accountRegistry');
const { buildAccountSummaries, fetchAirtableData } = await import('../src/lib/dataService');
const { loadSettingsWithSource } = await import('../src/lib/config');
const { isSupabaseConfigured, supabase } = await import('../src/integrations/supabase/client');

type AdSpendRow = import('../src/lib/types').AdSpendRow;
type AppointmentRow = import('../src/lib/types').AppointmentRow;
type AppSettings = import('../src/lib/types').AppSettings;
type AccountSummary = import('../src/lib/types').AccountSummary;

const usd = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

console.log('=== ENV ===');
console.log('isSupabaseConfigured:', isSupabaseConfigured);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
console.log('client url          :', (supabase as any).supabaseUrl ?? (supabase as any).restUrl ?? 'unknown');

// ── 1. settings, exactly as the app loads them ────────────────────────────────
const { settings, origin, detail } = await loadSettingsWithSource();
console.log('settings origin     :', origin, detail ? `(${detail})` : '');
console.log('airtableBaseId set  :', Boolean(settings.airtableBaseId));
console.log('accountAliases      :', (settings.accountAliases ?? []).length);
const statusCounts: Record<string, number> = {};
for (const a of settings.accountAliases ?? []) {
  const s = (a as unknown as { status?: string }).status || '(none)';
  statusCounts[s] = (statusCounts[s] ?? 0) + 1;
}
console.log('alias statuses      :', JSON.stringify(statusCounts));
console.log('excludedCampaignIds :', (settings.excludedCampaignIds ?? []).length);

// ── 2. the three fetches the data path makes ──────────────────────────────────
console.log('\n=== FETCH (anon key, real client) ===');
const t0 = Date.now();
const adSpend: AdSpendRow[] = await fetchMetaAdSpend(settings, ALL_DATES);
console.log(`ad spend rows       : ${adSpend.length.toLocaleString()}  (${Date.now() - t0}ms)`);
const registry = await fetchAccountRegistry();
console.log(`registry            : known=${registry.known} size=${registry.size} airtableNames=${registry.airtableNameCount}`);
const completeness = await checkMetaCompleteness(adSpend.length, ALL_DATES);
console.log(`completeness        : ${completeness.state}  raw=${completeness.rawRows} derived=${completeness.derivedRows} dropped=${completeness.droppedRows}`);

let appts: AppointmentRow[] = [];
let apptError: string | null = null;
try {
  const r = await fetchAirtableData(settings);
  appts = r.records;
  console.log(`appointments        : ${appts.length.toLocaleString()} rows, ${r.fields.length} fields, unresolvedLinks=${r.unresolvedLinks ?? 0}`);
} catch (e) {
  apptError = e instanceof Error ? e.message : String(e);
  console.log(`appointments        : FAILED — ${apptError}`);
}

// ── 3. raw feed aggregates (comparable to the baseline's Supabase column) ─────
const sum = (rows: AdSpendRow[], f: (r: AdSpendRow) => number) => rows.reduce((s, r) => s + f(r), 0);
const inSpan = (r: AdSpendRow) => r.dateISO >= '2025-01-01' && r.dateISO <= '2026-08-11';
const span = adSpend.filter(inSpan);
console.log('\n=== RAW FEED (what the mapper produced) ===');
console.log(`all dates           : ${adSpend.length.toLocaleString()} rows  ${usd(sum(adSpend, r => r.spent))}  ${sum(adSpend, r => r.leads).toLocaleString()} leads`);
console.log(`2025-01-01..2026-08-11: ${span.length.toLocaleString()} rows  ${usd(sum(span, r => r.spent))}  ${sum(span, r => r.leads).toLocaleString()} leads`);
console.log(`distinct accountId  : ${new Set(adSpend.map(r => r.accountId)).size}`);
console.log(`distinct accountName: ${new Set(adSpend.map(r => r.accountName)).size}`);
console.log(`rows w/ blank accountId: ${adSpend.filter(r => !r.accountId).length}`);
console.log(`rows w/ NaN spend   : ${adSpend.filter(r => !Number.isFinite(r.spent)).length}`);
console.log(`date min/max        : ${adSpend.reduce((m, r) => r.dateISO < m ? r.dateISO : m, '9999')} .. ${adSpend.reduce((m, r) => r.dateISO > m ? r.dateISO : m, '0')}`);

// ── 4. Dashboard totals, replicated exactly (Dashboard.tsx:889-940) ───────────
const KNOWN_ALIVE = { spend: true, appts: !apptError };

function dashboardTotals(spendRows: AdSpendRow[], apptRows: AppointmentRow[], s: AppSettings) {
  const built = buildAccountSummaries(spendRows, apptRows, s, KNOWN_ALIVE, registry);
  const accounts: AccountSummary[] = built.accounts;
  const active = accounts.filter(a => a.status === 'Active');
  const dfy = active.filter(a => a.program !== 'Done With You');
  const spend = active.reduce((x, a) => x + a.spend, 0);
  const leads = active.reduce((x, a) => x + a.leads, 0);
  const perfSpend = active.reduce((x, a) => x + a.performanceSpend, 0);
  const perfLeads = active.reduce((x, a) => x + a.performanceLeads, 0);
  const unmatched = built.unmatchedAppointments.length;
  const apptsTotal = active.reduce((x, a) => x + a.appointments, 0) + unmatched;
  return {
    accounts, built, active, dfy, spend, leads, perfSpend, perfLeads, unmatched,
    appts: apptsTotal,
    matchedAcrossAllAccounts: accounts.reduce((x, a) => x + a.appointments, 0),
    cpl: perfLeads > 0 ? perfSpend / perfLeads : 0,
    accountRows: accounts.length,
    activeRows: active.length,
  };
}

const T = dashboardTotals(adSpend, appts, settings);
console.log('\n=== DASHBOARD TILES, All Time (Active accounts only, no filters) ===');
console.log(`TOTAL SPEND         : ${usd(T.spend)}`);
console.log(`TOTAL LEADS         : ${T.leads.toLocaleString()}`);
console.log(`TOTAL APPTS         : ${T.appts.toLocaleString()}  (matched-on-active + ${T.unmatched} unmatched)`);
console.log(`COST PER LEAD       : ${usd(T.cpl)}`);
console.log(`account rows        : ${T.accountRows}  (Active ${T.activeRows})`);

// ── 5. per-account for the whole span, printed sorted ─────────────────────────
console.log('\n=== ACCOUNT ROWS (all statuses) ===');
for (const a of [...T.accounts].sort((x, y) => y.spend - x.spend)) {
  console.log(
    `${(a.companyName ?? a.accountName).padEnd(42).slice(0, 42)} | ${a.accountName.padEnd(38).slice(0, 38)} | ` +
    `${usd(a.spend).padStart(13)} | leads ${String(a.leads).padStart(6)} | appts ${String(a.appointments).padStart(5)} | ${a.status}`,
  );
}

// ── 6. month by month, via the Dashboard's own client-side date filter ────────
console.log('\n=== MONTH BY MONTH (raw feed sum | Dashboard Active-only tile) ===');
const months = [...new Set(span.map(r => r.dateISO.slice(0, 7)))].sort();
const monthOut: Record<string, { rows: number; raw: number; leads: number; tile: number }> = {};
for (const m of months) {
  const rows = span.filter(r => r.dateISO.slice(0, 7) === m);
  const apptRows = appts.filter(r => {
    const d = (r.dateAdded || r.appointmentDate || '').slice(0, 7);
    return d === m;
  });
  const t = dashboardTotals(rows, apptRows, settings);
  monthOut[m] = { rows: rows.length, raw: sum(rows, r => r.spent), leads: sum(rows, r => r.leads), tile: t.spend };
  console.log(`${m}  rows ${String(rows.length).padStart(5)}  raw ${usd(sum(rows, r => r.spent)).padStart(13)}  leads ${String(sum(rows, r => r.leads)).padStart(6)}  tile ${usd(t.spend).padStart(13)}`);
}

// ── 7. the known-good day ─────────────────────────────────────────────────────
console.log('\n=== 2026-08-08 ===');
const d0808 = adSpend.filter(r => r.dateISO === '2026-08-08');
console.log(`rows ${d0808.length} | spend ${usd(sum(d0808, r => r.spent))} | leads ${sum(d0808, r => r.leads)} | accounts ${new Set(d0808.map(r => r.accountId)).size}`);
const t0808 = dashboardTotals(d0808, appts.filter(r => (r.dateAdded || r.appointmentDate || '').startsWith('2026-08-08')), settings);
console.log(`dashboard tile: spend ${usd(t0808.spend)} leads ${t0808.leads} account rows ${t0808.accountRows} (active ${t0808.activeRows})`);

// ── 8. 2026-08-01..07, absent from the sheet ──────────────────────────────────
console.log('\n=== 2026-08-01..2026-08-07 (absent from the sheet) ===');
for (const d of ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07']) {
  const rows = adSpend.filter(r => r.dateISO === d);
  console.log(`${d}  rows ${String(rows.length).padStart(4)}  ${usd(sum(rows, r => r.spent)).padStart(11)}  leads ${sum(rows, r => r.leads)}`);
}

// ── 9. SQL-narrowed fetch must equal the client-side filter ───────────────────
console.log('\n=== CONTROL: SQL window vs client filter (2026-07) ===');
const sqlJuly = await fetchMetaAdSpend(settings, { from: '2026-07-01', to: '2026-07-31' });
const cliJuly = adSpend.filter(r => r.dateISO >= '2026-07-01' && r.dateISO <= '2026-07-31');
console.log(`SQL   : ${sqlJuly.length} rows ${usd(sum(sqlJuly, r => r.spent))} leads ${sum(sqlJuly, r => r.leads)}`);
console.log(`CLIENT: ${cliJuly.length} rows ${usd(sum(cliJuly, r => r.spent))} leads ${sum(cliJuly, r => r.leads)}`);
console.log(`AGREE : ${sqlJuly.length === cliJuly.length && Math.abs(sum(sqlJuly, r => r.spent) - sum(cliJuly, r => r.spent)) < 0.005 ? 'YES' : 'NO'}`);

// ── 10. appointment conservation ──────────────────────────────────────────────
console.log('\n=== APPOINTMENT CONSERVATION ===');
console.log(`airtable rows fetched    : ${appts.length}`);
console.log(`matched onto ANY account : ${T.matchedAcrossAllAccounts}`);
console.log(`unmatched bucket         : ${T.unmatched}`);
console.log(`matched + unmatched      : ${T.matchedAcrossAllAccounts + T.unmatched}`);
console.log(`CONSERVED                : ${T.matchedAcrossAllAccounts + T.unmatched === appts.length ? 'YES' : 'NO — ' + (appts.length - T.matchedAcrossAllAccounts - T.unmatched) + ' LOST'}`);

console.log('\n=== WHO THE UNMATCHED ARE ===');
const un: Record<string, number> = {};
for (const a of T.built.unmatchedAppointments) {
  const k = (a.client || '(blank)').trim();
  un[k] = (un[k] ?? 0) + 1;
}
for (const [k, v] of Object.entries(un).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);

console.log('\n=== THE FIVE RENAME GROUPS: one row each, and their appointments ===');
for (const id of ['322974296642516', '10170221', '222178771', '103578393327348', '2264268834091190']) {
  const rows = adSpend.filter(r => r.accountId === id);
  const names = [...new Set(rows.map(r => r.accountName))];
  const summary = T.accounts.filter(a => rows.some(r => r.accountName === a.accountName));
  console.log(`${id.padEnd(18)} names-in-feed=${names.length} ${JSON.stringify(names)} -> ${summary.length} account row(s), ${usd(sum(rows, r => r.spent))}, appts ${summary.reduce((s, a) => s + a.appointments, 0)}`);
}
const ghosts = ['Publicity 1', 'Christmas Light Pros', '10170221, USD', '222178771, USD', '103578393327348, USD'];
console.log(`old sheet names still present as account rows: ${ghosts.filter(g => T.accounts.some(a => a.accountName === g)).length} of ${ghosts.length}`);

// per-account appointment counts, dumped for the before/after diff
const perAccountAppts: Record<string, number> = {};
for (const a of T.accounts) perAccountAppts[a.accountName] = a.appointments;
const fs = await import('node:fs');
fs.writeFileSync(
  '/private/tmp/claude-501/-Users-andrewleonard/03b67d7d-afa4-45de-9c79-f5835fb3d2af/scratchpad/after-appts.json',
  JSON.stringify({
    totalAirtable: appts.length,
    matched: T.matchedAcrossAllAccounts,
    unmatched: T.unmatched,
    perAccount: perAccountAppts,
    perAccountByCompany: Object.fromEntries(T.accounts.map(a => [a.companyName ?? a.accountName, a.appointments])),
    months: monthOut,
    totals: { spend: T.spend, leads: T.leads, appts: T.appts, accountRows: T.accountRows, activeRows: T.activeRows },
  }, null, 2),
);
console.log('\nwrote after-appts.json');
