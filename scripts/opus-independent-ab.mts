/**
 * INDEPENDENT A/B — written from scratch, not derived from the other scripts in this dir.
 * One aggregator (the app's own buildAccountSummaries), two feeds (the live Google Sheet and
 * the live ad_insights_resolved), the same settings, the same registry, the same Airtable pull.
 *
 * Answers exactly three questions:
 *   1. Does the TOTAL SPEND tile move UP, and by how much?
 *   2. Is every Airtable appointment still accounted for after the cutover?
 *   3. Does any account LOSE appointments?
 */
import './_shim.mts';
import { fetchMetaAdSpend } from '@/lib/metaAdSpend';
import { fetchAirtableData, buildAccountSummaries } from '@/lib/dataService';
import { fetchAccountRegistry } from '@/lib/accountRegistry';
import { loadSettingsAsync } from '@/lib/config';
import type { AdSpendRow } from '@/lib/types';

const SHEET = '1g6hqd1-8A_XNUVfcd13g36jVDdHnqR4o6gX2-eCuSBE';
const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ---- my own CSV reader + sheet mapper, deliberately not the app's deleted one ---- */
function splitCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === ',' && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur); return out;
}
function num(s: string): number {
  const v = Number(String(s ?? '').replace(/[$,]/g, '').trim());
  return Number.isFinite(v) ? v : 0;
}
function isoOf(d: string): string {
  const s = String(d ?? '').trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${String(+m[1]).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? s.slice(0, 10) : '';
}
async function fetchSheetRows(): Promise<AdSpendRow[]> {
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET}/export?format=csv&gid=0`);
  if (!res.ok) throw new Error(`sheet ${res.status}`);
  const lines = (await res.text()).split('\n').filter(l => l.trim());
  const head = splitCsvLine(lines[0]).map(h => h.trim());
  const idx = (n: string) => head.indexOf(n);
  return lines.slice(1).map(l => {
    const v = splitCsvLine(l).map(x => x.trim());
    const at = (n: string) => { const i = idx(n); return i >= 0 ? (v[i] ?? '') : ''; };
    const date = at('Date');
    return {
      month: at('Month'), date, dateISO: isoOf(date),
      campaign: at('Campaign'), campaignId: at('Campaign Id'),
      adsetName: at('Adset Name'), adsetId: at('Adset Id'),
      adName: at('Ad Name'), adId: at('Ad Id'),
      spent: num(at('Spent')), leads: num(at('Leads')),
      accountName: at('Account Name'),
    } as AdSpendRow;
  });
}

/* ---- the tile, reproduced exactly as Dashboard.tsx computes it ---- */
function tile(accounts: any[]) {
  const active = accounts.filter(a => a.status === 'Active');
  return {
    spend: active.reduce((s, a) => s + a.spend, 0),
    leads: active.reduce((s, a) => s + a.leads, 0),
    appts: active.reduce((s, a) => s + (a.appointments ?? 0), 0),
    accounts: active.length,
    allAccounts: accounts.length,
  };
}

const main = async () => {
  const settings = await loadSettingsAsync();
  const registry = await fetchAccountRegistry();
  const air = await fetchAirtableData(settings);
  const appts = air.records;

  const sheetRows = await fetchSheetRows();
  const metaRows = await fetchMetaAdSpend(settings);

  console.log(`\nFEEDS`);
  console.log(`  sheet        ${sheetRows.length.toLocaleString()} rows  ${money(sheetRows.reduce((s, r) => s + r.spent, 0))}`);
  console.log(`  ad_insights  ${metaRows.length.toLocaleString()} rows  ${money(metaRows.reduce((s, r) => s + r.spent, 0))}`);
  console.log(`  airtable     ${appts.length} appointments   registry: ${registry.size} named / ${registry.airtableNameCount} airtable-linked / known=${registry.known}`);

  const before = buildAccountSummaries(sheetRows, appts, settings, undefined, registry);
  const after = buildAccountSummaries(metaRows, appts, settings, undefined, registry);
  const tb = tile(before.accounts), ta = tile(after.accounts);

  console.log(`\nTILES (Active-only, exactly as Dashboard.tsx reduces them)`);
  console.log(`                    sheet            ad_insights        move`);
  console.log(`  TOTAL SPEND   ${money(tb.spend).padStart(14)}  ${money(ta.spend).padStart(15)}   ${(ta.spend >= tb.spend ? '+' : '')}${money(ta.spend - tb.spend)}  (${((ta.spend - tb.spend) / tb.spend * 100).toFixed(1)}%)`);
  console.log(`  TOTAL LEADS   ${tb.leads.toLocaleString().padStart(14)}  ${ta.leads.toLocaleString().padStart(15)}   ${ta.leads - tb.leads >= 0 ? '+' : ''}${(ta.leads - tb.leads).toLocaleString()}`);
  console.log(`  ACCOUNTS      ${String(tb.accounts).padStart(14)}  ${String(ta.accounts).padStart(15)}   ${ta.accounts - tb.accounts >= 0 ? '+' : ''}${ta.accounts - tb.accounts}`);

  /* ---- APPOINTMENT CONSERVATION, as an identity rather than two sums ---- */
  const sumAppts = (r: any) => r.accounts.reduce((s: number, a: any) => s + (a.appointmentList?.length ?? 0), 0);
  const bAtt = sumAppts(before), aAtt = sumAppts(after);
  const bUn = before.unmatchedAppointments.length, aUn = after.unmatchedAppointments.length;
  console.log(`\nAPPOINTMENT CONSERVATION  (airtable holds ${appts.length})`);
  console.log(`  sheet        attributed ${bAtt} + unmatched ${bUn} = ${bAtt + bUn}  ${bAtt + bUn === appts.length ? 'CONSERVED' : '🔴 LOST ' + (appts.length - bAtt - bUn)}`);
  console.log(`  ad_insights  attributed ${aAtt} + unmatched ${aUn} = ${aAtt + aUn}  ${aAtt + aUn === appts.length ? 'CONSERVED' : '🔴 LOST ' + (appts.length - aAtt - aUn)}`);
  console.log(`  TOTAL APPTS tile: ${bAtt + bUn} -> ${aAtt + aUn}`);

  /* ---- did any CLIENT lose appointments? keyed on the airtable client name ---- */
  const byClient = (r: any) => {
    const m = new Map<string, number>();
    for (const a of r.accounts) for (const ap of (a.appointmentList ?? [])) {
      const k = String(ap.client ?? '').trim().toLowerCase() || '(blank)';
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const mb = byClient(before), ma = byClient(after);
  const keys = [...new Set([...mb.keys(), ...ma.keys()])].sort();
  const moved = keys.map(k => [k, mb.get(k) ?? 0, ma.get(k) ?? 0] as const).filter(([, b, a]) => b !== a);
  console.log(`\nPER-CLIENT ATTRIBUTED COUNTS — ${keys.length} clients, ${moved.length} changed`);
  for (const [k, b, a] of moved.sort((x, y) => (x[2] - x[1]) - (y[2] - y[1]))) {
    console.log(`  ${a - b > 0 ? '+' : ''}${a - b}  ${String(b).padStart(4)} -> ${String(a).padStart(4)}  ${k}`);
  }
  const lost = moved.filter(([, b, a]) => a < b).reduce((s, [, b, a]) => s + (b - a), 0);
  const gained = moved.filter(([, b, a]) => a > b).reduce((s, [, b, a]) => s + (a - b), 0);
  console.log(`\n  attributed lost ${lost}, gained ${gained}; unmatched ${bUn} -> ${aUn} (delta ${aUn - bUn})`);
  console.log(`  net check: ${lost} lost - ${gained} gained = ${lost - gained}, unmatched delta ${aUn - bUn} ${lost - gained === aUn - bUn ? 'BALANCES' : '🔴 DOES NOT BALANCE'}`);
};
main().catch(e => { console.error('FAILED', e); process.exit(1); });
