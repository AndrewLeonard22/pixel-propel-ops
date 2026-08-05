/**
 * TESTS OF THE SABOTAGE HARNESS ITSELF.
 *
 * The harness is the instrument every other test in this repo will lean on. An instrument
 * whose alarm has never been shown to fire is not evidence of anything — so this file
 * proves the harness FAILS when it should, not merely that it passes when it should.
 * Both arms, asserted. Population: the three ways proveDetects can be wrong.
 */
import { describe, it, expect } from 'vitest';
import { proveDetects, population } from './sabotage';

describe('sabotage harness', () => {
  // A trivial subject with a knowable right answer.
  const isPositive = (n: number) => n > 0;

  it(`PASSES when the assertions catch every poison ${population('3 poisons, all detectable')}`, () => {
    expect(() =>
      proveDetects({
        subject: 'isPositive',
        population: '3 poisons, all detectable',
        real: isPositive,
        poisons: {
          'always true': () => true,
          'always false': () => false,
          'off by one at the boundary': (n: number) => n >= 0,
        },
        assertions: impl => {
          expect(impl(1)).toBe(true);
          expect(impl(-1)).toBe(false);
          expect(impl(0)).toBe(false); // the boundary is what catches the off-by-one
        },
      }),
    ).not.toThrow();
  });

  it('🔴 FAILS, NAMING THE SURVIVOR, when the assertions are too weak', () => {
    // These assertions never probe the boundary, so the off-by-one poison survives.
    let err: Error | null = null;
    try {
      proveDetects({
        subject: 'isPositive',
        population: 'weak assertions — boundary never probed',
        real: isPositive,
        poisons: {
          'always true': () => true,
          'off by one at the boundary': (n: number) => n >= 0,
        },
        assertions: impl => {
          expect(impl(1)).toBe(true);
          expect(impl(-1)).toBe(false);
          // NOTE: impl(0) is never asserted — that is the hole.
        },
      });
    } catch (e) {
      err = e as Error;
    }
    expect(err).not.toBeNull();
    expect(err!.message).toContain('off by one at the boundary');
    expect(err!.message).toContain('1 of 2');
    // the population must travel with the failure
    expect(err!.message).toContain('boundary never probed');
  });

  it('🔴 FAILS when the assertions do not hold for the REAL implementation', () => {
    let err: Error | null = null;
    try {
      proveDetects({
        subject: 'isPositive',
        population: 'assertions themselves wrong',
        real: isPositive,
        poisons: { 'always true': () => true },
        assertions: impl => {
          expect(impl(1)).toBe(false); // wrong expectation
        },
      });
    } catch (e) {
      err = e as Error;
    }
    expect(err).not.toBeNull();
    expect(err!.message).toContain('FAILED against the REAL implementation');
  });

  it('🔴 REFUSES an empty poison set rather than passing vacuously', () => {
    expect(() =>
      proveDetects({
        subject: 'isPositive',
        population: 'empty poison set',
        real: isPositive,
        poisons: {},
        assertions: impl => {
          expect(impl(1)).toBe(true);
        },
      }),
    ).toThrow(/NO POISONS SUPPLIED/);
  });
});
