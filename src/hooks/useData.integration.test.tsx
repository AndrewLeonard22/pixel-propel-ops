/**
 * INTEGRATION LOCK for order ⑥ — the real DataProvider, the real Dashboard, the real
 * buildAccountSummaries. Only the three network fetchers and the settings loader are
 * controlled, because those are the only things that touch the outside world.
 *
 * This is the test that would have caught the 2026-08-05 production outage: one empty
 * credential took all three sources down and the screen showed no error at all.
 *
 * SABOTAGE MATRIX — every flip below was RUN against a staged baseline, and the result
 * recorded is what actually happened, not what was expected:
 *   A. Promise.allSettled -> Promise.all (sourceStatus.ts)      5 of 6 RED
 *   B. KPI guards -> formatNumber/formatCurrency unguarded      1 RED (the em-dash case)
 *   C. onRetry={() => refresh()} -> onRetry={refresh} ALONE     GREEN  ⚠️ see below
 *   C2. that revert PLUS reverting the isAppSettingsLike guard  1 RED (the retry case)
 *   C3. reverting the isAppSettingsLike guard ALONE             GREEN
 *
 * ⚠️ FLIP C IS THE ONE WORTH READING. The retry defect has TWO independent fixes — the
 * wrapped call site, and `refresh` refusing an argument that is not settings — and either
 * one alone is sufficient. So reverting either ONE leaves the suite green, and only
 * reverting BOTH (C2, the true baseline) reddens it. The lock is therefore non-vacuous
 * against the defect that actually shipped, and it does NOT pin either fix individually.
 * Said plainly because the first version of this comment claimed flip C went red. It does
 * not, and a green run does not license a claim wider than what was flipped.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AppSettings, AdSpendRow, CallRow, AppointmentRow } from '@/lib/types';

// vi.mock factories are hoisted above every top-level binding, so anything they close over
// must be created inside vi.hoisted or it is a ReferenceError at load time.
const h = vi.hoisted(() => ({
  CONFIGURED: {
    googleSheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET/edit',
    callCenterSheetUrl: 'https://docs.google.com/spreadsheets/d/CALLS/edit',
    airtableBaseId: 'appBASE',
    airtableToken: 'tok',
  },
  // The only things standing in for the outside world.
  windsorImpl: vi.fn(),
  airtableImpl: vi.fn(),
  callsImpl: vi.fn(),
  /** Overridable so one test can run with the call-centre source unconfigured. */
  settingsOverride: {} as Record<string, string>,
}));
const { windsorImpl, airtableImpl, callsImpl } = h;

vi.mock('@/lib/dataService', async () => {
  const actual = await vi.importActual<typeof import('@/lib/dataService')>('@/lib/dataService');
  return {
    ...actual, // real buildAccountSummaries + real formatters — the maths is not under test here
    fetchGoogleSheetData: (s: unknown) => h.windsorImpl(s),
    fetchAirtableData: (s: unknown) => h.airtableImpl(s),
    fetchCallCenterData: (s: unknown) => h.callsImpl(s),
  };
});

vi.mock('@/lib/config', async () => {
  const actual = await vi.importActual<typeof import('@/lib/config')>('@/lib/config');
  const build = () => ({ ...actual.DEFAULT_SETTINGS, ...h.CONFIGURED, ...h.settingsOverride });
  return {
    ...actual,
    loadSettings: () => build(),
    loadSettingsAsync: async () => build(),
    saveSettings: async () => {},
    saveAccountMappings: async () => {},
    loadAccountMappings: () => [],
  };
});

// eslint-disable-next-line import/first
import { DataProvider } from './useData';
// eslint-disable-next-line import/first
import Dashboard from '@/pages/Dashboard';

const spendRow: AdSpendRow = {
  month: 'August', date: '8/4/2026', campaign: 'Camp', campaignId: '111',
  adsetName: 'AS', adsetId: '211', adName: 'Ad', adId: '311',
  spent: 5000, leads: 100, accountName: 'Testerman Pro Wash',
};
const callRow = { timestamp: '8/4/2026 10:00am', ghlLocationName: 'Testerman Pro Wash', agentName: 'Jordan', callDuration: 90, callDisposition: 'answered' } as CallRow;

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {} unobserve() {} disconnect() {}
    };
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  windsorImpl.mockResolvedValue([spendRow]);
  airtableImpl.mockResolvedValue({ records: [], fields: [] });
  callsImpl.mockResolvedValue([callRow]);
});

const paint = () => render(<MemoryRouter><DataProvider><Dashboard /></DataProvider></MemoryRouter>);

/**
 * Read one KPI card by its LABEL. `$5,000.00` also appears in the account table below, so
 * a bare getByText is ambiguous — and worse, it would let an assertion about the KPI row
 * pass on a match from a different part of the page.
 */
const kpi = (label: string) => screen.getByText(label).parentElement!.textContent || '';
/** Resolves once the first successful load has painted the KPI row. */
const waitForSpendCard = () => waitFor(() => expect(kpi('Total Spend')).toContain('$5,000.00'));

