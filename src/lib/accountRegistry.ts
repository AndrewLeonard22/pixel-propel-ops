/**
 * THE ACCOUNT MAPPING, MADE LOAD-BEARING.
 *
 * 🔴 THE DEFECT THIS EXISTS TO KILL: the mapping screen was WRITE-ONLY.
 *
 * @andrew: "fix this account mapping ... it just seems so broken" and "it shouldn't even
 * say airtable. It should say company name." The Settings table was rebuilt around
 * `ad_accounts.company_name` and it is correct there — and `src/lib/accountDisplay.ts`, the
 * module that decides how an account is named, was imported by exactly three files, all of
 * them inside Settings. `ad_accounts.company_name` was read NOWHERE ELSE IN THE APP.
 *
 * Every other screen (Dashboard, Accounts, Campaigns, Team) resolved identity from
 * `AdSpendRow.accountName` — the raw Meta name, " X SocialWorks" and all — and resolved
 * program and media buyer from the legacy `app_settings.accountAliases` JSON, which a
 * headless effect in Settings.tsx seeds as `{sheetName: name, airtableName: name}`.
 *
 * So the user renamed an account, watched the Settings row update, and NOTHING else in the
 * product changed. Complaint 2 was fixed on one screen out of seven. That is the same shape
 * as the bug that started this project: a screen stating something it has not earned.
 *
 * ⭐ THE JOIN KEY, AND WHY IT IS THE ONLY ONE AVAILABLE.
 *
 * `ad_accounts` is keyed on `account_id`, which Meta does not let anyone edit. `AdSpendRow`
 * has NO account id field at all — the Dashboard's feed is a Google Sheet whose ad-spend tab
 * carries `accountName` and nothing else identifying. The only key the two share is the Meta
 * account NAME.
 *
 * ⚠️ AND A NAME IS NOT AN IDENTITY, which is exactly why this module is written the way it
 * is rather than as a one-line `.find()`:
 *
 *   ① EXACT normalised equality only. Case and surrounding/duplicated whitespace are
 *      folded (four live rows are stored as "STR ", "Co-Lights ", "Trimlight Phoenix ",
 *      "Quality Painting " with a trailing space). NOTHING fuzzy. dataService already runs
 *      a Levenshtein tier for APPOINTMENTS, where a wrong match costs one booking; a wrong
 *      match HERE renames a client's whole account and re-labels its program.
 *   ② A COLLIDING NAME MAPS TO NOTHING. If two `ad_accounts` rows normalise to the same
 *      name, both are dropped from the index and the caller falls back. Preferring the dupe
 *      over a coin-flip is the rule: silently attributing one client's spend to another is
 *      strictly worse than not resolving it. (Measured 2026-08-12: 52 rows, 52 distinct
 *      normalised names, so today the index is total. It is not assumed to stay that way.)
 *   ③ A JUNK NAME IS NOT A KEY. `meta_name` is the raw id string for at least one live row
 *      ("391432983081972, USD"), and indexing on it would let a number match a number.
 *
 * ⭐ MEASURED COVERAGE, 2026-08-12, against the live feed and the live table. 62 distinct
 * ad-spend account names: **4 resolve by account id, 47 by name, 11 not at all.** The 11
 * fall back to the legacy alias store, which is exactly what they did before this module
 * existed, so nothing regresses on them:
 *
 *     Christmas Light Pros · Green Plus · Home Remodeling Pros X SocialWorks ·
 *     Mac's Pressure Washing · Mission Exterior Cleaning · No Streaks x SocialWorks ·
 *     Ortiz Pro Wash · Pergolaguy.com · Platinum · Publicity 1 · SW |Green Plus
 *
 * ⚠️ "No Streaks x SocialWorks" is in that list while `ad_accounts` holds "no streaks &
 * social works" — a fuzzy matcher WOULD catch it, and it is still refused. That account
 * spent $7,008 in 2026, so guessing it wrong is a five-figure misattribution, and the way
 * to fix it is one edit to `meta_name`, not a similarity threshold that then applies to
 * every other pair on the list. Renaming a client's account is not a place to be 85% sure.
 *
 * ⛔ WHAT THIS DELIBERATELY DOES NOT OWN: `status`. `ad_accounts.status` is two-valued
 * (active/archived) and answers "do we still manage this ad account". The legacy store's
 * status is three-valued (Active/Paused/Churned) and answers "what is the commercial state
 * of this client". Those are different questions, and folding them into one field is the
 * two-owner-model defect wearing a fix's clothes. The one exception is stated in
 * `resolveStatus` below, and it exists so that the Archived control is not a control that
 * does nothing.
 */

