import { describe, it, expect } from 'vitest';
import {
  isJunkCompanyName, classifyMapping, displayCompany, displayMetaName, sortKey, formatMoney,
} from './accountDisplay';

/**
 * THE INVERSION @andrew REPORTED: "it shouldn't even say airtable. It should say company
 * name."
 *
 * The fixtures below are the REAL ROWS measured in `ad_accounts` on 2026-08-11, not
 * invented shapes. A guard tested against hypothetical junk is a guard tested against the
 * junk its author already thought of.
 */
const row = (over: Partial<Parameters<typeof classifyMapping>[0]> = {}) => ({
  account_id: '10170221',
  meta_name: 'Columbia Outdoor Restoration X SocialWorks',
  company_name: 'Columbia Outdoor Restoration',
  ...over,
});

describe('isJunkCompanyName — every junk shape that was live in the table', () => {
  it('catches the raw id + currency form, which was the dominant defect', () => {
    for (const v of ['10170221, USD', '103578393327348, USD', '222178771, USD', '391432983081972, USD']) {
      expect(isJunkCompanyName(v), v).toBe(true);
    }
  });

  it('catches a bare id, a blank, and a null — an absent name is not a name', () => {
    for (const v of ['391432983081972', '', '   ', null, undefined]) {
      expect(isJunkCompanyName(v as string), String(v)).toBe(true);
    }
  });

  it('🔑 ANTI-VACUITY: real company names are NOT junk', () => {
    // Without this the regex is satisfiable by returning true always, which would render
    // all 52 rows as unmapped — the mirror defect, and a worse screen than the one we have.
    for (const v of [
      'Columbia Outdoor Restoration', 'Backyard Paradiso', 'FB Pressure Washing LLC',
      'MD Property Maintenance & Landscaping', 'PSDC', 'Z Pool', 'TRC', '3 Guys Painting',
    ]) {
      expect(isJunkCompanyName(v), v).toBe(false);
    }
  });

  it('a name that merely CONTAINS digits is not junk — the anchors are load-bearing', () => {
    // `ApexCleaningC0` is a live row, with a zero standing in for the letter O. An
    // unanchored digit test would unmap a paying client.
    expect(isJunkCompanyName('ApexCleaningC0')).toBe(false);
    expect(isJunkCompanyName('Publicity 1')).toBe(false);
  });
});

describe('classifyMapping — three states, because two cannot describe the table', () => {
  it('a curated name that differs from Meta is MAPPED', () => {
    expect(classifyMapping(row())).toBe('mapped');
  });

  it('a name copied verbatim from Meta is UNCONFIRMED, not mapped', () => {
    // 39 of 52 rows were in this state: they LOOK mapped and no human ever chose them.
    // Rendering them identically to a curated mapping is what made the screen feel broken
    // in a way that could not be pointed at.
    expect(classifyMapping(row({ company_name: 'Z Pool X SocialWorks', meta_name: 'Z Pool X SocialWorks' })))
      .toBe('unconfirmed');
  });

  it('the junk id, the blank and the null are all UNMAPPED', () => {
    expect(classifyMapping(row({ company_name: '10170221, USD' }))).toBe('unmapped');
    expect(classifyMapping(row({ company_name: null }))).toBe('unmapped');
    expect(classifyMapping(row({ company_name: '  ' }))).toBe('unmapped');
  });

  it('a company name equal to the ACCOUNT ID is unmapped even without a currency suffix', () => {
    expect(classifyMapping(row({ account_id: 'abc123', company_name: 'abc123' }))).toBe('unmapped');
  });
});

describe('the rendering rule is one-directional and has no exceptions', () => {
  it('🔴 THE INVERSION: a junk company name NEVER becomes the title', () => {
    const r = row({ company_name: '10170221, USD' });
    expect(displayCompany(r)).toBeNull();
    // And the real name is still available for the SUBTEXT slot, where it belongs.
    expect(displayMetaName(r)).toBe('Columbia Outdoor Restoration X SocialWorks');
  });

  it('displayCompany returns null rather than a fallback, so a caller cannot print junk by accident', () => {
    // Returning `meta_name` here would let every call site silently re-create the inversion
    // while looking like it handled the case.
    expect(displayCompany(row({ company_name: null }))).toBeNull();
  });

  it('🔴 THE UNRECOVERABLE ROW: the id in BOTH columns yields NO printable name at all', () => {
    // account 391432983081972 — meta_name IS the raw id, so there is no real name anywhere
    // in the database. It must not echo the number back under a second label.
    const r = { account_id: '391432983081972', meta_name: '391432983081972, USD', company_name: null };
    expect(displayCompany(r)).toBeNull();
    expect(displayMetaName(r)).toBeNull();
  });

  it('🔑 ANTI-VACUITY: a healthy row prints BOTH halves, in the right slots', () => {
    expect(displayCompany(row())).toBe('Columbia Outdoor Restoration');
    expect(displayMetaName(row())).toBe('Columbia Outdoor Restoration X SocialWorks');
  });
});

describe('sortKey — the key must be the string the user SEES', () => {
  it('🔴 sorts on the rendered headline, not on the raw column', () => {
    // The old clause ordered by `company_name` while the column displayed
    // `company_name ?? meta_name`: two different sort keys inside one visible column. And
    // because digits collate before letters, the four junk rows landed at positions 8-11 —
    // the most prominent rows on the screen, showing the exact defect being complained about.
    expect(sortKey(row({ company_name: '10170221, USD' })))
      .toBe('columbia outdoor restoration x socialworks');
    expect(sortKey(row())).toBe('columbia outdoor restoration');
  });

  it('falls back to the account id only when nothing else is printable', () => {
    expect(sortKey({ account_id: '391432983081972', meta_name: '391432983081972, USD', company_name: null }))
      .toBe('391432983081972');
  });
});

describe('formatMoney — an em dash and a zero are different facts', () => {
  it('🔴 A MEASURED $0 IS NOT AN EM DASH. `!n` said it was, on 28 of 52 live rows', () => {
    // The table wrote `!n ? '—' : …` and the panel wrote `n == null ? '—' : …` under the
    // SAME NAME, so the same account read "—" in the table and "$0" in the panel one click
    // later. `!0` is true. An em dash means "we do not know"; $0 means "we looked".
    expect(formatMoney(0)).toBe('$0');
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined)).toBe('—');
  });

  it('CONTROL: real amounts still render as whole dollars', () => {
    expect(formatMoney(10742.74)).toBe('$10,743');
    expect(formatMoney(5000)).toBe('$5,000');
  });

  it('NaN is unknown, not "$NaN"', () => {
    expect(formatMoney(Number.NaN)).toBe('—');
  });
});
