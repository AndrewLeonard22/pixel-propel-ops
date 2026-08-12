import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { makeSettings, makeAdSpendRow, makeAppointmentRow } from '@/test/factories';
import { buildAccountRegistry } from '@/lib/accountRegistry';
import { buildAccountSummaries } from '@/lib/dataService';
import type { SourceKey, SourceStatus } from '@/lib/sourceStatus';

/**
 * ⑦ THE HEADLINE MUST CONSERVE MONEY, AND `Internal` IS NOT A CLIENT.
 *
 * Two defects on one tile row, both found by rendering the real page against the live
 * sources on 2026-08-12 and both invisible to the 760 tests that existed:
 *
 * 🔴 F2 — $22,100 OF REAL REVENUE LEFT THE HEADLINE WITH NOTHING NAMING IT.
 *   ⑥ taught `TOTAL APPTS` to add unmatched appointments back. `Closed Deals` and
 *   `Total Revenue` were left reducing over ACCOUNTS ONLY, so a detached appointment that
 *   is a SIGNED DEAL was structurally invisible to them. Measured: `Green Plus Remodeling`
 *   loses its Meta account (its ids are outside the pull token's visibility), its 30
 *   appointments land in the unmatched bucket, and 4 of them are closed-won worth $22,100.
 *   The tiles read 43 / $1,598,243.72 where 47 / $1,620,343.72 exists — and the unmatched
 *   banner two inches away counts APPOINTMENTS, never MONEY, so nothing on the screen said
 *   a dollar had gone anywhere.
 *
 * 🔴 F4 — `Internal` SPEND WAS INSIDE THE CLIENT-FACING DFY RATE.
 *   `dfyAccounts` asked `program !== 'Done With You'`. `Internal` — our own agency and
 *   recruiting spend, which books no client appointments — satisfies that. Measured: the
 *   `SocialWorks` account contributes $51,056.88 and 0 appointments, and Avg Cost/Appt read
 *   $637.55 against $549.82 for the client-facing population. A 13.8% overstatement on the
 *   tile the media buyers are judged on.
 *
 * ⭐ WHY BOTH ARMS ARE DRIVEN THROUGH THE RENDERED PAGE. Neither defect is in
 * `buildAccountSummaries`, which is correct in both cases. Both are in what the page REDUCES
 * over, so a unit test on the data layer cannot fail for either — the same class as
 * `pages.registryUnderDateFilter.test.tsx` and, one level up, the 21 green assertions
 * recorded at `SourceStatusBanner.origin.test.tsx:185` against a predicate nothing called.
 */

const useDataMock = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useData', () => ({ useData: useDataMock }));

const { default: Dashboard } = await import('./Dashboard');
const { ALL_DATES } = await import('@/lib/metaAdSpend');

const status = (over: Partial<SourceStatus> = {}): SourceStatus =>
  ({ label: 'src', state: 'valid', error: null, missingSettings: [], configured: true, ...over }) as SourceStatus;

/**
 * THREE ACCOUNTS, one per program, because the two defects are about POPULATIONS and a
 * fixture with one account cannot express a population at all.
 *
 * DFY-1      a real client. $1,000 / 100 leads / 2 appointments.
 * INTERNAL-1 our own recruiting spend. $9,000 and NO appointments — the live `SocialWorks`
 *            shape at small scale. If it is inside the DFY rate, Avg Cost/Appt is 5x wrong.
 * DWY-1      already excluded before this change; present so the note has to name TWO
 *            exclusions and cannot pass by naming one.
 */
const REGISTRY = buildAccountRegistry(
  [
    { account_id: 'DFY-1', meta_name: 'Acme X SocialWorks', company_name: 'Acme Roofing', program: 'Done For You', media_buyer: 'Jez', status: 'active' },
    { account_id: 'INTERNAL-1', meta_name: 'SocialWorks', company_name: 'SocialWorks', program: 'Internal', media_buyer: 'Jez', status: 'active' },
    { account_id: 'DWY-1', meta_name: 'Zeta X SocialWorks', company_name: 'Zeta Exteriors', program: 'Done With You', media_buyer: 'Jez', status: 'active' },
  ],
  [{ airtable_name_key: 'acme roofing', airtable_name: 'Acme Roofing', account_id: 'DFY-1' }],
);

const SPEND = [
  makeAdSpendRow({ accountId: 'DFY-1', accountName: 'Acme X SocialWorks', campaignId: 'C-1', spent: 1000, leads: 100 }),
  makeAdSpendRow({ accountId: 'INTERNAL-1', accountName: 'SocialWorks', campaignId: 'C-2', spent: 9000, leads: 50 }),
  makeAdSpendRow({ accountId: 'DWY-1', accountName: 'Zeta X SocialWorks', campaignId: 'C-3', spent: 500, leads: 40 }),
];

