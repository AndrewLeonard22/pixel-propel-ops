/**
 * ① THE SHEET CLIFF DETECTOR.
 *
 * @fable measured the cliff: the derived "Ads Data" tab is produced by an array formula
 * bounded at `'Ads - Raw'!A2:A39389`. Both tabs hold 38,944 rows today — 444 of headroom —
 * and Windsor appends ~58 rows/day on its own. It FREEZES around 2026-08-13 with nobody
 * having acted, and the dashboard keeps rendering a confident, permanently stale number.
 *
 * ⭐ RAISING THE RANGE IS NOT OURS — the bound lives inside @andrew's sheet and we have read
 * access only. THIS is the half that lasts: raising the range only moves the cliff, and a
 * future session rediscovers it in 2027. A divergence detector needs no constant, no
 * calendar and no knowledge of the formula, so it survives the sheet being edited in ways
 * we cannot predict.
 *
 * ══ COST, MEASURED BEFORE BUILDING, AS ORDERED ══
 *   full CSV export of a tab ....... the ~10MB fetch we already do once
 *   gviz `select count(A)` ......... 228 BYTES, HTTP 200, ~190ms — a NUMBER, not a payload
 * ⇒ two count probes per refresh is ~460 bytes. A second full download is not needed.
 *
 * ══ 🔴 AND THE MEASUREMENT THAT SHAPED THE WHOLE DESIGN ══
 * gviz FALLS BACK SILENTLY, and worse than @apprentice had established. Measured here:
 *   sheet=NONEXISTENT_TAB_XYZ  -> HTTP 200, the DEFAULT tab, byte-identical, same sig
 *   gid=99999999               -> HTTP 200, the DEFAULT tab, byte-identical, same sig
 * ⇒ ⛔ A MISADDRESSED TAB QUERY RETURNS THE OTHER TAB'S ANSWER. So a naive detector that
 *   compares two counts reports EQUAL — i.e. "complete" — exactly when it is blind. That is
 *   a fail-OPEN detector guarding the number @andrew makes spend decisions on.
 *
 * ══ ⭐ THE DECOMPOSITION THAT MAKES IT SOUND ══
 * The two arms do NOT need the same protection, and noticing that is what makes this
 * shippable in two requests:
 *
 *   TRUNCATED (raw > derived)  a fallback can ONLY ever produce EQUALITY, so an
 *                              inequality cannot be manufactured by a fallback.
 *                              ⇒ THE FIRING ARM IS SOUND WITH NO FALLBACK PROTECTION.
 *   COMPLETE  (raw = derived)  indistinguishable from "both queries hit one tab".
 *                              ⇒ requires POSITIVE PROOF the tabs are distinct.
 *
 * The proof is `sig`: measured to be a function of (tab content, query). With the query held
 * constant, a differing sig proves the two responses came from different data. A fallback
 * returns a byte-identical response, so sig CANNOT differ under one. Equal counts + equal
 * sig therefore stays UNVERIFIABLE rather than being called healthy — the conservative
 * direction, and the one that cannot tell @andrew his data is fine when we cannot see.
 */

export type CompletenessState =
  /** raw > derived: the derived tab is dropping rows RIGHT NOW. */
  | 'truncated'
  /** Proven distinct tabs, equal counts. The only state that means "all rows are here". */
  | 'complete'
  /** We could not prove the two probes read different tabs. NOT a clean bill of health. */
  | 'unverifiable';

export interface CompletenessReport {
  state: CompletenessState;
  rawRows: number | null;
  derivedRows: number | null;
  /** How many rows the derived tab is missing. Only meaningful when state is 'truncated'. */
  droppedRows: number;
  /** Why we could not verify, when state is 'unverifiable'. Never invented. */
  reason: string | null;
}

export interface CountProbe {
  count: number;
  /** gviz's table signature. Identical across two probes ⇒ identical data ⇒ same tab. */
  sig: string;
}

/** gviz wraps its JSON in `/*O_o*\/\ngoogle.visualization.Query.setResponse(...);` */
export function parseGvizCount(body: string): CountProbe | null {
  const m = body.match(/setResponse\(([\s\S]*)\)\s*;?\s*$/);
  if (!m) return null;
  try {
    const d = JSON.parse(m[1].trim().replace(/;$/, ''));
    if (d?.status !== 'ok') return null;
    const v = d?.table?.rows?.[0]?.c?.[0]?.v;
    if (typeof v !== 'number') return null;
    return { count: v, sig: String(d.sig ?? '') };
  } catch {
    return null;
  }
}

