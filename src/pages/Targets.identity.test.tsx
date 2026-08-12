import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { makeSettings, makeAdSpendRow, makeAppointmentRow } from '@/test/factories';
import { buildAccountRegistry } from '@/lib/accountRegistry';
import { buildAccountSummaries } from '@/lib/dataService';
import type { SourceKey, SourceStatus } from '@/lib/sourceStatus';

/**
 * ⑧ ONE FEED MUST NOT PRODUCE TWO ANSWERS — Targets versus the Dashboard.
 *
 * 🔴 F3 — THIS PAGE WAS STILL RESOLVING IDENTITY FROM THE RETIRED ALIAS STORE.
 *   It called `getAccountMapping(a.accountName, loadAccountMappings())`, matching Meta's
 *   CURRENT display name against `accountAliases[].sheetName` — a key written from the
 *   SHEET's names. Before the cutover the Dashboard called the identical function, so the
 *   two pages were wrong in the same direction and therefore AGREED, which is why nothing
 *   ever surfaced. After it, the Dashboard resolves program and status from `ad_accounts`
 *   through `account_id` and this page did not.
 *
 *   Measured live 2026-08-12 — 4 of 52 accounts diverged, and one of them counted an
 *   ARCHIVED account into a live target:
 *       SocialWorks $51,056.88  Dashboard Internal          · Targets Done For You
 *       Hiring       $1,904.03  Dashboard Internal/Churned  · Targets DFY/Active
 *       No Streaks   $7,018.17  Dashboard Done With You     · Targets Done For You
 *       STR            $987.60  Dashboard Unknown           · Targets Done For You
 *   Rendered: DFY Cost/Appt $652.88 here against $637.55 there, for the same window, the
 *   same feed and the same metric.
 *
 * 🔴 F5 — THE LEAD-TO-APPOINTMENT RATE HAD A DENOMINATOR FROM ANOTHER POPULATION.
 *   It divided ALL-active appointments by ALL-active LEADS. DWY means we run the ads and
 *   the CLIENT works the leads, so those accounts contribute leads and — by construction —
 *   no appointments. Every DWY lead inflated the denominator of a conversion it can never
 *   appear in the numerator of. Live: 2.1% here against 4.9% on the Dashboard, printed under
 *   "Target: above 15%" and coloured red against a benchmark it was never measured against.
 *
 * ⭐ THE LAW THESE ARMS ENCODE: A NAME IS NOT AN IDENTITY. Joining on a display name is the
 * exact bug the cutover removed — Meta renames accounts, five confirmed — and re-deriving
 * identity from a second, retired source on one page reintroduced it there. The registry is
 * already resolved onto the summaries this page builds; the fix is to stop asking twice.
 */

const useDataMock = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useData', () => ({ useData: useDataMock }));

const { default: Targets } = await import('./Targets');
const { ALL_DATES } = await import('@/lib/metaAdSpend');

const status = (over: Partial<SourceStatus> = {}): SourceStatus =>
  ({ label: 'src', state: 'valid', error: null, missingSettings: [], configured: true, ...over }) as SourceStatus;

/**
 * ⭐ EVERY META NAME HERE IS ONE META RENAME AWAY FROM THE ALIAS STORE'S KEY, on purpose.
 * `ad_accounts` says what each account IS; the legacy alias rows below say something
 * different for the same string, and they are keyed on the name the SHEET used. That is the
 * whole shape of the defect: the two stores disagree, and the page picked the wrong one.
 */
