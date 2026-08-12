/**
 * ⑫ A TEST RUN THAT LANDS INSIDE A GATES RUN MUST REFUSE, NOT REPORT A COLOUR.
 *
 * 🔴 THE DEFECT, WATCHED HAPPENING. @raccoon, 2026-08-12: "I watched one plant
 * `__GATE_CONTROL_POISON` into `dataService.ts` at 02:07 and clean up ~30s later… my
 * full-suite run caught the window and reported a false `1 failed`." Two other verification
 * passes filed intermittent reds on this branch in the same night, one of them against the
 * cutover's own completeness guards, and every one of those failures was UNREPRODUCIBLE in
 * isolation.
 *
 * `scripts/gates.mjs` deliberately writes faults into the working tree — a type error into
 * `src/lib/dataService.ts`, an unresolvable import into `src/main.tsx`, and a failing test
 * file — and restores them seconds later. That is exactly what makes its controls controls.
 * It already holds `.gates.lock` so a second GATES run refuses. Nothing protected anybody
 * ELSE: a plain `npx vitest run`, a CI job, or another agent reads a tree that is broken ON
 * PURPOSE and reports a red that belongs to no tree at all.
 *
 * ⭐ A REFUSAL IS A VALUE; A WRONG RED IS NOT. The cost of the wrong red is not the minute
 * it wastes — it is that it teaches people to re-run until green, which is the habit that
 * makes every real red survivable too. So this stops the run and NAMES the reason instead of
 * emitting a verdict nobody can act on.
 *
 * ⛔ IT MUST NOT BLOCK THE GATES RUN'S OWN VITEST. `gates.mjs` holds the lock while invoking
 * `npx vitest run` — the whole point — so it stamps `GATES_RUN=1` into its environment and
 * every child inherits it. That env var is the ONLY exemption, and it is set by the one
 * process that legitimately holds the lock.
 *
 * ⚠️ A LOCK NOBODY HOLDS IS LITTER, NOT A LOCK. A crashed gates run leaves the file behind,
 * and a refusal keyed on the FILE would then block every test run on the machine forever —
 * a guard that fails closed onto the whole team. `kill(pid, 0)` signals nothing and throws
 * ESRCH when the process is gone, so the question asked is "is that process alive", not "is
 * there a file". The same rule `gates.mjs` uses on its own lock, for the same reason.
 */
import { existsSync, readFileSync } from 'node:fs';

const LOCK = '.gates.lock';

export default function setup(): void {
  // The one legitimate holder's own children.
  if (process.env.GATES_RUN === '1') return;
  if (!existsSync(LOCK)) return;

  let held: number;
  try {
    held = Number(String(readFileSync(LOCK, 'utf8')).split('\n')[0]);
  } catch {
    // The lock vanished between the two calls — the run we would have refused for has
    // finished. Nothing to refuse.
    return;
  }
  if (!Number.isInteger(held) || held <= 0) return;

  let alive = true;
  try {
    process.kill(held, 0);
  } catch (err) {
    alive = (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
  if (!alive) return; // stale lock from a dead run; gates.mjs clears it on its next attempt

  throw new Error(
    `\n🔴 REFUSING TO RUN: scripts/gates.mjs is running (pid ${held}).\n` +
      `   It plants faults into src/lib/dataService.ts, src/main.tsx and a temporary test\n` +
      `   file ON PURPOSE, and restores them seconds later. Any result from this tree right\n` +
      `   now describes a deliberately broken checkout, not your code — measured 2026-08-12,\n` +
      `   a full-suite run caught that window and reported a false failure.\n` +
      `   Wait for it to finish, or remove ${LOCK} if you are certain that pid is gone.\n`,
  );
}
