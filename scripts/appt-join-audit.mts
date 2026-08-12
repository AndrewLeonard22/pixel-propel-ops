/**
 * APPOINTMENT JOIN AUDIT — the highest-risk half of the ad-spend cutover.
 *
 * The question is NOT "do the totals match". It is: **does any individual appointment stop
 * being attributed to a client, and if so, why?** So this traces APPOINTMENT OBJECTS, not
 * per-account tallies — a tally can balance while two clients swap histories, which is the
 * exact defect the id-keyed join exists to prevent.
 *
 * ONE aggregator (`buildAccountSummaries`, the app's real one), TWO spend feeds, the SAME
 * live Airtable fetch. Each appointment is tagged with a stable index before either run, so
 * "where did THIS booking land" is answerable in both worlds.
 *
 * Every account that loses appointments is CLASSIFIED by stable Meta ids, never by name:
 *   RENAMED-BUT-LOST  its campaign/ad ids DO exist in ad_insights ⇒ a real join regression
 *   ABSENT-FROM-META  none of its ids appear anywhere in ad_insights ⇒ the account is not
 *                     in the feed at all, and no join can attach an appointment to a row
 *                     that does not exist
 * The distinction is the whole point: the first is a bug I must fix, the second is a data
 * fact the owner has to decide about.
 */
import './_shim.mts';
import { buildAccountSummaries, fetchAirtableData } from '../src/lib/dataService';
import { fetchMetaAdSpend, ALL_DATES } from '../src/lib/metaAdSpend';
import { fetchAccountRegistry } from '../src/lib/accountRegistry';
import { loadSettingsWithSource } from '../src/lib/config';
import type { AdSpendRow, AppointmentRow } from '../src/lib/types';

const SHEET =
  'https://docs.google.com/spreadsheets/d/1g6hqd1-8A_XNUVfcd13g36jVDdHnqR4o6gX2-eCuSBE/export?format=csv&gid=0';

const money = (n: number) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
  if (/^(\d{4})-(\d{2})-(\d{2})/.test(s)) return s.slice(0, 10);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  return m ? `${m[3]}-${String(+m[1]).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}` : '';
};

/** The sheet feed, shaped exactly as the deleted `fetchGoogleSheetData` shaped it. */
async function sheetFeed(): Promise<AdSpendRow[]> {
  const res = await fetch(SHEET);
  if (!res.ok) throw new Error(`sheet ${res.status}`);
  return parseCsv(await res.text()).map(r => ({
    month: r['Month'] ?? '', date: r['Date'] ?? '', dateISO: iso(r['Date']),
    campaign: r['Campaign'] ?? '', campaignId: r['Campaign Id'] ?? '',
    adsetName: r['Adset Name'] ?? '', adsetId: r['Adset Id'] ?? '',
    adName: r['Ad Name'] ?? '', adId: r['Ad Id'] ?? '',
    spent: num(r['Spent']), leads: num(r['Leads']),
    accountName: r['Account Name'] ?? '',
  })) as AdSpendRow[];
}

type Tagged = AppointmentRow & { __i: number };

/** appointment index -> the account label it was attributed to ('' = unmatched). */
function attribution(summaries: { accountName: string; appointmentList: AppointmentRow[] }[]): Map<number, string> {
  const m = new Map<number, string>();
  for (const s of summaries) {
    for (const a of s.appointmentList) m.set((a as Tagged).__i, s.accountName);
  }
  return m;
}

