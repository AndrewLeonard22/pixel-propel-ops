import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSettings } from "@/test/factories";
import type { AppSettings } from "./types";

/**
 * POPULATION UNDER TEST
 *   The 3 protected scalars and 4 protected lists that saveSettings can destroy, across the
 *   transitions that matter — populated→blank, populated→populated, blank→populated, and
 *   the whole-object DEFAULT_SETTINGS write — PLUS the call site, driven for real.
 *
 * WHY THE CALL SITE IS DRIVEN AND NOT ASSUMED
 *   detectClobber and isClobber are pure. Every assertion about them stays GREEN if
 *   saveSettings never calls them, which is the exact shape of a guard that ships doing
 *   nothing. So the last two blocks drive saveSettings itself through a stubbed database
 *   and assert on what reached the row. Sabotage S4 below removes the call and ONLY those
 *   blocks go red — which is the measurement that the pure tests could not make.
 *
 * WHY THIS EXISTS — MEASURED, NOT IMAGINED
 *   At 2026-08-05T22:18:48Z one write replaced the shared settings row with values
 *   indistinguishable from DEFAULT_SETTINGS: googleSheetUrl, callCenterSheetUrl and
 *   airtableBaseId blanked, 32 excluded campaigns / 4 inactive setters / 6 setter bonus
 *   rates emptied — no error, no warning. saveSettings is a FULL-OBJECT REPLACE and
 *   component state is stale for the window between useData's synchronous localStorage
 *   read and its asynchronous DB read, so one click inside that window is enough.
 *
 * ⚠️ SCOPE — READ BEFORE TRUSTING THIS
 *   This is a CLIENT-side guard. It cannot stop another tab, another browser, curl, or the
 *   Supabase console. The durable fix is the DB trigger (order ②), which is NOT YET
 *   APPLIED; until it is, this is the only thing between a stale render and the row.
 *
 * SABOTAGE PROOF — 5 arms, each anchor asserted UNIQUE, each edit md5-verified to have
 * landed (an edit that silently misses reports GREEN and reads exactly like a pass), each
 * run unpiped so $? is vitest's. Restore returned the clean md5 and 14/14.
 *
 *   S1  threshold >= 2 → >= 1        3 RED   refuses legitimate single-field edits
 *   S2  threshold >= 2 → >= 99       5 RED   guard defined, can never trip
 *   S3  list axis blinded            3 RED   only scalars register
 *   S4  guard never CALLED           3 RED   ← and all 8 pure tests stayed GREEN
 *   S5  .trim() dropped              1 RED   "   " counts as configured
 *
 * S4 is the load-bearing one. It is the shape of a guard that ships doing nothing, and the
 * eight pure assertions cannot see it — only the driven call site can.
 */
const db = vi.hoisted(() => ({
  current: null as AppSettings | null,
  upserts: [] as Array<{ key: string; value: unknown }>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: db.current ? { value: db.current } : null,
            error: null,
          }),
        }),
      }),
      upsert: async (row: { key: string; value: unknown }) => {
        db.upserts.push({ key: row.key, value: row.value });
        return { error: null };
      },
    }),
  },
}));

const { detectClobber, isClobber, saveSettings, DEFAULT_SETTINGS } = await import("./config");

/** The row as it stood before the incident: every protected field carrying real content. */
const POPULATED = makeSettings({
  googleSheetUrl: "https://docs.google.com/spreadsheets/d/S/edit",
  callCenterSheetUrl: "https://docs.google.com/spreadsheets/d/C/edit",
  airtableBaseId: "appREAL",
  excludedCampaigns: ["c1", "c2", "c3"],
  inactiveSetters: ["Bob"],
  setterBonusRates: [{ setterName: "Bob", rate: 10 }],
  accountAliases: [
    {
      sheetName: "A",
      airtableName: "A",
      program: "Done For You",
      mediaBuyer: "M",
      status: "Active",
    },
  ],
});

beforeEach(() => {
  db.current = null;
  db.upserts = [];
  localStorage.clear();
});

