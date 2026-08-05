/**
 * Tests for the setter payout calculation. Item ⑦ (RACC-037). This is money.
 *
 * POPULATION: the four ways the live calculation pays the wrong amount with no symptom —
 * config wiped, partial rate list, name mismatch (case/whitespace), and the (Unknown)
 * payee — plus the ordinary correct case. Each is asserted separately, and the wiped
 * case is the one measured in the real outage (`excludedCampaigns` went 32 -> 0, so
 * `setterBonusRates` can go the same way).
 */
import { describe, it, expect } from 'vitest';
import {
  computeSetterPayouts,
  findConfiguredRate,
  formatPayoutExport,
  setterKey,
  FALLBACK_RATE,
  UNKNOWN_SETTER,
} from './payout';
import { makeAppointmentRow } from '@/test/factories';
import { proveDetects, population } from '@/test/sabotage';
import type { AppointmentRow } from './types';

const appt = (setter: string | undefined, n = 1): AppointmentRow[] =>
  Array.from({ length: n }, () =>
    makeAppointmentRow({ setter } as Partial<AppointmentRow>),
  );

const money = (n: number) => `$${n.toFixed(2)}`;

describe('findConfiguredRate — tolerant lookup, honest absence', () => {
  it(`is sabotage-proven ${population('exact / case / whitespace / missing / malformed rate')}`, () => {
    proveDetects({
      subject: 'findConfiguredRate',
      population:
        'exact match, case mismatch, whitespace mismatch, absent setter, non-numeric rate',
      real: findConfiguredRate,
      poisons: {
        'THE LIVE BUG: exact === match, so " alice" and "alice" miss': ((s, name) => {
          const hit = (s.setterBonusRates || []).find(r => r.setterName === name);
          return hit ? hit.rate : null;
        }) as typeof findConfiguredRate,
        'returns the fallback instead of null when absent': ((s, name) =>
          findConfiguredRate(s, name) ?? FALLBACK_RATE) as typeof findConfiguredRate,
        'accepts a malformed (non-numeric) rate': ((s, name) => {
          const hit = (s.setterBonusRates || []).find(
            r => setterKey(r.setterName || '') === setterKey(name),
          );
          return hit ? (hit.rate as number) : null;
        }) as typeof findConfiguredRate,
      },
      assertions: impl => {
        const s = {
          setterBonusRates: [
            { setterName: 'Alice', rate: 12 },
            { setterName: 'Bad', rate: 'x' as unknown as number },
          ],
        };
        expect(impl(s, 'Alice')).toBe(12);
        expect(impl(s, 'alice')).toBe(12); // case
        expect(impl(s, '  Alice  ')).toBe(12); // whitespace
        expect(impl(s, 'Nobody')).toBeNull(); // absent => null, NOT a number
        expect(impl(s, 'Bad')).toBeNull(); // malformed => null
      },
    });
  });
});

