/** DOES TARGETS AGREE WITH DASHBOARD? Targets classifies via loadAccountMappings()+sheetName. */
import './_shim.mts';
import { fetchMetaAdSpend, ALL_DATES } from '../src/lib/metaAdSpend';
import { fetchAccountRegistry } from '../src/lib/accountRegistry';
import { fetchAirtableData, buildAccountSummaries } from '../src/lib/dataService';
import { loadSettingsWithSource, getAccountMapping } from '../src/lib/config';
import { supabase } from '../src/integrations/supabase/client';

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const { settings } = await loadSettingsWithSource();
const [rows, registry, air] = await Promise.all([
  fetchMetaAdSpend(settings, ALL_DATES), fetchAccountRegistry(), fetchAirtableData(settings),
]);
const accounts = buildAccountSummaries(rows, air.records, settings, undefined, registry).accounts;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { data } = await (supabase as any).from('app_settings').select('value').eq('key', 'account_mappings').maybeSingle();
const mappings = (data?.value ?? []) as { sheetName: string; program: string; status: string }[];
console.log(`account_mappings rows: ${mappings.length}`);

const feedNames = [...new Set(rows.map(r => r.accountName))];
const mapNames = new Set(mappings.map(m => m.sheetName.trim().toLowerCase()));
const hit = feedNames.filter(n => mapNames.has(n.trim().toLowerCase()));
console.log(`feed account names: ${feedNames.length}  matched to a mapping sheetName: ${hit.length}  MISSED: ${feedNames.length - hit.length}`);
console.log('MISSED names: ' + feedNames.filter(n => !mapNames.has(n.trim().toLowerCase())).join(' | '));

function stats(classify: (a: typeof accounts[number]) => { program: string; status: string }, label: string) {
  const act = accounts.filter(a => classify(a).status === 'Active');
  const dfy = act.filter(a => classify(a).program !== 'Done With You');
  const dwy = act.filter(a => classify(a).program === 'Done With You');
  const dfySpend = dfy.reduce((s, a) => s + a.performanceSpend, 0);
  const dfyLeads = dfy.reduce((s, a) => s + a.performanceLeads, 0);
  const dfyAppts = dfy.reduce((s, a) => s + a.appointments, 0);
  const allLeads = act.reduce((s, a) => s + a.performanceLeads, 0);
  const allAppts = act.reduce((s, a) => s + a.appointments, 0);
  console.log(`\n${label}`);
  console.log(`  active=${act.length} DFY=${dfy.length} DWY=${dwy.length}`);
  console.log(`  DFY Cost/Appt = ${dfyAppts ? money(dfySpend / dfyAppts) : '—'}   DFY CPL = ${dfyLeads ? money(dfySpend / dfyLeads) : '—'}`);
  console.log(`  Lead->Appt (Targets: ALL active)  = ${allLeads ? ((allAppts / allLeads) * 100).toFixed(1) : '—'}%`);
  console.log(`  Lead->Appt (Dashboard: DFY only)  = ${dfy.reduce((s, a) => s + a.performanceLeads, 0) ? ((dfyAppts / dfyLeads) * 100).toFixed(1) : '—'}%`);
}

stats(() => ({ program: 'Done For You', status: 'Active' }), 'A. TARGETS ON A COLD BROWSER (localStorage empty — every account defaults DFY/Active)');
stats(a => getAccountMapping(a.accountName, mappings as never), 'B. TARGETS WITH account_mappings PRESENT (matched on Meta current name vs sheetName)');
stats(a => ({ program: a.program, status: a.status }), 'C. DASHBOARD (summary.program / summary.status, resolved via ad_accounts registry)');

console.log('\n=== per-account classification disagreement (B vs C) ===');
let n = 0;
for (const a of accounts) {
  const b = getAccountMapping(a.accountName, mappings as never);
  if (b.program !== a.program || b.status !== a.status) {
    n++;
    if (n <= 20) console.log(`  ${(a.companyName ?? a.accountName).padEnd(38)} targets=${b.program}/${b.status}  dashboard=${a.program}/${a.status}  spend=${money(a.spend)}`);
  }
}
console.log(`  ${n} of ${accounts.length} accounts classified differently by the two pages`);
