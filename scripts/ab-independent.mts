/**
 * INDEPENDENT A/B — written from scratch to verify the cutover, deliberately NOT reusing
 * any of the prior agent's verification scripts. One aggregator (`buildAccountSummaries`,
 * the app's real one), two spend feeds, the same live Airtable appointments.
 *
 * Answers exactly three questions:
 *   1. Does total spend move UP, and by how much?
 *   2. Do ATTRIBUTED appointment counts drop?
 *   3. Does any client lose its appointments to a rename?
 */
import './_shim.mts';
import { buildAccountSummaries, fetchAirtableData } from '../src/lib/dataService';
import { fetchMetaAdSpend, ALL_DATES } from '../src/lib/metaAdSpend';
import { fetchAccountRegistry } from '../src/lib/accountRegistry';
import { loadSettingsWithSource } from '../src/lib/config';
import type { AdSpendRow } from '../src/lib/types';

const SHEET =
  'https://docs.google.com/spreadsheets/d/1g6hqd1-8A_XNUVfcd13g36jVDdHnqR4o6gX2-eCuSBE/export?format=csv&gid=0';

const money = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Minimal CSV reader — the sheet has quoted fields containing commas. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift()!.map(h => h.trim());
  return rows.filter(r => r.some(v => v.trim() !== ''))
    .map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const num = (v: string | undefined) => {
  const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const iso = (v: string | undefined) => {
  const s = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return s.slice(0, 10);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${String(+m[1]).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}`;
  return '';
};

/** The sheet feed, shaped exactly as the deleted `fetchGoogleSheetData` shaped it. */
async function sheetFeed(): Promise<AdSpendRow[]> {
  const res = await fetch(SHEET);
  if (!res.ok) throw new Error(`sheet ${res.status}`);
  return parseCsv(await res.text()).map(r => ({
    month: r['Month'] ?? '',
    date: r['Date'] ?? '',
    dateISO: iso(r['Date']),
    campaign: r['Campaign'] ?? '',
    campaignId: r['Campaign Id'] ?? '',
    adsetName: r['Adset Name'] ?? '',
    adsetId: r['Adset Id'] ?? '',
    adName: r['Ad Name'] ?? '',
    adId: r['Ad Id'] ?? '',
    spent: num(r['Spent']),
    leads: num(r['Leads']),
    accountName: r['Account Name'] ?? '',
  })) as AdSpendRow[];
}

const sum = (rows: AdSpendRow[]) => ({
  rows: rows.length,
  spend: rows.reduce((a, r) => a + r.spent, 0),
  leads: rows.reduce((a, r) => a + r.leads, 0),
});

async function main() {
  const { settings } = await loadSettingsWithSource();
  const [sheet, meta, air, registry] = await Promise.all([
    sheetFeed(), fetchMetaAdSpend(settings, ALL_DATES), fetchAirtableData(settings), fetchAccountRegistry(),
  ]);
  const appts = air.records;

  const a = sum(sheet), b = sum(meta);
  console.log('\n=== ① RAW FEEDS ===');
  console.log(`sheet        rows ${a.rows.toLocaleString()}  spend ${money(a.spend)}  leads ${a.leads.toLocaleString()}`);
  console.log(`ad_insights  rows ${b.rows.toLocaleString()}  spend ${money(b.spend)}  leads ${b.leads.toLocaleString()}`);
  console.log(`MOVE         ${b.spend > a.spend ? 'UP' : 'DOWN'} ${money(b.spend - a.spend)}  (${((b.spend / a.spend - 1) * 100).toFixed(1)}%)`);

  console.log(`\nairtable appointments fetched: ${appts.length}   registry.known=${registry.known} airtableNameCount=${registry.airtableNameCount}`);

  // Same aggregator, both feeds.
  const A = buildAccountSummaries(sheet, appts, settings, undefined, registry);
  const B = buildAccountSummaries(meta, appts, settings, undefined, registry);

  const tot = (r: typeof A) => ({
    accounts: r.accounts.length,
    spend: r.accounts.reduce((s, x) => s + x.spend, 0),
    appts: r.accounts.reduce((s, x) => s + x.appointments, 0),
    unmatched: r.unmatchedAppointments.length,
  });
  const ta = tot(A), tb = tot(B);

  console.log('\n=== ② THROUGH THE APP AGGREGATOR ===');
  console.log(`               accounts   totalSpend        attributedAppts  unmatched  conservation`);
  for (const [label, t] of [['SHEET', ta], ['SUPABASE', tb]] as const) {
    console.log(`${label.padEnd(14)} ${String(t.accounts).padStart(3)}       ${money(t.spend).padStart(14)}   ${String(t.appts).padStart(6)}         ${String(t.unmatched).padStart(4)}      ${t.appts + t.unmatched} ${t.appts + t.unmatched === appts.length ? '== TOTAL ✅' : '!= ' + appts.length + ' ❌'}`);
  }
  console.log(`\nSPEND  ${money(tb.spend - ta.spend)}  (${((tb.spend / ta.spend - 1) * 100).toFixed(1)}%)  ${tb.spend > ta.spend ? '✅ UP' : '❌ NOT UP'}`);
  console.log(`APPTS  attributed ${tb.appts - ta.appts >= 0 ? '+' : ''}${tb.appts - ta.appts}   ${tb.appts >= ta.appts ? '✅ did not drop' : '❌ DROPPED'}`);

  // ③ Per-client appointment movement, keyed by the DISPLAY name a human would recognise.
  const byClient = (r: typeof A) => {
    const m = new Map<string, number>();
    for (const s of r.accounts) if (s.appointments > 0) {
      const k = (s.companyName || s.accountName).trim().toLowerCase();
      m.set(k, (m.get(k) ?? 0) + s.appointments);
    }
    return m;
  };
  const ca = byClient(A), cb = byClient(B);
  const lost: string[] = [];
  for (const [k, v] of ca) {
    const after = cb.get(k) ?? 0;
    if (after < v) lost.push(`  ${k}: ${v} -> ${after}  (-${v - after})`);
  }
  console.log('\n=== ③ CLIENTS WHOSE APPOINTMENTS FELL (by display name) ===');
  console.log(lost.length ? lost.join('\n') : '  none');

  console.log('\n=== ④ UNMATCHED APPOINTMENTS, BY CLIENT (after cutover) ===');
  const um = new Map<string, number>();
  for (const x of B.unmatchedAppointments) um.set((x.client || '(blank)').trim(), (um.get((x.client || '(blank)').trim()) ?? 0) + 1);
  for (const [k, v] of [...um.entries()].sort((p, q) => q[1] - p[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