export function buildCountUrl(spreadsheetId: string, gid: string): string {
  // `count(A)` and NOT `count(*)`: gviz has no count(*), and column A is the one the array
  // formula's range is written against, so it is the column whose truncation we care about.
  return (
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq` +
    `?tqx=out:json&gid=${encodeURIComponent(gid)}&tq=${encodeURIComponent('select count(A)')}`
  );
}

/** Pull the spreadsheet id out of any Google Sheets URL. Returns '' when it is not one. */
export function spreadsheetIdOf(url: string): string {
  return url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1] ?? '';
}

/** The gid the app already reads its derived rows from — the same rule as convertSheetUrlToCsv. */
export function derivedGidOf(url: string): string {
  return url.match(/gid=(\d+)/)?.[1] ?? '0';
}

/**
 * Decide the state from two probes. Pure, so the whole truth table is testable without a
 * network — and the network half is one fetch of a documented shape.
 */
export function judgeCompleteness(
  raw: CountProbe | null,
  derived: CountProbe | null,
  reasonWhenMissing = 'the raw tab could not be read',
): CompletenessReport {
  if (!raw || !derived) {
    return {
      state: 'unverifiable',
      rawRows: raw?.count ?? null,
      derivedRows: derived?.count ?? null,
      droppedRows: 0,
      reason: reasonWhenMissing,
    };
  }

  // ⭐ INEQUALITY FIRST, AND DELIBERATELY BEFORE THE SIG CHECK. A fallback can only produce
  // equality, so raw > derived is trustworthy on its own — gating it behind a
  // distinct-tabs proof would make the detector silent in the exact case it exists for.
  if (raw.count > derived.count) {
    return {
      state: 'truncated',
      rawRows: raw.count,
      derivedRows: derived.count,
      droppedRows: raw.count - derived.count,
      reason: null,
    };
  }

  // derived > raw is not truncation — it means the two probes are not measuring what we
  // think, so it is a reason to distrust the pair rather than to report health.
  if (derived.count > raw.count) {
    return {
      state: 'unverifiable',
      rawRows: raw.count,
      derivedRows: derived.count,
      droppedRows: 0,
      reason: 'the derived tab reports MORE rows than the raw tab, which should be impossible',
    };
  }

  if (raw.sig === derived.sig) {
    return {
      state: 'unverifiable',
      rawRows: raw.count,
      derivedRows: derived.count,
      droppedRows: 0,
      reason:
        'both probes returned identical data, so they may have read the same tab — ' +
        'Google Sheets answers an unknown tab with the default tab and HTTP 200',
    };
  }

  return { state: 'complete', rawRows: raw.count, derivedRows: derived.count, droppedRows: 0, reason: null };
}

/** The one user-facing sentence. Numberless states say so rather than printing a zero. */
export function completenessMessage(r: CompletenessReport): string | null {
  if (r.state === 'complete') return null;
  if (r.state === 'truncated') {
    return (
      `Ad spend is INCOMPLETE: the sheet's derived tab is dropping ${r.droppedRows.toLocaleString()} ` +
      `of ${r.rawRows?.toLocaleString()} rows. Every total below is missing that data. ` +
      `The array formula's range in the Google Sheet needs raising.`
    );
  }
  return `Ad spend completeness could not be verified — ${r.reason}. Totals may be incomplete.`;
}

/**
 * Fetch both probes. NEVER THROWS and never blocks a render: @fable's contract is explicit
 * that incomplete data with an honest banner beats a blank page, so every failure resolves
 * to 'unverifiable' rather than propagating.
 */
export async function checkSheetCompleteness(
  sheetUrl: string,
  rawGid: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<CompletenessReport> {
  const id = spreadsheetIdOf(sheetUrl || '');
  if (!id) return judgeCompleteness(null, null, 'the ad spend sheet URL is not a Google Sheets link');

  const derivedGid = derivedGidOf(sheetUrl);
  if (!rawGid) {
    return judgeCompleteness(null, null, 'the raw tab has not been identified in Settings');
  }
  if (rawGid === derivedGid) {
    return judgeCompleteness(null, null, 'the raw tab and the derived tab are configured as the same tab');
  }

  const probe = async (gid: string): Promise<CountProbe | null> => {
    try {
      const res = await fetchImpl(buildCountUrl(id, gid));
      if (!res.ok) return null;
      return parseGvizCount(await res.text());
    } catch {
      return null;
    }
  };

  const [raw, derived] = await Promise.all([probe(rawGid), probe(derivedGid)]);
  return judgeCompleteness(raw, derived);
}
