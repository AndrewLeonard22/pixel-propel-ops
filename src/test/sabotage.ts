/**
 * SABOTAGE HARNESS — makes the DoD's "sabotage-proven" mechanical rather than a promise.
 *
 * THE PROBLEM IT SOLVES: a passing test proves the code does something. It does NOT prove
 * the test would have NOTICED had the code been wrong. A test suite that cannot fail is
 * indistinguishable from no test suite, and it reads GREEN either way — which is worse
 * than red, because it retires the ticket.
 *
 * WHAT THIS DOES: you supply the real implementation, a set of deliberately broken
 * variants, and the assertion block. The harness asserts:
 *   ① the assertions PASS against the real implementation   (else the test is broken)
 *   ② the assertions FAIL against EVERY broken variant      (else the test is vacuous)
 * A variant that survives is reported BY NAME, because "some poison survived" is not
 * actionable and "poison «ignores the airtable token» survived" is.
 *
 * NAMING THE POPULATION is required, not decorative: it is printed on failure so the
 * reader learns what the test covered without opening the file.
 */
import { expect } from 'vitest';

export interface SabotageSpec<F extends (...args: never[]) => unknown> {
  /** what is under test, e.g. "isSourceConfigured" */
  subject: string;
  /** what this test actually covers — printed on failure. Be specific about scope. */
  population: string;
  /** the real implementation */
  real: F;
  /**
   * Deliberately broken variants, keyed by a description of the BREAK.
   * Each must be a plausible wrong implementation, not obvious garbage:
   * a poison the assertions catch trivially proves nothing.
   */
  poisons: Record<string, F>;
  /**
   * The assertions, parameterised over the implementation. Must throw (via expect)
   * when the implementation is wrong.
   */
  assertions: (impl: F) => void;
}

/**
 * Runs the sabotage matrix. Throws with a named survivor list if any poison passes.
 * Call this INSIDE an `it(...)` block.
 */
export function proveDetects<F extends (...args: never[]) => unknown>(
  spec: SabotageSpec<F>,
): void {
  const { subject, population, real, poisons, assertions } = spec;

  const poisonNames = Object.keys(poisons);
  if (poisonNames.length === 0) {
    throw new Error(
      `[sabotage] ${subject}: NO POISONS SUPPLIED. A sabotage matrix with an empty ` +
        `poison set passes vacuously — that is the exact failure this harness exists ` +
        `to prevent. Population under test: ${population}`,
    );
  }

  // ① The assertions must hold for the real implementation.
  try {
    assertions(real);
  } catch (e) {
    throw new Error(
      `[sabotage] ${subject}: the assertions FAILED against the REAL implementation, ` +
        `so this test is broken independently of any sabotage.\n` +
        `  population: ${population}\n` +
        `  underlying: ${(e as Error).message}`,
    );
  }

  // ② Every poison must be caught.
  const survivors: string[] = [];
  for (const name of poisonNames) {
    let threw = false;
    try {
      assertions(poisons[name]);
    } catch {
      threw = true;
    }
    if (!threw) survivors.push(name);
  }

  if (survivors.length > 0) {
    throw new Error(
      `[sabotage] ${subject}: ${survivors.length} of ${poisonNames.length} broken ` +
        `implementations PASSED the assertions. The test is too weak to detect them.\n` +
        `  population: ${population}\n` +
        `  survivors:\n` +
        survivors.map(s => `    - ${s}`).join('\n'),
    );
  }

  // Make the count visible to the runner so a zero-poison regression is not silent.
  expect(poisonNames.length).toBeGreaterThan(0);
}

/**
 * Declares the population a plain (non-sabotage) test covers.
 * Returns the label so it can be embedded in the test name — a population that is not
 * visible in the output is a population nobody checks.
 */
export function population(label: string): string {
  return `[population: ${label}]`;
}
