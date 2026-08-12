/**
 * PROBE (Fable, adversarial pass): what does the user SEE for each ad_pull_runs state?
 * The dot is the part anyone actually reads, per adFreshness.ts's own docblock. This
 * renders the real component and reports the class the dot carries in each state.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { FreshnessBadge } from './FreshnessIndicator';
import type { AdFreshness, FreshnessState, PullRun } from '@/lib/adFreshness';

const run = (o: Partial<PullRun> = {}): PullRun => ({
  id: 1, started_at: '2026-08-12T06:00:00Z', finished_at: '2026-08-12T06:00:10Z',
  status: 'ok', accounts_ok: 64, accounts_failed: 0, accounts_discovered: 64,
  rows_upserted: 305, error: null, ...o,
});

const f = (state: FreshnessState, extra: Partial<AdFreshness> = {}): AdFreshness => ({
  state, latest: run(), lastSuccess: run(), loading: false, ageMs: 90 * 60_000, runs: [run()], ...extra,
});

describe('what the header actually paints per pull state', () => {
  const states: FreshnessState[] = ['fresh', 'partial', 'failed', 'stale', 'stuck', 'unknown'];

  it('reports the rendered dot class and sentence for every state', () => {
    const seen: Record<string, string> = {};
    for (const s of states) {
      const { container, unmount } = render(
        <FreshnessBadge f={f(s, s === 'partial' ? { latest: run({ status: 'partial', accounts_failed: 2 }) } : {})} compact />,
      );
      const dot = container.querySelector('span > span');
      seen[s] = `${dot?.className.match(/bg-[a-z-/0-9.]+/)?.[0]} | ${container.textContent}`;
      unmount();
    }
    // eslint-disable-next-line no-console
    console.log('\nRENDERED PER STATE:\n' + states.map(s => `  ${s.padEnd(8)} ${seen[s]}`).join('\n') + '\n');

    // THE CLAIM UNDER TEST: only a healthy pull may paint green.
    for (const s of states) {
      if (s === 'fresh') continue;
      expect(seen[s], `state '${s}' painted the HEALTHY colour`).not.toContain('bg-success');
    }
  });
});
