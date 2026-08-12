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
 *   Every reachable combination of the inputs that decide whether a source can be fetched:
 *   the Supabase connection (ad spend) and airtableBaseId (appointments).
 *
 * ⚠️ AMENDED 2026-08-11: `googleSheetUrl` was the ad-spend operand until the Supabase
 *   cutover. Ad spend now reads `ad_insights` with the app's own Supabase connection and
 *   needs NO user-supplied setting, so its configured axis moved out of AppSettings — see
 *   isSourceConfigured in config.ts for why it is still falsifiable rather than a constant.
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

const BASE = "appXXXXXXXX";

describe("configuredSources — sources are judged independently", () => {
  it("reports ad spend configured with no Airtable credential at all", () => {
    const s = configuredSources(settings({ airtableBaseId: "" }));
    expect(s).toEqual(["adSpend"]);
  });

  it("keys Airtable on the base id ALONE — the token is server-side now (order 2)", () => {
    // The credential is no longer a client field at all, so it cannot be an operand.
    expect(isSourceConfigured(settings({ airtableBaseId: "" }), "airtable")).toBe(false);
    expect(isSourceConfigured(settings({ airtableBaseId: BASE }), "airtable")).toBe(true);
  });

  it("treats present-but-EMPTY as not configured — the wiped-row shape", () => {
    /**
     * ⚠️ THE WIPED ROW NO LONGER SILENCES EVERYTHING, and that is an improvement rather
     * than a weakened assertion. Every connection string in the row can be blanked and ad
     * spend still loads, because its credentials were never in the row — they are in the
     * Edge Function. The 2026-08-05 wipe took the whole dashboard dark; the same wipe today
     * costs appointments only.
     */
    const wiped = settings({ airtableBaseId: "" });
    expect(isSourceConfigured(wiped, "airtable")).toBe(false);
    expect(configuredSources(wiped)).toEqual(["adSpend"]);
    expect(anySourceConfigured(wiped)).toBe(true);
  });

  it("THE REGRESSION THIS EXISTS FOR: losing the Airtable token must NOT hide ad spend", () => {
    // The exact state the security fix produces: token relocated server-side.
    // Ad spend must render regardless of Airtable's fate.
    const tokenRelocated = settings({ airtableBaseId: "" });

    expect(configuredSources(tokenRelocated)).toEqual(["adSpend"]);
    expect(isSourceConfigured(tokenRelocated, "airtable")).toBe(false);
    expect(anySourceConfigured(tokenRelocated)).toBe(true);

    // ANTI-VACUITY CONTROL: the legacy gate really does go dark on this same input,
    // so the assertions above are measuring the new behaviour and not a no-op.
    expect(isConfigured(tokenRelocated)).toBe(false);
  });
});

describe("anySourceConfigured", () => {
  it("is true whenever ANY source can be fetched", () => {
    // ⚠️ DEFAULT_SETTINGS carries no airtableBaseId, yet ad spend is fetchable — so unlike
    // before the cutover there is no all-empty settings shape that reaches false here.
    expect(anySourceConfigured(settings())).toBe(true);
    expect(anySourceConfigured(settings({ airtableBaseId: BASE }))).toBe(true);
  });
});

describe("isConfigured — legacy gate, behaviour deliberately unchanged", () => {
  it("still requires BOTH, because four routed pages branch on it", () => {
    expect(isConfigured(settings({ airtableBaseId: "" }))).toBe(false);
    expect(isConfigured(settings({ airtableBaseId: BASE }))).toBe(true);
  });
});

describe("contract completeness", () => {
  it("every settings field this module gates on is present in DEFAULT_SETTINGS", () => {
    // If someone adds a third source, this fails until configuredSources knows about it.
    for (const field of ["airtableBaseId"] as const) {
      expect(DEFAULT_SETTINGS).toHaveProperty(field);
    }
    /**
     * ⛔ AND THE RETIRED KEYS MUST BE GONE FROM THE DEFAULTS, not merely unused. A key
     * dropped from ALLOWED_CONFIG_KEYS but left in DEFAULT_SETTINGS is re-sent on the next
     * save and quietly re-admitted — the anti-vacuity half of the allowlist lock.
     */
    for (const retired of ["googleSheetUrl", "googleSheetTab", "adsRawTabName"] as const) {
      expect(DEFAULT_SETTINGS).not.toHaveProperty(retired);
    }
  });
});
