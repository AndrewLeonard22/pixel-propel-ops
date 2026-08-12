/**
 * IS AN ACCOUNT THAT VANISHED FROM THE NAME LIST *LOST*, OR *RENAMED*?
 *
 * A name diff cannot tell those apart, which is the entire defect the cutover removes.
 * The discriminator is the CAMPAIGN ID: campaigns belong to an account and Meta does not
 * rewrite their ids, so a sheet account whose campaign ids appear in `ad_insights` under a
 * different account name was RENAMED, and one whose ids appear nowhere is genuinely absent.
 */
import './_shim.mts';
import { supabase } from '../src/integrations/supabase/client';

const SHEET = 'https://docs.google.com/spreadsheets/d/1g6hqd1-8A_XNUVfcd13g36jVDdHnqR4o6gX2-eCuSBE/export?format=csv&gid=1817873425';
const money = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** RFC4180 reader. A split(',') is wrong here: account names like "10170221, USD" are quoted and contain commas. */
function csv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(v => v !== ''));
}

const text = await fetch(SHEET).then(r => r.text());
const table = csv(text);
const head = table.shift()!;
const iName = head.indexOf('account_name'), iCamp = head.indexOf('campaign_id'), iSpend = head.indexOf('spend'), iDate = head.indexOf('date');

// sheet: account -> {spend, campaign ids}
const sheetAcc = new Map<string, { spend: number; camps: Set<string>; rows: number; last: string }>();
for (const c of table) {
  const n = c[iName]; if (!n) continue;
  const e = sheetAcc.get(n) ?? { spend: 0, camps: new Set<string>(), rows: 0, last: '' };
  e.spend += Number(c[iSpend]) || 0; e.rows++; if (c[iCamp]) e.camps.add(c[iCamp].trim());
  if (c[iDate] > e.last) e.last = c[iDate];
  sheetAcc.set(n, e);
}

// ad_insights: campaign_id -> account_id/name, and the set of account names present
const campToAcct = new Map<string, string>();
const acctName = new Map<string, string>();
for (let page = 0; ; page++) {
  const { data, error } = await (supabase as any).from('ad_insights')
    .select('campaign_id, account_id, account_name')
    .order('date', { ascending: true }).order('ad_id', { ascending: true })
    .range(page * 1000, page * 1000 + 999);
  if (error) throw error;
  for (const r of data) { if (r.campaign_id) campToAcct.set(String(r.campaign_id).trim(), String(r.account_id)); acctName.set(String(r.account_id), r.account_name); }
  if (data.length < 1000) break;
}
const metaNames = new Set([...acctName.values()]);

console.log(`sheet accounts ${sheetAcc.size}   ad_insights accounts ${acctName.size}   campaign ids indexed ${campToAcct.size}\n`);

const renamed: string[] = [], lost: string[] = [];
let lostSpend = 0, lostRows = 0, renamedSpend = 0;
for (const [name, e] of [...sheetAcc].sort((a, b) => b[1].spend - a[1].spend)) {
  if (metaNames.has(name)) continue;                       // same label on both sides
  const hits = new Map<string, number>();
  for (const c of e.camps) { const a = campToAcct.get(c); if (a) hits.set(a, (hits.get(a) ?? 0) + 1); }
  if (hits.size === 0) {
    lost.push(`  ${money(e.spend).padStart(12)}  ${String(e.rows).padStart(5)} rows  last ${e.last}  ${name}`);
    lostSpend += e.spend; lostRows += e.rows;
  } else {
    const best = [...hits].sort((a, b) => b[1] - a[1])[0];
    renamed.push(`  ${money(e.spend).padStart(12)}  ${name}\n${' '.repeat(16)}-> ${acctName.get(best[0])}  (account_id ${best[0]}, ${best[1]}/${e.camps.size} campaign ids matched)`);
    renamedSpend += e.spend;
  }
}

console.log('RENAMED — same account, new Meta display name. NOT lost; a name join would have dropped these.');
console.log(renamed.join('\n') || '  none');
console.log(`  ${renamed.length} accounts, ${money(renamedSpend)}\n`);

console.log('GENUINELY ABSENT — no campaign id of theirs appears anywhere in ad_insights.');
console.log(lost.join('\n') || '  none');
console.log(`  ${lost.length} accounts, ${money(lostSpend)}, ${lostRows} rows`);
