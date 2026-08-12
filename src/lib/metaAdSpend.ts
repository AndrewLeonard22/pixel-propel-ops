/**
 * AD SPEND, FROM SUPABASE.
 *
 * 🔴 THE DEFECT THIS EXISTS TO KILL. Every number on Dashboard / Media Buying / Targets /
 * Team Performance came from a Google Sheet CSV, while `ad_insights` — written every three
 * hours by the meta-pull Edge Function, straight from the Meta API — was read by NOTHING.
 * Measured in the live production bundle: `docs.google.com/spreadsheets` 1, `ad_insights` 0.
 *
 * The sheet had drifted, and drifted SILENTLY:
 *   · 2026-07-01..2026-08-07 — 38 days, ~$77,000 — was entirely absent from it.
 *   · Its Windsor pipeline had been reporting `Column 'date' not found in headers` since
 *     2025-09-24, and only the raw tab still filled.
 *   · Row COUNT stayed roughly constant while new days overwrote old rows, so the
 *     row-count completeness detector stayed green the whole time.
 * Measured delta for 2025-01-01..2026-08-11: sheet $604,025.09, ad_insights $770,920.57.
 * The dashboard was understating spend by $166,895 — 27.6% — and nothing said so.
 *
 * ⭐ WHY THIS IS NOT "THE SAME NUMBERS FROM A NICER PLACE". `ad_insights` carries
 * `account_id`, which the sheet never did. Meta REWRITES an account's display name and the
 * sheet then SPLITS one client across two names — five confirmed, including
 * `Publicity 1` -> `Washbroz X SocialWorks` and `Christmas Light Pros` -> `Hydro Pro Wash
 * X SocialWorks`, neither of which any similarity metric could ever pair. `account_id` is
 * the identity Meta does not let anyone edit, so it becomes the identity here.
 *
 * ⚠️ THE ROW SHAPE IS DELIBERATELY UNCHANGED. `AdSpendRow` keeps every field the sheet
 * populated, so `buildAccountSummaries` and the five pages below it are untouched by the
 * source swap. `accountId` is ADDITIVE, exactly as `dateISO` was: present from this source,
 * absent from the fixtures in 600 tests, and every reader falls back to the old key when it
 * is missing. Adapt at the boundary, not in every page.
 */
import { supabase } from '@/integrations/supabase/client';
import { isSupabaseConfigured } from '@/integrations/supabase/client';
import type { AdSpendRow, AppSettings } from './types';

/**
 * The view read by this module. It is `ad_insights` already joined to `ad_accounts`, so
 * the curated company / program / media buyer travel WITH the spend row rather than being
 * re-joined by name on the client — which is the join that Meta renames kept breaking.
 */
export const AD_SPEND_VIEW = 'ad_insights_resolved';

/**
 * The TABLE the view is a lens on. Never read for data — only counted, so that the view can
 * be proved to still expose every row of it. See `countBaseSpendRows`.
 */
export const AD_SPEND_BASE = 'ad_insights';

/**
 * ⭐ THE COLUMN CONTRACT, and the reason it is a named constant rather than a string
 * literal inside the query.
 *
 * The sheet path had `WINDSOR_COLUMNS` and a test that proved, in BOTH directions, that
 * every column the contract names is read by the mapper and every field the mapper reads
 * is in the contract. That test is the reason a renamed column could not silently become
 * a column of zeros. The source changed; the law did not. This array is what the new
 * version of that test reads.
 *
 * ⚠️ Postgres types most of these for us — `spend` is numeric, `date` is a date, `leads`
 * is an integer — so the CSV-era hazards (a header renamed, a column present and entirely
 * blank, `Spent` vs `Spend`) are gone by construction. What is NOT gone is a column being
 * dropped from this select and every value it fed quietly becoming zero, which is why the
 * both-directions proof survives the cutover.
 */
export const META_SPEND_COLUMNS = [
  'date',
  'ad_id',
  'account_id',
  'account_name',
  'campaign_id',
  'campaign_name',
  'adset_id',
  'adset_name',
  'ad_name',
  'spend',
  'leads',
] as const;

