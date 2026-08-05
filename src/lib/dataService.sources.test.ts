import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchAllSources } from "./dataService";
import { makeSettings } from "@/test/factories";

/**
 * POPULATION UNDER TEST
 *   The 3 sources × 3 outcomes (ok / not-configured / failed) that fetchAllSources can
 *   produce, plus the cross-source isolation property that is the whole point of it.
 *
 * WHY THIS EXISTS — MEASURED, NOT IMAGINED
 *   On production, with a real sheet URL restored and Airtable unavailable, Windsor was
 *   fetched successfully (1 request) and the screen still rendered $0.00 plus an Airtable
 *   error, because Promise.all discards resolved values when a sibling rejects. A partial
 *   restore reads as a total failure. These tests fail if that coupling comes back.
 */
const SHEET_CSV =
  "Month,Date,Campaign,Campaign Id,Adset Name,Adset Id,Ad Name,Ad Id,Spent,Leads,Account Name\n" +
  "August,8/4/2026,C,111,AS,222,AD,333,350.00,7,Acme";

const CALLS_CSV =
  "Timestamp,ghl_location_name,Agent Name,Call Duration,call_dispostion\n" +
  "2026-08-04,Acme,Ann,120,answered";

function mockFetch(handler: (url: string) => { ok: boolean; body?: string }) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const r = handler(url);
    return {
      ok: r.ok,
      status: r.ok ? 200 : 500,
      text: async () => r.body ?? "",
      json: async () => JSON.parse(r.body ?? "{}"),
    } as Response;
  });
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("fetchAllSources — one outcome per source", () => {
  it("reports not-configured WITHOUT fetching, and never confuses it with an empty answer", async () => {
    const spy = mockFetch(() => ({ ok: true, body: "" }));
    vi.stubGlobal("fetch", spy);

    const r = await fetchAllSources(
      makeSettings({ googleSheetUrl: "", callCenterSheetUrl: "", airtableBaseId: "" }),
    );

    expect(r.googleSheet).toEqual({ status: "not-configured" });
    expect(r.airtable).toEqual({ status: "not-configured" });
    expect(r.callCenter).toEqual({ status: "not-configured" });
    // The distinction that matters: nothing was ASKED. An empty list would be a lie here.
    expect(spy).not.toHaveBeenCalled();
  });

  it("THE REGRESSION THIS EXISTS FOR: a failing Airtable must NOT discard Windsor", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(url =>
        url.includes("TESTSHEETID")
          ? { ok: true, body: SHEET_CSV }
          : url.includes("TESTCALLID")
            ? { ok: true, body: CALLS_CSV }
            : { ok: false },
      ),
    );

    const r = await fetchAllSources(makeSettings());

    // Windsor survived a sibling's failure — the Promise.all coupling would lose this.
    expect(r.googleSheet.status).toBe("ok");
    if (r.googleSheet.status === "ok") {
      expect(r.googleSheet.data).toHaveLength(1);
      expect(r.googleSheet.data[0].spent).toBe(350);
      expect(r.googleSheet.data[0].dateISO).toBe("2026-08-04");
    }
    expect(r.callCenter.status).toBe("ok");

    // And Airtable failed LOUDLY rather than returning an empty list.
    expect(r.airtable.status).toBe("failed");
    if (r.airtable.status === "failed") expect(r.airtable.error).toBeTruthy();
  });

  it("a failing Windsor does not suppress the other two either — isolation is symmetric", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(url =>
        url.includes("TESTCALLID") ? { ok: true, body: CALLS_CSV } : { ok: false },
      ),
    );

    const r = await fetchAllSources(makeSettings());

    expect(r.googleSheet.status).toBe("failed");
    expect(r.callCenter.status).toBe("ok");
  });

  it("ANTI-VACUITY CONTROL: with every source healthy, all three report ok", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(url =>
        url.includes("TESTSHEETID")
          ? { ok: true, body: SHEET_CSV }
          : url.includes("TESTCALLID")
            ? { ok: true, body: CALLS_CSV }
            : { ok: true, body: JSON.stringify({ records: [] }) },
      ),
    );

    const r = await fetchAllSources(makeSettings());
    expect(r.googleSheet.status).toBe("ok");
    expect(r.callCenter.status).toBe("ok");
    // Airtable still fails by design until the proxy exists — asserted so that the day
    // someone builds the proxy, this test tells them to revisit it rather than staying green.
    expect(r.airtable.status).toBe("failed");
  });
});
