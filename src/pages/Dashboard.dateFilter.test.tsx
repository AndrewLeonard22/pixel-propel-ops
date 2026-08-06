import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { makeSettings, makeAdSpendRow, makeAppointmentRow, makeCallRow } from "@/test/factories";
import type { SourceKey, SourceStatus } from "@/lib/sourceStatus";
import { buildAccountSummaries } from "@/lib/dataService";

/**
 * 🔴 PICKING A DATE RANGE RE-FABRICATED EVERY NUMBER A DEAD SOURCE OWNS.
 *
 * `useData` stamps the honest-state flags onto each account summary:
 *
 *   useData.tsx:203  buildAccountSummaries(adSpend, appts, s, calls, {
 *                      spend: hasUsableData(windsor), appts: …, calls: … })
 *
 * and its own comment says why — "passed down so the per-account rows cannot disagree with
 * the tiles above them". But THREE pages RECOMPUTE the summaries when a date range is
 * selected, and all three call the SAME function with only FOUR arguments:
 *
 *   Dashboard.tsx:681        buildAccountSummaries(fSpend, fAppts, settings, fCalls)
 *   Targets.tsx:110          buildAccountSummaries(fSpend, fAppts, settings, fCalls)
 *   TeamPerformance.tsx:82   buildAccountSummaries(fSpend, fAppts, settings, fCalls)
 *
 * The 5th parameter is optional and defaults `?? true`, so the recompute asserts that every
 * source is ALIVE. A dead Airtable's em dashes turn back into numbers the moment a user
 * clicks "This Week".
 *
 * ⭐ THIS IS THE CALL-SITE CLASS, AND NO TEST OF THE PURE FUNCTION CAN SEE IT.
 * dataService.known.test.ts proves buildAccountSummaries honours `known` perfectly; it is
 * right, and it is blind here, because the defect is an ARGUMENT THAT WAS NEVER PASSED.
 * The only instrument that catches it drives the actual control a user clicks.
 *
 * @fable's bar, verbatim: "kill Windsor, kill Airtable, kill Supabase, one at a time, and
 * prove NO source failure renders as a zero. That contract is the product." This is that
 * contract, in the state the contract was never checked in.
 */
const useDataMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useData", () => ({ useData: useDataMock }));

const { default: Dashboard } = await import("./Dashboard");

function status(over: Partial<SourceStatus>): SourceStatus {
  return { label: "src", state: "valid", error: null, missingSettings: [], configured: true, ...over } as SourceStatus;
}

const SETTINGS = makeSettings();

/**
 * A row dated TODAY, so it survives every preset window. The defect is about the flags
 * being dropped by the recompute, not about which rows the window admits — dating the
 * fixture outside the window would empty the table and hide the thing under test.
 */
const TODAY = new Date();
const iso = TODAY.toISOString().slice(0, 10);
const us = `${TODAY.getMonth() + 1}/${TODAY.getDate()}/${TODAY.getFullYear()}`;

const SPEND = [makeAdSpendRow({ accountName: "Acme", spent: 500, leads: 20, date: us, dateISO: iso })];
const APPTS = [makeAppointmentRow({ client: "Acme", appointmentDate: us, dateAdded: us })];
const CALLS = [makeCallRow({ ghlLocationName: "Acme", timestamp: us })];

/** Mount with Airtable dead — appointments are UNKNOWN, and must stay unknown. */
function mountAirtableDead() {
  const known = { spend: true, appts: false, calls: true };
  useDataMock.mockReturnValue({
    accounts: buildAccountSummaries(SPEND, APPTS, SETTINGS, CALLS, known).accounts,
    adSpend: SPEND,
    appointments: APPTS,
    callData: CALLS,
    unmatchedAppointments: [],
    settings: SETTINGS,
    loading: false,
    error: null,
    lastUpdated: null,
    configured: true,
    settingsLoaded: true,
    settingsOrigin: "database" as const,
    settingsDetail: null,
    exclusions: { state: "active", configuredCount: 1, matchedCount: 1, unfilteredSpend: 0, affectedAccounts: [] },
    honestNumbers: { hasWarnings: false, messages: [], exclusion: {}, fabricatedRateCount: 0, allRatesFabricated: false },
    sources: {
      windsor: status({ label: "Ad spend (Windsor)" }),
      airtable: status({ label: "Appointments (Airtable)", state: "failed", error: "Failed to fetch" }),
      callCenter: status({ label: "Calls (call-centre sheet)" }),
    } as Record<SourceKey, SourceStatus>,
    refresh: async () => {},
    setSettings: () => {},
  });
  return render(<Dashboard />);
}

