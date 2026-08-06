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
 * the array formula runs out, the fetch still returns 200, the parse is still clean, every
 * source is still connected, and the screen still says "Fetched less than a minute ago"
 * over data that stopped moving. ⇒ 🔑 THE FREEZE HAS NO SYMPTOM.
 *
 * Every honest-state shipped tonight stays silent through it, because NOTHING FAILS. This
 * is "absence rendered as a plausible fact" at the DATA-AGE layer — the one layer the eight
 * surfaces never covered.
 *
 * ⭐ AND IT IS CHEAPER AND STRICTLY MORE AVAILABLE THAN THE ROW-COUNT DETECTOR:
 *   sheetCompleteness.ts  needs a raw-tab gid that AppSettings does not have, plus two
 *                         network probes, and must defeat gviz's silent tab fallback
 *   this                  needs NOTHING — `dateISO` is already parsed on every row
 * ⇒ they answer different questions and the cheap one covers the symptom. The row-count
 *   detector says HOW MANY ROWS were dropped; this says THE DATA STOPPED. Only the second
 *   is reachable today, so it is the one that ships the guarantee.
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
}

/** Ad platforms report on a lag; two days is unremarkable, four is not. Stated, not hidden. */
export const LAGGING_AFTER_DAYS = 2;
export const STALE_AFTER_DAYS = 4;

/** Newest `dateISO` in the feed. ISO strings sort lexicographically, so max is a compare. */
export function latestSourceDate(rows: AdSpendRow[]): string | null {
  // ⛔ NOT DEFENSIVE PADDING — @fable's contract is "it must NOT block rendering", and a
  // freshness probe that THROWS on an unexpected shape white-screens the whole app to
  // report that data might be old. Caught by the SourceStatusBanner tests, whose mock had
  // no `adSpend`: a consumer this reaches through a hook cannot promise its own inputs.
  if (!Array.isArray(rows)) return null;

  let best: string | null = null;
  for (const r of rows) {
    if (!r) continue;
    const d = r.dateISO;
    // Only well-formed dates. normalizeSourceDate returns '' for anything it could not
    // parse, and treating '' as a date would make the feed look infinitely old.
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (best === null || d > best) best = d;
  }
  return best;
}

/** Whole days from `from` to `to`, both YYYY-MM-DD. UTC so a timezone cannot shift a day. */
export function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

export function describeFreshness(rows: AdSpendRow[], todayIso: string): FreshnessReport {
  const latestDate = latestSourceDate(rows);
  if (!latestDate) return { state: 'unknown', latestDate: null, daysBehind: null };

  const daysBehind = daysBetween(latestDate, todayIso);
  if (daysBehind === null) return { state: 'unknown', latestDate, daysBehind: null };

  // A future-dated row is not freshness, it is a data problem — and calling it "current"
  // would let one bad row mask a frozen feed behind it.
  if (daysBehind < 0) return { state: 'unknown', latestDate, daysBehind };

  if (daysBehind >= STALE_AFTER_DAYS) return { state: 'stale', latestDate, daysBehind };
  if (daysBehind >= LAGGING_AFTER_DAYS) return { state: 'lagging', latestDate, daysBehind };
  return { state: 'current', latestDate, daysBehind };
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
      `${freshnessLabel(r)} — no new ad spend rows for ${r.daysBehind} days. ` +
      `The sheet may have stopped appending: check that the derived tab's array formula ` +
      `range still covers the raw tab. Totals below are NOT up to date.`
    );
  }
  if (r.state === 'lagging') {
    return `${freshnessLabel(r)} — slower than the usual daily update. Not yet unusual enough to be a fault.`;
  }
  if (r.state === 'unknown' && r.latestDate) {
    return `Ad spend rows carry a date this app cannot read (${r.latestDate}), so its age is unknown.`;
  }
  return null;
}
