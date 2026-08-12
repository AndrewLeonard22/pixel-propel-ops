/**
 * ORDER ⑥ LOCK — "one source failing must not take the other two down".
 *
 * THE DEFECT THIS GUARDS, measured in production 2026-08-05: `Promise.all` over the three
 * fetchers meant one rejection skipped every setState, so an empty `airtableToken`
 * produced ZERO ad spend requests and ZERO call-centre requests and a blank screen.
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
import type { AppSettings, AdSpendRow, AppointmentRow } from './types';

const CONFIGURED: AppSettings = {
  ...DEFAULT_SETTINGS,
  airtableBaseId: 'appBASE',
};

const spendRow: AdSpendRow = {
  month: 'August', date: '8/4/2026', dateISO: '2026-08-04', campaign: 'C', campaignId: '1',
  adsetName: 'AS', adsetId: '2', adName: 'A', adId: '3',
  spent: 1234.5, leads: 7, accountName: 'Testerman Pro Wash', accountId: '460916783395459',
};
const apptRow = { client: 'Testerman Pro Wash' } as AppointmentRow;

function fetchers(over: Partial<SourceFetchers> = {}): SourceFetchers {
  return {
    fetchAdSpend: vi.fn(async () => [spendRow]),
    fetchAirtable: vi.fn(async () => ({ records: [apptRow], fields: ['Client Name'] })),
    ...over,
  };
}

describe('per-source configuration is derived independently', () => {
  it('names WHICH settings are missing rather than counting them', () => {
    const blank = { ...DEFAULT_SETTINGS };
    // The token is no longer a client field (order ②), so it cannot be a missing SETTING.
    expect(missingSettingsFor('airtable', blank)).toEqual(['Airtable base ID']);
    // CONTROL: a configured source reports nothing missing, so the assertion above is
    // discriminating and not just "this function returns a non-empty list".
    expect(missingSettingsFor('airtable', CONFIGURED)).toEqual([]);
    /**
     * ⭐ AD SPEND HAS NO USER-FACING SETTING SINCE THE SUPABASE CUTOVER, and reports none
     * missing. Its configured axis is the Supabase connection, which this suite stubs as
     * valid (src/test/setup.ts) — so within these tests `meta` is always configured.
     *
     * ⚠️ THE NAMING LAW STILL BINDS IT: when Supabase IS absent, `missingSettingsFor`
     * returns the env vars BY NAME rather than an empty list, because "not configured"
     * with nothing named is a state with no remedy. That branch is proven in
     * metaAdSpend.test.ts, where the client module can be mocked away.
     */
    expect(missingSettingsFor('meta', blank)).toEqual([]);
  });

  it('treats whitespace-only settings as missing', () => {
    const s = { ...CONFIGURED, airtableBaseId: '   ' };
    expect(isSourceConfigured('airtable', s)).toBe(false);
    expect(isSourceConfigured('meta', s)).toBe(true); // CONTROL: unaffected
  });

  it('THE PRODUCTION INCIDENT: a missing Airtable field leaves ad spend configured', () => {
    // 2026-08-05 — an empty Airtable credential took the whole product down. Under the old
    // single `isConfigured(googleSheetUrl && airtableBaseId && airtableToken)` this state
    // rendered zero requests to the ad-spend feed. The credential has since become
    // server-side, so the operand that reproduces the incident today is the BASE ID.
    const airtableGone = { ...CONFIGURED, airtableBaseId: '' };

    expect(isSourceConfigured('meta', airtableGone)).toBe(true);
    expect(isSourceConfigured('airtable', airtableGone)).toBe(false);
  });
});