const REGISTRY = buildAccountRegistry(
  [
    { account_id: 'DFY-1', meta_name: 'Acme X SocialWorks', company_name: 'Acme Roofing', program: 'Done For You', media_buyer: 'Jez', status: 'active' },
    { account_id: 'INTERNAL-1', meta_name: 'SocialWorks', company_name: 'SocialWorks', program: 'Internal', media_buyer: 'Jez', status: 'active' },
    { account_id: 'DWY-1', meta_name: 'Zeta X SocialWorks', company_name: 'Zeta Exteriors', program: 'Done With You', media_buyer: 'Jez', status: 'active' },
    // The live `Hiring` row: `ad_accounts` says archived, which `resolveStatus` maps to
    // Churned. The alias store below still calls it Active, and Targets used to believe it.
    { account_id: 'ARCHIVED-1', meta_name: 'Hiring', company_name: 'Hiring', program: 'Internal', media_buyer: 'Jez', status: 'archived' },
  ],
  [{ airtable_name_key: 'acme roofing', airtable_name: 'Acme Roofing', account_id: 'DFY-1' }],
);

/**
 * ⛔ THE LEGACY STORE, POPULATED AND WRONG — and this is what makes the arms below
 * DISCRIMINATING rather than merely green. With it empty, `getAccountMapping` would have
 * fallen back to a default of Done For You / Active for every row, and the numbers would
 * have come out the same by coincidence. It says the opposite of `ad_accounts` for every
 * account, so any page still consulting it renders a visibly different figure.
 */
const SETTINGS = makeSettings({
  accountAliases: [
    { sheetName: 'SocialWorks', airtableName: 'SocialWorks', program: 'Done For You', status: 'Active', mediaBuyer: 'Jez' },
    { sheetName: 'Zeta X SocialWorks', airtableName: 'Zeta Exteriors', program: 'Done For You', status: 'Active', mediaBuyer: 'Jez' },
    { sheetName: 'Hiring', airtableName: 'Hiring', program: 'Done For You', status: 'Active', mediaBuyer: 'Jez' },
  ],
});

const SPEND = [
  makeAdSpendRow({ accountId: 'DFY-1', accountName: 'Acme X SocialWorks', campaignId: 'C-1', spent: 1000, leads: 100 }),
  makeAdSpendRow({ accountId: 'INTERNAL-1', accountName: 'SocialWorks', campaignId: 'C-2', spent: 9000, leads: 50 }),
  makeAdSpendRow({ accountId: 'DWY-1', accountName: 'Zeta X SocialWorks', campaignId: 'C-3', spent: 500, leads: 40 }),
  makeAdSpendRow({ accountId: 'ARCHIVED-1', accountName: 'Hiring', campaignId: 'C-4', spent: 4000, leads: 10 }),
];

/** Two appointments, both on the one real client. */
const APPTS = [
  makeAppointmentRow({ client: 'Acme Roofing', campaignId: 'C-1' }),
  makeAppointmentRow({ client: 'Acme Roofing', campaignId: 'C-1' }),
];

