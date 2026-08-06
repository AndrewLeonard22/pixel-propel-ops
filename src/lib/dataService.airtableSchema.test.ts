import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSettings } from '@/test/factories';
import { checkAirtableSchema, AIRTABLE_COLUMNS, isClosedWon } from './dataService';

/**
 * ② EXTENDED TO AIRTABLE — @andrew asked what happens if he renames a column header.
 * Until now: NOTHING STOPS IT.
 *
 *   rename `Closed Revenue ($)` ⇒ revenue reads $0
 *   rename `Appointment Date`   ⇒ the calendar empties
 *   rename `Client Name`        ⇒ every appointment becomes unmatched
 *   rename `Lead Status`        ⇒ ⭐ THE CLOSED COUNT SURVIVES
 *
 * ⭐ THE LAST ONE IS THE FINDING. `isClosedWon` reads STATUS **or** REVENUE, so losing
 * either is MASKED by the other. That redundancy is a COINCIDENCE, NOT A DESIGN: a
 * single-source failure is invisible to its own consumer, and the healthier the fallback
 * looks the longer the breakage survives. Only a contract can see it — the consumer
 * structurally cannot.
 *
 * ⚠️ VERIFIED AGAINST LIVE EVIDENCE BEFORE ANY FIXTURE WAS TOUCHED, because "widen the
 * fixture" is how a wrong contract gets laundered. All four criticals are confirmed present
 * in @andrew's base by two other seats:
 *   Client Name        @bird's schema dump — ARRAY of RECORD-ID on 99/100
 *   Appointment Date   the live /calendar places appointments by it (23·7·16·2)
 *   Closed Revenue ($) @fable — populated on 46 of 679
 *   Lead Status        @fable's D1 — he counted its value distribution
 */
const LIVE_ISH = [
  'Client Name', 'Appointment Date', 'Closed Revenue ($)', 'Lead Status',
  'Campaign Name', 'Ad Set Name', 'Ad Name', 'Setter', 'Show Status',
  'Attribution Key', 'Lead Name', 'Client Billing Model',
];
const MAPPINGS = { 'Closed Revenue': 'Closed Revenue ($)' };

describe('checkAirtableSchema — silent today, loud when a header moves', () => {
  it('🔴 ANTI-VACUITY CONTROL: today\'s schema passes CLEAN — nothing missing at all', () => {
    // @fable: "if your contract refuses today's data you have written it wrong." Run first,
    // because every arm below is worthless if the contract cannot stay quiet.
    const r = checkAirtableSchema(LIVE_ISH, MAPPINGS);
    expect(r.missingCritical).toEqual([]);
    expect(r.missingLabels).toEqual([]);
    expect(r.unverified).toBe(false);
  });

  it('🔴 A RENAMED CRITICAL HEADER IS NAMED — by the name the app actually reads', () => {
    const renamed = LIVE_ISH.filter(f => f !== 'Closed Revenue ($)').concat('Revenue Closed');
    const r = checkAirtableSchema(renamed, MAPPINGS);
    // The MAPPED name, not 'Closed Revenue' — that is the field that has to exist.
    expect(r.missingCritical).toEqual(['Closed Revenue ($)']);
  });

  it('⭐ THE MASKED ONE: a renamed `Lead Status` is caught even though the count survives', () => {
    const renamed = LIVE_ISH.filter(f => f !== 'Lead Status');
    expect(checkAirtableSchema(renamed, MAPPINGS).missingCritical).toEqual(['Lead Status']);
  });

  it('⭐ …and here is WHY it needs catching — the consumer cannot see it', () => {
    // isClosedWon reads status OR revenue. With the status gone, a won deal carrying
    // revenue still counts, so the closed count looks HEALTHY while half its evidence has
    // silently vanished. The redundancy hides the failure; it does not survive it.
    expect(isClosedWon({ leadStatus: 'Closed Won', closedRevenue: 0 })).toBe(true);
    expect(isClosedWon({ leadStatus: undefined, closedRevenue: 1250 })).toBe(true);
    // ⇒ identical verdict, one input missing. No consumer-level test can distinguish them.
  });

  it('🔑 ASSERTS THE MAPPING, NOT THE RAW NAME — columnMappings IS the read path', () => {
    // The raw 'Closed Revenue' is absent from every real base; only the mapped
    // 'Closed Revenue ($)' exists. Checking the raw name would pass while the app read a
    // field that is not there.
    const withoutMapping = checkAirtableSchema(LIVE_ISH, {});
    expect(withoutMapping.missingCritical).toEqual(['Closed Revenue']);

    const remapped = checkAirtableSchema(
      LIVE_ISH.filter(f => f !== 'Closed Revenue ($)').concat('Money In'),
      { 'Closed Revenue': 'Money In' },
    );
    expect(remapped.missingCritical).toEqual([]);   // re-mapping FIXES it, as the copy says
  });

  it('a missing LABEL is reported and never critical', () => {
    const r = checkAirtableSchema(LIVE_ISH.filter(f => f !== 'Ad Name'), MAPPINGS);
    expect(r.missingLabels).toEqual(['Ad Name']);
    expect(r.missingCritical).toEqual([]);
  });

  it('🔴 NO RECORDS ⇒ UNVERIFIED, not a clean bill of health', () => {
    const r = checkAirtableSchema([], MAPPINGS);
    expect(r.unverified).toBe(true);
    expect(r.missingCritical).toEqual([]);   // and it does NOT fail the source on silence
  });

  it('matching is case- and whitespace-insensitive', () => {
    const shouty = LIVE_ISH.map(f => ` ${f.toUpperCase()} `);
    expect(checkAirtableSchema(shouty, MAPPINGS).missingCritical).toEqual([]);
  });

  it('the CRITICAL set is exactly the four specified — a later edit cannot quietly promote', () => {
    expect(AIRTABLE_COLUMNS.filter(c => c.critical).map(c => c.accept[0]).sort())
      .toEqual(['Appointment Date', 'Client Name', 'Closed Revenue', 'Lead Status']);
  });
});

