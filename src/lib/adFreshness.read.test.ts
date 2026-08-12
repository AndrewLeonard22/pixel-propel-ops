import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

/**
 * 🔒 THE READ SIDE OF THE FRESHNESS BADGE — `useAdFreshness`, which had no test.
 *
 * `adFreshness.test.ts` covers `deriveState`, which is pure. The hook that decides what to
 * FEED it was untested, and that is where the last fail-open in this module lives.
 *
 * 🔴 THE SHAPE, measured 2026-08-12 by mutation. Replacing
 *     const state = loading || failed ? 'unknown' : deriveState(...)
 * with `deriveState(...)` unconditionally left all 694 tests green. It looks redundant —
 * on a failed read `runs` is emptied and `deriveState(null, null, ...)` already answers
 * `unknown` — and for a TOTAL failure it is. It is not redundant for a PARTIAL one:
 *
 *   the 5-row window query FAILS      -> runs = []          (latest = null)
 *   the last-success query SUCCEEDS   -> successRow = <ok>  (lastSuccess = a real row)
 *
 * `deriveState(null, <recent ok run>, now, [])` walks every branch that keys off `latest`,
 * finds nothing, reaches the counts of a genuinely healthy older row, and returns **fresh**.
 * A GREEN dot, produced by a read that failed. The two queries are independent — different
 * filters, different indexes, different row counts — so one failing while the other
 * succeeds is an ordinary outcome, not a contrived one.
 *
 * ⛔ THE BADGE IS THE ONLY THING ON SCREEN CLAIMING THE SPEND IS CURRENT. It must go grey
 * when it could not look, never green.
 */

const h = vi.hoisted(() => ({
  /** The unfiltered newest-5 query: whether the pipeline is healthy right now. */
  windowResult: { data: null as unknown, error: null as { message: string } | null },
  /** The unbounded newest-ok/partial query: the age of what is on screen. */
  successResult: { data: null as unknown, error: null as { message: string } | null },
  /** Records which query is which, so the arms below cannot be fooled by ordering. */
  sawIn: [] as boolean[],
}));

vi.mock('@/integrations/supabase/client', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: () => {
      // `.in('status', [...])` is what distinguishes the success query from the window one.
      let isSuccessQuery = false;
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = () => self();
      chain.order = () => self();
      chain.not = () => self();
      chain.in = () => { isSuccessQuery = true; return self(); };
      chain.limit = () => {
        h.sawIn.push(isSuccessQuery);
        return Promise.resolve(isSuccessQuery ? h.successResult : h.windowResult);
      };
      return chain;
    },
  },
}));

const { useAdFreshness } = await import('./adFreshness');

const NOW_ISH = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();

/** A perfectly healthy, recent run. Its counts are flawless on purpose. */
const HEALTHY = {
  id: 10,
  started_at: NOW_ISH(35),
  finished_at: NOW_ISH(34),
  status: 'ok',
  accounts_ok: 64, accounts_failed: 0, accounts_discovered: 64, rows_upserted: 305,
  error: null,
};

beforeEach(() => {
  h.windowResult = { data: [HEALTHY], error: null };
  h.successResult = { data: [HEALTHY], error: null };
  h.sawIn = [];
});

const settled = async () => {
  const r = renderHook(() => useAdFreshness());
  await waitFor(() => expect(r.result.current.loading).toBe(false));
  return r.result;
};

describe('a failed read must not render as a healthy pipeline', () => {
  it('🔴 THE WINDOW QUERY FAILS while the success query succeeds: UNKNOWN, not fresh', async () => {
    // The exact fail-open. `lastSuccess` is a real, recent, flawless run, so every
    // count-derived check downstream is satisfied — and we still could not read the run
    // history, so we do not know whether something has failed since.
    h.windowResult = { data: null, error: { message: 'permission denied for table ad_pull_runs' } };
    const r = await settled();
    expect(r.current.state).toBe('unknown');
  });

  it('🔴 BOTH queries fail: UNKNOWN, and no age is invented', async () => {
    h.windowResult = { data: null, error: { message: 'network' } };
    h.successResult = { data: null, error: { message: 'network' } };
    const r = await settled();
    expect(r.current.state).toBe('unknown');
    // `ageMs` feeds "1.5 hours ago". A failed read has no age, and 0 would print "just now".
    expect(r.current.ageMs).toBeNull();
  });

  it('🔴 while the read is still IN FLIGHT the state is unknown, never a default', async () => {
    // A badge that renders green for the first paint of every page load has trained the eye
    // to ignore it by the time it turns red.
    let release: (v: unknown) => void = () => {};
    const pending = new Promise(res => { release = res; });
    h.windowResult = pending as never;
    h.successResult = pending as never;
    const { result } = renderHook(() => useAdFreshness());
    expect(result.current.loading).toBe(true);
    expect(result.current.state).toBe('unknown');
    release({ data: [HEALTHY], error: null });
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('⭐ CONTROL: with both reads healthy the state IS fresh', async () => {
    // Without this arm every assertion above is satisfiable by "always unknown", which is a
    // badge that can never report health and therefore reports nothing.
    const r = await settled();
    expect(r.current.state).toBe('fresh');
    expect(r.current.ageMs).toBeGreaterThan(0);
    // And the mock really did serve two DIFFERENT queries, so the arms are not both reading
    // the same one: exactly one of them applied `.in('status', ...)`.
    expect(h.sawIn.slice().sort()).toEqual([false, true]);
  });
});

describe('the two queries answer two different questions and degrade independently', () => {
  it('🔴 the success query failing does NOT erase a run history that loaded fine', async () => {
    // The window still holds a healthy run, so the age falls back to the window scan rather
    // than the whole badge going dark. Losing the age is not a reason to lose the state.
    h.successResult = { data: null, error: { message: 'statement timeout' } };
    const r = await settled();
    expect(r.current.state).toBe('fresh');
    expect(r.current.lastSuccess?.id).toBe(HEALTHY.id);
  });

  it('🔴 an EMPTY run table is unknown — never "just now"', async () => {
    // A brand-new deployment, or a table that was truncated. There is no pull to describe,
    // and the honest word for that is unknown.
    h.windowResult = { data: [], error: null };
    h.successResult = { data: [], error: null };
    const r = await settled();
    expect(r.current.state).toBe('unknown');
    expect(r.current.ageMs).toBeNull();
  });

  it('a FAILED newest run with an older success is reported failed, and keeps the age', async () => {
    // CONTROL that the hook passes the run LIST through, not just the newest row: the
    // failed-since-success rule downstream needs the rows between them.
    const failedRun = { ...HEALTHY, id: 11, status: 'failed', started_at: NOW_ISH(5), finished_at: NOW_ISH(4) };
    h.windowResult = { data: [failedRun, HEALTHY], error: null };
    h.successResult = { data: [HEALTHY], error: null };
    const r = await settled();
    expect(r.current.state).toBe('failed');
    expect(r.current.ageMs).toBeGreaterThan(0);
    expect(r.current.runs).toHaveLength(2);
  });
});
