import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkColumnContract, WINDSOR_COLUMNS, type ColumnSpec } from './dataService';

/**
 * ② SILENT TAB / COLUMN DRIFT.
 *
 * @fable: "a misconfigured source CANNOT FAIL LOUDLY TODAY. It returns confident, complete,
 * WRONG data — the exact thing Andrew hired us to remove, and it is one settings typo away
 * at all times."
 *
 * ⭐ AND MY OWN EXISTING GUARD COVERED ONLY HALF OF IT. `assertSheetSchema` asserts ONE
 * column, which is enough for a wrong TAB — where every column vanishes at once — and
 * completely blind to DRIFT. Rename `Spent` to `Amount Spent` and `Account Name` still
 * resolves, the guard stays silent, parseNumber('') returns 0, and EVERY SPEND TOTAL
 * SILENTLY BECOMES ZERO. I wrote that guard's docblock explaining why one column was
 * enough, and the reasoning was sound for the failure I had in mind and wrong for this one.
 *
 * ⚠️ TWO TIERS, BECAUSE THEY FAIL DIFFERENTLY:
 *   CRITICAL  absence ⇒ a WRONG NUMBER rendered confidently ⇒ THROW
 *   LABEL     absence ⇒ a missing NAME ⇒ REPORT, never throw. A check that takes the
 *             dashboard down over a missing `Ad Name` is a check people delete.
 */
describe('checkColumnContract — the two tiers', () => {
  const FULL: Record<string, string> = {
    'Account Name': 'Acme', Spent: '500', Leads: '20', Date: '8/4/2026',
    Month: 'August', Campaign: 'C', 'Campaign Id': '1', 'Adset Name': 'A',
    'Adset Id': '2', 'Ad Name': 'N', 'Ad Id': '3',
  };

  it('🔴 ANTI-VACUITY CONTROL: a complete sheet passes with NO drift', () => {
    // Run first, and it is the arm that makes the others mean anything — @bird's ordering.
    expect(checkColumnContract([FULL], WINDSOR_COLUMNS, 'x')).toEqual({ missingLabels: [] });
  });

  it('🔴 a missing CRITICAL column THROWS — a wrong number is worse than a dead source', () => {
    const { Spent, ...noSpent } = FULL;
    expect(() => checkColumnContract([noSpent], WINDSOR_COLUMNS, 'Ad spend sheet'))
      .toThrow(/"Spent"/);
    expect(() => checkColumnContract([noSpent], WINDSOR_COLUMNS, 'Ad spend sheet'))
      .toThrow(/Refusing to report zeros/);
  });

  it('names EVERY missing critical column, not just the first', () => {
    const bare = { Month: 'August' };
    try {
      checkColumnContract([bare], WINDSOR_COLUMNS, 'x');
      throw new Error('should have thrown');
    } catch (e) {
      const m = (e as Error).message;
      for (const c of ['Account Name', 'Spent', 'Leads', 'Date']) expect(m).toContain(`"${c}"`);
    }
  });

  it('🔑 a missing LABEL column is REPORTED, never thrown', () => {
    const { 'Ad Name': _ad, Month: _m, ...noLabels } = FULL;
    const drift = checkColumnContract([noLabels], WINDSOR_COLUMNS, 'x');
    expect(drift.missingLabels).toContain('Ad Name');
    expect(drift.missingLabels).toContain('Month');
    expect(drift.missingLabels).not.toContain('Spent');
  });

  it('⭐ ALTERNATE SPELLINGS SATISFY THE COLUMN — the mapper accepts them, so must this', () => {
    // A contract demanding one spelling would throw on a sheet that works TODAY, which is
    // how a guard starts disagreeing with the code it guards.
    const alt = { ...FULL, Spent: undefined as never, Spend: '500' };
    delete (alt as Record<string, unknown>).Spent;
    expect(() => checkColumnContract([alt], WINDSOR_COLUMNS, 'x')).not.toThrow();

    const alt2 = { ...FULL } as Record<string, string>;
    delete alt2['Campaign Id']; alt2['Campaign ID'] = '1';
    expect(checkColumnContract([alt2], WINDSOR_COLUMNS, 'x').missingLabels).toEqual([]);
  });

  it('🔴 an EMPTY sheet is UNVERIFIED, not a clean bill of health — @raccoon', () => {
    // It used to return a clean verdict on the FIRST LINE, so a wrong tab that happens to be
    // EMPTY passed the guard built to catch a wrong tab. The POPULATION control, which fakes
    // a PASS rather than a suspicious zero. Still not a throw: a genuinely empty tab is
    // legitimate and must not blank the app.
    const r = checkColumnContract([], WINDSOR_COLUMNS, 'x');
    expect(r.schemaUnverified).toBe(true);
    expect(r.missingLabels).toEqual([]);
  });

  it('a NON-empty sheet is not marked unverified — the control for the arm above', () => {
    expect(checkColumnContract([FULL], WINDSOR_COLUMNS, 'x').schemaUnverified).toBeFalsy();
  });

  it('🔴 PRESENCE IS NOT VALIDITY: a critical column that is PRESENT and ALL BLANK throws', () => {
    // My own law, one layer down. Every column present, every value empty, parseNumber('')
    // returns 0, and every spend total becomes zero — the exact outcome this prevents.
    const blank = { 'Account Name': 'A', Spent: '', Leads: '', Date: '' };
    expect(() => checkColumnContract([blank], WINDSOR_COLUMNS, 'x')).toThrow(/ENTIRELY BLANK/);
  });

  it('🔑 ONE blank cell among several rows is NORMAL and must not throw', () => {
    // "at least one row has a value", not "every row". The mirror defect would be refusing
    // a real sheet because a single cell is empty.
    const rows = [{ ...FULL, Spent: '' }, FULL];
    expect(() => checkColumnContract(rows, WINDSOR_COLUMNS, 'x')).not.toThrow();
  });

  it('⭐ CASE-FOLDED: a lowercase header satisfies the contract', () => {
    // And the MAPPER folds case by the same rule — see the pick() docblock. Relaxing only
    // the guard would have turned a loud failure into a silent zero.
    const lower = Object.fromEntries(Object.entries(FULL).map(([k, v]) => [k.toLowerCase(), v]));
    expect(() => checkColumnContract([lower], WINDSOR_COLUMNS, 'x')).not.toThrow();
  });
});

