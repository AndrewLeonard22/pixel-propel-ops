import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RatioBadge, CPLBadge, CostPerApptBadge, LeadToApptBadge } from "./Dashboard";

/**
 * THE ARM I SAID COULD NOT EXIST.
 *
 * I declared three times tonight that "the predicate is unit-tested, the consumer is not"
 * could only be closed by a live drive. @raccoon showed that false with two facts already
 * sitting in this tree: `@testing-library/react` is a dependency, and
 * `CallCenter.setterPanel.test.tsx` already renders `SetterDetailPanel` — a page-local
 * component exported for exactly this reason. The precedent was on the branch I had just
 * shipped to.
 *
 * ⭐ HIS GENERAL FORM, WHICH IS THE PART WORTH KEEPING: "the predicate is tested, the
 * consumer is not" is NOT a testing-effort problem, it is a REACHABILITY problem. A local
 * function inside a 900-line page component is unreachable from a test BY CONSTRUCTION,
 * and the fix is EXPORT OR EXTRACTION, not more unit tests. That is why payout.ts and
 * settingsWriteGuard.ts are separate modules — arithmetic that decides money and a guard
 * that prevents data loss both have to be reachable by something that can fail.
 *
 * WHAT THESE LOCK THAT THE 15 PREDICATE TESTS CANNOT: a badge that ignored
 * metricIsMeaningful entirely — the S4 shape, a guard that ships doing nothing — leaves
 * every predicate test GREEN and every test below RED.
 *
 * POPULATION: the two independent ways a figure is meaningless (dead source, zero
 * denominator) × the three badges, plus the per-metric wiring, plus the reverse direction
 * that a value-keyed badge got wrong.
 */
describe("RatioBadge — the decision site, not the predicate", () => {
  it("renders the em dash when the SOURCE did not answer, despite a real denominator", () => {
    render(<RatioBadge known={false} denominator={5} color="">$99.00</RatioBadge>);

    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("$99.00")).not.toBeInTheDocument();
  });

  it("renders the em dash when the DENOMINATOR is zero on a healthy source", () => {
    render(<RatioBadge known={true} denominator={0} color="">$99.00</RatioBadge>);

    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("$99.00")).not.toBeInTheDocument();
  });

  it("ANTI-VACUITY CONTROL: renders the VALUE when the metric is meaningful", () => {
    render(<RatioBadge known={true} denominator={5} color="text-success">$99.00</RatioBadge>);

    expect(screen.getByText("$99.00")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("ABSENT MEANS KNOWN — Targets and TeamPerformance pass no flag at all", () => {
    render(<RatioBadge known={undefined} denominator={5} color="">$99.00</RatioBadge>);

    expect(screen.getByText("$99.00")).toBeInTheDocument();
  });
});

describe("the three badges — each keyed on ITS OWN denominator", () => {
  it("CPLBadge blanks on zero LEADS, not on zero value", () => {
    render(<CPLBadge value={0} leads={0} known={true} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("CostPerApptBadge blanks on zero APPOINTMENTS — @raccoon's 61-of-61 case", () => {
    // Spend is real, the feed is healthy, and cost-per-appointment is UNDEFINED.
    // This rendered a confident $0.00 before the rework.
    render(<CostPerApptBadge value={0} appointments={0} known={true} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("CostPerApptBadge renders a real cost when appointments exist", () => {
    render(<CostPerApptBadge value={210} appointments={3} known={true} />);
    expect(screen.getByText("$210.00")).toBeInTheDocument();
  });

  it("THE REVERSE DIRECTION: a genuine 0% lead-to-appt now reads 0%, NOT an em dash", () => {
    // The old badge returned "—" whenever value === 0, hiding a real and bad result
    // behind an absence. This is the assertion that catches a regression TO the old
    // behaviour — the direction most likely to be got wrong.
    render(<LeadToApptBadge value={0} leads={500} known={true} />);

    expect(screen.getByText("0.0%")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("LeadToApptBadge still blanks when there were no leads to convert", () => {
    render(<LeadToApptBadge value={0} leads={0} known={true} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("@bird's DRIVEN CELL: CPL survives on 7,178 leads with spend known", () => {
    render(<CPLBadge value={20.94} leads={7178} known={true} />);
    expect(screen.getByText("$20.94")).toBeInTheDocument();
  });

  it("@bird's DRIVEN CELL: a dead source blanks regardless of denominator", () => {
    render(<CPLBadge value={20.94} leads={7178} known={false} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
