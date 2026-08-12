/**
 * INDEPENDENT FINAL VERIFICATION of the ad-spend cutover.
 *
 * Written from scratch, deliberately NOT reusing any script in this directory, and
 * deliberately using the APP'S OWN MODULES rather than re-implementing their logic —
 * a harness that re-implements the aggregation proves the harness, not the app.
 *
 * It answers exactly three questions:
 *   ① what does the app compute from Supabase (feed total, tile total, known-good day)
 *   ② what did it compute from the SHEET, through the SAME aggregator (the A/B)
 *   ③ do appointments survive the swap — attributed + unmatched, per client, both feeds
 */
import './_shim.mts';
import { loadSettingsAsync } from '@/lib/config';
import { fetchMetaAdSpend, ALL_DATES } from '@/lib/metaAdSpend';
import { fetchAirtableData, buildAccountSummaries, normalizeSourceDate } from '@/lib/dataService';
import { fetchAccountRegistry } from '@/lib/accountRegistry';
import type { AdSpendRow } from '@/lib/types';
import { readFileSync } from 'node:fs';

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Parse the live sheet CSV into the SAME AdSpendRow shape, so one aggregator sees both. */
function sheetRows(path: string): AdSpendRow[] {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const split = (line: string): string[] => {
    const out: string[] = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur); return out;
  };
  const head = split(lines[0]).map(h => h.trim());
  const idx = (n: string) => head.indexOf(n);
  const iDate = idx('Date'), iSpent = idx('Spent'), iLeads = idx('Leads'), iAcct = idx('Account Name');
  const iCamp = idx('Campaign'), iCampId = idx('Campaign Id'), iAdset = idx('Adset Name');
  const iAdsetId = idx('Adset Id'), iAd = idx('Ad Name'), iAdId = idx('Ad Id'), iMonth = idx('Month');
  const rows: AdSpendRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = split(lines[i]);
    const num = (v: string) => { const n = parseFloat(String(v ?? '').replace(/[$,]/g, '')); return Number.isFinite(n) ? n : 0; };
    rows.push({
      month: c[iMonth] ?? '', date: normalizeSourceDate(c[iDate]), dateISO: normalizeSourceDate(c[iDate]),
      campaign: c[iCamp] ?? '', campaignId: c[iCampId] ?? '',
      adsetName: c[iAdset] ?? '', adsetId: c[iAdsetId] ?? '',
      adName: c[iAd] ?? '', adId: c[iAdId] ?? '',
      spent: num(c[iSpent]), leads: num(c[iLeads]),
      accountName: c[iAcct] ?? '',
    } as AdSpendRow);
  }
  return rows;
}

const inWindow = (r: AdSpendRow) => (r.dateISO || r.date || '') >= '2025-01-01';

function report(label: string, accounts: any[], unmatched: any[]) {
  const active = accounts.filter(a => a.status === 'Active');
  const spend = (xs: any[]) => xs.reduce((s, a) => s + (a.spend || 0), 0);
  const appts = (xs: any[]) => xs.reduce((s, a) => s + (a.appointments || 0), 0);
  console.log(`\n── ${label} ──`);
  console.log(`  accounts (all / Active)   ${accounts.length} / ${active.length}`);
  console.log(`  TOTAL SPEND tile (Active) ${money(spend(active))}`);
  console.log(`  feed spend (all statuses) ${money(spend(accounts))}`);
  console.log(`  appts attributed          ${appts(accounts)}`);
  console.log(`  appts unmatched           ${unmatched.length}`);
  console.log(`  TOTAL APPTS tile          ${appts(accounts) + unmatched.length}`);
  return { accounts, unmatched, attributed: appts(accounts) };
}

