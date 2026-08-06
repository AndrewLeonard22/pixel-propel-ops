import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSettings } from "@/test/factories";

/**
 * POPULATION UNDER TEST
 *   Every outcome @apprentice's edge function can hand back, plus the two the SDK can
 *   produce on its own (transport error, malformed payload) — against the one property
 *   that matters: a failure must THROW, never resolve to an empty list.
 *
 * WHY THIS EXISTS
 *   BIRD-008, at its origin. `{records: []}` on failure is the ergonomic thing to write
 *   and it renders as "zero appointments" — a confident claim drawn from a dead source.
 *   @apprentice enforced it server-side (proxy.contract.test.ts asserts no fail() path
 *   returns 2xx); these assert the CLIENT cannot undo it. Both ends, or the contract holds
 *   nowhere.
 *
 * ⚠️ CREDENTIALS: the browser holds none. The proxy reads its token from its own
 *   environment, which is why this patch is credential-free — there is nothing here to
 *   leak, and nothing in these tests goes near one.
 */
const invoke = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => ({
  isSupabaseConfigured: true,
  supabase: { functions: { invoke } },
}));

const { fetchAirtableData } = await import("./dataService");
const SETTINGS = makeSettings({
  airtableBaseId: "appREAL",
  airtableTableName: "Appointments",
  // makeSettings ships an EMPTY columnMappings, so an unmapped lookup silently returns ''.
  // Setting the one indirect mapping deliberately means the anti-vacuity control below
  // exercises the mapping rather than stepping around it — the Airtable column really is
  // named "Closed Revenue ($)" while the code asks for "Closed Revenue".
  columnMappings: { "Closed Revenue": "Closed Revenue ($)" },
});

beforeEach(() => invoke.mockReset());

