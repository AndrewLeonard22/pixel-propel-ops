import "@testing-library/jest-dom";
import { vi } from "vitest";

/**
 * Supabase env stubs — REQUIRED, not a convenience.
 *
 * `src/integrations/supabase/client.ts` calls createClient() at MODULE SCOPE, so merely
 * importing anything that reaches config.ts throws "supabaseUrl is required" when the
 * vars are absent. Since `.env` is now correctly untracked and gitignored (order ②), a
 * fresh checkout has none — so without these stubs the suite dies at import for every
 * seat, and the failure names Supabase rather than the missing file.
 *
 * These are syntactically valid placeholders that reach no network. Any test that needs
 * a real Supabase must stub the client itself; nothing here should ever hold a secret.
 */
vi.stubEnv("VITE_SUPABASE_URL", "https://stub.supabase.co");
vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "stub-anon-key-not-a-credential");
vi.stubEnv("VITE_SUPABASE_PROJECT_ID", "stub-project");

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
