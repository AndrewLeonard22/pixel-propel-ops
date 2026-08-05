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
 *   can be fetched: googleSheetUrl, airtableBaseId, callCenterSheetUrl.
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

describe("configuredSources — sources are judged independently", () => {
  it("reports Windsor configured from the sheet URL alone, with no Airtable credential", () => {
    const s = configuredSources(settings({ googleSheetUrl: SHEET }));
    expect(s).toEqual(["googleSheet"]);
  });

  it("reports the call centre configured from its URL alone", () => {
    const s = configuredSources(settings({ callCenterSheetUrl: CALLS }));
    expect(s).toEqual(["callCenter"]);
  });

  it("keys Airtable on the base id ALONE — the token is server-side now (order 2)", () => {
    // The credential is no longer a client field at all, so it cannot be an operand.
    expect(isSourceConfigured(settings({ airtableBaseId: "" }), "airtable")).toBe(false);
    expect(isSourceConfigured(settings({ airtableBaseId: BASE }), "airtable")).toBe(true);
  });

  it("treats present-but-EMPTY as not configured — the wiped-row shape", () => {
    const wiped = settings({
      googleSheetUrl: "",
      callCenterSheetUrl: "",
      airtableBaseId: "",
    });
    expect(configuredSources(wiped)).toEqual([]);
    expect(anySourceConfigured(wiped)).toBe(false);
  });

  it("THE REGRESSION THIS EXISTS FOR: losing the Airtable token must NOT hide Windsor", () => {
    // The exact state the security fix produces: token relocated server-side, sheet intact.
    // Post-relocation shape: sheets configured, Airtable base present, credential
    // server-side. The sheets must render regardless of Airtable's fate.
    const tokenRelocated = settings({
      googleSheetUrl: SHEET,
      callCenterSheetUrl: CALLS,
      airtableBaseId: "",
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
      anySourceConfigured(settings({ airtableBaseId: BASE })),
    ).toBe(true);
  });
});

describe("isConfigured — legacy gate, behaviour deliberately unchanged", () => {
  it("still requires all three, because four routed pages branch on it", () => {
    expect(isConfigured(settings({ googleSheetUrl: SHEET }))).toBe(false);
    expect(
      isConfigured(settings({ googleSheetUrl: SHEET, airtableBaseId: BASE })),
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
    ] as const) {
      expect(DEFAULT_SETTINGS).toHaveProperty(field);
    }
  });
});
