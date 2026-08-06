import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HonestNumbersBanner } from "./Banners";
import { buildHonestNumbersReport } from "@/lib/honestNumbers";

/**
 * THE ON-SCREEN HALF OF THE MISSION.
 *
 * The two detectors were built, wired, unit-tested and differential-locked, and NOTHING
 * RENDERED THEM — zero consumers of `honestNumbers` or `exclusions` anywhere in src/pages
 * or src/components. A user saw exactly what they saw before the work started. That is the
 * same shape as a guard that ships doing nothing, except the consumer here is a person.
 *
 * These tests drive the component AND compose its input from the real report builder, so
 * a change that stops emitting messages fails here rather than silently rendering nothing.
 */
describe("HonestNumbersBanner", () => {
  it("🔴 RENDERS NOTHING when everything is trustworthy — the control arm", () => {
    // An empty banner trains the eye to skip it, which is how a real warning stops being
    // read. This is the assertion that keeps the warning worth showing.
    const { container } = render(<HonestNumbersBanner messages={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders every message it is given, verbatim", () => {
    render(<HonestNumbersBanner messages={["First problem.", "Second problem."]} />);

    // toBeVisible, NOT toBeInTheDocument: getByText finds text inside a `hidden` element,
    // so an in-the-document assertion passes on a banner nobody can see. Sabotage arm B2
    // set `hidden` on the message list and ZERO tests failed — the assertion was weaker
    // than it read. "Present" is not "visible", exactly as "computed" is not "rendered".
    expect(screen.getByText("First problem.")).toBeVisible();
    expect(screen.getByText("Second problem.")).toBeVisible();
  });

  it("has NO dismiss control — the condition is permanent, not transient", () => {
    // A dismiss would let the warning be silenced while the numbers stayed wrong, which
    // is the defect wearing a different hat.
    render(<HonestNumbersBanner messages={["A problem."]} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("COMPOSED WITH THE REAL BUILDER: the post-wipe state produces a visible banner", () => {
    const report = buildHonestNumbersReport({
      settings: { excludedCampaigns: [] },
      campaignIdsInData: ["c1", "c2"],
      fabricatedRateCount: 0,
      allRatesFabricated: true,
    });
    render(<HonestNumbersBanner messages={report.messages} />);

    expect(report.hasWarnings).toBe(true);
    // Both detectors reach the screen, not just one. Asserted on the CONSEQUENCE the
    // reader needs — "cost-per-lead" — rather than on a word I assumed was in the copy.
    // My first attempt matched /exclusion/i and went red: the sentence says "excluded".
    expect(screen.getByText(/cost-per-lead/i)).toBeVisible();
    expect(screen.getByText(/\$5 default/i)).toBeVisible();
  });

  it("COMPOSED CONTROL: a healthy configuration renders NOTHING at all", () => {
    const report = buildHonestNumbersReport({
      settings: { excludedCampaigns: ["c1"] },
      campaignIdsInData: ["c1", "c2"],
      fabricatedRateCount: 0,
      allRatesFabricated: false,
    });
    const { container } = render(<HonestNumbersBanner messages={report.messages} />);

    expect(report.hasWarnings).toBe(false);
    expect(container).toBeEmptyDOMElement();
  });

  it("never shows a setter COUNT — a number here would contradict the Agents page", () => {
    // The banner's population differs from Agents.tsx on two axes (pay period AND
    // leadValid), so @raccoon made the copy numberless. This asserts the rendered output
    // stays that way.
    const report = buildHonestNumbersReport({
      settings: { excludedCampaigns: ["c1"] },
      campaignIdsInData: ["c1"],
      fabricatedRateCount: 7,
      allRatesFabricated: false,
    });
    render(<HonestNumbersBanner messages={report.messages} />);

    expect(screen.queryByText(/\b7\b/)).not.toBeInTheDocument();
    expect(screen.getByText(/\$5 default/i)).toBeVisible(); // a RATE, not a count
  });
});
