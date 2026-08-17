import { describe, it, expect } from 'vitest';
import { makeAdSpendRow } from '@/test/factories';
import { judgeRefresh, snapshotOf, rejectionMessage, COLLAPSE_RATIO, windowKey } from './refreshValidation';
import { ALL_DATES } from './metaAdSpend';

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
    expect(snapshotOf(rows(3, 100), 2, ALL_DATES)).toMatchObject({ rowCount: 3, totalSpend: 300, accountCount: 2 });
  });

  it('survives a bad shape rather than throwing — a gate must not blank the page', () => {
    expect(snapshotOf(undefined as never, 0, ALL_DATES)).toMatchObject({ rowCount: 0, totalSpend: 0, accountCount: 0 });
  });

  it('records WHICH WINDOW the numbers answer for — two windows are two questions', () => {
    expect(snapshotOf(rows(1, 1), 1, ALL_DATES).window)
      .not.toBe(snapshotOf(rows(1, 1), 1, { from: '2026-08-17', to: '2026-08-17' }).window);
  });

  it('the same window produces the same key regardless of object identity', () => {
    expect(snapshotOf(rows(1, 1), 1, { from: '2026-08-01', to: '2026-08-17' }).window)
      .toBe(snapshotOf(rows(9, 9), 4, { from: '2026-08-01', to: '2026-08-17' }).window);
  });
});

describe('judgeRefresh', () => {
  // Every case in THIS block is one window compared against itself: the collapse checks are
  // only meaningful when both snapshots answer the same question. Cross-window behaviour is
  // pinned separately below.
  const W = windowKey(ALL_DATES);
  const GOOD = { rowCount: 38997, totalSpend: 655675.16, accountCount: 61, window: W };

  it('🔑 THE FIRST REFRESH IS ALWAYS ACCEPTED — nothing to compare against', () => {
    // Refusing here would leave a new browser permanently empty: a guard that stops the
    // product ever starting is worse than the defect it prevents.
    expect(judgeRefresh(GOOD, null).accept).toBe(true);
  });

  it('🔴 ANTI-VACUITY CONTROL: a NORMAL refresh is accepted and says nothing', () => {
    // Run first. Without it the gate is satisfiable by rejecting everything, which would
    // freeze the dashboard on its first payload forever.
    const next = { rowCount: 39055, totalSpend: 656_900, accountCount: 61, window: W };
    const v = judgeRefresh(next, GOOD);
    expect(v.accept).toBe(true);
    expect(rejectionMessage(v)).toBeNull();
  });

  it('🔴 SPEND HALVING IS REJECTED — the case a single-refresh check cannot see', () => {
    const next = { rowCount: 38997, totalSpend: 320_000, accountCount: 61, window: W };
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
    const v = judgeRefresh({ rowCount: 1, totalSpend: 1, accountCount: 1, window: W }, GOOD);
    expect(v.reasons).toHaveLength(3);
  });

  it(`a drop to exactly ${COLLAPSE_RATIO * 100}% is NOT a collapse — the boundary is stated`, () => {
    // Strictly less than half. A boundary that moves under a rename would silently change
    // what the product refuses, so it is asserted rather than assumed.
    expect(judgeRefresh({ ...GOOD, rowCount: Math.ceil(38997 * COLLAPSE_RATIO) }, GOOD).accept).toBe(true);
    expect(judgeRefresh({ ...GOOD, rowCount: Math.floor(38997 * COLLAPSE_RATIO) - 1 }, GOOD).accept).toBe(false);
  });

  it('🔑 GROWTH IS NEVER SUSPICIOUS — this gate is about LOSS', () => {
    expect(judgeRefresh({ rowCount: 90_000, totalSpend: 2_000_000, accountCount: 200, window: W }, GOOD).accept).toBe(true);
  });

  it('a previous value of ZERO cannot collapse — no verdict from nothing', () => {
    const empty = { rowCount: 0, totalSpend: 0, accountCount: 0, window: W };
    expect(judgeRefresh(empty, empty).accept).toBe(true);
  });
});

/**
 * ④ THE WINDOW IS PART OF THE QUESTION, AND THE GATE WAS BLIND TO IT.
 *
 * 🔴 MEASURED IN PRODUCTION 2026-08-17. @andrew set the Dashboard range to **Today**. The
 * fetch correctly returned that day — 80 rows, $454.16, 21 accounts — and the gate compared
 * it against the All-Time baseline of 49,066 / $781,058.26 / 52 and REJECTED it, in red,
 * over numbers that were entirely correct:
 *
 *     "ad spend rows fell from 49,066 to 80 ... the older numbers are more likely to be right"
 *
 * ⭐ THE OLDER NUMBERS WERE NOT MORE LIKELY TO BE RIGHT. They answered a different question.
 * This is a DIMENSION failure, not a threshold one: every metric was measured correctly and
 * compared honestly, and the comparison still could not mean what it said, because nothing in
 * `RefreshSnapshot` recorded WHICH WINDOW the numbers were for. No threshold can fix that —
 * narrowing to one day out of 20 months is a 99.8% drop and SHOULD be.
 *
 * ⚠️ AND IT FIRES ON EVERY NARROWING, which is the failure mode that kills a real guard:
 * @andrew on this exact class of banner — «annoying just remove these popups». A gate that
 * cries wolf on correct data gets ignored, and then the truncation it exists to catch
 * (§8 of the cutover doc: one run returned $15,319.22 of $770,984.34, silently) sails past a
 * reader who has learned the red box means nothing.
 */
describe('judgeRefresh across date windows', () => {
  const ALL = windowKey(ALL_DATES);
  const TODAY = windowKey({ from: '2026-08-17', to: '2026-08-17' });
  const ALL_TIME_GOOD = { rowCount: 49_066, totalSpend: 781_058.26, accountCount: 52, window: ALL };

  it('🔑 THE PRODUCTION CASE: narrowing to Today is ACCEPTED, not called a collapse', () => {
    const today = { rowCount: 80, totalSpend: 454.16, accountCount: 21, window: TODAY };
    const v = judgeRefresh(today, ALL_TIME_GOOD);

    expect(v.accept).toBe(true);
    expect(v.reasons).toEqual([]);
    expect(rejectionMessage(v)).toBeNull();
  });

  it('🔴 ANTI-VACUITY CONTROL: a collapse WITHIN ONE window is still rejected', () => {
    // Run this beside the case above. Without it the fix is satisfiable by accepting
    // everything, which would delete the guard rather than aim it.
    const truncated = { rowCount: 15, totalSpend: 15_319.22, accountCount: 15, window: ALL };
    const v = judgeRefresh(truncated, ALL_TIME_GOOD);

    expect(v.accept).toBe(false);
    expect(rejectionMessage(v)).toMatch(/ad spend rows fell from 49,066 to 15/);
  });

  it('WIDENING back to All Time is accepted too — a different question, either direction', () => {
    const todayGood = { rowCount: 80, totalSpend: 454.16, accountCount: 21, window: TODAY };
    expect(judgeRefresh(ALL_TIME_GOOD, todayGood).accept).toBe(true);
  });

  it('a window that did not change is compared exactly as before', () => {
    const sameWindowCollapse = { rowCount: 40, totalSpend: 200, accountCount: 10, window: TODAY };
    const todayGood = { rowCount: 80, totalSpend: 454.16, accountCount: 21, window: TODAY };
    expect(judgeRefresh(sameWindowCollapse, todayGood).accept).toBe(false);
  });
});
