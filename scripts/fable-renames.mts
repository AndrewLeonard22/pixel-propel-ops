/**
 * THE RENAMES, DISCOVERED RATHER THAN ASSUMED — and then proved still to resolve.
 *
 * The brief names four confirmed renames and says "and two more". Taking that list on trust
 * would be joining on a claim. Instead: bridge every SHEET account label to a Meta
 * `account_id` through CAMPAIGN IDs (a key neither side can edit), then report every account
 * whose Meta display name today differs from the label the sheet knew it by.
 *
 * A rename is only interesting if it BREAKS something, so each one is then pushed through the
 * app's real registry to show what the product resolves it to now.
 */
import './_shim.mts';
import { fetchAccountRegistry } from '../src/lib/accountRegistry';
import { supabase } from '../src/integrations/supabase/client';
import fs from 'node:fs';

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

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

async function main() {
  const rows = parseCsv(fs.readFileSync(process.argv[2] ?? '/tmp/sheet_0.csv', 'utf8'));
  const head = rows.shift()!.map(h => h.trim());
  const ni = head.indexOf('Account Name'), ci = head.indexOf('Campaign Id'), si = head.indexOf('Spent');

  // sheet label -> its campaign ids + spend
  const sheetAcc = new Map<string, { camps: Set<string>; spend: number }>();
  for (const r of rows) {
    const name = (r[ni] ?? '').trim();
    if (!name) continue;
    if (!sheetAcc.has(name)) sheetAcc.set(name, { camps: new Set(), spend: 0 });
    const e = sheetAcc.get(name)!;
    e.spend += Number(String(r[si] ?? '').replace(/[$,\s]/g, '')) || 0;
    const c = (r[ci] ?? '').trim();
    if (c) e.camps.add(c);
  }

  // campaign_id -> (account_id, account_name) from the live feed
  const campToAcct = new Map<string, { id: string; name: string }>();
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('ad_insights').select('campaign_id, account_id, account_name')
      .order('date', { ascending: true }).order('ad_id', { ascending: true })
      .range(off, off + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    for (const r of batch) {
      const c = String(r.campaign_id ?? '').trim();
      if (c && !campToAcct.has(c)) campToAcct.set(c, { id: String(r.account_id), name: String(r.account_name ?? '') });
    }
    if (batch.length === 0) break;
  }
  console.log(`campaign-id bridge built: ${campToAcct.size} distinct campaign ids in the feed\n`);

  const registry = await fetchAccountRegistry();
  console.log(`registry: ${registry.size} name-resolvable accounts, known=${registry.known}, ${registry.airtableNameCount} airtable names\n`);

  console.log('=== ACCOUNTS THE SHEET AND META CALL DIFFERENT THINGS ===\n');
  const renames: { sheet: string; metaName: string; id: string; spend: number }[] = [];
  for (const [label, e] of sheetAcc) {
    const votes = new Map<string, number>();
    for (const c of e.camps) {
      const hit = campToAcct.get(c);
      if (hit) votes.set(hit.id, (votes.get(hit.id) ?? 0) + 1);
    }
    if (!votes.size) continue;
    const [id] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    const metaName = [...campToAcct.values()].find(v => v.id === id)!.name;
    if (norm(metaName) !== norm(label)) renames.push({ sheet: label, metaName, id, spend: e.spend });
  }
  renames.sort((a, b) => b.spend - a.spend);

  console.log('  ' + 'sheet called it'.padEnd(34) + 'meta calls it now'.padEnd(38) + 'account_id'.padEnd(18) + 'sheet spend');
  for (const r of renames) {
    console.log('  ' + r.sheet.slice(0, 33).padEnd(34) + r.metaName.slice(0, 37).padEnd(38) + r.id.padEnd(18) + '$' + r.spend.toFixed(2));
  }

  console.log(`\n=== DO THEY STILL RESOLVE? (through the app's real registry) ===\n`);
  let bad = 0;
  for (const r of renames) {
    const byId = registry.byAccountId(r.id);
    const byName = registry.byMetaName(r.metaName);
    const ok = !!byId;
    if (!ok) bad++;
    console.log(
      `  ${ok ? '✅' : '🔴'} ${r.id.padEnd(18)} byAccountId -> ${String(byId?.company ?? 'null').padEnd(38)}` +
      ` byMetaName("${r.metaName.slice(0, 22)}") -> ${byName?.company ?? 'null'}`,
    );
  }
  console.log(
    bad === 0
      ? `\n✅ all ${renames.length} renamed accounts resolve through account_id — the key Meta cannot rewrite.`
      : `\n🔴 ${bad} renamed account(s) do NOT resolve.`,
  );
  process.exitCode = bad === 0 ? 0 : 1;
}

main().catch(e => { console.error('🔴', e); process.exit(1); });
