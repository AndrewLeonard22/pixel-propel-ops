/**
 * THE 57 APPOINTMENTS THAT STOP BEING ATTRIBUTED — is that a JOIN defect or a DATA fact?
 *
 * Those two have opposite remedies. A join defect is a bug in this cutover and must block
 * it. A data fact — the client's Meta account is not in the feed at all — cannot be fixed
 * by any join, because no key attaches a row to a row that does not exist.
 *
 * The discriminating evidence is the appointment's OWN campaign id and ad id: identifiers
 * that came from Meta, that no display name can corrupt. If not one of them appears in
 * `ad_insights`, the account is genuinely absent and the appointments are correctly
 * unmatched rather than silently misfiled.
 */
import './_shim.mts';
import { loadSettingsAsync } from '@/lib/config';
import { fetchMetaAdSpend, ALL_DATES } from '@/lib/metaAdSpend';
import { fetchAirtableData, buildAccountSummaries } from '@/lib/dataService';
import { fetchAccountRegistry } from '@/lib/accountRegistry';

(async () => {
  const settings = await loadSettingsAsync();
  const [rows, air, registry] = await Promise.all([
    fetchMetaAdSpend(ALL_DATES), fetchAirtableData(settings), fetchAccountRegistry(),
  ]);
  const appts = air.records;
  const built = buildAccountSummaries(rows, appts, settings, undefined, registry);
  const unmatched = built.unmatchedAppointments;

  const feedCamp = new Set(rows.map(r => (r.campaignId || '').trim()).filter(Boolean));
  const feedAd = new Set(rows.map(r => (r.adId || '').trim()).filter(Boolean));

  const byClient = new Map<string, any[]>();
  for (const a of unmatched) {
    const k = String(a.client || '(blank)').trim();
    if (!byClient.has(k)) byClient.set(k, []);
    byClient.get(k)!.push(a);
  }

  console.log(`unmatched appointments: ${unmatched.length}, across ${byClient.size} clients\n`);
  let anyHit = 0;
  for (const [client, list] of [...byClient.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const camps = [...new Set(list.map(a => (a.campaignId || '').trim()).filter(Boolean))];
    const ads = [...new Set(list.map(a => (a.adId || '').trim()).filter(Boolean))];
    const cHit = camps.filter(c => feedCamp.has(c)).length;
    const aHit = ads.filter(c => feedAd.has(c)).length;
    anyHit += cHit + aHit;
    console.log(`  ${String(list.length).padStart(3)} appts  ${client}`);
    console.log(`        campaign ids ${cHit}/${camps.length} present in ad_insights, ad ids ${aHit}/${ads.length} present`);
  }
  console.log(`\n  total identifier hits across all unmatched clients: ${anyHit}`);
  console.log(anyHit === 0
    ? '  ✅ DATA FACT — none of these clients has ANY presence in the Meta feed. No join can attach them.'
    : '  🔴 JOIN DEFECT — an identifier that IS in the feed failed to attribute. Investigate.');

  // and prove the tile still counts them
  const attributed = built.accounts.reduce((s, a) => s + a.appointments, 0);
  console.log(`\n  TOTAL APPTS tile = attributed ${attributed} + unmatched ${unmatched.length} = ${attributed + unmatched.length}`);
  console.log(`  airtable records = ${appts.length}  ${attributed + unmatched.length === appts.length ? '✅ conserved — nothing dropped' : '🔴 LEAK'}`);
})();
