/**
 * DIFFERENTIAL: the two exclusion detectors must never disagree.
 *
 * WHY BOTH EXIST, so nobody deletes one as a duplicate:
 *   dataService.detectExclusionState(adSpend, settings)   → @anvil. Takes SPEND ROWS,
 *       so it can name WHICH accounts and HOW MUCH money. This is the DRILL-DOWN.
 *   honestNumbers.detectExclusionState(settings, ids)     → @raccoon. Takes CAMPAIGN IDS,
 *       and composes with the payout flags into user-facing sentences. This is the BANNER.
 *
 * They were built independently, in separate files, by two seats who had not seen each
 * other's work — and arrived at the same three states for the same reason. That is the
 * strongest evidence the design is right, and it is also exactly how two implementations
 * of one rule start to drift.
 *
 * 🔴 THE RISK IS SPECIFIC: they are rendered TOGETHER. The banner is my sentences; the
 * drill-down is his accounts and money. If they ever classify the same data differently,
 * the screen contradicts itself — which is the banner-vs-row disagreement this branch
 * spent the night removing. This file is the lock.
 *
 * POPULATION: every combination of (0 / 1 / many configured ids) x (none / some / all
 * matching rows), plus whitespace, empty ids, and an empty feed.
 */
import { describe, it, expect } from 'vitest';
import { detectExclusionState as anvilDetect } from './dataService';
import { detectExclusionState as raccoonDetect } from './honestNumbers';
import { makeSettings, makeAdSpendRow } from '@/test/factories';
import type { AdSpendRow } from './types';

/** His state vocabulary → mine. Same three states, different names. */
const EQUIVALENT: Record<string, string> = {
  'none-configured': 'inert-unconfigured',
  'configured-but-inert': 'inert-no-match',
  active: 'active',
};

const rows = (ids: string[]): AdSpendRow[] =>
  ids.map((id, i) =>
    makeAdSpendRow({ campaignId: id, accountName: `Acct ${i}`, spent: 100 + i }),
  );

/** (configured ids, campaign ids present in the feed) */
const CASES: [string[], string[]][] = [
  [[], []], // nothing configured, no data
  [[], ['111']], // nothing configured, data present — THE WIPE
  [[], ['111', '222', '333']],
  [['111'], []], // configured, but the feed is empty
  [['111'], ['222']], // configured, nothing matches — stale ids
  [['111'], ['111']], // configured and matching — HEALTHY
  [['111'], ['111', '222']], // partial match — still healthy
  [['111', '222'], ['333']], // several configured, none match
  [['111', '222'], ['111', '333']], // several configured, one matches
  [['111', '222'], ['111', '222']], // all match
  [[' 111 '], ['111']], // whitespace on the configured id
  [['111'], [' 111 ']], // whitespace on the feed id
  [['', '  '], ['111']], // empty/blank configured entries are not ids
  [['111'], ['', '111']], // a blank campaign id in the feed
];

describe('the two exclusion detectors agree on classification', () => {
  it('agree on every combination of configured ids x present ids', () => {
    const disagreements: {
      configured: string[];
      present: string[];
      anvil: string;
      raccoon: string;
    }[] = [];

    for (const [configured, present] of CASES) {
      const settings = makeSettings({ excludedCampaigns: configured });
      const a = anvilDetect(rows(present), settings);
      const r = raccoonDetect(settings, present);
      if (EQUIVALENT[a.state] !== r.status) {
        disagreements.push({
          configured,
          present,
          anvil: a.state,
          raccoon: r.status,
        });
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('agree on configuredCount and matchedCount, not just the state name', () => {
    for (const [configured, present] of CASES) {
      const settings = makeSettings({ excludedCampaigns: configured });
      const a = anvilDetect(rows(present), settings);
      const r = raccoonDetect(settings, present);
      expect(a.configuredCount, `configured=${configured} present=${present}`).toBe(
        r.configuredCount,
      );
      expect(a.matchedCount, `configured=${configured} present=${present}`).toBe(
        r.matchedCount,
      );
    }
  });

  it('🔴 the differential CAN fail — proven, not assumed', () => {
    // A drifted implementation must be caught, or this file is decoration.
    const drifted = (settings: Parameters<typeof raccoonDetect>[0], ids: string[]) => {
      const r = raccoonDetect(settings, ids);
      // the classic drift: collapse "configured but unmatched" into "nothing configured"
      return r.status === 'inert-no-match' ? { ...r, status: 'inert-unconfigured' } : r;
    };
    const found = CASES.filter(([configured, present]) => {
      const settings = makeSettings({ excludedCampaigns: configured });
      const a = anvilDetect(rows(present), settings);
      return EQUIVALENT[a.state] !== drifted(settings, present).status;
    });
    expect(found.length).toBeGreaterThan(0);
  });

  it('the population is non-empty and exercises all three states', () => {
    const states = new Set(
      CASES.map(([c, p]) =>
        anvilDetect(rows(p), makeSettings({ excludedCampaigns: c })).state,
      ),
    );
    expect(states).toEqual(
      new Set(['none-configured', 'configured-but-inert', 'active']),
    );
  });
});
