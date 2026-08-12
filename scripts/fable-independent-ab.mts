/**
 * INDEPENDENT A/B — written from scratch, deliberately not reusing the cutover author's
 * scripts. One aggregator (the app's own `buildAccountSummaries`), two feeds.
 *
 * Answers exactly three questions the brief asks and refuses to infer any of them:
 *   1. does TOTAL SPEND move UP, and by how much
 *   2. do APPOINTMENTS survive the identity change (per client, not just in total)
 *   3. does the Airtable join key still reach the same clients
 */
import './_shim.mts';
import { readFileSync } from 'node:fs';
import { loadSettingsWithSource } from '../src/lib/config';
import { fetchMetaAdSpend, ALL_DATES } from '../src/lib/metaAdSpend';
import { fetchAirtableData, buildAccountSummaries, normalizeSourceDate } from '../src/lib/dataService';
import { fetchAccountRegistry } from '../src/lib/accountRegistry';
import type { AdSpendRow } from '../src/lib/types';

const SHEET = 'https://docs.google.com/spreadsheets/d/1g6hqd1-8A_XNUVfcd13g36jVDdHnqR4o6gX2-eCuSBE/export?format=csv&gid=0';
const money = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Minimal RFC4180 CSV reader. Independent of the app's parser on purpose. */
function csv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift()!;
  return rows.filter(r => r.some(v => v !== '')).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

/** The sheet feed, mapped exactly as `git show HEAD:src/lib/dataService.ts` mapped it. */
function sheetRows(text: string): AdSpendRow[] {
  return csv(text).map(r => ({
    month: r['Month'], date: r['Date'], dateISO: normalizeSourceDate(r['Date']),
    campaign: r['Campaign'], campaignId: r['Campaign Id'] ?? r['Campaign ID'],
    adsetName: r['Adset Name'], adsetId: r['Adset Id'], adName: r['Ad Name'], adId: r['Ad Id'],
    spent: parseNumber(r['Spent']), leads: parseNumber(r['Leads']), accountName: r['Account Name'],
  })) as AdSpendRow[];
}

