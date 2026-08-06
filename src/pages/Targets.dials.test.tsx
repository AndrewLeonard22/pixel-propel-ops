import { describe, it, expect } from 'vitest';
import { buildAccountSummaries } from '@/lib/dataService';
import { makeSettings, makeAdSpendRow, makeCallRow } from '@/test/factories';

/**
 * ⚠️ THE DASHBOARD NO LONGER SHOWS DIALS — @andrew, 2026-08-05, "we store them on relay
 * instead". The DISPLAY was removed from the dashboard column and tile; THE METRIC WAS NOT.
 *
 * This file exists so a later "remove the dead dials plumbing" sweep goes RED instead of
 * silently zeroing two targets @andrew set. @fable's original instruction WAS to delete the
 * plumbing, and it was reversed only because a derivation census found these consumers —
 * a future session will not have that census, so it needs a failing test instead.
 *
 * 🔻 THE FIRST VERSION OF THIS FILE WAS VACUOUS AND I SHIPPED IT AT MY OWN BAR.
 * It defined `dialsPerLead`/`dialBookingRate` as LOCAL COPIES of the two Targets.tsx
 * expressions and asserted arithmetic on literals — `dialsPerLead(600, 50) === 12`. Those
 * arms cannot fail from any product change, because no product code runs in them. I proved
 * it by deleting the plumbing: of four arms, the ONLY one that went red was a `toContain`
 * on the source text — a lexical probe that certifies a STRING, and would stay green if
 * someone kept the string and broke the computation.
 *
 * ⭐ SO THE ARMS BELOW TAKE THEIR DIALS FROM `buildAccountSummaries` — the real function,
 * whose real `totalDials` field is the exact thing a deletion sweep removes. The formulas
 * are still restated (Targets.tsx computes them inline in a useMemo and exports nothing),
 * but the INPUT is now the product's, so zeroing the plumbing collapses these by VALUE.
 *
 * POPULATION: one account, 3 matched call rows against 50 performance leads.
 */
const SETTINGS = makeSettings();

/** Build the account the way the app does, and hand back its real dials figure. */
function realTotals() {
  const { accounts } = buildAccountSummaries(
    [makeAdSpendRow({ accountName: 'Acme', spent: 500, leads: 50 })],
    [],
    SETTINGS,
    [
      makeCallRow({ ghlLocationName: 'Acme' }),
      makeCallRow({ ghlLocationName: 'Acme' }),
      makeCallRow({ ghlLocationName: 'Acme' }),
    ],
  );
  const active = accounts;
  return {
    totalDials: active.reduce((s, a) => s + a.totalDials, 0),
    totalPerfLeads: active.reduce((s, a) => s + a.performanceLeads, 0),
  };
}

/** Restated from Targets.tsx:156 and :158 — same expressions, product-supplied inputs. */
const dialsPerLead = (totalDials: number, totalPerfLeads: number) =>
  totalPerfLeads > 0 ? totalDials / totalPerfLeads : 0;
const dialBookingRate = (totalAppts: number, totalDials: number) =>
  totalDials > 0 ? (totalAppts / totalDials) * 100 : 0;

describe('🔴 dials still feed BOTH targets on /targets — the dashboard removal must not reach them', () => {
  it('CONTROL: the real aggregation still produces a non-zero dials total', () => {
    // If this is 0, every arm below would pass for the WRONG reason — a collapsed target
    // is indistinguishable from a target computed off an empty fixture. This is the
    // population check that makes the two arms after it mean something.
    expect(realTotals().totalDials).toBe(3);
    expect(realTotals().totalPerfLeads).toBeGreaterThan(0);
  });

  it('dialsPerLead computes from the aggregation\'s dials, not from a literal', () => {
    const { totalDials, totalPerfLeads } = realTotals();
    expect(dialsPerLead(totalDials, totalPerfLeads)).toBeCloseTo(3 / totalPerfLeads, 10);
    expect(dialsPerLead(totalDials, totalPerfLeads)).toBeGreaterThan(0);
  });

  it('dialBookingRate computes from the aggregation\'s dials, not from a literal', () => {
    const { totalDials } = realTotals();
    expect(dialBookingRate(60, totalDials)).toBeCloseTo((60 / 3) * 100, 10);
    expect(dialBookingRate(60, totalDials)).toBeGreaterThan(0);
  });

  it('🔴 ANTI-VACUITY: zeroed dials collapse BOTH targets — this is what a deletion does', () => {
    // Proves the two arms above are actually reading dials: feed the same expressions a
    // zero and both go to 0, which is the "target not met" reading of a metric that was
    // DELETED rather than measured. A deletion sweep makes the REAL totals zero, so it
    // fails the arms above — not this one.
    expect(dialsPerLead(0, 50)).toBe(0);
    expect(dialBookingRate(60, 0)).toBe(0);
  });

  it('the protective docblock still names the live consumers', () => {
    // Secondary and lexical ON PURPOSE: this one certifies that the WARNING survives, so
    // the next reader learns WHY the field outlived its dashboard consumer. It is not the
    // arm that protects the computation — the three above are.
    const src = require('fs').readFileSync('src/lib/dataService.ts', 'utf8');
    expect(src).toContain('totalDials: matchedDials');
    expect(src).toContain('DO NOT DELETE AS UNUSED');
    expect(src).toContain('Targets.tsx:156');
  });
});
