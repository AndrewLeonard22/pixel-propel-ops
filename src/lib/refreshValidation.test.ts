import { describe, it, expect } from 'vitest';
import { makeAdSpendRow } from '@/test/factories';
import { judgeRefresh, snapshotOf, rejectionMessage, COLLAPSE_RATIO } from './refreshValidation';

/**
 * ③ THE VALIDATION GATE + LAST-KNOWN-GOOD.
 *
 * @fable: "a suspicious refresh can still replace good data and that is the last way this
 * product silently ruins a number."
 *
 * ⭐ THE PREVIOUS-REFRESH COMPARISON IS THE WHOLE VALUE. 19,000 rows and $320,000 are
 * perfectly plausible numbers on their own — they only look wrong beside the 38,997 and
 * $655,675 that were there a minute ago. A SINGLE-REFRESH CHECK CANNOT SEE SPEND HALVING,
 * which is why every shape/schema guard already on this branch is blind to it.
 */
const rows = (n: number, spent: number) =>
  Array.from({ length: n }, () => makeAdSpendRow({ spent }));

describe('snapshotOf', () => {
  it('measures the three metrics', () => {
    expect(snapshotOf(rows(3, 100), 2)).toEqual({ rowCount: 3, totalSpend: 300, accountCount: 2 });
  });

  it('survives a bad shape rather than throwing — a gate must not blank the page', () => {
    expect(snapshotOf(undefined as never, 0)).toEqual({ rowCount: 0, totalSpend: 0, accountCount: 0 });
  });
});

describe('judgeRefresh', () => {
  const GOOD = { rowCount: 38997, totalSpend: 655675.16, accountCount: 61 };

  it('🔑 THE FIRST REFRESH IS ALWAYS ACCEPTED — nothing to compare against', () => {
    // Refusing here would leave a new browser permanently empty: a guard that stops the
    // product ever starting is worse than the defect it prevents.
    expect(judgeRefresh(GOOD, null).accept).toBe(true);
  });

  it('🔴 ANTI-VACUITY CONTROL: a NORMAL refresh is accepted and says nothing', () => {
    // Run first. Without it the gate is satisfiable by rejecting everything, which would
    // freeze the dashboard on its first payload forever.
    const next = { rowCount: 39055, totalSpend: 656_900, accountCount: 61 };
    const v = judgeRefresh(next, GOOD);
    expect(v.accept).toBe(true);
    expect(rejectionMessage(v)).toBeNull();
  });

  it('🔴 SPEND HALVING IS REJECTED — the case a single-refresh check cannot see', () => {
    const next = { rowCount: 38997, totalSpend: 320_000, accountCount: 61 };
    const v = judgeRefresh(next, GOOD);

    expect(v.accept).toBe(false);
    const m = rejectionMessage(v) ?? '';
    expect(m).toMatch(/total spend fell from/);
    expect(m).toMatch(/655,675\.16/);   // BOTH numbers, as specified
    expect(m).toMatch(/320,000\.00/);
    expect(m).toMatch(/previous data is still shown/);
  });

  it('🔴 a ROW COLLAPSE is rejected and names both counts', () => {
    const v = judgeRefresh({ ...GOOD, rowCount: 19_000 }, GOOD);
    expect(v.accept).toBe(false);
    expect(rejectionMessage(v)).toMatch(/ad spend rows fell from 38,997 to 19,000/);
  });

  it('🔴 an ACCOUNT collapse is rejected — 61 advertisers do not become 20', () => {
    const v = judgeRefresh({ ...GOOD, accountCount: 20 }, GOOD);
    expect(v.accept).toBe(false);
    expect(rejectionMessage(v)).toMatch(/accounts fell from 61 to 20/);
  });

  it('reports EVERY collapsed metric, not just the first', () => {
    const v = judgeRefresh({ rowCount: 1, totalSpend: 1, accountCount: 1 }, GOOD);
    expect(v.reasons).toHaveLength(3);
  });

  it(`a drop to exactly ${COLLAPSE_RATIO * 100}% is NOT a collapse — the boundary is stated`, () => {
    // Strictly less than half. A boundary that moves under a rename would silently change
    // what the product refuses, so it is asserted rather than assumed.
    expect(judgeRefresh({ ...GOOD, rowCount: Math.ceil(38997 * COLLAPSE_RATIO) }, GOOD).accept).toBe(true);
    expect(judgeRefresh({ ...GOOD, rowCount: Math.floor(38997 * COLLAPSE_RATIO) - 1 }, GOOD).accept).toBe(false);
  });

  it('🔑 GROWTH IS NEVER SUSPICIOUS — this gate is about LOSS', () => {
    expect(judgeRefresh({ rowCount: 90_000, totalSpend: 2_000_000, accountCount: 200 }, GOOD).accept).toBe(true);
  });

  it('a previous value of ZERO cannot collapse — no verdict from nothing', () => {
    const empty = { rowCount: 0, totalSpend: 0, accountCount: 0 };
    expect(judgeRefresh(empty, empty).accept).toBe(true);
  });
});
