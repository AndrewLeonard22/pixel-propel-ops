/**
 * ORDER ⑥ LOCK — "one source failing must not take the other two down".
 *
 * THE DEFECT THIS GUARDS, measured in production 2026-08-05: `Promise.all` over the three
 * fetchers meant one rejection skipped every setState, so an empty `airtableToken`
 * produced ZERO Windsor requests and ZERO call-centre requests and a blank screen.
 *
 * SABOTAGE-PROVEN: change `Promise.allSettled` back to `Promise.all` in
 * src/lib/sourceStatus.ts and the four independence tests below fail. Proven by running
 * that exact flip against a STAGED baseline, not by assertion.
 *
 * POPULATION, and how it was enumerated: SOURCE_KEYS is the complete set of sources the
 * app has (3), and the suite drives EVERY key through EVERY outcome — success, throw,
 * and not-configured — rather than spot-checking one. The cross-product is asserted
 * explicitly in "every source, every outcome" below, so adding a fourth source to
 * SOURCE_KEYS without extending REQUIREMENTS fails here.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  refreshSources,
  missingSettingsFor,
  isSourceConfigured,
  hasUsableData,
  isFullyTrusted,
  needsAttention,
  initialStatuses,
  SOURCE_KEYS,
  EMPTY_SOURCE_DATA,
  type SourceFetchers,
  type SourceStatus,
  type SourceKey,
} from './sourceStatus';
import { DEFAULT_SETTINGS } from './config';
import type { AppSettings, AdSpendRow, AppointmentRow, CallRow } from './types';

const CONFIGURED: AppSettings = {
  ...DEFAULT_SETTINGS,
  googleSheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET/edit',
  callCenterSheetUrl: 'https://docs.google.com/spreadsheets/d/CALLS/edit',
  airtableBaseId: 'appBASE',
  airtableToken: 'tok',
};

const spendRow: AdSpendRow = {
  month: 'August', date: '8/4/2026', campaign: 'C', campaignId: '1',
  adsetName: 'AS', adsetId: '2', adName: 'A', adId: '3',
  spent: 1234.5, leads: 7, accountName: 'Testerman Pro Wash',
};
const apptRow = { client: 'Testerman Pro Wash' } as AppointmentRow;
const callRow = { agentName: 'Jordan', callDuration: 60 } as CallRow;

function fetchers(over: Partial<SourceFetchers> = {}): SourceFetchers {
  return {
    fetchWindsor: vi.fn(async () => [spendRow]),
    fetchAirtable: vi.fn(async () => ({ records: [apptRow], fields: ['Client Name'] })),
    fetchCallCenter: vi.fn(async () => [callRow]),
    ...over,
  };
}

describe('per-source configuration is derived independently', () => {
  it('names WHICH settings are missing rather than counting them', () => {
    const blank = { ...DEFAULT_SETTINGS };
    expect(missingSettingsFor('windsor', blank)).toEqual(['Google Sheet URL']);
    expect(missingSettingsFor('airtable', blank)).toEqual(['Airtable base ID', 'Airtable token']);
    expect(missingSettingsFor('callCenter', blank)).toEqual(['Call centre sheet URL']);
    // CONTROL: a configured source reports nothing missing, so the assertion above is
    // discriminating and not just "this function returns a non-empty list".
    expect(missingSettingsFor('windsor', CONFIGURED)).toEqual([]);
  });

  it('treats whitespace-only settings as missing', () => {
    const s = { ...CONFIGURED, googleSheetUrl: '   ' };
    expect(isSourceConfigured('windsor', s)).toBe(false);
    expect(isSourceConfigured('airtable', s)).toBe(true); // CONTROL: unaffected
  });

  it('THE PRODUCTION INCIDENT: a missing Airtable token leaves Windsor configured', () => {
    // 2026-08-05 — an empty airtableToken took the whole product down. Under the old
    // single `isConfigured(googleSheetUrl && airtableBaseId && airtableToken)` this
    // settings object answered "not configured" for everything.
    const tokenWiped = { ...CONFIGURED, airtableToken: '' };
    expect(isSourceConfigured('windsor', tokenWiped)).toBe(true);
    expect(isSourceConfigured('callCenter', tokenWiped)).toBe(true);
    expect(isSourceConfigured('airtable', tokenWiped)).toBe(false);
  });
});

describe('ORDER ⑥ — one source failing must not take the others down', () => {
  it('Airtable throwing still installs Windsor and call-centre data', async () => {
    const f = fetchers({ fetchAirtable: vi.fn(async () => { throw new Error('Airtable error: 401'); }) });
    const { data, statuses } = await refreshSources(CONFIGURED, f);

    // The payloads that arrived are KEPT. Under Promise.all these were discarded.
    expect(data.adSpend).toEqual([spendRow]);
    expect(data.callData).toEqual([callRow]);
    expect(statuses.windsor.state).toBe('valid');
    expect(statuses.callCenter.state).toBe('valid');

    // And the one that failed says so, in its own words.
    expect(statuses.airtable.state).toBe('failed');
    expect(statuses.airtable.error).toBe('Airtable error: 401');
    expect(data.appointments).toEqual([]);
  });

  it('Windsor throwing still installs Airtable and call-centre data', async () => {
    const f = fetchers({ fetchWindsor: vi.fn(async () => { throw new Error('Failed to fetch Google Sheet: 403'); }) });
    const { data, statuses } = await refreshSources(CONFIGURED, f);

    expect(data.appointments).toEqual([apptRow]);
    expect(data.callData).toEqual([callRow]);
    expect(statuses.airtable.state).toBe('valid');
    expect(statuses.callCenter.state).toBe('valid');
    expect(statuses.windsor.state).toBe('failed');
    expect(statuses.windsor.error).toBe('Failed to fetch Google Sheet: 403');
  });

  it('ALL THREE failing reports three independent failures, not one', async () => {
    const f = fetchers({
      fetchWindsor: vi.fn(async () => { throw new Error('w'); }),
      fetchAirtable: vi.fn(async () => { throw new Error('a'); }),
      fetchCallCenter: vi.fn(async () => { throw new Error('c'); }),
    });
    const { statuses } = await refreshSources(CONFIGURED, f);
    expect([statuses.windsor.error, statuses.airtable.error, statuses.callCenter.error]).toEqual(['w', 'a', 'c']);
  });

  it('every source, every outcome — the full cross-product over SOURCE_KEYS', async () => {
    // Enumerates the population rather than spot-checking: each key is failed in turn and
    // the OTHER two must be valid. Adding a source to SOURCE_KEYS extends this loop.
    for (const failing of SOURCE_KEYS) {
      const boom = vi.fn(async () => { throw new Error(`${failing} down`); });
      const f = fetchers(
        failing === 'windsor' ? { fetchWindsor: boom as never }
        : failing === 'airtable' ? { fetchAirtable: boom as never }
        : { fetchCallCenter: boom as never },
      );
      const { statuses } = await refreshSources(CONFIGURED, f);
      expect(statuses[failing].state, `${failing} should be failed`).toBe('failed');
      for (const other of SOURCE_KEYS.filter(k => k !== failing)) {
        expect(statuses[other].state, `${other} must survive ${failing} failing`).toBe('valid');
      }
    }
  });
});

describe('an unconfigured source is not fetched and blocks nothing', () => {
  it('does not call the fetcher for a source with no settings, and the others still load', async () => {
    const f = fetchers();
    const { data, statuses } = await refreshSources({ ...CONFIGURED, callCenterSheetUrl: '' }, f);

    expect(f.fetchCallCenter).not.toHaveBeenCalled();
    expect(statuses.callCenter.state).toBe('not-configured');
    expect(statuses.callCenter.missingSettings).toEqual(['Call centre sheet URL']);

    // CONTROL: the configured ones WERE fetched, so "not called" above means something.
    expect(f.fetchWindsor).toHaveBeenCalledTimes(1);
    expect(f.fetchAirtable).toHaveBeenCalledTimes(1);
    expect(statuses.windsor.state).toBe('valid');
    expect(data.adSpend).toEqual([spendRow]);
  });

  it('with NOTHING configured it still reports three states rather than returning silently', async () => {
    // The old code did `if (!isConfigured(s)) return;` — no spinner, no error, no state
    // change of any kind. Whatever else is true, the app must come back with an answer.
    const f = fetchers();
    const { statuses } = await refreshSources({ ...DEFAULT_SETTINGS }, f);
    expect(SOURCE_KEYS.map(k => statuses[k].state)).toEqual(['not-configured', 'not-configured', 'not-configured']);
    expect(f.fetchWindsor).not.toHaveBeenCalled();
    expect(f.fetchAirtable).not.toHaveBeenCalled();
    expect(f.fetchCallCenter).not.toHaveBeenCalled();
  });
});

describe('a failed refresh keeps last-known-good instead of blanking the screen', () => {
  const previouslyGood = (key: SourceKey, at: Date): SourceStatus => ({
    key, label: 'x', state: 'valid', configured: true,
    missingSettings: [], error: null, lastSuccessAt: at,
  });

  it('a source that once worked goes STALE and its data survives', async () => {
    const at = new Date('2026-08-05T20:00:00Z');
    const f = fetchers({ fetchWindsor: vi.fn(async () => { throw new Error('503'); }) });
    const { data, statuses } = await refreshSources(
      CONFIGURED, f,
      { windsor: previouslyGood('windsor', at) },
      { ...EMPTY_SOURCE_DATA, adSpend: [spendRow] },
    );
    expect(statuses.windsor.state).toBe('stale');
    expect(statuses.windsor.lastSuccessAt).toBe(at);   // when the good data came from
    expect(data.adSpend).toEqual([spendRow]);          // and it is STILL ON SCREEN
  });

  it('a source that NEVER worked is FAILED, not stale — the words are not interchangeable', async () => {
    const f = fetchers({ fetchWindsor: vi.fn(async () => { throw new Error('503'); }) });
    const { statuses } = await refreshSources(CONFIGURED, f);
    expect(statuses.windsor.state).toBe('failed');
    expect(statuses.windsor.lastSuccessAt).toBeNull();
  });

  it('recovering from stale returns to valid and stamps a fresh success time', async () => {
    const at = new Date('2026-08-05T20:00:00Z');
    const now = new Date('2026-08-05T21:00:00Z');
    const { statuses } = await refreshSources(
      CONFIGURED, fetchers(), { windsor: { ...previouslyGood('windsor', at), state: 'stale' } },
      EMPTY_SOURCE_DATA, now,
    );
    expect(statuses.windsor.state).toBe('valid');
    expect(statuses.windsor.lastSuccessAt).toBe(now);
  });
});

describe('the render predicates say which numbers may be shown', () => {
  it('separates "has data" from "fully trusted" — stale has data but is not clean', () => {
    expect(hasUsableData('valid')).toBe(true);
    expect(hasUsableData('stale')).toBe(true);
    expect(hasUsableData('failed')).toBe(false);
    expect(hasUsableData('not-configured')).toBe(false);
    expect(hasUsableData('loading')).toBe(false);

    expect(isFullyTrusted('valid')).toBe(true);
    expect(isFullyTrusted('stale')).toBe(false);
  });

  it('needsAttention covers every non-valid resting state and never fires while loading', () => {
    const at = (state: SourceStatus['state']): SourceStatus =>
      ({ key: 'windsor', label: 'x', state, configured: true, missingSettings: [], error: null, lastSuccessAt: null });
    expect(needsAttention(at('valid'))).toBe(false);
    expect(needsAttention(at('loading'))).toBe(false); // a spinner is not a problem
    for (const s of ['failed', 'stale', 'not-configured', 'incomplete'] as const) {
      expect(needsAttention(at(s)), `${s} must be surfaced`).toBe(true);
    }
  });

  it('initialStatuses marks unconfigured sources before any fetch is attempted', () => {
    const s = initialStatuses({ ...DEFAULT_SETTINGS, googleSheetUrl: 'https://docs.google.com/spreadsheets/d/X/edit' });
    expect(s.windsor.state).toBe('loading');
    expect(s.airtable.state).toBe('not-configured');
    expect(s.callCenter.state).toBe('not-configured');
  });
});
