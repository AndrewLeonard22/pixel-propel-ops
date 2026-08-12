/**
 * THE TRAP, TESTED DIRECTLY.
 *
 * Meta rewrites account display names. If any part of appointment attribution still
 * depends on `accountName`, a rename detaches a client from its bookings — the exact bug
 * the cutover exists to remove, reintroduced.
 *
 * This does not reason about the code. It takes the LIVE feed, rewrites EVERY account's
 * display name to a string Meta has never used, and re-runs the app's own aggregator.
 * A rename-proof join must move ZERO appointments.
 *
 * The control matters as much as the test: the same mutation applied to a build that
 * groups by NAME must move a large number, otherwise the test proves nothing.
 */
import './_shim.mts';
import { loadSettingsAsync } from '@/lib/config';
import { fetchMetaAdSpend, ALL_DATES } from '@/lib/metaAdSpend';
import { fetchAirtableData, buildAccountSummaries } from '@/lib/dataService';
import { fetchAccountRegistry } from '@/lib/accountRegistry';
import type { AdSpendRow } from '@/lib/types';

const perAccount = (accounts: any[]) => {
  // keyed by the IDENTITY, not the label, so a renamed account is still the same row
  const m = new Map<string, number>();
  for (const a of accounts) m.set(a.accountId || a.accountName, a.appointments || 0);
  return m;
};
const perClient = (accounts: any[], unmatched: any[]) => {
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
};
const diff = (a: Map<string, number>, b: Map<string, number>) => {
  const keys = [...new Set([...a.keys(), ...b.keys()])].sort();
  const out: string[] = [];
  for (const k of keys) {
    const x = a.get(k) || 0, y = b.get(k) || 0;
    if (x !== y) out.push(`  ${y - x > 0 ? '+' : ''}${y - x}  ${x} -> ${y}  ${k}`);
  }
  return out;
};

(async () => {
  const settings = await loadSettingsAsync();
  const [rows, air, registry] = await Promise.all([
    fetchMetaAdSpend(ALL_DATES), fetchAirtableData(settings), fetchAccountRegistry(),
  ]);
  const appts = air.records;

  const base = buildAccountSummaries(rows, appts, settings, undefined, registry);

  // ── THE MUTATION: every display name replaced. Identity (`accountId`) untouched.
  const renamed: AdSpendRow[] = rows.map((r, i) => ({
    ...r, accountName: `META-RENAMED-${(r.accountId || String(i)).slice(-4)} X SocialWorks`,
  }));
  const after = buildAccountSummaries(renamed, appts, settings, undefined, registry);

  // ── THE CONTROL: identity ERASED, so the aggregator must fall back to the name — this is
  //    the pre-cutover world. Renaming there must do real damage.
  const nameOnly = rows.map(r => ({ ...r, accountId: '' }));
  const nameOnlyRenamed = renamed.map(r => ({ ...r, accountId: '' }));
  const ctlBase = buildAccountSummaries(nameOnly, appts, settings, undefined, registry);
  const ctlAfter = buildAccountSummaries(nameOnlyRenamed, appts, settings, undefined, registry);

  const tot = (r: any) => r.accounts.reduce((s: number, a: any) => s + (a.appointments || 0), 0);

  console.log('════ TEST — id-keyed build, every Meta display name rewritten ════');
  console.log(`  accounts        ${base.accounts.length} -> ${after.accounts.length}`);
  console.log(`  attributed      ${tot(base)} -> ${tot(after)}`);
  console.log(`  unmatched       ${base.unmatchedAppointments.length} -> ${after.unmatchedAppointments.length}`);
  const dA = diff(perAccount(base.accounts), perAccount(after.accounts));
  const dC = diff(perClient(base.accounts, base.unmatchedAppointments), perClient(after.accounts, after.unmatchedAppointments));
  console.log(`  per-ACCOUNT rows that moved   ${dA.length}   ${dA.length === 0 ? '✅ RENAME-PROOF' : '🔴 DETACHED'}`);
  dA.slice(0, 10).forEach(l => console.log(l));
  console.log(`  per-CLIENT rows that moved    ${dC.length}   ${dC.length === 0 ? '✅ RENAME-PROOF' : '🔴 DETACHED'}`);
  dC.slice(0, 10).forEach(l => console.log(l));

  console.log('\n════ CONTROL — same mutation, identity erased (the pre-cutover join) ════');
  console.log(`  accounts        ${ctlBase.accounts.length} -> ${ctlAfter.accounts.length}`);
  console.log(`  attributed      ${tot(ctlBase)} -> ${tot(ctlAfter)}`);
  console.log(`  unmatched       ${ctlBase.unmatchedAppointments.length} -> ${ctlAfter.unmatchedAppointments.length}`);
  const cC = diff(perClient(ctlBase.accounts, ctlBase.unmatchedAppointments), perClient(ctlAfter.accounts, ctlAfter.unmatchedAppointments));
  console.log(`  per-CLIENT rows that moved    ${cC.length}   ${cC.length > 0 ? '✅ control bites (a name join DOES detach)' : '🔴 CONTROL DEAD — test proves nothing'}`);
  cC.slice(0, 12).forEach(l => console.log(l));
})();