/**
 * 🔒 THE DRIFT LOCK — AND IT RUNS IN BOTH DIRECTIONS, WHICH IS @apprentice's LESSON.
 *
 * He sabotaged his own allowlist guard tonight and found it caught a key removed from the
 * SQL and NOT one removed from the client, because the check iterated one side: "deleting a
 * CLIENT key just SHRINKS THE LOOP, so that direction passed silently." ⭐ ONE SABOTAGE
 * PROVES A GUARD FIRES; A TRUTH TABLE PROVES IT FIRES IN EVERY DIRECTION.
 *
 * So this reads the ACTUAL column literals out of fetchGoogleSheetData's source and
 * compares them to the contract BOTH WAYS. A hand-written list is a hypothesis; the mapper
 * is the fact. If someone adds a column to the mapper and not the contract, the new column
 * is unguarded. If someone adds it to the contract and not the mapper, the guard throws
 * over a column nothing reads.
 */
describe('the contract agrees with the MAPPER, in both directions', () => {
  // process.cwd() and NOT import.meta.url: vitest serves this file over a non-file URL in
  // the jsdom environment, so `new URL(...)` throws at COLLECTION time — which vitest
  // reports as "no tests", the population failure that reads as a clean pass. Caught only
  // because the exit code was non-zero; the printed count alone said nothing was wrong.
  const src = readFileSync(resolve(process.cwd(), 'src/lib/dataService.ts'), 'utf8');
  const mapper = src.slice(
    src.indexOf('export async function fetchGoogleSheetData'),
    src.indexOf('export async function fetchCallCenterData'),
  );
  /**
   * Every column the ad-spend mapper actually reads, from its `pick(r, 'A', 'B')` calls.
   *
   * ⭐ THIS EXTRACTOR CHANGED WHEN THE MAPPER DID, AND THE LOCK CAUGHT IT — including the
   * NON-VACUITY arm, which failed with "expected 0 to be greater than 10". Without that arm
   * the set would have been EMPTY, `unguarded` would have been `[]`, and the direction would
   * have passed VACUOUSLY over nothing. That is the whole reason it is there.
   */
  const readByMapper = new Set(
    Array.from(mapper.matchAll(/pick\(r,\s*([^)]+)\)/g))
      .flatMap(m => Array.from(m[1].matchAll(/'([^']+)'/g), q => q[1])),
  );
  const inContract = new Set(WINDSOR_COLUMNS.flatMap((c: ColumnSpec) => c.accept));

  it('NON-VACUITY: the mapper source was found and really reads columns', () => {
    // Without this, a failed slice would make both directions pass over an empty set —
    // the READ-control failure, which fakes a clean zero.
    expect(mapper).toContain('accountName');
    expect(readByMapper.size).toBeGreaterThan(10);
  });

  it('🔴 every column the MAPPER reads is in the CONTRACT — else it is unguarded', () => {
    // `date` lowercase is a defensive alternate inside normalizeSourceDate's argument, not
    // a column the sheet is expected to have.
    const unguarded = [...readByMapper].filter(h => !inContract.has(h) && h !== 'date');
    expect(unguarded, `mapper reads columns absent from WINDSOR_COLUMNS: ${unguarded.join(', ')}`).toEqual([]);
  });

  it('🔴 every column in the CONTRACT is read by the MAPPER — the direction @apprentice missed', () => {
    // This is the arm that a one-sided loop cannot have. Without it, a contract entry for a
    // column nothing reads would throw on a perfectly good sheet, and no test would notice.
    const orphans = [...inContract].filter(h => !readByMapper.has(h));
    expect(orphans, `contract demands columns the mapper never reads: ${orphans.join(', ')}`).toEqual([]);
  });

  it('every CRITICAL column feeds a NUMBER or the grouping key — not a label', () => {
    // The tier assignment is the whole design; asserting it stops a later edit from
    // quietly promoting a label column and taking the dashboard down over a missing name.
    const critical = WINDSOR_COLUMNS.filter(c => c.critical).map(c => c.accept[0]).sort();
    expect(critical).toEqual(['Account Name', 'Date', 'Leads', 'Spent']);
  });
});
