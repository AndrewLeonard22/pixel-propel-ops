/**
 * RESOLVE AIRTABLE LINKED-RECORD IDS TO THE NAMES THEY POINT AT.
 *
 * @andrew, on the banner that told him to go add a Lookup field in Airtable: «this is bs».
 * He is right. That banner handed the CUSTOMER a chore to work around OUR limitation —
 * 678 appointments carry a record id instead of a client name and we can resolve them here.
 *
 * ⭐ THE BANNER MUST BECOME A FACT, NOT AN INSTRUCTION. It may say "N could not be
 * resolved"; it may never say "go and edit your source system so our code works".
 *
 * ══ THE THREE STEPS, EACH ABLE TO FAIL INDEPENDENTLY ══
 *   ① GET /v0/meta/bases/{baseId}/tables      → find the field whose type is
 *                                               `multipleRecordLinks`, read
 *                                               options.linkedTableId, and the linked
 *                                               table's PRIMARY FIELD NAME
 *   ② GET /v0/{baseId}/{linkedTableId}        → recordId → primary field value
 *   ③ resolve at map time, ONE fetch per refresh — never per row
 *
 * ══ 🔴 MEASURED BEFORE CODING, AND IT CORRECTS THE STATED PLAN ══
 * The brief said "if ① is 403". It is not:
 *
 *     GET /v0/meta/bases/appFAKE.../tables                     → HTTP 404 {"error":"NOT_FOUND"}
 *     same, with a syntactically valid but wrong Bearer token  → HTTP 404 {"error":"NOT_FOUND"}
 *
 * ⇒ Airtable does NOT distinguish "no such base" from "your PAT may not see it". A PAT
 *   lacking `schema.bases:read` can surface as 404, so branching on 403 alone would miss
 *   the exact case the degradation exists for.
 * ⇒ **ANY non-2xx, or any unexpected shape, degrades.** The rule is "did I get a usable
 *   answer", never "which error did I get".
 *
 * ══ ⛔ DEGRADE, NEVER THROW ══
 * Every failure here returns null and the caller falls back to EXACTLY today's behaviour:
 * an unresolved link is UNRESOLVED_CLIENT, counted as unmatched, and NEVER a record id
 * rendered as a name. The b50a4d0 invariant is untouched by this file — resolution is an
 * IMPROVEMENT layered on top of a refusal that already works, not a replacement for it.
 * A resolver that can throw would turn a cosmetic win into an outage.
 */

/** Airtable record id: 'rec' + 14. Same shape isAirtableRecordId enforces. */
const REC_ID = /^rec[A-Za-z0-9]{14}$/;

export interface LinkResolution {
  /** recordId → the linked row's primary field value. Empty when nothing resolved. */
  names: Map<string, string>;
  /** The table the link points at, for diagnostics. Null when step ① degraded. */
  linkedTableId: string | null;
}

interface MetaField {
  id?: string;
  name?: string;
  type?: string;
  options?: { linkedTableId?: string };
}
interface MetaTable {
  id?: string;
  name?: string;
  primaryFieldId?: string;
  fields?: MetaField[];
}

/**
 * ① Find the linked table behind `fieldName`, and the NAME of that table's primary field.
 *
 * ⚠️ THE PRIMARY FIELD NAME IS REQUIRED, NOT OPTIONAL. Records come back keyed by field
 * NAME, while meta identifies the primary field by ID — so without resolving
 * primaryFieldId → name we would have the rows and no idea which column is the label.
 */
export async function findLinkTarget(
  baseId: string,
  tableName: string,
  fieldName: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ linkedTableId: string; primaryFieldName: string } | null> {
  if (!baseId || !token) return null;
  try {
    const res = await fetchImpl(
      `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(baseId)}/tables`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    // ANY non-2xx degrades — 404 is the measured shape for a PAT without schema access.
    if (!res.ok) return null;

    const body = (await res.json()) as { tables?: MetaTable[] };
    if (!Array.isArray(body?.tables)) return null;

    const table = body.tables.find(t => t?.name === tableName || t?.id === tableName);
    if (!table || !Array.isArray(table.fields)) return null;

    const field = table.fields.find(f => f?.name === fieldName);
    // Not a link field is a legitimate answer, not an error: the column may already be
    // plain text, in which case there is nothing to resolve and nothing to report.
    if (!field || field.type !== 'multipleRecordLinks') return null;

    const linkedTableId = field.options?.linkedTableId;
    if (!linkedTableId) return null;

    const linked = body.tables.find(t => t?.id === linkedTableId);
    const primaryFieldName = linked?.fields?.find(f => f?.id === linked?.primaryFieldId)?.name;
    if (!primaryFieldName) return null;

    return { linkedTableId, primaryFieldName };
  } catch {
    return null;
  }
}

/**
 * ② Read the linked table once and build recordId → primary field value.
 *
 * ⚠️ PAGED. Airtable caps at 100 per request, and a client list longer than that would
 * otherwise resolve the first 100 and silently leave the rest as record ids — a PARTIAL
 * resolution that reads as a complete one, which is the exact failure this project exists
 * to remove.
 */
export async function fetchLinkedNames(
  baseId: string,
  linkedTableId: string,
  primaryFieldName: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, string> | null> {
  const names = new Map<string, string>();
  let offset: string | undefined;
  let pages = 0;

  try {
    do {
      const url = new URL(
        `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(linkedTableId)}`,
      );
      url.searchParams.set('pageSize', '100');
      // Only the primary field: this is a NAME LOOKUP, and pulling whole client rows would
      // drag unrelated columns through the browser for no benefit.
      url.searchParams.append('fields[]', primaryFieldName);
      if (offset) url.searchParams.set('offset', offset);

      const res = await fetchImpl(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;

      const body = (await res.json()) as {
        records?: { id?: string; fields?: Record<string, unknown> }[];
        offset?: string;
      };
      if (!Array.isArray(body?.records)) return null;

      for (const r of body.records) {
        const v = r?.fields?.[primaryFieldName];
        // A blank primary field is NOT a name. Storing '' would resolve the id to an empty
        // string, which reads downstream as "no client" — the same falsy trap that emptied
        // the appointments page. Leave it unresolved instead.
        if (r?.id && typeof v === 'string' && v.trim() !== '') names.set(r.id, v.trim());
      }

      offset = body.offset;
      pages++;
      // A runaway cursor must not spin forever in a browser. 100 pages = 10,000 clients,
      // far past any real client list, so hitting it means the cursor is misbehaving.
      if (pages > 100) return null;
    } while (offset);

    return names;
  } catch {
    return null;
  }
}

/** ①+② together. Returns an empty resolution rather than null so callers need no branch. */
export async function resolveLinkedClientNames(
  baseId: string,
  tableName: string,
  fieldName: string,
  token: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<LinkResolution> {
  const empty: LinkResolution = { names: new Map(), linkedTableId: null };
  if (!token) return empty;

  const target = await findLinkTarget(baseId, tableName, fieldName, token, fetchImpl);
  if (!target) return empty;

  const names = await fetchLinkedNames(
    baseId, target.linkedTableId, target.primaryFieldName, token, fetchImpl,
  );
  if (!names) return { names: new Map(), linkedTableId: target.linkedTableId };

  return { names, linkedTableId: target.linkedTableId };
}

/**
 * Look up one value. Returns null when it is not a record id, or when the id is unknown —
 * both mean "the caller keeps doing exactly what it did before".
 */
export function resolveRecordId(value: string, names: Map<string, string>): string | null {
  if (!REC_ID.test(value)) return null;
  return names.get(value) ?? null;
}