export const META_SPEND_SELECT = META_SPEND_COLUMNS.join(',');

/**
 * PostgREST answers at most 1000 rows per request and says nothing about the rest. At
 * 48,000+ rows that default is a 98% data loss that arrives as a valid-looking success —
 * and the refresh gate cannot catch it, because the gate compares against the LAST
 * ACCEPTED refresh and the first refresh of every page load is accepted unconditionally.
 * So the loop below is not an optimisation, it is the thing standing between the user and
 * a dashboard that is wrong by an order of magnitude on a cold load.
 */
export const PAGE_SIZE = 1000;

/**
 * A hard stop, so a server that never runs out of rows cannot spin forever. 200 requests
 * against a 48,611-row table is four times what a clean run needs, and reaching it is a bug,
 * not a big customer, so it THROWS rather than returning what it has. Returning a truncated
 * set here would be the exact silent-incompleteness this module exists to remove.
 */
export const MAX_PAGES = 200;

/**
 * ⭐ THE PRIMARY KEY, AS A STRING, AND WHY THE FETCHER NEEDS IT.
 *
 * 🔴 THE HOLE THIS CLOSES, found by mutation-testing the guards and named there:
 * `checkMetaCompleteness` RECONCILES COUNTS, so a paging fault that DUPLICATES one row while
 * SKIPPING another still balances. 48,611 fetched === 48,611 counted, state `complete`, and a
 * real ad's spend has been replaced by a second copy of its neighbour's. That is the exact
 * shape this module exists to remove — a wrong number wearing a clean bill of health — and
 * the count reconciliation is structurally blind to it, in the same way the sheet's
 * raw-vs-derived probe was blind to rows being overwritten instead of appended.
 *
 * ⚠️ AND IT IS REACHABLE, not theoretical. `.range()` paging is OFFSET paging: it re-runs the
 * query per page and counts rows from the start. A row inserted or deleted at a date EARLIER
 * than the current page shifts every later page by one, which duplicates one row at the
 * boundary and skips exactly one. The meta-pull writes every three hours, and a DELETE of a
 * restated ad row is a normal thing for it to do.
 *
 * ⛔ NOT `ad_id` ALONE. The table's key is `(date, ad_id)`: one ad has one row per DAY, so
 * deduping on the ad alone would collapse an ad's whole history into a single day and lose
 * real spend — a far worse bug than the one being fixed. The separator is NUL, which cannot
 * occur in either field, so two distinct keys can never render as one string.
 */
export function spendRowKey(r: { date?: unknown; ad_id?: unknown }): string {
  return `${String(r.date ?? '')}\u0000${String(r.ad_id ?? '')}`;
}

/** An inclusive ISO date window. Both ends optional; absent means unbounded on that side. */
export interface SpendWindow {
  /** ISO `YYYY-MM-DD`, inclusive. */
  from?: string;
  /** ISO `YYYY-MM-DD`, inclusive. */
  to?: string;
}

export const ALL_DATES: SpendWindow = {};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A window bound that is not an ISO date is REFUSED, never silently dropped.
 *
 * Dropping it would widen the query — the user asks for one month and is shown all time,
 * with a total that is correct for a question nobody asked. A refusal is a value; a
 * silently ignored filter is not.
 */
export function assertWindow(w: SpendWindow): void {
  for (const end of ['from', 'to'] as const) {
    const v = w[end];
    if (v === undefined || v === null || v === '') continue;
    if (!ISO_DATE.test(v)) {
      throw new Error(
        `Ad spend date window: \`${end}\` must be an ISO date (YYYY-MM-DD), received ${JSON.stringify(v)}. ` +
          'Refusing to run the query unfiltered rather than silently widening the range.',
      );
    }
  }
  if (w.from && w.to && w.from > w.to) {
    throw new Error(
      `Ad spend date window: \`from\` (${w.from}) is after \`to\` (${w.to}). ` +
        'That window selects nothing; refusing rather than reporting an empty dashboard as a real zero.',
    );
  }
}