describe('🔴 the four break modes, each asserted', () => {
  it('① CONFIG WIPED — every rate is fabricated and the result SAYS SO', () => {
    const r = computeSetterPayouts([...appt('Alice', 3), ...appt('Bob', 2)], {
      setterBonusRates: [], // wiped, exactly as excludedCampaigns was
      inactiveSetters: [],
    });
    expect(r.allRatesFabricated).toBe(true);
    expect(r.rows.every(x => x.rateSource === 'fallback')).toBe(true);
    expect(r.needsReview).toHaveLength(2);
    // the money is still shown — nothing vanishes — but it is labelled
    expect(r.payableTotal).toBe(5 * FALLBACK_RATE);
  });

  it('② PARTIAL LIST — the configured setter is trusted, the missing one is flagged', () => {
    const r = computeSetterPayouts([...appt('Alice', 2), ...appt('Bob', 4)], {
      setterBonusRates: [{ setterName: 'Alice', rate: 10 }],
      inactiveSetters: [],
    });
    const alice = r.rows.find(x => x.name === 'Alice')!;
    const bob = r.rows.find(x => x.name === 'Bob')!;
    expect(alice.rateSource).toBe('configured');
    expect(alice.total).toBe(20);
    expect(bob.rateSource).toBe('fallback');
    expect(bob.warning).toContain('No rate configured');
    expect(r.allRatesFabricated).toBe(false); // not the wipe signature
  });

  it('③ NAME MISMATCH — case and whitespace no longer silently pay the default', () => {
    const r = computeSetterPayouts(appt('  alice  ', 3), {
      setterBonusRates: [{ setterName: 'Alice', rate: 10 }],
      inactiveSetters: [],
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].rateSource).toBe('configured');
    expect(r.rows[0].total).toBe(30); // was 15 at the $5 default
  });

  it('③b an inactive setter cannot dodge exclusion via case or whitespace', () => {
    const r = computeSetterPayouts(appt(' ALICE ', 3), {
      setterBonusRates: [],
      inactiveSetters: ['alice'],
    });
    expect(r.rows).toHaveLength(0);
  });

  it('④ (Unknown) PAYEE — grouped, visible, and NOT in the payable total', () => {
    const r = computeSetterPayouts([...appt('Alice', 2), ...appt(undefined, 5)], {
      setterBonusRates: [{ setterName: 'Alice', rate: 10 }],
      inactiveSetters: [],
    });
    const unknown = r.rows.find(x => x.name === UNKNOWN_SETTER)!;
    expect(unknown.appointmentCount).toBe(5);
    expect(unknown.payable).toBe(false);
    expect(r.payableTotal).toBe(20); // Alice only
    expect(r.grossTotal).toBe(20 + 5 * FALLBACK_RATE); // the gap is visible
    expect(r.needsReview).toContain(unknown);
  });

  it('the ordinary correct case stays correct', () => {
    const r = computeSetterPayouts([...appt('Alice', 3), ...appt('Bob', 1)], {
      setterBonusRates: [
        { setterName: 'Alice', rate: 10 },
        { setterName: 'Bob', rate: 7 },
      ],
      inactiveSetters: [],
    });
    expect(r.allRatesFabricated).toBe(false);
    expect(r.needsReview).toHaveLength(0);
    expect(r.payableTotal).toBe(37);
    expect(r.rows[0].name).toBe('Alice'); // sorted by total desc
  });
});

describe('formatPayoutExport — the clipboard must not lie either', () => {
  it('🔴 marks fabricated rates, which the live export does NOT', () => {
    const r = computeSetterPayouts(appt('Bob', 4), {
      setterBonusRates: [],
      inactiveSetters: [],
    });
    const text = formatPayoutExport(r, 'August 2026', money);
    // the live version emits exactly "Bob: 4 appointments × $5 = $20.00" with no qualifier
    expect(text).toContain('NO SETTER RATES ARE CONFIGURED');
    expect(text).toContain('DEFAULT RATE — not configured');
  });

  it('excludes the unknown bucket from the total and says how much was excluded', () => {
    const r = computeSetterPayouts([...appt('Alice', 2), ...appt('', 3)], {
      setterBonusRates: [{ setterName: 'Alice', rate: 10 }],
      inactiveSetters: [],
    });
    const text = formatPayoutExport(r, 'August 2026', money);
    expect(text).toContain('Total: $20.00');
    expect(text).toContain('Excluded (needs owner): $15.00');
    expect(text).toContain('NEEDS OWNER');
  });

  it('a fully configured run carries no warnings at all', () => {
    const r = computeSetterPayouts(appt('Alice', 2), {
      setterBonusRates: [{ setterName: 'Alice', rate: 10 }],
      inactiveSetters: [],
    });
    const text = formatPayoutExport(r, 'August 2026', money);
    expect(text).not.toContain('DEFAULT RATE');
    expect(text).not.toContain('NEEDS OWNER');
    expect(text).toContain('Alice: 2 appointments × $10 = $20.00');
  });
});
