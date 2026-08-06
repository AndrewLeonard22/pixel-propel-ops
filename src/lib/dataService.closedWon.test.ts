import { describe, it, expect } from 'vitest';
import {
  isClosedWon,
  isClosedWonStatus,
  isClosedLostStatus,
  buildAccountSummaries,
} from './dataService';
import { makeAdSpendRow, makeAppointmentRow, makeSettings } from '@/test/factories';

/**
 * 🔴 D1 — «CLOSED DEALS» COUNTED LOSSES AS WINS, and the population below is @andrew's REAL
 * Lead Status distribution, queried from his live Airtable by @fable. Not invented data.
 *
 *   Closed Lost 107 · Closed Won 46 · Waiting on their decision 57 · Working on proposal 56
 *   Waiting on decision 53 · (empty) 348   ⇒ 667 of 679 enumerated
 *
 * The old predicate was `leadStatus.toLowerCase().includes('closed') || closedRevenue > 0`.
 * `'Closed Lost'.includes('closed')` is TRUE, so the app reported **153** — and **107 of
 * those were deals he LOST**. 46 + 107 = 153 is exactly what the app computed, which is how
 * the diagnosis was confirmed rather than merely proposed.
 *
 * ⭐ THE SHAPE: A SUBSTRING TEST STANDING IN FOR A CATEGORY TEST — it cannot distinguish an
 * outcome from its OPPOSITE because both share a word. Same class as the paid-traffic
 * classifier and as rec-prefix matching.
 *
 * ⚠️ 12 RECORDS ARE UNACCOUNTED FOR and this file does not pretend otherwise — see the last
 * describe block, which states what is DEDUCIBLE about them and what is not.
 */

/** @andrew's measured distribution. The counts are the point; the fixture reproduces them. */
const LIVE_DISTRIBUTION: [string, number][] = [
  ['Closed Lost', 107],
  ['Closed Won', 46],
  ['Waiting on their decision', 57],
  ['Working on proposal', 56],
  ['Waiting on decision', 53],
  ['', 348],
];

const livePopulation = () =>
  LIVE_DISTRIBUTION.flatMap(([status, n]) =>
    Array.from({ length: n }, () =>
      makeAppointmentRow({ client: 'Acme', leadStatus: status, closedRevenue: 0 }),
    ),
  );

describe('🔴 THE DEFECT, on @andrew\'s real distribution', () => {
  it('the OLD substring predicate scored 153 — and 107 of them were LOSSES', () => {
    const appts = livePopulation();
    const oldPredicate = (a: { leadStatus?: string; closedRevenue?: number }) =>
      a.leadStatus?.toLowerCase().includes('closed') || (a.closedRevenue ?? 0) > 0;

    const oldCount = appts.filter(oldPredicate).length;
    expect(oldCount).toBe(153);                                  // reproduces the shipped bug

    // 🔑 THE DAMAGE, stated as a number: 107 of those 153 are the OPPOSITE outcome.
    const losses = appts.filter(a => a.leadStatus === 'Closed Lost').length;
    expect(losses).toBe(107);
    expect(oldCount - losses).toBe(46);
  });

  it('✅ THE FIX scores 46 — the wins, and only the wins', () => {
    const appts = livePopulation();
    expect(appts.filter(isClosedWon).length).toBe(46);
  });

  it('🔴 ANTI-VACUITY: the fix is not merely "smaller" — it is the RIGHT 46', () => {
    // A predicate returning `false` always would also drop from 153. This asserts the
    // survivors are exactly the won rows, which a blanket refusal cannot satisfy.
    const appts = livePopulation();
    const kept = appts.filter(isClosedWon);
    expect(kept).toHaveLength(46);
    for (const a of kept) expect(a.leadStatus).toBe('Closed Won');
  });
});

describe('the two categories are explicit, and neither leaks into the other', () => {
  it('won recognises its spellings, and NEVER Closed Lost', () => {
    for (const s of ['Closed Won', 'closed won', 'CLOSED WON', 'Closed-Won', ' Closed  Won ', 'Won'])
      expect(isClosedWonStatus(s)).toBe(true);
    for (const s of ['Closed Lost', 'closed lost', 'Closed-Lost', 'Lost'])
      expect(isClosedWonStatus(s)).toBe(false);
  });

  it('lost is asserted EXPLICITLY, not inferred as "not won"', () => {
    for (const s of ['Closed Lost', 'closed lost', ' Closed  Lost ', 'Lost'])
      expect(isClosedLostStatus(s)).toBe(true);
    for (const s of ['Closed Won', 'Working on proposal', '', undefined])
      expect(isClosedLostStatus(s)).toBe(false);
  });

  it('the open statuses are neither won nor lost', () => {
    for (const s of ['Waiting on their decision', 'Working on proposal', 'Waiting on decision', '']) {
      expect(isClosedWonStatus(s)).toBe(false);
      expect(isClosedLostStatus(s)).toBe(false);
    }
  });
});

