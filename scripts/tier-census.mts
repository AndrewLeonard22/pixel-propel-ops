/**
 * WHICH TIER ACTUALLY ATTRIBUTES, and therefore what the rename test is really testing.
 *
 * The rename test's control came back DEAD. Either the join is so robust that a name
 * rewrite cannot hurt it, or attribution never consults a name in the first place — and
 * those two have completely different consequences. This measures which.
 */
import './_shim.mts';
import { loadSettingsAsync } from '@/lib/config';
import { fetchMetaAdSpend, ALL_DATES } from '@/lib/metaAdSpend';
import { fetchAirtableData, buildAccountSummaries } from '@/lib/dataService';
import { fetchAccountRegistry } from '@/lib/accountRegistry';

const perClient = (accounts: any[], unmatched: any[]) => {
  const m = new Map<string, number>();
  for (const a of accounts) for (const ap of (a.appointmentList || [])) {
    const k = String(ap.client || '(blank)').trim().toLowerCase();
    m.set(k, (m.get(k) || 0) + 1);
  }
  for (const ap of unmatched) m.set(`⟨unmatched⟩ ${String(ap.client || '(blank)').trim().toLowerCase()}`,
    (m.get(`⟨unmatched⟩ ${String(ap.client || '(blank)').trim().toLowerCase()}`) || 0) + 1);
  return m;
};
const movedRows = (a: Map<string, number>, b: Map<string, number>) =>
  [...new Set([...a.keys(), ...b.keys()])].filter(k => (a.get(k) || 0) !== (b.get(k) || 0));

(async () => {
  const settings = await loadSettingsAsync();
  const [rows, air, registry] = await Promise.all([
    fetchMetaAdSpend(ALL_DATES), fetchAirtableData(settings), fetchAccountRegistry(),
  ]);
  const appts = air.records;

  const campIds = new Set(rows.map(r => (r.campaignId || '').trim()).filter(Boolean));
  const withCamp = appts.filter(a => (a.campaignId || '').trim());
  const resolvable = withCamp.filter(a => campIds.has((a.campaignId || '').trim()));
  console.log('════ HOW APPOINTMENTS REACH AN ACCOUNT ════');
  console.log(`  appointments                       ${appts.length}`);
  console.log(`  carry a campaign id                ${withCamp.length}`);
  console.log(`  whose campaign id is IN the feed   ${resolvable.length}  <- Tier 1 settles these`);
  console.log(`  must fall to a NAME tier           ${appts.length - resolvable.length}`);
  console.log(`  registry airtable-name links       ${registry.airtableNameCount}`);

  const base = buildAccountSummaries(rows, appts, settings, undefined, registry);
  const pBase = perClient(base.accounts, base.unmatchedAppointments);

  /**
   * THE HONEST RENAME TEST: strip Tier 1 evidence so attribution is FORCED through the
   * name path, then rewrite every Meta display name. Now a name-keyed join has nowhere to
   * hide, and the id-keyed table is the only thing that can hold the client together.
   */
  const noCamp = appts.map(a => ({ ...a, campaignId: '' }));
  const nc = buildAccountSummaries(rows, noCamp, settings, undefined, registry);
  const renamed = rows.map((r, i) => ({ ...r, accountName: `RENAMED-${(r.accountId || String(i)).slice(-5)}` }));
  const ncRen = buildAccountSummaries(renamed, noCamp, settings, undefined, registry);

  const pNc = perClient(nc.accounts, nc.unmatchedAppointments);
  const pNcRen = perClient(ncRen.accounts, ncRen.unmatchedAppointments);
  const m1 = movedRows(pNc, pNcRen);
  console.log('\n════ NAME-PATH-ONLY (campaign ids stripped), then every name rewritten ════');
  console.log(`  attributed  ${nc.accounts.reduce((s, a) => s + a.appointments, 0)} -> ${ncRen.accounts.reduce((s, a) => s + a.appointments, 0)}`);
  console.log(`  unmatched   ${nc.unmatchedAppointments.length} -> ${ncRen.unmatchedAppointments.length}`);
  console.log(`  clients moved by the rename        ${m1.length}   ${m1.length === 0 ? '✅ the NAME path survives a rename too' : '🔴 rename detaches'}`);
  m1.slice(0, 12).forEach(k => console.log(`    ${pNc.get(k) || 0} -> ${pNcRen.get(k) || 0}  ${k}`));

  /**
   * THE CONTROL FOR *THAT* TEST: take the id-keyed table away. If the run above is being
   * held together by `ad_account_airtable_names`, removing it must make the rename bite.
   */
  const noLinks = { ...registry, airtableNameToAccountId: () => null, airtableNameCount: 0 };
  const ctl = buildAccountSummaries(rows, noCamp, settings, undefined, noLinks as any);
  const ctlRen = buildAccountSummaries(renamed, noCamp, settings, undefined, noLinks as any);
  const pCtl = perClient(ctl.accounts, ctl.unmatchedAppointments);
  const pCtlRen = perClient(ctlRen.accounts, ctlRen.unmatchedAppointments);
  const m2 = movedRows(pCtl, pCtlRen);
  console.log('\n════ CONTROL — same, with `ad_account_airtable_names` REMOVED ════');
  console.log(`  attributed  ${ctl.accounts.reduce((s, a) => s + a.appointments, 0)} -> ${ctlRen.accounts.reduce((s, a) => s + a.appointments, 0)}`);
  console.log(`  clients moved by the rename        ${m2.length}   ${m2.length > 0 ? '✅ control BITES — the id-keyed table is what holds it' : '⚠️ control still dead'}`);
  m2.slice(0, 12).forEach(k => console.log(`    ${pCtl.get(k) || 0} -> ${pCtlRen.get(k) || 0}  ${k}`));

  // and what the id-keyed table is worth even WITHOUT a rename
  const m3 = movedRows(pNc, pCtl);
  console.log(`\n  clients that move when the table is removed (no rename): ${m3.length}`);
  m3.slice(0, 12).forEach(k => console.log(`    ${pNc.get(k) || 0} -> ${pCtl.get(k) || 0}  ${k}`));
})();
