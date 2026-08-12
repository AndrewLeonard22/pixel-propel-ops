/**
 * THE JOIN TABLE, MEASURED: every Airtable "Client Name" -> the account it lands in,
 * under BOTH feeds, through the app's real matcher.
 *
 * Isolating one client name per run is safe: Tier 3 (client-name inference) only ever
 * propagates within an identical client name, so a single-name run reproduces the same
 * decision the full run makes for that name.
 */
import './_shim.mts';
import { buildAccountSummaries, fetchAirtableData } from '../src/lib/dataService';
import { fetchMetaAdSpend, ALL_DATES } from '../src/lib/metaAdSpend';
import { fetchAccountRegistry } from '../src/lib/accountRegistry';
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
const iso = (v?: string) => { const s = String(v ?? '').trim(); let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return s.slice(0, 10); m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s); return m ? `${m[3]}-${String(+m[1]).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}` : ''; };

async function sheetFeed(): Promise<AdSpendRow[]> {
  const r = await fetch(SHEET); if (!r.ok) throw new Error(`sheet ${r.status}`);
  return parseCsv(await r.text()).map(x => ({
    month: x['Month'] ?? '', date: x['Date'] ?? '', dateISO: iso(x['Date']), campaign: x['Campaign'] ?? '',
    campaignId: x['Campaign Id'] ?? '', adsetName: x['Adset Name'] ?? '', adsetId: x['Adset Id'] ?? '',
    adName: x['Ad Name'] ?? '', adId: x['Ad Id'] ?? '', spent: num(x['Spent']), leads: num(x['Leads']),
    accountName: x['Account Name'] ?? '',
  })) as AdSpendRow[];
}

async function main() {
  const { settings } = await loadSettingsWithSource();
  const [sheet, meta, air, registry] = await Promise.all([
    sheetFeed(), fetchMetaAdSpend(settings, ALL_DATES), fetchAirtableData(settings), fetchAccountRegistry(),
  ]);
  const appts = air.records;

  const byName = new Map<string, typeof appts>();
  for (const a of appts) {
    const k = (a.client || '(blank)').trim();
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k)!.push(a);
  }

  const landing = (spend: AdSpendRow[], subset: typeof appts) => {
    const r = buildAccountSummaries(spend, subset, settings, undefined, registry);
    const hit = r.accounts.filter(s => s.appointments > 0);
    if (hit.length === 0) return `(UNMATCHED ${r.unmatchedAppointments.length})`;
    return hit.map(s => `${s.companyName || s.accountName}:${s.appointments}`).join(' + ');
  };

  console.log('client name'.padEnd(38), '| n  | SHEET -> account'.padEnd(34), '| SUPABASE -> account');
  console.log('-'.repeat(120));
  const changed: string[] = [];
  for (const [name, subset] of [...byName.entries()].sort()) {
    const a = landing(sheet, subset), b = landing(meta, subset);
    const flag = a === b ? '' : '   <== CHANGED';
    if (a !== b) changed.push(`${name}\n     SHEET    ${a}\n     SUPABASE ${b}`);
    console.log(name.slice(0, 37).padEnd(38), '|', String(subset.length).padStart(3), '|', a.slice(0, 32).padEnd(32), '|', b.slice(0, 40), flag);
  }
  console.log('\n\n=== CLIENT NAMES WHOSE ATTRIBUTION CHANGED ===');
  console.log(changed.length ? changed.join('\n\n') : 'none');

  console.log('\n=== ad_account_airtable_names links (the stable path) ===');
  console.log(`registry.known=${registry.known}  airtableNameCount=${registry.airtableNameCount}`);
  for (const [name] of byName) {
    const id = registry.airtableNameToAccountId(name);
    console.log(`  ${id ? 'LINKED  ' + id : 'unlinked        '}  ${name}`);
  }
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
