import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { makeSettings, makeAdSpendRow, makeAppointmentRow } from '@/test/factories';
import type { SourceKey, SourceStatus } from '@/lib/sourceStatus';

/**
 * 🔴 THE UNMATCHED PANEL IGNORED THE DATE RANGE, AND EVERY OTHER NUMBER ON THE PAGE OBEYED IT.
 *
 * Measured in production 2026-08-17. With the range chip reading **Today**, the panel listed
 * 57 unmatched appointments dated 6/29/2025, 11/18/2025 and 12/8/2025. @andrew, looking at a
 * page filtered to one day and being shown bookings from eight months earlier: "it looks like
 * bs errors". The appointments were real and the diagnosis was right; the SCOPE was wrong.
 *
 * `dateFilteredResult` has always computed a date-filtered `unmatchedAppointments` — its own
 * docblock says it was added because "the page had no date-filtered count of them" — and the
 * TOTAL APPTS tile consumes it. The PANEL two inches below kept reading the raw unfiltered
 * list from `useData`, so the tile and the panel described different populations on one screen.
 *
 * ⚠️ THIS IS THE SAME CLASS AS THE OTHER TWO DEFECTS FOUND TODAY: nothing here computed a
 * wrong number. A correct all-time figure was rendered under a one-day heading, which makes it
 * a false statement about a true value.
 */

const useDataMock = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useData', () => ({ useData: useDataMock }));

const { default: Dashboard } = await import('./Dashboard');

const status = (over: Partial<SourceStatus> = {}): SourceStatus =>
  ({ label: 'src', state: 'valid', error: null, missingSettings: [], configured: true, ...over }) as SourceStatus;

const SETTINGS = makeSettings();

// Today, so the account row survives a "Today" window and the page still renders.
const T = new Date();
const p = (n: number) => String(n).padStart(2, '0');
const isoToday = `${T.getFullYear()}-${p(T.getMonth() + 1)}-${p(T.getDate())}`;
const usToday = `${T.getMonth() + 1}/${T.getDate()}/${T.getFullYear()}`;

const SPEND = [makeAdSpendRow({ accountName: 'Acme', accountId: 'ACCT-1', spent: 500, leads: 20, date: usToday, dateISO: isoToday })];

/** The production shape: an unmatched booking from LAST YEAR, on a page filtered to today. */
const OLD_UNMATCHED = makeAppointmentRow({
  client: 'Pergola Guy',
  campaignId: 'ORPHAN-1',
  appointmentDate: '6/29/2025',
  dateAdded: '6/29/2025',
});

function mount() {
  useDataMock.mockReturnValue({
    accounts: [], adSpend: SPEND, appointments: [OLD_UNMATCHED],
    unmatchedAppointments: [OLD_UNMATCHED],
    settings: SETTINGS, loading: false, error: null, lastUpdated: null,
    configured: true, settingsLoaded: true, settingsOrigin: 'database' as const, settingsDetail: null,
    exclusions: { state: 'none-configured', configuredCount: 0, matchedCount: 0, unfilteredSpend: 0, affectedAccounts: [] },
    honestNumbers: { hasWarnings: false, messages: [], exclusion: {}, fabricatedRateCount: 0, allRatesFabricated: false },
    sources: { meta: status(), airtable: status() } as Record<SourceKey, SourceStatus>,
    refresh: async () => {}, setSettings: () => {}, setSpendWindow: () => {},
  });
  return render(<Dashboard />);
}

function selectPreset(label: string) {
  fireEvent.click(screen.getByRole('button', { name: /all time|date|range/i }));
  fireEvent.click(screen.getByText(label));
}

beforeEach(() => { useDataMock.mockReset(); });

describe('the unmatched panel is scoped to the selected date range', () => {
  it('🔴 ANTI-VACUITY CONTROL: at All Time the 2025 booking IS listed', () => {
    // Run first. Without it "the panel is hidden" is satisfiable by never rendering it,
    // which would hide 57 real bookings instead of scoping them.
    mount();
    expect(screen.getByText(/1 Unmatched Appointment/)).toBeTruthy();
  });

  it('🔴 THE PRODUCTION CASE: picking Today drops a booking dated 6/29/2025', async () => {
    mount();
    selectPreset('Today');
    await waitFor(() => {
      expect(screen.queryByText(/Unmatched Appointment/)).toBeNull();
    });
  });

  it('the panel and the TOTAL APPTS tile describe the SAME population', async () => {
    // The defect was two populations on one screen: the tile counted the filtered set while
    // the panel listed the raw one. Under Today both must agree that there is nothing.
    mount();
    selectPreset('Today');
    await waitFor(() => expect(screen.queryByText(/Unmatched Appointment/)).toBeNull());
    // The label is uppercased by CSS, so match the DOM text, not the rendered casing. And
    // assert the VALUE node: the card's textContent is "Total Appts0", where no word boundary
    // separates the label from the number.
    const tile = screen.getByText(/^total appts$/i).closest('div');
    expect(tile?.querySelector('.kpi-number')?.textContent?.trim()).toBe('0');
  });
});
