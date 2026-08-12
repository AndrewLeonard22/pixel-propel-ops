/**
 * INDEPENDENT APPOINTMENT-REGRESSION AUDIT — written from scratch, not derived from
 * `appt-join-audit.mts`, so that it is a SECOND INSTRUMENT rather than a second reading of
 * the first one.
 *
 * The brief's FAIL criterion is literal: "Any account that had appointments and now has zero
 * is a FAIL." A per-account tally alone cannot answer that honestly, because account IDENTITY
 * itself changes across the cutover (name-keyed before, id-keyed after) — so an account that
 * merely got RENAMED would read as "had appointments, now zero" and a real loss would read
 * the same way. This therefore measures on the one axis that does NOT move: the Airtable
 * CLIENT NAME, which both worlds receive byte-identical from the same live fetch.
 *
 * THREE worlds, so that "the feed changed" and "a new join table was added" cannot be
 * confused with each other:
 *   A  sheet    + NO registry  — production today
 *   B  sheet    + registry     — isolates the new join table alone
 *   C  supabase + registry     — after the cutover
 * A->C is the regression question. B->C isolates the feed. A->B isolates the join table.
 */
import './_shim.mts';
import { buildAccountSummaries, fetchAirtableData } from '../src/lib/dataService';
import { fetchMetaAdSpend, ALL_DATES } from '../src/lib/metaAdSpend';
import { fetchAccountRegistry, emptyAccountRegistry } from '../src/lib/accountRegistry';
import { loadSettingsWithSource } from '../src/lib/config';
import type { AdSpendRow, AppointmentRow } from '../src/lib/types';
import fs from 'node:fs';

const money = (n: number) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function parseCsv(text: string): string[][] {
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
  return rows;
}