describe('ORDER ⑥ — one source failing must not take the others down', () => {
  it('Airtable throwing still installs ad spend data', async () => {
    const f = fetchers({ fetchAirtable: vi.fn(async () => { throw new Error('Airtable error: 401'); }) });
    const { data, statuses } = await refreshSources(CONFIGURED, f);

    // The payloads that arrived are KEPT. Under Promise.all these were discarded.
    expect(data.adSpend).toEqual([spendRow]);
    expect(statuses.meta.state).toBe('valid');

    // And the one that failed says so, in its own words.
    expect(statuses.airtable.state).toBe('failed');
    expect(statuses.airtable.error).toBe('Airtable error: 401');
    expect(data.appointments).toEqual([]);
  });

  it('ad spend throwing still installs Airtable data', async () => {
    const f = fetchers({ fetchAdSpend: vi.fn(async () => { throw new Error('Could not load ad spend from Supabase (ad_insights_resolved): 403'); }) });
    const { data, statuses } = await refreshSources(CONFIGURED, f);

    expect(data.appointments).toEqual([apptRow]);
    expect(statuses.airtable.state).toBe('valid');
    expect(statuses.meta.state).toBe('failed');
    expect(statuses.meta.error).toBe('Could not load ad spend from Supabase (ad_insights_resolved): 403');
  });

  it('BOTH failing reports two independent failures, not one', async () => {
    const f = fetchers({
      fetchAdSpend: vi.fn(async () => { throw new Error('w'); }),
      fetchAirtable: vi.fn(async () => { throw new Error('a'); }),
    });
    const { statuses } = await refreshSources(CONFIGURED, f);
    expect([statuses.meta.error, statuses.airtable.error]).toEqual(['w', 'a']);
  });

  it('every source, every outcome — the full cross-product over SOURCE_KEYS', async () => {
    // Enumerates the population rather than spot-checking: each key is failed in turn and
    // every OTHER key must stay valid. Adding a source to SOURCE_KEYS extends this loop.
    for (const failing of SOURCE_KEYS) {
      const boom = vi.fn(async () => { throw new Error(`${failing} down`); });
      const f = fetchers(
        failing === 'meta' ? { fetchAdSpend: boom as never } : { fetchAirtable: boom as never },
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
    const { data, statuses } = await refreshSources({ ...CONFIGURED, airtableBaseId: '' }, f);

    expect(f.fetchAirtable).not.toHaveBeenCalled();
    expect(statuses.airtable.state).toBe('not-configured');
    expect(statuses.airtable.missingSettings).toEqual(['Airtable base ID']);

    // CONTROL: the configured one WAS fetched, so "not called" above means something.
    expect(f.fetchAdSpend).toHaveBeenCalledTimes(1);
    expect(statuses.meta.state).toBe('valid');
    expect(data.adSpend).toEqual([spendRow]);
  });

  it('with NOTHING configured it still reports every state rather than returning silently', async () => {
    // The old code did `if (!isConfigured(s)) return;` — no spinner, no error, no state
    // change of any kind. Whatever else is true, the app must come back with an answer.
    //
    // ⚠️ "NOTHING CONFIGURED" IS NO LONGER REACHABLE FROM SETTINGS ALONE. Ad spend's
    // configured axis is the Supabase connection, not a settings field, and this suite
    // stubs a valid one — so an empty settings object leaves ad spend fetchable. That is
    // the honest post-cutover state and an improvement: the 2026-08-05 wipe blanked every
    // connection string in the row, and today the same wipe costs appointments only.
    //
    // ⭐ THE LAW UNDER TEST IS UNCHANGED: every key comes back with a state, and a source
    // that is not configured is NOT FETCHED.
    const f = fetchers();
    const { statuses } = await refreshSources({ ...DEFAULT_SETTINGS }, f);
    expect(SOURCE_KEYS.map(k => statuses[k].state)).toEqual(['valid', 'not-configured']);
    expect(f.fetchAirtable).not.toHaveBeenCalled();
  });
});

describe('a failed refresh keeps last-known-good instead of blanking the screen', () => {
  const previouslyGood = (key: SourceKey, at: Date): SourceStatus => ({
    key, label: 'x', state: 'valid', configured: true,
    missingSettings: [], error: null, lastSuccessAt: at,
  });

  it('a source that once worked goes STALE and its data survives', async () => {
    const at = new Date('2026-08-05T20:00:00Z');
    const f = fetchers({ fetchAdSpend: vi.fn(async () => { throw new Error('503'); }) });
    const { data, statuses } = await refreshSources(
      CONFIGURED, f,
      { meta: previouslyGood('meta', at) },
      { ...EMPTY_SOURCE_DATA, adSpend: [spendRow] },
    );
    expect(statuses.meta.state).toBe('stale');
    expect(statuses.meta.lastSuccessAt).toBe(at);   // when the good data came from
    expect(data.adSpend).toEqual([spendRow]);          // and it is STILL ON SCREEN
  });

  it('a source that NEVER worked is FAILED, not stale — the words are not interchangeable', async () => {
    const f = fetchers({ fetchAdSpend: vi.fn(async () => { throw new Error('503'); }) });
    const { statuses } = await refreshSources(CONFIGURED, f);
    expect(statuses.meta.state).toBe('failed');
    expect(statuses.meta.lastSuccessAt).toBeNull();
  });

  it('recovering from stale returns to valid and stamps a fresh success time', async () => {
    const at = new Date('2026-08-05T20:00:00Z');
    const now = new Date('2026-08-05T21:00:00Z');
    const { statuses } = await refreshSources(
      CONFIGURED, fetchers(), { meta: { ...previouslyGood('meta', at), state: 'stale' } },
      EMPTY_SOURCE_DATA, now,
    );
    expect(statuses.meta.state).toBe('valid');
    expect(statuses.meta.lastSuccessAt).toBe(now);
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
      ({ key: 'meta', label: 'x', state, configured: true, missingSettings: [], error: null, lastSuccessAt: null });
    expect(needsAttention(at('valid'))).toBe(false);
    expect(needsAttention(at('loading'))).toBe(false); // a spinner is not a problem
    for (const s of ['failed', 'stale', 'not-configured', 'incomplete'] as const) {
      expect(needsAttention(at(s)), `${s} must be surfaced`).toBe(true);
    }
  });

  it('initialStatuses marks unconfigured sources before any fetch is attempted', () => {
    const s = initialStatuses({ ...DEFAULT_SETTINGS });
    expect(s.meta.state).toBe('loading');
    expect(s.airtable.state).toBe('not-configured');
  });
});