/** per-CLIENT appointment counts, so a MOVE between accounts cannot hide inside a total */
function perClient(accounts: any[], unmatched: any[]) {
  const m = new Map<string, number>();
  for (const a of accounts) for (const ap of (a.appointmentList || [])) {
    const k = String(ap.client || '(blank)').trim().toLowerCase();
    m.set(k, (m.get(k) || 0) + 1);
  }
  for (const ap of unmatched) {
    const k = `⟨unmatched⟩ ${String(ap.client || '(blank)').trim().toLowerCase()}`;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

/** per-ACCOUNT appointment counts — catches an appointment moving between two live accounts */
function perAccount(accounts: any[]) {
  const m = new Map<string, number>();
  for (const a of accounts) m.set(a.accountName, (a.appointments || 0));
  return m;
}

(async () => {
  const settings = await loadSettingsAsync();
  const [supaRowsAll, air, registry] = await Promise.all([
    fetchMetaAdSpend(ALL_DATES),
    fetchAirtableData(settings),
    fetchAccountRegistry(),
  ]);
  const appts = air.records;
  const supaRows = supaRowsAll.filter(inWindow);
  const sheet = sheetRows(process.argv[2]).filter(inWindow);

  console.log('════ FEEDS, 2025-01-01.. ════');
  const sum = (rs: AdSpendRow[]) => rs.reduce((s, r) => s + (r.spent || 0), 0);
  const lds = (rs: AdSpendRow[]) => rs.reduce((s, r) => s + (r.leads || 0), 0);
  console.log(`  supabase  ${supaRows.length.toLocaleString()} rows  ${money(sum(supaRows))}  ${lds(supaRows).toLocaleString()} leads`);
  console.log(`  sheet     ${sheet.length.toLocaleString()} rows  ${money(sum(sheet))}  ${lds(sheet).toLocaleString()} leads`);
  console.log(`  DELTA     ${money(sum(supaRows) - sum(sheet))}  (${(((sum(supaRows) / sum(sheet)) - 1) * 100).toFixed(1)}%)`);
  console.log(`  airtable  ${appts.length} appointment records`);

  // known-good day, through the app's own fetch
  const day = supaRowsAll.filter(r => r.date === '2026-08-08');
  const dayAccts = new Set(day.map(r => (r as any).accountId || r.accountName));
  console.log(`\n  known-good 2026-08-08: ${day.length} rows  ${money(sum(day))}  ${lds(day)} leads  ${dayAccts.size} accounts`);

  const after = buildAccountSummaries(supaRows, appts, settings, undefined, registry);
  const before = buildAccountSummaries(sheet, appts, settings, undefined, registry);

  const B = report('BEFORE — sheet feed', before.accounts, before.unmatchedAppointments);
  const A = report('AFTER  — supabase feed', after.accounts, after.unmatchedAppointments);

  console.log('\n════ APPOINTMENT CONSERVATION ════');
  const bTot = B.attributed + before.unmatchedAppointments.length;
  const aTot = A.attributed + after.unmatchedAppointments.length;
  console.log(`  airtable records                 ${appts.length}`);
  console.log(`  BEFORE attributed+unmatched      ${bTot}   ${bTot === appts.length ? '✅ conserved' : '🔴 LEAK'}`);
  console.log(`  AFTER  attributed+unmatched      ${aTot}   ${aTot === appts.length ? '✅ conserved' : '🔴 LEAK'}`);
  console.log(`  TOTAL APPTS tile moves           ${bTot} -> ${aTot}   ${aTot === bTot ? '✅ unchanged' : '🔴 CHANGED'}`);
  console.log(`  attributed moves                 ${B.attributed} -> ${A.attributed}  (${A.attributed - B.attributed})`);

  console.log('\n── per-CLIENT diff (only rows that moved) ──');
  const pb = perClient(before.accounts, before.unmatchedAppointments);
  const pa = perClient(after.accounts, after.unmatchedAppointments);
  const keys = [...new Set([...pb.keys(), ...pa.keys()])].sort();
  let moved = 0;
  for (const k of keys) {
    const b = pb.get(k) || 0, a = pa.get(k) || 0;
    if (b !== a) { moved++; console.log(`  ${a - b > 0 ? '+' : ''}${a - b}  ${String(b).padStart(4)} -> ${String(a).padStart(4)}  ${k}`); }
  }
  if (!moved) console.log('  (none)');

  console.log('\n── per-ACCOUNT appointment diff (live accounts in both feeds) ──');
  const ab = perAccount(before.accounts), aa = perAccount(after.accounts);
  const ak = [...new Set([...ab.keys(), ...aa.keys()])].sort();
  let am = 0;
  for (const k of ak) {
    const b = ab.get(k), a = aa.get(k);
    if (b !== undefined && a !== undefined && b !== a) { am++; console.log(`  ${a - b > 0 ? '+' : ''}${a - b}  ${b} -> ${a}  ${k}`); }
  }
  if (!am) console.log('  (none)');

  console.log('\n── accounts present in ONE feed only ──');
  const onlyB = ak.filter(k => ab.has(k) && !aa.has(k));
  const onlyA = ak.filter(k => aa.has(k) && !ab.has(k));
  console.log(`  sheet-only  ${onlyB.length}  appts on them: ${onlyB.reduce((s, k) => s + (ab.get(k) || 0), 0)}`);
  console.log(`  supa-only   ${onlyA.length}  appts on them: ${onlyA.reduce((s, k) => s + (aa.get(k) || 0), 0)}`);
})();
