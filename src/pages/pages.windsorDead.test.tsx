import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { makeSettings } from "@/test/factories";
import type { SourceKey, SourceStatus } from "@/lib/sourceStatus";

/**
 * THE SIXTH AND SEVENTH SURFACES — Targets and Media Buying.
 *
 * @apprentice found Targets; @raccoon then enumerated ALL TEN PAGES rather than taking
 * that one, and found TeamPerformance, which nobody had named. Both RE-DERIVE their own
 * accounts via buildAccountSummaries(filteredSpend, …), so a dead Windsor yields an EMPTY
 * list and every reduce(…, 0) returns a hard 0 — with NO source-state plumbing on either
 * page to stop it. The Dashboard at least had 5 of 9 tiles guarded; these had nothing.
 *
 * ⭐ THE METHOD IS THE FINDING: three times in one night this class landed because a
 * census matched the axis someone happened to be looking at — two directories, then the
 * Dashboard tiles, then one page. @raccoon's fix was not "be more careful", it was to
 * enumerate the whole population once, with a positive control proving the greps return
 * non-zero where the thing exists so a 0 is real rather than a dead pattern.
 *
 * ⚠️ TeamPerformance carries a second cost: it is a PER-PERSON scorecard. "$0.00 revenue ·
 * 0 closed" there is not a dashboard reading wrong, it is a scorecard reading wrong ABOUT
 * SOMEBODY.
 */
const useDataMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useData", () => ({ useData: useDataMock }));

const { default: Targets } = await import("./Targets");
const { default: TeamPerformance } = await import("./TeamPerformance");

function status(over: Partial<SourceStatus>): SourceStatus {
  return { label: "src", state: "valid", error: null, missingSettings: [], configured: true, ...over } as SourceStatus;
}

function setup(windsorState: SourceStatus["state"]) {
  useDataMock.mockReturnValue({
    accounts: [],
    adSpend: [],
    appointments: [],
    unmatchedAppointments: [],
    callData: [],
    settings: makeSettings(),
    loading: false,
    error: null,
    lastUpdated: null,
    configured: true,
    settingsLoaded: true,
    exclusions: { state: "active", configuredCount: 1, matchedCount: 1, unfilteredSpend: 0, affectedAccounts: [] },
    honestNumbers: { hasWarnings: false, messages: [], exclusion: {}, fabricatedRateCount: 0, allRatesFabricated: false },
    sources: {
      windsor: status({ label: "Ad spend (Windsor)", state: windsorState }),
      airtable: status({ label: "Appointments (Airtable)" }),
      callCenter: status({ label: "Calls (call-centre sheet)" }),
    } as Record<SourceKey, SourceStatus>,
    refresh: async () => {},
    setSettings: () => {},
  });
}

beforeEach(() => useDataMock.mockReset());

describe("Targets — every figure derives from Windsor, so a dead Windsor shows none", () => {
  it("🔴 WINDSOR DEAD: no fabricated money or percentage anywhere on the page", () => {
    setup("failed");
    const { container } = render(<Targets />);
    const text = container.textContent ?? "";

    expect(text).not.toMatch(/\$0\.00/);
    expect(text).not.toMatch(/0\.0%/);
    // And it says WHY, naming the source, rather than rendering an empty page.
    expect(screen.getByText(/Ad spend \(Windsor\) is unavailable/)).toBeVisible();
  });

  it("CONTROL: Windsor alive renders the page, it does not blank permanently", () => {
    setup("valid");
    const { container } = render(<Targets />);

    expect(container.textContent).not.toMatch(/is unavailable, and every figure/);
  });
});

describe("Media Buying — a per-person scorecard must not fabricate somebody's numbers", () => {
  it("🔴 WINDSOR DEAD: no per-buyer figure is fabricated", () => {
    setup("failed");
    const { container } = render(<TeamPerformance />);
    const text = container.textContent ?? "";

    expect(text).not.toMatch(/\$0\.00/);
    expect(screen.getByText(/every per-buyer figure is calculated from it/)).toBeVisible();
  });

  it("CONTROL: Windsor alive renders the page", () => {
    setup("valid");
    const { container } = render(<TeamPerformance />);

    expect(container.textContent).not.toMatch(/is unavailable, and every per-buyer/);
  });

  it("NOT-CONFIGURED is treated like dead, not like zero", () => {
    setup("not-configured");
    const { container } = render(<TeamPerformance />);

    expect(container.textContent).not.toMatch(/\$0\.00/);
  });
});