/**
 * ⛔ THE FAILURE IS PER-SOURCE. Airtable is one of three, and a schema break must not take
 * Windsor down with it — the throw is caught by refreshSources' per-source settle, which is
 * the mechanism this codebase already uses for every other source failure.
 */
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({
  isSupabaseConfigured: true,
  supabase: { functions: { invoke } },
}));
const { fetchAirtableData } = await import('./dataService');
const SETTINGS = makeSettings({ airtableBaseId: 'appREAL', columnMappings: MAPPINGS });

beforeEach(() => invoke.mockReset());

const payload = (fields: Record<string, unknown>) => ({
  data: { status: 'ok', fields: [], records: [{ fields }] },
  error: null,
});

describe('fetchAirtableData — a renamed header FAILS THE SOURCE, named', () => {
  it('🔴 ANTI-VACUITY CONTROL: a complete payload resolves normally', async () => {
    invoke.mockResolvedValue(payload(Object.fromEntries(LIVE_ISH.map(f => [f, 'x']))));
    await expect(fetchAirtableData(SETTINGS)).resolves.toMatchObject({ records: [{}] });
  });

  it('🔴 a missing CRITICAL rejects, so the source is marked FAILED and Windsor is untouched', async () => {
    const broken = Object.fromEntries(LIVE_ISH.filter(f => f !== 'Lead Status').map(f => [f, 'x']));
    invoke.mockResolvedValue(payload(broken));

    await expect(fetchAirtableData(SETTINGS)).rejects.toThrow(/"Lead Status"/);
    await expect(fetchAirtableData(SETTINGS)).rejects.toThrow(/silently become zero/);
    await expect(fetchAirtableData(SETTINGS)).rejects.toThrow(/Re-map it in Settings/);
  });

  it('a missing LABEL does NOT fail the source', async () => {
    const noLabel = Object.fromEntries(LIVE_ISH.filter(f => f !== 'Ad Name').map(f => [f, 'x']));
    invoke.mockResolvedValue(payload(noLabel));
    await expect(fetchAirtableData(SETTINGS)).resolves.toBeTruthy();
  });

  it('🔑 enforces against what ARRIVED, not what the proxy DECLARED', async () => {
    // The proxy's `fields` list can be narrower than the data. Checking the declaration
    // would test what the proxy SAID rather than what the records carried — a defect I
    // shipped for exactly one commit before this arm existed.
    invoke.mockResolvedValue({
      data: {
        status: 'ok',
        fields: ['Client Name'],                       // a narrow DECLARATION
        records: [{ fields: Object.fromEntries(LIVE_ISH.map(f => [f, 'x'])) }],  // full DATA
      },
      error: null,
    });
    await expect(fetchAirtableData(SETTINGS)).resolves.toBeTruthy();
  });
});
