/**
 * Is the 2-appointment move (US Artificial Grass -> Backyard Paradiso) a CORRECTION or a
 * REGRESSION? Tier 1 is campaign-id, which has zero false-match risk. If the moved
 * appointments carry a campaign id that ad_insights knows and the sheet does not, the
 * cutover attributed them on the STRONGEST evidence and the sheet was guessing.
 */
import './_shim.mts';
import { fetchAirtableData } from '../src/lib/dataService';
import { fetchMetaAdSpend, ALL_DATES } from '../src/lib/metaAdSpend';
import { loadSettingsWithSource } from '../src/lib/config';
import type { AdSpendRow } from '../src/lib/types';

const SHEET =
  'https://docs.google.com/spreadsheets/d/1g6hqd1-8A_XNUVfcd13g36jVDdHnqR4o6gX2-eCuSBE/export?format=csv&gid=0';

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift()!.map(h => h.trim());
  return rows.filter(r => r.some(v => v.trim() !== '')).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}
const num = (v?: string) => { const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0; };

async function sheetFeed(): Promise<AdSpendRow[]> {
  const r = await fetch(SHEET); if (!r.ok) throw new Error(`sheet ${r.status}`);
  return parseCsv(await r.text()).map(x => ({
    campaignId: x['Campaign Id'] ?? '', accountName: x['Account Name'] ?? '',
    spent: num(x['Spent']), date: x['Date'] ?? '',
  })) as unknown as AdSpendRow[];
}

async function main() {
  const { settings } = await loadSettingsWithSource();
  const [sheet, meta, air] = await Promise.all([sheetFeed(), fetchMetaAdSpend(settings, ALL_DATES), fetchAirtableData(settings)]);

  // campaign id -> account label, per feed
  const sheetCamp = new Map<string, string>();
  for (const r of sheet) if (r.campaignId?.trim()) sheetCamp.set(r.campaignId.trim(), r.accountName);
  const metaCamp = new Map<string, string>();
  for (const r of meta) if (r.campaignId?.trim()) metaCamp.set(r.campaignId.trim(), `${r.accountName} [${r.accountId}]`);

  const target = air.records.filter(a => (a.client || '').trim() === 'San Antonio l Backyard Paradiso');
  console.log(`San Antonio l Backyard Paradiso: ${target.length} appointments\n`);

  const rows = target.map(a => {
    const cid = (a.campaignId || '').trim();
    return { cid, sheet: cid ? sheetCamp.get(cid) ?? '(campaign id NOT in sheet)' : '(no campaign id)', meta: cid ? metaCamp.get(cid) ?? '(campaign id NOT in ad_insights)' : '(no campaign id)' };
  });

  const grp = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.sheet}   ||   ${r.meta}`;
    grp.set(k, (grp.get(k) ?? 0) + 1);
  }
  console.log('n   SHEET campaign-id resolves to   ||   ad_insights campaign-id resolves to');
  console.log('-'.repeat(110));
  for (const [k, v] of [...grp.entries()].sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(3), ' ', k);

  console.log('\n=== THE MOVED ONES: campaign ids the SHEET does not know but ad_insights does ===');
  const moved = rows.filter(r => r.sheet === '(campaign id NOT in sheet)' && !r.meta.startsWith('(campaign id NOT'));
  console.log(`count: ${moved.length}`);
  for (const r of moved) console.log(`  campaign ${r.cid}  ->  ${r.meta}`);
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