/** `2026-08-08` -> `August`. The sheet carried a Month column; nothing reads it, but the row shape keeps it. */
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export function monthNameOf(iso: string): string {
  const m = /^(\d{4})-(\d{2})-/.exec(iso || '');
  if (!m) return '';
  const i = Number(m[2]) - 1;
  return MONTHS[i] ?? '';
}

/** Shape of one row as the view returns it. */
export interface MetaSpendRecord {
  date: string;
  ad_id: string;
  account_id: string;
  account_name: string;
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  ad_name: string;
  spend: number | string | null;
  leads: number | string | null;
}

/**
 * `numeric` arrives from PostgREST as a STRING, because JS numbers cannot hold every
 * numeric value. `Number('')` is 0 and `Number(null)` is 0, which would turn "no answer"
 * into a confident zero — so a value that is not a finite number resolves to 0 only when
 * it was genuinely absent, and NaN is never allowed to propagate into a total.
 */
export function toNumber(v: number | string | null | undefined): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * ⭐ THE MAPPER. Every field the contract names is read here, and nothing else is.
 * `metaRowToAdSpendRow` is exported so the both-directions contract test can read it
 * rather than regex the source file, which is how the sheet-era version of that test
 * ended up silently scanning to end-of-file after the function it anchored on was deleted.
 */
export function metaRowToAdSpendRow(r: MetaSpendRecord): AdSpendRow {
  const date = String(r.date ?? '');
  return {
    month: monthNameOf(date),
    // ISO already. The sheet's `date` was whatever Google rendered, and six page-level
    // parsers still read this field; every one of them handles ISO, which is why the raw
    // and normalised fields can now be the same string instead of drifting apart.
    date,
    dateISO: date,
    campaign: String(r.campaign_name ?? ''),
    campaignId: String(r.campaign_id ?? ''),
    adsetName: String(r.adset_name ?? ''),
    adsetId: String(r.adset_id ?? ''),
    adName: String(r.ad_name ?? ''),
    adId: String(r.ad_id ?? ''),
    spent: toNumber(r.spend),
    leads: toNumber(r.leads),
    /**
     * Meta's CURRENT display name. A LABEL from here on — kept because
     * `accountRegistry.byMetaName` and the legacy alias store both still resolve program
     * and media buyer through it, and because a summary has to be called something.
     * ⛔ It is no longer the identity. See `accountId`.
     */
    accountName: String(r.account_name ?? ''),
    /**
     * ⭐ THE IDENTITY. Meta does not let anyone edit this, so a rename cannot split one
     * client into two accounts the way it did on the sheet.
     */
    accountId: String(r.account_id ?? ''),
  };
}

/**
 * How many rows the database says are in this window, or null when it would not say.
 *
 * `null` is NOT zero. A count query that failed means we could not look, and reporting
 * that as "zero rows expected" would make any fetched set look complete — the fail-open
 * this whole module is built against.
 */
export async function countMetaSpendRows(window: SpendWindow = ALL_DATES): Promise<number | null> {
  return countRowsIn(AD_SPEND_VIEW, window);
}

/**
 * ⭐ THE SAME QUESTION ASKED OF THE TABLE UNDERNEATH THE VIEW — and it closes the one hole
 * the mutation pass could not close from inside `checkMetaCompleteness`.
 *
 * 🔴 THE SHAPE. Completeness counts the view AND fetches the view, so any fault that removes
 * rows from the VIEW removes them from BOTH SIDES of the reconciliation. Change
 * `ad_insights_resolved` from `LEFT JOIN ad_accounts` to `INNER JOIN`, or add a `WHERE`, and
 * every unmapped account's spend silently leaves the product while the guard balances to the
 * row and reports `complete`. Measured today: 48,635 = 48,635 with 0 orphans — but that is a
 * MEASUREMENT, not a MECHANISM, and it is one migration away from being false. @raccoon named
 * it as the strongest surviving hole in the cutover and it was the one guard nothing asserted.
 *
 * ⚠️ THE VIEW IS 1:1 WITH THE BASE BY CONSTRUCTION, which is what makes the count comparable
 * at all: it is a `LEFT JOIN` from `ad_insights` onto `ad_accounts` keyed on `account_id`,
 * and `account_id` is that table's PRIMARY KEY, so the join can neither drop a row nor
 * multiply one. Both directions of inequality are therefore faults, and both are named:
 *   view  <  base   rows are being FILTERED OUT — totals understated (the INNER JOIN case)
 *   view  >  base   rows are being MULTIPLIED  — totals overstated (a duplicate join key)
 *
 * ⛔ IT IS A SECOND INSTRUMENT, NOT A SECOND CONTROL. No control on the view's own count can
 * see this, because that instrument returns a TRUE answer to a question that cannot express
 * the defect. That is why it reads a different relation rather than re-asking the same one.
 */
