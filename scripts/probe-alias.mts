(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0,
};
import { readFileSync } from 'node:fs';
const IN = '/private/tmp/claude-501/-Users-andrewleonard/03b67d7d-afa4-45de-9c79-f5835fb3d2af/scratchpad/inputs.json';
const inputs = JSON.parse(readFileSync(IN, 'utf8'));
const { metaRowToAdSpendRow } = await import('../src/lib/metaAdSpend');
const { accountIdentityKey, accountKey, classifyAccountLabel } = await import('../src/lib/dataService');

const adSpend = inputs.spendRows.map(metaRowToAdSpendRow);
// rebuild the same index the fix builds
const keys = new Set<string>();
const byName = new Map<string, string>();
for (const r of adSpend) {
  const k = accountIdentityKey(r);
  keys.add(k);
  const n = accountKey(r.accountName);
  if (n) byName.set(n, byName.has(n) && byName.get(n) !== k ? '' : k);
}
const resolve = (label: string) => {
  const raw = String(label ?? '').trim(); if (!raw) return null;
  if (keys.has(accountKey(raw))) return accountKey(raw);
  if (keys.has(raw)) return raw;
  const e = classifyAccountLabel(raw).metaAccountId;
  if (e && keys.has(e)) return e;
  return byName.get(accountKey(raw)) || null;
};
let ok = 0, miss = 0; const missed: string[] = [];
for (const m of inputs.settings.accountAliases) {
  const r = resolve(m.sheetName);
  if (r) ok++; else { miss++; missed.push(m.sheetName); }
}
console.log(`legacy aliases: ${inputs.settings.accountAliases.length}`);
console.log(`  RESOLVE to a real account key: ${ok}   (was 0 before the fix)`);
console.log(`  still unresolvable:            ${miss}`);
console.log('  unresolvable labels:', missed.join(' · '));
