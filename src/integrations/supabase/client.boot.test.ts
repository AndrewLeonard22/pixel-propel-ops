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
