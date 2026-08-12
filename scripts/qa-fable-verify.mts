/**
 * INDEPENDENT CUTOVER VERIFICATION — written from scratch, reads only the APP's own modules.
 * Nothing here re-implements the app's arithmetic except the Dashboard tile reducer, which is
 * copied line-for-line from Dashboard.tsx:889-989 and is cross-checked by the jsdom render.
 */
import './_shim.mts';
import { fetchMetaAdSpend, ALL_DATES, checkMetaCompleteness, type SpendWindow } from '../src/lib/metaAdSpend';
import { fetchAccountRegistry } from '../src/lib/accountRegistry';
import { fetchAirtableData, buildAccountSummaries } from '../src/lib/dataService';
import { loadSettingsWithSource } from '../src/lib/config';

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const { settings, origin } = await loadSettingsWithSource();
console.log(`settings origin: ${origin}  aliases: ${settings.accountAliases?.length ?? 0}  airtableBase: ${settings.airtableBaseId ? 'set' : 'MISSING'}`);

// ── 1. THE FEED, through the app's own fetcher, unbounded window (Dashboard default = All Time)
const t0 = Date.now();
const rows = await fetchMetaAdSpend(settings, ALL_DATES);
console.log(`\n=== FEED (fetchMetaAdSpend, ALL_DATES) in ${Date.now() - t0}ms ===`);
const feedSpend = rows.reduce((s, r) => s + r.spent, 0);
const feedLeads = rows.reduce((s, r) => s + r.leads, 0);
console.log(`rows=${rows.length}  spend=${money(feedSpend)}  leads=${feedLeads}  accountIds=${new Set(rows.map(r => r.accountId)).size}  accountNames=${new Set(rows.map(r => r.accountName)).size}`);
console.log(`rows missing accountId: ${rows.filter(r => !r.accountId).length}`);
const dates = rows.map(r => r.dateISO).sort();
console.log(`date span: ${dates[0]} .. ${dates[dates.length - 1]}`);

const completeness = await checkMetaCompleteness(rows.length, ALL_DATES);
console.log(`completeness: ${completeness.state}  raw=${completeness.rawRows} derived=${completeness.derivedRows} dropped=${completeness.droppedRows} reason=${completeness.reason ?? '-'}`);

// ── 2. MONTH BY MONTH, from the same fetched rows
console.log(`\n=== MONTH BY MONTH (from the app's fetched rows) ===`);
const byMonth = new Map<string, { rows: number; spend: number; leads: number }>();
for (const r of rows) {
  const m = (r.dateISO || '').slice(0, 7);
  if (!m) continue;
  const e = byMonth.get(m) ?? { rows: 0, spend: 0, leads: 0 };
  e.rows++; e.spend += r.spent; e.leads += r.leads;
  byMonth.set(m, e);
}
for (const m of [...byMonth.keys()].sort()) {
  const e = byMonth.get(m)!;
  console.log(`${m}  rows=${String(e.rows).padStart(5)}  spend=${money(e.spend).padStart(13)}  leads=${String(e.leads).padStart(6)}`);
}

// ── 3. THE KNOWN-GOOD DAY
console.log(`\n=== 2026-08-08 (via the app's own SQL window) ===`);
const day: SpendWindow = { from: '2026-08-08', to: '2026-08-08' };
const dayRows = await fetchMetaAdSpend(settings, day);
console.log(`rows=${dayRows.length}  spend=${money(dayRows.reduce((s, r) => s + r.spent, 0))}  leads=${dayRows.reduce((s, r) => s + r.leads, 0)}  accounts=${new Set(dayRows.map(r => r.accountId)).size}`);
// and via the client-side filter the Dashboard also applies
const dayFromFeed = rows.filter(r => r.dateISO === '2026-08-08');
console.log(`client-filtered from ALL_DATES feed: rows=${dayFromFeed.length} spend=${money(dayFromFeed.reduce((s, r) => s + r.spent, 0))} leads=${dayFromFeed.reduce((s, r) => s + r.leads, 0)} accounts=${new Set(dayFromFeed.map(r => r.accountId)).size}`);

// ── 4. THE APPOINTMENT JOIN
console.log(`\n=== APPOINTMENTS ===`);
const registry = await fetchAccountRegistry();
console.log(`registry: known=${registry.known} size=${registry.size} airtableNameCount=${registry.airtableNameCount}`);
const air = await fetchAirtableData(settings);
console.log(`airtable records: ${air.records.length}  unresolvedLinks=${air.unresolvedLinks ?? 0}  distinct client names=${new Set(air.records.map(r => (r.client || '').trim()).filter(Boolean)).size}`);

function join(reg = registry, s = settings) {
  const res = buildAccountSummaries(rows, air.records, s, undefined, reg);
  const attributed = res.accounts.reduce((n, a) => n + a.appointments, 0);
  return { res, attributed, unmatched: res.unmatchedAppointments.length, total: attributed + res.unmatchedAppointments.length };
}
const withReg = join();
console.log(`WITH ad_account_airtable_names : attributed=${withReg.attributed} unmatched=${withReg.unmatched} TOTAL=${withReg.total} accounts=${withReg.res.accounts.length}`);

