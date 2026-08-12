import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { makeSettings, makeAdSpendRow, makeAppointmentRow } from '@/test/factories';
import { buildAccountRegistry } from '@/lib/accountRegistry';
import type { SourceKey, SourceStatus } from '@/lib/sourceStatus';

/**
 * 🔴 A DATE FILTER MUST NOT CHANGE WHO AN ACCOUNT IS.
 *
 * THE DEFECT. `buildAccountSummaries(adSpend, appts, settings, known?, registry?)` has TWO
 * optional trailing arguments, and `registry` defaults to `emptyAccountRegistry()` — a
 * registry that answers nothing. That default is NOT neutral. It is the pre-cutover
 * identity model, in which an account is whatever Meta currently calls it.
 *
 * Dashboard, Targets and TeamPerformance each re-derive their own summaries when a date
 * range is active, and all three omitted that argument. So the app had TWO identity models
 * live at once, and which one you got depended on whether a date range was selected:
 *
 *     unfiltered   useData()      -> registry passed  -> `ad_accounts` decides identity
 *     filtered     the page memo  -> registry dropped -> Meta's raw label decides identity
 *
 * ⭐ WHY NOTHING ON SCREEN COULD SAY SO: both answers are entirely plausible. Measured
 * against the live database with the argument as the ONLY variable
 * (`scripts/probe-registry-drop.mts`, 2026-08-11, 48,611 rows):
 *
 *     TOTAL SPEND tile   $769,052.69 -> $770,956.72   (an ARCHIVED account returns as Active)
 *     TOTAL LEADS tile        30,393 ->      30,966
 *     company name       51 of 52 accounts fall back to Meta's label
 *     media buyer        TeamPerformance moved $162,519.70 from "Jez" to "Unassigned"
 *
 * ⚠️ AND IT SILENTLY REOPENED THE JOIN BUG THE CUTOVER EXISTS TO CLOSE. The registry is
 * what carries `ad_account_airtable_names` — the STABLE Airtable-client-name -> `account_id`
 * path. Drop it and appointments fall back to the legacy alias store and the fuzzy tier,
 * which are keyed on names Meta rewrites.
 *
 * ⛔ THESE TESTS ARE DELIBERATELY DRIVEN THROUGH THE REAL CONTROLS. Asserting on
 * `buildAccountSummaries` directly cannot fail for this defect — the function was always
 * correct. The bug was entirely in what the pages passed it, which is exactly the class
 * `SourceStatusBanner.origin.test.tsx` records at its own line 185: 21 green assertions
 * against a predicate that nothing called.
 */

const useDataMock = vi.hoisted(() => vi.fn());
const setSpendWindow = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useData', () => ({ useData: useDataMock }));

const { default: Dashboard } = await import('./Dashboard');
const { default: TeamPerformance } = await import('./TeamPerformance');
const { ALL_DATES } = await import('@/lib/metaAdSpend');

const status = (over: Partial<SourceStatus> = {}): SourceStatus =>
  ({ label: 'src', state: 'valid', error: null, missingSettings: [], configured: true, ...over }) as SourceStatus;

/** Today, as the app's own local `YYYY-MM-DD`. Every preset under test contains it. */
const now = new Date();
const p = (n: number) => String(n).padStart(2, '0');
const TODAY = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;

/**
 * TWO ACCOUNTS, AND EACH ONE ISOLATES A DIFFERENT CONSEQUENCE OF THE DROPPED ARGUMENT.
 *
 * ACCT-1  `ad_accounts` gives it a company name, a media buyer and a program that its Meta
 *         label does not carry. It is `active`, so it belongs in every Active-only total.
 * ACCT-2  `ad_accounts` says `archived`. `resolveStatus` maps that to Churned, so it must
 *         be EXCLUDED from the Active-only KPI tiles. With no registry it reverts to
 *         Active and its spend re-enters the headline — the live "Hiring" row exactly.
 */
