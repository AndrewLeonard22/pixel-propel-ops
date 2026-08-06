import type { AdSpendRow } from './types';

/**
 * ③ THE VALIDATION GATE + LAST-KNOWN-GOOD.
 *
 * @fable: "a suspicious refresh can still replace good data and that is the last way this
 * product silently ruins a number."
 *
 * ⭐ THE PREVIOUS-REFRESH COMPARISON IS THE WHOLE VALUE. A single-refresh check cannot see
 * spend HALVING: 19,000 rows and £320,000 are perfectly plausible numbers on their own, and
 * only look wrong beside the 38,997 rows and £655,675 that were there a minute ago. Every
 * other guard on this branch asks "is this value shaped correctly"; this one asks "did it
 * MOVE in a way a real feed does not."
 *
 * ⚠️ NEVER BLANKS THE PAGE. A rejected refresh keeps the LAST GOOD data on screen and says
 * so with BOTH numbers. Stale-but-labelled beats empty — the same call made on the
 * exclusions warning and the completeness banner.
 *
 * ⚠️ AND THE THRESHOLD IS AN ASSUMPTION, TREATED AS ONE. 50% is a judgement about what a
 * real feed does between refreshes; the NUMBERS are measurements and both are always shown,
 * so a reader who disbelieves the threshold can still see what changed.
 */

export interface RefreshSnapshot {
  rowCount: number;
  totalSpend: number;
  accountCount: number;
}

export interface RefreshVerdict {
  accept: boolean;
  /** One sentence per metric that collapsed, naming BOTH numbers. Empty when accepted. */
  reasons: string[];
  next: RefreshSnapshot;
  lastGood: RefreshSnapshot | null;
}

/** A drop to less than half is the collapse signature. Stated, not hidden. */
export const COLLAPSE_RATIO = 0.5;

export function snapshotOf(adSpend: AdSpendRow[], accountCount: number): RefreshSnapshot {
  const rows = Array.isArray(adSpend) ? adSpend : [];
  return {
    rowCount: rows.length,
    totalSpend: rows.reduce((s, r) => s + (Number(r?.spent) || 0), 0),
    accountCount,
  };
}

/**
 * Compare a refresh to the last accepted one.
 *
 * ⛔ THE FIRST REFRESH IS ALWAYS ACCEPTED. With nothing to compare against there is no
 * evidence of a collapse, and refusing would leave a new browser permanently empty — a
 * guard that prevents the product from ever starting.
 */
export function judgeRefresh(next: RefreshSnapshot, lastGood: RefreshSnapshot | null): RefreshVerdict {
  if (!lastGood) return { accept: true, reasons: [], next, lastGood };

  const reasons: string[] = [];
  const check = (name: string, was: number, now: number, fmt: (n: number) => string) => {
    // A previous value of zero cannot collapse — and dividing by it would produce a verdict
    // from nothing. Growth is never suspicious here; this gate is about loss.
    if (was > 0 && now < was * COLLAPSE_RATIO) {
      reasons.push(`${name} fell from ${fmt(was)} to ${fmt(now)}`);
    }
  };

  const int = (n: number) => Math.round(n).toLocaleString();
  const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  check('ad spend rows', lastGood.rowCount, next.rowCount, int);
  check('total spend', lastGood.totalSpend, next.totalSpend, money);
  check('accounts', lastGood.accountCount, next.accountCount, int);

  return { accept: reasons.length === 0, reasons, next, lastGood };
}

/** The on-screen sentence for a rejected refresh, or null. Names both numbers. */
export function rejectionMessage(v: RefreshVerdict): string | null {
  if (v.accept || v.reasons.length === 0) return null;
  return (
    `This refresh was REJECTED and the previous data is still shown: ${v.reasons.join('; ')}. ` +
    `A drop that large is not what a live feed does between refreshes, so the older numbers ` +
    `are more likely to be right. Reload to try again.`
  );
}
