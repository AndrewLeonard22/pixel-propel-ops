import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { makeSettings } from "@/test/factories";
import type { SourceKey, SourceStatus } from "@/lib/sourceStatus";

/**
 * @raccoon's UNAVAILABLE-vs-REAL-ZERO FIX, CLOSED AT THE ROW LAYER.
 *
 * He shipped it and said, correctly, that it had no row-level test — then sent it to the
 * verdict as an open gap, citing my own measurement that predicate / badge / row tests are
 * each blind to the others' defects, and concluding only @bird's drive could close it.
 *
 * ⭐ But this is the reachability lesson HE taught ME, pointed back at his file: "the
 * predicate is tested, the consumer is not" is not a testing-effort problem, it is a
 * REACHABILITY problem, and the fix is export or extraction rather than more unit tests.
 * `Agents` is already a default export reading one hook, so the consumer IS reachable —
 * mock the hook, mount the page, read what a human would read.
 *
 * WHY IT MATTERS ON THIS PAGE SPECIFICALLY: it is the one screen where the consequence is
 * MONEY. Before his fix, a DEAD Airtable and a HEALTHY-but-empty one rendered the identical
 * sentence, which on a payout screen reads as "nobody is owed anything". And it survived
 * every $0.00 sweep precisely because it is PROSE, not a number.
 */
const useDataMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useData", () => ({ useData: useDataMock }));

const { default: Agents } = await import("./Agents");

function sourceStatus(over: Partial<SourceStatus>): SourceStatus {
  return {
    label: "Appointments (Airtable)",
    state: "valid",
    error: null,
    missingSettings: [],
    configured: true,
    ...over,
  } as SourceStatus;
}

function mountWith(airtable: Partial<SourceStatus>, windsor: Partial<SourceStatus> = {}) {
  useDataMock.mockReturnValue({
    accounts: [],
    settings: makeSettings(),
    configured: true,
    sources: {
      windsor: sourceStatus({ label: "Ad spend (Windsor)", ...windsor }),
      airtable: sourceStatus(airtable),
      callCenter: sourceStatus({ label: "Calls (call-centre sheet)" }),
    } as Record<SourceKey, SourceStatus>,
  });
  return render(<Agents />);
}

beforeEach(() => useDataMock.mockReset());

describe("Agents — a dead payout source must not read as 'nobody is owed anything'", () => {
  it("AIRTABLE FAILED: says UNKNOWN, names the source, and names the reason", () => {
    mountWith({ state: "failed", error: "Airtable requires the server-side proxy" });

    expect(screen.getByText(/unknown, not zero/i)).toBeVisible();
    expect(screen.getByText(/Appointments \(Airtable\)/)).toBeVisible();
    expect(screen.getByText(/server-side proxy/)).toBeVisible();
    // The healthy-zero copy must NOT also be on screen.
    expect(screen.queryByText(/real zero/i)).not.toBeInTheDocument();
  });

  it("AIRTABLE NOT CONFIGURED: a DIFFERENT sentence, naming what is missing", () => {
    mountWith({
      state: "not-configured",
      configured: false,
      missingSettings: ["Airtable base ID"],
    });

    expect(screen.getByText(/not connected/i)).toBeVisible();
    expect(screen.getByText(/Airtable base ID/)).toBeVisible();
    expect(screen.queryByText(/real zero/i)).not.toBeInTheDocument();
  });

  it("🔴 THE CONTROL — AIRTABLE HEALTHY WITH ZERO APPOINTMENTS SAYS 'REAL ZERO'", () => {
    // Without this arm the fix is satisfiable by always showing the destructive banner,
    // which would be the mirror defect: refusing to report a genuine empty payout period.
    mountWith({ state: "valid" });

    expect(screen.getByText(/real zero/i)).toBeVisible();
    expect(screen.queryByText(/unknown, not zero/i)).not.toBeInTheDocument();
  });

  it("THE TWO STATES ARE DISTINGUISHABLE — same screen, different words", () => {
    const dead = mountWith({ state: "failed", error: "boom" }).container.textContent ?? "";
    useDataMock.mockReset();
    const healthy = mountWith({ state: "valid" }).container.textContent ?? "";

    // Before the fix these were byte-identical. That identity is the defect.
    expect(dead).not.toBe(healthy);
    expect(dead).toMatch(/unknown, not zero/i);
    expect(healthy).toMatch(/real zero/i);
  });

  it("🔴 BIRD-051: WINDSOR DEAD with a HEALTHY Airtable must NOT claim a real zero", () => {
    // The payout list reaches appointments THROUGH Windsor-derived accounts, so a dead
    // Windsor empties it while Airtable is fine. Asserting "real zero" there tells the
    // reader a trustworthy nobody-is-owed, which is the opposite of the truth.
    mountWith({ state: "valid" }, { state: "failed", error: "Failed to fetch" });
    expect(screen.queryByText(/real zero/i)).not.toBeInTheDocument();
    expect(screen.getByText(/unknown, not zero/i)).toBeVisible();
  });

  it("names the source that is ACTUALLY down, not always Airtable", () => {
    mountWith({ state: "valid" }, { state: "failed", error: "Failed to fetch" });
    expect(screen.getByText(/Ad spend/i)).toBeVisible();
  });
});