const REGISTRY = buildAccountRegistry(
  [
    { account_id: 'ACCT-1', meta_name: 'Acme X SocialWorks', company_name: 'Acme Roofing', program: 'Done For You', media_buyer: 'Jez', status: 'active' },
    { account_id: 'ACCT-2', meta_name: 'Zeta X SocialWorks', company_name: 'Zeta Exteriors', program: 'Done For You', media_buyer: 'Jez', status: 'archived' },
  ],
  // The stable join key. Airtable's literal string on the left, Meta's primary key on the
  // right. NOTHING else in this fixture can connect the two — see the appointment below.
  [{ airtable_name_key: 'acme roofing', airtable_name: 'Acme Roofing', account_id: 'ACCT-1' }],
);

const SPEND = [
  makeAdSpendRow({ accountId: 'ACCT-1', accountName: 'Acme X SocialWorks', date: TODAY, dateISO: TODAY, campaignId: 'C-1', spent: 500, leads: 20 }),
  makeAdSpendRow({ accountId: 'ACCT-2', accountName: 'Zeta X SocialWorks', date: TODAY, dateISO: TODAY, campaignId: 'C-2', spent: 700, leads: 30 }),
];

/**
 * ⭐ THE APPOINTMENT CARRIES NO USABLE CAMPAIGN ID AND NO ALIAS, ON PURPOSE.
 *
 * Its client name is Airtable's ("Acme Roofing"); the account's label is Meta's
 * ("Acme X SocialWorks"). Tier 1 cannot fire (the campaign id is absent from the feed),
 * Tier 2's legacy store is empty, and Tier 4's fuzzy tier scores those two strings far
 * below its 0.85 threshold. So `ad_account_airtable_names` is the ONLY path that can
 * attribute it — which makes the count a direct measurement of whether the stable join
 * survived the date filter.
 */
const APPTS = [
  makeAppointmentRow({ client: 'Acme Roofing', campaignId: 'NOT-IN-FEED', adId: 'NOT-IN-FEED', dateAdded: TODAY, appointmentDate: TODAY }),
];

function baseData(over: Record<string, unknown> = {}) {
  return {
    // `accounts` is the UNFILTERED result and is not what these tests read. Leaving it
    // empty guarantees any number that appears was produced by the page's own filtered
    // recompute — the code path under test — rather than handed to it pre-built.
    accounts: [], adSpend: SPEND, appointments: APPTS, unmatchedAppointments: [],
    callData: [], settings: makeSettings(), loading: false, error: null, lastUpdated: null,
    configured: true, settingsLoaded: true, settingsOrigin: 'database' as const, settingsDetail: null,
    exclusions: { state: 'none-configured', configuredCount: 0, matchedCount: 0, unfilteredSpend: 0, affectedAccounts: [] },
    honestNumbers: { hasWarnings: false, messages: [], exclusion: {}, fabricatedRateCount: 0, allRatesFabricated: false },
    sources: { meta: status(), airtable: status() } as Record<SourceKey, SourceStatus>,
    refresh: async () => {}, setSettings: () => {},
    spendWindow: ALL_DATES, setSpendWindow,
    accountRegistry: REGISTRY,
    ...over,
  };
}

beforeEach(() => { useDataMock.mockReset(); setSpendWindow.mockReset(); });