/** The Acme data row's cells, by the row's accessible name rather than by index. */
function acmeCells(): string[] {
  const row = screen.getAllByRole("row").find(r => within(r).queryByText("Acme"));
  if (!row) throw new Error("Acme row not rendered — the fixture, not the assertion, is wrong");
  return Array.from(row.querySelectorAll("td")).map(td => (td.textContent ?? "").trim());
}

function selectPreset(label: string) {
  // Drive the real control. The picker is a disclosure button followed by preset buttons.
  fireEvent.click(screen.getByRole("button", { name: /all time/i }));
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}$`, "i") }));
}

beforeEach(() => useDataMock.mockReset());

describe("Dashboard date filter — a recompute must not resurrect a dead source's numbers", () => {
  it("BASELINE (All Time): a dead Airtable already renders — for the appointment cells", () => {
    // The control. If this ever fails the fixture is broken and every arm below is vacuous.
    mountAirtableDead();
    const c = acmeCells();

    expect(c).toContain("—");
    expect(c[1]).toBe("$500.00"); // spend survives: Windsor is alive
  });

  it("🔴 THE DEFECT: selecting THIS WEEK must not turn those em dashes into numbers", () => {
    mountAirtableDead();
    const before = acmeCells();
    const dashesBefore = before.filter(t => t === "—").length;

    selectPreset("This Week");
    const after = acmeCells();
    const dashesAfter = after.filter(t => t === "—").length;

    // Windsor is alive and the row is dated today, so the row must still be present with
    // its real spend — this is not "everything vanished", it is "the unknowns stayed unknown".
    expect(after[1]).toBe("$500.00");
    expect(dashesAfter).toBe(dashesBefore);
  });

  it("🔴 the same for TODAY — the defect is the recompute, not one preset", () => {
    mountAirtableDead();
    const dashesBefore = acmeCells().filter(t => t === "—").length;

    selectPreset("Today");

    expect(acmeCells().filter(t => t === "—").length).toBe(dashesBefore);
  });

  it("ANTI-VACUITY CONTROL: with every source ALIVE, a date range prints real numbers", () => {
    // Without this the fix is satisfiable by blanking the table whenever a range is picked.
    const known = { spend: true, appts: true, calls: true };
    useDataMock.mockReturnValue({
      accounts: buildAccountSummaries(SPEND, APPTS, SETTINGS, CALLS, known).accounts,
      adSpend: SPEND, appointments: APPTS, callData: CALLS, unmatchedAppointments: [],
      settings: SETTINGS, loading: false, error: null, lastUpdated: null,
      configured: true, settingsLoaded: true, settingsOrigin: "database" as const, settingsDetail: null,
      exclusions: { state: "active", configuredCount: 1, matchedCount: 1, unfilteredSpend: 0, affectedAccounts: [] },
      honestNumbers: { hasWarnings: false, messages: [], exclusion: {}, fabricatedRateCount: 0, allRatesFabricated: false },
      sources: {
        windsor: status({ label: "Ad spend (Windsor)" }),
        airtable: status({ label: "Appointments (Airtable)" }),
        callCenter: status({ label: "Calls (call-centre sheet)" }),
      } as Record<SourceKey, SourceStatus>,
      refresh: async () => {}, setSettings: () => {},
    });
    render(<Dashboard />);

    selectPreset("This Week");
    const c = acmeCells();

    expect(c[1]).toBe("$500.00");
    expect(c.filter(t => t === "—")).toHaveLength(0);
  });
});
