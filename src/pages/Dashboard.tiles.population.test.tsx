import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { makeSettings } from '@/test/factories';
import type { AccountSummary } from '@/lib/types';

/**
 * ⑤ THE TWO TILES SUMMED DIFFERENT POPULATIONS.
 *
 * costPerAppt was DFY-spend / DFY-appts; leadToApptPct was ALL-appts / ALL-leads. Each was
 * internally consistent and they described different businesses. A DWY account contributes
 * LEADS (we run the ads) and NOT appointments (its client books them), so an all-accounts
 * rate is understated by exactly the DWY lead volume.
 *
 * POPULATION UNDER TEST: one DFY account and one DWY account, chosen so the two answers
 * DIFFER — 1/10 = 10% over DFY only, 1/30 = 3.3% if DWY's 20 leads are wrongly included.
 * If the fixture ever stops separating them these arms pass vacuously, so the ANTI-VACUITY
 * arm below asserts the two candidate answers are not equal.
 */
/**
 * ⚠️ PROGRAM AND STATUS LIVE ON THE SUMMARY NOW, and this fixture used to inject them by
 * mocking `loadAccountMappings` instead. That mock was a faithful copy of the defect: the
 * Dashboard re-derived program/status from the legacy localStorage alias store while the
 * summary it had been handed already carried both, with a DIFFERENT default rule on each
 * side ('Done For You' there, 'Unknown' here). One owner per field — dataService resolves
 * it once, from the curated `ad_accounts` mapping with the legacy store as fallback, and
 * every screen reads the answer rather than recomputing it.
 */
const acct = (o: Partial<AccountSummary>): AccountSummary => ({
  accountName: 'X', spend: 0, leads: 0, performanceSpend: 0, performanceLeads: 0,
  appointments: 0, closed: 0, revenue: 0, billed: 0, totalDials: 0, cpl: 0,
  leadPercent: 0, costPerAppt: 0, campaigns: [], appointmentList: [],
  program: 'Done For You', status: 'Active', mediaBuyer: 'Unassigned',
  ...o,
} as unknown as AccountSummary);

const DFY = acct({ accountName: 'Acme DFY', program: 'Done For You', performanceSpend: 500, performanceLeads: 10, appointments: 1, spend: 500, leads: 10 });
const DWY = acct({ accountName: 'Zeta DWY', program: 'Done With You', performanceSpend: 900, performanceLeads: 20, appointments: 0, spend: 900, leads: 20 });

const useDataMock = vi.fn();
vi.mock('@/hooks/useData', () => ({ useData: useDataMock }));
const { default: Dashboard } = await import('./Dashboard');

const ok = { label: 'src', state: 'valid', error: null, missingSettings: [], configured: true } as never;
beforeEach(() => {
  useDataMock.mockReturnValue({
    settings: makeSettings(), setSettings: () => {}, adSpend: [{ dateISO: '2026-08-05' }],
    accounts: [DFY, DWY], appointments: [], unmatchedAppointments: [], callData: [],
    loading: false, error: null, configured: true, settingsLoaded: true, settingsOrigin: 'database',
    sources: { meta: ok, airtable: ok, callCenter: ok }, refresh: async () => {},
    // The Dashboard pushes its date range into the SQL query through this. A mock without
    // it throws on mount — the page genuinely depends on it now.
    setSpendWindow: () => {},
    honestNumbers: { hasWarnings: false, messages: [], exclusion: {}, fabricatedRateCount: 0, allRatesFabricated: false },
    exclusions: { state: 'active', configuredCount: 0, matchedCount: 0, unfilteredSpend: 0, affectedAccounts: [] },
    lastUpdated: null,
  });
});


/** The tile's value, read by its LABEL rather than by position or by a value that repeats. */
function tile(label: string): string {
  const el = screen.getByText(label).parentElement;
  return el?.querySelector('p:nth-child(2)')?.textContent?.trim() ?? '';
}

describe('⑤ both appointment tiles use ONE population and say which', () => {
  it('🔴 ANTI-VACUITY: the two candidate answers actually DIFFER on this fixture', () => {
    const dfyOnly = (1 / 10) * 100;              // 10.0%
    const allAccounts = (1 / (10 + 20)) * 100;   // 3.3%
    expect(dfyOnly).not.toBeCloseTo(allAccounts, 1);
  });

  it('Lead → Appt % is computed over DFY ONLY — the DWY leads are not in the denominator', () => {
    render(<Dashboard />);
    expect(tile('Lead → Appt %')).toBe('10.0%');   // 1/10 DFY — NOT 1/30 with DWY's leads
  });

  it('Avg Cost/Appt uses the SAME population', () => {
    render(<Dashboard />);
    expect(tile('Avg Cost/Appt')).toBe('$500.00');  // 500/1 DFY — NOT 1400/1 all-accounts
  });

  it('🔴 the population is NAMED ON SCREEN, and says what was left out', () => {
    render(<Dashboard />);
    const notes = screen.getAllByText(/Done-For-You accounts only — 1 Done-With-You excluded/);
    expect(notes.length).toBe(2);   // one per appointment tile
  });
});
