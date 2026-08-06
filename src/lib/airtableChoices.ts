/**
 * Read the singleSelect CHOICES for a field, from the base's own schema.
 *
 * ⭐ WHY THIS EXISTS RATHER THAN A CONSTANT. The closed-won definition is now @andrew's to
 * set, and a control offering a list WE maintain is the same defect one level up: rename a
 * choice in Airtable and there is nowhere to tell us. @fable confirmed the Meta API works
 * with his token — it carries `schema.bases:read` — so the options can be his, live.
 *
 * ⚠️ SEPARATE MODULE ON PURPOSE. `airtableLinks.ts` already calls this endpoint for @anvil's
 * link resolver. Editing his file mid-flight is how two seats collide in one function; this
 * duplicates ~10 lines of fetch to avoid it. If the two ever need to share a schema fetch,
 * merge them deliberately rather than by whoever edits second.
 *
 * ⛔ DEGRADE, NEVER THROW. A 403 (token without the scope), a network failure, a renamed
 * field, a base id that does not exist — every one returns null, and null means "offer the
 * fallback list", never "there are no choices". A settings screen that cannot reach Airtable
 * must still be usable.
 */

export interface SelectChoicesResult {
  /** The choice names, in the order the base declares them. */
  choices: string[];
  /** True when these came from the live base rather than a fallback. */
  live: boolean;
}

interface MetaField {
  name?: string;
  type?: string;
  options?: { choices?: { name?: string }[] };
}
interface MetaTable {
  id?: string;
  name?: string;
  fields?: MetaField[];
}

/**
 * @param fetchImpl injected so the arms exercise the real parsing against real payload
 *        shapes, rather than mocking the function under test.
 */
export async function fetchSelectChoices(
  baseId: string,
  tableNameOrId: string,
  fieldName: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[] | null> {
  if (!baseId || !tableNameOrId || !fieldName || !token) return null;
  try {
    const res = await fetchImpl(
      `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(baseId)}/tables`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { tables?: MetaTable[] };
    if (!Array.isArray(body?.tables)) return null;

    const table = body.tables.find(t => t?.id === tableNameOrId || t?.name === tableNameOrId);
    const field = table?.fields?.find(f => f?.name === fieldName);
    if (!field || field.type !== 'singleSelect') return null;

    const names = (field.options?.choices ?? [])
      .map(c => c?.name)
      .filter((n): n is string => typeof n === 'string' && n.trim() !== '');

    // An empty choice list is not an answer — a singleSelect with no options is either a
    // parse miss or a field mid-edit. Fall back rather than render an empty control.
    return names.length > 0 ? names : null;
  } catch {
    return null;
  }
}

/**
 * ⭐ A TICKED STATUS THAT NO LONGER EXISTS IN THE BASE IS THE SAME ROT AS THE COLUMN DROPDOWN
 * — @fable. There, a saved-but-absent mapping rendered as "— Select —" and the first click
 * blanked it. Here the equivalent is worse and quieter: a status ticked as WON that Airtable
 * no longer has simply stops matching, and the closed-deal count drops with nothing on screen
 * to say why.
 *
 * ⇒ Returns the ticked values that are NOT among the live choices. Empty when we could not
 * reach the base — an ABSENCE OF CHOICES IS NOT EVIDENCE OF ABSENCE, and reporting "all 3 of
 * your statuses are missing" because a fetch failed would be the alarming-direction error.
 */
export function tickedButMissing(ticked: string[], liveChoices: string[] | null): string[] {
  if (!liveChoices || liveChoices.length === 0) return [];
  const norm = (s: string) => s.trim().toLowerCase();
  const live = new Set(liveChoices.map(norm));
  return ticked.filter(t => t.trim() !== '' && !live.has(norm(t)));
}
