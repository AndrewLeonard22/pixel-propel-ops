/**
 * HONEST-NUMBER DETECTORS. Andrew's original question, in code:
 *   «is an empty or zero value real, or did something fail?»
 *
 * He has accepted the data loss. So the software must not lie about its CONSEQUENCES.
 * The exclusion list is gone, which means `performanceSpend === totalSpend` forever,
 * which means every cost-per-lead on the dashboard is computed on UNFILTERED spend —
 * inflated, and currently silent.
 *
 * These are pure so they can be sabotage-proven and, critically, so a control arm can
 * show them NOT firing. A detector that cannot be shown to stay quiet is decoration.
 */
import type { AppSettings } from './types';

/* ────────────────────────────── ① EXCLUSION INERT ────────────────────────────── */

export type ExclusionStatus =
  /** exclusions are configured AND at least one matched: the filter is doing work */
  | 'active'
  /** NO exclusions configured at all — the wipe signature */
  | 'inert-unconfigured'
  /** exclusions configured, but none matched any row in view */
  | 'inert-no-match';

export interface ExclusionState {
  status: ExclusionStatus;
  /** how many campaign ids the settings carry */
  configuredCount: number;
  /** how many of those actually matched a spend row in the current data */
  matchedCount: number;
  /** true when the performance figure is identical to the unfiltered total */
  spendUnfiltered: boolean;
  /** null when nothing is wrong; a user-facing sentence otherwise */
  warning: string | null;
}

/**
 * Is the campaign-exclusion filter actually filtering anything?
 *
 * ⚠️ `performanceSpend === totalSpend` ALONE IS NOT THE TEST. It is equally true when
 * exclusions are configured and simply none of them apply to the rows in view, which is
 * a perfectly healthy state. Reporting on that number alone would cry wolf on every
 * account that has no excluded campaigns — and a detector that fires on healthy data is
 * how a real warning gets ignored.
 *
 * The discriminator is `configuredCount`: nothing configured is the wipe; configured but
 * unmatched is either a genuinely clean account or stale campaign ids, and says so.
 */
export function detectExclusionState(
  settings: Pick<AppSettings, 'excludedCampaigns'> | null | undefined,
  campaignIdsInData: readonly string[],
): ExclusionState {
  const configured = (settings?.excludedCampaigns || [])
    .map(id => (id || '').trim())
    .filter(Boolean);
  const present = new Set(campaignIdsInData.map(id => (id || '').trim()).filter(Boolean));
  const matched = configured.filter(id => present.has(id));

  if (configured.length === 0) {
    return {
      status: 'inert-unconfigured',
      configuredCount: 0,
      matchedCount: 0,
      spendUnfiltered: true,
      warning:
        'No campaigns are excluded, so cost-per-lead and cost-per-appointment are ' +
        'calculated on TOTAL spend. If any campaigns should be excluded, these figures ' +
        'are higher than the true performance numbers.',
    };
  }

  if (matched.length === 0) {
    return {
      status: 'inert-no-match',
      configuredCount: configured.length,
      matchedCount: 0,
      spendUnfiltered: true,
      warning:
        `${configured.length} campaign${configured.length === 1 ? ' is' : 's are'} marked ` +
        'excluded, but none of them appear in the data shown. These figures are the same ' +
        'as the unfiltered totals.',
    };
  }

  return {
    status: 'active',
    configuredCount: configured.length,
    matchedCount: matched.length,
    spendUnfiltered: false,
    warning: null,
  };
}

/* ─────────────────────── ② A RATIO BUILT ON UNFILTERED SPEND ─────────────────────── */

/**
 * Independent cross-check at the arithmetic rather than the config: did the filter
 * actually change the number? Used to catch the case where the exclusion list is
 * populated but the filter never ran — a different failure from an empty list.
 */
export function spendWasFiltered(totalSpend: number, performanceSpend: number): boolean {
  return performanceSpend !== totalSpend;
}

/* ────────────────────────── ③ THE COMBINED BANNER PAYLOAD ────────────────────────── */

export interface HonestNumbersReport {
  /** anything at all to tell the user? */
  hasWarnings: boolean;
  exclusion: ExclusionState;
  /** setters paid on a rate nobody configured — from computeSetterPayouts */
  fabricatedRateCount: number;
  /** true when NO setter rate is configured at all */
  allRatesFabricated: boolean;
  /** ordered, user-facing sentences. Empty when everything is trustworthy. */
  messages: string[];
}

export function buildHonestNumbersReport(input: {
  settings: Pick<AppSettings, 'excludedCampaigns'> | null | undefined;
  campaignIdsInData: readonly string[];
  fabricatedRateCount: number;
  allRatesFabricated: boolean;
}): HonestNumbersReport {
  const exclusion = detectExclusionState(input.settings, input.campaignIdsInData);
  const messages: string[] = [];

  if (exclusion.warning) messages.push(exclusion.warning);

  if (input.allRatesFabricated) {
    messages.push(
      'No setter bonus rates are configured. Every payout figure uses the $5 default, ' +
        'which nobody set.',
    );
  } else if (input.fabricatedRateCount > 0) {
    // ⚠️ DELIBERATELY NUMBERLESS. @anvil disclosed that this count is computed over ALL
    // appointments in useData, while Agents.tsx computes its rows over appointments
    // filtered by BOTH the selected pay period AND leadValid === 'valid'. The two
    // populations genuinely differ, so a number here can contradict the number on the
    // page it is describing — the same banner-vs-row disagreement this branch spent the
    // night removing. Pointing at the authoritative surface beats competing with it.
    messages.push(
      'Some setters have no configured bonus rate and are shown at the $5 default. ' +
        'See the Agents page for which ones.',
    );
  }

  return {
    hasWarnings: messages.length > 0,
    exclusion,
    fabricatedRateCount: input.fabricatedRateCount,
    allRatesFabricated: input.allRatesFabricated,
    messages,
  };
}