export async function countBaseSpendRows(window: SpendWindow = ALL_DATES): Promise<number | null> {
  return countRowsIn(AD_SPEND_BASE, window);
}

async function countRowsIn(relation: string, window: SpendWindow): Promise<number | null> {
  assertWindow(window);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase as any).from(relation).select('ad_id', { count: 'exact', head: true });
    if (window.from) q = q.gte('date', window.from);
    if (window.to) q = q.lte('date', window.to);
    const { count, error } = await q;
    if (error) return null;
    return typeof count === 'number' ? count : null;
  } catch {
    return null;
  }
}

/**
 * ⭐ THE FETCH. Date-filtered IN SQL, paged, and never silently short.
 *
 * ⚠️ THROWS on failure, and that is the isolation mechanism rather than a contradiction of
 * "a source must not take the app down". `refreshSources` settles each source
 * independently, so a rejection here marks AD SPEND failed — keeping last-known-good on
 * screen with a banner — while appointments keep rendering. Returning `[]` instead would
 * render a dead source as a real zero on every tile, which is the defect this codebase was
 * rebuilt to prevent.
 */
export async function fetchMetaAdSpend(
  _settings?: AppSettings,
  window: SpendWindow = ALL_DATES,
): Promise<AdSpendRow[]> {
  assertWindow(window);
  if (!isSupabaseConfigured) {
    throw new Error(
      'Ad spend cannot be loaded: this build has no Supabase connection ' +
        '(VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY). Refusing to report zeros.',
    );
  }

  const rows: AdSpendRow[] = [];
  /**
   * ⭐ THE PRIMARY KEYS ALREADY HELD, so a page that overlaps the previous one cannot
   * double-count. See `spendRowKey` for the fault this catches and why counting alone
   * cannot: a duplicate substituting for a skipped row balances the reconciliation exactly.
   *
   * ⚠️ DEDUPING IS HALF THE FIX AND THE SMALLER HALF. Dropping the copy stops the total
   * being INFLATED; what makes the skip VISIBLE is that the returned set is now genuinely
   * shorter than `count(*)`, so `checkMetaCompleteness` reports `truncated` and the banner
   * says so. Before this the two errors cancelled and the state was `complete`.
   *
   * ⛔ IT MUST NOT SILENTLY SWALLOW THE DUPLICATE AND STOP THERE. A dedupe that also
   * shortened the loop, or that returned a "clean" count, would be the fail-open wearing a
   * fix's clothes — which is why the offset below advances by the RAW page length.
   */
  const seen = new Set<string>();
  /**
   * ⭐ THE OFFSET, AND WHY IT IS RAW ROWS RECEIVED RATHER THAN `page * PAGE_SIZE`.
   *
   * `.range()` is OFFSET paging: the next request must start where the server actually
   * stopped, not where we assumed it would. Those differ the moment a page comes back short,
   * and assuming makes the loop skip every row in the gap.
   */
  let received = 0;
  /**
   * 🔴 WHAT THE SOURCE SAYS THE TOTAL IS — the fact that replaces the inference this loop
   * used to terminate on. Null until the first page answers, and null forever if the server
   * declines to count.
   */
  let sourceTotal: number | null = null;

  for (let request = 0; request < MAX_PAGES; request++) {
    // ⭐ COUNT ON THE FIRST REQUEST ONLY. PostgREST answers `Content-Range: 0-999/48611`
    // when asked, so the total arrives with the data at the cost of ONE `count(*)` — and it
    // is what turns "when do I stop?" from a guess into a read value. Asking on every page
    // would re-count 48,611 rows 49 times for an answer that cannot change usefully.
    const wantCount = request === 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase as any)
      .from(AD_SPEND_VIEW)
      .select(META_SPEND_SELECT, wantCount ? { count: 'exact' } : undefined);
    if (window.from) q = q.gte('date', window.from);
    if (window.to) q = q.lte('date', window.to);
    // ⚠️ A STABLE TOTAL ORDER IS LOAD-BEARING FOR PAGINATION. Without an ORDER BY, two
    // pages of an unordered result may overlap or skip rows, and the loss is invisible
    // because each page is individually valid. `(date, ad_id)` is the primary key, so it
    // is total and cannot tie.
    const { data, error, count } = await q
      .order('date', { ascending: true })
      .order('ad_id', { ascending: true })
      .range(received, received + PAGE_SIZE - 1);

    if (error) {
      throw new Error(
        `Could not load ad spend from Supabase (${AD_SPEND_VIEW}): ${error.message || 'unknown error'}`,
      );
    }
    if (typeof count === 'number') sourceTotal = count;

    const batch = (data ?? []) as MetaSpendRecord[];
    for (const r of batch) {
      const key = spendRowKey(r);
      // `Set.add` returns the set, not a boolean, so the membership test is explicit.
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(metaRowToAdSpendRow(r));
    }
    // RAW, never the deduped length. A full page of duplicates is still a full page of
    // offset, and advancing by how many survived the dedupe would re-request the same rows
    // forever.
    received += batch.length;

    /**
     * 🔴 THE TERMINATION RULE, AND THE FAIL-OPEN IT REPLACES.
     *
     * This loop used to stop on `batch.length < PAGE_SIZE` — "a short page is the end of the
     * data". That is an INFERENCE about the server, and when it is wrong it is wrong
     * silently: measured on this branch, one run returned 15 accounts and $15,319.22 of the
     * $770,984.34 that exists, with no error, because a first page came back short and the
     * loop believed it. A 98% loss decided by a guess.
     *
     * Two facts replace it, in order:
     *   ① THE SOURCE'S OWN COUNT. We stop because we hold everything it says exists, not
     *      because a page looked small. A short page in the middle is now just a short page.
     *   ② AN EMPTY PAGE, when the server would not count. Nothing left to give at this
     *      offset is a fact about the response; "fewer than I asked for" never was.
     *
     * ⚠️ NEITHER OF THESE MAKES THE SET PROVABLY COMPLETE, and it must not pretend to.
     * `checkMetaCompleteness` still reconciles independently — the pull writes every three
     * hours and rows can appear between the two reads. This rule removes a way of stopping
     * EARLY; it does not remove the reconciliation.
     */
    if (sourceTotal !== null && received >= sourceTotal) {
      /**
       * ⭐ THE COUNT IS RE-ASKED ONCE HERE, AND THIS IS WHERE A STALE TOTAL USED TO COST US
       * ROWS — @raccoon: "`sourceTotal` is captured on page 0 only, so a pull landing
       * mid-fetch can raise a spurious `truncated` banner".
       *
       * 🔴 THE SHAPE, AND WHY THE BANNER WAS NOT ACTUALLY SPURIOUS. `meta-pull` writes every
       * three hours and this loop takes ~49 round trips. A pull that lands between request 0
       * (which counted) and the last one leaves us stopping at a total that is no longer
       * true — we return genuinely short, and `checkMetaCompleteness` then re-counts, finds
       * MORE, and correctly says INCOMPLETE. The banner was right. The FETCH was wrong, and
       * fixing the message would have been fixing the smoke.
       *
       * ⚠️ THE INFORMATION ALREADY EXISTED AND WAS ONLY USED TO COMPLAIN. Completeness runs
       * this exact query moments later. Asking it one page earlier turns a warning into more
       * data — the user gets the rows instead of a sentence about not having them.
       *
       * ⛔ IT DOES NOT WEAKEN THE TERMINATION LAW; it is strictly more conservative. The loop
       * can only ever continue, never stop earlier, and it still stops on a FACT — a fresh
       * count, or an empty page below — never on "the page looked small". A re-count that
       * FAILS returns what we hold, which is exactly today's behaviour, so the new query can
       * never remove rows or throw the fetch away. MAX_PAGES still bounds the whole loop.
       */
      const recount = await countMetaSpendRows(window);
      if (recount === null || received >= recount) return rows;
      sourceTotal = recount;
      continue;
    }
    if (batch.length === 0) return rows;
  }

  throw new Error(
    `Ad spend paging did not terminate after ${MAX_PAGES} requests (${received.toLocaleString()} rows received` +
      `${sourceTotal === null ? '' : ` of ${sourceTotal.toLocaleString()} counted`}). ` +
      'Refusing to return a set that may be truncated.',
  );
}

