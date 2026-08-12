/**
 * PER-APPOINTMENT ATTRIBUTION DIFF.
 *
 * The per-CLIENT aggregate cannot tell a LOSS from a RE-KEY: if one client's bucket is
 * named differently under the two feeds, the same appointment shows as -1 here and +1
 * there. This tracks each appointment RECORD and reports where it actually landed.
 */
import './_shim.mts';
import { buildAccountSummaries, fetchAirtableData } from '../src/lib/dataService';
import { fetchMetaAdSpend, ALL_DATES } from '../src/lib/metaAdSpend';
import { fetchAccountRegistry } from '../src/lib/accountRegistry';
import { loadSettingsWithSource } from '../src/lib/config';
import type { AdSpendRow, AppointmentRow } from '../src/lib/types';

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

/** A stable identity for one appointment record, independent of which account it lands in. */
const apptId = (a: AppointmentRow, i: number) =>
  (a as unknown as { recordId?: string }).recordId || `${a.client}|${a.appointmentDate}|${a.setter ?? ''}|#${i}`;

async function main() {
  const { settings } = await loadSettingsWithSource();
  const [sheet, meta, air, registry] = await Promise.all([
    sheetFeed(), fetchMetaAdSpend(settings, ALL_DATES), fetchAirtableData(settings), fetchAccountRegistry(),
  ]);
  const appts = air.records;
  const idOf = new Map<AppointmentRow, string>();
  appts.forEach((a, i) => idOf.set(a, apptId(a, i)));

  // Where did each appointment land, under each feed?
  const place = (spend: AdSpendRow[]) => {
    const r = buildAccountSummaries(spend, appts, settings, undefined, registry);
    const m = new Map<string, string>();
    for (const s of r.accounts) {
      // re-derive membership: buildAccountSummaries does not return per-account rows, so
      // recompute by asking which appointments are NOT unmatched and grouping by summary.
    }
    const unmatched = new Set(r.unmatchedAppointments.map(a => idOf.get(a)!));
    for (const a of appts) {
      const id = idOf.get(a)!;
      m.set(id, unmatched.has(id) ? '(UNMATCHED)' : '(attributed)');
    }
    return { r, m, unmatched };
  };

  const A = place(sheet), B = place(meta);

  console.log('=== APPOINTMENTS THAT CHANGED ATTRIBUTION STATE ===');
  let becameUnmatched = 0, becameAttributed = 0;
  const bu: AppointmentRow[] = [], ba: AppointmentRow[] = [];
  for (const a of appts) {
    const id = idOf.get(a)!;
    const before = A.m.get(id), after = B.m.get(id);
    if (before === after) continue;
    if (after === '(UNMATCHED)') { becameUnmatched++; bu.push(a); } else { becameAttributed++; ba.push(a); }
  }
  console.log(`attributed -> UNMATCHED : ${becameUnmatched}`);
  console.log(`UNMATCHED -> attributed : ${becameAttributed}`);
  console.log(`net attributed change   : ${becameAttributed - becameUnmatched}`);

  const tally = (rows: AppointmentRow[]) => {
    const m = new Map<string, number>();
    for (const a of rows) m.set((a.client || '(blank)').trim(), (m.get((a.client || '(blank)').trim()) ?? 0) + 1);
    return [...m.entries()].sort((p, q) => q[1] - p[1]);
  };
  console.log('\n-- newly UNMATCHED, by client --');
  for (const [k, v] of tally(bu)) console.log(`  ${String(v).padStart(3)}  ${k}`);
  console.log('\n-- newly ATTRIBUTED, by client --');
  for (const [k, v] of tally(ba)) console.log(`  ${String(v).padStart(3)}  ${k}`);

  // Did any client's appointments move to a DIFFERENT account while staying attributed?
  console.log('\n=== "us artificial grass" TRACE ===');
  for (const label of ['SHEET', 'SUPABASE'] as const) {
    const r = (label === 'SHEET' ? A : B).r;
    const hits = r.accounts.filter(s => /artificial/i.test(s.companyName || s.accountName) || /artificial/i.test(s.accountName));
    for (const h of hits) {
      console.log(`  ${label.padEnd(9)} accountName=${JSON.stringify(h.accountName)} company=${JSON.stringify(h.companyName)} appts=${h.appointments} spend=${h.spend.toFixed(2)}`);
    }
  }
  console.log('\n=== every client name in Airtable containing "grass" ===');
  const g = new Map<string, number>();
  for (const a of appts) if (/grass/i.test(a.client || '')) g.set(a.client!.trim(), (g.get(a.client!.trim()) ?? 0) + 1);
  for (const [k, v] of g) console.log(`  ${String(v).padStart(3)}  ${JSON.stringify(k)}`);
}

/* symmetric per-account appointment diff, gainers AND losers */
async function diff2() {
  const { settings } = await loadSettingsWithSource();
  const [sheet, meta, air, registry] = await Promise.all([
    sheetFeed(), fetchMetaAdSpend(settings, ALL_DATES), fetchAirtableData(settings), fetchAccountRegistry(),
  ]);
  const appts = air.records;
  const A = buildAccountSummaries(sheet, appts, settings, undefined, registry);
  const B = buildAccountSummaries(meta, appts, settings, undefined, registry);
  const m = (r: typeof A) => { const x = new Map<string, number>(); for (const s of r.accounts) { const k = (s.companyName || s.accountName).trim(); x.set(k, (x.get(k) ?? 0) + s.appointments); } return x; };
  const ma = m(A), mb = m(B);
  const keys = new Set([...ma.keys(), ...mb.keys()]);
  console.log('\n=== SYMMETRIC PER-ACCOUNT APPOINTMENT DIFF ===');
  for (const k of [...keys].sort()) {
    const a = ma.get(k) ?? 0, b = mb.get(k) ?? 0;
    if (a !== b) console.log(`  ${(b - a > 0 ? '+' : '') + (b - a)}\t${a} -> ${b}\t${k}`);
  }
}

main().then(diff2).catch(e => { console.error('FAILED:', e); process.exit(1); });