import { supabase } from '@/integrations/supabase/client';
import { displayCompany, isJunkCompanyName, type AdAccountLike } from '@/lib/accountDisplay';

export interface AdAccountRecord extends AdAccountLike {
  account_id: string;
  meta_name: string | null;
  company_name: string | null;
  program: string | null;
  media_buyer: string | null;
  status: string | null;
}

/** What the rest of the app is allowed to learn about an account from this table. */
export interface AccountIdentity {
  accountId: string;
  /** The curated client name. `null` means unmapped — NEVER a number, never a stand-in. */
  company: string | null;
  /** `null` means nobody has chosen one. It is not "Done For You". */
  program: string | null;
  /** `null` means unassigned. */
  mediaBuyer: string | null;
  /** Raw `ad_accounts.status`: 'active' | 'archived'. See resolveStatus. */
  status: string | null;
}

/**
 * One row of `ad_account_airtable_names` — the JOIN KEY from Airtable's "Client Name" to
 * Meta's `account_id`.
 *
 * ⚠️ `airtable_name` IS A MATCH KEY, NOT A DISPLAY LABEL. It must equal what Airtable
 * literally holds, odd spacing and lowercase "l" separators included. A previous agent
 * nearly "cleaned" the equivalent field in the legacy alias store, which would have
 * detached four accounts from their appointments while fixing nothing visible.
 */
export interface AirtableNameLink {
  airtable_name_key: string;
  airtable_name: string;
  account_id: string;
}

export interface AccountRegistry {
  /** How many accounts are indexed. 0 means "we could not look", see `known`. */
  size: number;
  /**
   * Did the `ad_accounts` read actually answer? A failed read must not be indistinguishable
   * from "there are no accounts" — that is the refusal-becomes-a-value shape, and here it
   * would silently revert the whole app to the legacy names with no trace.
   */
  known: boolean;
  /**
   * Resolve whatever the ad-spend feed calls this account. Tries the ACCOUNT ID first (a
   * real key) and the Meta name second (a label). See `accountIdIn` for why the id path
   * exists at all.
   */
  byMetaName(name: string | null | undefined): AccountIdentity | null;
  /** The id path on its own, for callers that already hold an id. */
  byAccountId(id: string | null | undefined): AccountIdentity | null;
  /**
   * ⭐ THE STABLE PATH FROM AN AIRTABLE CLIENT NAME TO A META ACCOUNT.
   *
   * An appointment arrives carrying a client NAME and needs an account. Before this, that
   * question was answered by `accountAliases[].airtableName -> sheetName -> whatever the
   * sheet called the account today` — a chain whose left-hand side Meta rewrites. Five
   * confirmed renames later, the chain resolves through `account_id` instead, which nobody
   * can edit.
   *
   * Returns the ACCOUNT ID, not an identity: the caller needs the grouping key, and an
   * account with no spend rows in range must still resolve to an id so the appointment can
   * be attributed rather than silently dropped.
   */
  airtableNameToAccountId(clientName: string | null | undefined): string | null;
  /** How many Airtable client names are mapped. 0 with `known: true` means the table is empty. */
  airtableNameCount: number;
}

