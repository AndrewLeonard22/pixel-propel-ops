/**
 * LIVE setup — the ONLY difference from src/test/setup.ts is that the Supabase env points at
 * the REAL production project instead of the stub, so the render harness measures what a
 * browser measures. Used exclusively by vitest.live.config.ts; the normal suite is untouched.
 */
import "@testing-library/jest-dom";
import { vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const env = Object.fromEntries(
  readFileSync(path.resolve(__dirname, "../../.env"), "utf8")
    .split("\n")
    .filter((l) => /^VITE_/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);
vi.stubEnv("VITE_SUPABASE_URL", env.VITE_SUPABASE_URL);
vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", env.VITE_SUPABASE_PUBLISHABLE_KEY);
vi.stubEnv("VITE_SUPABASE_PROJECT_ID", env.VITE_SUPABASE_PROJECT_ID);

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => {},
  }),
});
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
