/**
 * IS THE LOSS A JOIN BUG, OR IS THE ACCOUNT SIMPLY NOT IN THE META FEED?
 *
 * Three clients go attributed -> unmatched across the cutover. That is either
 *   (a) a JOIN REGRESSION — their rows ARE in `ad_insights` and the new key fails to find
 *       them, which is a defect I must fix; or
 *   (b) a DATA FACT — the account is outside the Meta token's visibility, so there is no row
 *       to attach to and no join can invent one.
 * The two are told apart by STABLE META IDS, never by name: take every campaign id and ad id
 * those appointments (and the sheet rows of the accounts they sat on) carry, and ask the
 * database whether any of them exists.
 */
import './_shim.mts';
import { fetchAirtableData } from '../src/lib/dataService';
import { loadSettingsWithSource } from '../src/lib/config';
import { supabase } from '../src/integrations/supabase/client';
import fs from 'node:fs';

const LOST_CLIENTS = ['Green Plus Remodeling', 'Pergola Guy', 'Home Remodeling Pros Central PA'];
// the sheet-side accounts those appointments sat on, from the A->C movement report
const LOST_ACCOUNTS = ['SW |Green Plus', 'Pergolaguy.com', 'Home Remodeling Pros X SocialWorks', 'Green Plus'];

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function existsIn(column: 'campaign_id' | 'ad_id', ids: string[]): Promise<string[]> {
  const found = new Set<string>();
  const list = [...new Set(ids)].filter(Boolean);
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).from('ad_insights').select(column).in(column, chunk);
    if (error) throw new Error(`${column}: ${error.message}`);
    for (const r of data ?? []) found.add(String(r[column]));
  }
  return list.filter(id => found.has(id));
}

async function main() {
  const { settings } = await loadSettingsWithSource();
  const air = await fetchAirtableData(settings);

  const apptCamp: string[] = [];
  let n = 0;
  for (const a of air.records) {
    if (!LOST_CLIENTS.includes((a.client || '').trim())) continue;
    n++;
    const c = (a.campaignId || '').trim();
    if (c) apptCamp.push(c);
  }
  console.log(`appointments belonging to the 3 clients: ${n}`);
  console.log(`  of those, carrying a campaign id: ${apptCamp.length} (${new Set(apptCamp).size} distinct)`);

  // every campaign id and ad id the SHEET recorded for those accounts
  const rows = parseCsv(fs.readFileSync(process.argv[2] ?? '/tmp/sheet_0.csv', 'utf8'));
  const head = rows.shift()!.map(h => h.trim());
  const ci = head.indexOf('Campaign Id'), ai = head.indexOf('Ad Id'), ni = head.indexOf('Account Name');
  const sheetCamp: string[] = [], sheetAd: string[] = [];
  let sheetRows = 0, sheetSpend = 0;
  const si = head.indexOf('Spent');
  for (const r of rows) {
    if (!LOST_ACCOUNTS.includes((r[ni] ?? '').trim())) continue;
    sheetRows++;
    sheetSpend += Number(String(r[si] ?? '').replace(/[$,\s]/g, '')) || 0;
    if ((r[ci] ?? '').trim()) sheetCamp.push(r[ci].trim());
    if ((r[ai] ?? '').trim()) sheetAd.push(r[ai].trim());
  }
  console.log(`\nsheet rows for those 4 account labels: ${sheetRows}  spend $${sheetSpend.toFixed(2)}`);
  console.log(`  distinct campaign ids: ${new Set(sheetCamp).size}   distinct ad ids: ${new Set(sheetAd).size}`);

  console.log('\n=== DOES ANY OF IT EXIST IN ad_insights? ===');
  const hitApptCamp = await existsIn('campaign_id', apptCamp);
  const hitCamp = await existsIn('campaign_id', sheetCamp);
  const hitAd = await existsIn('ad_id', sheetAd);
  console.log(`appointment campaign ids found in ad_insights: ${hitApptCamp.length} of ${new Set(apptCamp).size}`);
  console.log(`sheet campaign ids      found in ad_insights: ${hitCamp.length} of ${new Set(sheetCamp).size}`);
  console.log(`sheet ad ids            found in ad_insights: ${hitAd.length} of ${new Set(sheetAd).size}`);
  if (hitApptCamp.length) console.log('  🔴 appt campaign ids present:', hitApptCamp.slice(0, 10));
  if (hitCamp.length) console.log('  🔴 campaign ids present:', hitCamp.slice(0, 10));
  if (hitAd.length) console.log('  🔴 ad ids present:', hitAd.slice(0, 10));

  const anyHit = hitApptCamp.length + hitCamp.length + hitAd.length;
  console.log(
    anyHit === 0
      ? '\n✅ DATA FACT, not a join bug: not one stable Meta id of these accounts exists in the feed.'
      : '\n🔴 JOIN REGRESSION: rows for these accounts DO exist and the join is missing them.',
  );
  process.exitCode = anyHit === 0 ? 0 : 1;
}

main().catch(e => { console.error('🔴', e); process.exit(1); });
