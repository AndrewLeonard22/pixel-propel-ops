import { describe, it, expect } from 'vitest';
import { mapAirtableRecords, buildAccountSummaries, UNRESOLVED_CLIENT } from './dataService';
import { makeAdSpendRow, makeSettings } from '@/test/factories';

/**
 * 🅰️ THE HONESTY HALF OF A — frozen BEFORE the resolution lands, which is the only time it
 * can be frozen. @fable's bar, verbatim: *"if resolution succeeds the unmatched count should
 * DROP TOWARD ZERO. If it does not, SAY SO — do not let a partial resolution read as a full
 * one"* and *"DEGRADE, DO NOT THROW … fall back to EXACTLY today's behaviour."*
 *
 * ⚠️ THIS FILE DOES NOT TEST THE RESOLUTION. @anvil owns that. This is the BASELINE the
 * degrade path must reproduce, captured at `56b95d4` — because *"exactly today's behaviour"*
 * is unfalsifiable once today's behaviour has been replaced. A degrade arm written AFTER the
 * change can only assert what the new code already does.
 *
 * ⭐ AND THE COUNT CLAUSE NEEDS A **BEFORE** NUMBER OR IT CANNOT BE EVALUATED. "Dropped
 * toward zero" is a claim about a DELTA; a suite that only sees the after-state will read any
 * value as correct. `BASELINE_UNRESOLVED` below is that number for this population.
 *
 * POPULATION: the five shapes the live feed actually produces — a linked id, a linked NAME
 * (Airtable returns the primary field's text for some link configs), plain text, a non-string,
 * and an unresolved row carrying a campaign id (which Tier 1 attributes WITHOUT the name).
 */

/** The exact rows this baseline is measured over. Do not edit without re-deriving the numbers. */
const POPULATION = [
  { fields: { 'Client Name': ['rec1234567890abcd'], 'Appointment Date': '8/4/2026', 'Show Status': 'Showed' } },
  { fields: { 'Client Name': ['recABCDEFGHIJKLMN'], 'Appointment Date': '8/5/2026', 'Show Status': 'Booked' } },
  { fields: { 'Client Name': ['Acme'], 'Appointment Date': '8/6/2026', 'Show Status': 'Booked' } },
  { fields: { 'Client Name': 'Beta Co', 'Appointment Date': '8/7/2026', 'Show Status': 'Booked' } },
  { fields: { 'Client Name': ['rec99999999999999'], 'Campaign ID': '111', 'Appointment Date': '8/8/2026' } },
];

/**
 * 🔒 THE FROZEN BASELINE — measured at 56b95d4, before any link resolution exists.
 * These are the numbers the DEGRADE path must still produce when resolution is unavailable
 * (PAT lacking schema.bases:read, field not a link, linked row missing).
 */
const BASELINE = {
  unresolvedLinks: 3,       // three record ids across five rows
  totalRecords: 5,          // no row is ever dropped
  attributed: 3,            // Acme + Beta Co + the campaign-id row (Tier 1 needs no name)
  unmatched: 2,             // the two ids with no other evidence
} as const;

const SETTINGS = makeSettings();
const SPEND = [
  makeAdSpendRow({ accountName: 'Acme', spent: 500, leads: 20 }),
  makeAdSpendRow({ accountName: 'Beta Co', campaignId: '111', spent: 300, leads: 10 }),
];

function run(rows: typeof POPULATION) {
  const { records, unresolvedLinks } = mapAirtableRecords(rows, {});
  const { accounts, unmatchedAppointments } = buildAccountSummaries(SPEND, records, SETTINGS, []);
  return {
    records,
    unresolvedLinks,
    attributed: accounts.reduce((n, a) => n + a.appointments, 0),
    unmatched: unmatchedAppointments.length,
  };
}

