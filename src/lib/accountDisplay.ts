/**
 * HOW AN AD ACCOUNT IS NAMED ON SCREEN — one rule, one place.
 *
 * 🔴 THE DEFECT THIS EXISTS TO KILL, in @andrew's words: "it shouldn't even say airtable.
 * It should say company name."
 *
 * `ad_accounts.company_name` was seeded from a legacy JSON whose `airtableName` field had,
 * for a large minority of rows, the raw Meta account id pasted into it — `"10170221, USD"`.
 * The old row rendered `company_name` BOLD and `meta_name` MUTED, so the screen showed
 *
 *     10170221, USD                       <- bold, presented as the company
 *     Columbia Outdoor Restoration X …    <- muted, the actual client
 *
 * The name and the label were inverted, and the guard that would have caught it
 * (`isJunkAccount`) already existed one directory away in Settings.tsx and was never
 * imported here. A guard that is not on the render path is not a guard.
 *
 * ⛔ THE RULE IS ONE-DIRECTIONAL AND HAS NO EXCEPTIONS: the COMPANY is always the title and
 * the META ACCOUNT NAME is always the subtext. When there is no trustworthy company we say
 * so in words — we never promote a number into the title slot to fill it.
 */

/**
 * A string that is an ACCOUNT ID wearing a company's clothes.
 *
 * Covers every junk shape measured in the live table on 2026-08-11:
 *   "10170221, USD"        raw id + currency, the dominant form (4 rows)
 *   "391432983081972"      bare id, no currency
 *   "1234, 5678"           comma-separated digits
 *   ""  /  "   "           blank, which COALESCE happily returned as a name
 */
export function isJunkCompanyName(name: string | null | undefined): boolean {
  if (name == null) return true;
  const t = name.trim();
  if (t === '') return true;
  return /^[\d,\s]+(USD|[A-Z]{3})?$/i.test(t);
}

export type MappingState =
  /** A human chose this name, and it is not merely a copy of what Meta calls the account. */
  | 'mapped'
  /**
   * `company_name` is byte-identical to `meta_name`. It LOOKS mapped and nobody ever
   * confirmed it — the seed copied Meta's name across wholesale, so every bit of Meta-side
   * junk (" X SocialWorks", " Ad Account") leaked into the company column.
   *
   * ⚠️ Rendering this identically to `mapped` is why the screen "seems so broken" in a way
   * that could be felt but not pointed at. It gets its own quiet label instead.
   */
  | 'unconfirmed'
  /** No usable company name at all. Never rendered as a number. */
  | 'unmapped';

export interface AdAccountLike {
  account_id: string;
  meta_name: string | null;
  company_name: string | null;
}

export function classifyMapping(r: AdAccountLike): MappingState {
  const company = (r.company_name ?? '').trim();
  const meta = (r.meta_name ?? '').trim();
  if (isJunkCompanyName(company)) return 'unmapped';
  if (company === r.account_id) return 'unmapped';
  if (meta && company.toLowerCase() === meta.toLowerCase()) return 'unconfirmed';
  return 'mapped';
}

/**
 * What goes in the TITLE cell.
 *
 * Returns `null` for unmapped rather than a fallback string, so the caller is forced to
 * decide how to say "we do not know" instead of silently receiving something printable.
 * A fallback that returns the meta name here is how the inversion came back the first time:
 * the caller then has no way to tell a real company from a stand-in.
 */
export function displayCompany(r: AdAccountLike): string | null {
  return classifyMapping(r) === 'unmapped' ? null : (r.company_name ?? '').trim();
}

/**
 * What goes in the SUBTEXT cell — always Meta's own name for the account.
 *
 * ⚠️ One live row has the raw id in BOTH columns (`391432983081972`), so there is no real
 * name anywhere in the database for it. It must read as an explicit unknown rather than
 * echoing the number back a second time under a different label.
 */
export function displayMetaName(r: AdAccountLike): string | null {
  const meta = (r.meta_name ?? '').trim();
  if (!meta || isJunkCompanyName(meta)) return null;
  return meta;
}

/** Sort key for the identity column: the string the user actually SEES, lowercased. */
export function sortKey(r: AdAccountLike): string {
  return (displayCompany(r) ?? displayMetaName(r) ?? r.account_id).toLowerCase();
}

/**
 * MONEY, IN ONE PLACE, BECAUSE TWO PLACES DISAGREED.
 *
 * 🔴 THE DEFECT: the table wrote `!n ? '—' : …` and the edit panel wrote `n == null ? '—' : …`
 * under the SAME NAME. `!0` is true, so 28 of 52 accounts — every account with a measured
 * $0 over the last 30 days — rendered as an em dash in the table and as `$0` in the panel
 * one click later. An em dash means "we do not know"; $0 means "we looked and it was
 * nothing". Collapsing those two is the same class of dishonesty as the mapping bug: the
 * screen states something it has not earned, and it contradicts itself between two views.
 *
 * `n == null` catches null AND undefined and nothing else. Zero survives as zero.
 */
export function formatMoney(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

/**
 * THE SAME ONE-DIRECTIONAL RULE, APPLIED OUTSIDE SETTINGS.
 *
 * 🔴 Every screen except Settings rendered `AccountSummary.accountName` — the raw Meta
 * account name, " X SocialWorks" and all — because the curated company name was not on the
 * summary at all. See src/lib/accountRegistry.ts for why that made the mapping write-only.
 *
 * ⛔ THE FALLBACK IS STILL NOT A NUMBER. When there is no curated company we show what Meta
 * calls the account, which is at least a real name — unless Meta's name is itself an account
 * id in disguise ("391432983081972, USD", one live row), in which case there is no name
 * anywhere in the system and the honest render says so in words. Promoting the number into
 * the title to fill the slot is the exact inversion @andrew reported.
 */
export interface AccountTitleLike {
  accountName: string;
  companyName?: string | null;
}

export interface AccountTitle {
  /** What to print. Never an account id, never blank. */
  label: string;
  /** True when a human curated this name. False means it is Meta's, or unknown. */
  curated: boolean;
  /** Meta's own name, when it differs from the label and is worth showing as subtext. */
  subtitle: string | null;
}

export function accountTitle(a: AccountTitleLike): AccountTitle {
  const meta = (a.accountName ?? '').trim();
  const company = (a.companyName ?? '').trim();
  if (company && !isJunkCompanyName(company)) {
    return {
      label: company,
      curated: true,
      // Only worth repeating when it says something the label does not.
      subtitle: meta && !isJunkCompanyName(meta) && meta.toLowerCase() !== company.toLowerCase() ? meta : null,
    };
  }
  if (meta && !isJunkCompanyName(meta)) return { label: meta, curated: false, subtitle: null };
  return { label: 'Unnamed ad account', curated: false, subtitle: null };
}
