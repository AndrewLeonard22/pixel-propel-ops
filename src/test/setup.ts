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
 *
 * ⚠️ AMENDED 2026-08-11. The paragraph above said `.env` "is now correctly untracked and
 * gitignored". It was RE-TRACKED (commit a258f00) because untracking it removed the
 * project URL from the BUILD and deployed an app with no database — see the note in
 * `.gitignore`. The stubs are still required, and now for a stronger reason than a missing
 * file: they make the suite INDEPENDENT of whichever project `.env` points at, so a test
 * run can never be quietly measuring the real production database.
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

/**
 * ⚠️ `ResizeObserver` DOES NOT EXIST IN jsdom, and Radix's Popover measures its trigger.
 * Without this stub every component built on `ui/combobox` (the control that answers "the
 * dropdowns on here look horrendous") throws on open and is therefore untestable — which is
 * how a control can end up with no coverage at all despite being the point of a complaint.
 * A no-op observer is honest here: nothing in jsdom has a size to report anyway.
 */
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

/** cmdk scrolls the highlighted item into view; jsdom has no scrolling at all. */
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
