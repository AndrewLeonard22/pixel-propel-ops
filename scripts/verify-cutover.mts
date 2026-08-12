/**
 * CUTOVER VERIFICATION — THE SECOND INSTRUMENT.
 *
 * `gates.mjs` proves the gates could have failed. It cannot prove the NUMBERS MOVED, and a
 * cutover that leaves totals unchanged has silently failed. This is the other instrument.
 *
 * ⭐ IT IS A CONTROLLED A/B, NOT A BEFORE-AND-AFTER STORY. Both arms run the SAME
 * `buildAccountSummaries`, the SAME settings, the SAME appointments, the SAME registry.
 * The ONLY variable is the feed:
 *
 *     arm A   the Google Sheet CSV, parsed by the CSV code as it exists at git HEAD
 *     arm B   `ad_insights_resolved`, mapped by `metaRowToAdSpendRow`
 *
 * So every difference printed below is attributable to the source swap and to nothing else.
 * A "before" measured by reading an old commit's OUTPUT would instead be comparing two
 * different aggregators and calling the difference a data delta.
 *
 * ⛔ THE SHEET SIDE IS MEASURED, NEVER QUOTED. An earlier version of this file carried the
 * sheet total as a hardcoded constant. A constant cannot notice that the sheet moved, and
 * the brief this work was handed carried a sheet figure ($662,135.29) that the live sheet
 * does not reproduce. A number you cannot re-measure is a number you cannot defend, so the
 * CSV is fetched from the exact URL `convertSheetUrlToCsv` used to build.
 *
 * Run: npx vite-node scripts/verify-cutover.mts
 */
// The Supabase client is created at module scope and reaches for localStorage. This script
// runs in node, so it is stubbed BEFORE the first import that pulls the client in. Nothing
// here touches the browser client — every query below goes over the management API.
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0,
};

const { buildAccountSummaries, mapAirtableRecords } = await import('../src/lib/dataService');
const { buildAccountRegistry } = await import('../src/lib/accountRegistry');
const { metaRowToAdSpendRow } = await import('../src/lib/metaAdSpend');
type AdAccountRecord = import('../src/lib/accountRegistry').AdAccountRecord;
type AirtableNameLink = import('../src/lib/accountRegistry').AirtableNameLink;
type MetaSpendRecord = import('../src/lib/metaAdSpend').MetaSpendRecord;
type AppointmentRow = import('../src/lib/types').AppointmentRow;
type AppSettings = import('../src/lib/types').AppSettings;
type AdSpendRow = import('../src/lib/types').AdSpendRow;
type AccountSummary = import('../src/lib/types').AccountSummary;
const { readFileSync } = await import('node:fs');

const ENV = '/Users/andrewleonard/code/socialworks-ads/.env';
const env = Object.fromEntries(
  readFileSync(ENV, 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const PROJECT = 'mlwoztsytapxjgfldyzv';
const FROM = '2025-01-01';
const TO = '2026-08-11';

async function sql<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error(`SQL failed: ${JSON.stringify(j).slice(0, 300)}`);
  return j as T[];
}

const money = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (s: string | number, n: number) => String(s).padStart(n);

/* ═══════════════════════════════════════════════════════════════════════════ *
 * ARM A — THE SHEET, PARSED BY THE CODE THAT IS IN PRODUCTION TODAY.
 *
 * `parseCsv`, `parseCSVLine`, `parseNumber` and `normalizeSourceDate` below are copied
 * VERBATIM from `git show HEAD:src/lib/dataService.ts`. Reimplementing them would make the
 * delta a comparison of two of MY functions rather than of two feeds — and the CSV quoting
 * rules are exactly where a rewrite would quietly differ.
 * ═══════════════════════════════════════════════════════════════════════════ */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; } else { inQuotes = !inQuotes; }
    } else if (char === ',' && !inQuotes) { result.push(current); current = ''; } else { current += char; }
  }
  result.push(current);
  return result;
}
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h.trim()] = (values[idx] || '').trim(); });
    rows.push(row);
  }
  return rows;
}
function parseNumber(val: string | undefined): number {
  if (!val) return 0;
  const n = parseFloat(val.replace(/[$,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}
const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));
function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function normalizeSourceDate(raw: string | undefined): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return isRealDate(+iso[1], +iso[2], +iso[3]) ? s : '';
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) { const [, m, d, y] = mdy; return isRealDate(+y, +m, +d) ? `${y}-${pad2(+m)}-${pad2(+d)}` : ''; }
  if (/^\d{1,6}$/.test(s)) {
    const serial = Number(s);
    if (serial >= 36526 && serial <= 73050) {
      const dt = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
    }
  }
  return '';
}

