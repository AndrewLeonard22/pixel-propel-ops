import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { makeSettings, makeAdSpendRow, makeAppointmentRow } from "@/test/factories";
import type { SourceKey, SourceStatus } from "@/lib/sourceStatus";
import { buildAccountSummaries } from "@/lib/dataService";

/**
 * ⑥ A TOTAL MUST COUNT EVERY APPOINTMENT.
 *
 * @bird, driven on the deployed build: `TOTAL APPTS` read 636 while 679 existed, and the
 * unmatched banner read 43. The tile reduces over ACCOUNTS, so an appointment attached to
 * no account is structurally invisible to it — @fable's own phrase for the class is
 * "a real booking invisible to the headline".
 *
 * ⭐ AND IT IS THE SAME DEFECT ON TWO SURFACES: /calendar counts an unresolved-client
 * appointment, the dashboard tile does not. Fixing one said nothing about the other.
 *
 * ⚠️ THE RATE TILES ARE DELIBERATELY UNTOUCHED — @raccoon: "an unmatched appt has no
 * ACCOUNT so it has no PROGRAM; adding it to a DFY-only RATE attributes a conversion to a
 * population it may not be in. A TOTAL must count it, a RATE must not." Both halves are
 * asserted here, because a fix that moved both would have looked correct on the tile that
 * was being watched.
 */
const useDataMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useData", () => ({ useData: useDataMock }));

const { default: Dashboard } = await import("./Dashboard");

function status(over: Partial<SourceStatus> = {}): SourceStatus {
  return { label: "src", state: "valid", error: null, missingSettings: [], configured: true, ...over } as SourceStatus;
}

const SETTINGS = makeSettings();
const SPEND = [makeAdSpendRow({ accountName: "Acme", spent: 500, leads: 20 })];
/** One appointment that matches Acme, so the attributed count is a real non-zero. */
const MATCHED = [makeAppointmentRow({ client: "Acme" })];

function mount(unmatched: ReturnType<typeof makeAppointmentRow>[]) {
  const built = buildAccountSummaries(SPEND, MATCHED, SETTINGS, []);
  useDataMock.mockReturnValue({
    accounts: built.accounts,
    adSpend: SPEND,
    appointments: [...MATCHED, ...unmatched],
    unmatchedAppointments: unmatched,
    callData: [],
    settings: SETTINGS,
    loading: false, error: null, lastUpdated: null,
    configured: true, settingsLoaded: true,
    settingsOrigin: "database" as const, settingsDetail: null,
    unresolvedClients: unmatched.length,
    refreshVerdict: null,
    completeness: { state: "complete" as const, rawRows: 1, derivedRows: 1, droppedRows: 0, reason: null },
    exclusions: { state: "active", configuredCount: 1, matchedCount: 1, unfilteredSpend: 0, affectedAccounts: [] },
    honestNumbers: { hasWarnings: false, messages: [], exclusion: {}, fabricatedRateCount: 0, allRatesFabricated: false },
    sources: {
      windsor: status({ label: "Ad spend (Windsor)" }),
      airtable: status({ label: "Appointments (Airtable)" }),
      callCenter: status({ label: "Calls (call-centre sheet)" }),
    } as Record<SourceKey, SourceStatus>,
    refresh: async () => {},
    setSettings: () => {},
  });
  return render(<Dashboard />);
}

/** A tile's rendered value, read by its label rather than by position. */
function tile(label: string): string {
  const el = screen.getByText(label).parentElement;
  return el?.querySelector("p:nth-child(2)")?.textContent?.trim() ?? "";
}

beforeEach(() => useDataMock.mockReset());

describe("TOTAL APPTS — a total counts every appointment, matched or not", () => {
  it("🔴 ANTI-VACUITY CONTROL: with NO unmatched, the tile is the attributed count", () => {
    // Run first. Without it, a fix that always added a constant would pass the arm below.
    mount([]);
    expect(tile("Total Appts")).toBe("1");
    expect(screen.queryByText(/not matched to an account/i)).not.toBeInTheDocument();
  });

  it("🔴 THE DEFECT: unmatched appointments are INCLUDED in the total", () => {
    // @bird's shape at small scale: 1 attributed + 3 unmatched must read 4, not 1.
    mount([makeAppointmentRow({}), makeAppointmentRow({}), makeAppointmentRow({})]);
    expect(tile("Total Appts")).toBe("4");
  });

  it("🔑 and the tile SAYS its composition changed — a silent recomposition is the defect above", () => {
    mount([makeAppointmentRow({}), makeAppointmentRow({})]);
    expect(screen.getByText(/includes 2 not matched to an account/i)).toBeVisible();
  });

  it("🔴 THE RATE TILES DO NOT MOVE — @raccoon's constraint, asserted both ways", () => {
    // A fix that added unmatched to the DFY rate would attribute a conversion to a
    // population the appointment may not be in. One number moves; the other must not.
    const first = mount([]);
    const rateBefore = tile("Lead → Appt %");
    const costBefore = tile("Avg Cost/Appt");
    // UNMOUNT: two Dashboards in one document makes getByText ambiguous, and the arm fails
    // for a reason that has nothing to do with the numbers under test.
    first.unmount();

    useDataMock.mockReset();
    mount([makeAppointmentRow({}), makeAppointmentRow({}), makeAppointmentRow({})]);

    expect(tile("Total Appts")).toBe("4");        // the TOTAL moved
    expect(tile("Lead → Appt %")).toBe(rateBefore);   // the RATES did not
    expect(tile("Avg Cost/Appt")).toBe(costBefore);
  });
});

/**
 * 🟡 THE DISCLOSURE MUST SURVIVE THE FILTER — @bird, driven live.
 *
 * In a narrowed view the 43 unmatched are correctly EXCLUDED, and the note explaining them
 * disappeared with them because it was gated on the same value. The banner two inches away
 * still read "43 Unmatched Appointments".
 *
 * ⭐ THE APP WAS DROPPING 43 APPOINTMENTS SILENTLY WHILE ANOTHER ELEMENT ON THE SAME SCREEN
 * SAID THEY EXISTED. The exclusion is correct; the disclosure vanished exactly when a
 * reader would want it — a number changing composition with nothing on screen to say so is
 * the defect ⑥ was built to remove, reappearing one filter later.
 */
describe('TOTAL APPTS — the disclosure survives narrowing', () => {
  it('🔴 a NARROWED view says the unmatched are EXCLUDED, not nothing', () => {
    mount([makeAppointmentRow({}), makeAppointmentRow({}), makeAppointmentRow({})]);
    expect(screen.getByText(/includes 3 not matched/i)).toBeVisible();

    // Narrow the view the way a user does — the real control, not a prop.
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'Acme' } });

    expect(screen.getByText(/excludes 3 not matched to an account/i)).toBeVisible();
    expect(screen.queryByText(/includes 3 not matched/i)).not.toBeInTheDocument();
  });

  it('🔴 and the TOTAL drops to the matched-only count in that state', () => {
    mount([makeAppointmentRow({}), makeAppointmentRow({}), makeAppointmentRow({})]);
    expect(tile("Total Appts")).toBe("4");

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'Acme' } });
    expect(tile("Total Appts")).toBe("1");
  });

  it('🔑 ANTI-VACUITY CONTROL: with NO unmatched, narrowing renders no note either way', () => {
    // Without this, a fix that always printed one of the two sentences would pass above.
    mount([]);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'Acme' } });
    expect(screen.queryByText(/not matched to an account/i)).not.toBeInTheDocument();
  });
});
