/**
 * THE TILES THE USER ACTUALLY READS, before and after — not the raw feed total.
 *
 * Dashboard reduces every KPI over ACTIVE accounts only (`Dashboard.tsx:890,922`), so the raw
 * feed sum is NOT the number on screen. Verifying the feed and reporting it as "the tile"
 * would be measuring a proxy. This reproduces the tile's own reduction over the app's real
 * `buildAccountSummaries` output, in both worlds.
 */
import './_shim.mts';
import { buildAccountSummaries, fetchAirtableData } from '../src/lib/dataService';
import { fetchMetaAdSpend, ALL_DATES } from '../src/lib/metaAdSpend';
import { fetchAccountRegistry, emptyAccountRegistry } from '../src/lib/accountRegistry';
import { loadSettingsWithSource } from '../src/lib/config';
import type { AdSpendRow, AppointmentRow } from '../src/lib/types';
import fs from 'node:fs';

const money = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function parseCsv(text: string): string[][] {
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
  return rows;
}
const num = (v: string) => Number(String(v ?? '').replace(/[$,\s]/g, '')) || 0;
const iso = (s: string) => {
  s = (s ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  return m ? `${m[3]}-${String(+m[1]).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}` : '';
};

function sheetFeed(path: string): AdSpendRow[] {
  const rows = parseCsv(fs.readFileSync(path, 'utf8'));
  const head = rows.shift()!.map(h => h.trim());
  const g = (r: string[], n: string) => (r[head.indexOf(n)] ?? '').trim();
  return rows.filter(r => r.some(v => v.trim() !== '')).map(r => ({
    month: g(r, 'Month'), date: g(r, 'Date'), dateISO: iso(g(r, 'Date')),
    campaign: g(r, 'Campaign'), campaignId: g(r, 'Campaign Id'),
    adsetName: g(r, 'Adset Name'), adsetId: g(r, 'Adset Id'),
    adName: g(r, 'Ad Name'), adId: g(r, 'Ad Id'),
    spent: num(g(r, 'Spent')), leads: num(g(r, 'Leads')), accountName: g(r, 'Account Name'),
  })) as AdSpendRow[];
}

async function main() {
  const { settings } = await loadSettingsWithSource();
  const registry = await fetchAccountRegistry();
  const [meta, air] = await Promise.all([fetchMetaAdSpend(settings, ALL_DATES), fetchAirtableData(settings)]);
  const sheet = sheetFeed(process.argv[2] ?? '/tmp/sheet_0.csv');
  const appts = air.records as AppointmentRow[];

  const before = buildAccountSummaries(sheet, appts, settings, undefined, emptyAccountRegistry());
  const after = buildAccountSummaries(meta, appts, settings, undefined, registry);

  console.log('  ' + 'tile'.padEnd(22) + 'BEFORE (sheet)'.padStart(18) + 'AFTER (supabase)'.padStart(20) + 'move'.padStart(20));
  const line = (label: string, b: number, a: number, fmt: (n: number) => string) => {
    const d = a - b;
    const pct = b ? ` (${d >= 0 ? '+' : ''}${((a / b - 1) * 100).toFixed(1)}%)` : '';
    console.log('  ' + label.padEnd(22) + fmt(b).padStart(18) + fmt(a).padStart(20) + `${d >= 0 ? '+' : '-'}${fmt(Math.abs(d))}${pct}`.padStart(20));
  };

  for (const [name, r] of [['BEFORE', before], ['AFTER', after]] as const) void name, r;

  const act = (r: typeof before) => r.accounts.filter(a => a.status === 'Active');
  const bA = act(before), aA = act(after);

  line('TOTAL SPEND', bA.reduce((s, a) => s + a.spend, 0), aA.reduce((s, a) => s + a.spend, 0), money);
  line('TOTAL LEADS', bA.reduce((s, a) => s + a.leads, 0), aA.reduce((s, a) => s + a.leads, 0), n => String(Math.round(n)));
  const bAppt = bA.reduce((s, a) => s + a.appointments, 0) + before.unmatchedAppointments.length;
  const aAppt = aA.reduce((s, a) => s + a.appointments, 0) + after.unmatchedAppointments.length;
  line('TOTAL APPTS', bAppt, aAppt, n => String(Math.round(n)));
  line('active accounts', bA.length, aA.length, n => String(Math.round(n)));
  line('all accounts', before.accounts.length, after.accounts.length, n => String(Math.round(n)));

  const inact = (r: typeof before) => r.accounts.filter(a => a.status !== 'Active');
  for (const [label, r] of [['BEFORE', before], ['AFTER', after]] as const) {
    const ia = inact(r);
    console.log(`\n  ${label} excluded as non-Active: ${ia.length} account(s), ${money(ia.reduce((s, a) => s + a.spend, 0))}` +
      (ia.length ? ` — ${ia.map(a => a.accountName).join(', ')}` : ''));
  }
  console.log(`\n  raw feed sums:  sheet ${money(sheet.reduce((s, r) => s + r.spent, 0))}   ad_insights ${money(meta.reduce((s, r) => s + r.spent, 0))}`);
}

main().catch(e => { console.error('🔴', e); process.exit(1); });
