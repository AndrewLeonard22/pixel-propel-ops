import { describe, it, expect } from 'vitest';
import { accountKey } from './dataService';
import { accountKey as accountsAccountKey } from './accounts';

/**
 * LOCKING WHAT `accountKey` ACTUALLY DOES, BECAUSE ITS DOCBLOCK USED TO CLAIM OTHERWISE.
 *
 * @raccoon measured the false claim: `dataService.ts:427` said the function "collapses the
 * whitespace twins as a side effect" and it does not — `trim()` removes OUTER whitespace
 * only. I reproduced it before deleting the claim.
 *
 * ⭐ AN ASPIRATIONAL DOCBLOCK IS WORSE THAN NO DOCBLOCK. A reader who finds this function
 * and trusts the old sentence ships the twin bug BELIEVING IT IS HANDLED. Deleting the
 * claim is necessary and not sufficient — a comment can drift back. THIS FILE is what makes
 * the behaviour a fact instead of a sentence, and it is the difference between fixing a
 * comment and fixing the reason the comment was dangerous.
 *
 * ⚠️ THESE ASSERTIONS RECORD A DEFECT AS THE CURRENT TRUTH, DELIBERATELY. The twin bug is
 * REACHABLE — "Acme  Corp" and "Acme Corp" are two accounts today. Making it collapse is
 * one `.replace`, but account identity is decided at 22 hand-written trim().toLowerCase()
 * sites (only 4 route through any shared function), so changing it here alone would make
 * this function DISAGREE with the other 22 and could merge or split live accounts. That is
 * a product decision, and when it is taken these expectations must be INVERTED, not
 * deleted — the inversion is the proof the change reached this function.
 */
describe('accountKey — what it does, not what its comment used to say', () => {
  it('trims and lowercases', () => {
    expect(accountKey('  Acme Corp  ')).toBe('acme corp');
    expect(accountKey('ACME CORP')).toBe('acme corp');
  });

  it('handles null and undefined without throwing', () => {
    expect(accountKey(null)).toBe('');
    expect(accountKey(undefined)).toBe('');
  });

  it('🔴 DOES NOT collapse internal whitespace — the twins stay SPLIT', () => {
    // The exact claim that was in the docblock. If someone makes this collapse, this
    // assertion fails and they are forced to come here and read the 22-site warning
    // rather than discovering the disagreement in production.
    expect(accountKey('Acme  Corp')).not.toBe(accountKey('Acme Corp'));
    expect(accountKey('Acme\tCorp')).not.toBe(accountKey('Acme Corp'));
    expect(accountKey('A  B  C')).not.toBe(accountKey('A B C'));
  });

  it('🔑 THE TWO FUNCTIONS OF THIS NAME DISAGREE, and that disagreement is the finding', () => {
    // accounts.ts:34 collapses; dataService.ts:429 does not. Same name, different rule,
    // and an unqualified `accountKey` in a review does not say which one is meant.
    // Asserting the disagreement means it cannot be quietly resolved in one file only.
    expect(accountsAccountKey('Acme  Corp')).toBe(accountsAccountKey('Acme Corp'));
    expect(accountKey('Acme  Corp')).not.toBe(accountKey('Acme Corp'));

    // ANTI-VACUITY: they must still agree on the ordinary case, or this file is just
    // asserting that two unrelated functions differ.
    expect(accountsAccountKey('  ACME Corp ')).toBe(accountKey('  ACME Corp '));
  });
});