describe("🔒 BASELINE — what 'degrade to exactly today's behaviour' MEANS, frozen at 56b95d4", () => {
  it('the four baseline numbers, so a later degrade path has something to be identical TO', () => {
    const r = run(POPULATION);
    expect(r.unresolvedLinks).toBe(BASELINE.unresolvedLinks);
    expect(r.records).toHaveLength(BASELINE.totalRecords);
    expect(r.attributed).toBe(BASELINE.attributed);
    expect(r.unmatched).toBe(BASELINE.unmatched);
  });

  it('🔴 CONSERVATION — attributed + unmatched = every appointment, in any resolution state', () => {
    // The one invariant that must hold BEFORE, DURING and AFTER resolution. A resolution
    // that improves attribution by losing rows would satisfy "unmatched dropped" perfectly.
    const r = run(POPULATION);
    expect(r.attributed + r.unmatched).toBe(BASELINE.totalRecords);
  });

  it('🔴 an unresolved row still renders, dated and truthy — the b50a4d0 invariant', () => {
    // b50a4d0 emptied the appointments page: a falsy client is dropped by every consumer.
    // Resolution must not reintroduce that by returning '' for a link it could not resolve.
    const { records } = mapAirtableRecords(POPULATION, {});
    const unresolved = records.filter(x => x.clientUnresolved);
    expect(unresolved).toHaveLength(BASELINE.unresolvedLinks);
    for (const r of unresolved) {
      expect(Boolean(r.client)).toBe(true);
      expect(r.client).toBe(UNRESOLVED_CLIENT);
      expect(r.appointmentDate).toBeTruthy();
    }
  });
});

describe('🔴 A PARTIAL RESOLUTION MUST NOT READ AS A FULL ONE', () => {
  /**
   * @fable: *"if it does not [drop toward zero], say so."* The failure mode is not a wrong
   * number — it is a RIGHT number with a wrong LABEL: two of three links resolved, the
   * banner disappears because `unresolvedClients > 0` is still the only gate anyone reads,
   * and one appointment is silently unattributed forever.
   *
   * ⭐ SO THE COUNT MUST STAY OBSERVABLE AT EVERY INTERMEDIATE VALUE, not just at 0 and N.
   */
  it('every partial state is distinguishable — 3, 2, 1 and 0 unresolved all report honestly', () => {
    const resolvedName = (i: number) => ({
      fields: { 'Client Name': [`Client ${i}`], 'Appointment Date': '8/4/2026' },
    });
    const unresolvedId = (i: number) => ({
      fields: { 'Client Name': [`rec000000000000${i}0`], 'Appointment Date': '8/4/2026' },
    });

    const seen: number[] = [];
    for (let resolved = 0; resolved <= 3; resolved++) {
      const rows = [
        ...Array.from({ length: resolved }, (_, i) => resolvedName(i)),
        ...Array.from({ length: 3 - resolved }, (_, i) => unresolvedId(i)),
      ];
      const { unresolvedLinks, records } = mapAirtableRecords(rows, {});
      seen.push(unresolvedLinks);
      // No row is lost at ANY resolution level — the count moves, the population does not.
      expect(records).toHaveLength(3);
    }

    // 🔑 THE DISCRIMINATION: four distinct states produce four distinct counts. If this ever
    // collapses to [0,0,0,0] or [3,3,3,3] the counter has stopped measuring resolution.
    expect(seen).toEqual([3, 2, 1, 0]);
  });

  it('🔴 ANTI-VACUITY: the count is not merely "number of rows" — it tracks the IDS', () => {
    // A counter that returned records.length would pass several arms above. Same row count,
    // different id count, must give a different answer.
    const threeRowsNoIds = mapAirtableRecords(
      [
        { fields: { 'Client Name': ['A'] } },
        { fields: { 'Client Name': ['B'] } },
        { fields: { 'Client Name': ['C'] } },
      ],
      {},
    );
    expect(threeRowsNoIds.records).toHaveLength(3);
    expect(threeRowsNoIds.unresolvedLinks).toBe(0);
  });
});

describe('⚠️ WHAT THIS FILE CANNOT ANSWER — stated because a green run must not imply it', () => {
  it('documents the limit: this is a UNIT baseline, not the live 678', () => {
    /**
     * ⛔ THE LIVE COUNT IS NOT MEASURED HERE AND MUST NOT BE INFERRED FROM A GREEN RUN.
     * @fable cites 678 unresolved appointments in production. That number comes from the
     * live Airtable feed; nothing in this file touches it. This file freezes the BEHAVIOUR
     * (three ids ⇒ three unresolved ⇒ two unmatched, no row lost) so the degrade path has a
     * fixed target — it says nothing about how many rows production holds.
     *
     * ⇒ AFTER the resolution lands, "did it drop toward zero" must be answered against the
     * LIVE feed, by re-running the same read that produced 678. A unit suite cannot answer a
     * question about a population it never loads.
     */
    expect(BASELINE.unresolvedLinks).toBe(3);
  });
});
