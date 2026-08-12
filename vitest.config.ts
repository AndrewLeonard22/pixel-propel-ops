import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  /**
   * 🔴 THE TRANSFORM CACHE MUST NOT LIVE UNDER `node_modules`, and this is not tidiness.
   *
   * Vitest's default cache dir is `<root>/node_modules/.vite`. Every git worktree cut from
   * this repo is created with `node_modules` SYMLINKED back to the main checkout — it is how
   * a 700MB install is avoided — so `<worktree>/node_modules/.vite` and
   * `<main>/node_modules/.vite` are THE SAME PHYSICAL DIRECTORY. Two checkouts at different
   * commits then share one transform cache keyed on file path.
   *
   * ⚠️ MEASURED, 2026-08-12: a verification run in such a worktree (pinned at the pre-cutover
   * HEAD) poisoned this checkout's cache, and the suite here began failing 1–17 tests
   * NONDETERMINISTICALLY — pure functions returning the wrong branch, because the module
   * being executed was the OTHER commit's. It reads exactly like a real branch defect and
   * cost a verification pass before the instrument was blamed. A cache that can serve one
   * commit's code to another commit's test is a measuring device that changes its answer
   * based on who used it last.
   *
   * `.vite-cache` sits under the project ROOT, which is a real per-worktree directory that
   * nothing symlinks, so the collision is not merely unlikely — it is unrepresentable.
   */
  cacheDir: path.resolve(__dirname, "./.vite-cache"),
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    /**
     * ⭐ REFUSES TO RUN INSIDE A `gates.mjs` RUN. That script writes faults into this tree on
     * purpose and restores them seconds later; a suite that lands in the window reports a red
     * belonging to no tree at all, which is exactly what three verification passes filed on
     * 2026-08-12. See the file for why a refusal beats a colour, and why a stale lock is
     * ignored rather than obeyed.
     *
     * ⚠️ `globalSetup`, NOT `setupFiles`: setup files run per test FILE inside a worker, so
     * the refusal would arrive 73 times as 73 failures — a red, i.e. the exact thing being
     * removed. globalSetup runs ONCE in the main process and aborts the run.
     */
    globalSetup: ["./src/test/gatesLock.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