describe('🔑 THE TRAP INSIDE "KEEP THE || closedRevenue > 0 ARM"', () => {
  it('🔴 a CLOSED LOST row carrying revenue must NOT count — the back door', () => {
    // Kept naively, the revenue arm reintroduces the exact defect by a second route: the
    // status says lost, the money says won, and `||` lets the money win. This is why
    // isClosedLostStatus exists rather than being the negation of isClosedWonStatus.
    expect(isClosedWon({ leadStatus: 'Closed Lost', closedRevenue: 25000 })).toBe(false);
  });

  it('✅ but revenue DOES still buy a win where the status is silent — @fable\'s clause', () => {
    // A won deal with revenue and no status must still count. This is the half of the
    // instruction that must survive, and it is the reason for a three-valued classification.
    expect(isClosedWon({ leadStatus: '', closedRevenue: 25000 })).toBe(true);
    expect(isClosedWon({ leadStatus: undefined, closedRevenue: 1 })).toBe(true);
    expect(isClosedWon({ leadStatus: 'Working on proposal', closedRevenue: 500 })).toBe(true);
  });

  it('no revenue and no won status is not a win', () => {
    expect(isClosedWon({ leadStatus: 'Working on proposal', closedRevenue: 0 })).toBe(false);
    expect(isClosedWon({ leadStatus: '', closedRevenue: 0 })).toBe(false);
    expect(isClosedWon({})).toBe(false);
  });
});

describe('the fix reaches the ACCOUNT numbers, not just the helper', () => {
  it('🔴 WIRE: a summary counts 1 win from a won+lost pair, not 2', () => {
    // The helper being right is worth nothing if a call site still inlines the old test.
    // All four sites were rewritten; this proves the one that feeds the account row.
    const appts = [
      makeAppointmentRow({ client: 'Acme', leadStatus: 'Closed Won', closedRevenue: 1000 }),
      makeAppointmentRow({ client: 'Acme', leadStatus: 'Closed Lost', closedRevenue: 0 }),
    ];
    const { accounts } = buildAccountSummaries(
      [makeAdSpendRow({ accountName: 'Acme', spent: 500, leads: 20 })],
      appts,
      makeSettings(),
      [],
    );
    expect(accounts[0].closed).toBe(1);
  });

  it('⭐ REVENUE IS UNCHANGED BY THIS FIX — verified, not assumed', () => {
    // @fable: "revenue is probably fine because it sums the FIELD rather than the status."
    // Confirmed at all four sites by reading them, and locked here: revenue sums the field,
    // so correcting the COUNT must not move the MONEY.
    const appts = [
      makeAppointmentRow({ client: 'Acme', leadStatus: 'Closed Won', closedRevenue: 1000 }),
      makeAppointmentRow({ client: 'Acme', leadStatus: 'Closed Lost', closedRevenue: 250 }),
    ];
    const { accounts } = buildAccountSummaries(
      [makeAdSpendRow({ accountName: 'Acme', spent: 500, leads: 20 })],
      appts,
      makeSettings(),
      [],
    );
    expect(accounts[0].closed).toBe(1);        // the count is corrected
    expect(accounts[0].revenue).toBe(1250);    // the money is NOT
  });
});

describe('⚠️ THE 12 UNACCOUNTED RECORDS — what is deducible, and what is NOT', () => {
  it('documents the bound so a green suite cannot be read as full coverage', () => {
    /**
     * @fable enumerated 667 of 679 Lead Status values. **12 carry a value nobody has listed**,
     * and this suite has never seen them.
     *
     * ✅ DEDUCIBLE WITHOUT THE VALUES: the app's total was exactly 153 = 107 + 46, so **none
     * of the 12 contains the substring `closed`** — otherwise the old count would have
     * exceeded 153. It also follows that the `|| closedRevenue > 0` arm was contributing
     * ZERO rows on live data, since no row outside the 153 was being counted.
     *
     * 🔴 NOT DEDUCIBLE: whether any of the 12 is a WIN under a spelling that omits the word
     * `closed` — `Sold`, `Signed`, `Deal Won`. Such a row was NOT counted before this fix and
     * is NOT counted after it, so this is not a regression — but it is a possible UNDER-count
     * that predates D1 and that neither the old nor the new predicate can see.
     * ⇒ Resolving it needs the 12 values, which needs the live base. Logged, not guessed.
     */
    const enumerated = 107 + 46 + 57 + 56 + 53 + 348;
    expect(enumerated).toBe(667);
    expect(679 - enumerated).toBe(12);
  });
});
