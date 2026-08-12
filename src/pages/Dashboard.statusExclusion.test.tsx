import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { makeSettings } from '@/test/factories';
import type { AccountSummary } from '@/lib/types';

/**
 * ⑦ THE THIRD NARROWING ON THE KPI ROW WAS THE ONLY SILENT ONE.
 *
 * 🔴 THE DEFECT. Every tile on the row reduces over `filteredAccounts.filter(status ===
 * 'Active')`. Two other narrowings on the same row already disclose themselves — DWY on the
 * rate tiles, unmatched appointments on Total Appts — and this one, which removes MONEY, did
 * not. Measured on the live feed 2026-08-12: the `Hiring` ad account is `archived` in
 * `ad_accounts`, `resolveStatus` maps that to `Churned`, and $1,904.03 / 573 leads therefore
 * leave a tile labelled TOTAL SPEND. The headline read $769,080.31 where the feed held
 * $770,984.34, and nothing on the page accounted for the $1,904.03.
 *
 * ⚠️ THE CUTOVER CREATED IT. Before `resolveStatus`, `ad_accounts.status` had no consequence
 * anywhere in the app, so nothing was ever excluded by it. Making the Archived control real
 * is correct; making it real and SILENT is the same "a screen states something it has not
 * earned" shape this branch exists to remove.
 *
 * ⛔ WHAT THIS TEST MUST NOT BECOME: a test that the excluded money is added back. It is not.
 * Active-only is deliberate and four other sites encode it. The contract under test is that
 * the exclusion is STATED, with the account named and the amount named.
 */
const acct = (o: Partial<AccountSummary>): AccountSummary => ({
  accountName: 'X', spend: 0, leads: 0, performanceSpend: 0, performanceLeads: 0,
  appointments: 0, closed: 0, revenue: 0, billed: 0, totalDials: 0, cpl: 0,
  leadPercent: 0, costPerAppt: 0, campaigns: [], appointmentList: [],
  program: 'Done For You', status: 'Active', mediaBuyer: 'Unassigned',
  ...o,
} as unknown as AccountSummary);

/** The live shape: one ordinary Active account and one archived-in-`ad_accounts` account. */
const ACTIVE = acct({ accountName: 'Acme X SocialWorks', companyName: 'Acme', spend: 1000, leads: 100, performanceSpend: 1000, performanceLeads: 100, appointments: 4 });
const CHURNED = acct({ accountName: 'Hiring', companyName: null, status: 'Churned', spend: 1904.03, leads: 573 });
/** Churned, but it spent nothing in this window, so no total moved and there is nothing to say. */
const QUIET_CHURNED = acct({ accountName: 'Old Client', companyName: 'Old Client', status: 'Churned', spend: 0, leads: 0 });

const useDataMock = vi.fn();
vi.mock('@/hooks/useData', () => ({ useData: useDataMock }));
const { default: Dashboard } = await import('./Dashboard');

const ok = { label: 'src', state: 'valid', error: null, missingSettings: [], configured: true } as never;
function mount(accounts: AccountSummary[]) {
  useDataMock.mockReturnValue({
    settings: makeSettings(), setSettings: () => {}, adSpend: [{ dateISO: '2026-08-05' }],
    accounts, appointments: [], unmatchedAppointments: [], callData: [],
    loading: false, error: null, configured: true, settingsLoaded: true, settingsOrigin: 'database',
    sources: { meta: ok, airtable: ok, callCenter: ok }, refresh: async () => {},
    setSpendWindow: () => {},
    honestNumbers: { hasWarnings: false, messages: [], exclusion: {}, fabricatedRateCount: 0, allRatesFabricated: false },
    exclusions: { state: 'active', configuredCount: 0, matchedCount: 0, unfilteredSpend: 0, affectedAccounts: [] },
    lastUpdated: null,
  });
  return render(<Dashboard />);
}

function tile(label: string): string {
  const el = screen.getByText(label).parentElement;
  return el?.querySelector('p:nth-child(2)')?.textContent?.trim() ?? '';
}
const note = () => screen.queryByTestId('status-exclusion-note')?.textContent ?? null;

beforeEach(() => useDataMock.mockReset());

describe('⑦ the Active-only KPI population discloses what it left out', () => {
  it('🔴 ANTI-VACUITY: the two candidate totals actually DIFFER on this fixture', () => {
    expect(1000).not.toBe(1000 + 1904.03);
  });

  it('the tile still excludes the churned account — the population is NOT widened', () => {
    mount([ACTIVE, CHURNED]);
    expect(tile('Total Spend')).toBe('$1,000.00');   // NOT $2,904.03
    expect(tile('Total Leads')).toBe('100');         // NOT 673
  });

  it('🔴 and the page SAYS so, naming the account and the money', () => {
    mount([ACTIVE, CHURNED]);
    const n = note();
    expect(n).toContain('Active accounts only');
    expect(n).toContain('Hiring');          // the account, by the name the row renders
    expect(n).toContain('$1,904.03');       // the money, to the cent
    expect(n).toContain('573 leads');
  });

  it('🔴 CONTROL — nothing was excluded, so the row says nothing', () => {
    mount([ACTIVE]);
    expect(note()).toBeNull();
  });

  it('🔴 CONTROL — a churned account that spent NOTHING moves no total and stays silent', () => {
    mount([ACTIVE, QUIET_CHURNED]);
    expect(tile('Total Spend')).toBe('$1,000.00');
    expect(note()).toBeNull();
  });

  it('names up to three accounts and then counts the rest, rather than printing a wall', () => {
    const many = ['A', 'B', 'C', 'D'].map((n, i) =>
      acct({ accountName: n, companyName: n, status: 'Churned', spend: 100 - i, leads: 1 }),
    );
    mount([ACTIVE, ...many]);
    const n = note() ?? '';
    expect(n).toContain('A, B, C');
    expect(n).toContain('and 1 more');
    expect(n).toContain('$394.00');   // 100+99+98+97 — the total, not just the named three
  });

  it('a PAUSED account is excluded by the same filter and disclosed by the same line', () => {
    mount([ACTIVE, acct({ accountName: 'Paused Co', companyName: 'Paused Co', status: 'Paused', spend: 250, leads: 9 })]);
    expect(tile('Total Spend')).toBe('$1,000.00');
    expect(note()).toContain('Paused Co');
  });
});
