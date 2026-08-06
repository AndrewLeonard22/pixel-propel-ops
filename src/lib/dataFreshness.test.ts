import { describe, it, expect } from 'vitest';
import { makeAdSpendRow } from '@/test/factories';
import {
  latestSourceDate, daysBetween, describeFreshness, freshnessLabel, freshnessWarning,
  LAGGING_AFTER_DAYS, STALE_AFTER_DAYS,
} from './dataFreshness';

/**
 * ① THE HALF THAT GIVES THE FREEZE A SYMPTOM.
 *
 * @bird measured every freshness signal on the whole dashboard and found exactly one —
 * "Fetched less than a minute ago" — with ZERO source dates rendered anywhere. That
 * sentence is TRUE and it is about the WRONG CLOCK: it describes the FETCH, not the DATA.
 *
 * On the day the array formula runs out, the fetch returns 200, the parse is clean, every
 * source is connected, `needsAttention` is false for all three, and the screen still says
 * "Fetched less than a minute ago" over data that stopped moving.
 * ⇒ 🔑 THE FREEZE HAD NO SYMPTOM, and every honest-state shipped tonight stayed silent
 *   through it BECAUSE NOTHING FAILED.
 *
 * ⚠️ THE POPULATION HERE IS DATA AGE, NOT SOURCE HEALTH, and they are independent axes. A
 * healthy source can serve frozen data forever. Every existing guard on this branch asks
 * the health question, which is exactly why none of them could see this.
 */
const row = (dateISO: string) => makeAdSpendRow({ dateISO });

describe('latestSourceDate', () => {
  it('returns the newest date in the feed', () => {
    expect(latestSourceDate([row('2026-08-01'), row('2026-08-05'), row('2026-07-30')])).toBe('2026-08-05');
  });

  it('ignores unparsed dates rather than treating them as ancient', () => {
    // normalizeSourceDate returns '' for anything it cannot read. Sorting '' as a date
    // would make a feed with one bad row look infinitely old — a false alarm from a typo.
    expect(latestSourceDate([row(''), row('2026-08-05'), row('not-a-date')])).toBe('2026-08-05');
  });

  it('🔴 NEVER THROWS on a bad shape — a freshness probe must not white-screen the app', () => {
    // @fable: "it must NOT block rendering." Found by the SourceStatusBanner tests, whose
    // mock supplies no adSpend at all. A function reached through a hook cannot promise
    // its own inputs, and reporting "data might be old" is not worth a blank page.
    expect(latestSourceDate(undefined as never)).toBeNull();
    expect(latestSourceDate(null as never)).toBeNull();
    expect(latestSourceDate([null, undefined] as never)).toBeNull();
    expect(describeFreshness(undefined as never, '2026-08-05').state).toBe('unknown');
  });

  it('returns null when nothing is dated — an unknown, not a zero', () => {
    expect(latestSourceDate([])).toBeNull();
    expect(latestSourceDate([row(''), row('garbage')])).toBeNull();
  });
});

describe('daysBetween', () => {
  it('counts whole days in UTC so a timezone cannot shift the answer', () => {
    expect(daysBetween('2026-08-01', '2026-08-05')).toBe(4);
    expect(daysBetween('2026-08-05', '2026-08-05')).toBe(0);
  });
  it('returns null on unparseable input', () => {
    expect(daysBetween('nope', '2026-08-05')).toBeNull();
  });
});

