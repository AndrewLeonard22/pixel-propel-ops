/** Probe: why did Green Plus Remodeling / Home Remodeling Pros Central PA / Pergola Guy lose attribution? */
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0,
};
const { buildAccountSummaries, mapAirtableRecords, accountKey } = await import('../src/lib/dataService');
const { buildAccountRegistry } = await import('../src/lib/accountRegistry');
const { metaRowToAdSpendRow } = await import('../src/lib/metaAdSpend');
type AdAccountRecord = import('../src/lib/accountRegistry').AdAccountRecord;
type AirtableNameLink = import('../src/lib/accountRegistry').AirtableNameLink;
type MetaSpendRecord = import('../src/lib/metaAdSpend').MetaSpendRecord;
type AppSettings = import('../src/lib/types').AppSettings;
type AppointmentRow = import('../src/lib/types').AppointmentRow;
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
const B = buildAccountSummaries(metaSpend, appointments, settings, undefined, registry);

const LOST = ['Green Plus Remodeling', 'Home Remodeling Pros Central PA', 'Pergola Guy'];
console.log('\n=== the link table (ad_account_airtable_names) ===');
for (const l of links) console.log(`   ${JSON.stringify(l.airtable_name).padEnd(40)} -> ${l.account_id}`);

console.log('\n=== legacy accountAliases entries mentioning the lost clients ===');
for (const a of settings.accountAliases ?? []) {
  if (LOST.some(c => (a.airtableName ?? '').toLowerCase().includes(c.toLowerCase().slice(0, 8))
    || (a.sheetName ?? '').toLowerCase().includes('green plus')
    || (a.sheetName ?? '').toLowerCase().includes('pergola')
    || (a.sheetName ?? '').toLowerCase().includes('home remodeling'))) {
    console.log(`   airtableName=${JSON.stringify(a.airtableName)}  sheetName=${JSON.stringify(a.sheetName)}`);
  }
}

console.log('\n=== does ad_insights hold an account for each lost client? ===');
const names = [...new Set(metaSpend.map(r => `${r.accountId}  ${r.accountName}`))].sort();
for (const c of LOST) {
  const needle = c.toLowerCase().split(' ')[0];
  console.log(`   ${c}:`);
  for (const n of names) if (n.toLowerCase().includes(needle)) console.log(`       candidate: ${n}`);
  console.log(`       registry.airtableNameToAccountId -> ${registry.airtableNameToAccountId(c)}`);
  // campaign ids on this client's appointments
  const cids = [...new Set(appointments.filter(a => a.client === c).map(a => (a.campaignId || '').trim()).filter(Boolean))];
  console.log(`       appointment campaignIds: ${cids.length ? cids.join(', ') : '(none)'}`);
  const hit = cids.filter(id => metaSpend.some(r => r.campaignId === id));
  console.log(`       of those, present in ad_insights: ${hit.length ? hit.join(', ') : 'none'}`);
  const adIds = [...new Set(appointments.filter(a => a.client === c).map(a => (a.adId || '').trim()).filter(Boolean))];
  const adHit = adIds.filter(id => metaSpend.some(r => r.adId === id));
  console.log(`       appointment adIds present in ad_insights: ${adHit.length}/${adIds.length}`);
  for (const id of adHit.slice(0, 3)) {
    const r = metaSpend.find(x => x.adId === id)!;
    console.log(`          adId ${id} -> account ${r.accountId} ${JSON.stringify(r.accountName)}`);
  }
}

console.log('\n=== unmatched appointment clients in arm B ===');
const um = new Map<string, number>();
for (const a of B.unmatchedAppointments) um.set(a.client, (um.get(a.client) ?? 0) + 1);
for (const [c, n] of [...um].sort((x, y) => y[1] - x[1])) console.log(`   ${String(n).padStart(4)}  ${JSON.stringify(c)}`);

console.log('\n=== accountKey of every ad_insights account name (for spendKeyByName) ===');
for (const c of LOST) {
  const needle = c.toLowerCase().slice(0, 6);
  for (const n of new Set(metaSpend.map(r => r.accountName))) {
    if (accountKey(n).includes(accountKey(c).slice(0, 6)) || n.toLowerCase().includes(needle)) {
      console.log(`   ${JSON.stringify(n)} accountKey=${JSON.stringify(accountKey(n))}`);
    }
  }
}
export {};
