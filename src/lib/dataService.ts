import { supabase } from '@/integrations/supabase/client';
import type { AppSettings, AdSpendRow, AppointmentRow, AccountSummary, CampaignSummary, AdSetSummary, AdSummary, TeamMember, PerformanceLevel } from './types';
import { isSourceConfigured } from './config';
import { resolveRecordId, resolveLinkedClientNames } from './airtableLinks';
import {
  emptyAccountRegistry, resolveMediaBuyer, resolveProgram, resolveStatus,
  type AccountRegistry,
} from './accountRegistry';

/**
 * ⛔ `parseCsv` / `parseCSVLine` DELETED 2026-08-11 with the Google Sheet feed. They were
 * the last of the CSV path: quote handling, embedded commas, header folding — an entire
 * class of parsing hazard that exists because a spreadsheet export is untyped text. Nothing
 * in the app parses CSV any more; `ad_insights_resolved` returns typed JSON over PostgREST.
 */

function parseNumber(val: string | undefined): number {
  if (!val) return 0;
  const cleaned = val.replace(/[$,\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Normalise a source date string to ISO `YYYY-MM-DD`. Returns '' when it cannot be
 * interpreted — an honest refusal, never a guess and never today's date.
 *
 * ACCEPTS, because all three are present in real exports of this feed:
 *   M/D/YYYY        the derived tab's rendered format
 *   YYYY-MM-DD      the raw Windsor tab's format
 *   a bare integer  a Google Sheets serial, emitted when a cell lost its date format.
 *                   Four such rows exist in the live feed. `new Date("45884")` reads that
 *                   as the YEAR 45884, so the naive parse produces a valid far-future date
 *                   and nothing downstream errors — it is a successful parse of the wrong
 *                   thing, which is why this is decoded explicitly against the Sheets epoch.
 *
 * REFUSES: anything else, including the empty string.
 */
export function normalizeSourceDate(raw: string | undefined | null): string {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (!s) return '';

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return isRealDate(+iso[1], +iso[2], +iso[3]) ? s : '';

  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const [, m, d, y] = mdy;
    return isRealDate(+y, +m, +d) ? `${y}-${pad2(+m)}-${pad2(+d)}` : '';
  }

  // Google Sheets serial: whole days since 1899-12-30. Bounded to a plausible era so a
  // stray identifier cannot be silently reinterpreted as a date.
  if (/^\d{1,6}$/.test(s)) {
    const serial = Number(s);
    if (serial >= 36526 && serial <= 73050) {          // 2000-01-01 .. 2099-12-31
      const ms = Date.UTC(1899, 11, 30) + serial * 86400000;
      const dt = new Date(ms);
      return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
    }
    return '';
  }

  return '';
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// resolveAccountName removed — matching now uses settings.accountAliases directly

export interface ColumnSpec {
  /** Any one of these headers satisfies the column. Mirrors the mapper's `||` chain. */
  accept: string[];
  /** Absence produces a wrong NUMBER rather than a missing label. */
  critical: boolean;
}

/**
 * ② EXTENDED TO AIRTABLE — @andrew asked what happens if he renames a column header, and
 * until now the answer was NOTHING STOPS IT.
 *
 * `columnMappings[key]` points at a field that no longer exists, `getField` returns '',
 * and the metric SILENTLY BECOMES ZERO:
 *   rename `Closed Revenue ($)` ⇒ revenue reads $0
 *   rename `Appointment Date`   ⇒ the calendar empties
 *   rename `Client Name`        ⇒ every appointment becomes unmatched
 *   rename `Lead Status`        ⇒ ⭐ THE CLOSED COUNT SURVIVES — and that is the finding.
 *
 * ⭐ `isClosedWon` reads STATUS **or** REVENUE, so losing either is masked by the other.
 * THAT REDUNDANCY IS A COINCIDENCE, NOT A DESIGN: it means a single-source failure is
 * invisible to its own consumer, and the healthier the fallback looks the longer the
 * breakage survives. A contract is the only thing that can see it, because the CONSUMER
 * structurally cannot.
 *
 * ⚠️ THE PREDICATE IS THE MAPPED NAME, NOT THE RAW ONE. `columnMappings` IS the read path —
 * checking `'Closed Revenue'` would pass while the app reads `'Closed Revenue ($)'`, which
 * is the field that actually has to exist.
 *
 * ⚠️ AND THE POPULATION IS THE UNION ACROSS ALL RECORDS, reusing the exact set D2 needed:
 * Airtable OMITS EMPTY FIELDS PER RECORD and `Closed Revenue ($)` is on 46 of 679, so a
 * single-record presence check would report ~90% of the schema missing. Built once in
 * mapAirtableRecords, shared here.
 */
export const AIRTABLE_COLUMNS: ColumnSpec[] = [
  { accept: ['Client Name'], critical: true },        // absent ⇒ every appt unmatched
  { accept: ['Appointment Date'], critical: true },   // absent ⇒ the calendar empties
  { accept: ['Closed Revenue'], critical: true },     // absent ⇒ revenue reads $0
  { accept: ['Lead Status'], critical: true },        // absent ⇒ MASKED by closedRevenue
  { accept: ['Campaign Name'], critical: false },
  { accept: ['Ad Set Name'], critical: false },
  { accept: ['Ad Name'], critical: false },
  { accept: ['Setter'], critical: false },
  { accept: ['Show Status'], critical: false },
];

export interface AirtableSchemaReport {
  missingCritical: string[];
  missingLabels: string[];
  /** No records ⇒ nothing observed. NOT a clean bill of health. */
  unverified: boolean;
}

/**
 * Check the contract against the OBSERVED field union, resolving each column through
 * `columnMappings` first.
 *
 * ⛔ RETURNS, NEVER THROWS. Airtable is ONE OF THREE SOURCES and per-source isolation is
 * the point: the caller turns a critical miss into a FAILED SOURCE with the header named,
 * and Windsor keeps rendering. A throw in here would also reach the Settings dropdown,
 * which needs the field union even when the schema is broken — that is exactly when a user
 * is trying to re-map it.
 */
export function checkAirtableSchema(
  observedFields: string[],
  columnMappings: Record<string, string>,
  columns: ColumnSpec[] = AIRTABLE_COLUMNS,
): AirtableSchemaReport {
  if (!Array.isArray(observedFields) || observedFields.length === 0) {
    return { missingCritical: [], missingLabels: [], unverified: true };
  }
  const present = new Set(observedFields.map(f => f.trim().toLowerCase()));
  const resolves = (c: ColumnSpec) =>
    c.accept.some(name => {
      const mapped = columnMappings?.[name] || name;
      return present.has(mapped.trim().toLowerCase());
    });

  return {
    missingCritical: columns.filter(c => c.critical && !resolves(c)).map(c => columnMappings?.[c.accept[0]] || c.accept[0]),
    missingLabels: columns.filter(c => !c.critical && !resolves(c)).map(c => columnMappings?.[c.accept[0]] || c.accept[0]),
    unverified: false,
  };
}

/**
 * ⛔ THE SHEET'S COLUMN CONTRACT (`WINDSOR_COLUMNS`, `checkColumnContract`, `assertSheetSchema`)
 * WAS DELETED WITH THE SHEET, 2026-08-11 — not abandoned. Its whole subject was hazards a
 * CSV has and a typed Postgres column does not: a wrong tab answering HTTP 200 with the
 * default tab's schema, a header renamed from `Spent` to `Amount Spent`, a column that is
 * present and entirely blank so `parseNumber('')` turns every total into a confident zero.
 *
 * ⭐ THE LAW SURVIVED THE MECHANISM. "Every column the contract names is read by the mapper,
 * and every field the mapper reads is in the contract, proven in BOTH directions" now lives
 * in src/lib/metaAdSpend.ts as `META_SPEND_COLUMNS` beside `metaRowToAdSpendRow`, and is
 * tested there. What it catches today is a column dropped from the `select(...)` list and
 * every value it fed silently becoming zero.
 */


/**
 * Turn a critical schema miss into a FAILED SOURCE, named. Called on both Airtable paths.
 *
 * ⭐ THE THROW IS THE ISOLATION MECHANISM, NOT A CONTRADICTION OF "MUST NOT THROW".
 * `refreshSources` settles each source independently (SourceOutcome: ok | not-configured |
 * failed), so a rejection here marks AIRTABLE failed and Windsor and the call centre keep
 * rendering. That is exactly "report a FAILED SOURCE and let Windsor keep rendering" —
 * expressed in the mechanism this codebase already uses for every other source failure.
 * The check itself returns rather than throws, so the Settings dropdown path is untouched.
 */
function enforceAirtableSchema(
  fields: string[],
  columnMappings: Record<string, string>,
): void {
  const report = checkAirtableSchema(fields, columnMappings);
  if (report.missingLabels.length > 0) {
    console.warn(`Airtable: missing label columns ${report.missingLabels.join(', ')}`);
  }
  if (report.missingCritical.length === 0) return;

  throw new Error(
    `Airtable is missing the column${report.missingCritical.length > 1 ? 's' : ''} ` +
      `${report.missingCritical.map(c => `"${c}"`).join(', ')}. ` +
      `A renamed or deleted header does not fail on its own — the field simply reads empty, ` +
      `so the numbers it feeds would silently become zero. Re-map it in Settings → column ` +
      `mappings, or rename the column back. Appointments are shown as unavailable rather ` +
      `than as zero.`,
  );
}

export async function fetchAirtableData(settings: AppSettings): Promise<{ records: AppointmentRow[], fields: string[], unresolvedLinks?: number }> {
  const { airtableBaseId, airtableTableName, columnMappings } = settings;

  if (!airtableBaseId) throw new Error('Airtable not configured');

  // ROUTED THROUGH @apprentice's EDGE FUNCTION. The browser holds no credential and never
  // sees one — the proxy reads AIRTABLE_TOKEN from its own environment. That is precisely
  // why this patch is credential-free: there is nothing here to leak.
  //
  // ⚠️ THE FAILURE CONTRACT IS THE POINT, AND IT IS ENFORCED AT BOTH ENDS. The proxy never
  // returns 200 on failure (proxy.contract.test.ts), and this function must not undo that
  // by turning an error into an empty list. `records: []` under status 'ok' means Airtable
  // genuinely returned nothing; ANY other outcome throws, so a dead source can never render
  // as "zero appointments". Safe to throw because fetchAllSources() isolates each source.
  //
  // The proxy paginates server-side and returns the complete set, so the client offset loop
  // is gone rather than left unreachable below a throw.
  //
  // ⚠️ LOAD-BEARING CONTRACT, NOT A CHECK — @bird's arm G. Because the loop is gone, this
  // client SILENTLY IGNORES an `offset` in the response. If the proxy ever starts
  // returning PARTIAL pages, a partial set renders as a complete one: no error, no dash,
  // no way to tell. It is safe today because the proxy returns everything, and that is a
  // CONTRACT rather than something this code verifies. Anyone changing the proxy's
  // pagination must change this function in the same commit.
  const { data: payload, error: invokeError } = await supabase.functions.invoke(
    'airtable-proxy',
    { body: { baseId: airtableBaseId, tableName: airtableTableName } },
  );

  // ⛔ OWNER-ORDERED DIRECT FALLBACK, 2026-08-05. The proxy is the intended path and stays
  // FIRST — this runs only when the proxy cannot answer AND a token is configured, which is
  // exactly the state we shipped Andrew into: relocation done, deployment not.
  //
  // ⚠️ IT IS A FALLBACK, NOT A REPLACEMENT. The moment airtable-proxy is deployed, the block
  // above succeeds and this code never executes — no flag to flip, no second rollback. Delete
  // `airtableToken` from ALLOWED_CONFIG_KEYS to retire it entirely.
  //
  // ⚠️ AND IT DOES NOT SOFTEN THE FAILURE CONTRACT. If the direct call fails it THROWS, same
  // as the proxy path. A dead Airtable must never render as "zero appointments" — that is the
  // whole point of this project and it survives the rollback intact.
  /**
   * ③ ONE RESOLUTION PER REFRESH, NOT PER ROW — fetched before either path maps, so the
   * proxy route and the direct fallback resolve identically. Two lookups would let the
   * routes disagree about a client's NAME, and the fallback only runs when the proxy is
   * broken, i.e. exactly when nobody is watching.
   *
   * ⛔ NEVER THROWS. resolveLinkedClientNames returns an empty map on any failure — a bad
   * PAT scope, a 404, a non-link field, a missing row — and an empty map is precisely
   * today's behaviour. The resolver cannot take the dashboard down to improve a label.
   */
  const linkField = columnMappings['Client Name'] || 'Client Name';
  const { names: linkNames } = await resolveLinkedClientNames(
    airtableBaseId, airtableTableName, linkField, settings.airtableToken,
  );

  if (invokeError && settings.airtableToken) {
    const records: { fields: Record<string, unknown> }[] = [];
    let offset: string | undefined;
    // Airtable pages at 100; the proxy did this server-side, so the loop returns here with it.
    do {
      const url = new URL(
        `https://api.airtable.com/v0/${encodeURIComponent(airtableBaseId)}/${encodeURIComponent(airtableTableName)}`,
      );
      url.searchParams.set('pageSize', '100');
      if (offset) url.searchParams.set('offset', offset);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${settings.airtableToken}` },
      });
      if (!res.ok) {
        throw new Error(
          `Airtable direct fetch failed: ${res.status} ${res.statusText}. ` +
            'The airtable-proxy Edge Function is also unavailable.',
        );
      }
      const body = await res.json();
      if (!Array.isArray(body?.records)) {
        throw new Error('Airtable direct fetch returned an unusable response');
      }
      records.push(...body.records);
      offset = body.offset;
    } while (offset);

    const direct = mapAirtableRecords(records, columnMappings, [], linkNames);
    // The union built inside the mapper — one construction, shared by the contract and by
    // the Settings dropdown (D2). Building it twice is how the two would drift.
    enforceAirtableSchema(direct.observedFields, columnMappings);
    return direct;
  }

  if (invokeError) {
    // A non-2xx carries the proxy's own {status, message}; surface THAT, not the generic
    // "Edge Function returned a non-2xx status code", which names nothing a user can act on.
    let detail = invokeError.message;
    const ctx = (invokeError as { context?: Response }).context;

    // 404 MEANS THE FUNCTION IS NOT DEPLOYED, AND THAT IS A DIFFERENT PROBLEM ENTIRELY.
    // @apprentice measured that these 207 lines of Deno have NEVER executed — not run,
    // not typechecked, not called, in any environment. Step 1 of DEPLOY.md is their first
    // execution ever, so a failure there is EXPECTED at least once and must be legible.
    // "Edge Function returned a non-2xx status code" would send someone to debug a token
    // for a function that was never pasted.
    if (ctx?.status === 404) {
      throw new Error(
        'Airtable proxy: the airtable-proxy Edge Function is not deployed. ' +
          'Paste it and set AIRTABLE_TOKEN — see supabase/functions/DEPLOY.md. ' +
          'This is not a token problem.',
      );
    }

    if (ctx && typeof ctx.json === 'function') {
      try {
        const body = await ctx.json();
        if (body?.message) detail = String(body.message);
      } catch {
        // keep the generic message rather than inventing one
      }
    }
    throw new Error(`Airtable proxy: ${detail}`);
  }

  if (!payload || payload.status !== 'ok' || !Array.isArray(payload.records)) {
    throw new Error(
      `Airtable proxy returned an unusable response${payload?.message ? `: ${payload.message}` : ''}`,
    );
  }

  const mapped = mapAirtableRecords(
    (payload as { records: { fields: Record<string, unknown> }[] }).records,
    columnMappings,
    Array.isArray(payload.fields) ? payload.fields : [],
    linkNames,
  );
  enforceAirtableSchema(mapped.observedFields, columnMappings);
  return mapped;
}

/**
 * Shared record mapper for BOTH Airtable paths — the proxy and the direct fallback.
 *
 * ⭐ IT IS SHARED ON PURPOSE. Two copies of this mapping would let the two paths disagree
 * about what an appointment IS, and the fallback only runs when the proxy is broken — i.e.
 * exactly when nobody is watching. One mapper means the numbers cannot depend on which
 * route fetched them.
 */
export function mapAirtableRecords(
  records: { fields: Record<string, unknown> }[],
  columnMappings: Record<string, string>,
  knownFields: string[] = [],
  /**
   * recordId → linked row's name, fetched ONCE per refresh by resolveLinkedClientNames.
   * Absent or empty ⇒ EXACTLY today's behaviour: the id is refused, the field reads
   * UNRESOLVED_CLIENT, the appointment is counted as unmatched. Resolution is layered ON
   * TOP of a refusal that already works; it never replaces it.
   */
  linkNames: Map<string, string> = new Map(),
): {
  records: AppointmentRow[];
  /** For the Settings dropdown. An explicit proxy-supplied list WINS — it is the real schema. */
  fields: string[];
  /**
   * 🔴 THE UNION ACTUALLY SEEN IN THE RECORDS — a DIFFERENT question from `fields`, and
   * conflating them is a defect I shipped for one commit. The proxy DECLARES a field list
   * that can be narrower than the data; enforcing the column contract against a declaration
   * checks what the proxy SAID, not what arrived. The contract must read what arrived.
   */
  observedFields: string[];
  unresolvedLinks: number;
} {
  const allRecords: AppointmentRow[] = [];
  let fields: string[] = knownFields;
  let observed: string[] = [];
  // Counted, not swallowed: a silently blanked client is the same defect one layer down.
  let unresolvedLinks = 0;

  {
    const data = { records };

    /**
     * 🔴 D2 — THE UNION, NOT THE FIRST RECORD. @fable queried the live base directly.
     *
     * AIRTABLE OMITS EMPTY FIELDS PER RECORD. `Closed Revenue ($)` is populated on 46 of
     * 679 rows, so it is absent from record[0] and was therefore absent from this list —
     * which is the list the Settings column-mapping dropdown is built from.
     *
     * ⇒ THE CONSEQUENCE WAS NOT COSMETIC. The saved mapping
     *   'Closed Revenue' → 'Closed Revenue ($)' is CORRECT AND WORKING, and the select
     *   showed "— Select —" because the option did not exist. @andrew was about to pick
     *   something («this is where i should map it»); any choice would have overwritten a
     *   working mapping with a blank and taken his revenue to $0.
     *
     * ⭐ SAMPLING ONE ROW TO LEARN A SCHEMA IS THE DEFECT. A sparse column is exactly the
     * one a user needs to map, and exactly the one a single-row sample cannot see — the
     * rarer the field, the more likely it is missing from the sample AND the more likely
     * it matters. The union is O(records) once per refresh and cannot be wrong this way.
     */
    // Built ONCE, unconditionally — two consumers, two questions, one computation:
    //   `fields`         the dropdown's option list (explicit proxy list wins)
    //   `observedFields` what the records actually carried (the contract's population)
    const seen = new Set<string>();
    for (const rec of data.records) {
      for (const k of Object.keys(rec?.fields ?? {})) seen.add(k);
    }
    observed = Array.from(seen);
    if (data.records.length > 0 && fields.length === 0) fields = observed;

    for (const rec of data.records) {
      // Degrade, never throw — the same contract the rest of this path follows. A record
      // with no `fields` yields empty values and an unmatched appointment; it must not take
      // the dashboard down. Caught by the union test, which constructed exactly that row.
      const f = rec?.fields ?? {};
      const getField = (key: string) => {
        const mapped = columnMappings[key] || key;
        const val = f[mapped];
        const first = Array.isArray(val) ? (val[0] || '') : (val || '');
        /**
         * 🔴 REFUSE A RECORD ID. Returning '' leaves the field UNRESOLVED, which the
         * matcher treats as "no client" — so the appointment lands in unmatchedAppointments
         * instead of being attributed to whatever account a fuzzy match happens to find.
         * An unresolved appointment is honest; one attributed on the strength of a record
         * id is a wrong number wearing a name.
         */
        /**
         * ⭐ RESOLVE BEFORE REFUSING. @andrew called the old banner «bs» and he was right:
         * it told him to add a Lookup field in Airtable to work around our limitation. If
         * we hold the linked row's name, this is a NAME, not an id, and nothing needs
         * saying at all.
         */
        const resolved = resolveRecordId(first, linkNames);
        if (resolved) return resolved;

        if (isAirtableRecordId(first)) {
          /**
           * ⛔ THE REFUSAL APPLIES TO EVERY FIELD — @fable: Client PPA Rate, Active? and
           * Client Billing Model are multipleLookupValues, and lookups return ARRAYS, so
           * the same val[0] shape reaches them. An id must never render as a value in ANY
           * column.
           *
           * 🔴 BUT IT IS NO LONGER COUNTED HERE. This counter drives a banner that says
           * "N appointments are not matched to an ACCOUNT" — a claim about ATTRIBUTION —
           * and incrementing it for a refusal in `Client Billing Model` made that sentence
           * FALSE. Measured: client resolved to "Acme Corp", billing model held an id, and
           * the banner reported 1 unmatched appointment for a row that WAS matched.
           * ⇒ A true count on the WRONG POPULATION, rendered as a specific claim.
           */
          /**
           * 🔴 A READABLE SENTINEL, NOT ''. Returning an empty string was my over-correction
           * and it EMPTIED THE APPOINTMENTS PAGE: a blank client is falsy, so every consumer
           * that guards on `a.client` dropped the row — the tiles, the list AND the calendar.
           *
           * ⭐ AN UNRESOLVED CLIENT IS A FACT ABOUT THE ATTRIBUTION, NOT ABOUT THE
           * APPOINTMENT. I refused to answer "which account" and then stopped answering
           * "does this appointment exist" — the refusal-as-a-value law running BACKWARDS.
           * The appointment is real, it is counted, and only its ACCOUNT is unknown.
           */
          return UNRESOLVED_CLIENT;
        }
        return first;
      };
      
      const clientName = String(getField('Client Name'));
      // The counter the banner reports: appointments whose CLIENT could not be resolved.
      // Not "fields that refused an id" — those are two different populations.
      if (clientName === UNRESOLVED_CLIENT) unresolvedLinks++;

      allRecords.push({
        campaignName: String(getField('Campaign Name')),
        campaignId: String(getField('Campaign ID')),
        adSetName: String(getField('Ad Set Name')),
        adSetId: String(getField('Ad Set ID')),
        adName: String(getField('Ad Name')),
        adId: String(getField('Ad ID')),
        client: clientName,
        // Computed ONCE above: calling getField twice incremented unresolvedLinks twice and
        // the count read 5 where 3 was true. A counter inside a getter is order-sensitive.
        clientUnresolved: clientName === UNRESOLVED_CLIENT,
        appointmentDate: String(getField('Appointment Date')),
        dateAdded: String(getField('Date Added')),
        showStatus: String(getField('Show Status')),
        leadValid: String(getField('Lead Valid')),
        leadQuality: String(getField('Lead Quality')),
        dqReason: String(getField('DQ Reason')),
        projectValue: parseNumber(String(getField('Project Value'))),
        closedRevenue: parseNumber(String(getField('Closed Revenue'))),
        leadStatus: String(getField('Lead Status')),
        amountCharged: parseNumber(String(getField('Amount Charged'))),
        billed: String(getField('Billed')),
        clientPPARate: parseNumber(String(getField('Client PPA Rate'))),
        setter: String(getField('Setter')),
        clientBillingModel: String(getField('Client Billing Model')),
      });
    }
  }

  return { records: allRecords, fields, observedFields: observed, unresolvedLinks };
}

/**
 * ACCOUNT IDENTITY — the account column is UNTYPED and this names what is in it.
 *
 * The feed carries no account_id field. `Account Name` holds three different things:
 *   a human name          "Backyard Paradiso"
 *   a META ACCOUNT ID     "10170221, USD"   — Meta's display for an account nobody named.
 *                         4 of 61 labels, all historical: every one stopped on or before
 *                         2025-12-31, because each was NAMED and the id form then vanished.
 *   a whitespace twin     "Co-Lights " vs "Co-Lights" — 2 pairs in the live feed
 *
 * ⚠️ An id-form label is a PREDICTION, not just an observation: it marks an account nobody
 * has named in Meta, and the day somebody names it the history SPLITS — old rows keep the
 * id, new rows get the name. That is not hypothetical; it has already happened three times.
 */
export type AccountLabelKind = 'name' | 'meta-account-id';

export interface AccountLabel {
  raw: string;
  key: string;
  kind: AccountLabelKind;
  metaAccountId?: string;
}

/**
 * Grouping key. trim + lowercase — the same thing the aggregator does inline, so wiring a
 * call site to this changes no behaviour.
 *
 * ⛔ IT DOES **NOT** COLLAPSE INTERNAL WHITESPACE, AND THIS DOCBLOCK USED TO CLAIM IT DID.
 * @raccoon measured the lie and I reproduced it before removing it:
 *
 *     "Acme  Corp" -> "acme  corp"     "Acme Corp" -> "acme corp"     SPLIT, not collapsed
 *     "Acme\tCorp" -> "acme\tcorp"                                    SPLIT
 *
 * `trim()` removes OUTER whitespace only. ⭐ An aspirational docblock is worse than no
 * docblock: a reader who finds this function and trusts the old claim ships the twin bug
 * BELIEVING IT IS HANDLED. The claim is now deleted and the real behaviour is locked in
 * dataService.accountKey.test.ts, so it cannot drift back into a comment nobody runs.
 *
 * ⚠️ THE TWIN BUG IS STILL REACHABLE — this fix is the CLAIM, not the BEHAVIOUR. Making
 * this collapse twins is one `.replace`, but account identity is decided at 22 hand-written
 * `trim().toLowerCase()` sites (@raccoon's census; only 4 route through any shared
 * function), so changing it here alone would make this function DISAGREE with the 22 and
 * could merge or split live accounts on the dashboard. That is @fable's call, not a
 * side effect of a comment fix.
 *
 * ⚠️ AND THERE IS A SECOND FUNCTION OF THIS NAME: accounts.ts:34 DOES collapse internal
 * whitespace and has no real importers. Same name, different rule — do not assume which
 * one an unqualified `accountKey` refers to.
 */
/**
 * A — AN AIRTABLE RECORD ID MUST NEVER RENDER AS A NAME.
 *
 * @fable, from @andrew: the appointments ACCOUNT column was showing `recXXXXXXXXXXXXXX`.
 * Cause: `Client Name` is a LINKED-RECORD field, so Airtable returns an ARRAY OF RECORD
 * IDS, and `getField` did `val[0]` — handing the id straight through as the client name.
 *
 * ⭐ AN ID DISPLAYED AS A NAME IS A LABEL THAT IS NOT AN IDENTITY — the exact class this
 * whole branch has been killing. And it is worse than a blank, because the 4-tier matcher
 * then treats it as a real client name: Tier 3 caches it, Tier 4 fuzzy-matches it, and the
 * appointment gets ATTRIBUTED TO AN ACCOUNT ON THE STRENGTH OF A RECORD ID.
 *
 * ⚠️ THIS IS THE INVARIANT HALF ONLY, AND IT IS DELIBERATELY INDEPENDENT OF THE FIX.
 * @bird is pulling the raw payload to decide whether a text field already carries the name
 * (a columnMappings change, no code) or whether the link must be resolved against the
 * linked table. Either way an unresolved id must render as "—" and say so, so that half is
 * built now and does not wait on the answer.
 *
 * Shape: 'rec' + 14 chars, which is Airtable's documented record id format. Anchored, so a
 * legitimate client genuinely called "Recovery" cannot be mistaken for one.
 */
/** Displayed in place of an unresolved client. Truthy, human-readable, never an id. */
export const UNRESOLVED_CLIENT = '—';

export function isAirtableRecordId(value: unknown): boolean {
  return typeof value === 'string' && /^rec[A-Za-z0-9]{14}$/.test(value);
}

/**
 * 🔴 D1 — «CLOSED DEALS» COUNTED LOSSES AS WINS. Measured on @andrew's live Airtable by
 * @fable: 679 records, `Closed Lost` **107** · `Closed Won` **46**. The old predicate was
 * `leadStatus.toLowerCase().includes('closed') || closedRevenue > 0`, and
 * `'Closed Lost'.includes('closed')` is TRUE — so the app reported **153** closed deals of
 * which **107 were deals he LOST**. Backyard Paradiso's 96 was about one third real.
 *
 * ⭐ THE SHAPE: A SUBSTRING TEST STANDING IN FOR A CATEGORY TEST. It cannot distinguish an
 * outcome from its OPPOSITE, because both outcomes share a word. The two states are not
 * merely different, they are contradictory — and the test scores them identically.
 *
 * ⚠️ WHY THIS IS NOT `=== 'closed won'`. That is the naive repair and it is brittle in two
 * directions: a spelling variant (`Closed-Won`, double space, trailing blank) silently drops
 * a real win, and it says nothing about values nobody has enumerated. **12 of the 679 records
 * carry a Lead Status @fable's census did not list.** What IS known about those 12, by
 * deduction rather than assumption: the app's total is exactly 153 = 107 + 46, so **none of
 * them contains the substring `closed`** — otherwise the total would exceed 153.
 *
 * 🔑 AND THE TRAP INSIDE THE INSTRUCTION TO "KEEP THE `|| closedRevenue > 0` ARM": kept
 * NAIVELY, it reintroduces the defect through the back door — a `Closed Lost` row carrying a
 * non-zero Closed Revenue would be counted as a win again, by a different route. The revenue
 * arm must therefore be **subordinate to an explicit LOST test**, which is why `isClosedLost`
 * exists and is not merely the negation of won.
 *
 * ⇒ SO THE CLASSIFICATION IS THREE-VALUED, not two. `won` · `lost` · `unknown`. An
 * unrecognised status is NOT silently a loss: it is `unknown`, and `unknown` + revenue counts
 * as a win, while `lost` + revenue does not.
 */
const normalizeStatus = (raw: unknown): string =>
  String(raw ?? '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();

/**
 * ⭐ THE FALLBACK, NOT A SECOND SOURCE OF TRUTH. @fable's wording, and the distinction is
 * load-bearing: when `closedWonStatuses` is configured it is the ONLY authority. This list
 * applies when the setting is absent — it must never be OR-ed with the setting, or a status
 * @andrew deliberately UN-ticked would keep counting.
 */
const CLOSED_WON_FALLBACK = ['closed won', 'won', 'closed and won'];

/**
 * `Closed Won` — configurable since @andrew's "yeah make it mappable".
 *
 * ⚠️ ABSENT AND EMPTY BOTH FALL BACK, and that is a deliberate refusal to honour one input.
 * An empty array is what a UI produces when every box is un-ticked, and treating it as a
 * literal answer takes every closed-deal count on the product to ZERO. A settings field whose
 * empty state silently zeroes the headline number is not a setting, it is a trapdoor.
 * ⇒ The cost is stated: there is no way to express "nothing counts as won" through this
 * control. That state has no legitimate use and its accidental form is catastrophic.
 */
export function isClosedWonStatus(leadStatus: unknown, settings?: AppSettings): boolean {
  const s = normalizeStatus(leadStatus);
  if (!s) return false;
  const configured = settings?.closedWonStatuses;
  if (configured && configured.length > 0) {
    return configured.some(c => normalizeStatus(c) === s);
  }
  return CLOSED_WON_FALLBACK.includes(s);
}

/** The choices a reader can tick. Exported so the Settings control cannot drift from this. */
export const CLOSED_WON_DEFAULT: string[] = ['Closed Won'];

/** `Closed Lost` and variants. Explicit, so a lost deal can never be counted by any route. */
export function isClosedLostStatus(leadStatus: unknown): boolean {
  const s = normalizeStatus(leadStatus);
  return s === 'closed lost' || s === 'lost' || s === 'closed and lost';
}

/**
 * THE ONE PREDICATE ALL FOUR CALL SITES USE. Previously the expression was written out four
 * times, so a repair could fix three and leave the fourth reporting a different number for
 * the same data — the defect class that put four separate line numbers in the D1 report.
 */
export function isClosedWon(
  appt: { leadStatus?: string; closedRevenue?: number },
  settings?: AppSettings,
): boolean {
  /**
   * ⚖️ LOST OUTRANKS WON, AND THE ORDER OF THESE THREE LINES IS THE RULING.
   *
   * Once the won list is configurable, `Closed Lost` can be TICKED as a win — by a mis-click,
   * or by someone reading the label as "closed" rather than "lost". Previously won was tested
   * first, so an overlapping status counted as a WIN. @fable's ruling: LOST WINS, "because
   * counting a lost deal as revenue is the worse error". The two errors are not symmetric —
   * under-counting wins understates performance, over-counting them invents revenue.
   *
   * ⇒ So this is not a guard bolted on top; it is the FIRST test, and the only reason the
   * revenue arm below cannot smuggle a lost deal back in.
   */
  if (isClosedLostStatus(appt.leadStatus)) return false;
  if (isClosedWonStatus(appt.leadStatus, settings)) return true;
  // Revenue is evidence of a win only where the status has not already said "lost" — above.
  return (appt.closedRevenue ?? 0) > 0;
}

/**
 * ⭐ MEASURE THE VALUE SET, DO NOT HARDCODE A CENSUS — @fable, and it is the clause that
 * survives his own measurement: *"I read the base at ONE INSTANT and a new status spelling
 * can appear tomorrow; my numbers tell you WHAT IS TRUE NOW, not what the code may assume."*
 *
 * 🔴 THE FAILURE THIS PREVENTS IS SILENT BY CONSTRUCTION. The spellings above are a closed
 * list. A status that is not on it is simply "not won" — which is the SAFE default and also
 * an INVISIBLE one. If `Deal Won` or `Signed` appears next month it is dropped from the
 * count and nothing anywhere says so. ⇒ **An unrecognised value must be OBSERVABLE, not
 * merely handled.** (A non-observation otherwise defaults to a negative, and the absence of
 * a signal renders as the good signal.)
 *
 * ⚠️ AND THE DETECTION IS WORD-LEVEL, NOT SUBSTRING — deliberately, because a substring test
 * standing in for a category test is the exact defect D1 was. `'Working on proposal'` must
 * NOT flag: its tokens are `working·on·proposal` and none of them is `won`. A substring
 * search for `won` would match `working`… and we would have rebuilt the bug inside its own
 * alarm.
 *
 * Returns the statuses that LOOK terminal (carry an outcome word) but matched neither
 * category — i.e. exactly the ones a human should look at. Open statuses like
 * `Working on proposal` are correctly silent.
 */
const TERMINAL_TOKENS = new Set(['won', 'win', 'wins', 'lost', 'loss', 'closed', 'sold', 'signed']);

export function unrecognisedTerminalStatuses(
  appts: { leadStatus?: string }[],
): { status: string; count: number }[] {
  const tally = new Map<string, number>();
  for (const a of appts) {
    const raw = String(a.leadStatus ?? '').trim();
    if (!raw) continue;
    if (isClosedWonStatus(raw) || isClosedLostStatus(raw)) continue;
    const tokens = normalizeStatus(raw).split(' ');
    if (!tokens.some(t => TERMINAL_TOKENS.has(t))) continue;
    tally.set(raw, (tally.get(raw) ?? 0) + 1);
  }
  return [...tally.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);
}

export function accountKey(raw: string | undefined | null): string {
  return String(raw ?? '').trim().toLowerCase();
}

export function classifyAccountLabel(raw: string | undefined | null): AccountLabel {
  const r = String(raw ?? '').trim();
  const m = r.match(/^(\d{6,})\s*,\s*[A-Z]{3}$/);
  return m
    ? { raw: r, key: accountKey(r), kind: 'meta-account-id', metaAccountId: m[1] }
    : { raw: r, key: accountKey(r), kind: 'name' };
}

/**
 * DETERMINISTIC ROW KEY, used to deduplicate BEFORE aggregating.
 *
 * Uses dateISO rather than the raw date string, so 8/4/2026 and 2026-08-04 — the same day
 * from two different tabs — collapse to one key instead of surviving as two rows.
 */
export function adSpendRowKey(r: AdSpendRow): string {
  return [
    r.dateISO || r.date,
    accountKey(r.accountName),
    (r.campaignId || '').trim(),
    (r.adsetId || '').trim(),
    (r.adId || '').trim(),
  ].join('\u0000');
}

export interface DedupeResult {
  rows: AdSpendRow[];
  /** ENUMERATED, not counted: a count says something was dropped, only the values say what. */
  removed: { key: string; accountName: string; date: string }[];
}

/**
 * Drop exact duplicate rows before they are summed.
 *
 * ⚠️ MEASURED BOUND, carry it: the live feed has ZERO duplicates on this key — 38,944 rows,
 * 38,944 distinct keys. So this is BEHAVIOUR-NEUTRAL TODAY and exists for the prospective
 * case: a re-export, an appended refresh or a Windsor backfill introduces them and nothing
 * else in the pipeline would notice. Do NOT report that we have a duplicate problem.
 */
export function dedupeAdSpendRows(rows: AdSpendRow[]): DedupeResult {
  const seen = new Set<string>();
  const out: AdSpendRow[] = [];
  const removed: DedupeResult['removed'] = [];
  for (const r of rows) {
    const k = adSpendRowKey(r);
    if (seen.has(k)) {
      removed.push({ key: k, accountName: r.accountName, date: r.dateISO || r.date });
      continue;
    }
    seen.add(k);
    out.push(r);
  }
  return { rows: out, removed };
}

function isBlank(val: string | null | undefined): boolean {
  return val == null || val.trim() === '';
}

export function getPerformance(
  cpl: number,
  leadPercent: number,
  thresholds?: AppSettings["perfThresholds"],
  program?: string,
  costPerAppt?: number,
  appointments?: number,
): PerformanceLevel {
  if (program !== undefined) {
    // Program-aware: mirrors getPerfByProgram in Dashboard.tsx
    if (program === 'Done With You') {
      if (cpl === 0) return 'fair';
      if (cpl < 35) return 'good';
      if (cpl <= 55) return 'fair';
      return 'poor';
    }
    // DFY / Other: judge on cost per appointment
    const cpa = costPerAppt ?? 0;
    const appts = appointments ?? 0;
    if (cpa === 0 || appts === 0) return 'fair';
    if (cpa < 180) return 'good';
    if (cpa <= 240) return 'fair';
    return 'poor';
  }
  const t = thresholds || { goodCpl: 35, goodLeadPercent: 15, poorCpl: 55, poorLeadPercent: 5 };
  if (cpl < t.goodCpl && leadPercent > t.goodLeadPercent) return 'good';
  if (cpl > t.poorCpl || leadPercent < t.poorLeadPercent) return 'poor';
  return 'fair';
}

// Levenshtein distance for fuzzy matching (Tier 4)
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

export function levenshteinSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/\s*&\s*/g, ' and ')               // "X & Y" → "x and y"
    .replace(/\b(llc|inc|corp|co\.?)\b/gi, '')  // strip legal suffixes
    .replace(/[^\w\s]/g, ' ')                    // remove remaining punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Which sources actually answered on the fetch that produced these arrays.
 *
 * ⚠️ ABSENT MEANS KNOWN, DELIBERATELY. A caller that has no source outcomes to offer must
 * keep the behaviour it has today — Targets.tsx:117 and TeamPerformance.tsx:89 both filter
 * arrays they already hold and have no notion of a fetch at all. Defaulting to "unknown"
 * would blank two pages that are working correctly, which is the mirror of the bug.
 */
export interface SourceKnown {
  spend?: boolean;
  appts?: boolean;
}

/**
 * May this metric be rendered as a NUMBER at all?
 *
 * Two DIFFERENT ways a figure can be meaningless, and both currently render as a confident
 * zero:
 *
 *   ① THE SOURCE DID NOT ANSWER — `known === false`. A failed fetch contributes `[]`, and
 *      every sum over `[]` is 0. @bird measured 61 of 61 accounts showing COST/APPT $0.00
 *      from a dead feed.
 *
 *   ② THE DENOMINATOR IS ZERO — cost-per-appointment with no appointments is not $0.00,
 *      it is UNDEFINED. `totalAppts > 0 ? spend/totalAppts : 0` collapses "cannot be
 *      computed" into "computed, and it is nothing". This one fires even when every source
 *      is perfectly healthy, which is why @raccoon measured that costPerAppt CANNOT
 *      discriminate a dead source from a live one — it reads $0.00 in both (RACC-031).
 *
 * ⚠️ THIS APPLIES TO RATIOS, NOT TO SUMS. A live source reporting 0 dials genuinely made
 * zero calls, and blanking that would hide a real and important fact. Only a quotient is
 * meaningless at a zero denominator.
 *
 * ⚠️ `known === false`, never `!known` — absent means known, and `!undefined` is true.
 */
export function metricIsMeaningful(known: boolean | undefined, denominator: number): boolean {
  if (known === false) return false;
  return denominator > 0;
}

/**
 * IS THE CAMPAIGN EXCLUSION LIST ACTUALLY FILTERING ANYTHING?
 *
 * @andrew accepted the data loss — the 32 excluded campaigns are gone and are not coming
 * back. That makes this detector the mission rather than a nicety: the software must not
 * lie about the CONSEQUENCES of a loss he agreed to.
 *
 * WHAT BREAKS, MECHANICALLY: `excludedCampaignIds` is built from settings.excludedCampaigns.
 * When it is empty the filter at the performanceSpend computation excludes NOTHING, so
 * performanceSpend === totalSpend, and `cpl = performanceSpend / performanceLeads` is then
 * computed across campaigns that were deliberately excluded — typically the ones burning
 * spend for no leads, which is WHY they were excluded. ⇒ EVERY cost-per-lead and
 * cost-per-appointment on the dashboard is inflated, and nothing on screen says so.
 *
 * ⚠️ WHY THREE STATES AND NOT A BOOLEAN. "performanceSpend === totalSpend" is the symptom
 * @fable named, and taken alone it is AMBIGUOUS — it is equally true when:
 *     ① nothing is configured                     ← the data loss. Numbers are unfiltered.
 *     ② a list IS configured but matches no row   ← stale ids; also silently unfiltered,
 *                                                   and a DIFFERENT thing to tell someone
 *     ③ the excluded campaigns spent nothing      ← perfectly healthy, MUST NOT WARN
 * A detector that cannot tell ① from ③ would cry wolf on a correctly-configured account,
 * and the fastest way to get a warning ignored is to show it when nothing is wrong.
 */
export type ExclusionState = 'none-configured' | 'configured-but-inert' | 'active';

export interface ExclusionReport {
  state: ExclusionState;
  /** How many ids the settings carry. 0 is the post-wipe state. */
  configuredCount: number;
  /** How many of those ids actually matched a spend row. */
  matchedCount: number;
  /** Spend that IS being counted toward CPL but would have been excluded. */
  unfilteredSpend: number;
  /** Named, not counted — a tally cannot be judged, and these go on screen. */
  affectedAccounts: string[];
}

export function detectExclusionState(
  adSpend: AdSpendRow[],
  settings?: AppSettings,
): ExclusionReport {
  const configured = (settings?.excludedCampaigns || []).map(c => String(c).trim()).filter(Boolean);
  const configuredIds = new Set(configured);

  const matched = new Set<string>();
  let unfilteredSpend = 0;
  const affected = new Set<string>();
  for (const r of adSpend) {
    const id = (r.campaignId || '').trim();
    if (id && configuredIds.has(id)) {
      matched.add(id);
      unfilteredSpend += r.spent;
      if (r.accountName) affected.add(r.accountName);
    }
  }

  // ③ first: a configured list that matched rows is working, whatever the spend totals say.
  if (configured.length > 0 && matched.size > 0) {
    return {
      state: 'active',
      configuredCount: configured.length,
      matchedCount: matched.size,
      unfilteredSpend: 0, // it IS being filtered — nothing is leaking into CPL
      affectedAccounts: [],
    };
  }

  // ② configured but nothing matched: the ids are stale, and the numbers are unfiltered
  // exactly as if the list were empty — but the cause, and so the message, is different.
  if (configured.length > 0) {
    return {
      state: 'configured-but-inert',
      configuredCount: configured.length,
      matchedCount: 0,
      unfilteredSpend: 0,
      affectedAccounts: [],
    };
  }

  // ① nothing configured. Only report accounts that actually HAVE spend — an account with
  // no spend has no inflated CPL, and naming it would be noise.
  const withSpend = new Set<string>();
  let total = 0;
  for (const r of adSpend) {
    if (r.spent > 0 && r.accountName) withSpend.add(r.accountName);
    total += r.spent;
  }
  return {
    state: 'none-configured',
    configuredCount: 0,
    matchedCount: 0,
    unfilteredSpend: total,
    affectedAccounts: Array.from(withSpend).sort(),
  };
}

/** Do these numbers need a caveat on screen? Only ① and ② — never a healthy config. */
export function exclusionsAreLying(r: ExclusionReport): boolean {
  return r.state !== 'active';
}

/**
 * ⭐ THE ACCOUNT IDENTITY KEY — one definition, so nothing can disagree about it.
 *
 * `accountId` when the source supplies one (Supabase always does), the normalised display
 * name otherwise (hand-built fixtures, and the shape every pre-cutover test uses). Exported
 * because the appointment matcher and the alias maps must key on EXACTLY this and not on a
 * second, slightly different copy of the rule — a name-keyed lookup left behind beside an
 * id-keyed one is how Targets would silently reclassify accounts that Dashboard resolved
 * correctly.
 */
export function accountIdentityKey(row: Pick<AdSpendRow, 'accountId' | 'accountName'>): string {
  const id = (row.accountId || '').trim();
  if (id) return id;
  return (row.accountName || 'Unknown').trim().toLowerCase();
}

export function buildAccountSummaries(
  adSpend: AdSpendRow[],
  appointments: AppointmentRow[],
  settings?: AppSettings,
  known?: SourceKnown,
  /**
   * ⭐ THE CURATED MAPPING FROM `ad_accounts`, and the reason this parameter exists at all:
   * without it the Settings account table is WRITE-ONLY. See src/lib/accountRegistry.ts for
   * the join key, why it is exact-only, and why a colliding name resolves to nothing.
   * Optional and defaulting to a registry that answers nothing, so every existing caller
   * and every test keeps the legacy behaviour unchanged.
   */
  registry: AccountRegistry = emptyAccountRegistry(),
): { accounts: AccountSummary[], unmatchedAppointments: AppointmentRow[] } {
  // `?? true` and not `|| true`: an explicit `false` must survive. `||` would turn every
  // "this source is dead" back into "known", which is exactly the bug being fixed.
  const spendKnown = known?.spend ?? true;
  const apptsKnown = known?.appts ?? true;
  const accountMap = new Map<string, {
    spendRows: AdSpendRow[]; appts: AppointmentRow[]; originalName: string; accountId: string | null;
  }>();

  // 1. Group ad spend by ACCOUNT IDENTITY.
  //
  // ⭐ `accountId` FIRST, and this one line is the point of the Supabase cutover. Meta
  // rewrites an account's display name — measured five times, e.g. `Publicity 1` ->
  // `Washbroz X SocialWorks` — and the old sheet feed then carried BOTH names, so grouping
  // on the name SPLIT one client into two accounts with two half-histories. `account_id` is
  // Meta's primary key; it does not move.
  //
  // ⚠️ THE NAME FALLBACK IS NOT DEAD CODE. Rows built by hand (600+ tests, and any future
  // source without an id) carry no `accountId`, and they must keep grouping exactly as they
  // did. `|| 'Unknown'` is preserved on that path for the same reason it existed before.
  for (const row of adSpend) {
    const name = row.accountName || 'Unknown';
    const key = accountIdentityKey(row);
    if (!accountMap.has(key)) {
      accountMap.set(key, {
        spendRows: [], appts: [], originalName: name, accountId: (row.accountId || '').trim() || null,
      });
    }
    accountMap.get(key)!.spendRows.push(row);
  }

  // 2. Build lookup maps — Campaign ID only (globally unique, zero false-match risk)
  const campaignIdToAccount = new Map<string, string>();
  for (const [normalizedName, data] of accountMap.entries()) {
    for (const row of data.spendRows) {
      const trimmedId = (row.campaignId || '').trim();
      if (trimmedId) campaignIdToAccount.set(trimmedId, normalizedName);
    }
  }

  /**
   * TIER 2's LOOKUP: an Airtable client name -> an account grouping key.
   *
   * ⭐ TWO SOURCES, AND THE STABLE ONE WINS.
   *
   * ① THE LEGACY ALIAS STORE (`app_settings.accountAliases`), keyed
   *    `airtableName -> sheetName`. Its right-hand side is the name the GOOGLE SHEET used.
   *
   *    🔴 AND IT WAS DEAD ON ARRIVAL AFTER THE CUTOVER — measured, 2026-08-11, on the live
   *    store: **0 of its 62 entries could resolve.** The docblock here used to claim it
   *    "still resolves for the ~50 accounts that were never renamed"; that was FALSE the
   *    moment the grouping key stopped being a name. `accountMap` is now keyed by
   *    `account_id`, so `accountMap.has('backyard paradiso')` is false for EVERY alias, and
   *    `accountMap.has('10170221, usd')` is false even for the id-form ones. Tier 2 fell
   *    through to the fuzzy tier for the whole product and nothing said so.
   *
   *    ⭐ WHY THAT IS WORSE THAN IT LOOKS: the aliases are the control the USER edits in
   *    Settings. Silently ignoring them makes that screen write-only for attribution — the
   *    same "a control whose only effect is to draw its own label" defect this branch has
   *    been killing everywhere else. It survived because Tier 4 fuzzy-matching happened to
   *    cover most accounts, so the breakage was invisible on exactly the accounts nobody
   *    needed to check.
   *
   *    ⇒ THE RIGHT-HAND SIDE IS NOW TRANSLATED INTO THE CURRENT IDENTITY KEY by
   *    `spendKeyForLabel` below, so a hand-made mapping resolves again.
   *
   * ② `ad_account_airtable_names`, keyed `airtable client name -> account_id`. THE STABLE
   *    PATH. The left-hand side is Airtable's own string and the right-hand side is Meta's
   *    primary key, so neither end moves when Meta rewrites a display name. Seeded from the
   *    campaign-id bridge — 16 names over 13 accounts, each the strictly dominant account
   *    across at least two campaign-id-evidenced appointments.
   *
   * ⚠️ ② IS APPLIED SECOND SO IT OVERWRITES ①. When both answer, the id-keyed row is the
   * one that survives a rename, and preferring the mutable answer would reintroduce exactly
   * the bug this table exists to remove.
   */

  /**
   * A LABEL THE OLD WORLD USED -> THE KEY THIS RUN GROUPS BY.
   *
   * Three routes, strongest first, and every one of them is exact — no fuzz. Attribution
   * decided here moves a client's whole appointment history, which is not a place to be
   * 85% sure; the fuzzy tier already exists downstream and is allowed to be wrong.
   *
   * ⚠️ IT MUST RETURN A KEY THAT IS ACTUALLY IN `accountMap`, never merely a plausible one.
   * Returning an unresolvable key sends the appointment to Tier 3 anyway, so a miss is
   * harmless; returning a WRONG key silently moves one client's bookings onto another.
   */
  const spendKeyByName = new Map<string, string>();
  for (const [key, data] of accountMap) {
    const n = accountKey(data.originalName);
    // ⚠️ PREFER THE DUPE, same rule as the registry: if two accounts answer to one Meta
    // name, that name identifies neither, so it must resolve to nothing rather than to
    // whichever row the iteration happened to reach first.
    if (n) spendKeyByName.set(n, spendKeyByName.has(n) && spendKeyByName.get(n) !== key ? '' : key);
  }
  const spendKeyForLabel = (label: string | null | undefined): string | null => {
    const raw = String(label ?? '').trim();
    if (!raw) return null;
    // ① the label IS the identity key already (an account id, or a name-keyed legacy row)
    if (accountMap.has(accountKey(raw))) return accountKey(raw);
    if (accountMap.has(raw)) return raw;
    // ② an id-form label — "10170221, USD" — carries Meta's primary key inside it
    const embedded = classifyAccountLabel(raw).metaAccountId;
    if (embedded && accountMap.has(embedded)) return embedded;
    // ③ the label matches the Meta display name this account currently reports
    const byName = spendKeyByName.get(accountKey(raw));
    return byName || null;
  };

  const manualMappingToAccount = new Map<string, string>();
  for (const mapping of settings?.accountAliases || []) {
    const airtableName = (mapping.airtableName || mapping.sheetName || '').trim();
    if (!airtableName) continue;
    // Unresolvable labels keep their old value rather than being dropped: an account whose
    // spend is absent from this window has no key to find, and the pre-cutover behaviour
    // (a miss that falls through to Tier 3) is exactly right for it.
    const resolved = spendKeyForLabel(mapping.sheetName) ?? mapping.sheetName.trim().toLowerCase();
    manualMappingToAccount.set(airtableName.toLowerCase(), resolved);
  }
  for (const appt of appointments) {
    const client = (appt.client || '').trim();
    if (!client || appt.clientUnresolved) continue;
    const accountId = registry.airtableNameToAccountId(client);
    if (accountId) manualMappingToAccount.set(client.toLowerCase(), accountId);
  }

  // 3. Match appointments — 4-tier matching system
  const unmatchedAfterTier2: AppointmentRow[] = [];
  const clientNameToAccount = new Map<string, string>(); // for Tier 3 inference

  // First pass: Tier 1 & Tier 2
  for (const appt of appointments) {
    let matchedAccountKey: string | undefined;

    // Tier 1 — ID Matching
    const apptCampId = (appt.campaignId || '').trim();
    if (apptCampId) {
      matchedAccountKey = campaignIdToAccount.get(apptCampId);
    }

    /**
     * ⭐ TIER 1 (campaign id) STILL APPLIES to an unresolved appointment — a campaign id is
     * real attribution evidence and does not depend on the client name. Only the NAME-BASED
     * tiers are skipped, because the "name" is a placeholder. Attributing on a sentinel
     * would be worse than the record id it replaced: every unresolved appointment would
     * collapse onto one pseudo-account.
     */
    // Tier 2 — Manual Alias
    if (!matchedAccountKey && appt.client && !appt.clientUnresolved) {
      matchedAccountKey = manualMappingToAccount.get(appt.client.trim().toLowerCase());
    }

    if (matchedAccountKey && accountMap.has(matchedAccountKey)) {
      accountMap.get(matchedAccountKey)!.appts.push(appt);
      // Record this client name → account mapping for Tier 3
      if (appt.client && !appt.clientUnresolved) {
        clientNameToAccount.set(appt.client.trim().toLowerCase(), matchedAccountKey);
      }
    } else {
      unmatchedAfterTier2.push(appt);
    }
  }

  // Second pass: Tier 3 — Client Name Inference
  const unmatchedAfterTier3: AppointmentRow[] = [];
  for (const appt of unmatchedAfterTier2) {
    let matchedAccountKey: string | undefined;

    if (appt.client && !appt.clientUnresolved) {
      matchedAccountKey = clientNameToAccount.get(appt.client.trim().toLowerCase());
    }

    if (matchedAccountKey && accountMap.has(matchedAccountKey)) {
      accountMap.get(matchedAccountKey)!.appts.push(appt);
    } else {
      unmatchedAfterTier3.push(appt);
    }
  }

  // Third pass: Tier 4 — Fuzzy Name Matching
  const unmatchedAppointments: AppointmentRow[] = [];
  const accountKeys = Array.from(accountMap.keys());
  const normalizedAccountKeys = accountKeys.map(k => ({ key: k, normalized: normalizeName(accountMap.get(k)!.originalName) }));

  for (const appt of unmatchedAfterTier3) {
    let matchedAccountKey: string | undefined;

    if (appt.client && !appt.clientUnresolved) {
      const normalizedClient = normalizeName(appt.client);
      const scores = normalizedAccountKeys.map(ak => ({
        key: ak.key,
        score: levenshteinSimilarity(normalizedClient, ak.normalized),
      })).sort((a, b) => b.score - a.score);

      if (scores.length > 0 && scores[0].score >= 0.85) {
        const secondScore = scores.length > 1 ? scores[1].score : 0;
        // Only match if exactly one account above threshold with sufficient gap
        if (scores[0].score - secondScore >= 0.15) {
          matchedAccountKey = scores[0].key;
        }
      }
    }

    if (matchedAccountKey && accountMap.has(matchedAccountKey)) {
      accountMap.get(matchedAccountKey)!.appts.push(appt);
    } else {
      unmatchedAppointments.push(appt);
    }
  }

  // 4. Build final summaries
  const summaries: AccountSummary[] = [];
  const aliasMap = new Map((settings?.accountAliases || []).map(a => [a.sheetName.trim().toLowerCase(), a]));
  const thresholds = settings?.perfThresholds;
  const excludedCampaignIds = new Set((settings?.excludedCampaigns || []).map(id => id.trim()));

  for (const [, data] of accountMap) {
    const accountName = data.originalName;
    /**
     * ⚠️ LOOKED UP BY NAME, NOT BY THE MAP KEY — and this line is why. The grouping key is
     * now an `account_id`, while `accountAliases` is keyed on the name the sheet used. Left
     * as `aliasMap.get(normalizedKey)` this silently returned undefined for EVERY account,
     * dropping program / media buyer / status back to their defaults across the whole app —
     * with nothing on screen to say so, because "Done For You" and "Active" are what a miss
     * looks like. The registry below still overrides where it has a curated answer, which is
     * what made the breakage invisible in spot checks.
     */
    const alias = aliasMap.get(accountName.trim().toLowerCase());
    /**
     * The curated `ad_accounts` row. BY ID FIRST: the id is a key, the name is a label, and
     * the five renamed accounts resolve only through the id.
     */
    const identity = registry.byAccountId(data.accountId) ?? registry.byMetaName(accountName);

    // Total spend/leads from ALL campaigns (shown to client — matches their Facebook bill)
    const totalSpend = data.spendRows.reduce((s, r) => s + r.spent, 0);
    const totalLeads = data.spendRows.reduce((s, r) => s + r.leads, 0);

    // Performance spend/leads from non-excluded campaigns only
    const performanceSpend = data.spendRows
      .filter(r => !excludedCampaignIds.has((r.campaignId || '').trim()))
      .reduce((s, r) => s + r.spent, 0);
    const performanceLeads = data.spendRows
      .filter(r => !excludedCampaignIds.has((r.campaignId || '').trim()))
      .reduce((s, r) => s + r.leads, 0);

    // Build campaigns within this account
    const campaignMap = new Map<string, { spendRows: AdSpendRow[], appts: AppointmentRow[] }>();
    for (const r of data.spendRows) {
      const key = (r.campaignId || '').trim() || (r.campaign || '').trim();
      if (!key) continue;
      if (!campaignMap.has(key)) campaignMap.set(key, { spendRows: [], appts: [] });
      campaignMap.get(key)!.spendRows.push(r);
    }

    // Match appointments to campaigns using lookup maps
    const campIdMap = new Map<string, string>();
    const campNameMap = new Map<string, string>();
    const campAdSetNameMap = new Map<string, string>();
    const campAdNameMap = new Map<string, string>();
    const campAdIdMap = new Map<string, string>();
    for (const [cKey, cData] of campaignMap) {
      for (const r of cData.spendRows) {
        const cId = (r.campaignId || '').trim();
        const cName = (r.campaign || '').trim();
        const asName = (r.adsetName || '').trim();
        const aName = (r.adName || '').trim();
        const aId = (r.adId || '').trim();
        if (cId) campIdMap.set(cId, cKey);
        if (cName) campNameMap.set(cName.toLowerCase(), cKey);
        if (asName) campAdSetNameMap.set(asName.toLowerCase(), cKey);
        if (aName) campAdNameMap.set(aName.toLowerCase(), cKey);
        if (aId) campAdIdMap.set(aId, cKey);
      }
    }

    for (const a of data.appts) {
      const aAdId = (a.adId || '').trim();
      const aAdName = (a.adName || '').trim();
      const aAdSetId = (a.adSetId || '').trim();
      const aAdSetName = (a.adSetName || '').trim();
      const aCampId = (a.campaignId || '').trim();
      const aCampName = (a.campaignName || '').trim();

      let matchedCampaignKey: string | undefined;
      // Priority: campaign ID (most direct) > adset ID > adset name > ad ID > ad name > campaign name
      if (aCampId) matchedCampaignKey = campIdMap.get(aCampId);
      if (!matchedCampaignKey && aAdSetId) {
        for (const [cKey, cData] of campaignMap) {
          if (cData.spendRows.some(r => (r.adsetId || '').trim() === aAdSetId)) { matchedCampaignKey = cKey; break; }
        }
      }
      if (!matchedCampaignKey && aAdSetName) matchedCampaignKey = campAdSetNameMap.get(aAdSetName.toLowerCase());
      if (!matchedCampaignKey && aAdId) matchedCampaignKey = campAdIdMap.get(aAdId);
      if (!matchedCampaignKey && aAdName) matchedCampaignKey = campAdNameMap.get(aAdName.toLowerCase());
      if (!matchedCampaignKey && aCampName) matchedCampaignKey = campNameMap.get(aCampName.toLowerCase());

      if (matchedCampaignKey && campaignMap.has(matchedCampaignKey)) {
        campaignMap.get(matchedCampaignKey)!.appts.push(a);
      }
    }

    const campaigns: CampaignSummary[] = [];
    for (const [cKey, cData] of campaignMap) {
      const cSpend = cData.spendRows.reduce((s, r) => s + r.spent, 0);
      const cLeads = cData.spendRows.reduce((s, r) => s + r.leads, 0);
      const cAppts = cData.appts.length;
      const cClosed = cData.appts.filter(a => isClosedWon(a, settings)).length;
      const cRevenue = cData.appts.reduce((s, a) => s + a.closedRevenue, 0);
      const cQualified = cData.appts.filter(a => a.leadValid?.toLowerCase() === 'valid').length;
      const cCpl = cLeads > 0 ? cSpend / cLeads : 0;
      const cLeadPct = cLeads > 0 ? (cAppts / cLeads) * 100 : 0;

      // Build ad sets
      const adSetMap = new Map<string, { spendRows: AdSpendRow[], appts: AppointmentRow[] }>();
      for (const r of cData.spendRows) {
        const key = (r.adsetId || '').trim() || (r.adsetName || '').trim();
        if (!key) continue;
        if (!adSetMap.has(key)) adSetMap.set(key, { spendRows: [], appts: [] });
        adSetMap.get(key)!.spendRows.push(r);
      }

      // Match campaign appointments to ad sets
      const asAdIdMap = new Map<string, string>();
      const asAdNameMap = new Map<string, string>();
      const asIdMap = new Map<string, string>();
      const asNameMap = new Map<string, string>();
      for (const [asKey, asData] of adSetMap) {
        for (const r of asData.spendRows) {
          const aId = (r.adId || '').trim();
          const aName = (r.adName || '').trim();
          const asId = (r.adsetId || '').trim();
          const asName = (r.adsetName || '').trim();
          if (aId) asAdIdMap.set(aId, asKey);
          if (aName) asAdNameMap.set(aName.toLowerCase(), asKey);
          if (asId) asIdMap.set(asId, asKey);
          if (asName) asNameMap.set(asName.toLowerCase(), asKey);
        }
      }

      for (const a of cData.appts) {
        const aAdId = (a.adId || '').trim();
        const aAdName = (a.adName || '').trim();
        const aAdSetId = (a.adSetId || '').trim();
        const aAdSetName = (a.adSetName || '').trim();

        let matchedAdSetKey: string | undefined;
        // Priority: adset ID (most direct) > adset name > ad ID > ad name
        if (aAdSetId) matchedAdSetKey = asIdMap.get(aAdSetId);
        if (!matchedAdSetKey && aAdSetName) matchedAdSetKey = asNameMap.get(aAdSetName.toLowerCase());
        if (!matchedAdSetKey && aAdId) matchedAdSetKey = asAdIdMap.get(aAdId);
        if (!matchedAdSetKey && aAdName) matchedAdSetKey = asAdNameMap.get(aAdName.toLowerCase());

        if (matchedAdSetKey && adSetMap.has(matchedAdSetKey)) {
          adSetMap.get(matchedAdSetKey)!.appts.push(a);
        }
      }

      const adSets: AdSetSummary[] = [];
      for (const [asKey, asData] of adSetMap) {
        const asSpend = asData.spendRows.reduce((s, r) => s + r.spent, 0);
        const asLeads = asData.spendRows.reduce((s, r) => s + r.leads, 0);
        const asAppts = asData.appts.length;
        const asClosed = asData.appts.filter(a => isClosedWon(a, settings)).length;
        const asRevenue = asData.appts.reduce((s, a) => s + a.closedRevenue, 0);
        const asCpl = asLeads > 0 ? asSpend / asLeads : 0;
        const asLeadPct = asLeads > 0 ? (asAppts / asLeads) * 100 : 0;

        // Build individual ads within this ad set
        const adMap = new Map<string, { spendRows: AdSpendRow[], appts: AppointmentRow[] }>();
        for (const r of asData.spendRows) {
          const key = (r.adId || '').trim() || (r.adName || '').trim();
          if (!key) continue;
          if (!adMap.has(key)) adMap.set(key, { spendRows: [], appts: [] });
          adMap.get(key)!.spendRows.push(r);
        }

        const adIdMap2 = new Map<string, string>();
        const adNameMap2 = new Map<string, string>();
        for (const [adKey, adData] of adMap) {
          for (const r of adData.spendRows) {
            const aId = (r.adId || '').trim();
            const aName = (r.adName || '').trim();
            if (aId) adIdMap2.set(aId, adKey);
            if (aName) adNameMap2.set(aName.toLowerCase(), adKey);
          }
        }
        for (const a of asData.appts) {
          const aAdId = (a.adId || '').trim();
          const aAdName = (a.adName || '').trim();
          let matchedAdKey: string | undefined;
          if (aAdId) matchedAdKey = adIdMap2.get(aAdId);
          if (!matchedAdKey && aAdName) matchedAdKey = adNameMap2.get(aAdName.toLowerCase());
          if (matchedAdKey && adMap.has(matchedAdKey)) {
            adMap.get(matchedAdKey)!.appts.push(a);
          }
        }

        const ads: AdSummary[] = [];
        for (const [adKey, adData] of adMap) {
          const adSpend = adData.spendRows.reduce((s, r) => s + r.spent, 0);
          const adLeads = adData.spendRows.reduce((s, r) => s + r.leads, 0);
          const adAppts = adData.appts.length;
          const adClosed = adData.appts.filter(a => isClosedWon(a, settings)).length;
          const adRevenue = adData.appts.reduce((s, a) => s + a.closedRevenue, 0);
          ads.push({
            adName: adData.spendRows[0]?.adName || adKey,
            adId: adData.spendRows[0]?.adId || adKey,
            spend: adSpend,
            leads: adLeads,
            cpl: adLeads > 0 ? adSpend / adLeads : 0,
            appointments: adAppts,
            costPerAppt: adAppts > 0 ? adSpend / adAppts : 0,
            closed: adClosed,
            revenue: adRevenue,
          });
        }

        adSets.push({
          adSetName: asData.spendRows[0]?.adsetName || asKey,
          adSetId: asData.spendRows[0]?.adsetId || asKey,
          spend: asSpend,
          leads: asLeads,
          cpl: asCpl,
          appointments: asAppts,
          leadPercent: asLeadPct,
          costPerAppt: asAppts > 0 ? asSpend / asAppts : 0,
          closed: asClosed,
          revenue: asRevenue,
          performance: getPerformance(asCpl, asLeadPct, thresholds, alias?.program, asAppts > 0 ? asSpend / asAppts : 0, asAppts),
          adCount: ads.length,
          ads,
        });
      }

      campaigns.push({
        campaignName: cData.spendRows[0]?.campaign || cKey,
        campaignId: cData.spendRows[0]?.campaignId || cKey,
        accountName,
        spend: cSpend,
        leads: cLeads,
        cpl: cCpl,
        appointments: cAppts,
        leadPercent: cLeadPct,
        costPerAppt: cAppts > 0 ? cSpend / cAppts : 0,
        qualified: cQualified,
        qualPercent: cAppts > 0 ? (cQualified / cAppts) * 100 : 0,
        closed: cClosed,
        revenue: cRevenue,
        performance: getPerformance(cCpl, cLeadPct, thresholds, alias?.program, cAppts > 0 ? cSpend / cAppts : 0, cAppts),
        adSets,
      });
    }

    // Collect appointments matched to excluded campaigns
    const excludedApptSet = new Set<AppointmentRow>();
    for (const [, cData] of campaignMap) {
      const campaignId = (cData.spendRows[0]?.campaignId || '').trim();
      if (excludedCampaignIds.has(campaignId)) {
        for (const a of cData.appts) excludedApptSet.add(a);
      }
    }

    // Performance appointments = only non-excluded campaigns
    const performanceAppts = data.appts.filter(a => !excludedApptSet.has(a));

    const totalAppts = performanceAppts.length;
    const closed = performanceAppts.filter(a => isClosedWon(a, settings)).length;
    const revenue = performanceAppts.reduce((s, a) => s + a.closedRevenue, 0);
    const billed = performanceAppts.reduce((s, a) => s + a.amountCharged, 0);
    const qualified = performanceAppts.filter(a => a.leadValid?.toLowerCase() === 'valid').length;

    const cpl = performanceLeads > 0 ? performanceSpend / performanceLeads : 0;
    const leadPct = performanceLeads > 0 ? (totalAppts / performanceLeads) * 100 : 0;
    const costPerAppt = totalAppts > 0 ? performanceSpend / totalAppts : 0;
    const qualPercent = totalAppts > 0 ? (qualified / totalAppts) * 100 : 0;

    summaries.push({
      accountName,
      /**
       * ⭐ THE NAME @andrew ASKED FOR, carried on the summary every screen already reads.
       * `null` rather than a fallback to `accountName`: a caller that receives a string can
       * no longer tell a curated client name from Meta's raw one, and that indistinguishability
       * is precisely how the company/meta inversion got shipped in the first place.
       */
      companyName: identity?.company ?? null,
      /**
       * ⚠️ 'Unknown' IS A REAL ANSWER AND MUST SURVIVE. Five live accounts have no program,
       * one of them (No Streaks) spent $7,008 in 2026 and last spent today. The Dashboard's
       * own resolver defaulted a missing program to 'Done For You' — a refusal turned into a
       * confident fact, which then decided which performance rule judged the media buyer's
       * work. Nothing here invents one.
       */
      program: resolveProgram(identity, alias?.program) || 'Unknown',
      mediaBuyer: resolveMediaBuyer(identity, alias?.mediaBuyer) || 'Unassigned',
      status: resolveStatus(identity, alias?.status),
      spend: totalSpend,
      leads: totalLeads,
      performanceSpend,
      performanceLeads,
      cpl,
      appointments: totalAppts,
      leadPercent: leadPct,
      costPerAppt,
      qualified,
      qualPercent,
      closed,
      revenue,
      billed,
      spendKnown,
      apptsKnown,
      campaigns,
      /**
       * 🔴 THE PARTS DO NOT ALWAYS SUM TO THE WHOLE, AND THE PANEL MUST SAY SO.
       * @andrew's Archadeck screenshot: spend and leads reconcile between the campaign rows
       * and the account header, appointments do NOT — campaigns sum to 6, the header says 7.
       *
       * An appointment attaches to an ACCOUNT by client name, but to a CAMPAIGN only via
       * campaign id / ad-set id / ad-set name / ad id / ad name / campaign name. A row
       * carrying a client and none of those six is real, is counted at account level, and is
       * structurally invisible to every per-campaign reduce.
       *
       * ⭐ THIS IS ⑥ ONE LEVEL DEEPER. ⑥ was "TOTAL APPTS reduces over accounts, so an
       * appointment with no account cannot appear". Fixing the parent said nothing about the
       * child — and the same shape recurs at ad-set and ad level.
       *
       * ⛔ DO NOT CLOSE THE GAP BY REASSIGNING THE ROW. The 7 is right and the 6 is
       * incomplete; forcing them to agree would make the arithmetic tidy and the attribution
       * FALSE. The number stays. The gap gets NAMED, the way the dashboard names its 43.
       */
      unattributedAppointments: Math.max(
        0,
        totalAppts - campaigns.reduce((s, c) => s + c.appointments, 0),
      ),
      appointmentList: data.appts,
    });
  }

  return { accounts: summaries.sort((a, b) => b.spend - a.spend), unmatchedAppointments };
}

export function buildTeamPerformance(accounts: AccountSummary[]): TeamMember[] {
  const teamMap = new Map<string, { name: string; accounts: AccountSummary[] }>();
  /**
   * ⚠️ THE ORDER IS A CLAIM TOO, and it was the last appointment-derived number on the page
   * still being fabricated after the cells were fixed. Sorting by `totalAppointments` when
   * Airtable is dead compares 0 against 0 for everybody, so the sort is a no-op and the list
   * renders in Map-insertion order — while the `#` column numbers it 1, 2, 3 under a heading
   * that says "Leaderboard". Nobody reads that as "arbitrary"; they read it as a ranking,
   * which is the fabricated judgement the em dashes exist to prevent.
   *
   * Falls back to SPEND, which is knowable from the live feed and is the other headline this
   * page ranks on.
   *
   * ⛔ DECIDED ONCE, FOR THE WHOLE LIST, and not inside the comparator. A comparator that
   * picks its key from the two rows in front of it is not transitive when known-ness is
   * mixed (a>b on appointments, b>c on spend, c>a on spend is representable), and an
   * intransitive comparator is undefined behaviour in `Array.prototype.sort`.
   */
  const rankByAppointments = !accounts.some(a => a.apptsKnown === false);

  for (const account of accounts) {
    const buyer = account.mediaBuyer || 'Unassigned';
    if (!teamMap.has(buyer)) {
      teamMap.set(buyer, { name: buyer, accounts: [] });
    }
    teamMap.get(buyer)!.accounts.push(account);
  }

  return Array.from(teamMap.values()).map(tm => {
    const totalSpend = tm.accounts.reduce((s, a) => s + a.spend, 0);
    const totalLeads = tm.accounts.reduce((s, a) => s + a.leads, 0);
    const totalAppointments = tm.accounts.reduce((s, a) => s + a.appointments, 0);
    const closedDeals = tm.accounts.reduce((s, a) => s + a.closed, 0);
    const revenueGenerated = tm.accounts.reduce((s, a) => s + a.revenue, 0);

    /**
     * 🔴 THE FLAG THE REDUCES ABOVE WERE THROWING AWAY. Every `a.appointments` summed here
     * came off a row that already knew whether Airtable had answered; the sum did not, so a
     * dead source arrived at the leaderboard as `Appts 0 · Revenue $0.00` next to a person's
     * name. See the docblock on `TeamMember`.
     *
     * ⚠️ `.some(=== false)` AND NOT `.every(!== false)`. They differ on the empty array —
     * `[].every()` is `true`, i.e. "a buyer with no accounts knows everything". A bucket is
     * only created by pushing an account into it so it cannot be empty today, but the
     * vacuous-true reading is the one that fails OPEN, and this flag exists precisely so
     * that a refusal cannot be re-read as a confident answer.
     *
     * ANY unknown contributor makes the SUM unknown: a total missing one account is not a
     * smaller total, it is an unknown total.
     */
    const spendKnown = !tm.accounts.some(a => a.spendKnown === false);
    const apptsKnown = !tm.accounts.some(a => a.apptsKnown === false);

    return {
      name: tm.name,
      accountsManaged: tm.accounts.length,
      totalSpend,
      totalLeads,
      totalAppointments,
      closedDeals,
      revenueGenerated,
      avgCPL: totalLeads > 0 ? totalSpend / totalLeads : 0,
      avgLeadPercent: totalLeads > 0 ? (totalAppointments / totalLeads) * 100 : 0,
      spendKnown,
      apptsKnown,
    };
  }).sort((a, b) => (rankByAppointments
    ? b.totalAppointments - a.totalAppointments
    : b.totalSpend - a.totalSpend));
}

export function formatCurrency(val: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
}

export function formatNumber(val: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(val));
}

export function formatPercent(val: number): string {
  return `${val.toFixed(1)}%`;
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
