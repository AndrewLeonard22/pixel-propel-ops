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
