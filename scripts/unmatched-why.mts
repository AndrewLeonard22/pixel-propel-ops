/**
 * WHAT ARE THE 57 UNMATCHED APPOINTMENTS, and WHY can nothing attribute them?
 * Runs the app's own path, then asks ad_insights directly whether their ids exist at all.
 */
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0,
};

const { fetchMetaAdSpend, ALL_DATES } = await import('../src/lib/metaAdSpend');
const { fetchAccountRegistry } = await import('../src/lib/accountRegistry');
const { buildAccountSummaries, fetchAirtableData } = await import('../src/lib/dataService');
const { loadSettingsWithSource } = await import('../src/lib/config');

const { settings } = await loadSettingsWithSource();
const registry = await fetchAccountRegistry();
const appointments = (await fetchAirtableData(settings)).records;
const spend = await fetchMetaAdSpend(settings, ALL_DATES);
const r = buildAccountSummaries(spend, appointments, settings, undefined, registry);

const byClient = new Map<string, { n: number; camps: Set<string>; ads: Set<string> }>();
for (const a of r.unmatchedAppointments) {
  const k = (a.client || '(no client)').trim();
  if (!byClient.has(k)) byClient.set(k, { n: 0, camps: new Set(), ads: new Set() });
  const e = byClient.get(k)!;
  e.n++;
  if (a.campaignId) e.camps.add(String(a.campaignId).trim());
  if ((a as { adId?: string }).adId) e.ads.add(String((a as { adId?: string }).adId).trim());
}

// every campaign/ad id that EXISTS anywhere in the feed
const feedCamps = new Set(spend.map(s => String(s.campaignId ?? '').trim()).filter(Boolean));
const feedAds = new Set(spend.map(s => String((s as { adId?: string }).adId ?? '').trim()).filter(Boolean));

console.log(`total appointments ${appointments.length} | attributed ${appointments.length - r.unmatchedAppointments.length} | UNMATCHED ${r.unmatchedAppointments.length}`);
console.log(`feed carries ${feedCamps.size} distinct campaign ids across ${r.accounts.length} accounts\n`);

for (const [client, e] of [...byClient].sort((a, b) => b[1].n - a[1].n)) {
  const campHit = [...e.camps].filter(c => feedCamps.has(c)).length;
  const adHit = [...e.ads].filter(c => feedAds.has(c)).length;
  console.log(
    `${client.padEnd(34)} appts=${String(e.n).padStart(3)}  ` +
    `campaignIds=${String(e.camps.size).padStart(2)} (found in feed: ${campHit})  ` +
    `adIds=${String(e.ads.size).padStart(3)} (found in feed: ${adHit})`,
  );
}

console.log('\n=== do these clients have ANY account in the registry / ad_accounts? ===');
for (const client of byClient.keys()) {
  const viaRegistry = registry.airtableNameToAccountId(client);
  console.log(`  ${client.padEnd(34)} registry match: ${viaRegistry ?? 'NONE'}`);
}

console.log('\n=== the campaign ids nothing can resolve (for a Meta-side probe) ===');
for (const [client, e] of byClient) {
  for (const c of e.camps) console.log(`${c}\t${client}`);
}