async function main() {
  const { settings } = await loadSettingsWithSource();
  const registry = await fetchAccountRegistry();

  const [sheet, meta, air] = await Promise.all([
    sheetFeed(),
    fetchMetaAdSpend(settings, ALL_DATES),
    fetchAirtableData(settings),
  ]);

  const appts = air.records.map((a, i) => Object.assign(a, { __i: i })) as Tagged[];

  // ⚠️ The registry is passed to BOTH runs. It is the new stable join table, and giving it
  // only to the "after" run would credit the cutover with an improvement that is really just
  // an extra input — and would hide any appointment the registry MOVES.
  const before = buildAccountSummaries(sheet, appts, settings, undefined, registry);
  const after = buildAccountSummaries(meta, appts, settings, undefined, registry);

  const aBefore = attribution(before.accounts);
  const aAfter = attribution(after.accounts);

  const sSpend = sheet.reduce((s, r) => s + r.spent, 0);
  const mSpend = meta.reduce((s, r) => s + r.spent, 0);

  console.log('=== ① SPEND ===');
  console.log(`sheet        rows ${sheet.length.toLocaleString().padStart(7)}  ${money(sSpend)}`);
  console.log(`ad_insights  rows ${meta.length.toLocaleString().padStart(7)}  ${money(mSpend)}`);
  console.log(`MOVE  ${mSpend > sSpend ? 'UP' : 'DOWN'} ${money(Math.abs(mSpend - sSpend))}  (${((mSpend / sSpend - 1) * 100).toFixed(1)}%)`);

  console.log('\n=== ② CONSERVATION ===');
  for (const [label, r, map] of [['BEFORE (sheet)', before, aBefore], ['AFTER  (supabase)', after, aAfter]] as const) {
    const attributed = map.size;
    const unmatched = (r as typeof before).unmatchedAppointments.length;
    const ok = attributed + unmatched === appts.length;
    console.log(`${label.padEnd(18)} attributed ${String(attributed).padStart(4)} + unmatched ${String(unmatched).padStart(3)} = ${attributed + unmatched} of ${appts.length} ${ok ? '✅' : '🔴 LEAK'}`);
  }

  // ③ Per-appointment movement.
  let stayed = 0, moved = 0, lost = 0, gained = 0;
  const lostBy = new Map<string, Tagged[]>();
  const movedPairs = new Map<string, number>();
  for (const a of appts) {
    const b = aBefore.get(a.__i), f = aAfter.get(a.__i);
    if (b && f) { if (b === f) stayed++; else { moved++; movedPairs.set(`${b}  ->  ${f}`, (movedPairs.get(`${b}  ->  ${f}`) ?? 0) + 1); } }
    else if (b && !f) { lost++; if (!lostBy.has(b)) lostBy.set(b, []); lostBy.get(b)!.push(a); }
    else if (!b && f) gained++;
  }
  console.log('\n=== ③ PER-APPOINTMENT MOVEMENT ===');
  console.log(`same account ${stayed}   moved ${moved}   attributed->unmatched ${lost}   unmatched->attributed ${gained}`);
  if (movedPairs.size) {
    console.log('\nmoved between live accounts:');
    for (const [k, v] of [...movedPairs.entries()].sort((x, y) => y[1] - x[1])) console.log(`   ${v}  ${k}`);
  }

  // ④ THE FAIL RULE: an account that had appointments and now has zero.
  console.log('\n=== ④ ACCOUNTS THAT LOST APPOINTMENTS ===');
  const beforeCounts = new Map<string, number>();
  for (const [, acct] of aBefore) beforeCounts.set(acct, (beforeCounts.get(acct) ?? 0) + 1);

  // Stable-id evidence per losing account, straight from the sheet rows.
  const idsByAccount = new Map<string, { camp: Set<string>; ad: Set<string> }>();
  for (const r of sheet) {
    const k = r.accountName.trim();
    if (!k) continue;
    if (!idsByAccount.has(k)) idsByAccount.set(k, { camp: new Set(), ad: new Set() });
    const e = idsByAccount.get(k)!;
    if (r.campaignId) e.camp.add(r.campaignId.trim());
    if (r.adId) e.ad.add(r.adId.trim());
  }
  const metaCamp = new Set(meta.map(r => r.campaignId.trim()).filter(Boolean));
  const metaAd = new Set(meta.map(r => r.adId.trim()).filter(Boolean));

  let regressions = 0;
  if (lostBy.size === 0) console.log('   none ✅');
  for (const [acct, list] of [...lostBy.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const had = beforeCounts.get(acct) ?? 0;
    const nowZero = had === list.length;
    const ids = idsByAccount.get(acct) ?? { camp: new Set<string>(), ad: new Set<string>() };
    const campHit = [...ids.camp].filter(c => metaCamp.has(c)).length;
    const adHit = [...ids.ad].filter(c => metaAd.has(c)).length;
    const inFeed = campHit > 0 || adHit > 0;
    if (inFeed) regressions++;
    console.log(`\n   ${acct}`);
    console.log(`      appointments ${had} -> ${had - list.length}${nowZero ? '  (ZERO)' : ''}`);
    console.log(`      stable ids in ad_insights: campaign ${campHit}/${ids.camp.size}, ad ${adHit}/${ids.ad.size}`);
    console.log(`      ⇒ ${inFeed ? '🔴 RENAMED-BUT-LOST — a real join regression' : 'ABSENT-FROM-META — no such account in the feed; no join can attach to it'}`);
    const clients = new Map<string, number>();
    for (const a of list) clients.set(a.client || '(blank)', (clients.get(a.client || '(blank)') ?? 0) + 1);
    console.log(`      airtable clients affected: ${[...clients.entries()].map(([c, n]) => `${c} (${n})`).join(', ')}`);
  }

  // ⑤ The renamed accounts must still resolve, and must not lose bookings.
  console.log('\n=== ⑤ THE RENAMED ACCOUNTS ===');
  const RENAMES: [string, string, string][] = [
    ['Publicity 1', '322974296642516', 'Washbroz X SocialWorks'],
    ['10170221, USD', '10170221', 'Columbia Outdoor Restoration X SocialWorks'],
    ['222178771, USD', '222178771', 'Pro Clean Mobile Wash X SocialWorks'],
    ['103578393327348, USD', '103578393327348', 'TrueClean X SocialWorks'],
    ['Christmas Light Pros', '2264268834091190', 'Hydro Pro Wash X SocialWorks'],
  ];
  const afterByName = new Map(after.accounts.map(a => [a.accountName, a]));
  for (const [oldName, id, newName] of RENAMES) {
    const bOld = beforeCounts.get(oldName) ?? 0;
    const bNew = beforeCounts.get(newName) ?? 0;
    const acc = afterByName.get(newName);
    const aCount = acc?.appointments ?? 0;
    const spend = acc?.spend ?? 0;
    const resolved = !!acc;
    const ok = resolved && aCount >= bOld + bNew;
    console.log(`   ${oldName} + ${newName}`);
    console.log(`      account_id ${id}  resolved=${resolved ? '✅' : '🔴 NO'}  spend ${money(spend)}`);
    console.log(`      appts  before ${bOld} (old label) + ${bNew} (new label) = ${bOld + bNew}  ->  after ${aCount}  ${ok ? '✅' : '🔴'}`);
  }

  console.log('\n=== ⑥ VERDICT ===');
  console.log(`spend moves UP:                       ${mSpend > sSpend ? '✅' : '🔴'}`);
  console.log(`total appointments conserved:         ${appts.length === aAfter.size + after.unmatchedAppointments.length ? '✅' : '🔴'} (${appts.length})`);
  console.log(`join regressions (renamed-but-lost):  ${regressions === 0 ? '✅ none' : `🔴 ${regressions}`}`);
  console.log(`appointments silently dropped:        ${lost - after.unmatchedAppointments.length + (before.unmatchedAppointments.length) === 0 ? '✅ none (all visible in unmatched)' : 'see ④'}`);
}

main().catch(e => { console.error(e); process.exit(1); });
