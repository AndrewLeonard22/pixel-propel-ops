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
import type { AppSettings, AdSpendRow, AppointmentRow } from '@/lib/types';

// vi.mock factories are hoisted above every top-level binding, so anything they close over
// must be created inside vi.hoisted or it is a ReferenceError at load time.
const h = vi.hoisted(() => ({
  CONFIGURED: {
    airtableBaseId: 'appBASE',
    airtableToken: 'tok',
  },
  // The only things standing in for the outside world.
  adSpendImpl: vi.fn(),
  airtableImpl: vi.fn(),
  /** Overridable so one test can run with a source unconfigured. */
  settingsOverride: {} as Record<string, string>,
}));
const { adSpendImpl, airtableImpl } = h;

vi.mock('@/lib/dataService', async () => {
  const actual = await vi.importActual<typeof import('@/lib/dataService')>('@/lib/dataService');
  return {
    ...actual, // real buildAccountSummaries + real formatters — the maths is not under test here
    fetchAirtableData: (s: unknown) => h.airtableImpl(s),
  };
});

// ⚠️ RE-POINTED, NOT REWRITTEN. The ad-spend fetcher lives in metaAdSpend since the
// Supabase cutover; every assertion in this file survived the move untouched.
vi.mock('@/lib/metaAdSpend', async () => {
  const actual = await vi.importActual<typeof import('@/lib/metaAdSpend')>('@/lib/metaAdSpend');
  return {
    ...actual,
    fetchMetaAdSpend: (s: unknown) => h.adSpendImpl(s),
    checkMetaCompleteness: async () => ({ state: 'complete' as const, rawRows: 1, derivedRows: 1, droppedRows: 0, reason: null }),
  };
});

vi.mock('@/lib/config', async () => {
  const actual = await vi.importActual<typeof import('@/lib/config')>('@/lib/config');
  const build = () => ({ ...actual.DEFAULT_SETTINGS, ...h.CONFIGURED, ...h.settingsOverride });
  return {
    ...actual,
    loadSettings: () => build(),
    loadSettingsAsync: async () => build(),
    // ⭐ THE DOUBLE MUST TRACK THE FUNCTION THE HOOK ACTUALLY CALLS. useData moved to
    // loadSettingsWithSource; while this mock supplied only loadSettingsAsync the provider
    // fell through to the REAL loader, hit the REAL network, and every arm below rendered
    // a deployment-error banner instead of the dashboard. It failed loudly, which is the
    // only reason it was not a silent coverage hole.
    loadSettingsWithSource: async () => ({ settings: build(), origin: 'database', detail: null }),
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
  month: 'August', date: '8/4/2026', dateISO: '2026-08-04', campaign: 'Camp', campaignId: '111',
  adsetName: 'AS', adsetId: '211', adName: 'Ad', adId: '311',
  spent: 5000, leads: 100, accountName: 'Testerman Pro Wash',
};

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {} unobserve() {} disconnect() {}
    };
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  adSpendImpl.mockResolvedValue([spendRow]);
  airtableImpl.mockResolvedValue({ records: [], fields: [] });
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
  it('Airtable failing still shows ad spend spend, and says which source broke', async () => {
    airtableImpl.mockRejectedValue(new Error('Airtable error: 401'));
    paint();

    // ad spend delivered, so its number is on screen. Under Promise.all this was discarded
    // and the whole dashboard rendered zeros.
    await waitForSpendCard();

    // CONTROL: the fetchers that did not need the Airtable token WERE called. This is the
    // wire signature @bird measured as 0/0 during the outage; if it regresses to 0 this
    // assertion fails rather than silently passing on cached state.
    expect(adSpendImpl).toHaveBeenCalledTimes(1);

    // And the failure is NAMED, on screen, rather than being an absence.
    expect(await screen.findByText(/Appointments \(Airtable\)/)).toBeInTheDocument();
    expect(screen.getByText(/Airtable error: 401/)).toBeInTheDocument();
  });

  it('ad spend failing still fetches Airtable and names its own failure', async () => {
    adSpendImpl.mockRejectedValue(new Error('Could not load ad spend from Supabase (ad_insights_resolved): 403'));
    paint();
    await waitFor(() => expect(screen.getByText(/Could not load ad spend from Supabase/)).toBeInTheDocument());
    expect(airtableImpl).toHaveBeenCalledTimes(1);
  });

  it('THE PRODUCTION INCIDENT: an empty Airtable token still fetches ad spend', async () => {
    // 2026-08-05: isConfigured required every field, so one empty credential produced
    // ZERO requests to a source that never needed it, and no error on screen.
    const { rerender } = render(<MemoryRouter><DataProvider><Dashboard /></DataProvider></MemoryRouter>);
    await waitFor(() => expect(adSpendImpl).toHaveBeenCalled());
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

    // CONTROL: the ad spend-fed cards DO print numbers in the same render, so the em dashes
    // above mean "this source is dead" and not "this test renders em dashes everywhere".
    expect(kpi('Total Spend')).toContain('$5,000.00');
    expect(kpi('Total Leads')).toContain('100');
  });

  it('a source that was never configured is NOT FETCHED — configured-and-empty is a different fact', async () => {
    // ⛔ REWRITTEN TWICE. It first asserted `kpi('Total Dials')` reads '—'; that tile was
    // removed 2026-08-05. It then guarded the call-centre fetch discipline; that source was
    // deleted outright on 2026-08-11.
    //
    // ⭐ WHAT SURVIVES IS THE LAW, WHICH WAS NEVER ABOUT ANY ONE SOURCE: configured-and-empty
    // and never-connected are different facts, and an unconfigured source must not be
    // FETCHED. Re-pointed at Airtable rather than deleted, because the law still binds.
    h.settingsOverride = { airtableBaseId: '' };
    try {
      paint();
      await waitForSpendCard();

      // CONTROL: the unconfigured source was never fetched, and the configured one was.
      // Without this pair, "not called" could just mean the whole provider never ran.
      expect(airtableImpl).not.toHaveBeenCalled();
      expect(adSpendImpl).toHaveBeenCalled();
    } finally {
      h.settingsOverride = {};
    }
  });

  it('the DIALS tile is gone from the dashboard — @andrew: dials live on Relay now', () => {
    // Anti-regression, and it outlived its own subject: the call-centre source is deleted,
    // so there is no longer any path that could feed a dials tile. It stays because a
    // re-add would now be a re-add of the whole dead feed, which must go RED, not slip in.
    paint();
    expect(document.body.textContent).not.toMatch(/Total Dials/i);
  });
});

describe('the Retry button actually retries', () => {
  it('clicking Retry starts a new fetch — it used to start nothing at all', async () => {
    airtableImpl.mockRejectedValue(new Error('Airtable error: 401'));
    paint();
    await waitFor(() => expect(screen.getByText(/Airtable error: 401/)).toBeInTheDocument());

    const before = adSpendImpl.mock.calls.length;
    expect(before).toBe(1); // CONTROL: the first load happened, so a later 2 means the click did it

    // `onRetry={refresh}` handed refresh the CLICK EVENT as its first argument; refresh
    // read that as override settings, failed its own guard and returned — no request, no
    // spinner, no state change. The button was decoration.
    // fireEvent dispatches a real click, so React hands the handler a SyntheticEvent —
    // which IS the mechanism this test exists to catch.
    fireEvent.click(screen.getAllByRole('button', { name: /retry|try again/i })[0]);

    await waitFor(() => expect(adSpendImpl.mock.calls.length).toBe(before + 1));
  });
});