/** The URL `convertSheetUrlToCsv(url, tab)` built at HEAD. The `tab` argument was never read. */
const SHEET_CSV =
  'https://docs.google.com/spreadsheets/d/1g6hqd1-8A_XNUVfcd13g36jVDdHnqR4o6gX2-eCuSBE/export?format=csv&gid=0';

async function fetchSheetRows(): Promise<AdSpendRow[]> {
  const text = await fetch(SHEET_CSV).then(r => {
    if (!r.ok) throw new Error(`sheet fetch ${r.status}`);
    return r.text();
  });
  const pick = (r: Record<string, string>, ...keys: string[]) => {
    for (const k of keys) if (r[k] !== undefined && r[k] !== '') return r[k];
    return '';
  };
  return parseCsv(text).map(row => ({
    month: pick(row, 'Month'),
    date: pick(row, 'Date'),
    dateISO: normalizeSourceDate(pick(row, 'Date')),
    campaign: pick(row, 'Campaign'),
    campaignId: pick(row, 'Campaign Id', 'Campaign ID'),
    adsetName: pick(row, 'Adset Name', 'Ad Set Name'),
    adsetId: pick(row, 'Adset Id', 'Ad Set ID'),
    adName: pick(row, 'Ad Name'),
    adId: pick(row, 'Ad Id', 'Ad ID'),
    spent: parseNumber(pick(row, 'Spent', 'Spend')),
    leads: parseNumber(pick(row, 'Leads')),
    accountName: pick(row, 'Account Name'),
    // ⛔ NO accountId. That absence IS arm A: without it `accountIdentityKey` falls back to
    // the display name, which is precisely the grouping the sheet forced.
  })) as AdSpendRow[];
}

/* ═══════════════════════════════════════════════════════════════════════════ */

const sumBy = (xs: AccountSummary[], f: (a: AccountSummary) => number) => xs.reduce((n, a) => n + f(a), 0);
const active = (xs: AccountSummary[]) => xs.filter(a => a.status === 'Active');

