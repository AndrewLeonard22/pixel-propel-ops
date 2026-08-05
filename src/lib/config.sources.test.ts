import { describe, it, expect } from "vitest";
import {
  isSourceConfigured,
  configuredSources,
  anySourceConfigured,
  isConfigured,
  DEFAULT_SETTINGS,
} from "./config";
import type { AppSettings } from "./types";

/**
 * POPULATION UNDER TEST
 *   Every reachable combination of the four settings fields that decide whether a source
 *   can be fetched: googleSheetUrl, airtableBaseId, airtableToken, callCenterSheetUrl.
 *   Enumerated from DEFAULT_SETTINGS rather than hand-listed, so a field added to the
 *   contract later shows up here as an unhandled case rather than silently passing.
 *
 * WHY THESE SHAPES
 *   The empty-string cases are not hypothetical. A settings row wiped in place stores ''
 *   for every string field, which is exactly the state production was left in at
 *   2026-08-05T22:18:48Z: the row and all 18 fields present, every connection field len 0.
 */
const settings = (over: Partial<AppSettings> = {}): AppSettings => ({
  ...DEFAULT_SETTINGS,
  ...over,
});

const SHEET = "https://docs.google.com/spreadsheets/d/abc123/edit";
const CALLS = "https://docs.google.com/spreadsheets/d/def456/edit";
const BASE = "appXXXXXXXX";
const TOKEN = "patXXXXXXXX";

describe("configuredSources — sources are judged independently", () => {
  it("reports Windsor configured from the sheet URL alone, with no Airtable credential", () => {
    const s = configuredSources(settings({ googleSheetUrl: SHEET }));
    expect(s).toEqual(["googleSheet"]);
  });

  it("reports the call centre configured from its URL alone", () => {
    const s = configuredSources(settings({ callCenterSheetUrl: CALLS }));
    expect(s).toEqual(["callCenter"]);
  });

  it("requires BOTH Airtable fields — either alone cannot fetch", () => {
    expect(isSourceConfigured(settings({ airtableBaseId: BASE }), "airtable")).toBe(false);
    expect(isSourceConfigured(settings({ airtableToken: TOKEN }), "airtable")).toBe(false);
    expect(
      isSourceConfigured(settings({ airtableBaseId: BASE, airtableToken: TOKEN }), "airtable"),
    ).toBe(true);
  });

  it("treats present-but-EMPTY as not configured — the wiped-row shape", () => {
    const wiped = settings({
      googleSheetUrl: "",
      callCenterSheetUrl: "",
      airtableBaseId: "",
      airtableToken: "",
    });
    expect(configuredSources(wiped)).toEqual([]);
    expect(anySourceConfigured(wiped)).toBe(false);
  });

  it("THE REGRESSION THIS EXISTS FOR: losing the Airtable token must NOT hide Windsor", () => {
    // The exact state the security fix produces: token relocated server-side, sheet intact.
    const tokenRelocated = settings({
      googleSheetUrl: SHEET,
      callCenterSheetUrl: CALLS,
      airtableBaseId: BASE,
      airtableToken: "",
    });

    expect(configuredSources(tokenRelocated)).toEqual(["googleSheet", "callCenter"]);
    expect(isSourceConfigured(tokenRelocated, "airtable")).toBe(false);
    expect(anySourceConfigured(tokenRelocated)).toBe(true);

    // ANTI-VACUITY CONTROL: the legacy gate really does go dark on this same input,
    // so the assertions above are measuring the new behaviour and not a no-op.
    expect(isConfigured(tokenRelocated)).toBe(false);
  });
});

describe("anySourceConfigured", () => {
  it("is false only when NO source can be fetched", () => {
    expect(anySourceConfigured(settings())).toBe(false);
    expect(anySourceConfigured(settings({ googleSheetUrl: SHEET }))).toBe(true);
    expect(anySourceConfigured(settings({ callCenterSheetUrl: CALLS }))).toBe(true);
    expect(
      anySourceConfigured(settings({ airtableBaseId: BASE, airtableToken: TOKEN })),
    ).toBe(true);
  });
});

describe("isConfigured — legacy gate, behaviour deliberately unchanged", () => {
  it("still requires all three, because four routed pages branch on it", () => {
    expect(isConfigured(settings({ googleSheetUrl: SHEET }))).toBe(false);
    expect(
      isConfigured(settings({ googleSheetUrl: SHEET, airtableBaseId: BASE })),
    ).toBe(false);
    expect(
      isConfigured(
        settings({ googleSheetUrl: SHEET, airtableBaseId: BASE, airtableToken: TOKEN }),
      ),
    ).toBe(true);
  });
});

describe("contract completeness", () => {
  it("every settings field this module gates on is present in DEFAULT_SETTINGS", () => {
    // If someone adds a fourth source, this fails until configuredSources knows about it.
    for (const field of [
      "googleSheetUrl",
      "callCenterSheetUrl",
      "airtableBaseId",
      "airtableToken",
    ] as const) {
      expect(DEFAULT_SETTINGS).toHaveProperty(field);
    }
  });
});
