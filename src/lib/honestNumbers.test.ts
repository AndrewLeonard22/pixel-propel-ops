/**
 * Tests for the honest-number detectors.
 *
 * @fable's condition, verbatim: «@raccoon verifies they FIRE and can also NOT fire
 * (control arm, or it is decoration).» Both directions are asserted for every detector,
 * and the NOT-firing arms are the load-bearing ones — a warning that appears on healthy
 * data is how a real warning gets ignored.
 *
 * POPULATION: the live post-wipe state (0 excluded campaigns, 0 setter rates), the
 * healthy pre-wipe state (32 excluded campaigns, rates configured), and the two
 * in-between states that a naive `performanceSpend === totalSpend` test would confuse
 * with the wipe.
 */
import { describe, it, expect } from 'vitest';
import {
  detectExclusionState,
  spendWasFiltered,
  buildHonestNumbersReport,
} from './honestNumbers';
import { makeSettings } from '@/test/factories';
import { proveDetects, population } from '@/test/sabotage';

const CAMPAIGNS = ['111', '222', '333'];

describe('detectExclusionState — FIRES on the wipe, SILENT on health', () => {
  it('🔴 FIRES: no exclusions configured — the live post-wipe state', () => {
    const s = detectExclusionState(makeSettings({ excludedCampaigns: [] }), CAMPAIGNS);
    expect(s.status).toBe('inert-unconfigured');
    expect(s.spendUnfiltered).toBe(true);
    expect(s.warning).toContain('TOTAL spend');
  });

  it('✅ CONTROL — SILENT: exclusions configured AND matching (the healthy state)', () => {
    const s = detectExclusionState(
      makeSettings({ excludedCampaigns: ['222'] }),
      CAMPAIGNS,
    );
    expect(s.status).toBe('active');
    expect(s.warning).toBeNull();
    expect(s.spendUnfiltered).toBe(false);
    expect(s.matchedCount).toBe(1);
  });

  it('⚠️ FIRES DIFFERENTLY: configured but none present — stale ids, not the wipe', () => {
    const s = detectExclusionState(
      makeSettings({ excludedCampaigns: ['999', '888'] }),
      CAMPAIGNS,
    );
    expect(s.status).toBe('inert-no-match');
    expect(s.configuredCount).toBe(2);
    expect(s.matchedCount).toBe(0);
    // it must NOT claim nothing is configured — that would be the wrong diagnosis
    expect(s.warning).toContain('2 campaigns are marked excluded');
  });

  it('is sabotage-proven, and the poisons are the plausible wrong detectors', () => {
    proveDetects({
      subject: 'detectExclusionState',
      population:
        'wiped (0 configured), healthy (configured+matching), stale (configured+unmatched)',
      real: detectExclusionState,
      poisons: {
        'THE NAIVE ONE: keys on performanceSpend===totalSpend, so it cries wolf on a healthy account with nothing to exclude':
          ((s, ids) => {
            const st = detectExclusionState(s, ids);
            // fires whenever nothing matched, regardless of whether anything is configured
            return st.matchedCount === 0
              ? { ...st, status: 'inert-unconfigured' as const }
              : st;
          }) as typeof detectExclusionState,
        'never fires (a detector that is decoration)': ((s, ids) => ({
          ...detectExclusionState(s, ids),
          status: 'active' as const,
          warning: null,
        })) as typeof detectExclusionState,
        'always fires (alarm fatigue — the thing that gets it ignored)': ((s, ids) => ({
          ...detectExclusionState(s, ids),
          status: 'inert-unconfigured' as const,
          warning: 'x',
        })) as typeof detectExclusionState,
        'ignores whitespace, so a padded id never matches': ((s, ids) => {
          const configured = (s?.excludedCampaigns || []).filter(Boolean);
          const present = new Set(ids);
          const matched = configured.filter(i => present.has(i));
          return {
            status: matched.length > 0 ? ('active' as const) : ('inert-unconfigured' as const),
            configuredCount: configured.length,
            matchedCount: matched.length,
            spendUnfiltered: matched.length === 0,
            warning: matched.length > 0 ? null : 'x',
          };
        }) as typeof detectExclusionState,
      },
      assertions: impl => {
        // must FIRE on the wipe
        expect(impl(makeSettings({ excludedCampaigns: [] }), CAMPAIGNS).status).toBe(
          'inert-unconfigured',
        );
        // must be SILENT on health  <- the arm that kills the naive detector
        const healthy = impl(makeSettings({ excludedCampaigns: ['222'] }), CAMPAIGNS);
        expect(healthy.status).toBe('active');
        expect(healthy.warning).toBeNull();
        // must DISTINGUISH stale ids from the wipe
        expect(impl(makeSettings({ excludedCampaigns: ['999'] }), CAMPAIGNS).status).toBe(
          'inert-no-match',
        );
        // whitespace on a configured id must still match  <- kills the trim poison
        expect(
          impl(makeSettings({ excludedCampaigns: [' 222 '] }), CAMPAIGNS).status,
        ).toBe('active');
      },
    });
  });

  it('treats a null/absent settings object as unconfigured rather than throwing', () => {
    expect(detectExclusionState(null, CAMPAIGNS).status).toBe('inert-unconfigured');
    expect(detectExclusionState(undefined, []).status).toBe('inert-unconfigured');
  });
});

describe('spendWasFiltered — the arithmetic cross-check', () => {
  it('FIRES when the filter changed nothing', () => {
    expect(spendWasFiltered(1000, 1000)).toBe(false);
  });
  it('CONTROL — silent when the filter did work', () => {
    expect(spendWasFiltered(1000, 800)).toBe(true);
  });
});

describe('buildHonestNumbersReport — the banner payload', () => {
  it('🔴 THE LIVE STATE: no exclusions AND no rates — both warnings', () => {
    const r = buildHonestNumbersReport({
      settings: makeSettings({ excludedCampaigns: [] }),
      campaignIdsInData: CAMPAIGNS,
      fabricatedRateCount: 4,
      allRatesFabricated: true,
    });
    expect(r.hasWarnings).toBe(true);
    expect(r.messages).toHaveLength(2);
    expect(r.messages[0]).toContain('TOTAL spend');
    expect(r.messages[1]).toContain('No setter bonus rates are configured');
  });

  it('✅ CONTROL — A FULLY HEALTHY SYSTEM PRODUCES NO MESSAGES AT ALL', () => {
    const r = buildHonestNumbersReport({
      settings: makeSettings({ excludedCampaigns: ['222'] }),
      campaignIdsInData: CAMPAIGNS,
      fabricatedRateCount: 0,
      allRatesFabricated: false,
    });
    expect(r.hasWarnings).toBe(false);
    expect(r.messages).toEqual([]);
    expect(r.exclusion.warning).toBeNull();
  });

  it('reports a PARTIAL rate gap without claiming everything is fabricated', () => {
    const r = buildHonestNumbersReport({
      settings: makeSettings({ excludedCampaigns: ['222'] }),
      campaignIdsInData: CAMPAIGNS,
      fabricatedRateCount: 2,
      allRatesFabricated: false,
    });
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]).toContain('2 setters');
    expect(r.messages[0]).not.toContain('No setter bonus rates');
  });

  it('singular/plural reads correctly — one setter is not "1 setters"', () => {
    const r = buildHonestNumbersReport({
      settings: makeSettings({ excludedCampaigns: ['222'] }),
      campaignIdsInData: CAMPAIGNS,
      fabricatedRateCount: 1,
      allRatesFabricated: false,
    });
    expect(r.messages[0]).toContain('1 setter ');
    expect(r.messages[0]).not.toContain('1 setters');
  });
});
