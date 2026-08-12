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

const campToMeta = new Map<string, string>();
for (const r of adSpend) {
  const c = (r.campaignId || '').trim();
  if (c && !campToMeta.has(c)) campToMeta.set(c, r.accountName);
}
function parseLine(line: string) {
  const o: string[] = []; let cur = ''; let q = false;
  for (let k = 0; k < line.length; k++) {
    const ch = line[k];
    if (ch === '"') { if (q && line[k + 1] === '"') { cur += '"'; k++; } else q = !q; }
    else if (ch === ',' && !q) { o.push(cur); cur = ''; } else cur += ch;
  }
  o.push(cur); return o;
}
const lines = inputs.sheetCsv.split('\n').filter((l: string) => l.trim());
const H = parseLine(lines[0]).map(h => h.trim().toLowerCase());
const ix = Object.fromEntries(H.map((h, n) => [h, n]));
const campToSheet = new Map<string, string>();
for (let k = 1; k < lines.length; k++) {
  const v = parseLine(lines[k]);
  const c = (v[ix['campaign id']] ?? '').trim();
  if (c && !campToSheet.has(c)) campToSheet.set(c, (v[ix['account name']] ?? '').trim());
}

const tally = new Map<string, number>();
for (const rec of inputs.airtable.records) {
  const client = g(rec.fields, 'Client Name');
  const camp = g(rec.fields, 'Campaign ID');
  if (!camp) continue;
  const s = campToSheet.get(camp) ?? '(campaign absent from sheet)';
  const m = campToMeta.get(camp) ?? '(campaign absent from ad_insights)';
  if (s.trim().toLowerCase() === m.trim().toLowerCase()) continue;
  const k = `${client}  ||  ${s}  ->  ${m}`;
  tally.set(k, (tally.get(k) ?? 0) + 1);
}
console.log('Tier-1 (campaign id) attribution that DIFFERS between the two sources:\n');
for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1])) {
  const [client, move] = k.split('  ||  ');
  console.log(`  ${String(n).padStart(3)}x  ${client.padEnd(34)} ${move}`);
}
console.log(`\n  distinct situations: ${tally.size}`);
