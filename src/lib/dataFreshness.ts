import type { AdSpendRow } from './types';

/**
 * ① THE OTHER HALF — WHAT @andrew SEES ON THE DAY THE SHEET FREEZES.
 *
 * @bird measured every freshness signal on the whole dashboard and found exactly one:
 *
 *     "Fetched less than a minute ago"
 *
 * with ZERO source dates rendered anywhere. ⭐ THAT SENTENCE IS TRUE AND IT IS ABOUT THE
 * WRONG CLOCK — it is a BROWSER fact about the FETCH, not a fact about the DATA. On the day
 * the upstream pull stops, the fetch still returns 200, the parse is still clean, every
 * source is still connected, and the screen still says "Fetched less than a minute ago"
 * over data that stopped moving. ⇒ 🔑 THE FREEZE HAS NO SYMPTOM.
 *
 * Every honest-state shipped tonight stays silent through it, because NOTHING FAILS. This
 * is "absence rendered as a plausible fact" at the DATA-AGE layer — the one layer the eight
 * surfaces never covered.
 *
 * ⭐ IT ANSWERS A DIFFERENT QUESTION FROM THE ROW-COUNT DETECTOR, and both still ship:
 *   metaAdSpend.checkMetaCompleteness  says HOW MANY ROWS of the window we failed to load
 *   this                               says THE DATA STOPPED MOVING
 * A complete read of a frozen feed passes the first and fails the second, which is exactly
 * the state that had no symptom. This one needs no probe at all — `dateISO` is already
 * parsed on every row.
 *
 * ⚠️ THE THRESHOLD IS AN ASSUMPTION AND IS TREATED AS ONE. The DATE is a measurement and is
 * always rendered; the WARNING is a judgement about how many days of lag is normal, and the
 * copy says which. A reader can disbelieve the warning and still see the fact.
 */

export type FreshnessState =
  /** No usable date in the feed — we cannot say how old the data is. Not "current". */
  | 'unknown'
  /** Within the expected reporting lag. */
  | 'current'
  /** Older than expected, but not yet the shape of a freeze. */
  | 'lagging'
  /** Old enough that "the source stopped appending" is the leading explanation. */
  | 'stale';

export interface FreshnessReport {
  state: FreshnessState;
  /** The newest date present IN THE DATA, YYYY-MM-DD. Null when nothing parsed. */
  latestDate: string | null;
  /** Whole days between latestDate and today. Null when unknown. */
  daysBehind: number | null;
  /** Rows dated beyond the plausible ceiling and excluded from the max. Never hidden. */
  futureRows: number;
}

/** Ad platforms report on a lag; two days is unremarkable, four is not. Stated, not hidden. */
export const LAGGING_AFTER_DAYS = 2;
export const STALE_AFTER_DAYS = 4;

/** One day of slack: a sheet in a later timezone can legitimately carry tomorrow's date. */
function ceilingFor(todayIso: string): string {
  const t = Date.parse(`${todayIso}T00:00:00Z`);
  return Number.isNaN(t) ? todayIso : new Date(t + 86400000).toISOString().slice(0, 10);
}

/**
 * Newest `dateISO` in the feed, IGNORING implausible future dates. ISO strings sort
 * lexicographically, so max is a compare.
 *
 * 🔴 THE CEILING IS NOT DEFENSIVE PADDING — @raccoon: "MAX is the aggregation most
 * vulnerable to a single outlier, and this one had no ceiling." One row dated 2126 made
 * `daysBetween` negative, so the feed read as fresher than today and the lagging/stale
 * thresholds could NEVER trip. Not degraded — DISABLED, permanently, by one row.
 *
 * ⭐ AND IT IS REACHABLE WITHOUT MALICE: "8/4/2126" is a plausible typo that parses cleanly.
 * ⇒ THE DETECTOR BUILT TO CATCH A SILENT FREEZE HAD A SILENT WAY TO BE SWITCHED OFF, with
 *   the SAME symptom — everything looks fine.
 *
 * ⚠️ AND THE IGNORED ROWS ARE COUNTED, NOT SILENTLY DROPPED. Quietly discarding them would
 * be the same defect one level down: an absence rendered as a fact.
 */