/** Two matched appointments on the DFY account, one of them a $5,000 win. */
const MATCHED = [
  makeAppointmentRow({ client: 'Acme Roofing', campaignId: 'C-1', leadStatus: 'Closed Won', closedRevenue: 5000 }),
  makeAppointmentRow({ client: 'Acme Roofing', campaignId: 'C-1', leadStatus: 'Booked', closedRevenue: 0 }),
];

/**
 * ⭐ THE DETACHED CLIENT, and it is built to be genuinely unattributable rather than merely
 * unmatched-by-accident: its campaign id is not in the feed, its name is in no registry row
 * and in no alias, and it scores far below the fuzzy tier's threshold against every account
 * name above. Two of its three appointments are wins, worth $22,100 together — the live
 * `Green Plus Remodeling` figure, kept so the arm reads as the incident it came from.
 */
const DETACHED = [
  makeAppointmentRow({ client: 'Green Plus Remodeling', campaignId: 'NOT-IN-FEED', adId: 'NOT-IN-FEED', leadStatus: 'Closed Won', closedRevenue: 12100 }),
  makeAppointmentRow({ client: 'Green Plus Remodeling', campaignId: 'NOT-IN-FEED', adId: 'NOT-IN-FEED', leadStatus: 'Closed Won', closedRevenue: 10000 }),
  makeAppointmentRow({ client: 'Green Plus Remodeling', campaignId: 'NOT-IN-FEED', adId: 'NOT-IN-FEED', leadStatus: 'Booked', closedRevenue: 0 }),
];

const SETTINGS = makeSettings();

function mount(unmatched: ReturnType<typeof makeAppointmentRow>[]) {
  const appts = [...MATCHED, ...unmatched];
  const built = buildAccountSummaries(SPEND, appts, SETTINGS, { spend: true, appts: true }, REGISTRY);
  useDataMock.mockReturnValue({
    accounts: built.accounts,
    adSpend: SPEND,
    appointments: appts,
    unmatchedAppointments: built.unmatchedAppointments,
    callData: [],
    settings: SETTINGS,
    loading: false, error: null, lastUpdated: null,
    configured: true, settingsLoaded: true,
    settingsOrigin: 'database' as const, settingsDetail: null,
    exclusions: { state: 'none-configured', configuredCount: 0, matchedCount: 0, unfilteredSpend: 0, affectedAccounts: [] },
    honestNumbers: { hasWarnings: false, messages: [], exclusion: {}, fabricatedRateCount: 0, allRatesFabricated: false },
    sources: { meta: status(), airtable: status() } as Record<SourceKey, SourceStatus>,
    refresh: async () => {}, setSettings: () => {},
    spendWindow: ALL_DATES, setSpendWindow: () => {},
    accountRegistry: REGISTRY,
  });
  return { ...render(<Dashboard />), built };
}

/** A tile's rendered value, read by its label rather than by position. */
function tile(label: string): string {
  const el = screen.getByText(label).parentElement;
  return el?.querySelector('p:nth-child(2)')?.textContent?.trim() ?? '';
}

beforeEach(() => useDataMock.mockReset());

