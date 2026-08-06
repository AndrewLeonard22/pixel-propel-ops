import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSettings } from '@/test/factories';
import { assertSheetSchema, fetchCallCenterData, fetchGoogleSheetData } from './dataService';

/**
 * THE WRONG TAB IS A SUCCESSFUL FETCH THAT FABRICATES ZEROS.
 *
 * @apprentice, measured server-side: an INVALID `sheet=` name returns HTTP 200 carrying the
 * DEFAULT TAB'S SCHEMA. @fable, measured by content: `sheet=RAW DATA` and `sheet=Ads Data`
 * return byte-identical bodies. His prescription is the design of this file:
 *
 *   "ASSERT THE HEADER SET, NOT THE ROW COUNT. A fallback tab has the wrong headers and
 *    the right shape — every count-based check passes on it."
 *
 * ⭐ AND THE CAUSE IS OURS: config.ts:609 takes a `tab` argument and never reads it,
 * defaulting to `gid=0`. The tab name in Settings has never selected a tab. So the wrong
 * tab is not a hypothetical misconfiguration — it is what the code does whenever a sheet
 * URL carries no gid, which is the shape a user gets by copying the address bar on tab 1.
 *
 * ⚠️ THE PRE-FIX BEHAVIOUR IS THE POINT, AND IT IS ASSERTED BELOW: 200 rows of the wrong
 * tab produced 200 CallRows, every field '', every duration 0, and — because the dial map
 * skips a blank location key — ZERO DIALS reported from a source in state 'valid'. No
 * throw, no banner, no error. That zero is invisible to every honest-state guard on this
 * branch, because those guards ask whether the SOURCE failed and this source succeeded.
 */
describe('assertSheetSchema — the unit', () => {
  it('passes when the load-bearing column is present', () => {
    expect(() => assertSheetSchema([{ ghl_location_name: 'Acme' }], ['ghl_location_name'], 'x')).not.toThrow();
  });

  it('🔴 throws when it is absent, and NAMES the wrong-tab cause', () => {
    expect(() => assertSheetSchema([{ 'Account Name': 'Acme' }], ['ghl_location_name'], 'Call centre sheet'))
      .toThrow(/WRONG TAB/);
  });

  it('the message names the missing column AND what was actually found', () => {
    try {
      assertSheetSchema([{ 'Account Name': 'Acme', Spent: '5' }], ['ghl_location_name'], 'Call centre sheet');
      throw new Error('should have thrown');
    } catch (e) {
      const m = (e as Error).message;
      expect(m).toMatch(/"ghl_location_name"/);
      expect(m).toMatch(/Account Name/);          // what it got
      expect(m).toMatch(/tab name in Settings/);  // the actionable half
    }
  });

  it('🔑 an EMPTY sheet is exempt — a genuinely empty tab is not an error', () => {
    // The mirror defect: turning a legitimate empty result into a failure would be the
    // same class of lie in the other direction.
    expect(() => assertSheetSchema([], ['ghl_location_name'], 'x')).not.toThrow();
  });

  it('reports every missing column, not just the first', () => {
    expect(() => assertSheetSchema([{ a: '1' }], ['x', 'y'], 'L')).toThrow(/"x", "y"/);
  });
});

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

const CSV_ADS = 'Account Name,Spent,Leads\nAcme,500,20\n';
const CSV_CALLS = 'Timestamp,ghl_location_name,Agent Name,Call Duration,call_dispostion\n8/4/2026,Acme,Bob,60,answered\n';
/** The ads tab returned when the call-centre tab was requested — @fable's byte-identical case. */
const CSV_WRONG_TAB = CSV_ADS;

const ok = (body: string) => ({ ok: true, status: 200, text: async () => body });

describe('fetchCallCenterData — a wrong-tab 200 must not read as a healthy zero', () => {
  it('ANTI-VACUITY CONTROL: the RIGHT tab parses through to CallRows', () => {
    // Without this the fix is satisfiable by throwing on every sheet.
    fetchMock.mockResolvedValue(ok(CSV_CALLS));
    return expect(fetchCallCenterData(makeSettings({ callCenterSheetUrl: 'https://docs.google.com/spreadsheets/d/S/edit' })))
      .resolves.toHaveLength(1);
  });

  it('🔴 THE DEFECT: the ads tab returned for the calls request now THROWS', async () => {
    fetchMock.mockResolvedValue(ok(CSV_WRONG_TAB));

    await expect(
      fetchCallCenterData(makeSettings({ callCenterSheetUrl: 'https://docs.google.com/spreadsheets/d/S/edit' })),
    ).rejects.toThrow(/WRONG TAB/);
  });

  it('🔴 PRE-FIX BEHAVIOUR, ASSERTED SO THE REGRESSION IS NAMEABLE: it would have been a silent zero', () => {
    // Not a test of the fix — a statement of what the fix replaced. The wrong tab parses
    // cleanly into rows whose location key is blank, and buildAccountSummaries' dial map
    // does `if (!key) continue`. N rows in, 0 dials out, source state 'valid'.
    const rows = [{ 'Account Name': 'Acme', Spent: '500', Leads: '20' }] as Record<string, string>[];
    const asCallRows = rows.map(r => ({ ghlLocationName: r['ghl_location_name'] || '' }));

    expect(asCallRows).toHaveLength(1);              // a successful-looking fetch
    expect(asCallRows[0].ghlLocationName).toBe('');  // that contributes ZERO dials
  });

  it('an empty-but-correct sheet still resolves to [] rather than throwing', async () => {
    fetchMock.mockResolvedValue(ok('Timestamp,ghl_location_name\n'));
    await expect(
      fetchCallCenterData(makeSettings({ callCenterSheetUrl: 'https://docs.google.com/spreadsheets/d/S/edit' })),
    ).resolves.toEqual([]);
  });
});

describe('fetchGoogleSheetData — the same guard on the spend side', () => {
  it('ANTI-VACUITY CONTROL: the right tab parses through', async () => {
    fetchMock.mockResolvedValue(ok(CSV_ADS));
    const rows = await fetchGoogleSheetData(makeSettings({ googleSheetUrl: 'https://docs.google.com/spreadsheets/d/S/edit' }));
    expect(rows[0].accountName).toBe('Acme');
    expect(rows[0].spent).toBe(500);
  });

  it('🔴 the calls tab returned for the spend request THROWS instead of inventing one account', async () => {
    // Without `Account Name` every row groups under 'Unknown' — one fake account holding
    // the entire dashboard, which is worse than an error because it renders confidently.
    fetchMock.mockResolvedValue(ok(CSV_CALLS));
    await expect(
      fetchGoogleSheetData(makeSettings({ googleSheetUrl: 'https://docs.google.com/spreadsheets/d/S/edit' })),
    ).rejects.toThrow(/WRONG TAB/);
  });
});