describe('describeFreshness — the states', () => {
  it('CONTROL: same-day data is current and warns about nothing', () => {
    // Without this the fix is satisfiable by always warning, which is how a real warning
    // stops being read.
    const r = describeFreshness([row('2026-08-05')], '2026-08-05');
    expect(r.state).toBe('current');
    expect(r.daysBehind).toBe(0);
    expect(freshnessWarning(r)).toBeNull();
  });

  it('yesterday is still current — a daily feed is normally a day behind', () => {
    expect(describeFreshness([row('2026-08-04')], '2026-08-05').state).toBe('current');
  });

  it(`LAGGING at ${LAGGING_AFTER_DAYS} days, and says it is not yet a fault`, () => {
    const r = describeFreshness([row('2026-08-03')], '2026-08-05');
    expect(r.state).toBe('lagging');
    expect(freshnessWarning(r)).toMatch(/not yet unusual/i);
  });

  it(`🔴 STALE at ${STALE_AFTER_DAYS} days — THE FREEZE, and it names the array formula`, () => {
    const r = describeFreshness([row('2026-08-01')], '2026-08-05');
    expect(r.state).toBe('stale');
    expect(r.daysBehind).toBe(4);

    const w = freshnessWarning(r) ?? '';
    expect(w).toMatch(/no new ad spend rows for 4 days/);
    expect(w).toMatch(/array formula/);           // points at the actual cause
    expect(w).toMatch(/NOT up to date/);          // and at what it means for the numbers
  });

  it('🔑 THE CLIFF, SIMULATED: the feed stops on 2026-08-13 and the app notices by the 17th', () => {
    // @fable's measurement: capacity 39,388, 444 headroom, ~58 rows/day ⇒ freezes ~08-13.
    // Before this file the dashboard would have said "Fetched less than a minute ago"
    // every day after, forever.
    expect(describeFreshness([row('2026-08-13')], '2026-08-14').state).toBe('current');
    expect(describeFreshness([row('2026-08-13')], '2026-08-15').state).toBe('lagging');
    expect(describeFreshness([row('2026-08-13')], '2026-08-17').state).toBe('stale');
    expect(describeFreshness([row('2026-08-13')], '2026-09-13').daysBehind).toBe(31);
  });

  it('no dated rows is UNKNOWN, never current', () => {
    const r = describeFreshness([], '2026-08-05');
    expect(r.state).toBe('unknown');
    expect(r.latestDate).toBeNull();
    expect(freshnessLabel(r)).toMatch(/no dated rows/);
  });

  /**
   * 🔴 THE TEST THAT USED TO BE HERE HAD A NAME THAT CONTRADICTED ITS OWN ASSERTION.
   *
   * It was called "one bad row must not mask a frozen feed" and it asserted `state ===
   * 'unknown'` — which IS the masking. @raccoon found the mechanism: `MAX` is the
   * aggregation most vulnerable to a single outlier, and mine had no ceiling. One row dated
   * 2126 made daysBetween negative, the feed read as fresher than today, and the
   * lagging/stale thresholds could NEVER trip. Not degraded — DISABLED, permanently.
   *
   * ⭐ THE DETECTOR BUILT TO CATCH A SILENT FREEZE HAD A SILENT WAY TO BE SWITCHED OFF, and
   * the symptom was the SAME symptom: everything looks fine. My test stated the right
   * intent in its title and then locked the opposite behaviour in its body, so it passed.
   */
  it('🔴 A FUTURE-DATED ROW CANNOT SILENCE THE DETECTOR — @raccoon', () => {
    // Exactly his arm: healthy-ish rows plus one typo year. The 2026-01-01 row is seven
    // months stale, so the honest verdict is STALE, not "unknown".
    const r = describeFreshness([row('2126-08-04'), row('2026-01-01')], '2026-08-05');
    expect(r.state).toBe('stale');
    expect(r.latestDate).toBe('2026-01-01');
    expect(r.daysBehind).toBeGreaterThan(200);
  });

  it('🔴 and the FREEZE still fires with a future row present — the case that matters', () => {
    // A typo'd row must not buy the frozen feed another day of silence.
    const r = describeFreshness([row('2126-08-04'), row('2026-08-01')], '2026-08-05');
    expect(r.state).toBe('stale');
    expect(r.daysBehind).toBe(4);
  });

  it('⚠️ the ignored rows are COUNTED, not silently dropped — even when healthy', () => {
    // A silent exclusion is the same defect one level down: an absence rendered as a fact.
    const r = describeFreshness([row('2126-08-04'), row('2026-08-05')], '2026-08-05');
    expect(r.state).toBe('current');
    expect(r.futureRows).toBe(1);
    expect(freshnessWarning(r)).toMatch(/dated in the future/);
    expect(freshnessWarning(r)).toMatch(/mistyped year/);
  });

  it('CONTROL: tomorrow is ALLOWED — a sheet in a later timezone is not a typo', () => {
    // Without this slack the fix would start ignoring legitimate rows, which is the mirror
    // defect: a ceiling that trims real data makes the feed look staler than it is.
    const r = describeFreshness([row('2026-08-06')], '2026-08-05');
    expect(r.futureRows).toBe(0);
    expect(r.latestDate).toBe('2026-08-06');
    expect(r.state).toBe('current');
  });

  it('ALL rows in the future is genuinely unknown, and says how many', () => {
    const r = describeFreshness([row('2126-01-01'), row('2126-02-01')], '2026-08-05');
    expect(r.state).toBe('unknown');
    expect(r.latestDate).toBeNull();
    expect(r.futureRows).toBe(2);
  });
});

describe('freshnessLabel — the MEASUREMENT ships in every state', () => {
  it('⭐ always renders the date, including when nothing is wrong', () => {
    // The whole point. A signal that appears only when a threshold trips leaves the healthy
    // case describing the wrong clock, which is the defect this file exists to remove.
    expect(freshnessLabel(describeFreshness([row('2026-08-05')], '2026-08-05'))).toBe(
      'Ad spend data through 2026-08-05 (today)',
    );
    expect(freshnessLabel(describeFreshness([row('2026-08-04')], '2026-08-05'))).toMatch(/1 day ago/);
    expect(freshnessLabel(describeFreshness([row('2026-08-01')], '2026-08-05'))).toMatch(/4 days ago/);
  });

  it('the DATE and the WARNING are separable — the fact ships without the judgement', () => {
    // The threshold is an assumption; the date is a measurement. A reader can disbelieve
    // the warning and still see the fact.
    const healthy = describeFreshness([row('2026-08-05')], '2026-08-05');
    expect(freshnessLabel(healthy)).toContain('2026-08-05');
    expect(freshnessWarning(healthy)).toBeNull();
  });
});