describe("fetchAirtableData — a dead proxy must never read as zero appointments", () => {
  it("refuses BEFORE calling out when no base id is configured", async () => {
    await expect(fetchAirtableData(makeSettings({ airtableBaseId: "" }))).rejects.toThrow(
      /not configured/i,
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("sends the base id and table name, and NEVER a credential", async () => {
    invoke.mockResolvedValue({ data: { status: "ok", records: [], fields: [] }, error: null });

    await fetchAirtableData(SETTINGS);

    expect(invoke).toHaveBeenCalledWith("airtable-proxy", {
      body: { baseId: "appREAL", tableName: "Appointments" },
    });
    // The body is exactly two fields. A token cannot ride along even by accident.
    const [, opts] = invoke.mock.calls[0];
    expect(Object.keys(opts.body)).toEqual(["baseId", "tableName"]);
  });

  it("THROWS on a transport error rather than resolving empty", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("Failed to fetch") });

    await expect(fetchAirtableData(SETTINGS)).rejects.toThrow(/Failed to fetch/);
  });

  it("surfaces the PROXY's own message, not the SDK's generic non-2xx text", async () => {
    // "Edge Function returned a non-2xx status code" names nothing a user can act on.
    // The proxy sends {status, message}; that is what a human needs to see.
    const err = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      context: { json: async () => ({ status: "auth_failed", message: "Airtable rejected the token." }) },
    });
    invoke.mockResolvedValue({ data: null, error: err });

    await expect(fetchAirtableData(SETTINGS)).rejects.toThrow(/Airtable rejected the token/);
  });

  it("falls back to the generic message when the error body is unreadable", async () => {
    const err = Object.assign(new Error("non-2xx"), {
      context: { json: async () => { throw new Error("not json"); } },
    });
    invoke.mockResolvedValue({ data: null, error: err });

    // Must still throw — an unreadable error body is not permission to invent success.
    await expect(fetchAirtableData(SETTINGS)).rejects.toThrow(/non-2xx/);
  });

  it("🔴 THROWS when a non-ok status arrives with HTTP 200 — the laundering case", async () => {
    // If the proxy ever regressed to returning failures as 200 with records: [], this is
    // the assertion that stops it reaching the dashboard as a real zero.
    invoke.mockResolvedValue({
      data: { status: "unreachable", message: "Could not reach Airtable", records: [] },
      error: null,
    });

    await expect(fetchAirtableData(SETTINGS)).rejects.toThrow(/unusable response/);
  });

  it("THROWS when records is missing or not an array", async () => {
    invoke.mockResolvedValue({ data: { status: "ok" }, error: null });
    await expect(fetchAirtableData(SETTINGS)).rejects.toThrow(/unusable response/);

    invoke.mockResolvedValue({ data: { status: "ok", records: null }, error: null });
    await expect(fetchAirtableData(SETTINGS)).rejects.toThrow(/unusable response/);
  });

  it("🔑 404 says THE FUNCTION IS NOT DEPLOYED — the first-execution failure", async () => {
    // @apprentice measured that the edge functions have NEVER executed in any
    // environment. Step 1 of DEPLOY.md is their first run ever, so a failure there is
    // expected at least once — and "returned a non-2xx status code" would send someone to
    // debug a token for a function that was never pasted.
    const err = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      context: { status: 404, json: async () => ({}) },
    });
    invoke.mockResolvedValue({ data: null, error: err });

    await expect(fetchAirtableData(SETTINGS)).rejects.toThrow(/not deployed/i);
    await expect(fetchAirtableData(SETTINGS)).rejects.toThrow(/not a token problem/i);
  });

  it("CONTROL: a non-404 still surfaces the proxy's own message, not the 404 copy", async () => {
    const err = Object.assign(new Error("non-2xx"), {
      context: { status: 401, json: async () => ({ status: "auth_failed", message: "Airtable rejected the token." }) },
    });
    invoke.mockResolvedValue({ data: null, error: err });

    await expect(fetchAirtableData(SETTINGS)).rejects.toThrow(/Airtable rejected the token/);
  });

  it("ANTI-VACUITY CONTROL: a real payload maps through to AppointmentRows", async () => {
    invoke.mockResolvedValue({
      data: {
        status: "ok",
        fields: ["Client Name"],
        records: [
          {
            /**
             * ⚠️ WIDENED WHEN THE AIRTABLE COLUMN CONTRACT LANDED. This was five fields,
             * which no real payload looks like — @fable measured 36 distinct field names
             * across 679 records — so a REAL requirement (`Lead Status` must exist) read as
             * an over-strict check.
             *
             * ⭐ THE CONTRACT WAS VERIFIED AGAINST LIVE EVIDENCE BEFORE THIS FIXTURE WAS
             * TOUCHED, because "fix the fixture" is exactly how a wrong contract gets
             * laundered. All four criticals are confirmed present in @andrew's base by two
             * other seats: Client Name (@bird, 99/100), Appointment Date (the live calendar
             * places by it), Closed Revenue ($) (@fable, 46/679), Lead Status (@fable
             * counted its value distribution for D1).
             */
            fields: {
              "Client Name": "Acme",
              "Appointment Date": "8/4/2026",
              "Lead Valid": "Valid",
              "Closed Revenue ($)": "1,250.50",
              "Lead Status": "Closed Won",
              "Show Status": "Showed",
              "Campaign Name": "SW | Leads Campaign",
              "Ad Set Name": "AS",
              "Ad Name": "Ad",
              Setter: "Bob",
            },
          },
        ],
      },
      error: null,
    });

    const { records, fields } = await fetchAirtableData(SETTINGS);

    expect(records).toHaveLength(1);
    expect(records[0].client).toBe("Acme");
    expect(records[0].setter).toBe("Bob");
    expect(records[0].closedRevenue).toBe(1250.5); // through the column mapping AND parseNumber
    expect(fields).toEqual(["Client Name"]);
  });

  it("an EMPTY list under status ok is a REAL zero and must NOT throw", async () => {
    // The one case where zero appointments is the truth. Blanket-throwing here would be
    // the mirror of the bug: refusing to report a genuine empty result.
    invoke.mockResolvedValue({ data: { status: "ok", records: [], fields: [] }, error: null });

    const { records } = await fetchAirtableData(SETTINGS);
    expect(records).toEqual([]);
  });
});
