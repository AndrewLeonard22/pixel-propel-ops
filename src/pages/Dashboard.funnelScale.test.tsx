import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { makeSettings, makeAdSpendRow, makeAppointmentRow } from "@/test/factories";
import { buildAccountSummaries } from "@/lib/dataService";
import { AccountDetailPanel } from "./Dashboard";

/**
 * ⭐ THE FUNNEL BAR MEASURES THE CONVERSION, NOT THE MAGNITUDE.
 *
 * THE DEFECT: every bar width was a share of LEADS. On Backyard Paradiso the funnel is
 * 7,186 → 323 → 208 → 19 — a 378:1 range — so stages 2-4 computed to 4.5% / 2.9% / 0.26%
 * and were floored at 3% to stay visible. Three different quantities rendered as the same
 * dot, and it degraded WORST on the largest account, the one Andrew opens most.
 * A proportional bar physically cannot render that range.
 *
 * THE FIX: each bar is that stage's share of THE STAGE ABOVE IT, so the bar depicts the
 * conversion rate printed beside it. Magnitude stays in the count column, exact.
 *
 * ⛔ WHY NOT A LOG SCALE: it would fit the range and it would LIE — a 378:1 collapse would
 * read as a gentle slope. Rejected on honesty, not aesthetics. Nothing here permits it.
 *
 * ⭐ THE DISCRIMINATING ASSERTION IS `showed`, AND IT IS WHY THIS FILE EXISTS.
 * Under BOTH schemes the Appointments bar is appts/leads, so asserting that one proves
 * nothing. Only `showed` and `closed` separate them:
 *      stage    OLD (of leads)      NEW (of stage above)
 *      showed   208/7186 =  2.9%    208/323  = 64.4%
 *      closed    19/7186 =  0.26%    19/208  =  9.1%
 * A test that checked only the Appointments bar would pass against the bug.
 *
 * SABOTAGE-PROVEN: revert either bar to the leads denominator, or restore the
 * `Math.max(..., 3)` visibility floor, and the matching case below fails. Both flips RUN.
 */

const SETTINGS = makeSettings();

/** Andrew's real shape: 7,186 leads · 323 appts · 208 showed · 19 closed. */
function wideFunnelAccount() {
  const spend = [makeAdSpendRow({ accountName: "Backyard Paradiso", spent: 50000, leads: 7186 })];
  const appts = [];
  for (let i = 0; i < 323; i++) {
    // 208 showed; of those, 19 closed.
    const showed = i < 208;
    const closed = i < 19;
    appts.push(
      makeAppointmentRow({
        client: "Backyard Paradiso",
        showStatus: showed ? "Showed" : "No Show",
        closedRevenue: closed ? 1000 : 0,
      }),
    );
  }
  const built = buildAccountSummaries(spend, appts, SETTINGS);
  return built.accounts.find(a => a.accountName === "Backyard Paradiso")!;
}

function barWidths(container: HTMLElement): Record<string, number> {
  const out: Record<string, number> = {};
  container.querySelectorAll<HTMLElement>("[data-funnel-bar]").forEach(el => {
    out[el.getAttribute("data-funnel-bar")!] = parseFloat(el.style.width);
  });
  return out;
}

function mount(account: ReturnType<typeof wideFunnelAccount>) {
  return render(
    <AccountDetailPanel
      account={account}
      settings={SETTINGS}
      onClose={() => {}}
      onToggleExclude={async () => {}}
    />,
  );
}

describe("the conversion funnel is scaled stage-to-stage, not against leads", () => {
  it("renders all four bars", () => {
    const { container } = mount(wideFunnelAccount());
    const w = barWidths(container);
    // NON-VACUITY: if the panel ever stops rendering these, every width assertion below
    // would pass over an empty object.
    expect(Object.keys(w).sort()).toEqual(["appts", "closed", "leads", "showed"]);
  });

  it("SHOWED is a share of APPOINTMENTS (64.4%), not of leads (2.9%)", () => {
    const a = wideFunnelAccount();
    const { container } = mount(a);
    const w = barWidths(container);
    const expected = (a.appointments > 0 ? 208 / a.appointments : 0) * 100;
    expect(w.showed).toBeCloseTo(expected, 1);
    expect(w.showed).toBeGreaterThan(50); // 64.4% — visible. Under the bug it was 2.9%.
  });

  it("CLOSED is a share of SHOWED (9.1%), not of leads (0.26%)", () => {
    const { container } = mount(wideFunnelAccount());
    const w = barWidths(container);
    expect(w.closed).toBeCloseTo((19 / 208) * 100, 1);
    // Under the bug this was 0.26% and then floored to 3%. It must be neither.
    expect(w.closed).toBeGreaterThan(5);
  });

  it("LEADS is the baseline at 100% and APPOINTMENTS keeps its true share of leads", () => {
    const a = wideFunnelAccount();
    const { container } = mount(a);
    const w = barWidths(container);
    expect(w.leads).toBe(100);
    // CONTROL: this one is IDENTICAL under both schemes, which is exactly why it cannot
    // be the discriminating assertion — it is here to prove the fix did not distort the
    // stage that was already correct.
    expect(w.appts).toBeCloseTo((a.appointments / a.leads) * 100, 1);
  });

  it("a stage that converted NOTHING renders an EMPTY bar — no visibility floor", () => {
    // The old code floored every non-zero-count stage at 3%, drawing a sliver for a stage
    // that converted nothing. A bar that shows something where nothing happened is the
    // same class as a fabricated zero.
    const spend = [makeAdSpendRow({ accountName: "NoShows", spent: 900, leads: 400 })];
    const appts = Array.from({ length: 12 }, () =>
      makeAppointmentRow({ client: "NoShows", showStatus: "No Show", closedRevenue: 0 }),
    );
    const built = buildAccountSummaries(spend, appts, SETTINGS);
    const account = built.accounts.find(a => a.accountName === "NoShows")!;
    const { container } = mount(account);
    const w = barWidths(container);

    expect(account.appointments).toBe(12); // CONTROL: the population is real, not empty
    expect(w.showed).toBe(0);              // 0 of 12 showed
    expect(w.closed).toBe(0);              // and nothing can close
  });

  it("a zero-appointment account renders zero-width bars and never NaN", () => {
    // @bird drives this account explicitly: it is where divide-by-zero hides.
    const spend = [makeAdSpendRow({ accountName: "Quiet", spent: 100, leads: 50 })];
    const built = buildAccountSummaries(spend, [], SETTINGS);
    const account = built.accounts.find(a => a.accountName === "Quiet")!;
    const { container } = mount(account);
    const w = barWidths(container);
    for (const k of ["appts", "showed", "closed"]) {
      expect(Number.isNaN(w[k]), `${k} must not be NaN`).toBe(false);
      expect(w[k]).toBe(0);
    }
    expect(w.leads).toBe(100);
  });
});
