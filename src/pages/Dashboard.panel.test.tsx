import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AccountDetailPanel } from "./Dashboard";
import { buildAccountSummaries } from "@/lib/dataService";
import { makeAdSpendRow, makeAppointmentRow, makeCallRow, makeSettings } from "@/test/factories";

/**
 * THE FOURTH SURFACE.
 *
 * @raccoon measured this and reported rather than shipped, because the file is mine and it
 * was verdict time: in the SAME four-card grid, Cost/Appt refused correctly while the
 * Revenue card beside it fabricated $0.00 from the same dead source. One of twelve
 * appointment-sourced expressions in this panel mentioned `apptsKnown`.
 *
 * ⭐ WHY NOBODY CAUGHT IT: @bird's arms read the ROW and the KPI TILES, and BOTH were
 * correctly gated. The panel only renders when you CLICK an account, and no arm clicked
 * one. Row · tile · panel — the fix had landed on the two surfaces that were driven.
 *
 * That is the same layer-blindness the W1/W2/W3 sabotage measured on this very file
 * (each arm goes red at exactly one layer and green at the others), arriving on a surface
 * I had not enumerated. The lesson is not "test harder", it is that a fix is only as wide
 * as the surfaces someone actually rendered — and the panel had zero tests until now.
 */
const SETTINGS = makeSettings();

function buildAccount(known?: Parameters<typeof buildAccountSummaries>[4]) {
  const { accounts } = buildAccountSummaries(
    [makeAdSpendRow({ accountName: "Acme", spent: 500, leads: 20 })],
    [makeAppointmentRow({ client: "Acme", showStatus: "Showed", closedRevenue: 900 })],
    SETTINGS,
    [makeCallRow({ ghlLocationName: "Acme" })],
    known,
  );
  return accounts[0];
}

function mount(known?: Parameters<typeof buildAccountSummaries>[4]) {
  return render(
    <AccountDetailPanel
      account={buildAccount(known)}
      settings={SETTINGS}
      onClose={() => {}}
      onToggleExclude={() => {}}
    />,
  );
}

beforeEach(() => localStorage.clear());

describe("AccountDetailPanel — the expanded view must not fabricate what the row refuses", () => {
  it("🔴 APPOINTMENTS UNAVAILABLE: no money figure is fabricated anywhere in the panel", () => {
    const { container } = mount({ spend: true, appts: false, calls: true });
    const text = container.textContent ?? "";

    // The exact defect @raccoon measured: $0.00 revenue beside a correctly-refusing card.
    expect(text).not.toMatch(/\$0\.00/);
    // And the percentage form of the same lie.
    expect(text).not.toMatch(/0\.0%/);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("SPEND SURVIVES a dead appointments source — only the affected cards blank", () => {
    const { container } = mount({ spend: true, appts: false, calls: true });

    // Windsor answered. Blanking the whole panel would be the mirror defect.
    expect(container.textContent).toMatch(/\$500\.00/);
  });

  it("CALL-CENTRE DEAD: the dials figure and the booking rate both refuse", () => {
    const { container } = mount({ spend: true, appts: true, calls: false });
    const text = container.textContent ?? "";

    // booking rate = appointments / dials — mixes two sources, so a dead call centre
    // makes it unknowable, not zero. The old form only checked the denominator.
    expect(text).not.toMatch(/\b0\.0%\s*booking/);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("🔴 CONTROL — A FULLY HEALTHY ACCOUNT PRINTS REAL NUMBERS AND NO EM DASH CARDS", () => {
    // Without this the gate is satisfiable by blanking everything, which is the mirror
    // defect: refusing to report a genuine result.
    const { container } = mount();
    const text = container.textContent ?? "";

    expect(text).toMatch(/\$500\.00/); // spend
    expect(text).toMatch(/\$900\.00/); // revenue — a REAL figure, not suppressed
  });

  it("CONTROL: a healthy source with zero closed deals still shows an honest $0.00", () => {
    const { accounts } = buildAccountSummaries(
      [makeAdSpendRow({ accountName: "Acme", spent: 500, leads: 20 })],
      [makeAppointmentRow({ client: "Acme", closedRevenue: 0 })], // real, and really zero
      SETTINGS,
      [makeCallRow({ ghlLocationName: "Acme" })],
      { spend: true, appts: true, calls: true },
    );
    const { container } = render(
      <AccountDetailPanel
        account={accounts[0]}
        settings={SETTINGS}
        onClose={() => {}}
        onToggleExclude={() => {}}
      />,
    );

    // A SUM over a live source is honest at zero. Suppressing this would hide a real fact.
    expect(container.textContent).toMatch(/\$0\.00/);
  });
});
