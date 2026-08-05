import { describe, it, expect } from "vitest";
import { normalizeSourceDate } from "./dataService";

/**
 * POPULATION UNDER TEST
 *   The three date shapes that occur in real exports of this feed, plus refusal cases.
 *   Enumerated from the live source rather than imagined:
 *     - M/D/YYYY   583 distinct values on the derived tab, 0 in ISO
 *     - YYYY-MM-DD 581 distinct values on the raw tab, 581 of 581 ISO
 *     - serials    exactly 4 rows on the derived tab: one "45875" and three "45884",
 *                  which are the same underlying dates as the raw tab's 2025-08-06 and
 *                  2025-08-15 — cells that lost their number format, not corrupt values.
 *
 * THE ANCHOR THAT MAKES THE SERIAL CASE A REAL TEST
 *   Those two expected values are NOT obtained by running this code. They come from the
 *   raw tab, where the same rows read 2025-08-06 and 2025-08-15 in ISO, and from adjacent
 *   cells holding the identical stored value correctly formatted. An expected value that
 *   can only be produced by the function under test would pin the bug as the spec.
 */
describe("normalizeSourceDate", () => {
  it("passes ISO through unchanged", () => {
    expect(normalizeSourceDate("2026-08-04")).toBe("2026-08-04");
    expect(normalizeSourceDate("2025-01-01")).toBe("2025-01-01");
  });

  it("converts the derived tab's M/D/YYYY, including single-digit month and day", () => {
    expect(normalizeSourceDate("8/4/2026")).toBe("2026-08-04");
    expect(normalizeSourceDate("1/1/2025")).toBe("2025-01-01");
    expect(normalizeSourceDate("12/31/2025")).toBe("2025-12-31");
  });

  it("decodes Sheets serials to the SAME dates the raw tab holds for those rows", () => {
    // Independent source: raw tab rows for the four corrupted derived cells.
    expect(normalizeSourceDate("45875")).toBe("2025-08-06");
    expect(normalizeSourceDate("45884")).toBe("2025-08-15");
  });

  it("REFUSES rather than guessing, and never substitutes today", () => {
    for (const bad of ["", "   ", "banana", "2026-13-01", "13/45/2026", "2026/08/04", null, undefined]) {
      expect(normalizeSourceDate(bad as string)).toBe("");
    }
  });

  it("rejects a real-looking but nonexistent calendar date", () => {
    expect(normalizeSourceDate("2025-02-30")).toBe("");
    expect(normalizeSourceDate("2/30/2025")).toBe("");
  });

  it("bounds the serial range so a stray identifier is not read as a date", () => {
    expect(normalizeSourceDate("1")).toBe("");        // 1899 — not a plausible source date
    expect(normalizeSourceDate("999999")).toBe("");   // far future
    expect(normalizeSourceDate("120211643325640634")).toBe(""); // a campaign id
  });

  it("THE REGRESSION THIS EXISTS FOR: a serial must not become the YEAR 45884", () => {
    const out = normalizeSourceDate("45884");
    expect(out.startsWith("45884")).toBe(false);
    expect(out).toBe("2025-08-15");

    // ANTI-VACUITY CONTROL: the naive parse really does produce the far-future date, so
    // the assertion above is measuring this function and not a property of every parser.
    expect(new Date("45884").getUTCFullYear()).toBe(45884);
  });

  it("is idempotent — normalising twice equals normalising once", () => {
    for (const v of ["8/4/2026", "2026-08-04", "45884"]) {
      const once = normalizeSourceDate(v);
      expect(normalizeSourceDate(once)).toBe(once);
    }
  });
});
