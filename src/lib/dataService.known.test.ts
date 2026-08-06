import { describe, it, expect } from "vitest";
import { buildAccountSummaries } from "./dataService";
import { makeAdSpendRow, makeAppointmentRow, makeCallRow, makeSettings } from "@/test/factories";

/**
 * POPULATION UNDER TEST
 *   The three source-liveness flags across the transitions that decide a render: omitted
 *   (the two legacy callers), explicitly true, explicitly false, and the mixed case where
 *   one source is dead and the others are alive.
 *
 * WHY THIS EXISTS — MEASURED, NOT IMAGINED
 *   @bird killed the call-centre source and drove the dashboard. The KPI tiles read "—"
 *   because Dashboard.tsx:751-753 consults the per-source state at the RENDER layer. The
 *   per-account table on the SAME SCREEN read COST/APPT $0.00, CLOSED 0, REVENUE $0.00 —
 *   because the rows come from buildAccountSummaries, which took plain arrays and could
 *   not tell a dead source from an empty one. Every money field is a `number`, and a
 *   failed fetch contributes `[]`, so `totalAppts > 0 ? spend/totalAppts : 0` produces a
 *   confident zero out of no information at all.
 *
 *   That is absence rendered as a plausible fact, and the table is what a buyer reads.
 *
 * ⚠️ THE COMPATIBILITY PROPERTY IS LOAD-BEARING, NOT A COURTESY
 *   Targets.tsx:117 and TeamPerformance.tsx:89 call this with FOUR arguments. They filter
 *   arrays they already hold and have no notion of a fetch. If an omitted `known` defaulted
 *   to "unknown", both pages would blank every number — the exact mirror of the bug. So
 *   "absent means known" is asserted here as a rule, not left to inference.
 */
const SPEND = [
  makeAdSpendRow({ accountName: "Acme", spent: 300, leads: 10 }),
  makeAdSpendRow({ accountName: "Acme", spent: 200, leads: 5, adId: "334" }),
];
const APPTS = [
  makeAppointmentRow({ client: "Acme" }),
  makeAppointmentRow({ client: "Acme", adId: "334" }),
];
const CALLS = [makeCallRow({ ghlLocationName: "Acme" })];
const SETTINGS = makeSettings();

const build = (known?: Parameters<typeof buildAccountSummaries>[4]) =>
  buildAccountSummaries(SPEND, APPTS, SETTINGS, CALLS, known).accounts;

describe("buildAccountSummaries — source liveness reaches the ROW, not just the tile", () => {
  it("THE COMPATIBILITY RULE: omitting `known` means KNOWN, so the legacy callers are untouched", () => {
    const [acct] = build();

    // Targets.tsx and TeamPerformance.tsx take this branch on every render.
    expect(acct.spendKnown).toBe(true);
    expect(acct.apptsKnown).toBe(true);
    expect(acct.callsKnown).toBe(true);
  });

  it("a partially-specified `known` defaults ONLY the keys it omits", () => {
    const [acct] = build({ appts: false });

    expect(acct.apptsKnown).toBe(false);
    expect(acct.spendKnown).toBe(true);
    expect(acct.callsKnown).toBe(true);
  });

  it("AN EXPLICIT `false` SURVIVES — this is `?? true`, and `|| true` would erase it", () => {
    const [acct] = build({ spend: false, appts: false, calls: false });

    // `||` collapses false to true and silently restores the bug, with every test that
    // only checks the true case still passing.
    expect(acct.spendKnown).toBe(false);
    expect(acct.apptsKnown).toBe(false);
    expect(acct.callsKnown).toBe(false);
  });

  it("BIRD'S EXACT SCENARIO: call-centre dead, Windsor alive — flags disagree per source", () => {
    const [acct] = build({ spend: true, appts: true, calls: false });

    expect(acct.callsKnown).toBe(false); // TOTAL DIALS must render "—"
    expect(acct.spendKnown).toBe(true); // TOTAL SPEND must still render $654,261.49
    expect(acct.apptsKnown).toBe(true);
  });

  it("the flags reach EVERY row, not just the first — a per-row render reads each one", () => {
    const twoAccounts = buildAccountSummaries(
      [...SPEND, makeAdSpendRow({ accountName: "Beta", campaignId: "999" })],
      APPTS,
      SETTINGS,
      CALLS,
      { appts: false },
    ).accounts;

    expect(twoAccounts.length).toBeGreaterThan(1);
    for (const a of twoAccounts) expect(a.apptsKnown).toBe(false);
  });

  it("IS BEHAVIOUR-NEUTRAL ON THE MATHS — the flags describe the data, they do not change it", () => {
    const withFlags = build({ spend: false, appts: false, calls: false });
    const without = build();

    // If flagging a source altered a number, the flag would be a second source of truth.
    for (const key of [
      "spend",
      "leads",
      "cpl",
      "appointments",
      "costPerAppt",
      "closed",
      "revenue",
      "totalDials",
    ] as const) {
      expect(withFlags[0][key]).toBe(without[0][key]);
    }
  });

  it("ANTI-VACUITY CONTROL: the fixture really does produce non-zero numbers to suppress", () => {
    // A row of zeroes would make every assertion above true for the wrong reason — there
    // would be nothing for a dead source to hide.
    const [acct] = build();
    expect(acct.spend).toBeGreaterThan(0);
    expect(acct.appointments).toBeGreaterThan(0);
    expect(acct.costPerAppt).toBeGreaterThan(0);
  });
});
