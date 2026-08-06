/**
 * Tests for the single date parser. Item ⑤.
 *
 * POPULATION: every date shape MEASURED in the two live source tabs —
 *   DERIVED tab: 581 distinct M/D/YYYY values + 2 distinct Sheets serials (4 rows)
 *   RAW tab:     581 distinct ISO YYYY-MM-DD values
 * plus the empty and unparseable cases the sources also produce.
 * These are enumerated below, not sampled.
 */
import { describe, it, expect } from 'vitest';
import {
  parseSourceDate,
  normaliseSourceDay,
  toIsoDay,
  isSheetsSerial,
  isSameDay,
} from './dates';
import { proveDetects, population } from '@/test/sabotage';
import { REAL_DATE_SHAPES } from '@/test/factories';

describe('parseSourceDate', () => {
  it(`is sabotage-proven across every measured source shape ${population('M/D/YYYY, ISO, serial, empty, garbage')}`, () => {
    proveDetects({
      subject: 'parseSourceDate',
      population:
        'the 3 real shapes (M/D/YYYY on the derived tab, ISO on the raw tab, Sheets serial) + empty + garbage',
      real: parseSourceDate,
      poisons: {
        'the CURRENT bug: hands ISO to new Date(), shifting one day west of UTC': ((
          v: unknown,
        ) => {
          if (typeof v !== 'string' || !v.trim()) return null;
          const d = new Date(v);
          return isNaN(d.getTime()) ? null : d;
        }) as typeof parseSourceDate,
        'accepts serials as calendar years (year 45884)': ((v: unknown) => {
          if (typeof v !== 'string' || !v.trim()) return null;
          const d = new Date(v as string);
          return isNaN(d.getTime()) ? null : d;
        }) as typeof parseSourceDate,
        'drops serials entirely, losing real spend rows': ((v: unknown) =>
          typeof v === 'string' && /^\d+$/.test(v.trim())
            ? null
            : parseSourceDate(v)) as typeof parseSourceDate,
        'swaps month and day': ((v: unknown) => {
          if (typeof v !== 'string') return null;
          const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
          if (!m) return parseSourceDate(v);
          return new Date(+m[3], +m[2] - 1, +m[1]);
        }) as typeof parseSourceDate,
        'returns a non-null Date for garbage': ((v: unknown) =>
          parseSourceDate(v) ?? new Date(2000, 0, 1)) as typeof parseSourceDate,
      },
      assertions: impl => {
        // M/D/YYYY — the live derived-tab format
        expect(toIsoDay(impl('8/4/2026')!)).toBe('2026-08-04');
        // ISO date-only — the raw tab, and the one-day trap
        expect(toIsoDay(impl('2026-08-04')!)).toBe('2026-08-04');
        // the two forms MUST agree — this is the whole point of ⑤
        expect(toIsoDay(impl('8/4/2026')!)).toBe(toIsoDay(impl('2026-08-04')!));
        // Sheets serials decode to real in-range days, not year 45884
        expect(toIsoDay(impl('45884')!)).toBe('2025-08-15');
        expect(toIsoDay(impl('45875')!)).toBe('2025-08-06');
        // month/day order
        expect(toIsoDay(impl('1/2/2025')!)).toBe('2025-01-02');
        // refusals
        expect(impl('')).toBeNull();
        expect(impl('not a date')).toBeNull();
      },
    });
  });

  it('🔴 the ISO and M/D/YYYY forms of the SAME day agree — the 4-parser divergence', () => {
    // Four of the six parseDateSafe copies disagree by one calendar day here.
    expect(toIsoDay(parseSourceDate('2026-08-04')!)).toBe('2026-08-04');
    expect(isSameDay(parseSourceDate('2026-08-04')!, parseSourceDate('8/4/2026')!)).toBe(
      true,
    );
  });

  it('never returns an Invalid Date — null or a valid Date, nothing else', () => {
    const hostile = [
      ...Object.values(REAL_DATE_SHAPES),
      '13/45/2026',
      '2026-02-30',
      '2/30/2025',
      '  ',
      'undefined',
      '0',
      '999999999',
      null,
      undefined,
      42,
      {},
    ];
    for (const v of hostile) {
      const d = parseSourceDate(v as unknown);
      if (d !== null) expect(isNaN(d.getTime())).toBe(false);
    }
  });

  it('rejects calendar rollover instead of silently sliding the date', () => {
    expect(parseSourceDate('2/30/2025')).toBeNull(); // not March 2nd
    expect(parseSourceDate('2026-02-30')).toBeNull();
    expect(parseSourceDate('13/1/2026')).toBeNull();
  });
});

describe('isSheetsSerial — bounded on purpose', () => {
  it('accepts the two serials measured in the live feed', () => {
    expect(isSheetsSerial('45875')).toBe(true);
    expect(isSheetsSerial('45884')).toBe(true);
  });

  it('🔴 REFUSES a bare year, which an unbounded numeric branch would decode to 1905', () => {
    expect(isSheetsSerial('2026')).toBe(false);
    expect(parseSourceDate('2026')).toBeNull();
  });

  it('refuses values outside the plausible range', () => {
    expect(isSheetsSerial('1')).toBe(false);
    expect(isSheetsSerial('36525')).toBe(false); // 1999-12-31, below the shared window
    expect(isSheetsSerial('999999')).toBe(false);
  });
});

describe('normaliseSourceDay — the boundary normaliser', () => {
  it('produces sortable YYYY-MM-DD, which raw M/D/YYYY is not', () => {
    const raw = ['9/1/2026', '10/1/2026'];
    // the bug this prevents: lexicographic sort puts 10/1 BEFORE 9/1
    expect([...raw].sort()).toEqual(['10/1/2026', '9/1/2026']);
    const normalised = raw.map(normaliseSourceDay);
    expect([...normalised].sort()).toEqual(['2026-09-01', '2026-10-01']);
  });

  it('returns null rather than a sentinel date for unparseable input', () => {
    expect(normaliseSourceDay('')).toBeNull();
    expect(normaliseSourceDay('not a date')).toBeNull();
  });

  it('is idempotent — normalising twice equals normalising once', () => {
    const once = normaliseSourceDay('8/4/2026')!;
    expect(normaliseSourceDay(once)).toBe(once);
  });
});
