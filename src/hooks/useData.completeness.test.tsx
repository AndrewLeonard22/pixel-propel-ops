import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { makeSettings } from '@/test/factories';

/**
 * 🔴 THE SETTING MUST ACTUALLY REACH THE DETECTOR — AND NOTHING CHECKED THAT.
 *
 * I shipped `adsRawTabName` as a real setting and then sabotaged my own wiring before
 * claiming it worked:
 *
 *   replace `s.adsRawTabName ?? DEFAULT` with the constant .... 387/387 GREEN 🔴
 *   render the Settings field with a hardcoded '' .............. 387/387 GREEN 🔴
 *
 * ⭐ A CORRECT VALUE WITH NO CONSUMER. @apprentice counted it: this branch has now found
 * that exact shape SIX times — my KPI tiles, @raccoon's isSupabaseConfigured, his
 * unrendered guard, my detector's banner, his one-armed drift lock, and this. Every one was
 * found by someone sabotaging their OWN work, never by reviewing someone else's.
 *
 * ⚠️ AND THE FAILURE IS SILENT BY CONSTRUCTION: with the setting ignored the detector still
 * runs, still renders, still says "complete" — against a HARDCODED tab rather than the one
 * @andrew edits. @apprentice's phrasing is the sharp one: "a detector that cannot see the
 * thing it guards." A test that only asserts the banner appears cannot tell the difference.
 */
const checkMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/sheetCompleteness', async () => {
  const actual = await vi.importActual<typeof import('@/lib/sheetCompleteness')>('@/lib/sheetCompleteness');
  return { ...actual, checkSheetCompleteness: checkMock };
});

const settingsHolder = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('@/lib/config', async () => {
  const actual = await vi.importActual<typeof import('@/lib/config')>('@/lib/config');
  return {
    ...actual,
    loadSettings: () => ({ ...actual.DEFAULT_SETTINGS, ...settingsHolder.value }),
    loadSettingsWithSource: async () => ({
      settings: { ...actual.DEFAULT_SETTINGS, ...settingsHolder.value },
      origin: 'database' as const,
      detail: null,
    }),
    loadAccountMappings: () => [],
    loadAccountMappingsAsync: async () => [],
  };
});

vi.mock('@/lib/dataService', async () => {
  const actual = await vi.importActual<typeof import('@/lib/dataService')>('@/lib/dataService');
  return {
    ...actual,
    fetchGoogleSheetData: async () => [],
    fetchAirtableData: async () => ({ records: [], fields: [] }),
    fetchCallCenterData: async () => [],
  };
});

const { DataProvider } = await import('./useData');

const SHEET = 'https://docs.google.com/spreadsheets/d/SHEET/edit#gid=100';

beforeEach(() => {
  checkMock.mockReset();
  checkMock.mockResolvedValue({ state: 'complete', rawRows: 1, derivedRows: 1, droppedRows: 0, reason: null });
  localStorage.clear();
});

async function mountWith(over: Record<string, unknown>) {
  settingsHolder.value = { ...makeSettings({ googleSheetUrl: SHEET }), ...over };
  render(<DataProvider><div /></DataProvider>);
  await waitFor(() => expect(checkMock).toHaveBeenCalled());
}

describe('useData — the CONFIGURED raw tab name reaches the detector', () => {
  it('🔴 passes the tab name the USER set, not a hardcoded one', async () => {
    await mountWith({ adsRawTabName: 'My Custom Raw Tab' });

    expect(checkMock).toHaveBeenCalledWith(SHEET, 'My Custom Raw Tab');
  });

  it('falls back to the measured default when the setting is blank', async () => {
    // A blank setting is not a reason to stop checking — the default is @fable's live
    // measurement of the real sheet, so the detector still describes something true.
    const { DEFAULT_ADS_RAW_TAB } = await import('@/lib/sheetCompleteness');
    await mountWith({ adsRawTabName: undefined });

    expect(checkMock).toHaveBeenCalledWith(SHEET, DEFAULT_ADS_RAW_TAB);
  });

  it('🔑 ANTI-VACUITY CONTROL: the two arms above pass DIFFERENT values', async () => {
    // Without this, both arms would pass if the code always sent the same string — which is
    // exactly the sabotage that went green.
    await mountWith({ adsRawTabName: 'Tab A' });
    const first = checkMock.mock.calls[0][1];

    checkMock.mockClear();
    await mountWith({ adsRawTabName: 'Tab B' });
    const second = checkMock.mock.calls[0][1];

    expect(first).not.toBe(second);
  });

  it('passes the CONFIGURED sheet URL too, not a remembered one', async () => {
    const other = 'https://docs.google.com/spreadsheets/d/OTHER/edit#gid=7';
    await mountWith({ googleSheetUrl: other, adsRawTabName: 'Raw' });

    expect(checkMock).toHaveBeenCalledWith(other, 'Raw');
  });
});
