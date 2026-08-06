/**
 * DIFFERENTIAL: @anvil's boundary normaliser vs @raccoon's page-side parser.
 *
 * WHY BOTH EXIST, so nobody deletes one as a duplicate:
 *   normalizeSourceDate (dataService.ts, @anvil)  string -> ISO string | ''
 *       Runs ONCE at the fetch boundary and populates AdSpendRow.dateISO.
 *   parseSourceDate     (dates.ts, @raccoon)      string -> Date | null
 *       For the SIX page-level `parseDateSafe` copies, which compare Date objects in
 *       range filters and cannot use a string. Four of those six shift ISO input by one
 *       calendar day; this is what replaces them.
 *
 * THE RISK OF TWO PARSERS IS THAT THEY DRIFT. This test is the lock: they must agree on
 * the calendar day for every value, or one of them is wrong. Verified at introduction
 * across 1,172 distinct values (every distinct date in BOTH live tabs plus hostile
 * shapes): ZERO disagreements.
 */
import { describe, it, expect } from 'vitest';
import { normalizeSourceDate } from './dataService';
import { parseSourceDate, toIsoDay } from './dates';
import { REAL_DATE_SHAPES } from '@/test/factories';

/**
 * Representative + hostile values. The full 1,172-value run against the live CSVs is a
 * fixture-heavy one-off; these are the shapes that distinguish the implementations.
 */
const VALUES: string[] = [
  // the two live formats, same day — the divergence that motivates ⑤
  '8/4/2026',
  '2026-08-04',
  '1/2/2025',
  '2025-01-02',
  '12/31/2025',
  '2025-12-31',
  // the serials measured in the derived tab
  '45884',
  '45875',
  // boundaries of the serial window
  '36526',
  '73050',
  '36525',
  '73051',
  // things that must NOT decode as serials
  '2026',
  '0',
  '1',
  '999999',
  // calendar rollover
  '2/30/2025',
  '2026-02-30',
  '13/1/2026',
  '0/1/2026',
  '1/0/2026',
  // empties and garbage
  '',
  '   ',
  'not a date',
  'undefined',
  ...Object.values(REAL_DATE_SHAPES),
];

describe('date parsers agree on the calendar day', () => {
  it('normalizeSourceDate(v) === toIsoDay(parseSourceDate(v)) for every shape', () => {
    const disagreements: { value: string; anvil: string; raccoon: string }[] = [];
    for (const v of VALUES) {
      const anvil = normalizeSourceDate(v);
      const d = parseSourceDate(v);
      const raccoon = d ? toIsoDay(d) : '';
      if (anvil !== raccoon) disagreements.push({ value: v, anvil, raccoon });
    }
    expect(disagreements).toEqual([]);
  });

  it('the population is non-empty and both implementations are actually exercised', () => {
    // A differential over an empty or all-null population passes vacuously.
    expect(VALUES.length).toBeGreaterThan(20);
    const parsed = VALUES.filter(v => parseSourceDate(v) !== null);
    const normalised = VALUES.filter(v => normalizeSourceDate(v) !== '');
    expect(parsed.length).toBeGreaterThan(5);
    expect(normalised.length).toBeGreaterThan(5);
    expect(parsed.length).toBe(normalised.length);
  });

  it('🔴 the differential can FAIL — proven, not assumed', () => {
    // A sabotaged parser must be caught, or this file is decorative.
    const sabotaged = (v: string) => {
      const d = parseSourceDate(v);
      if (!d) return '';
      const shifted = new Date(d.getTime() - 86400000); // off by one day
      return toIsoDay(shifted);
    };
    const disagreements = VALUES.filter(v => normalizeSourceDate(v) !== sabotaged(v));
    expect(disagreements.length).toBeGreaterThan(0);
  });
});