describe('a failing source must not take the working ones down', () => {
  it('Airtable failing still shows Windsor spend, and says which source broke', async () => {
    airtableImpl.mockRejectedValue(new Error('Airtable error: 401'));
    paint();

    // Windsor delivered, so its number is on screen. Under Promise.all this was discarded
    // and the whole dashboard rendered zeros.
    await waitForSpendCard();

    // CONTROL: the fetchers that did not need the Airtable token WERE called. This is the
    // wire signature @bird measured as 0/0 during the outage; if it regresses to 0 this
    // assertion fails rather than silently passing on cached state.
    expect(windsorImpl).toHaveBeenCalledTimes(1);
    expect(callsImpl).toHaveBeenCalledTimes(1);

    // And the failure is NAMED, on screen, rather than being an absence.
    expect(await screen.findByText(/Appointments \(Airtable\)/)).toBeInTheDocument();
    expect(screen.getByText(/Airtable error: 401/)).toBeInTheDocument();
  });

  it('Windsor failing still shows the call-centre dial count', async () => {
    windsorImpl.mockRejectedValue(new Error('Failed to fetch Google Sheet: 403'));
    paint();
    await waitFor(() => expect(screen.getByText(/Failed to fetch Google Sheet: 403/)).toBeInTheDocument());
    expect(airtableImpl).toHaveBeenCalledTimes(1);
    expect(callsImpl).toHaveBeenCalledTimes(1);
  });

  it('THE PRODUCTION INCIDENT: an empty Airtable token still fetches Windsor and calls', async () => {
    // 2026-08-05: isConfigured required all three fields, so one empty credential produced
    // ZERO requests to two sources that never needed it, and no error on screen.
    const { rerender } = render(<MemoryRouter><DataProvider><Dashboard /></DataProvider></MemoryRouter>);
    await waitFor(() => expect(windsorImpl).toHaveBeenCalled());
    rerender(<MemoryRouter><DataProvider><Dashboard /></DataProvider></MemoryRouter>);
    expect(airtableImpl).toHaveBeenCalled();
  });
});

describe('a dead source renders an em dash, never a zero', () => {
  it('a failed Airtable shows — for appointment metrics while spend still shows a number', async () => {
    airtableImpl.mockRejectedValue(new Error('Airtable error: 401'));
    paint();

    await waitForSpendCard();

    // The four Airtable-fed KPI cards must not print a number. Read each by its label so
    // the assertion is about the specific card and not about "— appears somewhere".
    for (const label of ['Total Appts', 'Closed Deals', 'Total Revenue']) {
      const text = kpi(label);
      expect(text, `${label} must not print a fabricated value`).toContain('—');
      expect(text).not.toContain('$0.00');
      expect(text).not.toMatch(/\b0\b/);
    }

    // CONTROL: the Windsor-fed cards DO print numbers in the same render, so the em dashes
    // above mean "this source is dead" and not "this test renders em dashes everywhere".
    expect(kpi('Total Spend')).toContain('$5,000.00');
    expect(kpi('Total Leads')).toContain('100');
  });

  it('a call-centre source that was never configured shows — for dials, not 0', async () => {
    // Configured-and-empty vs never-connected are different facts. Only the second is
    // provable from settings alone, and it must not read as "no calls were made".
    h.settingsOverride = { callCenterSheetUrl: '' };
    try {
      paint();
      await waitForSpendCard();

      expect(kpi('Total Dials')).toContain('—');
      expect(kpi('Total Dials')).not.toMatch(/\b0\b/);

      // CONTROL: the unconfigured source was never fetched, and the configured ones were.
      // Without this pair, "not called" could just mean the whole provider never ran.
      expect(callsImpl).not.toHaveBeenCalled();
      expect(windsorImpl).toHaveBeenCalled();
    } finally {
      h.settingsOverride = {};
    }
  });
});

describe('the Retry button actually retries', () => {
  it('clicking Retry starts a new fetch — it used to start nothing at all', async () => {
    airtableImpl.mockRejectedValue(new Error('Airtable error: 401'));
    paint();
    await waitFor(() => expect(screen.getByText(/Airtable error: 401/)).toBeInTheDocument());

    const before = windsorImpl.mock.calls.length;
    expect(before).toBe(1); // CONTROL: the first load happened, so a later 2 means the click did it

    // `onRetry={refresh}` handed refresh the CLICK EVENT as its first argument; refresh
    // read that as override settings, failed its own guard and returned — no request, no
    // spinner, no state change. The button was decoration.
    // fireEvent dispatches a real click, so React hands the handler a SyntheticEvent —
    // which IS the mechanism this test exists to catch.
    fireEvent.click(screen.getAllByRole('button', { name: /retry|try again/i })[0]);

    await waitFor(() => expect(windsorImpl.mock.calls.length).toBe(before + 1));
  });
});
