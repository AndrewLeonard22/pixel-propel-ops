import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SourceKey, SourceStatus } from '@/lib/sourceStatus';
import type { SettingsOrigin } from '@/lib/config';

/**
 * THE NINETEEN. @bird drove every routed page of the live broken deployment:
 *
 *   route          "Missing:" lines    names the real cause?
 *   /                     3                   false
 *   /agents               3                   false
 *   /call-center          4                   false
 *   /targets              3                   false
 *   /team                 3                   false
 *   /calendar             3                   false
 *                       ────
 *                        19 sentences blaming @andrew's configuration
 *   occurrences of supabase / database / deployment across all of them:  ZERO
 *
 * @raccoon reconciled it to the source: this component × 6 routes = 18, plus
 * CallCenter.tsx:704 = 19. Neither census could see the whole number — his counted
 * TEMPLATES, @bird's counted RENDERS, and 19 is their product.
 *
 * ⭐ WHY THIS FILE EXISTS SEPARATELY FROM ConfigBanner.test.tsx, AND IT IS THE WHOLE
 * LESSON: ConfigBanner only mounts when `configured` is FALSE, and it returns early. That
 * is the COLD-browser surface. @bird measured a WARM browser, where `configured` is true,
 * ConfigBanner never renders, and THIS component does all nineteen of the talking. I fixed
 * ConfigBanner first and it closed none of the 19. A sound fix to one surface is not a
 * claim about the other — the two are invisible to each other's tests.
 */
const useDataMock = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useData', () => ({ useData: useDataMock }));

const { default: SourceStatusBanner } = await import('./SourceStatusBanner');

function status(over: Partial<SourceStatus>): SourceStatus {
  return {
    label: 'Ad spend (Windsor)',
    state: 'valid',
    error: null,
    missingSettings: [],
    configured: true,
    ...over,
  } as SourceStatus;
}

type Comp = { state: 'complete' | 'truncated' | 'unverifiable'; rawRows: number | null; derivedRows: number | null; droppedRows: number; reason: string | null };
const HEALTHY: Comp = { state: 'complete', rawRows: 1, derivedRows: 1, droppedRows: 0, reason: null };

function mount(origin: SettingsOrigin, detail: string | null = null, completeness: Comp = HEALTHY, refreshVerdict: unknown = null, unresolvedClients = 0, route = '/some-future-page') {
  useDataMock.mockReturnValue({
    settingsLoaded: true,
    adSpend: [],
    completeness,
    refreshVerdict,
    unresolvedClients,
    loading: false,
    refresh: () => {},
    setSpendWindow: () => {},
    settingsOrigin: origin,
    settingsDetail: detail,
    sources: {
      meta: status({ label: 'Ad spend (Windsor)', state: 'not-configured', configured: false, missingSettings: ['Google Sheet URL'] }),
      airtable: status({ label: 'Appointments (Airtable)', state: 'not-configured', configured: false, missingSettings: ['Airtable base ID'] }),
    } as Record<SourceKey, SourceStatus>,
  });
  return render(
    <MemoryRouter initialEntries={[route]}><SourceStatusBanner /></MemoryRouter>,
  );
}

beforeEach(() => useDataMock.mockReset());