describe('TeamPerformance — its default preset is `this_month`, so the filtered path runs on mount', () => {
  it('🔴 groups by the CURATED media buyer, not by "Unassigned"', async () => {
    useDataMock.mockReturnValue(baseData());
    render(<TeamPerformance />);
    // `buildTeamPerformance` buckets on `account.mediaBuyer || 'Unassigned'`. `ad_accounts`
    // says Jez; the Meta label says nothing. Without the registry every account in the
    // product collapses into one anonymous bucket.
    await waitFor(() => expect(screen.getAllByText('Jez').length).toBeGreaterThan(0));
    expect(screen.queryByText('Unassigned')).toBeNull();
  });

  it('🔑 ANTI-VACUITY CONTROL: the same page WITHOUT a registry does read "Unassigned"', async () => {
    /**
     * Without this arm the test above passes for a page that renders "Jez" from anywhere at
     * all — a fixture label, a heading, a stale prop. This proves the assertion is wired to
     * the argument and not to the string, by flipping ONLY the argument.
     */
    useDataMock.mockReturnValue(baseData({ accountRegistry: undefined }));
    render(<TeamPerformance />);
    await waitFor(() => expect(screen.getAllByText('Unassigned').length).toBeGreaterThan(0));
    expect(screen.queryByText('Jez')).toBeNull();
  });
});

describe('Dashboard — the defect appears the moment a user picks a range', () => {
  /** Drive the actual control a user clicks, not a state setter. */
  function selectPreset(label: string) {
    fireEvent.click(screen.getByRole('button', { name: /all time|date|range/i }));
    fireEvent.click(screen.getByText(label));
  }

  /**
   * ⚠️ READ THE TILE, NOT THE PAGE. `getByText('$500.00')` throws "found multiple
   * elements" here — the account ROW carries the same figure as the TOTAL, because this
   * fixture has one Active account. Scoping to the labelled tile is not tidiness: a bare
   * text query would have made the two assertions below indistinguishable from each other.
   */
  const tile = (label: string) => screen.getByText(label).parentElement!.textContent ?? '';

  it('🔴 an ARCHIVED account stays out of the Active-only Total Spend after filtering', async () => {
    useDataMock.mockReturnValue(baseData());
    render(<Dashboard />);
    selectPreset('Today');

    // ACCT-1 only. ACCT-2 is `archived` -> Churned -> not an Active account. With the
    // registry dropped it returns as Active and the tile reads $1,200.00 instead.
    await waitFor(() => expect(tile('Total Spend')).toContain('$500.00'));
    expect(tile('Total Spend')).not.toContain('$1,200.00');
    expect(tile('Total Leads')).toContain('20');
  });

  it('🔑 ANTI-VACUITY CONTROL: without the registry the archived account DOES re-enter', async () => {
    /**
     * The same page, the same rows, the same click — only the argument differs. Without
     * this arm the assertion above passes for any page that renders $500.00 for any
     * reason, and could not tell a working filter from a broken one.
     */
    useDataMock.mockReturnValue(baseData({ accountRegistry: undefined }));
    render(<Dashboard />);
    selectPreset('Today');

    await waitFor(() => expect(tile('Total Spend')).toContain('$1,200.00'));
    expect(tile('Total Leads')).toContain('50');
  });

  /**
   * 🔴 THE FIRST VERSION OF THIS TEST WAS VACUOUS, AND THE CONTROL IS WHAT SAID SO.
   *
   * It asserted TOTAL APPTS reads 1. That passed in BOTH arms — a true statement that
   * cannot express the defect. `Dashboard.tsx` deliberately adds `unmatchedInView` to that
   * tile so a booking nobody could attribute is still counted, so the headline is 1 whether
   * the appointment reached its account or fell on the floor. Counting is not attributing.
   *
   * AVG COST/APPT is the tile that can tell them apart: its denominator is `dfyAppts`,
   * which reduces over ACCOUNTS and therefore cannot see an unmatched appointment at all.
   *   with the registry     $500 spend / 1 attributed appointment  -> $500.00
   *   without it            the appointment matches nothing, 0     -> '—'
   */
  it('🔴 THE JOIN: the appointment is ATTRIBUTED, and only ad_account_airtable_names can do it', async () => {
    useDataMock.mockReturnValue(baseData());
    render(<Dashboard />);
    selectPreset('Today');

    await waitFor(() => expect(tile('Avg Cost/Appt')).toContain('$500.00'));
    // The rate tile shares the same numerator population: 1 appointment over 20 leads.
    expect(tile('Lead → Appt %')).toContain('5');
  });

  it('🔑 ANTI-VACUITY CONTROL: without the registry that appointment reaches no account', async () => {
    useDataMock.mockReturnValue(baseData({ accountRegistry: undefined }));
    render(<Dashboard />);
    selectPreset('Today');

    // '—' is this app's symbol for "not knowable", and here it is the honest answer: the
    // legacy alias store is empty, the campaign id is absent from the feed, and the fuzzy
    // tier scores "Acme Roofing" against "Acme X SocialWorks" far below its 0.85 gate.
    await waitFor(() => expect(tile('Avg Cost/Appt')).toContain('—'));
    expect(tile('Avg Cost/Appt')).not.toContain('$500.00');
  });
});

