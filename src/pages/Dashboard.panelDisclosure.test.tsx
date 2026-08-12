import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { makeSettings, makeAdSpendRow, makeAppointmentRow } from "@/test/factories";
import { buildAccountSummaries } from "@/lib/dataService";
import { AccountDetailPanel } from "./Dashboard";

/**
 * NOTHING DISAPPEARS FROM THIS PANEL WITHOUT SAYING SO.
 *
 * Three collapses were added to make the drill-down readable, and every one of them is a
 * chance to re-commit the defect we spent the night removing — a thing that vanishes and
 * leaves no trace that it was there.
 *
 *   ① the appointments table renders `.slice(0, 30)` under a heading that counts the WHOLE
 *      list. That truncation PRE-DATES this work and said nothing: on Backyard Paradiso it
 *      was 30 rows under a heading reading 323.
 *   ② an all-empty column is hidden — but an all-dash column IS information (nobody is
 *      filling that field in), so the columns are NAMED when they go.
 *   ③ campaigns with no leads and no appointments fold behind a count that states how many
 *      and how much spend they carry.
 *
 * ⚠️ THE COLUMN CHECK IS COMPUTED OVER THE WHOLE APPOINTMENT LIST, NOT THE 30 RENDERED
 * ROWS. "empty on all 323" derived from a 30-row slice would be a claim about a population
 * the reader cannot see. The last case below is the control for exactly that.
 *
 * SABOTAGE-PROVEN: drop the disclosure line for the columns, or the truncation line, and
 * the matching case fails. Both flips RUN.
 */

const SETTINGS = makeSettings();

function panel(account: Parameters<typeof AccountDetailPanel>[0]["account"]) {
  return render(
    <AccountDetailPanel account={account} settings={SETTINGS} onClose={() => {}} onToggleExclude={async () => {}} />,
  );
}

/** n appointments, all with the optional fields blank — the Backyard Paradiso shape. */
function accountWithBlankFields(n: number) {
  const spend = [makeAdSpendRow({ accountName: "Blanks", spent: 4000, leads: 900 })];
  const appts = Array.from({ length: n }, () =>
    makeAppointmentRow({ client: "Blanks", showStatus: "", leadValid: "", closedRevenue: 0 }),
  );
  return buildAccountSummaries(spend, appts, SETTINGS).accounts.find(a => a.accountName === "Blanks")!;
}

describe("a collapse always says what collapsed", () => {
  it("NAMES the empty columns instead of silently dropping them", () => {
    const { container } = panel(accountWithBlankFields(40));
    expect(screen.getByText(/Show Status, Lead Valid, Revenue are empty on all 40 appointments/i)).toBeInTheDocument();
    // and the columns really are gone from the header — the disclosure is not decoration
    const head = container.querySelector("thead")!;
    expect(within(head).queryByText("Show Status")).toBeNull();
    expect(within(head).queryByText("Revenue")).toBeNull();
    // CONTROL: the columns that DO carry data are still there, so "gone" means something
    expect(within(head).getByText("Setter")).toBeInTheDocument();
    expect(within(head).getByText("Date")).toBeInTheDocument();
  });

  it("KEEPS a column that has data anywhere — one non-empty row is enough", () => {
    const spend = [makeAdSpendRow({ accountName: "Mixed", spent: 4000, leads: 900 })];
    const appts = Array.from({ length: 40 }, (_, i) =>
      makeAppointmentRow({ client: "Mixed", showStatus: i === 39 ? "Showed" : "", leadValid: "", closedRevenue: 0 }),
    );
    const account = buildAccountSummaries(spend, appts, SETTINGS).accounts.find(a => a.accountName === "Mixed")!;
    const { container } = panel(account);
    const head = container.querySelector("thead")!;
    // ⭐ THE SINGLE FILLED ROW IS ROW 40 — OUTSIDE the 30 rows the table renders. If the
    // emptiness check were computed over the rendered slice it would wrongly call this
    // column empty and hide a column that has data. This is the denominator control.
    expect(within(head).getByText("Show Status")).toBeInTheDocument();
    expect(screen.queryByText(/Show Status.*are empty/i)).toBeNull();
  });

  it("STATES the row truncation the heading used to contradict", () => {
    panel(accountWithBlankFields(323));
    expect(screen.getByText("Appointments (323)")).toBeInTheDocument();
    expect(screen.getByText(/Showing the 30 most recent of 323/i)).toBeInTheDocument();
  });

  it("says nothing about truncation when nothing is truncated", () => {
    panel(accountWithBlankFields(5));
    // CONTROL: the disclosure must not be furniture that is always present.
    expect(screen.queryByText(/most recent of/i)).toBeNull();
  });

  it("folds quiet campaigns behind a count that states how many and how much spend", () => {
    const spend = [
      makeAdSpendRow({ accountName: "Wall", campaign: "Busy", campaignId: "c1", spent: 5000, leads: 300 }),
      makeAdSpendRow({ accountName: "Wall", campaign: "Quiet A", campaignId: "c2", spent: 27, leads: 0 }),
      makeAdSpendRow({ accountName: "Wall", campaign: "Quiet B", campaignId: "c3", spent: 13, leads: 0 }),
    ];
    const account = buildAccountSummaries(spend, [], SETTINGS).accounts.find(a => a.accountName === "Wall")!;
    panel(account);
    expect(screen.getByText(/2 campaigns with no leads and no appointments/i)).toBeInTheDocument();
    // the spend they carry is stated, so folding them does not hide money
    expect(screen.getByText(/\$40\.00/)).toBeInTheDocument();
  });
});
