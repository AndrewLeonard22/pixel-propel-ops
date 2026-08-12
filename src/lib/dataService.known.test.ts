import { describe, it, expect } from "vitest";
import { buildAccountSummaries, metricIsMeaningful } from "./dataService";
import { makeAdSpendRow, makeAppointmentRow, makeSettings } from "@/test/factories";

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
const SETTINGS = makeSettings();

const build = (known?: Parameters<typeof buildAccountSummaries>[3]) =>
  buildAccountSummaries(SPEND, APPTS, SETTINGS, known).accounts;

describe("buildAccountSummaries — source liveness reaches the ROW, not just the tile", () => {
  it("THE COMPATIBILITY RULE: omitting `known` means KNOWN, so the legacy callers are untouched", () => {
    const [acct] = build();

    // Targets.tsx and TeamPerformance.tsx take this branch on every render.
    expect(acct.spendKnown).toBe(true);
    expect(acct.apptsKnown).toBe(true);
  });

  it("a partially-specified `known` defaults ONLY the keys it omits", () => {
    const [acct] = build({ appts: false });

    expect(acct.apptsKnown).toBe(false);
    expect(acct.spendKnown).toBe(true);
  });

  it("AN EXPLICIT `false` SURVIVES — this is `?? true`, and `|| true` would erase it", () => {
    const [acct] = build({ spend: false, appts: false });

    // `||` collapses false to true and silently restores the bug, with every test that
    // only checks the true case still passing.
    expect(acct.spendKnown).toBe(false);
    expect(acct.apptsKnown).toBe(false);
  });

  it("BIRD'S EXACT SCENARIO, re-based: Airtable dead, Windsor alive — flags disagree per source", () => {
    // ⚠️ ORIGINALLY "call-centre dead". That source was deleted on 2026-08-11, so the arm
    // is re-pointed at the surviving pair rather than deleted: what it guards is that two
    // sources can hold DIFFERENT liveness on the same row, which is the whole mechanism.
    const [acct] = build({ spend: true, appts: false });

    expect(acct.apptsKnown).toBe(false); // TOTAL APPTS must render "—"
    expect(acct.spendKnown).toBe(true);  // TOTAL SPEND must still render $654,261.49
  });

  it("the flags reach EVERY row, not just the first — a per-row render reads each one", () => {
    const twoAccounts = buildAccountSummaries(
      [...SPEND, makeAdSpendRow({ accountName: "Beta", campaignId: "999" })],
      APPTS,
      SETTINGS,
      { appts: false },
    ).accounts;

    expect(twoAccounts.length).toBeGreaterThan(1);
    for (const a of twoAccounts) expect(a.apptsKnown).toBe(false);
  });

  it("IS BEHAVIOUR-NEUTRAL ON THE MATHS — the flags describe the data, they do not change it", () => {
    const withFlags = build({ spend: false, appts: false });
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

/**
 * THE SECOND WAY A NUMBER CAN BE MEANINGLESS, and it fires on a perfectly healthy feed.
 *
 * @raccoon measured (RACC-031) that `costPerAppt` reads $0.00 for BOTH a dead source and a
 * live account with no appointments — so it cannot discriminate, while `cpl` can ($50.00
 * vs $0.00). The source flag alone does not fix that: a live Windsor feed with zero
 * appointments still divides by zero and still renders a confident $0.00.
 */
describe("metricIsMeaningful — a ratio with a zero denominator is NOT zero", () => {
  it("refuses when the SOURCE did not answer, whatever the denominator", () => {
    expect(metricIsMeaningful(false, 10)).toBe(false);
    expect(metricIsMeaningful(false, 0)).toBe(false);
  });

  it("refuses when the DENOMINATOR is zero, even on a healthy source", () => {
    // RACC-031's case: spend is real, appointments are genuinely 0, and cost-per-
    // appointment is undefined — not $0.00.
    expect(metricIsMeaningful(true, 0)).toBe(false);
    expect(metricIsMeaningful(undefined, 0)).toBe(false);
  });

  it("ALLOWS a real number — the anti-vacuity control", () => {
    expect(metricIsMeaningful(true, 1)).toBe(true);
    expect(metricIsMeaningful(true, 10)).toBe(true);
  });

  it("ABSENT MEANS KNOWN — Targets and TeamPerformance pass no flag at all", () => {
    // `!undefined` is true, so a `!known` implementation would blank both pages.
    expect(metricIsMeaningful(undefined, 10)).toBe(true);
  });

  it("does not treat a negative denominator as usable", () => {
    expect(metricIsMeaningful(true, -1)).toBe(false);
  });
});

/**
 * REGRESSION LOCK ON @bird's DRIVEN ROW.
 *
 * He drove `stabilization @ f66eed2` and eyeballed the Backyard Paradiso row with the
 * call-centre and Airtable sources killed:
 *
 *   SPEND        LEADS   CPL      DIALS  APPTS  L→A  C/APPT  CLOSED  REV
 *   $150,296.18  7,178   $20.94   —      —      —    —       —       —
 *
 * The badge rework landed AFTER that drive, so these lock the decisions his run
 * exercised. Every one must stay identical — the rework was supposed to change the
 * live-source-zero-denominator case ONLY, and nothing he actually saw.
 *
 * ⭐ THE DISTINCTION HE VERIFIED, and the reason a blanket "—" would have been wrong:
 *     Airtable killed, call-centre ALIVE  ->  DIALS 0   a real zero, honestly reported
 *     call-centre killed                  ->  DIALS —   unknown, not zero
 */
describe("@bird's driven row (f66eed2) — locked against the later badge rework", () => {
  const LEADS = 7178;

  it("CPL still renders: spend known, 7,178 leads is a real denominator", () => {
    expect(metricIsMeaningful(true, LEADS)).toBe(true);
  });

  it("every dead-source cell he saw stays blank, denominator irrelevant", () => {
    expect(metricIsMeaningful(false, LEADS)).toBe(false);
    expect(metricIsMeaningful(false, 0)).toBe(false);
  });

  it("THE NEW CASE HIS DRIVE DID NOT COVER: sources alive, zero appointments", () => {
    // Before the rework this rendered a confident $0.00 on a perfectly healthy feed —
    // @raccoon measured it at 61 of 61 accounts (RACC-031).
    expect(metricIsMeaningful(true, 0)).toBe(false);
  });
});