// Counterfactual: what the join would do if the stable table were gone (the pre-cutover path)
const noNames = { ...registry, airtableNameToAccountId: () => null, airtableNameCount: 0 };
const withoutTable = join(noNames as typeof registry);
console.log(`WITHOUT the stable table       : attributed=${withoutTable.attributed} unmatched=${withoutTable.unmatched} TOTAL=${withoutTable.total}`);

// ── 5. THE DASHBOARD TILE REDUCER (Dashboard.tsx:889-989, Active-only)
console.log(`\n=== DASHBOARD TILES (All Time, no search/filters) ===`);
const accounts = withReg.res.accounts;
const active = accounts.filter(a => a.status === 'Active');
const inactive = accounts.filter(a => a.status !== 'Active');
const dfy = active.filter(a => a.program !== 'Done With You');
const tileSpend = active.reduce((s, a) => s + a.spend, 0);
const tileLeads = active.reduce((s, a) => s + a.leads, 0);
const perfSpend = active.reduce((s, a) => s + a.performanceSpend, 0);
const perfLeads = active.reduce((s, a) => s + a.performanceLeads, 0);
const dfyAppts = dfy.reduce((s, a) => s + a.appointments, 0);
console.log(`TOTAL SPEND  = ${money(tileSpend)}   (all accounts ${money(accounts.reduce((s, a) => s + a.spend, 0))})`);
console.log(`TOTAL LEADS  = ${tileLeads}          (all accounts ${accounts.reduce((s, a) => s + a.leads, 0)})`);
console.log(`TOTAL APPTS  = ${active.reduce((s, a) => s + a.appointments, 0) + withReg.unmatched}  (active-attributed ${active.reduce((s, a) => s + a.appointments, 0)} + unmatched ${withReg.unmatched})`);
console.log(`CPL          = ${perfLeads > 0 ? money(perfSpend / perfLeads) : '—'}`);
console.log(`COST/APPT    = ${dfyAppts > 0 ? money(dfy.reduce((s, a) => s + a.performanceSpend, 0) / dfyAppts) : '—'}`);
console.log(`excluded (non-Active): ${inactive.filter(a => a.spend > 0 || a.leads > 0).map(a => `${a.companyName ?? a.accountName}=${money(a.spend)}`).join(', ') || 'none'}`);

// ── 6. THE RENAME COLLAPSE — ten sheet names -> five account_ids
console.log(`\n=== RENAME COLLAPSE (baseline §6) ===`);
for (const [id, label] of [
  ['322974296642516', 'Washbroz (was Publicity 1)'],
  ['10170221', 'Columbia Outdoor Restoration'],
  ['222178771', 'Pro Clean Mobile Wash'],
  ['103578393327348', 'TrueClean'],
  ['2264268834091190', 'Hydro Pro Wash (was Christmas Light Pros)'],
] as const) {
  const hits = accounts.filter(a => a.accountId === id);
  const spend = hits.reduce((s, a) => s + a.spend, 0);
  const appts = hits.reduce((s, a) => s + a.appointments, 0);
  console.log(`${id.padEnd(17)} rows_in_dashboard=${hits.length}  spend=${money(spend).padStart(12)}  appts=${appts}  name="${hits[0]?.companyName ?? hits[0]?.accountName ?? '-'}"`);
}

// ── 7. THE 8 ZEROED ACCOUNTS — their appointments must still be counted somewhere
console.log(`\n=== THE 8 ACCOUNTS THE CUTOVER ZEROES (baseline §6) ===`);
const zeroed = ['Green Plus Remodeling', "Mac's Pressure Washing", 'Ortiz Pro Wash', 'Mission Exterior Cleaning',
  'Pergolaguy.com', 'Home Remodeling Pros X SocialWorks', 'No Streaks x SocialWorks'];
for (const name of zeroed) {
  const inAppts = air.records.filter(r => (r.client || '').trim().toLowerCase() === name.toLowerCase()).length;
  const inUnmatched = withReg.res.unmatchedAppointments.filter(r => (r.client || '').trim().toLowerCase() === name.toLowerCase()).length;
  const attributedTo = accounts.filter(a => a.appointmentsList?.some?.((x: { client?: string }) => (x.client || '').trim().toLowerCase() === name.toLowerCase()));
  console.log(`${name.padEnd(38)} airtable=${String(inAppts).padStart(4)}  unmatched=${String(inUnmatched).padStart(4)}  attributed_to=${attributedTo.map(a => a.companyName ?? a.accountName).join('|') || '-'}`);
}

console.log(`\n=== ACCOUNT COUNT ===`);
console.log(`dashboard account rows: ${accounts.length}  active: ${active.length}  with appts: ${accounts.filter(a => a.appointments > 0).length}`);
