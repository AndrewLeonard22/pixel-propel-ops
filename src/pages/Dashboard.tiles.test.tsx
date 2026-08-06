import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { makeSettings } from "@/test/factories";
import type { SourceKey, SourceStatus } from "@/lib/sourceStatus";

/**
 * @bird's P1, AT THE TILE LAYER — THE FIFTH SURFACE.
 *
 * He drove it and @raccoon censused it from source. All nine KPI totals reduce over
 * `activeAccounts`, and activeAccounts is WINDSOR-DERIVED (buildAccountSummaries(adSpend,…)
 * — no sheet rows, no accounts). So Windsor dying yields an EMPTY ARRAY, every
 * `reduce(…, 0)` returns a hard 0, and any guard that does not name Windsor renders it.
 *
 * Measured on the live app: Windsor dead ⇒ TOTAL DIALS 0 with 3,102 dials ALIVE, and TOTAL
 * APPTS 0 while Airtable was HEALTHY AND HOLDING THE APPOINTMENT. Not a definitional zero
 * — the same tile prints 1 when Windsor is alive.
 *
 * ⭐ THE RULE: a guard must name every source the DERIVATION TRAVERSES, not the source the
 * value semantically belongs to. `dials` IS call-centre data, which is exactly why
 * `callsOk` alone looked correct.
 *
 * ⚠️ AND @raccoon FOUND TWO MORE THAN THE DRIVE DID: Closed Deals was never driven, and
 * Revenue was dropped because @bird's synthetic record carried no revenue field — so it
 * read $0.00 in BOTH arms and could not discriminate. Sound instrument, incomplete
 * fixture. Both are covered here.
 */
const useDataMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useData", () => ({ useData: useDataMock }));

const { default: Dashboard } = await import("./Dashboard");

function status(over: Partial<SourceStatus>): SourceStatus {
  return {
    label: "src",
    state: "valid",
    error: null,
    missingSettings: [],
    configured: true,
    ...over,
  } as SourceStatus;
}

function mount(windsorState: SourceStatus["state"]) {
  useDataMock.mockReturnValue({
    // Windsor dead ⇒ NO accounts, which is the whole mechanism: the totals reduce over [].
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
  return render(<Dashboard />);
}

/** The tile's rendered value, read by its label rather than by position. */
function tile(label: string): string {
  const el = screen.getByText(label).parentElement;
  return el?.querySelector("p:last-child")?.textContent?.trim() ?? "";
}

beforeEach(() => useDataMock.mockReset());

// ⛔ The "Total Dials" tile was REMOVED from the dashboard 2026-08-05 (@andrew: dials
// live on Relay now). Its assertions are deleted here; the arms around them still cover
// the OTHER tiles, which is the coverage that was never about dials. Dials remain on
// /call-center and /targets and are tested there.
describe("KPI tiles — a guard must name every source the DERIVATION traverses", () => {
  it("🔴 WINDSOR DEAD: the four join-valued tiles refuse instead of printing 0", () => {
    mount("failed");

    // These are the four @bird and @raccoon identified. Before the fix each rendered a
    // hard 0 from a reduce over an empty Windsor-derived array.
    expect(tile("Total Appts")).toBe("—");
    expect(tile("Closed Deals")).toBe("—"); // never driven by anyone
    expect(tile("Total Revenue")).toBe("—"); // @bird's fixture could not discriminate
  });

  it("WINDSOR DEAD: the Windsor-guarded tiles were already correct and stay correct", () => {
    mount("failed");

    expect(tile("Total Spend")).toBe("—");
    expect(tile("Total Leads")).toBe("—");
    expect(tile("Avg CPL")).toBe("—");
  });

  it("🔴 CONTROL — WINDSOR ALIVE: the tiles print numbers, they do not blank", () => {
    // Without this the fix is satisfiable by blanking the tiles permanently, which is the
    // mirror defect: refusing to report data the app actually has.
    mount("valid");

    expect(tile("Total Appts")).not.toBe("—");
    expect(tile("Closed Deals")).not.toBe("—");
    expect(tile("Total Revenue")).not.toBe("—");
  });

  it("NOT-CONFIGURED is treated like dead, not like zero", () => {
    mount("not-configured");

    expect(tile("Total Appts")).toBe("—");
  });
});
