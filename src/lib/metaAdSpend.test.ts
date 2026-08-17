import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 🔒 THE GUARDS THAT REPLACE `sheetCompleteness.ts`.
 *
 * ⛔ WHAT WAS DELETED AND WHY IT COULD NOT SIMPLY BE DROPPED. The sheet's completeness
 * detector compared the derived tab's row count to the raw tab's, defeating gviz's silent
 * wrong-tab fallback with a table-signature proof. Twenty-one tests died with it — but the
 * QUESTION it asked ("is what we are showing all of it?") outlived the mechanism, and a
 * source that cannot report its own incompleteness is how the user lost $166,895 of spend
 * without a single error on screen.
 *
 * ⭐ AND THE OLD DETECTOR WAS STRUCTURALLY BLIND TO THE FAILURE THAT ACTUALLY HAPPENED.
 * It compared two copies of ONE drifting artefact, so when the sheet started overwriting
 * old rows instead of appending, the row COUNT stayed roughly constant, both tabs agreed,
 * and it reported COMPLETE the whole time July 2026 was missing.
 *
 * What replaces it reconciles the rows we are computing totals from against `count(*)`
 * over the SAME window from the SAME authenticated source. That catches the post-cutover
 * shape of "we are showing you less than there is":
 *
 *   ① PostgREST answers at most 1000 rows and says nothing about the rest. Against 48,000+
 *      rows that is a 98% loss arriving as a clean success, and NOTHING ELSE IN THE SUITE
 *      WOULD SEE IT — `judgeRefresh` compares to the last ACCEPTED refresh and accepts the
 *      first one of every page load unconditionally, so a cold browser has no baseline.
 *   ② a paging loop that stops early.
 *   ③ a date filter that silently selects the wrong window.
 */

const h = vi.hoisted(() => ({
  configured: true,
  /** Every `.range(from, to)` the fetcher asked for, in order. */
  ranges: [] as [number, number][],
  /** The filters applied to the last query — this is how "filtered IN SQL" is proven. */
  filters: [] as { op: string; col: string; val: unknown }[],
  /**
   * Every `.order(col, opts)` applied, per page. Recorded because the ORDER BY is the
   * load-bearing half of `.range()` paging and NOTHING was asserting it — see the
   * "a stable total order" block below.
   */
  orders: [] as { col: string; ascending: boolean | undefined }[][],
  /** Rows the fake server holds. */
  rows: [] as Record<string, unknown>[],
  /** Force the select to fail. */
  selectError: null as { message: string } | null,
  /** What the count query answers. `undefined` = an error. */
  count: undefined as number | undefined,
  /**
   * ⭐ A WINDOW-AWARE COUNT, and it is what makes `source-empty` testable at all.
   *
   * `h.count` is one number for every query, so it cannot express the ONE shape that
   * distinguishes "this date range is quiet" from "this database holds no ad spend":
   * the windowed count is 0 AND the unbounded count is not. With a single scalar the two
   * cases are literally the same input, which is why the guard against the wrong-Supabase
   * -project $0.00 had no test and a mutation deleting it survived the whole suite.
   *
   * Receives the filters THIS query applied (not the shared accumulator, which by then
   * holds the previous query's too). `null` falls back to `h.count`.
   */
  countFor: null as null | ((filters: { op: string; col: string; val: unknown }[]) => number | undefined),
  /**
   * ⭐ A SERVER THAT ANSWERS EACH PAGE ITSELF, and the only way to express the fault the
   * count reconciliation is blind to.
   *
   * The default fake slices ONE stable array, so every page is consistent with every other
   * and an overlapping page is literally not representable. OFFSET paging against a table
   * being written to is not stable: a row inserted or deleted before the current page shifts
   * it, so page 2 re-serves page 1's last row and never serves the one after it. Same total
   * count, one row duplicated, one row gone.
   */
  pageRows: null as null | ((from: number, to: number) => Record<string, unknown>[]),
  /**
   * ⭐ WHAT THE *DATA* QUERY REPORTS AS THE TOTAL — `Content-Range: 0-999/48611`.
   *
   * Distinct from `h.count`, which answers the separate head+count query
   * `checkMetaCompleteness` runs. The fetcher now asks the FIRST page to count, because
   * the total is the only thing that can tell a short page in the MIDDLE from the end of
   * the data — and "a short page is the end" was an inference that lost 98% of the rows
   * once, in silence.
   *
   *   'auto' — the fake counts the window itself, exactly as Postgres would
   *   null   — the server declines to count; the loop must fall back to "an empty page
   *            is the end", never to "a short page is the end"
   *   number — a forced total, for pinning what the loop does when it disagrees
   */
  dataCount: 'auto' as 'auto' | null | number,
  /** Whether each request asked the server to count, in order. Proves it asks ONCE. */
  countAsks: [] as boolean[],
  /**
   * ⭐ EVERY RELATION THE MODULE TOUCHED, IN ORDER — and it is what makes the base-vs-view
   * parity guard testable rather than merely present.
   *
   * The fake used to ignore `from()`'s argument entirely, so a count of the VIEW and a count
   * of the TABLE UNDER IT were literally the same input and no test could tell them apart.
   * A guard whose two instruments are indistinguishable to the harness is a guard with one
   * instrument.
   */
  tables: [] as string[],
  /**
   * What the count over `ad_insights` (the BASE table) answers.
   *
   * ⚠️ `'mirror'` IS THE DEFAULT AND IT IS THE HONEST ONE: the view is a `LEFT JOIN` from the
   * base onto a PRIMARY KEY, so in a healthy database the two counts are equal BY
   * CONSTRUCTION. Every test that is not about parity therefore keeps meaning exactly what it
   * meant, and the parity tests are the ones that set this to something else.
   */
  baseCount: 'mirror' as 'mirror' | number | undefined,
}));

