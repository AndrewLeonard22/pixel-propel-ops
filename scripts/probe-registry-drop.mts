/**
 * PROBE: what does the page-level recompute LOSE by omitting the registry?
 *
 * Dashboard.tsx:829, Targets.tsx:109 and TeamPerformance.tsx:81 call
 * `buildAccountSummaries(spend, appts, settings, known)` — four arguments. The fifth,
 * `registry`, defaults to `emptyAccountRegistry()`. So the moment a user picks a date
 * range the curated `ad_accounts` identity is dropped. This measures the difference over
 * the SAME rows, so the only variable is the argument.
 */
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0,
};
const { buildAccountSummaries, mapAirtableRecords } = await import('../src/lib/dataService');
const { buildAccountRegistry, emptyAccountRegistry } = await import('../src/lib/accountRegistry');
const { metaRowToAdSpendRow } = await import('../src/lib/metaAdSpend');
type AdAccountRecord = import('../src/lib/accountRegistry').AdAccountRecord;
type AirtableNameLink = import('../src/lib/accountRegistry').AirtableNameLink;
type MetaSpendRecord = import('../src/lib/metaAdSpend').MetaSpendRecord;
type AppSettings = import('../src/lib/types').AppSettings;
type AppointmentRow = import('../src/lib/types').AppointmentRow;
type AccountSummary = import('../src/lib/types').AccountSummary;
const { readFileSync } = await import('node:fs');
const env = Object.fromEntries(
  readFileSync('/Users/andrewleonard/code/socialworks-ads/.env', 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const PROJECT = 'mlwoztsytapxjgfldyzv';
async function sql<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error(`SQL failed: ${JSON.stringify(j).slice(0, 400)}`);
  return j as T[];
}
const money = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const accountRows = await sql<AdAccountRecord>('select account_id, meta_name, company_name, program, media_buyer, status from ad_accounts');
const links = await sql<AirtableNameLink>('select airtable_name_key, airtable_name, account_id from ad_account_airtable_names');
const registry = buildAccountRegistry(accountRows, links);
const [row] = await sql<{ value: AppSettings }>("select value from app_settings where key='app_settings'");
const [maps] = await sql<{ value: AppSettings['accountAliases'] }>("select value from app_settings where key='account_mappings'");
const settings: AppSettings = { ...row.value, accountAliases: maps?.value ?? row.value.accountAliases };

const at = await fetch(`https://${PROJECT}.supabase.co/functions/v1/airtable-proxy`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ baseId: settings.airtableBaseId, tableName: settings.airtableTableName }),
}).then(r => r.json());
const appointments: AppointmentRow[] = mapAirtableRecords(at.records ?? [], settings.columnMappings ?? {}, at.fields ?? []).records;

const raw = await sql<MetaSpendRecord>(
  `select date::text as date, ad_id, account_id, account_name, campaign_id, campaign_name,
          adset_id, adset_name, ad_name, spend::text as spend, leads
   from ad_insights_resolved where date >= '2025-01-01' and date <= '2026-08-11'`);
const metaSpend = raw.map(metaRowToAdSpendRow);

const known = { spend: true, appts: true };
const WITH = buildAccountSummaries(metaSpend, appointments, settings, known, registry);
const WITHOUT = buildAccountSummaries(metaSpend, appointments, settings, known, emptyAccountRegistry());

const byKey = (xs: AccountSummary[]) => new Map(xs.map(a => [a.accountName, a]));
const w = byKey(WITH.accounts), o = byKey(WITHOUT.accounts);

const active = (xs: AccountSummary[]) => xs.filter(a => a.status === 'Active');
const sum = (xs: AccountSummary[], f: (a: AccountSummary) => number) => xs.reduce((n, a) => n + f(a), 0);

console.log('\nSAME ROWS, SAME SETTINGS — the ONLY variable is the `registry` argument.\n');
console.log(`                                  WITH registry        WITHOUT (the pages)`);
console.log(`  accounts                        ${String(WITH.accounts.length).padStart(12)}  ${String(WITHOUT.accounts.length).padStart(22)}`);
console.log(`  appointments matched            ${String(sum(WITH.accounts, a => a.appointments)).padStart(12)}  ${String(sum(WITHOUT.accounts, a => a.appointments)).padStart(22)}`);
console.log(`  status Active                   ${String(active(WITH.accounts).length).padStart(12)}  ${String(active(WITHOUT.accounts).length).padStart(22)}`);
console.log(`  ⭐ TOTAL SPEND tile (Active)    ${money(sum(active(WITH.accounts), a => a.spend)).padStart(12)}  ${money(sum(active(WITHOUT.accounts), a => a.spend)).padStart(22)}`);
console.log(`  ⭐ TOTAL LEADS tile (Active)    ${String(sum(active(WITH.accounts), a => a.leads)).padStart(12)}  ${String(sum(active(WITHOUT.accounts), a => a.leads)).padStart(22)}`);
console.log(`  ⭐ TOTAL APPTS tile (Active)    ${String(sum(active(WITH.accounts), a => a.appointments)).padStart(12)}  ${String(sum(active(WITHOUT.accounts), a => a.appointments)).padStart(22)}`);

const fields = ['companyName', 'program', 'mediaBuyer', 'status'] as const;
for (const f of fields) {
  const diff = [...w.entries()].filter(([n, a]) => String((a as never)[f] ?? '') !== String((o.get(n) as never)?.[f] ?? ''));
  console.log(`\n  ${f}: ${diff.length} of ${w.size} accounts differ`);
  for (const [n, a] of diff.slice(0, 12)) {
    console.log(`     ${n.slice(0, 42).padEnd(42)} ${JSON.stringify((a as never)[f] ?? null)}  ->  ${JSON.stringify((o.get(n) as never)?.[f] ?? null)}`);
  }
  if (diff.length > 12) console.log(`     … and ${diff.length - 12} more`);
}

console.log('\n  MEDIA BUYER POPULATIONS (TeamPerformance groups on this):');
const buyers = (xs: AccountSummary[]) => {
  const m = new Map<string, number>();
  for (const a of xs) m.set(a.mediaBuyer || '(none)', (m.get(a.mediaBuyer || '(none)') ?? 0) + a.spend);
  return m;
};
const bw = buyers(active(WITH.accounts)), bo = buyers(active(WITHOUT.accounts));
for (const k of new Set([...bw.keys(), ...bo.keys()])) {
  const a = bw.get(k) ?? 0, b = bo.get(k) ?? 0;
  console.log(`     ${k.slice(0, 30).padEnd(30)} ${money(a).padStart(14)}  ${money(b).padStart(14)}${Math.abs(a - b) > 0.005 ? '   ⛔ DIFFERS' : ''}`);
}
export {};
