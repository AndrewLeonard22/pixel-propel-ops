/**
 * ACCOUNT IDENTITY. Item ④.
 *
 * THE ACCOUNT COLUMN IS UNTYPED. Measured on the live derived tab — 38,944 rows,
 * 63 distinct values, of which 63 are supposed to be ~61 real accounts:
 *
 *   ① META IDS IN A NAME COLUMN — 4 values, $28,871.96
 *        '10170221, USD'  '103578393327348, USD'  '222178771, USD'  '391432983081972, USD'
 *      These are account IDs with a currency suffix, not names. They cannot be matched
 *      to an Airtable client name by any string rule, so their spend is orphaned.
 *
 *   ② TRAILING-SPACE TWINS — 2 pairs, and this is the one that splits money
 *        'Co-Lights'        104 rows $2,278.73   +  'Co-Lights '        57 rows $926.03
 *        'Trimlight Phoenix' 66 rows $1,645.83   +  'Trimlight Phoenix ' 128 rows $3,071.44
 *      ONE real advertiser rendered as TWO accounts, with money on both sides — each
 *      showing a fraction of its true spend, and each computing its own CPL.
 *
 *   TOTAL SPEND AT RISK OF MIS-ATTRIBUTION: $36,793.99
 *
 * THE RULE: group by `accountKey`, never by the raw string. Aliases in config.ts already
 * match case- and whitespace-insensitively (`getAccountMapping`), so the raw-string
 * grouping in the aggregate is the only place still splitting them.
 */

/**
 * The identity key for an account name.
 * Trims, collapses internal whitespace runs, and case-folds — so 'Co-Lights ',
 * 'Co-Lights' and 'co-lights' are one account.
 *
 * DOES NOT strip punctuation: 'Co-Lights' and 'Co Lights' are left DISTINCT on purpose.
 * Merging those would be a guess about the business, not a normalisation of formatting,
 * and a wrong merge moves money between two real advertisers.
 */
export function accountKey(raw: string | null | undefined): string {
  return String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * True when the value is a Meta account id rather than a name — an all-digit run of 6+,
 * optionally followed by a currency suffix like ', USD'.
 *
 * These are reported, never silently renamed: the mapping from id to advertiser is not
 * derivable from the feed, so a human has to supply it.
 */
export function isIdShapedAccount(raw: string | null | undefined): boolean {
  return /^\s*\d{6,}\s*(,\s*[A-Z]{3})?\s*$/.test(String(raw ?? ''));
}

export interface AccountIdentity {
  /** the key everything should group by */
  key: string;
  /** the form to show a human: the most common spelling, ties broken by the trimmed one */
  display: string;
  /** every raw spelling seen for this account */
  variants: string[];
  /** true when more than one raw spelling collapsed into this identity */
  wasSplit: boolean;
  /** true when the name is a Meta id and needs a human mapping */
  needsMapping: boolean;
}

/**
 * Resolve a list of raw account-name occurrences (one entry per ROW, so frequency is
 * meaningful) into distinct identities.
 */
export function resolveAccountIdentities(
  rawNamesPerRow: (string | null | undefined)[],
): Map<string, AccountIdentity> {
  const counts = new Map<string, Map<string, number>>();
  for (const raw of rawNamesPerRow) {
    const key = accountKey(raw);
    if (!key) continue;
    const variant = String(raw ?? '');
    if (!counts.has(key)) counts.set(key, new Map());
    const m = counts.get(key)!;
    m.set(variant, (m.get(variant) || 0) + 1);
  }

  const out = new Map<string, AccountIdentity>();
  for (const [key, variantCounts] of counts) {
    const variants = [...variantCounts.keys()];
    // Most frequent spelling wins; ties go to the trimmed form, then alphabetical, so
    // the choice is deterministic rather than dependent on row order.
    const display = [...variantCounts.entries()].sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      const at = a[0] === a[0].trim() ? 0 : 1;
      const bt = b[0] === b[0].trim() ? 0 : 1;
      if (at !== bt) return at - bt;
      return a[0].localeCompare(b[0]);
    })[0][0];

    out.set(key, {
      key,
      display: display.trim(),
      variants,
      wasSplit: variants.length > 1,
      needsMapping: isIdShapedAccount(display),
    });
  }
  return out;
}

/** One account's footprint in the spend feed, reduced to what a rename test needs. */
export interface AccountSpan {
  /** the account label exactly as the feed spells it */
  name: string;
  /** every campaign id seen under that label */
  campaignIds: string[];
  /** ISO day of the earliest and latest spend row, inclusive */
  firstDay: string;
  lastDay: string;
}

export interface RenameSuspect {
  before: string;
  after: string;
  /** campaign ids that appear under BOTH labels */
  sharedCampaignIds: string[];
  /** whole days between `before`'s last row and `after`'s first row */
  gapDays: number;
}

/**
 * Detect ONE REAL ACCOUNT SPLIT INTO TWO BY A RENAME.
 *
 * @fable measured the live signature: Publicity 1 → Washbroz X SocialWorks, THREE shared
 * campaign ids, date spans ABUTTING WITH ZERO OVERLAP. Money lands on both sides and the
 * dashboard shows two clients where there is one.
 *
 * ⚠️ WHY BOTH CONDITIONS, AND WHY NEITHER ALONE. Shared campaign ids on their own are
 * ordinary — @fable also measured 16 of 190 ids under two names, and a campaign genuinely
 * moved between accounts overlaps in time. Abutting spans on their own are ordinary too:
 * one client churns the week another starts. It is the CONJUNCTION that is hard to produce
 * any other way — the same campaigns, and one label stops exactly when the other begins.
 *
 * ⛔ THIS REPORTS. IT DOES NOT MERGE. A rename and a genuine hand-off look identical in the
 * feed, and the difference is a fact about the business that no column carries. Merging on
 * this signature would silently combine two real clients; the honest output is a named
 * suspicion a human confirms — which is the same rule `needsMapping` already follows.
 *
 * POPULATION: every ORDERED pair of distinct accounts. `before` is the one whose span ends
 * first; a pair whose spans OVERLAP is not a rename candidate and is skipped.
 */
export function detectRenameSuspects(
  spans: AccountSpan[],
  opts: { maxGapDays?: number } = {},
): RenameSuspect[] {
  // A rename is a handover, so the gap is small. Default 1 day = "abutting or same day".
  // Deliberately NOT 0: a Friday-to-Monday handover is two calendar days apart and is the
  // same event. This is a threshold and it is stated rather than hidden.
  const maxGap = opts.maxGapDays ?? 1;
  const out: RenameSuspect[] = [];

  for (const a of spans) {
    for (const b of spans) {
      if (a === b) continue;
      if (accountKey(a.name) === accountKey(b.name)) continue; // twins, not a rename
      // ORDER: `a` must finish before `b` starts, with no overlap at all.
      if (!(a.lastDay < b.firstDay)) continue;
      const shared = a.campaignIds.filter(id => {
        const t = (id || '').trim();
        return t !== '' && b.campaignIds.some(o => (o || '').trim() === t);
      });
      if (shared.length === 0) continue;
      const gapDays = Math.round(
        (Date.parse(b.firstDay) - Date.parse(a.lastDay)) / 86_400_000,
      );
      if (gapDays > maxGap) continue;
      out.push({
        before: a.name,
        after: b.name,
        sharedCampaignIds: Array.from(new Set(shared)).sort(),
        gapDays,
      });
    }
  }
  return out;
}
