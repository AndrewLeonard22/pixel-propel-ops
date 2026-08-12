/**
 * AFTER — the cutover code path over LIVE ad_insights + the SAME live Airtable payload the
 * baseline used. Emits the same shape as scripts/ba.mts in the baseline worktree.
 */
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0,
};
import { readFileSync } from 'node:fs';

const IN = '/private/tmp/claude-501/-Users-andrewleonard/03b67d7d-afa4-45de-9c79-f5835fb3d2af/scratchpad/inputs.json';
const inputs = JSON.parse(readFileSync(IN, 'utf8'));

const ds = await import('../src/lib/dataService');
const { buildAccountRegistry } = await import('../src/lib/accountRegistry');
const { metaRowToAdSpendRow } = await import('../src/lib/metaAdSpend');

const adSpend = inputs.spendRows.map(metaRowToAdSpendRow);
const registry = buildAccountRegistry(inputs.accounts, inputs.links);

const mapped = ds.mapAirtableRecords(
  inputs.airtable.records,
  inputs.settings.columnMappings ?? {},
  Array.isArray(inputs.airtable.fields) ? inputs.airtable.fields : [],
  new Map(),
);
const appointments = mapped.records.map((a, i) => Object.assign(a, { __ix: i }));

const res = ds.buildAccountSummaries(adSpend, appointments, inputs.settings, undefined, registry);

const unmatchedIx = new Set(res.unmatchedAppointments.map(a => (a as unknown as { __ix: number }).__ix));
const perClient: Record<string, { total: number; matched: number }> = {};
for (const a of appointments) {
  const c = a.client || '(blank)';
  perClient[c] ??= { total: 0, matched: 0 };
  perClient[c].total++;
  if (!unmatchedIx.has((a as unknown as { __ix: number }).__ix)) perClient[c].matched++;
}

console.log(JSON.stringify({
  label: 'after (cutover + ad_insights)',
  spendRows: adSpend.length,
  totalSpend: adSpend.reduce((n, r) => n + r.spent, 0),
  totalLeads: adSpend.reduce((n, r) => n + r.leads, 0),
  appointments: appointments.length,
  unmatched: res.unmatchedAppointments.length,
  registryNames: registry.airtableNameCount,
  accounts: res.accounts.map(a => ({
    name: a.accountName, company: a.companyName ?? null, appts: a.appointments,
    spend: a.spend, leads: a.leads, program: a.program, mediaBuyer: a.mediaBuyer, status: a.status,
  })),
  perClient,
}, null, 1));
