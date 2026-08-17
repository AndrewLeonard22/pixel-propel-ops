import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { makeSettings, makeAdSpendRow } from '@/test/factories';
import type { SourceKey, SourceStatus } from '@/lib/sourceStatus';

/**
 * 🔒 THE AD-SPEND QUERY STAYS UNBOUNDED — AND THIS FILE IS THE REASON IT IS ALLOWED TO BE.
 *
 * ⚠️ THIS FILE USED TO ASSERT THE OPPOSITE, and it was right to at the time: pushing the date
 * range into SQL is the better design, it is why `ad_insights` replaced a CSV, and the
 * machinery is built, tested and KEPT (`SpendWindow`, `assertWindow`, the `gte`/`lte` in
 * `fetchMetaAdSpend`, the window arm of the refresh gate). It was switched off on 2026-08-17
 * because it is not correct YET, and a law that survives the change it describes instructs the
 * next reader to re-break the product.
 *
 * 🔴 WHAT NARROWING COSTS, measured through the app's own path
 * (`scripts/window-starves-attribution.mts`, live data, same anon key the browser compiles):
 *
 *     ALL_DATES      49,070 spend rows   52 accounts   UNMATCHED APPTS   57  (3 clients)
 *     one day             84 spend rows   21 accounts   UNMATCHED APPTS  127  (10 clients)
 *
 * `buildAccountSummaries` builds `accountMap` and `campaignIdToAccount` FROM THE ADSPEND ROWS
 * IT IS HANDED, and drops any appointment whose account is missing from that map. Appointments
 * are all-time. So narrowing the spend narrows the ATTRIBUTION UNIVERSE with it, and 70
 * appointments belonging to clients who merely did not spend today fell into the unmatched
 * bucket. Every number involved is correct; the JOIN is what breaks.
 *
 * ⭐ AND IT WAS MASKED BY A SECOND BUG. Until 2026-08-17 the refresh gate rejected every
 * narrowed refresh as a "collapse" (it compared row counts across different windows), so
 * `adSpend` silently stayed at ALL_DATES. Fixing that gate correctly is what exposed this.
 * Two defects had been cancelling out, and the suite was green through both.
 *
 * ⇒ TO RE-ENABLE: give `buildAccountSummaries` an all-time account and campaign→account
 * universe, then restore the narrowing and flip these assertions back. The starvation arm at
 * the bottom is what will tell you whether you actually fixed it.
 */

const useDataMock = vi.hoisted(() => vi.fn());
const setSpendWindow = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useData', () => ({ useData: useDataMock }));

const { default: Dashboard } = await import('./Dashboard');
const { ALL_DATES } = await import('@/lib/metaAdSpend');
const { buildAccountSummaries } = await import('@/lib/dataService');

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

describe('the ad-spend query stays unbounded while attribution depends on its rows', () => {
  it('🔴 mounting asks for an UNBOUNDED window — "everything" is a real answer', () => {
    mount();
    expect(setSpendWindow).toHaveBeenCalled();
    // Both ends undefined: no WHERE clause, and the fetcher pages rather than truncating.
    expect(setSpendWindow.mock.calls[0][0]).toEqual(ALL_DATES);
  });

  it('🔴 THE REGRESSION GUARD: picking a preset must NOT narrow the query', async () => {
    /**
     * This is the arm that would have caught 2026-08-17 before @andrew saw it. Restoring
     * `setSpendWindow({from, to})` here turns this RED, and it must stay red until
     * `buildAccountSummaries` no longer takes its account universe from the windowed rows.
     */
    mount();
    setSpendWindow.mockClear();
    selectPreset('Today');

    // The page still re-renders and may re-assert the window; whatever it sends must be
    // unbounded. A bounded window is the defect, whichever call carries it.
    await waitFor(() => expect(screen.getByText(/today/i)).toBeTruthy());
    for (const [w] of setSpendWindow.mock.calls) {
      expect(w.from).toBeUndefined();
      expect(w.to).toBeUndefined();
    }
  });

  it('🔴 ANTI-VACUITY CONTROL: an unchanged range does not restart the query', () => {
    /**
     * Without this the wiring is satisfiable by calling the setter on every render, which
     * would start a fresh 49,000-row query several times per interaction.
     */
    const { rerender } = mount();
    const before = setSpendWindow.mock.calls.length;
    rerender(<Dashboard />);
    expect(setSpendWindow.mock.calls.length).toBe(before);
  });
});

/**
 * ⭐ THE MECHANISM ITSELF, pinned as a unit so the reason above cannot rot into folklore.
 * This is what makes the narrowing unsafe; when it stops being true, the narrowing can return.
 */
describe('why: a narrowed spend set starves appointment attribution', () => {
  const APPT = {
    client: 'Acme', campaignId: 'CAMP-1', date: '2026-08-01', dateISO: '2026-08-01',
  } as never;

  const spendFor = (campaignId: string) =>
    [makeAdSpendRow({ accountName: 'Acme', accountId: 'ACCT-1', campaignId, spent: 10, leads: 1 })];

  it('an appointment whose account HAS rows in the set is attributed', () => {
    const r = buildAccountSummaries(spendFor('CAMP-1'), [APPT], SETTINGS);
    expect(r.unmatchedAppointments).toHaveLength(0);
  });

  it('🔴 the SAME appointment goes UNMATCHED when its account is absent from the set', () => {
    // Exactly what a date window does: the account still exists and still owns the booking,
    // it simply has no row inside the window. 57 -> 127 on live data.
    const otherAccountOnly = [
      makeAdSpendRow({ accountName: 'Other', accountId: 'ACCT-9', campaignId: 'CAMP-9', spent: 10, leads: 1 }),
    ];
    const r = buildAccountSummaries(otherAccountOnly, [APPT], SETTINGS);
    expect(r.unmatchedAppointments).toHaveLength(1);
  });
});
