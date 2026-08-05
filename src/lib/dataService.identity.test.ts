import { describe, it, expect } from "vitest";
import {
  accountKey,
  classifyAccountLabel,
  adSpendRowKey,
  dedupeAdSpendRows,
} from "./dataService";
import { makeAdSpendRow } from "@/test/factories";

/**
 * POPULATION UNDER TEST
 *   The three things the untyped `Account Name` column actually holds, measured on the
 *   live feed rather than imagined:
 *     human names        57 of 61 labels
 *     Meta account ids   4 of 61 — "10170221, USD", "222178771, USD",
 *                        "103578393327348, USD", "391432983081972, USD"
 *     whitespace twins   2 pairs — "Co-Lights " / "Co-Lights",
 *                        "Trimlight Phoenix " / "Trimlight Phoenix"
 *   plus the composite row key and the dedup that consumes it.
 */
describe("accountKey — collapses the whitespace twins the feed actually contains", () => {
  it("trims and lowercases, so a trailing-space twin is ONE account not two", () => {
    expect(accountKey("Co-Lights ")).toBe(accountKey("Co-Lights"));
    expect(accountKey("Trimlight Phoenix ")).toBe(accountKey("Trimlight Phoenix"));
    expect(accountKey("  Backyard Paradiso  ")).toBe("backyard paradiso");
  });

  it("does NOT merge genuinely different accounts", () => {
    expect(accountKey("Green Plus")).not.toBe(accountKey("SW |Green Plus"));
    expect(accountKey("Publicity 1")).not.toBe(accountKey("Washbroz X SocialWorks"));
  });

  it("handles absent values without inventing one", () => {
    expect(accountKey(undefined)).toBe("");
    expect(accountKey(null)).toBe("");
  });
});

describe("classifyAccountLabel — an id-form label is a PREDICTION that history will split", () => {
  it("recognises the four real id-form labels and extracts the Meta account id", () => {
    for (const [label, id] of [
      ["10170221, USD", "10170221"],
      ["222178771, USD", "222178771"],
      ["103578393327348, USD", "103578393327348"],
      ["391432983081972, USD", "391432983081972"],
    ] as const) {
      const c = classifyAccountLabel(label);
      expect(c.kind).toBe("meta-account-id");
      expect(c.metaAccountId).toBe(id);
    }
  });

  it("classifies ordinary names as names — including ones containing digits", () => {
    for (const name of [
      "Backyard Paradiso",
      "Publicity 1",
      "ApexCleaningC0",
      "SW |Green Plus",
      "FB Pressure Washing LLC",
    ]) {
      expect(classifyAccountLabel(name).kind).toBe("name");
      expect(classifyAccountLabel(name).metaAccountId).toBeUndefined();
    }
  });

  it("does not mistake a short number or a bare id for the id-form", () => {
    // The pattern requires "<digits>, <CUR>" — a campaign id alone is not an account label.
    expect(classifyAccountLabel("120211643325640634").kind).toBe("name");
    expect(classifyAccountLabel("123, USD").kind).toBe("name"); // too short to be an account id
  });
});

describe("adSpendRowKey — deterministic composite identity", () => {
  it("is stable across the two date renderings of the SAME day", () => {
    const a = makeAdSpendRow({ date: "8/4/2026", dateISO: "2026-08-04" });
    const b = makeAdSpendRow({ date: "2026-08-04", dateISO: "2026-08-04" });
    expect(adSpendRowKey(a)).toBe(adSpendRowKey(b));
  });

  it("separates rows that differ on ANY key component", () => {
    const base = makeAdSpendRow();
    for (const over of [
      { dateISO: "2026-08-05" },
      { accountName: "Someone Else" },
      { campaignId: "999" },
      { adsetId: "999" },
      { adId: "999" },
    ]) {
      expect(adSpendRowKey(makeAdSpendRow(over))).not.toBe(adSpendRowKey(base));
    }
  });

  it("treats the whitespace twins as the SAME row", () => {
    expect(adSpendRowKey(makeAdSpendRow({ accountName: "Co-Lights " }))).toBe(
      adSpendRowKey(makeAdSpendRow({ accountName: "Co-Lights" })),
    );
  });
});

describe("dedupeAdSpendRows", () => {
  it("IS BEHAVIOUR-NEUTRAL on distinct rows — the live feed's state today", () => {
    const rows = [
      makeAdSpendRow({ dateISO: "2026-08-01" }),
      makeAdSpendRow({ dateISO: "2026-08-02" }),
      makeAdSpendRow({ dateISO: "2026-08-03" }),
    ];
    const r = dedupeAdSpendRows(rows);
    expect(r.rows).toHaveLength(3);
    expect(r.removed).toEqual([]);
  });

  it("removes an exact duplicate AND ENUMERATES it — a count would hide which account", () => {
    const dup = makeAdSpendRow({ accountName: "Backyard Paradiso" });
    const r = dedupeAdSpendRows([dup, { ...dup }, makeAdSpendRow({ adId: "other" })]);

    expect(r.rows).toHaveLength(2);
    expect(r.removed).toHaveLength(1);
    // The VALUES, not just the tally: only these can say the exclusion was correct.
    expect(r.removed[0].accountName).toBe("Backyard Paradiso");
    expect(r.removed[0].date).toBe("2026-08-04");
  });

  it("keeps the FIRST occurrence, so dedup never changes which row survives", () => {
    const a = makeAdSpendRow({ spent: 111 });
    const b = makeAdSpendRow({ spent: 222 }); // same key, different money
    const r = dedupeAdSpendRows([a, b]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].spent).toBe(111);
  });

  it("ANTI-VACUITY CONTROL: an empty input yields an empty result, not a crash", () => {
    expect(dedupeAdSpendRows([])).toEqual({ rows: [], removed: [] });
  });
});
