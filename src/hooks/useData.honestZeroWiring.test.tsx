import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { makeSettings, makeAdSpendRow } from '@/test/factories';

/**
 * 🔴 THE THIRD WIRE ON THE HONEST-ZERO GUARANTEE, AND THE ONLY ONE NOTHING TESTED.
 *
 * "A dead source must render an em dash, never a zero" is built from three separate pieces:
 *
 *   ① THE PREDICATE   `hasUsableData(state)`            — 59 tests go red if it is removed
 *   ② THE CONSUMPTION `buildAccountSummaries(known)`    — goes red if `??` becomes `||`
 *   ③ THE WIRING      useData passing ① into ②          — 🔴 NOTHING
 *
 * Measured on this tree before this file existed:
 *
 *     `appts: hasUsableData(statuses.airtable.state)` -> `appts: true`  ->  745/745 GREEN 🔴
 *     `spend: hasUsableData(statuses.meta.state)`     -> `spend: true`  ->  745/745 GREEN 🔴
 *
 * ⚠️ THE FIRST ONE IS USER-VISIBLE AND IT IS THE DEFECT THIS PRODUCT WAS REBUILT TO PREVENT.
 * Airtable down while Meta is up is not exotic — the proxy 401s on a rotated token. Ad spend
 * still arrives, so accounts EXIST and their rows render. `Dashboard.tsx:214` prints
 * `account.apptsKnown === false ? '—' : formatNumber(account.appointments)`, so with the wire
 * cut every account reports **0 appointments** — and 0 appointments against real spend is not
 * a missing number, it is a claim that the client booked nothing. Cost-per-appointment and
 * lead-to-appointment then divide by it.
 *
 * ⛔ THE KPI TILES DO NOT COVER THIS. They compute `spendOk`/`apptsOk` from `sources`
 * directly (Dashboard.tsx:1072) and would still read "—" — so a tile-level assertion passes
 * while every ROW beneath it lies. That is @bird's measured "tiles read — beside a table
 * reading $0.00", which is exactly why the honest state has to live in the DATA and not only
 * at the render layer.
 */

const feed = vi.hoisted(() => ({ rows: [] as unknown[], airtableFails: false, metaFails: false }));

vi.mock('@/lib/metaAdSpend', async () => {
  const actual = await vi.importActual<typeof import('@/lib/metaAdSpend')>('@/lib/metaAdSpend');
  return {
    ...actual,
    fetchMetaAdSpend: async () => {
      if (feed.metaFails) throw new Error('meta is down');
      return feed.rows;
    },
    checkMetaCompleteness: async () => ({ state: 'complete' as const, rawRows: 1, derivedRows: 1, droppedRows: 0, reason: null }),
  };
});

vi.mock('@/lib/dataService', async () => {
  const actual = await vi.importActual<typeof import('@/lib/dataService')>('@/lib/dataService');
  return {
    ...actual,
    fetchAirtableData: async () => {
      if (feed.airtableFails) throw new Error('airtable proxy 401');
      return { records: [], fields: [] };
    },
  };
});

const SETTINGS = makeSettings();
vi.mock('@/lib/config', async () => {
  const actual = await vi.importActual<typeof import('@/lib/config')>('@/lib/config');
  return {
    ...actual,
    loadSettings: () => ({ ...actual.DEFAULT_SETTINGS, ...SETTINGS }),
    loadSettingsWithSource: async () => ({ settings: { ...actual.DEFAULT_SETTINGS, ...SETTINGS }, origin: 'database' as const, detail: null }),
    loadAccountMappings: () => [],
    loadAccountMappingsAsync: async () => [],
  };
});

const { DataProvider, useData } = await import('./useData');

/**
 * Reports the honest-state flags AS THEY LAND ON THE SUMMARY — the value `Dashboard.tsx`
 * branches on to choose between a number and an em dash.
 */
function Probe() {
  const { accounts, sources } = useData();
  const a = accounts[0];
  return (
    <div>
      <span data-testid="n">{accounts.length}</span>
      <span data-testid="metaState">{sources.meta.state}</span>
      <span data-testid="airState">{sources.airtable.state}</span>
      <span data-testid="spendKnown">{a ? String(a.spendKnown) : 'no-accounts'}</span>
      <span data-testid="apptsKnown">{a ? String(a.apptsKnown) : 'no-accounts'}</span>
    </div>
  );
}

beforeEach(() => {
  feed.rows = [makeAdSpendRow({ accountName: 'Acme', spent: 500, leads: 10 })];
  feed.airtableFails = false;
  feed.metaFails = false;
  localStorage.clear();
});

describe('useData — a dead source must reach the SUMMARY as unknown, not as zero', () => {
  it('AIRTABLE down, META up: accounts exist and carry apptsKnown=false', async () => {
    feed.airtableFails = true;
    const r = render(<DataProvider><Probe /></DataProvider>);

    await waitFor(() => expect(r.getByTestId('airState').textContent).toBe('failed'));
    /**
     * ⚠️ THE FLAG IS ASSERTED INSIDE THE `waitFor`, NOT AFTER IT, AND THAT IS NOT A
     * WEAKENING. Measured 2026-08-12: this arm failed once in six full-suite runs
     * ("expected 'true' to be 'false'") and passed 5/5 in isolation, so it is load-sensitive
     * rather than wrong. Two refreshes fire on mount (useData.tsx:356 and :368) and the
     * rejected-verdict path at :285-290 updates SOURCES without updating ACCOUNTS, so
     * `airState` and the summary flags can legitimately land in different commits. A bare
     * `waitFor` on `n` followed by a synchronous read asserts against whichever commit the
     * poll happened to catch.
     *
     * ⛔ IT STILL FAILS WHEN THE PRODUCT IS WRONG. The claim being guarded is that the flag
     * REACHES THE SUMMARY as false; a flag that is never false times out here and the arm
     * goes red. Instrumenting the render sequence showed the settled commit is a single
     * `n=1 air=failed apptsKnown=false spendKnown=true`, so there is no true-then-false
     * flicker being papered over.
     */
    // The account is real and its spend is real; only the appointment side is unknown.
    await waitFor(() => {
      expect(r.getByTestId('n').textContent).toBe('1');
      expect(r.getByTestId('apptsKnown').textContent).toBe('false');
    });
    // ⚠️ And the spend side must NOT be dragged down with it: one dead source may not
    // blank a healthy one. That conflation was the 2026-08-05 production incident.
    expect(r.getByTestId('spendKnown').textContent).toBe('true');
  });

  it('both sources healthy: both flags are true, so real numbers still render', async () => {
    const r = render(<DataProvider><Probe /></DataProvider>);

    await waitFor(() => expect(r.getByTestId('n').textContent).toBe('1'));
    expect(r.getByTestId('apptsKnown').textContent).toBe('true');
    expect(r.getByTestId('spendKnown').textContent).toBe('true');
  });

  it('META down on a cold load: the source is failed, never a valid read of zero rows', async () => {
    feed.metaFails = true;
    const r = render(<DataProvider><Probe /></DataProvider>);

    await waitFor(() => expect(r.getByTestId('metaState').textContent).toBe('failed'));
    // No spend rows means no accounts to render at all — the honest empty, not a table of
    // zeroes. The KPI tiles above them read "—" off `sources.meta.state` for the same reason.
    expect(r.getByTestId('n').textContent).toBe('0');
    expect(r.getByTestId('spendKnown').textContent).toBe('no-accounts');
  });
});