describe('F2 — CLOSED DEALS and TOTAL REVENUE conserve the wins that belong to no account', () => {
  it('🔴 ANTI-VACUITY CONTROL: with nothing detached, the tiles are the attributed figures', () => {
    // Runs first. Without it, a fix that added a constant — or that double-counted the
    // matched win — would pass every arm below.
    const { built } = mount([]);
    expect(built.unmatchedAppointments).toHaveLength(0);
    expect(tile('Closed Deals')).toBe('1');
    expect(tile('Total Revenue')).toBe('$5,000.00');
    expect(screen.queryByText(/not matched to an account/i)).not.toBeInTheDocument();
  });

  it('🔴 THE DEFECT: two detached wins worth $22,100 reach the headline', () => {
    const { built } = mount(DETACHED);
    // The fixture really is exercising the detached path — if the join attributed these,
    // the arm would pass for the wrong reason.
    expect(built.unmatchedAppointments).toHaveLength(3);
    expect(tile('Closed Deals')).toBe('3');                 // 1 attributed + 2 detached
    expect(tile('Total Revenue')).toBe('$27,100.00');       // $5,000 + $22,100
  });

  it('🔑 and BOTH tiles SAY their composition changed — the banner never counted money', () => {
    mount(DETACHED);
    expect(screen.getByText(/includes 2 from appointments not matched to an account/i)).toBeVisible();
    expect(screen.getByText(/includes \$22,100\.00 from appointments not matched to an account/i)).toBeVisible();
  });

  it('🔴 A LOST DEAL IS NOT SMUGGLED IN BY THE DETACHED PATH', () => {
    /**
     * ⚖️ The ruling `isClosedWon` encodes — LOST OUTRANKS WON, "because counting a lost deal
     * as revenue is the worse error" — has to survive the new route into the totals. A
     * detached appointment marked Closed Lost that still carries a revenue figure must not
     * become revenue here just because it arrived by a different door.
     */
    mount([
      ...DETACHED,
      makeAppointmentRow({ client: 'Green Plus Remodeling', campaignId: 'NOT-IN-FEED', adId: 'NOT-IN-FEED', leadStatus: 'Closed Lost', closedRevenue: 99999 }),
    ]);
    expect(tile('Closed Deals')).toBe('3');
    expect(tile('Total Revenue')).toBe('$27,100.00');
  });

  it('🔴 A NARROWED VIEW EXCLUDES THEM — and says so, in money, rather than silently', () => {
    // The mirror defect: under a filter these tiles describe the accounts on screen, and an
    // appointment belonging to no account is not in that population. Excluded there — but a
    // number that changes composition without saying so is the defect one level up, which is
    // why the disclosure has to speak in BOTH states.
    mount(DETACHED);
    expect(tile('Total Revenue')).toBe('$27,100.00');

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'Acme' } });

    expect(tile('Closed Deals')).toBe('1');
    expect(tile('Total Revenue')).toBe('$5,000.00');
    expect(screen.getByText(/excludes 2 from appointments not matched to an account/i)).toBeVisible();
    expect(screen.getByText(/excludes \$22,100\.00 from appointments not matched to an account/i)).toBeVisible();
  });

  it('🔴 TOTAL APPTS AND THE DEAL TILES AGREE ABOUT WHICH APPOINTMENTS EXIST', () => {
    /**
     * The conservation identity, and the reason the two tiles were wrong in the first place:
     * ⑥ moved one of them and left the others behind. Three detached appointments enter
     * TOTAL APPTS; the two of them that are wins enter CLOSED DEALS. One rule, one
     * population, asserted together so a future edit cannot move one without the other.
     */
    mount(DETACHED);
    expect(tile('Total Appts')).toBe('5');       // 2 attributed + 3 detached
    expect(tile('Closed Deals')).toBe('3');      // 1 attributed win + 2 detached wins
    expect(screen.getByText(/includes 3 not matched to an account/i)).toBeVisible();
  });
});

describe('F4 — `Internal` spend is not part of a client-facing rate', () => {
  it('🔴 THE DEFECT: agency spend with no appointments must not enter Avg Cost/Appt', () => {
    mount([]);
    /**
     * DFY-only: $1,000 over 2 appointments = $500.00.
     * With `Internal` folded in (the old `!== 'Done With You'` test): $10,000 over 2 = $5,000.
     * A tenfold reading of what it costs to book a client an appointment.
     */
    expect(tile('Avg Cost/Appt')).toBe('$500.00');
  });

  it('🔴 and Lead → Appt % uses the DFY denominator, not the DFY+Internal one', () => {
    mount([]);
    // 2 appointments over DFY's 100 leads = 2.0%. Including Internal's 50 leads gives 1.3%.
    expect(tile('Lead → Appt %')).toBe('2.0%');
  });

  it('🔑 THE NOTE NAMES BOTH EXCLUSIONS — one count could not tell the reader which left', () => {
    // DWY and Internal are excluded for opposite reasons (a client whose leads we do not
    // work, versus spend with no client at all), so a single "2 excluded" would send the
    // reader to the account table to work out what happened to the number.
    mount([]);
    expect(screen.getAllByText(/1 Done-With-You and 1 Internal excluded/i).length).toBeGreaterThan(0);
  });

  it('🔴 THE TOTALS ARE UNTOUCHED — only the RATES narrow', () => {
    /**
     * ⛔ THE MIRROR DEFECT THIS ARM REFUSES. "Internal is not a client" is an argument about
     * RATES. Total Spend is a total over money that actually left the bank, and dropping
     * $9,000 out of it to make a rate look right would be the same class of error in the
     * opposite direction — a headline narrower than its label, which this page already
     * carries a disclosure line about.
     */
    mount([]);
    expect(tile('Total Spend')).toBe('$10,500.00');   // 1000 + 9000 + 500, every Active account
    expect(tile('Total Leads')).toBe('190');          // 100 + 50 + 40
  });
});
