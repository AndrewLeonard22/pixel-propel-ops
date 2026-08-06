import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AccountRow } from "./Dashboard";
import { buildAccountSummaries } from "@/lib/dataService";
import { makeAdSpendRow, makeAppointmentRow, makeCallRow, makeSettings } from "@/test/factories";

/**
 * THE WIRING ARM — a different question from the badge arm, and @bird drew the line.
 *
 *   "Not «the badge consults the predicate» — a unit test proves that better. What the
 *    row proves is COMPOSITION: that the predicate is wired into the REAL CELL, for a
 *    real account, from real feed data, through the whole stack. A RatioBadge unit test
 *    would stay green if nothing rendered it."
 *
 * So these drive the actual pipeline — buildAccountSummaries → AccountRow → cells — and
 * assert on what a buyer would read. The summaries are BUILT, never hand-authored, so a
 * flag that stops being stamped, or a cell wired to the wrong flag, fails here.
 *
 * ⭐ AND @bird MEASURED THAT ONE OF THESE STATES IS UNREACHABLE FROM A LIVE RIG:
 * `fetchAirtableData` throws UNCONDITIONALLY at dataService.ts:182 (the proxy is not
 * deployed), so appointments can be NOT-CONFIGURED or FAILED but never KNOWN-AND-EMPTY.
 * A true 0% cannot be staged from a browser at all. His words: "the live rig is bounded
 * by the states the app can actually enter; a unit test is not." That inverts the usual
 * order — here the test reaches something the screen cannot.
 */
const SETTINGS = makeSettings();

function buildRow(known?: Parameters<typeof buildAccountSummaries>[4]) {
  const { accounts } = buildAccountSummaries(
    [makeAdSpendRow({ accountName: "Acme", spent: 500, leads: 20 })],
    [makeAppointmentRow({ client: "Acme" })],
    SETTINGS,
    [makeCallRow({ ghlLocationName: "Acme" })],
    known,
  );
  return accounts[0];
}

function renderRow(account: ReturnType<typeof buildRow>) {
  return render(
    <table>
      <tbody>
        <AccountRow account={account} onSelect={() => {}} />
      </tbody>
    </table>,
  );
}

beforeEach(() => localStorage.clear());

/**
 * Column order in AccountRow, so assertions name a CELL rather than hunting for text.
 * Querying by text was ambiguous — spend and cost-per-appointment can both read $500.00,
 * and my first attempt matched the wrong one.
 */
const COL = {
  name: 0, spend: 1, leads: 2, cpl: 3, dials: 4,
  appts: 5, leadPct: 6, costPerAppt: 7, closed: 8, revenue: 9,
} as const;

function cells(): string[] {
  return Array.from(screen.getByRole("row").querySelectorAll("td")).map(
    td => (td.textContent ?? "").trim(),
  );
}

describe("AccountRow — the flags are WIRED INTO THE CELLS, not merely stamped", () => {
  it("ANTI-VACUITY CONTROL: a fully healthy row prints real numbers, no em dashes", () => {
    renderRow(buildRow());
    const c = cells();

    expect(c[COL.spend]).toBe("$500.00");
    expect(c[COL.leads]).toBe("20");
    expect(c.filter(t => t === "—")).toHaveLength(0);
  });

  it("A DEAD CALL-CENTRE blanks DIALS and NOTHING ELSE", () => {
    renderRow(buildRow({ spend: true, appts: true, calls: false }));
    const c = cells();

    expect(c[COL.dials]).toBe("—");
    // Windsor is alive, so spend must survive — the control that catches a fix which
    // blanks the whole row rather than the dead source's columns.
    expect(c[COL.spend]).toBe("$500.00");
    expect(c.filter(t => t === "—")).toHaveLength(1);
  });

  it("A DEAD WINDSOR blanks the spend-derived cells but not the appointment counts", () => {
    renderRow(buildRow({ spend: false, appts: true, calls: true }));
    const c = cells();

    expect(c[COL.spend]).toBe("—");
    expect(c[COL.leads]).toBe("—");
    expect(c[COL.cpl]).toBe("—");
    expect(c[COL.appts]).toBe("1");   // Airtable answered; this is a real count
    expect(c[COL.closed]).toBe("0");  // a SUM over a live source — an honest zero
  });

  it("@bird's DRIVEN CASE: both appointment and call sources dead", () => {
    renderRow(buildRow({ spend: true, appts: false, calls: false }));
    const c = cells();

    // His f66eed2 row: spend and leads survive, everything downstream blanks.
    expect(c[COL.spend]).toBe("$500.00");
    expect(c[COL.leads]).toBe("20");
    expect(c[COL.cpl]).toBe("$25.00");
    for (const k of ["dials", "appts", "leadPct", "costPerAppt", "closed", "revenue"] as const) {
      expect(c[COL[k]]).toBe("—");
    }
  });

  it("THE STATE NO RIG CAN STAGE: sources alive, zero appointments", () => {
    // fetchAirtableData throws unconditionally (dataService.ts:182), so a browser cannot
    // produce known-and-empty appointments. Reached directly here.
    const { accounts } = buildAccountSummaries(
      [makeAdSpendRow({ accountName: "Acme", spent: 500, leads: 20 })],
      [], // ZERO appointments, and the source ANSWERED
      SETTINGS,
      [makeCallRow({ ghlLocationName: "Acme" })],
      { spend: true, appts: true, calls: true },
    );
    renderRow(accounts[0]);
    const c = cells();

    // COST/APPT divides by APPOINTMENTS = 0 ⇒ undefined, so "—" and not $0.00.
    expect(c[COL.costPerAppt]).toBe("—");

    // ⭐ LEAD→APPT divides by LEADS = 20, which is a REAL denominator, so the ratio IS
    // defined and its value is genuinely zero: 20 leads produced no appointments. That is
    // a real and BAD result a buyer must see, and the pre-rework badge hid it behind "—".
    // THIS IS THE REVERSE DIRECTION, and @bird measured that no rig can stage it —
    // fetchAirtableData throws unconditionally, so appointments can never be known-and-
    // empty in a browser. This assertion is the only thing that covers it.
    expect(c[COL.leadPct]).toBe("0.0%");

    // SUMS over the same live source stay honest zeroes.
    expect(c[COL.revenue]).toBe("$0.00");
    expect(c[COL.closed]).toBe("0");
    expect(c[COL.spend]).toBe("$500.00");
  });
});
