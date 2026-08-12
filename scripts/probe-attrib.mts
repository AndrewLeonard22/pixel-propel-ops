/**
 * WHICH ACCOUNT DOES EACH CLIENT LAND ON? Leave-one-client-out: remove a client's
 * appointments and see which account's count drops. Exact, and needs no change to
 * buildAccountSummaries' public shape.
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
const appts = ds.mapAirtableRecords(
  inputs.airtable.records, inputs.settings.columnMappings ?? {},
  Array.isArray(inputs.airtable.fields) ? inputs.airtable.fields : [], new Map(),
).records;

const run = (list: typeof appts) => {
  const r = ds.buildAccountSummaries(adSpend, list, inputs.settings, undefined, registry);
  return new Map(r.accounts.map(a => [a.accountName, a.appointments]));
};
const full = run(appts);
const out: Record<string, Record<string, number>> = {};
for (const c of [...new Set(appts.map(a => a.client))]) {
  const without = run(appts.filter(a => a.client !== c));
  out[c] = {};
  for (const [name, n] of full) {
    const d = n - (without.get(name) ?? 0);
    if (d > 0) out[c][name] = d;
  }
}
console.log(JSON.stringify(out, null, 1));