/* ------------------------------------------------------------------------- *
 * COMPLETENESS — the guard that replaces the sheet's raw-vs-derived probe.
 * ------------------------------------------------------------------------- */

export type CompletenessState =
  /** The database holds more rows for this window than we received. Totals are UNDERSTATED. */
  | 'truncated'
  /** Row count reconciles against the source, and the last pull finished cleanly. */
  | 'complete'
  /**
   * ⭐ THE SOURCE HOLDS NO AD SPEND AT ALL — not "this date range is quiet", but the whole
   * table is empty. See `checkMetaCompleteness`; this is the state that stops a build
   * pointed at the WRONG Supabase project from rendering $0.00 as a healthy answer.
   */
  | 'source-empty'
  /** We could not prove it either way. NOT a clean bill of health. */
  | 'unverifiable';

/**
 * ⚠️ SHAPE PRESERVED FROM THE SHEET-ERA REPORT ON PURPOSE. `SourceStatusBanner` and
 * `useData` already render this and are already tested against it, so replacing the
 * MECHANISM does not become a UI project. The question ("is what we are showing all of
 * it?") outlived the sheet; only the way of answering it changed.
 */
export interface CompletenessReport {
  state: CompletenessState;
  /** Rows the SOURCE says exist in this window. Null when the count query could not answer. */
  rawRows: number | null;
  /** Rows we actually received and are computing totals from. */
  derivedRows: number | null;
  /** How many rows are missing. Only meaningful when state is 'truncated'. */
  droppedRows: number;
  /** Why we could not verify, when state is 'unverifiable'. Never invented. */
  reason: string | null;
}