export function latestSourceDate(rows: AdSpendRow[], todayIso?: string): string | null {
  // ⛔ NOT DEFENSIVE PADDING — @fable's contract is "it must NOT block rendering", and a
  // freshness probe that THROWS on an unexpected shape white-screens the whole app to
  // report that data might be old. Caught by the SourceStatusBanner tests, whose mock had
  // no `adSpend`: a consumer this reaches through a hook cannot promise its own inputs.
  if (!Array.isArray(rows)) return null;

  const ceiling = todayIso ? ceilingFor(todayIso) : null;
  let best: string | null = null;
  for (const r of rows) {
    if (!r) continue;
    const d = r.dateISO;
    // Only well-formed dates. normalizeSourceDate returns '' for anything it could not
    // parse, and treating '' as a date would make the feed look infinitely old.
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    // A source date in the FUTURE is not evidence of freshness, it is a bad row.
    if (ceiling && d > ceiling) continue;
    if (best === null || d > best) best = d;
  }
  return best;
}

/** How many rows carry a date beyond the plausible ceiling. Reported, never hidden. */
export function countFutureRows(rows: AdSpendRow[], todayIso: string): number {
  if (!Array.isArray(rows)) return 0;
  const ceiling = ceilingFor(todayIso);
  let n = 0;
  for (const r of rows) {
    const d = r?.dateISO;
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d > ceiling) n++;
  }
  return n;
}

/** Whole days from `from` to `to`, both YYYY-MM-DD. UTC so a timezone cannot shift a day. */
export function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

export function describeFreshness(rows: AdSpendRow[], todayIso: string): FreshnessReport {
  const futureRows = countFutureRows(rows, todayIso);
  const latestDate = latestSourceDate(rows, todayIso);
  if (!latestDate) return { state: 'unknown', latestDate: null, daysBehind: null, futureRows };

  const daysBehind = daysBetween(latestDate, todayIso);
  if (daysBehind === null) return { state: 'unknown', latestDate, daysBehind: null, futureRows };

  if (daysBehind >= STALE_AFTER_DAYS) return { state: 'stale', latestDate, daysBehind, futureRows };
  if (daysBehind >= LAGGING_AFTER_DAYS) return { state: 'lagging', latestDate, daysBehind, futureRows };
  return { state: 'current', latestDate, daysBehind, futureRows };
}

/**
 * ⭐ ALWAYS RETURNS THE DATE, IN EVERY STATE. That is the whole point: the measured fact is
 * "data through <date>", and it must be on screen whether or not any threshold fired. A
 * signal that appears only when a rule trips leaves the healthy case describing the wrong
 * clock, which is the defect this file exists to remove.
 */
export function freshnessLabel(r: FreshnessReport): string {
  if (!r.latestDate) return 'Ad spend data: no dated rows';
  const age =
    r.daysBehind === null || r.daysBehind < 0
      ? ''
      : r.daysBehind === 0
        ? ' (today)'
        : r.daysBehind === 1
          ? ' (1 day ago)'
          : ` (${r.daysBehind} days ago)`;
  return `Ad spend data through ${r.latestDate}${age}`;
}

/** The warning sentence, or null. Separate from the label so the fact ships without it. */
export function freshnessWarning(r: FreshnessReport): string | null {
  if (r.state === 'stale') {
    return (
      /**
       * ⚠️ THE REMEDY CHANGED WITH THE SOURCE, AND LEAVING IT WOULD BE WORSE THAN VAGUE.
       * This used to say "check that the derived tab's array formula range still covers the
       * raw tab". After the cutover there is no tab and no formula, so that sentence sends
       * a reader to fix something that does not exist while the real cause — the meta-pull
       * Edge Function having stopped — goes unlooked-at. A stale instruction does not just
       * fail to help; it makes the WRONG move look like compliance.
       */
      `${freshnessLabel(r)} — no new ad spend rows for ${r.daysBehind} days. ` +
      `The Meta pull may have stopped: check the pull status in Settings (it runs every ` +
      `3 hours and writes to ad_pull_runs). Totals below are NOT up to date.`
    );
  }
  if (r.state === 'lagging') {
    return `${freshnessLabel(r)} — slower than the usual daily update. Not yet unusual enough to be a fault.`;
  }
  if (r.state === 'unknown' && r.latestDate) {
    return `Ad spend rows carry a date this app cannot read (${r.latestDate}), so its age is unknown.`;
  }
  // Reported EVEN WHEN THE FEED IS HEALTHY: these rows were excluded from the freshness
  // maths, and a silent exclusion is the same defect one level down.
  if (r.futureRows > 0) {
    return (
      `${r.futureRows} ad spend row${r.futureRows > 1 ? 's are' : ' is'} dated in the future and ` +
      `${r.futureRows > 1 ? 'were' : 'was'} ignored when checking data freshness. Check the sheet for a mistyped year.`
    );
  }
  return null;
}
