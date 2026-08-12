/**
 * THE PER-CLIENT / PER-ACCOUNT APPOINTMENT TABLE, BEFORE AND AFTER.
 *
 * `appt-join-audit.mts` answers "did anything break". This prints the evidence behind the
 * answer: every Airtable client, how many bookings it has, and which ad account claimed
 * them under each feed. A client is the unit a human reads, and a per-ACCOUNT tally alone
 * cannot show a client whose bookings silently changed hands.
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
const num = (v?: string) => { const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
const iso = (v?: string) => {
  const s = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  return m ? `${m[3]}-${String(+m[1]).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}` : '';
};
async function sheetFeed(): Promise<AdSpendRow[]> {
  const res = await fetch(SHEET);
  return parseCsv(await res.text()).map(r => ({
    month: r['Month'] ?? '', date: r['Date'] ?? '', dateISO: iso(r['Date']),
    campaign: r['Campaign'] ?? '', campaignId: r['Campaign Id'] ?? '',
    adsetName: r['Adset Name'] ?? '', adsetId: r['Adset Id'] ?? '',
    adName: r['Ad Name'] ?? '', adId: r['Ad Id'] ?? '',
    spent: num(r['Spent']), leads: num(r['Leads']), accountName: r['Account Name'] ?? '',
  })) as AdSpendRow[];
}
type Tagged = AppointmentRow & { __i: number };
function attribution(sums: { accountName: string; appointmentList: AppointmentRow[] }[]) {
  const m = new Map<number, string>();
  for (const s of sums) for (const a of s.appointmentList) m.set((a as Tagged).__i, s.accountName);
  return m;
}

async function main() {
  const { settings } = await loadSettingsWithSource();
  const registry = await fetchAccountRegistry();
  const [sheet, meta, air] = await Promise.all([sheetFeed(), fetchMetaAdSpend(settings, ALL_DATES), fetchAirtableData(settings)]);
  const appts = air.records.map((a, i) => Object.assign(a, { __i: i })) as Tagged[];
  const before = buildAccountSummaries(sheet, appts, settings, undefined, registry);
  const after = buildAccountSummaries(meta, appts, settings, undefined, registry);
  const aB = attribution(before.accounts), aA = attribution(after.accounts);

  const clients = new Map<string, Tagged[]>();
  for (const a of appts) {
    const c = (a.client || '(blank)').trim();
    if (!clients.has(c)) clients.set(c, []);
    clients.get(c)!.push(a);
  }
  const top = (m: Map<string, number>) => [...m.entries()].sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}${m.size > 1 ? ` (${v})` : ''}`).join(' + ');

  console.log(`AIRTABLE CLIENTS: ${clients.size}   APPOINTMENTS: ${appts.length}\n`);
  console.log('client                                   n | before account                     | after account                      | ok');
  console.log('-'.repeat(150));
  let fails = 0;
  for (const [c, list] of [...clients.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const bm = new Map<string, number>(), am = new Map<string, number>();
    for (const a of list) {
      const b = aB.get(a.__i) ?? '— UNMATCHED —', f = aA.get(a.__i) ?? '— UNMATCHED —';
      bm.set(b, (bm.get(b) ?? 0) + 1); am.set(f, (am.get(f) ?? 0) + 1);
    }
    const bAtt = list.filter(a => aB.has(a.__i)).length;
    const aAtt = list.filter(a => aA.has(a.__i)).length;
    const ok = aAtt >= bAtt;
    if (!ok) fails++;
    console.log(`${c.slice(0, 40).padEnd(40)} ${String(list.length).padStart(3)} | ${top(bm).slice(0, 34).padEnd(34)} | ${top(am).slice(0, 34).padEnd(34)} | ${ok ? '✅' : `🔴 ${bAtt}->${aAtt}`}`);
  }
  console.log('-'.repeat(150));
  console.log(`clients losing attribution: ${fails}`);

  // Do any Airtable clients correspond to the five renamed accounts at all?
  console.log('\n=== DO THE RENAMED ACCOUNTS HAVE ANY AIRTABLE CLIENT? ===');
  const NEEDLES = ['washbroz', 'publicity', 'columbia', '10170221', 'pro clean', '222178771', 'trueclean', '103578393327348', 'hydro', 'christmas light pros'];
  for (const n of NEEDLES) {
    const hits = [...clients.keys()].filter(c => c.toLowerCase().includes(n));
    console.log(`   "${n}" -> ${hits.length ? hits.map(h => `${h} (${clients.get(h)!.length})`).join(', ') : 'no Airtable client'}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