/** The sheet-era numeric parser, reproduced verbatim from `git show HEAD:src/lib/dataService.ts:17`. */
function parseNumber(val: string | undefined): number {
  if (!val) return 0;
  const cleaned = val.replace(/[$,\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

function totals(label: string, rows: AdSpendRow[]) {
  const spend = sum(rows.map(r => r.spent));
  const leads = sum(rows.map(r => r.leads));
  console.log(`  ${label.padEnd(14)} rows ${String(rows.length).padStart(6)}   spend ${money(spend).padStart(13)}   leads ${String(leads).padStart(6)}`);
  return { spend, leads, rows: rows.length };
}

const main = async () => {
  const { settings, origin } = await loadSettingsWithSource();
  console.log('settings origin:', origin);
  const registry = await fetchAccountRegistry();
  console.log(`registry: ${registry.known ? 'LOADED' : 'UNAVAILABLE'}  accounts=${registry.size ?? '?'}  airtableNames=${registry.airtableNameCount}\n`);

  const [supa, sheetText, air] = await Promise.all([
    fetchMetaAdSpend(settings, ALL_DATES),
    fetch(SHEET).then(r => { if (!r.ok) throw new Error('sheet ' + r.status); return r.text(); }),
    fetchAirtableData(settings),
  ]);
  const sheet = sheetRows(sheetText);
  // fetchAirtableData already returns MAPPED AppointmentRow[]; re-mapping would double-map.
  const appts = air.records;

  console.log('① RAW FEEDS (all dates)');
  const S = totals('sheet', sheet);
  const M = totals('ad_insights', supa);
  console.log(`  ${'MOVE'.padEnd(14)}                  ${(M.spend >= S.spend ? '+' : '') + money(M.spend - S.spend)}  (${((M.spend / S.spend - 1) * 100).toFixed(1)}%)\n`);

  // Same window on both sides, so the comparison is not an artefact of coverage.
  const lo = '2025-01-01', hi = sheet.map(r => r.dateISO).filter(Boolean).sort().at(-1)!;
  const win = (rs: AdSpendRow[]) => rs.filter(r => r.dateISO >= lo && r.dateISO <= hi);
  console.log(`② SAME WINDOW ${lo}..${hi}`);
  const S2 = totals('sheet', win(sheet));
  const M2 = totals('ad_insights', win(supa));
  console.log(`  ${'MOVE'.padEnd(14)}                  ${(M2.spend >= S2.spend ? '+' : '') + money(M2.spend - S2.spend)}  (${((M2.spend / S2.spend - 1) * 100).toFixed(1)}%)\n`);

  // ---- the aggregator, one implementation, two feeds ----
  const flags = { spend: true, appts: true };
  const A = buildAccountSummaries(sheet, appts, settings, flags, registry);   // BEFORE
  const B = buildAccountSummaries(supa, appts, settings, flags, registry);    // AFTER

  const tileSpend = (r: typeof A) => sum(r.accounts.filter(a => a.status === 'Active').map(a => a.spend || 0));
  const tileAppt = (r: typeof A) => sum(r.accounts.filter(a => a.status === 'Active').map(a => a.appointments || 0));

  console.log('③ THE TILES (Active accounts only, as Dashboard reduces them)');
  console.log(`  TOTAL SPEND  ${money(tileSpend(A))}  ->  ${money(tileSpend(B))}   ${(tileSpend(B) >= tileSpend(A) ? '+' : '') + money(tileSpend(B) - tileSpend(A))}  (${((tileSpend(B) / tileSpend(A) - 1) * 100).toFixed(1)}%)`);
  console.log(`  rows on page ${A.accounts.length}  ->  ${B.accounts.length}`);

  console.log('\n④ APPOINTMENT CONSERVATION  (the trap: identity moved from NAME to account_id)');
  const consA = tileAppt(A) + A.unmatchedAppointments.length;
  const consB = tileAppt(B) + B.unmatchedAppointments.length;
  const allA = sum(A.accounts.map(a => a.appointments || 0)) + A.unmatchedAppointments.length;
  const allB = sum(B.accounts.map(a => a.appointments || 0)) + B.unmatchedAppointments.length;
  console.log(`  airtable records fetched     ${air.records.length}   mapped ${appts.length}   unresolved-link ${air.unresolvedLinks ?? 0}`);
  console.log(`  attributed (Active)   ${tileAppt(A)}  ->  ${tileAppt(B)}`);
  console.log(`  attributed (ALL rows) ${allA - A.unmatchedAppointments.length}  ->  ${allB - B.unmatchedAppointments.length}`);
  console.log(`  unmatched             ${A.unmatchedAppointments.length}  ->  ${B.unmatchedAppointments.length}`);
  console.log(`  CONSERVATION  all+unmatched  ${allA}  ->  ${allB}   ${allA === allB && allB === appts.length ? 'OK, equals the ' + appts.length + ' fetched' : '🔴 NOT CONSERVED'}`);
  console.log(`  Active+unmatched             ${consA}  ->  ${consB}`);

  // per-client movement — the only view that can see a swap that nets to zero
  console.log('\n⑤ PER-CLIENT APPOINTMENT MOVEMENT  (a swap that nets to zero is invisible in a total)');
  const byName = (r: typeof A) => {
    const m = new Map<string, number>();
    for (const a of r.accounts) { const k = (a.companyName || a.accountName || '?') as string; m.set(k, (m.get(k) ?? 0) + (a.appointments || 0)); }
    return m;
  };
  const ma = byName(A), mb = byName(B);
  const moved: string[] = [];
  for (const k of new Set([...ma.keys(), ...mb.keys()])) {
    const x = ma.get(k) ?? 0, y = mb.get(k) ?? 0;
    if (x !== y) moved.push(`  ${y > x ? '+' : ''}${y - x}  ${String(x).padStart(4)} -> ${String(y).padStart(4)}   ${k}`);
  }
  console.log(moved.length ? moved.sort().join('\n') : '  no client changed count');
  const lost = moved.filter(l => /^\s*-/.test(l));
  console.log(`\n  clients losing appointments: ${lost.length}`);

  console.log('\n⑥ ACCOUNTS PRESENT IN THE SHEET AND ABSENT AFTER (spend that leaves the product)');
  const spendA = new Map<string, number>(), spendB = new Map<string, number>();
  for (const a of A.accounts) spendA.set((a.companyName || a.accountName) as string, (spendA.get((a.companyName || a.accountName) as string) ?? 0) + (a.spend || 0));
  for (const a of B.accounts) spendB.set((a.companyName || a.accountName) as string, (spendB.get((a.companyName || a.accountName) as string) ?? 0) + (a.spend || 0));
  let gone = 0, goneN = 0;
  for (const [k, v] of spendA) if (!spendB.has(k)) { gone += v; goneN++; console.log(`  -${money(v).padStart(12)}  ${k}`); }
  console.log(`  ${goneN} accounts, ${money(gone)}`);
};

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
