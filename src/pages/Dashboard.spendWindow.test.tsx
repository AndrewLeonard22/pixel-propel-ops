import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { makeSettings, makeAdSpendRow } from '@/test/factories';
import type { SourceKey, SourceStatus } from '@/lib/sourceStatus';

/**
 * 🔒 THE DATE RANGE REACHES SQL — THE WIRING ARM.
 *
 * ⚠️ WHY A SEPARATE FILE, AND WHY IT IS A *WIRING* ARM RATHER THAN A PREDICATE ARM.
 * `SourceStatusBanner.origin.test.tsx` records the lesson at its own line 185: all 21
 * sheet-completeness assertions passed with the banner COMPLETELY DISCONNECTED, because
 * every one of them tested the predicate and none tested that anything called it. The
 * same trap is open here. `metaAdSpend.test.ts` proves `fetchMetaAdSpend` sends `gte`/`lte`
 * to the server; NOTHING there proves the Dashboard's date picker ever reaches it. Without
 * this file the SQL filter could be perfect and permanently unused — the app would download
 * all 48,000 rows for every view and still pass every other test in the suite.
 */

const useDataMock = vi.hoisted(() => vi.fn());
const setSpendWindow = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useData', () => ({ useData: useDataMock }));

const { default: Dashboard } = await import('./Dashboard');
const { ALL_DATES } = await import('@/lib/metaAdSpend');

const status = (over: Partial<SourceStatus> = {}): SourceStatus =>
  ({ label: 'src', state: 'valid', error: null, missingSettings: [], configured: true, ...over }) as SourceStatus;

const SETTINGS = makeSettings();
const SPEND = [makeAdSpendRow({ accountName: 'Acme', accountId: 'ACCT-1', spent: 500, leads: 20 })];

function mount() {
  useDataMock.mockReturnValue({
    accounts: [], adSpend: SPEND, appointments: [], unmatchedAppointments: [],
    settings: SETTINGS, loading: false, error: null, lastUpdated: null,
    configured: true, settingsLoaded: true, settingsOrigin: 'database' as const, settingsDetail: null,
    exclusions: { state: 'none-configured', configuredCount: 0, matchedCount: 0, unfilteredSpend: 0, affectedAccounts: [] },
    honestNumbers: { hasWarnings: false, messages: [], exclusion: {}, fabricatedRateCount: 0, allRatesFabricated: false },
    sources: { meta: status(), airtable: status() } as Record<SourceKey, SourceStatus>,
    refresh: async () => {}, setSettings: () => {},
    spendWindow: ALL_DATES, setSpendWindow,
  });
  return render(<Dashboard />);
}

/** Drive the actual control a user clicks, not a state setter. */
function selectPreset(label: string) {
  fireEvent.click(screen.getByRole('button', { name: /all time|date|range/i }));
  fireEvent.click(screen.getByText(label));
}

beforeEach(() => { useDataMock.mockReset(); setSpendWindow.mockReset(); });

describe('the date picker narrows the QUERY, not just the rows already downloaded', () => {
  it('🔴 mounting at All Time asks for an unbounded window — "everything" is a real answer', () => {
    mount();
    expect(setSpendWindow).toHaveBeenCalled();
    // Both ends undefined: no WHERE clause, and the fetcher pages rather than truncating.
    expect(setSpendWindow.mock.calls[0][0]).toEqual({ from: undefined, to: undefined });
  });

  it('🔴 THE POINT OF THE MIGRATION: picking a preset pushes ISO bounds down to SQL', async () => {
    mount();
    setSpendWindow.mockClear();
    selectPreset('Today');

    await waitFor(() => expect(setSpendWindow).toHaveBeenCalled());
    const w = setSpendWindow.mock.calls.at(-1)![0];
    // ISO `YYYY-MM-DD`, which is what `ad_insights.date` compares against. Anything else is
    // refused by `assertWindow` rather than silently widening the query.
    expect(w.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(w.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // "Today" is one calendar day, so both bounds are the same day.
    expect(w.from).toBe(w.to);
  });

  it('🔑 the bounds are the LOCAL calendar day, never a UTC conversion', async () => {
    /**
     * ⚠️ THE BUG THIS EXISTS FOR. `ad_insights.date` is a calendar date with no timezone,
     * and the picker builds its Dates from LOCAL midnight. Converting through
     * `toISOString()` shifts the day backwards for every user west of Greenwich, so the
     * start of a month becomes the last day of the previous month and the query returns a
     * window nobody asked for — with a total that is internally consistent and wrong.
     */
    mount();
    setSpendWindow.mockClear();
    selectPreset('Today');

    await waitFor(() => expect(setSpendWindow).toHaveBeenCalled());
    const now = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const localToday = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
    expect(setSpendWindow.mock.calls.at(-1)![0].from).toBe(localToday);
  });

  it('🔴 ANTI-VACUITY CONTROL: an unchanged range does not restart the query', () => {
    /**
     * Without this the wiring is satisfiable by calling the setter on every render, which
     * would start a fresh 48,000-row query several times per interaction — a "fix" that is
     * worse than the browser-side filter it replaced. The de-duplication lives in
     * `setSpendWindow` itself; here we prove the page does not fire it on re-render.
     */
    const { rerender } = mount();
    const before = setSpendWindow.mock.calls.length;
    rerender(<Dashboard />);
    expect(setSpendWindow.mock.calls.length).toBe(before);
  });
});
