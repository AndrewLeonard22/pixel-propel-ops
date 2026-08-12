import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { makeSettings, makeAdSpendRow } from '@/test/factories';
import { completenessMessage, ALL_DATES, type CompletenessReport } from '@/lib/metaAdSpend';

/**
 * 🔴 THE REPLACEMENT FOR A GUARD THE CUTOVER DELETED AND DID NOT REBUILD.
 *
 * `src/hooks/useData.completeness.test.tsx` existed for exactly one reason: to prove the
 * completeness detector's answer REACHES THE SCREEN. It was deleted with the sheet path —
 * correctly, it mocked `@/lib/sheetCompleteness`, which no longer exists — and the Supabase
 * detector shipped WITHOUT that arm. Measured on this tree before this file existed:
 *
 *     replace `.then(setCompleteness)` with `.then(() => {})`  ->  739/739 GREEN 🔴
 *
 * ⚠️ WHY THAT IS THE WHOLE BALLGAME AND NOT A TIDINESS COMPLAINT. `checkMetaCompleteness`
 * is thoroughly tested (three separate mutants of its logic all go red) and
 * `completenessMessage` is tested, and NEITHER can tell whether the answer is delivered.
 * With the wire cut, `completeness` stays `NOT_CHECKED` forever — whose message is
 * deliberately `null` — so the banner is not merely wrong, it is SILENT. The two states it
 * exists to announce are:
 *
 *   truncated     PostgREST returned a page and stopped; totals are understated
 *   source-empty  this build is talking to a database with no ad spend in it at all
 *
 * The second is the one that renders $0.00 on every tile with a green badge. Both would be
 * disarmed by deleting eleven characters, and the suite would applaud.
 *
 * ⭐ THE SHAPE, NAMED SO IT IS NOT REDISCOVERED A EIGHTH TIME: a correct value with no
 * consumer. The deleted file's own docblock counted six instances on this branch, every one
 * found by sabotage rather than by review. This is the seventh.
 */

const checkMock = vi.hoisted(() => vi.fn());
const feed = vi.hoisted(() => ({ rows: [] as unknown[], windows: [] as unknown[] }));

vi.mock('@/lib/metaAdSpend', async () => {
  const actual = await vi.importActual<typeof import('@/lib/metaAdSpend')>('@/lib/metaAdSpend');
  return {
    ...actual,
    fetchMetaAdSpend: async (_s: unknown, w: unknown) => { feed.windows.push(w); return feed.rows; },
    checkMetaCompleteness: checkMock,
  };
});

vi.mock('@/lib/dataService', async () => {
  const actual = await vi.importActual<typeof import('@/lib/dataService')>('@/lib/dataService');
  return { ...actual, fetchAirtableData: async () => ({ records: [], fields: [] }) };
});

const SETTINGS = makeSettings();
vi.mock('@/lib/config', async () => {
  const actual = await vi.importActual<typeof import('@/lib/config')>('@/lib/config');
  return {
    ...actual,
    loadSettings: () => ({ ...actual.DEFAULT_SETTINGS, ...SETTINGS }),
    loadSettingsWithSource: async () => ({ settings: { ...actual.DEFAULT_SETTINGS, ...SETTINGS }, origin: 'database' as const, detail: null }),
    loadAccountMappings: () => [],
    loadAccountMappingsAsync: async () => [],
  };
});

const { DataProvider, useData } = await import('./useData');

/** Renders the completeness report AS THE APP HOLDS IT, plus the sentence it produces. */
function Probe() {
  const { completeness, adSpend } = useData();
  return (
    <div>
      <span data-testid="rows">{adSpend.length}</span>
      <span data-testid="state">{completeness.state}</span>
      <span data-testid="dropped">{String(completeness.droppedRows)}</span>
      <span data-testid="raw">{String(completeness.rawRows)}</span>
      <span data-testid="derived">{String(completeness.derivedRows)}</span>
      <span data-testid="message">{completenessMessage(completeness) ?? '(silent)'}</span>
    </div>
  );
}

const report = (over: Partial<CompletenessReport>): CompletenessReport => ({
  state: 'complete', rawRows: 1, derivedRows: 1, droppedRows: 0, reason: null, ...over,
});

beforeEach(() => {
  checkMock.mockReset();
  feed.rows = Array.from({ length: 3 }, () => makeAdSpendRow({ accountName: 'Acme', spent: 10 }));
  feed.windows = [];
  localStorage.clear();
});