describe('SourceStatusBanner — 18 of @bird’s 19 false claims come from here', () => {
  it('🔴 ANTI-VACUITY CONTROL: with a VERIFIED origin the per-source lines still enumerate', () => {
    // Without this arm the fix is satisfiable by deleting the "Missing:" copy outright,
    // which would destroy the signal a genuinely unconfigured user needs.
    const { container } = mount('local-no-row');

    expect(container.textContent).toMatch(/Missing: Google Sheet URL/);
    expect(container.textContent).toMatch(/Missing: Airtable base ID/);
    // Two sources, two claims — @raccoon's per-route template count, now that the
    // call-centre source has been deleted outright.
    // ⚠️ MOUNTED ON AN UNLISTED ROUTE DELIBERATELY: the banner is ROUTE-SCOPED, and this arm
    // is about the copy existing at all, so it must run where every source is relevant.
    expect((container.textContent ?? '').match(/Missing:/g) ?? []).toHaveLength(2);
  });

  it('🔴 THE LIVE STATE: an unconfigured BUILD emits ZERO "Missing:" claims', () => {
    const { container } = mount('local-not-configured');

    expect((container.textContent ?? '').match(/Missing:/g) ?? []).toHaveLength(0);
    expect(container.textContent).toMatch(/deployed without its database URL/i);
    // @bird's measurement of the defect: ZERO occurrences of the real cause on any route.
    expect(container.textContent).toMatch(/database/i);
  });

  it('it does NOT name any individual source as not-connected when we never read settings', () => {
    const { container } = mount('local-not-configured');
    expect(container.textContent).not.toMatch(/not connected/i);
    expect(container.textContent).toMatch(/has not been lost or changed/i);
  });

  it('an UNREACHABLE database says so, shows the reason, and OFFERS retry', () => {
    const { container } = mount('local-unreachable', 'TypeError: Failed to fetch');

    expect(container.textContent).toMatch(/could not be read from the database/i);
    expect(container.textContent).toMatch(/TypeError: Failed to fetch/);
    expect(screen.getByRole('button', { name: /try again/i })).toBeVisible();
  });

  it('🔑 an unconfigured BUILD offers NO retry — a button that cannot work is a false promise', () => {
    mount('local-not-configured');
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('stays silent before the settings have loaded', () => {
    useDataMock.mockReturnValue({
      settingsLoaded: false,
      adSpend: [],
      completeness: { state: 'complete' as const, rawRows: 1, derivedRows: 1, droppedRows: 0, reason: null },
      loading: true,
      refresh: () => {},
      settingsOrigin: 'local-not-configured' as SettingsOrigin,
      settingsDetail: null,
      sources: { meta: status({}), airtable: status({}) } as Record<SourceKey, SourceStatus>,
    });
    const { container } = render(<MemoryRouter><SourceStatusBanner /></MemoryRouter>);
    expect(container.textContent).toBe('');
  });

  it('🔴 THE COUNT @bird MEASURED: 3 per route before, 0 after — same sources, same mount', () => {
    // The defect is a COUNT across routes, so the assertion is a count. Asserting only
    // that the new copy is present would pass even if all three lies stayed beside it.
    const before = mount('local-no-row', null, HEALTHY, null, 0, '/some-future-page').container.textContent ?? '';
    useDataMock.mockReset();
    const after = mount('local-not-configured', null, HEALTHY, null, 0, '/some-future-page').container.textContent ?? '';

    expect((before.match(/Missing:/g) ?? []).length).toBe(2);
    expect((after.match(/Missing:/g) ?? []).length).toBe(0);
    expect(before).not.toBe(after);
  });
});

describe('SourceStatusBanner — a source is reported where it FEEDS the page, not everywhere', () => {
  it('/calendar reports ONLY Airtable — the sheet feeds no number on that page', () => {
    // @andrew: «remove this too», about a source line with no consequence on the surface
    // being looked at. /calendar renders appointments and nothing else, so a missing ad
    // spend sheet changes NO number there.
    // ⚠️ RE-POINTED 2026-08-11. This arm used to assert the DASHBOARD omits the call-centre
    // sheet; that source was deleted outright, so the assertion became unfalsifiable — it
    // would pass over a banner that had been deleted too. Moved to a scoping pair that
    // still exists rather than left as decoration.
    const { container } = mount('local-no-row', null, HEALTHY, null, 0, '/calendar');
    expect(container.textContent).not.toMatch(/Google Sheet URL/);
    expect(container.textContent).toMatch(/Missing: Airtable base ID/);
    expect((container.textContent ?? '').match(/Missing:/g) ?? []).toHaveLength(1);
  });

  it('🔴 ANTI-VACUITY: the dashboard STILL reports the sources it does depend on', () => {
    // Without this, the arm above passes if the banner were deleted outright.
    const { container } = mount('local-no-row', null, HEALTHY, null, 0, '/');
    expect(container.textContent).toMatch(/Missing: Google Sheet URL/);
    expect(container.textContent).toMatch(/Missing: Airtable base ID/);
    expect((container.textContent ?? '').match(/Missing:/g) ?? []).toHaveLength(2);
  });

  it('🔑 SCOPED, NOT SILENCED: the pages that DO consume the sheet still report it', () => {
    // The other half of the arm above, and the half that stops scoping from becoming
    // silencing: /targets and /team both derive every number from the ad spend feed, so a
    // missing sheet costs a number there and must still be named.
    for (const route of ['/targets', '/team']) {
      useDataMock.mockReset();
      const { container } = mount('local-no-row', null, HEALTHY, null, 0, route);
      expect(container.textContent, route).toMatch(/Google Sheet URL/);
    }
  });

  it('an UNLISTED route reports every source — silence must be opted into, never inherited', () => {
    const { container } = mount('local-no-row', null, HEALTHY, null, 0, '/some-future-page');
    expect((container.textContent ?? '').match(/Missing:/g) ?? []).toHaveLength(2);
  });
});

/**
 * 🔴 THE WIRING, NOT THE PREDICATE — AND THIS FILE EXISTS BECAUSE A SABOTAGE CAUGHT ME.
 *
 * sheetCompleteness.test.ts locks the judgement with 21 arms and every one of them passes
 * with the BANNER COMPLETELY DISCONNECTED. I proved it: replacing the consumer with
 * `const incomplete = null` left all 379 tests GREEN, and so did bypassing the probe call
 * in useData.
 *
 * ⭐ A DETECTOR NOTHING RENDERS IS A DOCUMENTED LIMIT, NOT A SHIPPED ONE — I wrote that
 * sentence in the commit for the detector itself and then shipped the wiring without a
 * single arm that could tell whether it was connected. The predicate being perfect is
 * exactly what makes this invisible: every test passes, and the user sees nothing.
 */
describe('SourceStatusBanner — the CLIFF actually reaches the screen', () => {
  const TRUNCATED: Comp = { state: 'truncated', rawRows: 39446, derivedRows: 39388, droppedRows: 58, reason: null };
  const UNVERIFIABLE: Comp = { state: 'unverifiable', rawRows: null, derivedRows: 5, droppedRows: 0, reason: 'the row count could not be read back from Supabase' };

  it('🔴 A TRUNCATING SHEET IS ON SCREEN, with the dropped-row count', () => {
    const { container } = mount('database', null, TRUNCATED);
    expect(container.textContent).toMatch(/INCOMPLETE/);
    expect(container.textContent).toMatch(/58/);
    /**
     * ⚠️ THE REMEDY MOVED WITH THE SOURCE. This asserted /array formula/ while the sheet
     * fed the dashboard. Post-cutover a short read is a PAGING or query limit against
     * `ad_insights` — the data is in the database — and the copy has to say so, or it
     * sends the reader to a Google Sheet that no longer feeds anything.
     */
    expect(container.textContent).toMatch(/paging or query limit/i);
  });

  it('🔑 UNVERIFIABLE is reported too — not knowing is a state, not health', () => {
    const { container } = mount('database', null, UNVERIFIABLE);
    expect(container.textContent).toMatch(/could not be verified/i);
    expect(container.textContent).toMatch(/could not be read back/);
  });

  it('🔴 ANTI-VACUITY CONTROL: a COMPLETE sheet renders NOTHING about completeness', () => {
    // Without this the wiring is satisfiable by always showing the warning, which is how a
    // real warning stops being read — and this banner is silent furniture when healthy.
    const { container } = mount('database', null, HEALTHY);
    expect(container.textContent ?? '').not.toMatch(/INCOMPLETE|could not be verified/i);
  });

  it('a truncating sheet alone is enough to MOUNT the banner — no failed source needed', () => {
    // The load-bearing wiring fact: every other predicate in this component asks whether a
    // source FAILED. A truncating sheet fails nothing, so without an explicit term in the
    // early return the whole banner never renders and the finding reaches no one.
    useDataMock.mockReturnValue({
      settingsLoaded: true, loading: false, refresh: () => {},
      settingsOrigin: 'database' as SettingsOrigin, settingsDetail: null,
      adSpend: [], completeness: TRUNCATED, refreshVerdict: null,
      sources: {
        meta: status({ state: 'valid' }), airtable: status({ state: 'valid' }),
      } as Record<SourceKey, SourceStatus>,
    });
    const { container } = render(<MemoryRouter><SourceStatusBanner /></MemoryRouter>);
    expect(container.textContent).toMatch(/INCOMPLETE/);
  });
});

/**
 * ③ THE VALIDATION GATE REACHES THE SCREEN.
 *
 * @fable's contract: "a collapse means REJECT, keep last-known-good, and say so on screen
 * with BOTH numbers." The predicate is locked in refreshValidation.test.ts and — as this
 * branch has now proven six times — a perfect predicate with no consumer renders nothing.
 */
describe('SourceStatusBanner — a REJECTED refresh says so on screen', () => {
  const REJECTED = {
    accept: false,
    reasons: ['total spend fell from $655,675.16 to $320,000.00'],
    next: { rowCount: 38997, totalSpend: 320000, accountCount: 61 },
    lastGood: { rowCount: 38997, totalSpend: 655675.16, accountCount: 61 },
  };
  const ACCEPTED = { accept: true, reasons: [], next: REJECTED.next, lastGood: REJECTED.lastGood };

  it('🔴 ANTI-VACUITY CONTROL: an ACCEPTED refresh says nothing about rejection', () => {
    const { container } = mount('database', null, HEALTHY, ACCEPTED);
    expect(container.textContent ?? '').not.toMatch(/REJECTED/);
  });

  it('🔴 a REJECTED refresh is ON SCREEN with BOTH numbers', () => {
    const { container } = mount('database', null, HEALTHY, REJECTED);
    const t = container.textContent ?? '';
    expect(t).toMatch(/REJECTED/);
    expect(t).toMatch(/655,675\.16/);
    expect(t).toMatch(/320,000\.00/);
    expect(t).toMatch(/previous data is still shown/);
  });

  it('a rejection alone MOUNTS the banner — no failed source needed', () => {
    // The wiring fact: every other predicate here asks whether a source FAILED, and a
    // rejected refresh fails nothing. Without an explicit term in the early return the
    // whole component never renders and the rejection reaches no one.
    const { container } = mount('database', null, HEALTHY, REJECTED);
    expect(container.textContent).toMatch(/REJECTED/);
  });
});

/**
 * A — THE BANNER MUST NAME THE REMEDY, AND THE REMEDY MUST BE THE RIGHT ONE.
 *
 * @bird measured every candidate against the known account names: Attribution Key,
 * Service/Campaign, Client Billing Model and Campaign Name all matched ZERO accounts —
 * they hold campaign, service and billing. `Client Name` is the ONLY client identifier and
 * it is a linked record.
 *
 * ⇒ So this is a SCHEMA change, not a columnMappings change, and the banner previously said
 *   "until the Airtable field is mapped to a text column" — pointing at a text field THAT
 *   DOES NOT EXIST. A remedy that cannot be followed is worse than no remedy: it sends the
 *   reader to look for something that is not there and makes the tool look wrong.
 */
describe('SourceStatusBanner — the unresolved-client remedy', () => {
  /**
   * ⭐ THIS ARM INVERTED WHEN THE RESOLVER LANDED. It used to require the Lookup-field
   * REMEDY on screen. @andrew called that «bs» — it was homework to work around our
   * limitation — and the resolver now does it in code: @bird measured 43 → 1 live with the
   * TOTAL APPTS tile holding at 679, so nothing was dropped.
   *
   * ⛔ THE ASSERTION IS NOW THAT NO REMEDY IS OFFERED. The survivors are appointments with
   * NO CLIENT RECORDED — there is nothing to configure, and any instruction would be the
   * same homework in a new sentence.
   */
  it('🔴 states the FACT and offers NO homework', () => {
    const { container } = mount('database', null, HEALTHY, null, 1);
    const t = container.textContent ?? '';
    expect(t).toMatch(/1 appointment has no client recorded in Airtable/i);
    expect(t).toMatch(/attribution gap, not a missing booking/i);
    // The old instruction must be GONE, not merely softened.
    expect(t).not.toMatch(/Lookup field/i);
    expect(t).not.toMatch(/column mappings/i);
    expect(t).not.toMatch(/add a/i);
  });

  it('pluralises honestly at @bird\'s pre-resolver count', () => {
    const { container } = mount('database', null, HEALTHY, null, 43);
    expect(container.textContent).toMatch(/43 appointments have no client recorded/i);
  });

  it('🔑 says they ARE counted — the P0 was counting them, and the copy must agree', () => {
    // If the banner said they were excluded while the tile counted them, the screen would
    // contradict itself and one of the two would be believed.
    const { container } = mount('database', null, HEALTHY, null, 43);
    expect(container.textContent).toMatch(/still counted in the appointment totals/i);
  });

  /**
   * 🔴 THIS CONTROL WENT VACUOUS WHEN I REWROTE THE COPY IT GUARDS.
   *
   * It asserted the absence of "Lookup field" — a string the rewrite DELETED FROM EVERY
   * STATE. So it passed whether the banner fired or not, and a sabotage making the banner
   * fire at ZERO unresolved (`> 0` → `>= 0`) went GREEN with a verified plant.
   *
   * ⭐ AN ANTI-VACUITY ARM PINNED TO THE OLD WORDING BECOMES VACUOUS THE MOMENT THE WORDING
   * CHANGES — and it does so silently, because deleting a string can only make a
   * `not.toMatch` MORE true. Assert against the CURRENT sentence, and against the banner
   * being absent at all.
   */
  it('🔴 ANTI-VACUITY CONTROL: zero unresolved renders NO unresolved sentence', () => {
    const { container } = mount('database', null, HEALTHY, null, 0);
    const t = container.textContent ?? '';
    expect(t).not.toMatch(/no client recorded/i);        // the CURRENT copy
    expect(t).not.toMatch(/attribution gap/i);
    expect(t).not.toMatch(/Lookup field/i);              // and the retired one stays gone
  });
});