/** Fold case, trim, and collapse internal runs of whitespace. Nothing else. */
export function normalizeAccountName(name: string | null | undefined): string {
  return (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * ⭐ THE JUNK IS NOT JUNK. IT IS THE PRIMARY KEY.
 *
 * Measured 2026-08-12 against the live feed: 14 of the 62 account names in the ad-spend
 * source do not match any `ad_accounts.meta_name`, and FOUR of those are the strings at the
 * centre of @andrew's complaint — "10170221, USD", "103578393327348, USD", "222178771, USD",
 * "391432983081972, USD". Those leading digits are the Meta `account_id`, which is
 * `ad_accounts`' PRIMARY KEY:
 *
 *     10170221         -> Columbia Outdoor Restoration
 *     103578393327348  -> TrueClean
 *     222178771        -> Pro Clean Mobile Wash
 *
 * So the rows that read worst on screen are the ones that can be resolved with the STRONGEST
 * key in the system. This is the opposite of the name join and its risks: an id is not a
 * label, nobody edits it, and it cannot collide.
 *
 * ⛔ THE SHAPE IS DELIBERATELY NARROW: all digits, optionally followed by a comma and a
 * three-letter currency code, and nothing else. It is NOT "pull the digits out of any
 * string" — "Publicity 1" and "Safe Turf Ad Account" must not be dragged in by a stray
 * numeral. Returns null for anything that is not exactly this shape.
 */
export function accountIdIn(name: string | null | undefined): string | null {
  const m = /^(\d+)(?:\s*,\s*[A-Za-z]{3})?$/.exec((name ?? '').trim());
  return m ? m[1] : null;
}

const EMPTY: AccountRegistry = {
  size: 0, known: false, byMetaName: () => null, byAccountId: () => null,
  airtableNameToAccountId: () => null, airtableNameCount: 0,
};

/** A registry that answers nothing, and SAYS it was never told anything. */
export function emptyAccountRegistry(): AccountRegistry {
  return EMPTY;
}

export function buildAccountRegistry(
  rows: readonly AdAccountRecord[],
  airtableNames: readonly AirtableNameLink[] = [],
): AccountRegistry {
  const index = new Map<string, AccountIdentity>();
  const byId = new Map<string, AccountIdentity>();
  const collided = new Set<string>();

  for (const r of rows) {
    const identity: AccountIdentity = {
      accountId: r.account_id,
      // Routed through `displayCompany` so the one-directional rule (never promote a number
      // into the company slot) is enforced in ONE place. A second copy of that test here is
      // how the inversion came back the first time.
      company: displayCompany(r),
      program: r.program?.trim() || null,
      mediaBuyer: r.media_buyer?.trim() || null,
      status: r.status?.trim() || null,
    };
    // The id index is unconditional: `account_id` is the table's primary key, so it needs
    // none of the collision or junk guards the name index needs.
    if (r.account_id) byId.set(r.account_id.trim(), identity);

    // ③ A junk `meta_name` is not a key: it is an account id in a name's clothing, and two
    // different accounts can carry the same shape of junk.
    if (isJunkCompanyName(r.meta_name)) continue;
    const key = normalizeAccountName(r.meta_name);
    if (!key) continue;

    if (index.has(key)) {
      // ② PREFER THE DUPE. Two accounts answering to one name means the name identifies
      // neither of them, so it must resolve to nothing rather than to whichever row the
      // query happened to return first.
      collided.add(key);
      continue;
    }
    index.set(key, identity);
  }
  for (const key of collided) index.delete(key);

  const byAccountId = (id: string | null | undefined) => {
    const k = (id ?? '').trim();
    return k ? byId.get(k) ?? null : null;
  };

  /**
   * ⚠️ NORMALISED WITH THE SAME RULE AS THE DATABASE'S PRIMARY KEY (`lower(btrim(...))`),
   * plus internal whitespace collapse for the client side, because Airtable's own values
   * carry stray inner spacing ('San Antonio l Backyard Paradiso '). The DB enforces one
   * account per name; this map must not be able to disagree with it about what "one name"
   * is, so a client-side collision drops BOTH entries rather than picking a winner —
   * the same "prefer the dupe" rule the name index uses one block above.
   */
  const airtableIndex = new Map<string, string>();
  const airtableCollided = new Set<string>();
  for (const link of airtableNames) {
    const key = normalizeAccountName(link.airtable_name ?? link.airtable_name_key);
    const acct = (link.account_id ?? '').trim();
    if (!key || !acct) continue;
    if (airtableIndex.has(key) && airtableIndex.get(key) !== acct) { airtableCollided.add(key); continue; }
    airtableIndex.set(key, acct);
  }
  for (const key of airtableCollided) airtableIndex.delete(key);

  return {
    // Counts what can be resolved BY NAME. The id index is a superset and is not the number
    // anyone means when they ask how many accounts are mapped.
    size: index.size,
    known: true,
    byAccountId,
    airtableNameCount: airtableIndex.size,
    airtableNameToAccountId: (clientName) => {
      const key = normalizeAccountName(clientName);
      return key ? airtableIndex.get(key) ?? null : null;
    },
    byMetaName: (name) => {
      // ⭐ ID FIRST. A key beats a label, always, and the four names this rescues are
      // precisely the ones @andrew pointed at.
      const fromId = byAccountId(accountIdIn(name));
      if (fromId) return fromId;
      const key = normalizeAccountName(name);
      return key ? index.get(key) ?? null : null;
    },
  };
}

/**
 * ⭐ PRECEDENCE, WRITTEN DOWN ONCE.
 *
 * The curated value wins when there IS one. `null` in `ad_accounts` is not a curated value,
 * it is the absence of one, so it falls through to the legacy alias rather than overwriting
 * a real legacy answer with nothing.
 */
export function resolveProgram(id: AccountIdentity | null, legacy: string | null | undefined): string | null {
  return id?.program ?? (legacy?.trim() || null);
}

export function resolveMediaBuyer(id: AccountIdentity | null, legacy: string | null | undefined): string | null {
  return id?.mediaBuyer ?? (legacy?.trim() || null);
}

/**
 * ⚠️ THE ONE PLACE THE TWO STATUS MODELS TOUCH, and it is one-directional on purpose.
 *
 * `ad_accounts.status = 'archived'` is an explicit human act on the mapping screen, and
 * before this the app rendered no consequence of it anywhere: the panel wrote the column,
 * the table drew a chip, and every dashboard grouping went on treating the account as live.
 * A control whose only effect is to draw its own label is not a control.
 *
 * `archived` therefore overrides to `Churned`, which is the legacy vocabulary's word for the
 * same thing. `active` does NOT override anything: the legacy store distinguishes Active
 * from Paused and `ad_accounts` cannot express Paused at all, so letting `active` win would
 * DESTROY information — a coarser field overwriting a finer one is a downgrade, not a fix.
 */
export function resolveStatus(id: AccountIdentity | null, legacy: string | null | undefined): string {
  if (id?.status === 'archived') return 'Churned';
  return legacy?.trim() || 'Active';
}

/**
 * Read the whole table. 52 rows today, one column set, no pagination: the cost of getting
 * this wrong (every screen silently reverting to Meta's names) is far above the cost of one
 * small select.
 */
export async function fetchAccountRegistry(): Promise<AccountRegistry> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const [accounts, names] = await Promise.all([
      sb.from('ad_accounts').select('account_id, meta_name, company_name, program, media_buyer, status'),
      sb.from('ad_account_airtable_names').select('airtable_name_key, airtable_name, account_id'),
    ]);
    // A failed read resolves to `known: false`, never to an empty index. The caller then
    // keeps the legacy names, which are stale but real, instead of being told there are no
    // accounts.
    if (accounts.error || !Array.isArray(accounts.data)) return EMPTY;
    /**
     * ⚠️ THE NAME TABLE FAILING IS NOT "THERE ARE NO NAMES", but it must also not take the
     * registry down — losing the whole account mapping to recover a join fallback would
     * trade a big outage for a small one. It degrades to the legacy alias path, which is
     * exactly what existed before this table, so nothing regresses on its absence.
     */
    const links = !names.error && Array.isArray(names.data) ? (names.data as AirtableNameLink[]) : [];
    return buildAccountRegistry(accounts.data as AdAccountRecord[], links);
  } catch {
    return EMPTY;
  }
}