export const NOT_CHECKED: CompletenessReport = {
  state: 'unverifiable', rawRows: null, derivedRows: null, droppedRows: 0, reason: 'not checked yet',
};

/**
 * ⭐ RECONCILE WHAT WE FETCHED AGAINST WHAT THE SOURCE HOLDS.
 *
 * This is the direct analogue of the raw-tab-versus-derived-tab probe being retired, and
 * it is strictly stronger: both numbers come from ONE authenticated source over the SAME
 * window, so there is no silent-fallback hazard to defeat with a table signature. It
 * catches the failure the old detector structurally could not — a paging loop that stops
 * early, or a PostgREST cap — because it compares against the count, not against a
 * second copy of the same drifting artefact.
 *
 * ⛔ WHAT COUNTING ALONE CANNOT SEE, STATED HERE RATHER THAN LEFT IMPLIED. This function
 * compares two NUMBERS, so any fault that loses one row and gains another BALANCES: 48,611
 * against 48,611, state `complete`, totals wrong. The one that actually happens is an
 * overlapping page — see `spendRowKey` — and it is neutralised UPSTREAM, in the fetch, by
 * refusing to hold the same primary key twice. That is what turns the substitution back into
 * a plain shortfall, which is the shape this function CAN see. The guard is the pair; neither
 * half is sufficient, and a future edit that removes the dedupe re-opens this blindness
 * without changing a line of code in here.
 *
 * ⛔ IT CANNOT THROW. Completeness describes the numbers; it must never be able to remove
 * them. Every failure resolves to `unverifiable` with the reason named.
 */
