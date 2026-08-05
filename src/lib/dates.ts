/**
 * THE SINGLE DATE PARSER. Item ⑤.
 *
 * WHY THIS FILE EXISTS: there are six copies of `parseDateSafe` across the page files
 * and four of them are NOT equivalent — they disagree by one calendar day on ISO input.
 * Every one of them is also wrong about Google Sheets serials. Normalising once, at the
 * boundary, is the only version of this fix that stays fixed.
 *
 * ═══ THE THREE SHAPES THAT ACTUALLY OCCUR, MEASURED ═══
 *   DERIVED tab (what the app reads today): 581/581 distinct dates are M/D/YYYY,
 *                                           plus 4 rows carrying Sheets serials
 *   RAW tab (where ③ wants to repoint):     581/581 distinct dates are ISO YYYY-MM-DD
 *
 * ⚠️ THAT IS THE WHOLE RISK IN ③: the app sees ZERO ISO dates today and would see 581
 * after the repoint — landing squarely on the format the existing parsers get wrong.
 * Consolidate onto this module BEFORE repointing, or the repoint moves every date by
 * a day without any error.
 *
 * ═══ THE ISO ONE-DAY BUG ═══
 *   new Date('2026-08-04')  -> UTC midnight   -> renders as 2026-08-03 west of UTC
 *   new Date('8/4/2026')    -> LOCAL midnight -> renders as 2026-08-04
 * Verified in America/Phoenix. A date-only string denotes a CALENDAR DAY, not an
 * instant, so it must be built in local time. That is what this module does.
 */

/** Google Sheets / Excel serial epoch. Day 1 is 1899-12-31, so day 0 is 1899-12-30. */
const SHEETS_EPOCH_UTC = Date.UTC(1899, 11, 30);

/**
 * Serial values we will decode. Bounded deliberately: an unbounded numeric branch would
 * swallow a bare year like "2026" and silently decode it to 1905.
 *
 * ⚠️ THESE MUST MATCH `normalizeSourceDate` IN dataService.ts (@anvil). They are the same
 * decision made in two places, and `dates.differential.test.ts` fails if they drift.
 * That test earned its keep immediately: my first bound was 20000..60000, which disagreed
 * with the boundary normaliser at BOTH ends (36525 and 60001..73050) — a disagreement
 * invisible to the live feed, because no such value occurs in it today.
 *
 *   36526 -> 2000-01-01      73050 -> 2099-12-31
 */
const SERIAL_MIN = 36526;
const SERIAL_MAX = 73050;

const MDY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+.*)?$/;
const ISO_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const SERIAL = /^\d{4,6}$/;

/** Build a local-midnight Date. Rejects impossible calendar dates (e.g. 2/30). */
function localDate(year: number, month1: number, day: number): Date | null {
  if (month1 < 1 || month1 > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month1 - 1, day);
  // Reject rollover: new Date(2025, 1, 30) silently becomes March 2nd.
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month1 - 1 ||
    d.getDate() !== day
  ) {
    return null;
  }
  return d;
}

/** True when the string is a Sheets serial we are willing to decode. */
export function isSheetsSerial(value: string): boolean {
  if (!SERIAL.test(value)) return false;
  const n = Number(value);
  return n >= SERIAL_MIN && n <= SERIAL_MAX;
}

/**
 * Parse any date shape the sources actually emit into a LOCAL-midnight Date.
 * Returns null for empty, unparseable, or out-of-range input — never an Invalid Date,
 * and never a far-future date from a mis-parsed serial.
 */
export function parseSourceDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;

  const mdy = v.match(MDY);
  if (mdy) return localDate(+mdy[3], +mdy[1], +mdy[2]);

  const iso = v.match(ISO_DATE_ONLY);
  // LOCAL, not UTC — this is the one-day fix.
  if (iso) return localDate(+iso[1], +iso[2], +iso[3]);

  if (ISO_DATETIME.test(v)) {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  if (isSheetsSerial(v)) {
    // Serial -> UTC ms -> local calendar day, so it lands on the same day the
    // spreadsheet displays rather than shifting across the timezone offset.
    const utc = new Date(SHEETS_EPOCH_UTC + Number(v) * 86400000);
    return localDate(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
  }

  return null;
}

/** Local calendar day as YYYY-MM-DD. The canonical comparable form. */
export function toIsoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * THE BOUNDARY NORMALISER. Apply once, where rows enter the app, so everything
 * downstream compares YYYY-MM-DD strings (which sort and compare correctly) or Dates —
 * never raw M/D/YYYY, which sorts "10/1" before "9/1".
 */
export function normaliseSourceDay(value: unknown): string | null {
  const d = parseSourceDate(value);
  return d ? toIsoDay(d) : null;
}

/** Same calendar day, timezone-safe. */
export function isSameDay(a: Date, b: Date): boolean {
  return toIsoDay(a) === toIsoDay(b);
}