describe('THE LAW, MECHANISED — every page-level recompute passes a registry', () => {
  /**
   * ⚠️ THE BEHAVIOURAL ARMS ABOVE CANNOT COVER Targets: its preset defaults to `all`, its
   * control is a custom combobox, and driving it would test the combobox. This arm covers
   * all three pages at once by reading what they actually call.
   *
   * ⛔ AND IT CARRIES A POPULATION CONTROL, because a source scan is the check that most
   * reliably fakes a PASS: a renamed file, a moved call, or a regex that stops matching all
   * return "nothing wrong" from "nothing measured". So the expected number of call sites is
   * asserted FIRST. If a page stops re-deriving summaries, this fails and someone reads it,
   * rather than passing on an empty set.
   */
  const PAGES = ['src/pages/Dashboard.tsx', 'src/pages/Targets.tsx', 'src/pages/TeamPerformance.tsx'];

  /**
   * ⭐ COMMENTS ARE STRIPPED FIRST, AND THE POPULATION CONTROL IS WHAT REVEALED WHY.
   *
   * Its first run reported [1, 2, 2]. Targets.tsx and TeamPerformance.tsx each carry a
   * PROSE mention — "this page RE-DERIVES its own accounts via
   * buildAccountSummaries(filteredSpend, …)" — and a scanner that counts those is measuring
   * documentation, not behaviour. It would have failed on a correct file and, worse, could
   * be satisfied by a comment on an incorrect one.
   */
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

  const callsIn = (raw: string) => {
    const src = stripComments(raw);
    const out: string[] = [];
    let i = src.indexOf('buildAccountSummaries(');
    while (i !== -1) {
      // Walk the balanced parens so a multi-line call with nested object literals is read
      // whole. A line-based regex would truncate every one of these calls at its first line.
      let depth = 0;
      let j = i + 'buildAccountSummaries'.length;
      const start = j;
      for (; j < src.length; j++) {
        if (src[j] === '(') depth++;
        else if (src[j] === ')') { depth--; if (depth === 0) break; }
      }
      out.push(src.slice(start + 1, j));
      i = src.indexOf('buildAccountSummaries(', j);
    }
    return out;
  };

  it('🔑 POPULATION CONTROL: exactly one recompute per page, and the parser found them', () => {
    const found = PAGES.map(f => callsIn(readFileSync(f, 'utf8')).length);
    expect(found).toEqual([1, 1, 1]);
  });

  it('🔴 each one passes BOTH trailing arguments — `known` AND the registry', () => {
    for (const file of PAGES) {
      for (const args of callsIn(readFileSync(file, 'utf8'))) {
        // Top-level commas only: the `known` argument is an object literal full of commas.
        let depth = 0;
        let count = 1;
        for (const ch of args) {
          if (ch === '(' || ch === '{' || ch === '[') depth++;
          else if (ch === ')' || ch === '}' || ch === ']') depth--;
          else if (ch === ',' && depth === 0) count++;
        }
        expect(count, `${file}: buildAccountSummaries must be called with 5 arguments`).toBe(5);
        expect(args, `${file}: the 5th argument must be the registry from useData()`).toContain('accountRegistry');
      }
    }
  });
});