export async function checkMetaCompleteness(
  fetchedRows: number,
  window: SpendWindow = ALL_DATES,
): Promise<CompletenessReport> {
  let expected: number | null = null;
  try {
    expected = await countMetaSpendRows(window);
  } catch {
    expected = null;
  }
  if (expected === null) {
    return {
      state: 'unverifiable', rawRows: null, derivedRows: fetchedRows, droppedRows: 0,
      reason: 'the row count could not be read back from Supabase',
    };
  }
  /**
   * ⭐ THE SECOND INSTRUMENT, RUN BEFORE ANY VERDICT IS FORMED. See `countBaseSpendRows` for
   * the fault this exists to see and why the view's own count structurally cannot see it.
   *
   * ⛔ IT RUNS FIRST, ahead of the zero branch, and that ordering is the whole point. Turn the
   * view's `LEFT JOIN` into an `INNER JOIN` against an empty `ad_accounts` and the windowed
   * view count is 0 with 0 fetched — which lands in the `source-empty` branch below and tells
   * the user to check which Supabase project they are pointed at. True-sounding, and the
   * wrong cause: the connection is fine and the view is eating the data. Asking the base
   * table first is what turns that into a named, correct answer.
   *
   * ⚠️ A BASE COUNT THAT CANNOT BE READ IS NOT A PASS. It degrades to `unverifiable`, exactly
   * as a failed view count already does one branch above — otherwise revoking SELECT on
   * `ad_insights` would silently retire this guard while every load still read `complete`,
   * which is the fail-open shape in the guard written to close a fail-open.
   */
  let base: number | null = null;
  try {
    base = await countBaseSpendRows(window);
  } catch {
    base = null;
  }
  if (base === null) {
    return {
      state: 'unverifiable', rawRows: expected, derivedRows: fetchedRows, droppedRows: 0,
      reason:
        `the \`${AD_SPEND_BASE}\` row count could not be read back, so \`${AD_SPEND_VIEW}\` ` +
        'could not be proved to still expose every row it holds',
    };
  }
  if (expected < base) {
    return {
      state: 'truncated', rawRows: base, derivedRows: fetchedRows,
      droppedRows: base - fetchedRows,
      reason:
        `the \`${AD_SPEND_VIEW}\` view exposes ${expected.toLocaleString()} of the ` +
        `${base.toLocaleString()} rows \`${AD_SPEND_BASE}\` holds for this window — the view ` +
        'is filtering rows out, so this is a database definition problem, not a paging one',
    };
  }
  if (expected > base) {
    return {
      state: 'unverifiable', rawRows: base, derivedRows: fetchedRows, droppedRows: 0,
      reason:
        `\`${AD_SPEND_VIEW}\` returns ${expected.toLocaleString()} rows for the ` +
        `${base.toLocaleString()} in \`${AD_SPEND_BASE}\` — its join is multiplying rows, ` +
        'which OVERSTATES every spend and lead total below',
    };
  }
  /**
   * 🔴 ZERO EXPECTED AND ZERO FETCHED IS NOT "COMPLETE". IT WAS, AND THAT WAS A FAIL-OPEN.
   *
   * Measured 2026-08-12. The git-tracked `.env` in this repo pointed `VITE_SUPABASE_URL` at
   * project `tclghhfozyfsdkqyaftc` while every ad row lives in `mlwoztsytapxjgfldyzv`. That
   * project answers the ad-spend read with HTTP 200, body `[]`, and an exact count of 0 — a
   * perfectly successful conversation with the wrong database. Every guard then agreed:
   *
   *     fetchMetaAdSpend  -> []            (a short page is the end of the data)
   *     refreshSources    -> 'valid'       ([] is truthy, so the fetch "succeeded")
   *     checkMetaCompleteness -> 'complete' (0 fetched === 0 expected)
   *     completenessMessage   -> null       (nothing worth saying)
   *
   * ⇒ $0.00 on every tile, a green source badge, and SILENCE. A 100% loss rendered as
   * health, which is a worse version of the 27% loss this module was written to end.
   *
   * ⚠️ AND "ZERO ROWS IN THIS WINDOW" IS A LEGITIMATE ANSWER, so this must not cry wolf on a
   * quiet date range — @andrew: «annoying just remove these popups». The two cases are
   * distinguished by ASKING A SECOND QUESTION, not by guessing: does the source hold ANY ad
   * spend at all, over ALL dates? An empty WINDOW is a fact about the dates the user picked.
   * An empty TABLE is a fact about the connection, and this app exists to show ad spend, so
   * it is never a clean bill of health.
   *
   * The extra count runs ONLY when the window came back empty, which is the rare case.
   */
  if (expected === 0 && fetchedRows === 0) {
    let total: number | null = null;
    try {
      total = await countMetaSpendRows(ALL_DATES);
    } catch {
      total = null;
    }
    if (total === null) {
      return {
        state: 'unverifiable', rawRows: 0, derivedRows: 0, droppedRows: 0,
        reason: 'this date range holds no ad spend, and the source could not be asked whether it holds any at all',
      };
    }
    if (total === 0) {
      return {
        state: 'source-empty', rawRows: 0, derivedRows: 0, droppedRows: 0,
        reason: 'the ad spend table is empty for every date, not just this range',
      };
    }
    // The table has data; this window genuinely does not. An honest, silent zero.
    return { state: 'complete', rawRows: 0, derivedRows: 0, droppedRows: 0, reason: null };
  }
  if (fetchedRows < expected) {
    return {
      state: 'truncated', rawRows: expected, derivedRows: fetchedRows,
      droppedRows: expected - fetchedRows, reason: null,
    };
  }
  /**
   * MORE rows than the source claims is not "complete", it is a contradiction — most
   * likely the pull wrote new rows between the two queries, but it could equally be
   * double-counting, and a guard that reports its own contradiction as a pass is the
   * fail-open shape. So it is named rather than rounded down to success.
   */
  if (fetchedRows > expected) {
    return {
      state: 'unverifiable', rawRows: expected, derivedRows: fetchedRows, droppedRows: 0,
      reason: `we hold ${fetchedRows.toLocaleString()} rows but the source counts ${expected.toLocaleString()}`,
    };
  }
  return { state: 'complete', rawRows: expected, derivedRows: fetchedRows, droppedRows: 0, reason: null };
}

