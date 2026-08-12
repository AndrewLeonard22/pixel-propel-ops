/** WHERE DID 4 CLOSED DEALS AND $22,100 OF REVENUE GO? */
import './_shim.mts';
import { fetchMetaAdSpend, ALL_DATES } from '../src/lib/metaAdSpend';
import { fetchAccountRegistry } from '../src/lib/accountRegistry';
import { fetchAirtableData, buildAccountSummaries, isClosedWon } from '../src/lib/dataService';
import { loadSettingsWithSource } from '../src/lib/config';

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const { settings } = await loadSettingsWithSource();
const [rows, registry, air] = await Promise.all([
  fetchMetaAdSpend(settings, ALL_DATES), fetchAccountRegistry(), fetchAirtableData(settings),
]);
const res = buildAccountSummaries(rows, air.records, settings, undefined, registry);

const byClient = new Map<string, { n: number; closed: number; revenue: number }>();
for (const a of res.unmatchedAppointments) {
  const c = (a.client || '(blank)').trim();
  const e = byClient.get(c) ?? { n: 0, closed: 0, revenue: 0 };
  e.n++;
  if (isClosedWon(a, settings)) { e.closed++; e.revenue += Number(a.closedRevenue) || 0; }
  byClient.set(c, e);
}
console.log('=== THE 57 UNMATCHED APPOINTMENTS ===');
let tn = 0, tc = 0, tr = 0;
for (const [c, e] of [...byClient].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${c.padEnd(36)} appts=${String(e.n).padStart(3)}  closed=${e.closed}  revenue=${money(e.revenue)}`);
  tn += e.n; tc += e.closed; tr += e.revenue;
}
console.log(`  TOTAL: appts=${tn} closed=${tc} revenue=${money(tr)}`);
console.log('\n⇒ Dashboard TOTAL APPTS adds the 57 back; Closed Deals and Total Revenue reduce over ACCOUNTS only.');
console.log(`   So ${tc} closed deals and ${money(tr)} leave those two tiles with no figure on screen naming them.`);

const active = res.accounts.filter(a => a.status === 'Active');
console.log(`\nDashboard Closed Deals = ${active.reduce((s, a) => s + a.closed, 0)}   Total Revenue = ${money(active.reduce((s, a) => s + a.revenue, 0))}`);
console.log(`Including the unmatched they would be ${active.reduce((s, a) => s + a.closed, 0) + tc} and ${money(active.reduce((s, a) => s + a.revenue, 0) + tr)}`);
