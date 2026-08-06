import { describe, it, expect } from "vitest";
import { detectExclusionState, exclusionsAreLying } from "./dataService";
import { makeAdSpendRow, makeSettings } from "@/test/factories";

/**
 * POPULATION UNDER TEST
 *   The three states the exclusion list can be in, and the one that must NOT warn.
 *
 * WHY THIS EXISTS — @andrew ACCEPTED THE LOSS, SO THE SOFTWARE MUST NOT LIE ABOUT IT
 *   The 32 excluded campaigns are gone and are not coming back. That makes
 *   performanceSpend === totalSpend permanent, which makes every cost-per-lead and
 *   cost-per-appointment on the dashboard inflated — computed across the exact campaigns
 *   that were excluded FOR burning spend without leads. Nothing on screen says so.
 *
 * ⚠️ THE CONTROL ARM IS THE POINT, NOT A COURTESY. A detector that fires on a healthy
 *   config is decoration, and the fastest way to get a warning ignored is to show it when
 *   nothing is wrong. "active" is asserted here as hard as the failures are.
 */
const SPEND = [
  makeAdSpendRow({ accountName: "Acme", campaignId: "c1", spent: 100 }),
  makeAdSpendRow({ accountName: "Acme", campaignId: "c2", spent: 250 }),
  makeAdSpendRow({ accountName: "Beta", campaignId: "c3", spent: 400 }),
];

describe("detectExclusionState — three states, because the symptom is ambiguous", () => {
  it("① THE POST-WIPE STATE: nothing configured, every number unfiltered", () => {
    const r = detectExclusionState(SPEND, makeSettings({ excludedCampaigns: [] }));

    expect(r.state).toBe("none-configured");
    expect(r.configuredCount).toBe(0);
    expect(r.unfilteredSpend).toBe(750);
    // NAMED, not counted — a tally cannot be judged and these go on screen.
    expect(r.affectedAccounts).toEqual(["Acme", "Beta"]);
    expect(exclusionsAreLying(r)).toBe(true);
  });

  it("② CONFIGURED BUT INERT: stale ids filter nothing, and it is a DIFFERENT message", () => {
    const r = detectExclusionState(
      SPEND,
      makeSettings({ excludedCampaigns: ["gone-1", "gone-2"] }),
    );

    expect(r.state).toBe("configured-but-inert");
    expect(r.configuredCount).toBe(2);
    expect(r.matchedCount).toBe(0);
    expect(exclusionsAreLying(r)).toBe(true);
  });

  it("③ CONTROL ARM — a working config MUST NOT WARN", () => {
    const r = detectExclusionState(SPEND, makeSettings({ excludedCampaigns: ["c2"] }));

    expect(r.state).toBe("active");
    expect(r.matchedCount).toBe(1);
    expect(exclusionsAreLying(r)).toBe(false);
    // Nothing is leaking into CPL, so there is nothing to name.
    expect(r.affectedAccounts).toEqual([]);
  });

  it("③b CONTROL: an excluded campaign that spent NOTHING is still a working config", () => {
    // performanceSpend === totalSpend here too — the symptom @fable named is present and
    // the config is fine. A detector keyed on that equality alone would cry wolf.
    const zeroSpend = [
      ...SPEND,
      makeAdSpendRow({ accountName: "Acme", campaignId: "junk", spent: 0 }),
    ];
    const r = detectExclusionState(zeroSpend, makeSettings({ excludedCampaigns: ["junk"] }));

    expect(r.state).toBe("active");
    expect(exclusionsAreLying(r)).toBe(false);
  });

  it("ignores blank and whitespace ids — ' ' is not a configured exclusion", () => {
    const r = detectExclusionState(SPEND, makeSettings({ excludedCampaigns: ["", "  "] }));

    expect(r.configuredCount).toBe(0);
    expect(r.state).toBe("none-configured");
  });

  it("matches ids with surrounding whitespace, as the real filter does", () => {
    const padded = [makeAdSpendRow({ accountName: "Acme", campaignId: " c1 ", spent: 100 })];
    const r = detectExclusionState(padded, makeSettings({ excludedCampaigns: ["c1"] }));

    expect(r.state).toBe("active");
  });

  it("names only accounts with real spend — a zero-spend account has no inflated CPL", () => {
    const mixed = [
      makeAdSpendRow({ accountName: "HasSpend", campaignId: "x", spent: 500 }),
      makeAdSpendRow({ accountName: "NoSpend", campaignId: "y", spent: 0 }),
    ];
    const r = detectExclusionState(mixed, makeSettings({ excludedCampaigns: [] }));

    expect(r.affectedAccounts).toEqual(["HasSpend"]);
  });

  it("absent settings are treated as nothing configured, not as a crash", () => {
    const r = detectExclusionState(SPEND, undefined);

    expect(r.state).toBe("none-configured");
    expect(exclusionsAreLying(r)).toBe(true);
  });

  it("ANTI-VACUITY CONTROL: an empty feed does not manufacture affected accounts", () => {
    const r = detectExclusionState([], makeSettings({ excludedCampaigns: [] }));

    expect(r.affectedAccounts).toEqual([]);
    expect(r.unfilteredSpend).toBe(0);
  });
});