describe("detectClobber — names WHAT would be lost, never just how much", () => {
  it("THE INCIDENT: a DEFAULT_SETTINGS write over a populated row is a clobber", () => {
    const r = detectClobber(POPULATED, { ...DEFAULT_SETTINGS });

    expect(r.blankedScalars).toEqual([
      "googleSheetUrl",
      "callCenterSheetUrl",
      "airtableBaseId",
    ]);
    expect(r.emptiedLists).toEqual([
      "excludedCampaigns",
      "setterBonusRates",
      "inactiveSetters",
      "accountAliases",
    ]);
    expect(isClobber(r)).toBe(true);
  });

  it("ALLOWS a single deliberate clear — an edit is not an accident", () => {
    const r = detectClobber(POPULATED, makeSettings({ ...POPULATED, callCenterSheetUrl: "" }));

    expect(r.blankedScalars).toEqual(["callCenterSheetUrl"]);
    expect(isClobber(r)).toBe(false); // one loss is an edit; two is the signature of a clobber
  });

  it("ALLOWS emptying exactly one list — same reason", () => {
    const r = detectClobber(POPULATED, makeSettings({ ...POPULATED, excludedCampaigns: [] }));

    expect(r.emptiedLists).toEqual(["excludedCampaigns"]);
    expect(isClobber(r)).toBe(false);
  });

  it("ALLOWS ordinary edits that change values without destroying them", () => {
    const r = detectClobber(
      POPULATED,
      makeSettings({
        ...POPULATED,
        googleSheetUrl: "https://docs.google.com/spreadsheets/d/NEW/edit",
        excludedCampaigns: ["c1", "c2", "c3", "c4"],
      }),
    );

    expect(r).toEqual({ blankedScalars: [], emptiedLists: [] });
    expect(isClobber(r)).toBe(false);
  });

  it("ALLOWS a first-time save — nothing is destroyed when nothing was set", () => {
    const r = detectClobber({ ...DEFAULT_SETTINGS }, POPULATED);

    expect(r).toEqual({ blankedScalars: [], emptiedLists: [] });
    expect(isClobber(r)).toBe(false);
  });

  it("does not fire when the current row is unreadable — it cannot know, so it allows", () => {
    // Refusing on an absent current row would turn one DB hiccup into a save that never works.
    const r = detectClobber(null, { ...DEFAULT_SETTINGS });

    expect(r).toEqual({ blankedScalars: [], emptiedLists: [] });
    expect(isClobber(r)).toBe(false);
  });

  it("treats whitespace-only as blank — '   ' is not a configured sheet URL", () => {
    const r = detectClobber(
      POPULATED,
      makeSettings({ ...POPULATED, googleSheetUrl: "   ", airtableBaseId: "" }),
    );

    expect(r.blankedScalars).toEqual(["googleSheetUrl", "airtableBaseId"]);
    expect(isClobber(r)).toBe(true);
  });

  it("ANTI-VACUITY CONTROL: an identical save reports NOTHING lost", () => {
    expect(detectClobber(POPULATED, POPULATED)).toEqual({
      blankedScalars: [],
      emptiedLists: [],
    });
  });
});

describe("saveSettings — the guard is WIRED IN, not merely defined", () => {
  it("REFUSES the incident write and NOTHING reaches the database", async () => {
    db.current = POPULATED;

    await expect(saveSettings({ ...DEFAULT_SETTINGS })).rejects.toThrow(/Refusing to save/);

    expect(db.upserts).toEqual([]); // the row is untouched — the whole point
  });

  it("REFUSES before touching localStorage, so the local copy survives too", async () => {
    db.current = POPULATED;
    localStorage.setItem("socialworks_settings", JSON.stringify(POPULATED));

    await expect(saveSettings({ ...DEFAULT_SETTINGS })).rejects.toThrow();

    const local = JSON.parse(localStorage.getItem("socialworks_settings") ?? "{}");
    expect(local.googleSheetUrl).toBe(POPULATED.googleSheetUrl);
  });

  it("the refusal NAMES the fields at risk — a human has to be able to judge it", async () => {
    db.current = POPULATED;

    await expect(saveSettings({ ...DEFAULT_SETTINGS })).rejects.toThrow(
      /googleSheetUrl.*callCenterSheetUrl.*airtableBaseId.*excludedCampaigns/s,
    );
  });

  it("ANTI-VACUITY CONTROL: an ordinary save still reaches the database", async () => {
    db.current = POPULATED;
    const edited = makeSettings({ ...POPULATED, pausedThresholdDays: 7 });

    await expect(saveSettings(edited)).resolves.toBeUndefined();

    expect(db.upserts).toHaveLength(1);
    expect(db.upserts[0].key).toBe("app_settings");
    expect((db.upserts[0].value as AppSettings).pausedThresholdDays).toBe(7);
    expect((db.upserts[0].value as AppSettings).googleSheetUrl).toBe(POPULATED.googleSheetUrl);
  });

  it("ANTI-VACUITY CONTROL: a first-time save on an empty row still reaches the database", async () => {
    db.current = null;

    await expect(saveSettings(POPULATED)).resolves.toBeUndefined();

    expect(db.upserts).toHaveLength(1);
  });

  it("a single deliberate clear is SAVED, not refused — the guard must not block real edits", async () => {
    db.current = POPULATED;

    await saveSettings(makeSettings({ ...POPULATED, callCenterSheetUrl: "" }));

    expect(db.upserts).toHaveLength(1);
    expect((db.upserts[0].value as AppSettings).callCenterSheetUrl).toBe("");
  });
});