async function main() {
  let fail = 0;
  const verdict = (ok: boolean, msg: string) => { if (!ok) fail++; return `${ok ? '✅' : '⛔'} ${msg}`; };

  // ── the curated registry + the stable Airtable join table ─────────────────
  const accountRows = await sql<AdAccountRecord>(
    'select account_id, meta_name, company_name, program, media_buyer, status from ad_accounts',
  );
  const links = await sql<AirtableNameLink>(
    'select airtable_name_key, airtable_name, account_id from ad_account_airtable_names',
  );
  const registry = buildAccountRegistry(accountRows, links);

  // ── settings, live ────────────────────────────────────────────────────────
  const [row] = await sql<{ value: AppSettings }>("select value from app_settings where key='app_settings'");
  const [maps] = await sql<{ value: AppSettings['accountAliases'] }>(
    "select value from app_settings where key='account_mappings'",
  );
  const settings: AppSettings = { ...row.value, accountAliases: maps?.value ?? row.value.accountAliases };

  // ── appointments, live, through the APP'S OWN mapper ──────────────────────
  const at = await fetch(`https://${PROJECT}.supabase.co/functions/v1/airtable-proxy`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseId: settings.airtableBaseId, tableName: settings.airtableTableName }),
  }).then(r => r.json());
  const mapped = mapAirtableRecords(at.records ?? [], settings.columnMappings ?? {}, at.fields ?? []);
  const appointments: AppointmentRow[] = mapped.records;

  // ── the two feeds ─────────────────────────────────────────────────────────
  const sheetAll = await fetchSheetRows();
  const sheetSpend = sheetAll.filter(r => r.dateISO >= FROM && r.dateISO <= TO);

  const raw = await sql<MetaSpendRecord>(
    `select date::text as date, ad_id, account_id, account_name, campaign_id, campaign_name,
            adset_id, adset_name, ad_name, spend::text as spend, leads
     from ad_insights_resolved where date >= '${FROM}' and date <= '${TO}'`,
  );
  const metaSpend: AdSpendRow[] = raw.map(metaRowToAdSpendRow);

  // ── ONE aggregator, two feeds ─────────────────────────────────────────────
  const A = buildAccountSummaries(sheetSpend, appointments, settings, undefined, registry);
  const B = buildAccountSummaries(metaSpend, appointments, settings, undefined, registry);

  console.log(`\nA/B over ${FROM} .. ${TO}   (one aggregator, two feeds)`);
  console.log(`  arm A  Google Sheet gid=0     ${pad(sheetSpend.length.toLocaleString(), 7)} rows`);
  console.log(`  arm B  ad_insights_resolved   ${pad(metaSpend.length.toLocaleString(), 7)} rows`);
  console.log(`  shared: ${appointments.length} appointments · ${accountRows.length} ad_accounts · ${links.length} airtable-name links`);

  // ═══ ① SPEND MUST RISE ═══════════════════════════════════════════════════
  const aSpend = sumBy(A.accounts, a => a.spend);
  const bSpend = sumBy(B.accounts, a => a.spend);
  const aTile = sumBy(active(A.accounts), a => a.spend);
  const bTile = sumBy(active(B.accounts), a => a.spend);
  const d = bSpend - aSpend;
  console.log('\n=== ① SPEND MUST RISE ==============================================');
  console.log(`                              arm A (sheet)      arm B (ad_insights)`);
  console.log(`  spend, all accounts        ${pad(money(aSpend), 14)}     ${pad(money(bSpend), 14)}`);
  console.log(`  leads, all accounts        ${pad(sumBy(A.accounts, a => a.leads).toLocaleString(), 14)}     ${pad(sumBy(B.accounts, a => a.leads).toLocaleString(), 14)}`);
  console.log(`  account summaries          ${pad(A.accounts.length, 14)}     ${pad(B.accounts.length, 14)}`);
  console.log(`  Dashboard TOTAL SPEND tile ${pad(money(aTile), 14)}     ${pad(money(bTile), 14)}   (status Active)`);
  console.log(`  DELTA, all accounts        ${money(d)}   ${((d / aSpend) * 100).toFixed(1)}% of the sheet`);
  console.log(`  DELTA, the tile            ${money(bTile - aTile)}`);
  console.log(`  ${verdict(d > 0, d > 0 ? 'SPEND ROSE' : 'SPEND DID NOT RISE — the cutover has silently failed')}`);

  // ═══ ② THE KNOWN-GOOD DAY ════════════════════════════════════════════════
  const day = metaSpend.filter(r => r.dateISO === '2026-08-08');
  const dayAccts = new Set(day.map(r => r.accountId)).size;
  const daySpend = day.reduce((n, r) => n + r.spent, 0);
  const dayLeads = day.reduce((n, r) => n + r.leads, 0);
  const dayOk = day.length === 83 && Math.abs(daySpend - 1878.78) < 0.005 && dayLeads === 56 && dayAccts === 22;
  console.log('\n=== ② KNOWN-GOOD DAY 2026-08-08 ====================================');
  console.log(`  rows ${day.length} (83) · spend ${money(daySpend)} ($1,878.78) · leads ${dayLeads} (56) · accounts ${dayAccts} (22)`);
  console.log(`  ${verdict(dayOk, dayOk ? 'EXACT MATCH on all four' : 'MISMATCH')}`);

  // ═══ ③ APPOINTMENTS MUST NOT DROP ════════════════════════════════════════
  const aMatched = sumBy(A.accounts, a => a.appointments);
  const bMatched = sumBy(B.accounts, a => a.appointments);
  console.log('\n=== ③ APPOINTMENTS MUST NOT DROP ===================================');
  console.log(`                              arm A (sheet)      arm B (ad_insights)`);
  console.log(`  Airtable records           ${pad(appointments.length, 14)}     ${pad(appointments.length, 14)}`);
  console.log(`  matched to an account      ${pad(aMatched, 14)}     ${pad(bMatched, 14)}`);
  console.log(`  unmatched (still counted)  ${pad(A.unmatchedAppointments.length, 14)}     ${pad(B.unmatchedAppointments.length, 14)}`);
  const consA = aMatched + A.unmatchedAppointments.length === appointments.length;
  const consB = bMatched + B.unmatchedAppointments.length === appointments.length;
  console.log(`  ${verdict(consA && consB, 'CONSERVATION: matched + unmatched === records, in both arms')}`);
  console.log(`  ${bMatched >= aMatched ? '✅' : '🟡'} per-account attribution ${bMatched} vs ${aMatched} (${bMatched - aMatched >= 0 ? '+' : ''}${bMatched - aMatched})` +
    `${bMatched < aMatched ? ' — classified below; only a reachable-account miss is a defect' : ''}`);

  // Per CLIENT NAME, which account did the appointment land on in each arm? This is the
  // join-key question stated as data: a client that resolved in A and not in B is exactly
  // the "cleaned the join key" failure, and a count alone would hide WHICH client moved.
  /**
   * 🔴 ONE KEY BUILDER, AND THIS FUNCTION EXISTS BECAUSE THERE WERE TWO.
   *
   * The composite key was written out by hand at five sites. Three joined the fields with
   * a NUL (`\u0000`); the two inside the CLASSIFIER below joined them with a SPACE. Both
   * forms are valid, invisible to a reader, and produce keys that never match each other.
   *
   * ⛔ WHAT THAT COST, MEASURED: the classifier computed a1 = 0 and b1 = 0 for ALL 22
   * clients, so its `if (b1 >= a1) continue` skipped every one of them. It is the ONLY
   * code in this file that can raise a JOIN DEFECT, and it never executed. The script
   * printed the header 'WHY each lost client lost attribution:', printed NOTHING under it,
   * and exited `✅ ALL CUTOVER CHECKS PASS` with 57 appointments unattributed.
   *
   * ⇒ A VERIFIER THAT FAILS OPEN IS WORSE THAN NO VERIFIER, because it is believed. The
   * fix is not 'be careful with the separator', it is that the key can only be built here.
   */
  const apptKey = (a: { client: string; appointmentDate: string; adId: string; campaignId: string }) =>
    [a.client, a.appointmentDate, a.adId, a.campaignId].join('\u0000');

  const arm = (r: typeof A) => {
    const m = new Map<string, string>();
    for (const acc of r.accounts) for (const ap of acc.appointmentList ?? []) m.set(apptKey(ap), acc.accountName);
    return m;
  };
  const inA = arm(A), inB = arm(B);
  const clients = [...new Set(appointments.map(a => a.client))].sort();
  console.log('\n  per Airtable client — appointments attributed in each arm:');
  console.log(`     ${'client'.padEnd(40)} total   armA   armB`);
  let lost = 0;
  for (const c of clients) {
    const tot = appointments.filter(a => a.client === c).length;
    const a1 = appointments.filter(a => a.client === c && inA.has(apptKey(a))).length;
    const b1 = appointments.filter(a => a.client === c && inB.has(apptKey(a))).length;
    if (b1 < a1) lost += a1 - b1;
    console.log(`     ${c.slice(0, 40).padEnd(40)} ${pad(tot, 5)} ${pad(a1, 6)} ${pad(b1, 6)}${b1 < a1 ? '   ⛔ LOST' : b1 > a1 ? '   ⭐ GAINED' : ''}`);
  }
  /**
   * ⭐ A LOST APPOINTMENT IS NOT AUTOMATICALLY A BROKEN JOIN, AND THE DIFFERENCE DECIDES
   * WHETHER THIS IS A BUG OR A DISCLOSURE.
   *
   *   join broken   the account IS in the feed and the appointment failed to reach it
   *   feed narrower the account is NOT in the feed at all — nothing to attribute TO
   *
   * The second is unfixable in this client by construction and must never be "repaired" by
   * loosening the match, which is how a client's bookings end up on another client's row.
   * So every lost client is classified against the feed rather than counted.
   */
  if (lost > 0) {
    console.log('\n  WHY each lost client lost attribution:');
    const sheetAcctOf = new Map<string, Set<string>>();
    for (const acc of A.accounts) {
      for (const ap of acc.appointmentList ?? []) {
        if (!sheetAcctOf.has(ap.client)) sheetAcctOf.set(ap.client, new Set());
        sheetAcctOf.get(ap.client)!.add(acc.accountName);
      }
    }
    // TWO INDEPENDENT WAYS TO FIND THE ACCOUNT IN THE NEW FEED, because a name is a label
    // and could have been rewritten: ① Meta's current display name, ② any campaign id the
    // sheet recorded under that account. ② cannot be fooled by a rename — a campaign id is
    // globally unique and neither feed edits it. Absent under BOTH is what "gone" means.
    const metaNames = new Set(metaSpend.map(r => r.accountName.trim().toLowerCase()));
    const metaCampaigns = new Set(metaSpend.map(r => (r.campaignId || '').trim()).filter(Boolean));
    const sheetCampaignsOf = new Map<string, Set<string>>();
    for (const r of sheetSpend) {
      const n = r.accountName.trim().toLowerCase();
      if (!sheetCampaignsOf.has(n)) sheetCampaignsOf.set(n, new Set());
      const cid = (r.campaignId || '').trim();
      if (cid) sheetCampaignsOf.get(n)!.add(cid);
    }
    /**
     * ⭐ THE POPULATION CONTROL, AND IT IS THE PART THAT WOULD HAVE CAUGHT THE BUG ABOVE.
     *
     * Unifying the key builder fixes the drift that exists TODAY. It does nothing about the
     * next way this loop could quietly select nothing — a changed field, a trimmed client
     * name, a filter that no longer matches. Every one of those returns a CLEAN GREEN,
     * which is the failure mode that survives longest precisely because it looks like a
     * pass.
     *
     * So the loop COUNTS what it classified and reconciles it against `lost`, which was
     * computed by a different loop over different code. Classifying fewer appointments than
     * were lost is not "nothing to report", it is the instrument failing to look.
     */
    let classified = 0;
    for (const c of clients) {
      const a1 = appointments.filter(a => a.client === c && inA.has(apptKey(a))).length;
      const b1 = appointments.filter(a => a.client === c && inB.has(apptKey(a))).length;
      if (b1 >= a1) continue;
      classified += a1 - b1;
      const held = [...(sheetAcctOf.get(c) ?? [])];
      const byName = held.filter(n => metaNames.has(n.trim().toLowerCase()));
      const byCampaign = held.filter(n =>
        [...(sheetCampaignsOf.get(n.trim().toLowerCase()) ?? [])].some(cid => metaCampaigns.has(cid)));
      const reachable = [...new Set([...byName, ...byCampaign])];
      console.log(`     ${c} — ${a1 - b1} appointments`);
      console.log(`        arm A attached them to : ${held.map(n => JSON.stringify(n)).join(', ')}`);
      console.log(`        found in ad_insights by NAME     : ${byName.length ? byName.join(', ') : 'no'}`);
      console.log(`        found in ad_insights by CAMPAIGN : ${byCampaign.length ? byCampaign.join(', ') : 'no'}`);
      console.log(`        => ${reachable.length === 0
        ? 'FEED IS NARROWER — the ad account is absent from ad_insights entirely, so there is nothing to attribute to. Not a join defect.'
        : '🔴 JOIN DEFECT — the account IS reachable and the appointment missed it'}`);
      if (reachable.length > 0) fail++;
    }
    console.log(`\n  ${verdict(classified === lost,
      classified === lost
        ? `CONTROL: all ${lost} lost appointments were classified, none silently skipped`
        : `THE CLASSIFIER ONLY SAW ${classified} OF ${lost} LOST APPOINTMENTS — it is not measuring what it claims. ` +
          'Treat every verdict in section ③ as unproven until this reconciles.')}`);
  }

  // ═══ ④ A RENAMED ACCOUNT IS ONE ACCOUNT, NOT TWO ═════════════════════════
  //
  // 🔴 THE FIRST VERSION OF THIS CHECK ASKED `ad_insights` HOW MANY NAMES EACH account_id
  // CARRIES. It returned 0 — a TRUE answer to a question that cannot express the defect.
  // The pull writes Meta's CURRENT name on every row, so a rename is invisible inside
  // ad_insights BY CONSTRUCTION. The split lived in the SHEET, which kept both the old and
  // the new label as two separate accounts. So the instrument has to span both feeds:
  // bridge them on `campaign_id`, which is globally unique and which neither side rewrites.
  console.log('\n=== ④ META RENAMES: THE SHEET SPLIT THEM, ad_insights DOES NOT =====');
  const campToAccount = new Map<string, { id: string; name: string }>();
  for (const r of metaSpend) {
    const c = (r.campaignId || '').trim();
    if (c && r.accountId) campToAccount.set(c, { id: r.accountId, name: r.accountName });
  }
  /** account_id -> the set of names the SHEET used for it. >1 means the sheet split it. */
  const sheetNamesPerId = new Map<string, { name: string; set: Set<string> }>();
  const sheetSpendByLabel = new Map<string, number>();
  for (const r of sheetSpend) {
    sheetSpendByLabel.set(r.accountName, (sheetSpendByLabel.get(r.accountName) ?? 0) + r.spent);
    const hit = campToAccount.get((r.campaignId || '').trim());
    if (!hit) continue;
    if (!sheetNamesPerId.has(hit.id)) sheetNamesPerId.set(hit.id, { name: hit.name, set: new Set() });
    sheetNamesPerId.get(hit.id)!.set.add(r.accountName);
  }
  const split = [...sheetNamesPerId.entries()].filter(([, v]) => v.set.size > 1);
  console.log(`  account_ids the SHEET carried under MORE THAN ONE label: ${split.length}`);
  let collapsed = 0;
  for (const [id, v] of split) {
    const armA = A.accounts.filter(s => v.set.has(s.accountName)).length;
    const armB = B.accounts.filter(s => metaSpend.some(x => x.accountId === id && x.accountName === s.accountName)).length;
    const acc = B.accounts.find(s => metaSpend.some(x => x.accountId === id && x.accountName === s.accountName));
    if (armB === 1) collapsed++;
    console.log(`     ${pad(id, 17)}  arm A ${armA} summaries -> arm B ${armB}   ${(acc?.companyName ?? acc?.accountName ?? '?').slice(0, 34)}  ${money(acc?.spend ?? 0)}`);
    for (const n of [...v.set].sort()) console.log(`        sheet label ${JSON.stringify(n).padEnd(44)} ${money(sheetSpendByLabel.get(n) ?? 0)}`);
  }
  console.log(`  ${verdict(split.length > 0 && collapsed === split.length,
    split.length === 0 ? 'NO SPLIT ACCOUNTS FOUND — the bridge measured nothing, so this proves nothing'
      : `all ${split.length} split accounts collapse to exactly ONE summary in arm B`)}`);

  // ═══ ⑤ THE STABLE PATH IS THE ONE DOING THE WORK ═════════════════════════
  console.log('\n=== ⑤ THE JOIN KEY IS account_id, NOT A DISPLAY NAME ===============');
  const noLinks = buildAccountSummaries(metaSpend, appointments, settings, undefined, buildAccountRegistry(accountRows, []));
  const stable = appointments.filter(a => registry.airtableNameToAccountId(a.client)).length;
  console.log(`  airtable client names mapped to an account_id : ${registry.airtableNameCount} (over ${new Set(links.map(l => l.account_id)).size} accounts)`);
  console.log(`  appointments resolving by the STABLE id path  : ${stable}/${appointments.length}`);
  console.log(`  same feed with the link table EMPTIED         : matched ${sumBy(noLinks.accounts, a => a.appointments)}, unmatched ${noLinks.unmatchedAppointments.length}`);
  console.log(`  with the link table                          : matched ${bMatched}, unmatched ${B.unmatchedAppointments.length}`);
  console.log(`  ${verdict(bMatched >= sumBy(noLinks.accounts, a => a.appointments),
    'the link table adds attribution, never removes it')}`);

  // ═══ ⑥ WHAT THE SHEET WAS MISSING ════════════════════════════════════════
  console.log('\n=== ⑥ WHAT THE SHEET WAS MISSING ===================================');
  const sheetDays = new Set(sheetSpend.map(r => r.dateISO));
  const metaDays = [...new Set(metaSpend.map(r => r.dateISO))].sort();
  const absent = metaDays.filter(d2 => !sheetDays.has(d2));
  const absentSpend = metaSpend.filter(r => absent.includes(r.dateISO)).reduce((n, r) => n + r.spent, 0);
  console.log(`  days present in ad_insights but ABSENT from the sheet: ${absent.length}`);
  if (absent.length) console.log(`     ${absent[0]} .. ${absent[absent.length - 1]}   ${money(absentSpend)}`);
  console.log(`  distinct account labels   sheet ${new Set(sheetSpend.map(r => r.accountName)).size}   ad_insights ${new Set(metaSpend.map(r => r.accountName)).size} names / ${new Set(metaSpend.map(r => r.accountId)).size} ids`);

  console.log(`\n${fail === 0 ? '✅ ALL CUTOVER CHECKS PASS' : `⛔ ${fail} CHECK(S) FAILED`}\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });

export {};