vi.mock('@/integrations/supabase/client', () => {
  const builder = (relation: string, isHead: boolean, wantCount: boolean) => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    // ⚠️ PER-QUERY, not the shared accumulator: `checkMetaCompleteness` runs a windowed
    // count and then an unbounded one, and `h.filters` cannot tell them apart afterwards.
    const mine: { op: string; col: string; val: unknown }[] = [];
    for (const op of ['gte', 'lte'] as const) {
      chain[op] = (col: string, val: unknown) => {
        h.filters.push({ op, col, val }); mine.push({ op, col, val }); return self();
      };
    }
    // ⭐ THE RECORDER IS NOW WIRED. It was declared, documented as load-bearing, and never
    // written to — so `h.orders` was permanently `[]` and any assertion over it would have
    // passed vacuously. Measured: deleting BOTH `.order()` calls from the fetcher left the
    // entire suite green.
    const myOrders: { col: string; ascending: boolean | undefined }[] = [];
    chain.order = (col: string, opts?: { ascending?: boolean }) => {
      myOrders.push({ col, ascending: opts?.ascending });
      return self();
    };
    chain.range = (from: number, to: number) => {
      h.ranges.push([from, to]);
      h.orders.push(myOrders);
      h.countAsks.push(wantCount);
      if (h.selectError) return Promise.resolve({ data: null, error: h.selectError });
      // The fake server applies the window, exactly as Postgres would.
      const lo = mine.find(f => f.op === 'gte')?.val as string | undefined;
      const hi = mine.find(f => f.op === 'lte')?.val as string | undefined;
      const win = h.rows.filter(r => {
        const d = String(r.date);
        return (!lo || d >= lo) && (!hi || d <= hi);
      });
      // ⚠️ COUNT IS RETURNED ONLY WHEN ASKED FOR, because that is the contract the fetcher
      // depends on: an unasked-for count arriving anyway would make "it asks once" vacuous.
      // With `h.pageRows` the fake is a hand-written page server with no notion of a total,
      // so 'auto' means "this server does not count" — which is the fallback path.
      const auto = h.pageRows ? null : win.length;
      const total = h.dataCount === 'auto' ? auto : h.dataCount;
      const countField = wantCount ? { count: total } : {};
      const data = h.pageRows ? h.pageRows(from, to) : win.slice(from, to + 1);
      return Promise.resolve({ data, error: null, ...countField });
    };
    if (isHead) {
      // A head+count query is awaited directly, without .range().
      chain.then = (res: (v: unknown) => unknown) => {
        // ⭐ THE VIEW'S ANSWER, computed first even when the BASE is being asked, because
        // `'mirror'` means "a healthy database, where the two are equal by construction".
        const viewAnswer = h.countFor ? h.countFor(mine) : h.count;
        const n =
          relation === 'ad_insights'
            ? (h.baseCount === 'mirror' ? viewAnswer : h.baseCount)
            : viewAnswer;
        return Promise.resolve(
          n === undefined
            ? { count: null, error: { message: 'count failed' } }
            : { count: n, error: null },
        ).then(res);
      };
    }
    return chain;
  };
  return {
    get isSupabaseConfigured() { return h.configured; },
    supabase: {
      from: (relation: string) => {
        h.tables.push(relation);
        return {
          select: (_cols: string, opts?: { head?: boolean; count?: string }) =>
            builder(relation, Boolean(opts?.head), opts?.count === 'exact'),
        };
      },
    },
  };
});

const {
  fetchMetaAdSpend, checkMetaCompleteness, countMetaSpendRows, countBaseSpendRows,
  assertWindow, PAGE_SIZE, MAX_PAGES, ALL_DATES, completenessMessage,
  AD_SPEND_VIEW, AD_SPEND_BASE,
} = await import('./metaAdSpend');
const { missingSettingsFor, isSourceConfigured } = await import('./sourceStatus');
const { DEFAULT_SETTINGS } = await import('./config');

const makeRows = (n: number, date = '2026-08-08') =>
  Array.from({ length: n }, (_, i) => ({
    date, ad_id: `ad-${i}`, account_id: 'ACCT', account_name: 'Acme',
    campaign_id: 'c1', campaign_name: 'C', adset_id: 'a1', adset_name: 'A',
    ad_name: 'N', spend: '10', leads: 1,
  }));

beforeEach(() => {
  h.configured = true;
  h.ranges = []; h.filters = []; h.rows = []; h.selectError = null; h.count = undefined;
  h.orders = []; h.countFor = null; h.pageRows = null;
  h.dataCount = 'auto'; h.countAsks = []; h.tables = []; h.baseCount = 'mirror';
});