function mount() {
  const built = buildAccountSummaries(SPEND, APPTS, SETTINGS, { spend: true, appts: true }, REGISTRY);
  useDataMock.mockReturnValue({
    accounts: built.accounts,
    adSpend: SPEND,
    appointments: APPTS,
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
  return render(<Targets />);
}

/** A summary card's rendered value, read by its label. */
function card(label: string): string {
  const el = screen.getByText(label).parentElement;
  return el?.querySelector('p:nth-child(2)')?.textContent?.trim() ?? '';
}

beforeEach(() => useDataMock.mockReset());

describe('F3 — Targets resolves identity from `ad_accounts`, not from the retired alias store', () => {
  it('🔴 `Internal` IS NOT DONE-FOR-YOU, even though the alias store says it is', () => {
    mount();
    /**
     * DFY population is the one real client: $1,000 over 2 appointments = $500.00.
     * Reading identity from the alias store instead drags SocialWorks ($9,000), Zeta ($500)
     * and Hiring ($4,000) in, giving $7,250.00 — the shape of the live $652.88-vs-$637.55
     * divergence at fixture scale.
     */
    expect(card('DFY Cost/Appt')).toBe('$500.00');
  });

  it('🔴 AN ARCHIVED ACCOUNT IS NOT COUNTED INTO A LIVE TARGET', () => {
    // The live `Hiring` row. `ad_accounts.status = 'archived'` resolves to Churned, so it is
    // not Active and belongs in no target population — while the alias store still calls it
    // Active, which is what this page used to believe. Its $4,000 must appear nowhere.
    mount();
    expect(card('DFY CPL')).toBe('$10.00');   // $1,000 over 100 DFY leads
  });

  it('🔑 THE CONTROL THAT MAKES THOSE ARMS MEAN SOMETHING: the alias store really does disagree', () => {
    /**
     * ⛔ THE VACUITY THIS KILLS. If `getAccountMapping` would have returned the same program
     * for these accounts anyway, every arm above passes with the defect still in place. This
     * asserts the fixture's two stores genuinely conflict, so "which store did the page ask?"
     * is a question with two different visible answers.
     */
    expect(SETTINGS.accountAliases?.find(a => a.sheetName === 'SocialWorks')?.program).toBe('Done For You');
    expect(REGISTRY.byMetaName('SocialWorks')?.program).toBe('Internal');
    expect(SETTINGS.accountAliases?.find(a => a.sheetName === 'Hiring')?.status).toBe('Active');
    expect(REGISTRY.byMetaName('Hiring')?.status).toBe('archived');
  });

  it('🔴 THE MECHANISM: this page no longer imports the name-keyed mapping at all', () => {
    /**
     * A value assertion can be satisfied by a fixture that happens to agree. This is the
     * structural half: `getAccountMapping` is a NAME join, and a name is not an identity, so
     * its presence on this page is the defect regardless of what it currently returns.
     * Re-adding it puts the two pages back on two identity models.
     */
    const src = readFileSync('src/pages/Targets.tsx', 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/getAccountMapping/);
    expect(code).not.toMatch(/loadAccountMappings/);
  });
});

describe('F5 — the lead-to-appointment rate uses one population on both sides of the division', () => {
  it('🔴 THE DEFECT: DWY leads must not inflate the denominator', () => {
    mount();
    // 2 appointments over DFY's 100 leads = 2.0%. The old all-active denominator (100 DFY +
    // 40 DWY + 50 Internal + 10 archived = 200) gives 1.0% — half the true rate, printed
    // against a "Target: above 15%" benchmark it was never measured against.
    expect(card('Lead-to-Appt')).toBe('2.0%');
  });

  it('🔑 and the page SAYS which population it is describing, on every DFY-scoped bar', () => {
    // The scope line used to read "Funnel conversion", which named no population at all, and
    // "All accounts" on the CPL bar — which was not even true of the number above it.
    mount();
    expect(screen.getAllByText(/Done For You accounts · 1 Done-With-You and 1 Internal excluded/).length).toBe(3);
  });

  it('🔴 TARGETS AND THE DASHBOARD NOW AGREE — the same rule, computed on each page', () => {
    /**
     * The defect was never one wrong number; it was TWO numbers for one question, rendered as
     * fact two clicks apart. Both pages compute their own populations (they filter by
     * different date ranges), so the only thing that can hold them together is the same rule
     * written on both — asserted here as source, because a value comparison would pass on any
     * fixture where the two happen to coincide.
     */
    const rule = /a\.program !== 'Done With You' && a\.program !== 'Internal'/;
    const targets = readFileSync('src/pages/Targets.tsx', 'utf8');
    const dashboard = readFileSync('src/pages/Dashboard.tsx', 'utf8');
    expect(targets).toMatch(rule);
    expect(dashboard).toMatch(rule);
    // And both narrow to Active first, so an archived account cannot enter either page.
    expect(targets).toMatch(/filteredAccounts\.filter\(a => a\.status === 'Active'\)/);
    expect(dashboard).toMatch(/filteredAccounts\.filter\(a => a\.status === 'Active'\)/);
  });
});
