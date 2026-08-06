import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * POPULATION UNDER TEST
 *   The two env vars this module reads, across the four presence combinations, plus the
 *   property that actually matters: IMPORTING the module must never throw.
 *
 * WHY THIS EXISTS — MEASURED, NOT IMAGINED
 *   With `.env` correctly untracked, `createClient` threw "supabaseUrl is required" during
 *   import. Because config.ts imports this and effectively everything imports config.ts,
 *   the application died before React mounted: #root 0 bytes, white screen, zero requests.
 *   The unit suite was green throughout, because the test setup stubs the vars — which is
 *   exactly why this test asserts on the UNSTUBBED case explicitly.
 */
beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("supabase client — a missing env var degrades, it does not annihilate", () => {
  it("IMPORTS WITHOUT THROWING when BOTH vars are absent", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");

    const mod = await import("./client");

    expect(mod.supabase).toBeDefined();
    expect(mod.isSupabaseConfigured).toBe(false);
  });

  it("imports without throwing when only the URL is absent", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "some-key");

    const mod = await import("./client");
    expect(mod.isSupabaseConfigured).toBe(false);
  });

  it("imports without throwing when only the key is absent", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");

    const mod = await import("./client");
    expect(mod.isSupabaseConfigured).toBe(false);
  });

  it("🔴 THE BLANK PAGE: a PRESENT but INVALID url must not throw at import", async () => {
    // @bird drove the deployed site: #root 0 bytes, ONE network request, and
    // "Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL" thrown at MODULE SCOPE.
    // My original guard was `SUPABASE_URL || fallback` — `||` catches ABSENT and lets a
    // present-but-invalid value through to createClient. These are the shapes that throw.
    // ⚠️ THE LAST TWO PARSE AS URLs AND STILL THROW. Without them the protocol branch is
    // untested: sabotage arm S2 removed the http/https check and ZERO tests failed,
    // because every other shape here fails `new URL()` outright and never reaches it.
    // Measured: ftp:// and wss:// parse cleanly and createClient throws on both.
    for (const bad of [
      "abcdefghijklmnop", "x.supabase.co", "not a url", "   ",
      "ftp://x.supabase.co", "wss://x.supabase.co",
    ]) {
      vi.resetModules();
      vi.stubEnv("VITE_SUPABASE_URL", bad);
      vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "a-key");

      const mod = await import("./client");

      expect(mod.supabase).toBeDefined();
      expect(mod.isSupabaseConfigured).toBe(false);
    }
  });

  it("names WHICH failure it is — set-but-invalid is not the same as missing", async () => {
    // "missing" sends someone to add a var; "invalid" sends them to fix its value.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("VITE_SUPABASE_URL", "abcdefghijklmnop");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "a-key");

    await import("./client");

    expect(spy.mock.calls.flat().join(" ")).toMatch(/set but is not a valid http\(s\) URL/);
    spy.mockRestore();
  });

  it("ANTI-VACUITY CONTROL: reports CONFIGURED when both are present", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "a-key");

    const mod = await import("./client");
    expect(mod.isSupabaseConfigured).toBe(true);
    expect(mod.supabase).toBeDefined();
  });

  it("the whole config module imports cleanly with no env at all", async () => {
    // This is the real regression: config.ts is what every page reaches through.
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");

    const config = await import("@/lib/config");
    expect(typeof config.isConfigured).toBe("function");
  });
});