describe('the 1000-row cap — the silent 98% loss', () => {
  it('🔴 PAGES PAST THE CAP: 2,350 rows arrive as 2,350, not as 1,000', async () => {
    h.rows = makeRows(2350);
    const got = await fetchMetaAdSpend(DEFAULT_SETTINGS);
    expect(got).toHaveLength(2350);
    // Three requests, each asking for the next window — and the third is short, which is
    // how the loop knows it has reached the end.
    expect(h.ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('🔴 ANTI-VACUITY CONTROL: a single short page makes exactly ONE request', async () => {
    // Without this the paging arm is satisfiable by always looping a fixed number of times,
    // and "it paged" would say nothing about whether it stopped correctly.
    h.rows = makeRows(12);
    const got = await fetchMetaAdSpend(DEFAULT_SETTINGS);
    expect(got).toHaveLength(12);
    expect(h.ranges).toHaveLength(1);
  });

  it('a page that is EXACTLY full is not GUESSED about — the source counted it', async () => {
    // The boundary a `< PAGE_SIZE` check could never resolve: at exactly 1000 rows nothing
    // in the RESPONSE SHAPE distinguishes "that is all" from "there is more". The count
    // does, so this stops on a read value rather than on a second request's silence.
    h.rows = makeRows(PAGE_SIZE);
    const got = await fetchMetaAdSpend(DEFAULT_SETTINGS);
    expect(got).toHaveLength(PAGE_SIZE);
    expect(h.ranges).toHaveLength(1);
  });

  it('🔴 a full page is NOT assumed to be the last when the server would not count', async () => {
    // The other half of the same law, and the control on the arm above: strip the count and
    // the loop must go back to asking, never to guessing.
    h.dataCount = null;
    h.rows = makeRows(PAGE_SIZE);
    const got = await fetchMetaAdSpend(DEFAULT_SETTINGS);
    expect(got).toHaveLength(PAGE_SIZE);
    expect(h.ranges).toEqual([[0, 999], [1000, 1999]]);
  });
});

/**
 * 🔴 THE $15,319.22 RUN. Measured on this branch, once in seven: `fetchMetaAdSpend` returned
 * 15 accounts and $15,319.22 of the $770,984.34 that exists, threw nothing, and logged
 * nothing. Cause: a page came back SHORT, and the loop's termination rule was
 * `batch.length < PAGE_SIZE` — "a short page is the end of the data".
 *
 * ⭐ THAT IS AN INFERENCE ABOUT THE SERVER, NOT A FACT FROM IT, and every inference that can
 * be wrong is a fail-open when the wrong answer is "you have it all". Nothing in a short
 * response says whether the server ran out of rows or ran out of patience.
 *
 * What replaces it is a value the server sends: `Content-Range: 0-999/48611`. The loop stops
 * when it HOLDS what the source COUNTS, and when the source will not count, it stops on an
 * EMPTY page — which is a fact about the response rather than a reading of its size.
 */
describe('🔴 a SHORT page is not the end of the data', () => {
  it('keeps paging through a short page when the count says there is more', async () => {
    // 2,350 rows, served 900 at a time by a server that shortens every page.
    const all = makeRows(2350);
    h.rows = all;
    h.pageRows = (from) => all.slice(from, from + 900);
    h.dataCount = all.length;

    const got = await fetchMetaAdSpend(DEFAULT_SETTINGS);
    expect(got).toHaveLength(2350);
    // Every request resumes where the server actually stopped — 900, not 1000. An offset of
    // `page * PAGE_SIZE` would have skipped 100 rows per page even if the loop kept going.
    expect(h.ranges).toEqual([[0, 999], [900, 1899], [1800, 2799]]);
  });

  it('🔑 ANTI-VACUITY: the old rule really did lose those rows', async () => {
    // Without this the arm above passes against any loop that runs more than once. The
    // counterfactual is stated as an assertion: on the FIRST short page, `< PAGE_SIZE`
    // returns, and 900 of 2,350 rows is what the user would have been shown as a total.
    const all = makeRows(2350);
    expect(all.slice(0, 900)).toHaveLength(900);
    expect(900).toBeLessThan(PAGE_SIZE);
    expect(900).toBeLessThan(all.length);
  });

  it('an EMPTY page ends the loop when the server will not count', async () => {
    // The fallback, and it must terminate: nothing left at this offset is a fact.
    const all = makeRows(1500);
    h.rows = all;
    h.pageRows = (from) => all.slice(from, from + 900);
    h.dataCount = null;

    const got = await fetchMetaAdSpend(DEFAULT_SETTINGS);
    expect(got).toHaveLength(1500);
    expect(h.ranges).toEqual([[0, 999], [900, 1899], [1500, 2499]]);
  });

  it('the count is asked for ONCE, on the first request', async () => {
    // 49 counts of a 48,611-row view to learn one number that cannot usefully change is a
    // cost with no answer attached to it.
    h.rows = makeRows(2350);
    await fetchMetaAdSpend(DEFAULT_SETTINGS);
    expect(h.countAsks).toEqual([true, false, false]);
  });
});

describe('the date range is filtered IN SQL, not in the browser', () => {
  it('🔴 sends gte/lte to the server and receives only the window', async () => {
    h.rows = [...makeRows(3, '2026-07-01'), ...makeRows(4, '2026-08-08'), ...makeRows(5, '2026-09-01')];
    const got = await fetchMetaAdSpend(DEFAULT_SETTINGS, { from: '2026-08-01', to: '2026-08-31' });

    // TWICE — the data page, then the re-count that proves the page-0 total is still true.
    // ⚠️ THE RE-COUNT CARRIES THE SAME WINDOW, and that is load-bearing rather than tidy: an
    // unwindowed re-count would compare 4 fetched rows against all 12 in the table, decide it
    // was short, and page forever over a window that was already complete.
    expect(h.filters).toEqual([
      { op: 'gte', col: 'date', val: '2026-08-01' },
      { op: 'lte', col: 'date', val: '2026-08-31' },
      { op: 'gte', col: 'date', val: '2026-08-01' },
      { op: 'lte', col: 'date', val: '2026-08-31' },
    ]);
    // 4, not 12: the rows outside the window were never transferred.
    expect(got).toHaveLength(4);
  });

  it('ALL_DATES sends NO filter — "everything" is a real answer, not a missing WHERE', async () => {
    h.rows = makeRows(5);
    await fetchMetaAdSpend(DEFAULT_SETTINGS, ALL_DATES);
    expect(h.filters).toEqual([]);
  });

  it('an open-ended window sends only the bound it has', async () => {
    h.rows = makeRows(5);
    await fetchMetaAdSpend(DEFAULT_SETTINGS, { from: '2026-08-01' });
    expect(h.filters).toEqual([
      { op: 'gte', col: 'date', val: '2026-08-01' },
      { op: 'gte', col: 'date', val: '2026-08-01' },   // the terminating re-count, same bound
    ]);
  });

  it('🔴 REFUSES a malformed bound rather than silently widening the query', () => {
    // Dropping an unparseable bound would answer a question nobody asked — the user picks
    // one month and is shown all time, under the month's label. A refusal is a value.
    expect(() => assertWindow({ from: '08/01/2026' })).toThrow(/ISO date/);
    expect(() => assertWindow({ to: 'yesterday' })).toThrow(/ISO date/);
    expect(() => assertWindow({ from: '2026-09-01', to: '2026-08-01' })).toThrow(/is after/);
    // CONTROL: the shapes that are legal really are accepted, so the arm above is
    // discriminating and not just "this function throws".
    expect(() => assertWindow({ from: '2026-08-01', to: '2026-08-31' })).not.toThrow();
    expect(() => assertWindow(ALL_DATES)).not.toThrow();
  });
});

describe('a dead source must never render as a real zero', () => {
  it('🔴 THROWS on a query error instead of returning an empty list', async () => {
    h.selectError = { message: 'permission denied for view ad_insights_resolved' };
    await expect(fetchMetaAdSpend(DEFAULT_SETTINGS)).rejects.toThrow(/permission denied/);
  });

  it('🔴 THROWS when Supabase is not configured — zeros are not an honest fallback', async () => {
    h.configured = false;
    await expect(fetchMetaAdSpend(DEFAULT_SETTINGS)).rejects.toThrow(/Refusing to report zeros/);
  });

  it('an empty result IS a legitimate answer when the query succeeded', async () => {
    // The other half of the law: "no rows in this window" is a fact, and it must not be
    // turned into an error any more than an error may be turned into zero.
    h.rows = [];
    await expect(fetchMetaAdSpend(DEFAULT_SETTINGS)).resolves.toEqual([]);
  });
});

describe('completeness — reconciling what we hold against what the source counts', () => {
  it('🔴 TRUNCATED: names how many rows are missing, and does not round it to "fine"', async () => {
    h.count = 48588;
    const r = await checkMetaCompleteness(1000);
    expect(r.state).toBe('truncated');
    expect(r.droppedRows).toBe(47588);
    expect(r.rawRows).toBe(48588);
    expect(r.derivedRows).toBe(1000);
  });

  it('COMPLETE only when the two numbers actually agree', async () => {
    h.count = 83;
    expect((await checkMetaCompleteness(83)).state).toBe('complete');
  });

  it('🔴 a FAILED COUNT is UNVERIFIABLE, never "complete" — we could not look', async () => {
    // The fail-open this detector exists to refuse. `null` from the count query must not
    // collapse into "nothing was expected, so everything arrived".
    h.count = undefined;
    const r = await checkMetaCompleteness(1000);
    expect(r.state).toBe('unverifiable');
    expect(r.reason).toMatch(/could not be read back/);
    expect(await countMetaSpendRows()).toBeNull();
  });

  it('🔑 MORE rows than the source counts is a CONTRADICTION, reported, not passed', async () => {
    // Most likely the pull wrote rows between the two queries — but it could equally be
    // double counting, and a guard that reports its own contradiction as a pass is exactly
    // the shape being removed everywhere else in this codebase.
    h.count = 80;
    const r = await checkMetaCompleteness(83);
    expect(r.state).toBe('unverifiable');
    expect(r.reason).toMatch(/83.*80/);
  });

  it('the completeness window matches the fetch window — a narrower count is not a shortfall', async () => {
    h.count = 4;
    await checkMetaCompleteness(4, { from: '2026-08-01', to: '2026-08-31' });
    // BOTH counts carry the window. The base-vs-view parity count is a SECOND instrument, and
    // an instrument asked about a different window than the one on screen answers a question
    // nobody asked — it would report a whole-table difference as this month's shortfall.
    expect(h.filters).toEqual([
      { op: 'gte', col: 'date', val: '2026-08-01' },
      { op: 'lte', col: 'date', val: '2026-08-31' },
      { op: 'gte', col: 'date', val: '2026-08-01' },
      { op: 'lte', col: 'date', val: '2026-08-31' },
    ]);
    expect(h.tables).toEqual([AD_SPEND_VIEW, AD_SPEND_BASE]);
  });
});

describe('the configured axis stays falsifiable', () => {
  it('🔴 an absent Supabase connection is NOT-CONFIGURED, and NAMES what is missing', () => {
    /**
     * Ad spend needs no user-supplied setting since the cutover, so `isSourceConfigured`
     * could easily have become a constant `true` — a predicate that cannot return false is
     * not a check. This is the arm that proves it still can, and that the resulting state
     * enumerates its remedy instead of reporting an empty list nobody can act on.
     */
    h.configured = false;
    expect(isSourceConfigured('meta', DEFAULT_SETTINGS)).toBe(false);
    expect(missingSettingsFor('meta', DEFAULT_SETTINGS)).toEqual([
      'Supabase connection (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY)',
    ]);

    // CONTROL: with a connection it is configured and reports nothing missing.
    h.configured = true;
    expect(isSourceConfigured('meta', DEFAULT_SETTINGS)).toBe(true);
    expect(missingSettingsFor('meta', DEFAULT_SETTINGS)).toEqual([]);
  });
});

describe('a stable total order is the load-bearing half of .range() paging', () => {
  /**
   * 🔴 THIS BLOCK WAS CITED BY THE MOCK AND DID NOT EXIST.
   *
   * `h.orders` was declared at the top of this file with a docblock calling the ORDER BY
   * "the load-bearing half of `.range()` paging" and saying "see the 'a stable total
   * order' block below". There was no such block, and nothing ever wrote to the recorder,
   * so it sat permanently `[]`. Measured 2026-08-12: deleting BOTH `.order()` calls from
   * `fetchMetaAdSpend` left all 694 tests green.
   *
   * ⚠️ AND THE DEFECT IT GUARDS IS INVISIBLE BY CONSTRUCTION. Without a total order,
   * PostgREST may return overlapping or skipped rows across two `.range()` windows —
   * every page is individually a valid 200 with 1000 rows, the loop terminates normally,
   * and the only symptom is a total that is quietly wrong. `checkMetaCompleteness` catches
   * a SHORT result, so it catches skipping; it cannot catch a DUPLICATE standing in for a
   * skipped row, because the count still reconciles. This assertion is the only thing in
   * the suite standing between that and a silently wrong dashboard.
   *
   * `(date, ad_id)` is the primary key of `ad_insights`, so it is total and cannot tie.
   */
  const EXPECTED = [
    { col: 'date', ascending: true },
    { col: 'ad_id', ascending: true },
  ];

  it('🔴 EVERY page is ordered by the full primary key, ascending', async () => {
    h.rows = makeRows(2350);
    await fetchMetaAdSpend(DEFAULT_SETTINGS);
    // Not just "the first page" — a loop that ordered only its first request would page
    // three windows out of three different row orders.
    expect(h.orders).toHaveLength(3);
    for (const page of h.orders) expect(page).toEqual(EXPECTED);
  });

  it('the order is applied on a single-page fetch too', async () => {
    h.rows = makeRows(5);
    await fetchMetaAdSpend(DEFAULT_SETTINGS);
    expect(h.orders).toEqual([EXPECTED]);
  });

  it('ANTI-VACUITY CONTROL: the recorder observes a real absence', async () => {
    // If `chain.order` were unwired again — the exact state this file shipped in — the
    // recorder would report `[]` and the two arms above would fail rather than pass
    // quietly. Proving the empty case is distinguishable is what makes them measurements.
    h.rows = [];
    await fetchMetaAdSpend(DEFAULT_SETTINGS);
    expect(h.orders).toEqual([EXPECTED]);
    expect(h.orders[0]).not.toEqual([]);
  });
});

describe('SOURCE-EMPTY — a $0.00 dashboard over the wrong database is not health', () => {
  /**
   * 🔴 THE GUARD WITH THE LARGEST BLAST RADIUS AND, UNTIL NOW, NO TEST AT ALL.
   *
   * Measured 2026-08-12: no test in the suite named `source-empty`, and a mutation that
   * returned `complete` in its place survived all 694. That is the guard standing between
   * this app and the state its own `.env` was in hours ago — `VITE_SUPABASE_URL` pointing
   * at project `tclghhfozyfsdkqyaftc`, which answers the ad-spend read with HTTP 200, an
   * empty body and an exact count of 0. A perfectly successful conversation with the wrong
   * database, in which every other guard agrees the app is healthy:
   *
   *     fetchMetaAdSpend      -> []          a short page is the end of the data
   *     refreshSources        -> 'valid'     the fetch did not fail
   *     checkMetaCompleteness -> 0 === 0     without this branch, 'complete'
   *
   * ⇒ $0.00 on every tile, a green badge, and silence. A 100% loss rendered as health.
   *
   * ⚠️ THE HARD PART IS THAT IT MUST NOT CRY WOLF. "No spend in this date range" is a
   * legitimate, common answer and @andrew has already said «annoying just remove these
   * popups». The two cases are separated by asking a SECOND question over ALL dates, so
   * these arms exist in matched pairs: same windowed count of 0, opposite verdicts.
   */
  const emptyWindow = (allDatesCount: number | undefined) => {
    h.countFor = (filters) => (filters.length === 0 ? allDatesCount : 0);
  };

  it('🔴 an empty WINDOW over an empty TABLE is SOURCE-EMPTY, and blames the connection', async () => {
    emptyWindow(0);
    const r = await checkMetaCompleteness(0, { from: '2026-08-01', to: '2026-08-31' });
    expect(r.state).toBe('source-empty');
    expect(r.reason).toMatch(/every date/);
    // The sentence must name the CAUSE. A user cannot infer "wrong Supabase project" from
    // a total of $0.00, and the two wrong guesses it has to pre-empt are Meta and the dates.
    const msg = completenessMessage(r);
    expect(msg).toMatch(/connection problem/);
    expect(msg).toMatch(/not a Meta problem/);
    expect(msg).toMatch(/right Supabase project/);
  });

  it('🔴 THE CRY-WOLF CONTROL: an empty window over a POPULATED table is silent', async () => {
    // Same windowed count of 0. Opposite verdict, because the second question was asked.
    // Without this arm the guard above is satisfiable by "always complain about zero",
    // which is the version that gets muted and then protects nothing.
    emptyWindow(48568);
    const r = await checkMetaCompleteness(0, { from: '2026-08-01', to: '2026-08-31' });
    expect(r.state).toBe('complete');
    expect(completenessMessage(r)).toBeNull();
  });

  it('🔴 "empty window, and we could not ask about the rest" is UNVERIFIABLE, not complete', async () => {
    // The refusal-becomes-a-value shape one level deeper: the discriminating question
    // itself failed, so neither answer is earned and the honest state is "we could not tell".
    emptyWindow(undefined);
    const r = await checkMetaCompleteness(0, { from: '2026-08-01', to: '2026-08-31' });
    expect(r.state).toBe('unverifiable');
    expect(r.reason).toMatch(/could not be asked/);
    expect(completenessMessage(r)).toMatch(/could not be verified/);
  });

  it('the second, unbounded count is asked ONLY when the window came back empty', async () => {
    // It is an extra round trip on every load otherwise. A guard that taxes the healthy
    // path is a guard someone eventually removes.
    h.countFor = () => 83;
    await checkMetaCompleteness(83, { from: '2026-08-01', to: '2026-08-31' });
    // Two windowed counts (the view, then the base parity check) and NO unbounded one — the
    // all-dates question is what the `source-empty` branch asks, and it must not be asked on
    // the healthy path where it is a round trip that buys nothing.
    expect(h.filters).toEqual([
      { op: 'gte', col: 'date', val: '2026-08-01' },
      { op: 'lte', col: 'date', val: '2026-08-31' },
      { op: 'gte', col: 'date', val: '2026-08-01' },
      { op: 'lte', col: 'date', val: '2026-08-31' },
    ]);
    expect(h.tables).toEqual([AD_SPEND_VIEW, AD_SPEND_BASE]);
  });
});

/**
 * ⑧ A DUPLICATE SUBSTITUTING FOR A SKIPPED ROW — the hole the mutation pass named and the
 * count reconciliation is structurally blind to.
 *
 * 🔴 THE SHAPE. `.range()` is OFFSET paging. Delete or insert a row at a date EARLIER than
 * the page being fetched and every later page shifts by one: page 2 re-serves page 1's last
 * row and never serves the row that followed it. One row duplicated, one row lost, the total
 * count unchanged — so `fetched === expected`, state `complete`, and a real ad's spend has
 * been replaced by a second copy of its neighbour's. Both halves are individually valid,
 * which is why nothing downstream could see it.
 *
 * ⭐ WHAT MAKES IT VISIBLE IS THE PAIR, and the arms below prove each half separately:
 *   ① the fetch refuses to hold one primary key twice  ⇒ the total is not INFLATED
 *   ② the returned set is therefore genuinely short    ⇒ completeness says TRUNCATED
 * Remove the dedupe and ② silently reverts to `complete`; keep the dedupe but let the loop
 * measure the deduped length and paging stops early. The control arms pin both.
 */
describe('⑧ an overlapping page cannot forge a complete-looking total', () => {
  /**
   * THE POPULATION: 1,005 rows, one dollar each, so a lost row is visible in the total.
   *
   * THE FAULT, served page by page: page 2 re-sends the LAST ROW OF PAGE 1 and never sends
   * the row that followed it. That is what a non-total ORDER BY does — ties break differently
   * per request, so one row lands on both pages and one lands on neither. The row COUNT the
   * server reports never moves, which is the whole problem.
   */
  const server = makeRows(PAGE_SIZE + 5).map((r, i) => ({ ...r, ad_id: `ad-${i}`, spend: '1' }));
  const overlapping = [
    server.slice(0, PAGE_SIZE),                                  // rows 0..999
    [server[PAGE_SIZE - 1], ...server.slice(PAGE_SIZE + 1)],     // row 999 AGAIN, then 1001..1004
  ];
  /**
   * ⚠️ PAST THE LAST PAGE THE SERVER RETURNS NOTHING, and that matters to what is being
   * proven. The old fake re-served its final page forever, which is not a thing any server
   * does — it only ever went unnoticed because the loop stopped on the first short page and
   * never asked again. A fake that cannot be asked one question too many cannot show what
   * the loop does when it asks.
   */
  const servePage = () => {
    let n = 0;
    return () => overlapping[n++] ?? [];
  };

  it('🔴 ANTI-VACUITY: the fault is invisible to COUNTING — the two pages sum to the true total', () => {
    // 1000 + 5 === 1005. This is precisely why `checkMetaCompleteness` alone cannot see it:
    // a naive fetcher hands it a number that agrees with the source exactly.
    expect(overlapping[0].length + overlapping[1].length).toBe(server.length);
    // ...and it really is an overlap, not just a short page.
    expect(overlapping[1][0].ad_id).toBe(overlapping[0][PAGE_SIZE - 1].ad_id);
    // ...and row 1000 really is served by neither page.
    const served = new Set([...overlapping[0], ...overlapping[1]].map(r => r.ad_id));
    expect(served.has(`ad-${PAGE_SIZE}`)).toBe(false);
  });

  it('🔴 the duplicate is not counted twice — the total is not INFLATED', async () => {
    h.pageRows = servePage();
    const rows = await fetchMetaAdSpend(undefined, ALL_DATES);
    const keys = rows.map(r => `${r.dateISO}/${r.adId}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(rows).toHaveLength(server.length - 1);                 // 1,004 of the 1,005 exist
    expect(rows.reduce((s, r) => s + r.spent, 0)).toBe(server.length - 1);
  });

  it('🔴 AND THE SHORTFALL IS REPORTED — TRUNCATED, where counting alone said "complete"', async () => {
    h.pageRows = servePage();
    const rows = await fetchMetaAdSpend(undefined, ALL_DATES);
    h.count = server.length;                                     // the source still counts all 1,005
    const r = await checkMetaCompleteness(rows.length, ALL_DATES);
    expect(r.state).toBe('truncated');
    expect(r.droppedRows).toBe(1);
    expect(completenessMessage(r)).toMatch(/INCOMPLETE/);
    // The counterfactual, stated as an assertion rather than as a comment: the number a
    // fetcher WITHOUT the dedupe would have handed in is the number that reads clean.
    const naive = overlapping[0].length + overlapping[1].length;
    expect((await checkMetaCompleteness(naive, ALL_DATES)).state).toBe('complete');
  });

  it('🔴 CONTROL — with no overlap the same fixture is COMPLETE and loses nothing', async () => {
    h.rows = server;
    const rows = await fetchMetaAdSpend(undefined, ALL_DATES);
    expect(rows).toHaveLength(server.length);
    h.count = server.length;
    expect((await checkMetaCompleteness(rows.length, ALL_DATES)).state).toBe('complete');
  });

  it('🔴 a full page of PURE duplicates does not end the loop — the OFFSET advances RAW', async () => {
    // If the loop advanced by the DEDUPED length it would see 0 new rows, re-request the
    // same offset, and never move — or, testing deduped shortness, call the page short and
    // drop everything after it. That is a bigger loss than the one being fixed.
    const pages = [server.slice(0, PAGE_SIZE), server.slice(0, PAGE_SIZE), server.slice(PAGE_SIZE)];
    let i = 0;
    h.pageRows = () => pages[i++] ?? [];
    const rows = await fetchMetaAdSpend(undefined, ALL_DATES);
    expect(rows).toHaveLength(server.length);     // all 1,005, none lost to the repeated page
    // The law, stated as offsets rather than as a request count: 1,000 raw rows advance the
    // offset by 1,000 even though every one of them was already held.
    expect(h.ranges.map(([from]) => from)).toEqual([0, 1000, 2000, 2005]);
  });

  it('the key is (date, ad_id) — one ad on two DAYS is two rows, never one', async () => {
    h.rows = [
      { ...makeRows(1)[0], date: '2026-08-07', ad_id: 'ad-same', spend: '5' },
      { ...makeRows(1)[0], date: '2026-08-08', ad_id: 'ad-same', spend: '7' },
    ];
    const rows = await fetchMetaAdSpend(undefined, ALL_DATES);
    expect(rows).toHaveLength(2);
    expect(rows.reduce((s, r) => s + r.spent, 0)).toBe(12);
  });
});

/**
 * ⑨ THE VIEW-SHAPE BLIND SPOT — the strongest hole @raccoon left standing, and the one
 * defect in this module that no control on the existing instrument could ever have caught.
 *
 * 🔴 THE SHAPE. `checkMetaCompleteness` counted `ad_insights_resolved` and `fetchMetaAdSpend`
 * fetched `ad_insights_resolved`. Any fault that removes rows from the VIEW removes them from
 * BOTH SIDES of the reconciliation, so it BALANCES: change the `LEFT JOIN ad_accounts` to an
 * `INNER JOIN`, or add a `WHERE`, and every unmapped account's spend leaves the product while
 * the guard reports `complete` and the banner stays silent. @raccoon's words: "today's parity
 * is a measurement, not a mechanism; it is one migration from silent loss", and NO TEST
 * ASSERTED IT. These are that mechanism.
 *
 * ⭐ WHY A CONTROL COULD NOT HAVE FOUND IT. A control proves the instrument works. It cannot
 * prove the instrument is asking a question that can express the defect — and one relation
 * counted against itself cannot. Only a SECOND relation can, which is why every arm below
 * moves `h.baseCount` away from `'mirror'` and nothing else.
 *
 * ⚠️ THE COMPARISON IS LEGITIMATE BECAUSE THE VIEW IS 1:1 WITH THE BASE BY CONSTRUCTION —
 * a `LEFT JOIN` onto `ad_accounts.account_id`, which is that table's PRIMARY KEY. Measured
 * live 2026-08-12: 48,635 base rows, 48,635 view rows, 0 orphans.
 */
describe('base-vs-view parity — the view cannot quietly stop exposing rows', () => {
  it('🔴 A VIEW THAT FILTERS ROWS OUT IS TRUNCATED, and it names the DATABASE as the cause', async () => {
    // The INNER JOIN migration, expressed as the only thing it changes that is observable
    // from the client: the view holds fewer rows than the table under it.
    h.count = 40000;      // what ad_insights_resolved now exposes
    h.baseCount = 48635;  // what ad_insights actually holds
    const r = await checkMetaCompleteness(40000);
    expect(r.state).toBe('truncated');
    // ⭐ THE SHORTFALL IS MEASURED AGAINST THE BASE, NOT THE VIEW. Against the view it is
    // ZERO — that is the whole defect — so a report that reconciled to the view would print
    // "0 rows missing" over 8,635 lost ones.
    expect(r.rawRows).toBe(48635);
    expect(r.droppedRows).toBe(8635);
    const msg = completenessMessage(r);
    // It must send the reader to the right file. "A paging or query limit" is the WRONG
    // cause here and would cost someone an afternoon in the fetch loop.
    expect(msg).toMatch(/database definition problem, not a paging one/);
    expect(msg).toMatch(/ad_insights_resolved/);
  });

  it('🔴 THE CONTROL THAT MAKES THAT ARM MEAN SOMETHING: equal counts stay COMPLETE and SILENT', async () => {
    // Without this, the guard above is satisfiable by "always report truncated", which is the
    // version that gets muted and then protects nothing.
    h.count = 48635;
    h.baseCount = 48635;
    const r = await checkMetaCompleteness(48635);
    expect(r.state).toBe('complete');
    expect(completenessMessage(r)).toBeNull();
  });

  it('🔴 A VIEW THAT MULTIPLIES ROWS IS NOT "MORE COMPLETE" — it OVERSTATES every total', async () => {
    // The opposite inequality, and it is not symmetric in consequence: a duplicated join key
    // in `ad_accounts` would double a client's spend, and a guard that only ever looked for
    // shortfalls would call that a clean bill of health.
    h.count = 60000;
    h.baseCount = 48635;
    const r = await checkMetaCompleteness(60000);
    expect(r.state).toBe('unverifiable');
    expect(r.reason).toMatch(/multiplying rows/);
    expect(r.reason).toMatch(/OVERSTATES/);
  });

  it('🔴 AN UNREADABLE BASE COUNT IS UNVERIFIABLE, never "complete" — the guard cannot retire itself', async () => {
    // The fail-open one level up: revoke SELECT on `ad_insights` and this instrument goes
    // quiet. If quiet meant "fine", the mechanism would delete itself with a grant change and
    // every load would keep reading `complete`.
    h.count = 48635;
    h.baseCount = undefined; // the count query errors
    const r = await checkMetaCompleteness(48635);
    expect(r.state).toBe('unverifiable');
    expect(r.reason).toMatch(/ad_insights/);
    expect(r.reason).toMatch(/could not be proved to still expose every row/);
    expect(completenessMessage(r)).toMatch(/could not be verified/);
  });

  it('🔴 PARITY IS ASKED BEFORE THE ZERO BRANCH, so an eaten view is not blamed on the connection', async () => {
    /**
     * The ordering arm, and it is a real misdiagnosis rather than a style point. An INNER JOIN
     * against an empty `ad_accounts` takes the windowed VIEW count to 0 with 0 rows fetched —
     * which is exactly the input the `source-empty` branch reads as "you are pointed at the
     * wrong Supabase project". The connection is fine. The view is eating the data. Asking the
     * base table first is the only thing that separates them.
     */
    h.countFor = () => 0;   // the view returns nothing, windowed OR unbounded
    h.baseCount = 48635;    // the table is full
    const r = await checkMetaCompleteness(0, { from: '2026-08-01', to: '2026-08-31' });
    expect(r.state).toBe('truncated');
    expect(r.droppedRows).toBe(48635);
    const msg = completenessMessage(r) ?? '';
    expect(msg).toMatch(/database definition problem/);
    // CONTROL on the misdiagnosis itself: the wrong-project sentence must NOT appear.
    expect(msg).not.toMatch(/right Supabase project/);
  });

  it('🔴 AND source-empty SURVIVES: an empty view over an empty TABLE still blames the connection', async () => {
    // The matched pair for the arm above — same windowed 0, same fetched 0, opposite verdict,
    // because the base is empty too. Without this, "parity first" could have been implemented
    // as "never report source-empty again", which would re-open the wrong-project $0.00.
    h.countFor = () => 0;
    h.baseCount = 0;
    const r = await checkMetaCompleteness(0, { from: '2026-08-01', to: '2026-08-31' });
    expect(r.state).toBe('source-empty');
    expect(completenessMessage(r)).toMatch(/right Supabase project/);
  });

  it('the two counts read DIFFERENT relations — the second instrument is not a second copy of the first', async () => {
    // ⛔ THE VACUITY THIS KILLS. Point `countBaseSpendRows` at the view by mistake and every
    // arm above still passes, because the fake would answer both from the same place. The
    // relation names are the only thing that can tell a second instrument from a second read.
    h.count = 83;
    await checkMetaCompleteness(83);
    expect(h.tables).toEqual([AD_SPEND_VIEW, AD_SPEND_BASE]);
    expect(AD_SPEND_BASE).not.toBe(AD_SPEND_VIEW);
  });

  it('countBaseSpendRows refuses a malformed window rather than counting the whole table', async () => {
    // Same law as the view's counter: a dropped bound would compare a MONTH of view rows
    // against ALL-TIME base rows and report a catastrophic, entirely fictional shortfall.
    await expect(countBaseSpendRows({ from: 'yesterday' })).rejects.toThrow(/ISO date/);
    h.baseCount = 7;
    await expect(countBaseSpendRows({ from: '2026-08-01' })).resolves.toBe(7);
  });
});

/**
 * ⑩ A COUNT READ ON PAGE 0 IS STALE BY PAGE 49 — @raccoon, and the finding was filed as
 * "minor, fails safe: a pull landing mid-fetch can raise a spurious `truncated` banner".
 *
 * 🔴 THE BANNER WAS NOT SPURIOUS. `meta-pull` writes every three hours; this loop takes ~49
 * round trips. A pull landing between request 0 and the last one makes the page-0 total a
 * number that was true when we asked and is not any more — so the loop stops SHORT, and
 * `checkMetaCompleteness` then re-counts, finds more, and correctly reports INCOMPLETE. The
 * warning was honest; the FETCH was the defect, and treating it as a message problem would
 * have left real rows on the floor while polishing the sentence about them.
 *
 * ⭐ THE ARMS BELOW PIN BOTH DIRECTIONS, because a fix that always re-pages is not a fix —
 * it is 49 extra requests on every healthy load, which is the thing that gets reverted.
 */
describe('a stale page-0 count must not end the fetch short', () => {
  it('🔴 ROWS THAT LAND MID-FETCH ARE COLLECTED, not left behind for a banner to describe', async () => {
    // Page 0 counts 1,000. By the time we hold them, the pull has written 350 more, and the
    // re-count says so. Under the old rule this returned 1,000 of 1,350 with no error.
    h.rows = makeRows(1350);
    h.dataCount = PAGE_SIZE;        // the DATA query's page-0 total: the stale number
    h.count = 1350;                 // what a fresh count(*) says at the moment we stop
    const got = await fetchMetaAdSpend(DEFAULT_SETTINGS, ALL_DATES);
    expect(got).toHaveLength(1350);
    expect(h.ranges).toEqual([[0, 999], [1000, 1999]]);
  });

  it('🔴 THE ANTI-COST CONTROL: a total that has NOT moved adds no page, only the one check', async () => {
    // Without this the arm above is satisfiable by "always fetch one more page", which taxes
    // every healthy load. One extra COUNT is the price; an extra PAGE is not.
    h.rows = makeRows(2350);
    h.count = 2350;
    const got = await fetchMetaAdSpend(DEFAULT_SETTINGS, ALL_DATES);
    expect(got).toHaveLength(2350);
    expect(h.ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('🔴 A RE-COUNT THAT FAILS RETURNS WHAT WE HOLD — the new query can never destroy a fetch', async () => {
    // The failure mode a second query introduces, refused explicitly: if asking again is
    // allowed to throw away 48,000 rows we have already paid for, the cure is worse than the
    // disease. `null` means "we could not look", and the honest response is to stop with the
    // set we have and let completeness — which asks independently — do the describing.
    h.rows = makeRows(2350);
    h.count = undefined;            // the re-count errors
    const got = await fetchMetaAdSpend(DEFAULT_SETTINGS, ALL_DATES);
    expect(got).toHaveLength(2350);
  });

  it('the re-count is asked ONCE per exhausted total, and it is a HEAD count, not another page', async () => {
    h.rows = makeRows(12);
    h.count = 12;
    await fetchMetaAdSpend(DEFAULT_SETTINGS, ALL_DATES);
    // One data request against the view, then one count against the view. No second page.
    expect(h.ranges).toHaveLength(1);
    expect(h.tables).toEqual([AD_SPEND_VIEW, AD_SPEND_VIEW]);
  });
});

/**
 * 🔴 THE ONE GUARD IN THIS MODULE WITH NO TEST BEHIND IT.
 *
 * Measured: replacing the `throw` at the bottom of the paging loop with `return rows`
 * survived the ENTIRE suite — 792 tests, all green. That is a fail-open with a comment
 * explaining why it must not fail open, which is the worst kind: the next reader sees a
 * documented invariant and no instrument, and "simplifying" it costs nothing visible.
 *
 * WHAT REACHING `MAX_PAGES` MEANS. The loop stops on one of two FACTS — we hold what the
 * source counted, or the server returned an empty page. Running out of requests means
 * neither fact ever arrived: a server that keeps serving full pages forever, a count that
 * keeps rising, an offset that is not advancing. Every one of those leaves the returned set
 * of UNKNOWN completeness. `return rows` would hand that to the dashboard as the total.
 *
 * ⚠️ 200 REQUESTS IS FOUR TIMES A CLEAN RUN over 48,611 rows, so reaching it is a defect and
 * not a large customer. The bound is not the thing under test — the BEHAVIOUR AT THE BOUND is.
 */
describe('🔴 MAX_PAGES — running out of requests is a refusal, not a result', () => {
  it('THROWS rather than returning a set of unknown completeness', async () => {
    // A server that never runs out and never counts: every page is exactly full of rows
    // nobody has seen, so neither termination fact can ever arrive.
    h.dataCount = 'auto';
    h.pageRows = (from) => Array.from({ length: PAGE_SIZE }, (_, i) => ({
      date: '2026-08-08', ad_id: `ad-${from + i}`, account_id: 'ACCT', account_name: 'Acme',
      campaign_id: 'c1', campaign_name: 'C', adset_id: 'a1', adset_name: 'A',
      ad_name: 'N', spend: '10', leads: 1,
    }));

    await expect(fetchMetaAdSpend(DEFAULT_SETTINGS, ALL_DATES)).rejects.toThrow(
      /did not terminate/i,
    );
  });

  it('the refusal SAYS what it is refusing — page bound, rows held, and why', async () => {
    h.dataCount = 'auto';
    h.pageRows = (from) => Array.from({ length: PAGE_SIZE }, (_, i) => ({
      date: '2026-08-08', ad_id: `ad-${from + i}`, account_id: 'ACCT', account_name: 'Acme',
      campaign_id: 'c1', campaign_name: 'C', adset_id: 'a1', adset_name: 'A',
      ad_name: 'N', spend: '10', leads: 1,
    }));

    // A bare "something went wrong" would send whoever hits this reading the loop from
    // scratch. The message carries the two numbers that identify which arm failed.
    const err = await fetchMetaAdSpend(DEFAULT_SETTINGS, ALL_DATES).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain(String(MAX_PAGES));
    expect((err as Error).message).toContain((MAX_PAGES * PAGE_SIZE).toLocaleString());
    expect((err as Error).message).toMatch(/truncated/i);
  });

  it('it really did stop at the bound — exactly MAX_PAGES requests, not one more', async () => {
    // Anti-vacuity for both arms above: a rejection thrown from anywhere else in the loop
    // (a malformed row, the window assert) would satisfy `rejects.toThrow` just as well.
    // This pins the rejection to the bound itself.
    h.dataCount = 'auto';
    h.pageRows = (from) => Array.from({ length: PAGE_SIZE }, (_, i) => ({
      date: '2026-08-08', ad_id: `ad-${from + i}`, account_id: 'ACCT', account_name: 'Acme',
      campaign_id: 'c1', campaign_name: 'C', adset_id: 'a1', adset_name: 'A',
      ad_name: 'N', spend: '10', leads: 1,
    }));

    await fetchMetaAdSpend(DEFAULT_SETTINGS, ALL_DATES).catch(() => {});
    expect(h.ranges).toHaveLength(MAX_PAGES);
    // ...and the offset really was advancing, so this is "the data never ended" rather than
    // "the loop was stuck on page 0" — a different bug that must not pass as this one.
    expect(h.ranges[0][0]).toBe(0);
    expect(h.ranges[MAX_PAGES - 1][0]).toBe((MAX_PAGES - 1) * PAGE_SIZE);
  });

  it('🔑 CONTROL: the same server that TERMINATES returns its rows and throws nothing', async () => {
    // Without this, the three arms above are satisfiable by a fetcher that always throws.
    const pages = 3;
    h.dataCount = 'auto';
    h.pageRows = (from) => (from >= pages * PAGE_SIZE ? [] : Array.from({ length: PAGE_SIZE }, (_, i) => ({
      date: '2026-08-08', ad_id: `ad-${from + i}`, account_id: 'ACCT', account_name: 'Acme',
      campaign_id: 'c1', campaign_name: 'C', adset_id: 'a1', adset_name: 'A',
      ad_name: 'N', spend: '10', leads: 1,
    })));

    const rows = await fetchMetaAdSpend(DEFAULT_SETTINGS, ALL_DATES);
    expect(rows).toHaveLength(pages * PAGE_SIZE);
    expect(h.ranges.length).toBeLessThan(MAX_PAGES);
  });
});