/**
 * The sentence the banner shows, or null when there is nothing worth saying.
 *
 * ⭐ 'not checked yet' STAYS SILENT — @andrew: «annoying just remove these popups». A probe
 * that has not run is a fact about our CONFIGURATION, not about his DATA, and it fired on
 * every load. A probe that RAN and could not discriminate is a real finding and still
 * speaks. "We could not tell" versus "we never asked".
 */
export function completenessMessage(r: CompletenessReport): string | null {
  if (r.state === 'complete') return null;
  /**
   * ⭐ NAMES THE CAUSE, because this state has exactly one class of cause and the user
   * cannot guess it from a total of $0.00. It is not a Meta problem and not a date problem:
   * the app is talking to a database that holds no ad spend.
   */
  if (r.state === 'source-empty') {
    return (
      'Ad spend is showing ZERO because the connected database holds no ad spend rows at all. ' +
      'This is a connection problem, not a Meta problem and not an empty date range. ' +
      'Check that this build points at the right Supabase project.'
    );
  }
  if (r.state === 'truncated') {
    // ⚠️ THE CAUSE CLAUSE IS NOT A CONSTANT ANY MORE. `truncated` now has TWO causes — the
    // fetch came up short, or the VIEW is exposing fewer rows than the table under it — and
    // they are fixed in different places. A message that always said "a paging or query
    // limit" would send the reader to the wrong file for half of them.
    const cause = r.reason
      ? r.reason.charAt(0).toUpperCase() + r.reason.slice(1)
      : 'This is a paging or query limit, not a Meta problem — the data is in the database';
    return (
      `Ad spend is INCOMPLETE: ${r.droppedRows.toLocaleString()} of ${r.rawRows?.toLocaleString()} ` +
      `rows in this date range were not loaded. Every total below is missing that data. ` +
      `${cause}.`
    );
  }
  if (r.reason === 'not checked yet') return null;
  return `Ad spend completeness could not be verified — ${r.reason}. Totals may be incomplete.`;
}