const num = (v: string | undefined) => {
  const n = Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const iso = (v: string | undefined) => {
  const s = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  return m ? `${m[3]}-${String(+m[1]).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}` : '';
};

/** The sheet feed, read from a file already downloaded, shaped as the deleted fetcher shaped it. */
function sheetFeed(path: string): AdSpendRow[] {
  const rows = parseCsv(fs.readFileSync(path, 'utf8'));
  const head = rows.shift()!.map(h => h.trim());
  const col = (r: string[], name: string) => (r[head.indexOf(name)] ?? '').trim();
  return rows.filter(r => r.some(v => v.trim() !== '')).map(r => ({
    month: col(r, 'Month'), date: col(r, 'Date'), dateISO: iso(col(r, 'Date')),
    campaign: col(r, 'Campaign'), campaignId: col(r, 'Campaign Id'),
    adsetName: col(r, 'Adset Name'), adsetId: col(r, 'Adset Id'),
    adName: col(r, 'Ad Name'), adId: col(r, 'Ad Id'),
    spent: num(col(r, 'Spent')), leads: num(col(r, 'Leads')),
    accountName: col(r, 'Account Name'),
  })) as AdSpendRow[];
}

type Tagged = AppointmentRow & { __i: number };

interface World {
  label: string;
  /** appointment index -> account label it landed on ('' when unmatched) */
  attr: Map<number, string>;
  unmatched: number;
  accounts: { accountName: string; appts: number }[];
}

function world(
  label: string,
  res: { accounts: { accountName: string; appointmentList: AppointmentRow[] }[]; unmatchedAppointments: AppointmentRow[] },
): World {
  const attr = new Map<number, string>();
  for (const s of res.accounts) for (const a of s.appointmentList) attr.set((a as Tagged).__i, s.accountName);
  return {
    label, attr, unmatched: res.unmatchedAppointments.length,
    accounts: res.accounts.map(s => ({ accountName: s.accountName, appts: s.appointmentList.length })),
  };
}

async function main() {
  const sheetPath = process.argv[2] ?? '/tmp/sheet_0.csv';
  const { settings } = await loadSettingsWithSource();
  const registry = await fetchAccountRegistry();
  const empty = emptyAccountRegistry();

  const [meta, air] = await Promise.all([
    fetchMetaAdSpend(settings, ALL_DATES),
    fetchAirtableData(settings),
  ]);
  const sheet = sheetFeed(sheetPath);

  const appts = air.records.map((a, i) => Object.assign(a, { __i: i })) as Tagged[];

  const A = world('A sheet+noreg', buildAccountSummaries(sheet, appts, settings, undefined, empty));
  const B = world('B sheet+reg', buildAccountSummaries(sheet, appts, settings, undefined, registry));
  const C = world('C supa+reg', buildAccountSummaries(meta, appts, settings, undefined, registry));

  const sSpend = sheet.reduce((s, r) => s + r.spent, 0);
  const mSpend = meta.reduce((s, r) => s + r.spent, 0);

  console.log('=== ① THE FEEDS ===');
  console.log(`sheet        ${String(sheet.length).padStart(6)} rows  ${money(sSpend)}`);
  console.log(`ad_insights  ${String(meta.length).padStart(6)} rows  ${money(mSpend)}`);
  console.log(`MOVE ${mSpend >= sSpend ? 'UP' : '🔴 DOWN'} ${money(Math.abs(mSpend - sSpend))}  (${((mSpend / sSpend - 1) * 100).toFixed(1)}%)`);

  console.log('\n=== ② CONSERVATION (every appointment accounted for, in every world) ===');
  for (const w of [A, B, C]) {
    const total = w.attr.size + w.unmatched;
    console.log(
      `${w.label.padEnd(16)} attributed ${String(w.attr.size).padStart(4)} + unmatched ${String(w.unmatched).padStart(3)}` +
      ` = ${String(total).padStart(4)} of ${appts.length}  ${total === appts.length ? '✅' : '🔴 LEAK'}`,
    );
  }

  console.log('\n=== ③ THE FAIL CRITERION, measured on the axis that does not move ===');
  console.log('    per Airtable CLIENT NAME: attributed appointments, world A vs world C\n');
  const byClient = new Map<string, { total: number; a: number; c: number }>();
  for (const ap of appts) {
    const client = (ap.client || '').trim() || '(no client name)';
    if (!byClient.has(client)) byClient.set(client, { total: 0, a: 0, c: 0 });
    const e = byClient.get(client)!;
    e.total++;
    if (A.attr.has(ap.__i)) e.a++;
    if (C.attr.has(ap.__i)) e.c++;
  }
  const rows = [...byClient.entries()].sort((x, y) => y[1].total - x[1].total);
  console.log('  ' + 'client'.padEnd(42) + 'appts'.padStart(6) + 'A'.padStart(6) + 'C'.padStart(6) + '  verdict');
  const fails: string[] = [];
  for (const [client, e] of rows) {
    let verdict = '';
    if (e.a > 0 && e.c === 0) { verdict = '🔴 FAIL had appts, now zero'; fails.push(client); }
    else if (e.c < e.a) verdict = `⚠️  -${e.a - e.c}`;
    else if (e.c > e.a) verdict = `+${e.c - e.a} recovered`;
    else verdict = 'same';
    console.log('  ' + client.slice(0, 41).padEnd(42) + String(e.total).padStart(6) + String(e.a).padStart(6) + String(e.c).padStart(6) + '  ' + verdict);
  }

  console.log('\n=== ④ PER-APPOINTMENT MOVEMENT A -> C ===');
  let stayed = 0, moved = 0, lost = 0, gained = 0, bothUn = 0;
  const movedPairs = new Map<string, number>();
  const lostBy = new Map<string, number>();
  for (const ap of appts) {
    const a = A.attr.get(ap.__i), c = C.attr.get(ap.__i);
    if (a && c) { if (a === c) stayed++; else { moved++; movedPairs.set(`${a}  ->  ${c}`, (movedPairs.get(`${a}  ->  ${c}`) ?? 0) + 1); } }
    else if (a && !c) { lost++; lostBy.set(a, (lostBy.get(a) ?? 0) + 1); }
    else if (!a && c) gained++;
    else bothUn++;
  }
  console.log(`same account ${stayed}   moved ${moved}   attributed->unmatched ${lost}   unmatched->attributed ${gained}   unmatched in both ${bothUn}`);
  if (movedPairs.size) {
    console.log('\n  moved between accounts:');
    for (const [k, v] of [...movedPairs.entries()].sort((x, y) => y[1] - x[1])) console.log(`   ${String(v).padStart(4)}  ${k}`);
  }
  if (lostBy.size) {
    console.log('\n  became unmatched, by the account they used to sit on:');
    for (const [k, v] of [...lostBy.entries()].sort((x, y) => y[1] - x[1])) console.log(`   ${String(v).padStart(4)}  ${k}`);
  }

  console.log('\n=== ⑤ B -> C (the FEED change alone, registry held constant) ===');
  let bcSame = 0, bcMoved = 0, bcLost = 0, bcGain = 0;
  for (const ap of appts) {
    const b = B.attr.get(ap.__i), c = C.attr.get(ap.__i);
    if (b && c) (b === c ? bcSame++ : bcMoved++);
    else if (b && !c) bcLost++;
    else if (!b && c) bcGain++;
  }
  console.log(`same ${bcSame}   moved ${bcMoved}   attributed->unmatched ${bcLost}   unmatched->attributed ${bcGain}`);

  console.log('\n=== ⑥ VERDICT ===');
  if (fails.length === 0) console.log('✅ NO client that had appointments has zero after the cutover.');
  else { console.log(`🔴 ${fails.length} FAIL(s): ${fails.join(', ')}`); process.exitCode = 1; }
}

main().catch(e => { console.error('🔴', e); process.exit(1); });
