/**
 * Is the 57-appointment move a JOIN BUG or a DATA-AVAILABILITY FACT?
 *
 * A join bug means the rows exist in ad_insights and we failed to find them — unacceptable.
 * A data fact means Meta's feed has no counterpart at all — nothing can attach an appointment
 * to a row that does not exist.
 *
 * Tests the ONLY hard evidence an appointment carries: its campaign id and its ad id.
 */
import './_shim.mts';
import { fetchAirtableData } from '@/lib/dataService';
import { loadSettingsAsync } from '@/lib/config';
import { supabase } from '@/integrations/supabase/client';

const CLIENTS = ['green plus remodeling', 'pergola guy', 'home remodeling pros central pa'];

const main = async () => {
  const settings = await loadSettingsAsync();
  const { records } = await fetchAirtableData(settings);

  const affected = records.filter(r => CLIENTS.includes(String(r.client ?? '').trim().toLowerCase()));
  console.log(`\n${affected.length} appointments belong to the 3 clients that became unmatched\n`);

  const campIds = [...new Set(affected.map(r => String((r as any).campaignId ?? '').trim()).filter(Boolean))];
  const adIds = [...new Set(affected.map(r => String((r as any).adId ?? '').trim()).filter(Boolean))];
  console.log(`  distinct campaign ids on those appointments: ${campIds.length}`);
  console.log(`  distinct ad ids on those appointments:       ${adIds.length}`);

  const sb = supabase as any;
  const chunk = <T,>(a: T[], n: number) => a.length ? Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n)) : [];

  let campHits = 0;
  for (const c of chunk(campIds, 100)) {
    const { data, error } = await sb.from('ad_insights').select('campaign_id').in('campaign_id', c);
    if (error) throw new Error('campaign probe failed: ' + error.message);
    campHits += new Set((data ?? []).map((r: any) => r.campaign_id)).size;
  }
  let adHits = 0;
  for (const c of chunk(adIds, 100)) {
    const { data, error } = await sb.from('ad_insights').select('ad_id').in('ad_id', c);
    if (error) throw new Error('ad probe failed: ' + error.message);
    adHits += new Set((data ?? []).map((r: any) => r.ad_id)).size;
  }

  console.log(`\n  of those campaign ids, present in ad_insights: ${campHits} / ${campIds.length}`);
  console.log(`  of those ad ids,       present in ad_insights: ${adHits} / ${adIds.length}`);
  console.log(
    campHits === 0 && adHits === 0
      ? `\n  ⇒ DATA-AVAILABILITY FACT. Not one campaign or ad these appointments name exists in\n    the Meta feed. No join could attach them; they are counted as unmatched, not dropped.`
      : `\n  🔴 JOIN BUG: ${campHits} campaigns / ${adHits} ads DO exist in ad_insights and were not matched.`,
  );

  // And the positive control: the same probe over a client that DID keep its attribution.
  const keeper = records.filter(r => String(r.client ?? '').trim().toLowerCase() === 'z pool');
  const kc = [...new Set(keeper.map(r => String((r as any).campaignId ?? '').trim()).filter(Boolean))];
  let kHits = 0;
  for (const c of chunk(kc, 100)) {
    const { data } = await sb.from('ad_insights').select('campaign_id').in('campaign_id', c);
    kHits += new Set((data ?? []).map((r: any) => r.campaign_id)).size;
  }
  console.log(`\n  CONTROL — 'z pool' (${keeper.length} appts, kept attribution): ${kHits}/${kc.length} campaign ids present in ad_insights`);
  console.log(`  ${kHits > 0 ? 'The probe CAN find campaign ids when they exist, so the zero above is a real absence.' : '🔴 the probe found nothing even for a working client — the probe itself is broken'}`);
};
main().catch(e => { console.error('FAILED', e); process.exit(1); });
