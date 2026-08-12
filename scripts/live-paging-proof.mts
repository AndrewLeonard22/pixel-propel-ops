/**
 * LIVE PROOF THAT THE PAGING FIX DID NOT CHANGE THE NUMBER — and that the new termination
 * rule terminates on a fact the LIVE server actually sends.
 *
 * The loop used to stop on `batch.length < PAGE_SIZE` — an inference. It now stops when it
 * holds what `Content-Range: 0-999/48611` says exists. That is only an improvement if the
 * live server really answers with that count, so this asks it and prints the answer rather
 * than asserting the behaviour from the source.
 */
import './_shim.mts';
import { supabase } from '../src/integrations/supabase/client';
import { fetchMetaAdSpend, ALL_DATES, AD_SPEND_VIEW, META_SPEND_SELECT } from '../src/lib/metaAdSpend';
import { checkMetaCompleteness } from '../src/lib/metaAdSpend';

const money = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ① Does the live server return a count alongside the first page? If not, the fix silently
//    degrades to the empty-page fallback, and that must be visible rather than assumed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const first = await (supabase as any)
  .from(AD_SPEND_VIEW)
  .select(META_SPEND_SELECT, { count: 'exact' })
  .order('date', { ascending: true })
  .order('ad_id', { ascending: true })
  .range(0, 999);
console.log(`first page: rows=${first.data?.length} count=${first.count} error=${first.error?.message ?? 'none'}`);
if (typeof first.count !== 'number') {
  console.log('🔴 the live server did NOT count. The loop falls back to the empty-page rule.');
}

// ② The whole feed, through the app's own fetcher.
const t0 = Date.now();
const rows = await fetchMetaAdSpend(undefined, ALL_DATES);
const ms = Date.now() - t0;
const spend = rows.reduce((s, r) => s + r.spent, 0);
const leads = rows.reduce((s, r) => s + r.leads, 0);
const accounts = new Set(rows.map(r => r.accountId)).size;
console.log(`feed: ${rows.length.toLocaleString()} rows  ${money(spend)}  ${leads.toLocaleString()} leads  ${accounts} accounts  (${ms}ms)`);

// ③ The guard still speaks independently.
const c = await checkMetaCompleteness(rows.length, ALL_DATES);
console.log(`completeness: ${c.state}  raw=${c.rawRows} derived=${c.derivedRows} dropped=${c.droppedRows}`);

// ④ The briefed known-good day, narrowed IN SQL.
const day = await fetchMetaAdSpend(undefined, { from: '2026-08-08', to: '2026-08-08' });
console.log(
  `2026-08-08: ${day.length} rows  ${money(day.reduce((s, r) => s + r.spent, 0))}  ` +
  `${day.reduce((s, r) => s + r.leads, 0)} leads  ${new Set(day.map(r => r.accountId)).size} accounts`,
);
