(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0,
};
import { readFileSync } from 'node:fs';
const IN = '/private/tmp/claude-501/-Users-andrewleonard/03b67d7d-afa4-45de-9c79-f5835fb3d2af/scratchpad/inputs.json';
const inputs = JSON.parse(readFileSync(IN, 'utf8'));
const { metaRowToAdSpendRow } = await import('../src/lib/metaAdSpend');
const adSpend = inputs.spendRows.map(metaRowToAdSpendRow);
const cm = inputs.settings.columnMappings ?? {};
const g = (f: Record<string, unknown>, k: string) => {
  const v = f[cm[k] || k]; return String((Array.isArray(v) ? v[0] : v) ?? '').trim();
};
const metaCamp = new Map<string, string>();
for (const r of adSpend) { const c = (r.campaignId || '').trim(); if (c && !metaCamp.has(c)) metaCamp.set(c, r.accountName); }
function pl(line: string) {
  const o: string[] = []; let cur = ''; let q = false;
  for (let k = 0; k < line.length; k++) { const ch = line[k];
    if (ch === '"') { if (q && line[k + 1] === '"') { cur += '"'; k++; } else q = !q; }
    else if (ch === ',' && !q) { o.push(cur); cur = ''; } else cur += ch; }
  o.push(cur); return o;
}
const L = inputs.sheetCsv.split('\n').filter((l: string) => l.trim());
const H = pl(L[0]).map(h => h.trim().toLowerCase());
const ix = Object.fromEntries(H.map((h, n) => [h, n]));
const sheetCamp = new Map<string, string>();
for (let k = 1; k < L.length; k++) { const v = pl(L[k]); const c = (v[ix['campaign id']] ?? '').trim();
  if (c && !sheetCamp.has(c)) sheetCamp.set(c, (v[ix['account name']] ?? '').trim()); }

const t = { noCamp: 0, both: 0, sheetOnly: 0, metaOnly: 0, neither: 0 };
const per = new Map<string, number>();
for (const rec of inputs.airtable.records) {
  if (g(rec.fields, 'Client Name') !== 'San Antonio l Backyard Paradiso ') {
    if (g(rec.fields, 'Client Name').trim() !== 'San Antonio l Backyard Paradiso') continue;
  }
  const c = g(rec.fields, 'Campaign ID');
  if (!c) { t.noCamp++; continue; }
  const s = sheetCamp.get(c), m = metaCamp.get(c);
  if (s && m) t.both++; else if (s) t.sheetOnly++; else if (m) t.metaOnly++; else t.neither++;
  const k = `sheet=${s ?? '-'} | meta=${m ?? '-'}`;
  per.set(k, (per.get(k) ?? 0) + 1);
}
console.log('San Antonio l Backyard Paradiso — campaign-id coverage per source');
console.log(JSON.stringify(t, null, 1));
console.log('\nbreakdown:');
for (const [k, n] of [...per].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}x  ${k}`);
