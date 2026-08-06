import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';
import { makeSettings, makeAdSpendRow } from '@/test/factories';

/**
 * 🔴 THE ENFORCEMENT ARM — MISSING UNTIL A SABOTAGE FOUND IT.
 *
 * ③ shipped with the predicate locked (11 arms) and the banner driven (3 arms). Then:
 *
 *   cut `if (!verdict.accept) return;` in useData  ->  432/432 GREEN 🔴
 *
 * ⭐ NOTHING PROVED THE DATA WAS ACTUALLY WITHHELD. With the enforcement cut, the banner
 * still renders "This refresh was REJECTED and the previous data is still shown" — while
 * the collapsed data replaces it. THE BANNER WOULD BE LYING, in the exact words it uses to
 * reassure. A verdict computed and displayed but not ACTED ON is worse than no verdict:
 * it is a confident false statement rather than silence.
 *
 * ⚠️ Three distinct wires on one feature — PREDICATE, RENDER, ENFORCEMENT — and only the
 * third can tell whether the product does what the screen says it does.
 */
const feed = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock('@/lib/dataService', async () => {
  const actual = await vi.importActual<typeof import('@/lib/dataService')>('@/lib/dataService');
  return {
    ...actual,
    fetchGoogleSheetData: async () => feed.rows,
    fetchAirtableData: async () => ({ records: [], fields: [] }),
    fetchCallCenterData: async () => [],
  };
});

vi.mock('@/lib/sheetCompleteness', async () => {
  const actual = await vi.importActual<typeof import('@/lib/sheetCompleteness')>('@/lib/sheetCompleteness');
  return {
    ...actual,
    checkSheetCompleteness: async () => ({ state: 'complete' as const, rawRows: 1, derivedRows: 1, droppedRows: 0, reason: null }),
  };
});

const SETTINGS = makeSettings({ googleSheetUrl: 'https://docs.google.com/spreadsheets/d/S/edit' });
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

/** Reads the two numbers the gate protects, and exposes the app's own refresh control. */
function Probe() {
  const { adSpend, refreshVerdict, refresh } = useData();
  return (
    <div>
      <span data-testid="rows">{adSpend.length}</span>
      <span data-testid="spend">{adSpend.reduce((s, r) => s + r.spent, 0)}</span>
      <span data-testid="accepted">{refreshVerdict ? String(refreshVerdict.accept) : 'none'}</span>
      <button onClick={() => refresh()}>refresh</button>
    </div>
  );
}

const rowsOf = (n: number) => Array.from({ length: n }, () => makeAdSpendRow({ accountName: 'Acme', spent: 100 }));

beforeEach(() => { feed.rows = rowsOf(100); localStorage.clear(); });

async function mountAndSettle() {
  const r = render(<DataProvider><Probe /></DataProvider>);
  await waitFor(() => expect(r.getByTestId('rows').textContent).toBe('100'));
  return r;
}

describe('useData — a REJECTED refresh must not replace the data', () => {
  it('🔴 ANTI-VACUITY CONTROL: a healthy second refresh DOES replace the data', async () => {
    // Run first. Without it the enforcement arm below passes if refresh were simply broken,
    // which is the mirror defect: a dashboard frozen on its first payload forever.
    const { getByTestId, getByText } = await mountAndSettle();

    feed.rows = rowsOf(120);
    fireEvent.click(getByText('refresh'));

    await waitFor(() => expect(getByTestId('rows').textContent).toBe('120'));
    expect(getByTestId('accepted').textContent).toBe('true');
  });

  it('🔴 THE ENFORCEMENT: after a COLLAPSE the GOOD numbers are still on screen', async () => {
    const { getByTestId, getByText } = await mountAndSettle();
    expect(getByTestId('spend').textContent).toBe('10000');

    // A tenth of the rows. Plausible on their own — 10 rows and $1,000 look like a real
    // small account — and only wrong beside what was there a moment ago.
    feed.rows = rowsOf(10);
    fireEvent.click(getByText('refresh'));

    await waitFor(() => expect(getByTestId('accepted').textContent).toBe('false'));
    // ⭐ THE ASSERTION THAT THE SABOTAGE EXPOSED: the data itself did not move.
    expect(getByTestId('rows').textContent).toBe('100');
    expect(getByTestId('spend').textContent).toBe('10000');
  });

  it('a rejection does NOT blank the page — the numbers are still real', async () => {
    // @fable: "Never blank the page — stale-but-labelled beats empty." A gate that empties
    // the dashboard to avoid showing a wrong number has replaced one failure with another.
    const { getByTestId, getByText } = await mountAndSettle();
    feed.rows = [];
    fireEvent.click(getByText('refresh'));

    await waitFor(() => expect(getByTestId('accepted').textContent).toBe('false'));
    expect(getByTestId('rows').textContent).toBe('100');
  });
});