describe('useData — the completeness verdict must REACH the context', () => {
  it('delivers a TRUNCATED report, so the understated-totals banner can fire', async () => {
    checkMock.mockResolvedValue(report({ state: 'truncated', rawRows: 48611, derivedRows: 1000, droppedRows: 47611 }));
    const r = render(<DataProvider><Probe /></DataProvider>);

    await waitFor(() => expect(r.getByTestId('state').textContent).toBe('truncated'));
    expect(r.getByTestId('dropped').textContent).toBe('47611');
    expect(r.getByTestId('raw').textContent).toBe('48611');
    // The sentence a user would actually read, not merely the state behind it.
    expect(r.getByTestId('message').textContent).toContain('47,611');
    expect(r.getByTestId('message').textContent).toContain('INCOMPLETE');
  });

  it('delivers SOURCE-EMPTY, the state that catches a build wired to the wrong project', async () => {
    checkMock.mockResolvedValue(report({ state: 'source-empty', rawRows: 0, derivedRows: 0, reason: 'the ad spend table is empty for every date, not just this range' }));
    const r = render(<DataProvider><Probe /></DataProvider>);

    await waitFor(() => expect(r.getByTestId('state').textContent).toBe('source-empty'));
    expect(r.getByTestId('message').textContent).toContain('connection problem');
  });

  it('delivers UNVERIFIABLE rather than leaving the default in place', async () => {
    checkMock.mockResolvedValue(report({ state: 'unverifiable', rawRows: null, derivedRows: 3, reason: 'the row count could not be read back from Supabase' }));
    const r = render(<DataProvider><Probe /></DataProvider>);

    // ⚠️ THE WAIT IS ON THE MESSAGE, NOT THE STATE, AND THAT IS THE WHOLE POINT OF THIS ARM.
    // `NOT_CHECKED` is ALSO 'unverifiable', so a `waitFor` on the state resolves against the
    // DEFAULT on the very first render and the assertion below then reads the default too —
    // green with the wire cut. Only the reason distinguishes "we asked and could not tell"
    // from "we never asked". (Measured: written the other way round, this test passed
    // against a `.then(() => {})` mutant.)
    await waitFor(() => expect(r.getByTestId('message').textContent).toContain('could not be read back'));
    expect(r.getByTestId('state').textContent).toBe('unverifiable');
  });

  it('probes with the number of rows it actually fetched, not a constant', async () => {
    const N = 7;
    feed.rows = Array.from({ length: N }, () => makeAdSpendRow({ accountName: 'Acme', spent: 1 }));
    checkMock.mockResolvedValue(report({}));
    const r = render(<DataProvider><Probe /></DataProvider>);

    // ⚠️ Asserted over ALL calls rather than `calls[0]`: a provider mounted by an earlier
    // test can still have a refresh in the air, and its call would land at index 0 here.
    // A probe wired to a constant never produces this value at any index.
    await waitFor(() => expect(checkMock.mock.calls.some(c => c[0] === N)).toBe(true));
    // Cross-checked against what the app is actually computing totals from, so the two
    // cannot drift into agreeing on a number neither of them holds.
    expect(r.getByTestId('rows').textContent).toBe(String(N));
  });

  /**
   * 🔴 THE PROBE MUST COUNT THE SAME WINDOW THE FETCH ASKED FOR, and nothing was pinning it.
   *
   * Mutation-tested and it SURVIVED the whole suite: `checkMetaCompleteness(n, fetchedWindow)`
   * -> `checkMetaCompleteness(n, ALL_DATES)` was green. The consequence is not subtle. Narrow
   * the dashboard to July 2026: the fetch returns 2,786 rows and the count answers for all
   * 48,611, so `fetchedRows < expected` and the banner announces "45,825 of 48,611 rows in
   * this date range were not loaded" — on EVERY narrowed range, forever, over totals that are
   * perfectly correct.
   *
   * ⚠️ THAT IS NOT "ERRS ON THE SAFE SIDE". This banner is the ONLY thing standing between the
   * user and a silently truncated total, and a banner that fires on every correct answer is
   * one people stop reading — @andrew, on this exact class of popup: «annoying just remove
   * these popups». A guard that cries wolf gets removed, and then the real one is gone too.
   */
  it('🔴 counts the window the fetch actually asked for, not all of time', async () => {
    const WINDOW = { from: '2026-07-01', to: '2026-07-31' };
    checkMock.mockResolvedValue(report({}));

    function Narrow() {
      const { setSpendWindow } = useData();
      // eslint-disable-next-line react-hooks/exhaustive-deps
      React.useEffect(() => { setSpendWindow(WINDOW); }, []);
      return null;
    }
    render(<DataProvider><Narrow /><Probe /></DataProvider>);

    await waitFor(() => expect(feed.windows.some(w => JSON.stringify(w) === JSON.stringify(WINDOW))).toBe(true));
    // The pairing is the assertion: the probe was handed THE SAME window, not a wider one.
    await waitFor(() =>
      expect(checkMock.mock.calls.some(c => JSON.stringify(c[1]) === JSON.stringify(WINDOW))).toBe(true));

    // 🔑 ANTI-VACUITY, and it is the assertion that makes the arm above mean anything.
    // `ALL_DATES` is `{}`, so if it stringified the same as WINDOW the pairing above would
    // hold against the very mutant this test exists to exclude. Stated rather than assumed.
    expect(JSON.stringify(ALL_DATES)).not.toBe(JSON.stringify(WINDOW));
    // The initial mount legitimately probes ALL_DATES — that IS the window it fetched. What
    // must never exist is a NARROWED fetch answered by an ALL_DATES count, and the pairing
    // above is what excludes it. (Mutation-tested: `checkMetaCompleteness(n, ALL_DATES)`
    // turns this RED, and it was GREEN across the whole suite before this arm existed.)
    expect(checkMock.mock.calls.some(c => JSON.stringify(c[1]) === JSON.stringify(WINDOW))).toBe(true);
  });

  it('a probe that never resolves leaves the honest default, never a clean bill of health', async () => {
    checkMock.mockReturnValue(new Promise(() => {}));
    const r = render(<DataProvider><Probe /></DataProvider>);

    await waitFor(() => expect(checkMock).toHaveBeenCalled());
    // 'unverifiable' + the silent default reason. NOT 'complete'.
    expect(r.getByTestId('state').textContent).toBe('unverifiable');
    expect(r.getByTestId('message').textContent).toBe('(silent)');
  });

  it('a probe that REJECTS cannot take the numbers down with it', async () => {
    checkMock.mockRejectedValue(new Error('count exploded'));
    feed.rows = Array.from({ length: 5 }, () => makeAdSpendRow({ accountName: 'Acme', spent: 2 }));
    const r = render(<DataProvider><Probe /></DataProvider>);

    await waitFor(() => expect(checkMock).toHaveBeenCalled());
    // The report describes the numbers; it must never be able to remove them.
    expect(r.getByTestId('state').textContent).toBe('unverifiable');
  });
});
