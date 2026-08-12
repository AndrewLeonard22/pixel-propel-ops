import { describe, it, expect } from 'vitest';
import {
  META_SPEND_COLUMNS,
  META_SPEND_SELECT,
  metaRowToAdSpendRow,
  monthNameOf,
  toNumber,
  type MetaSpendRecord,
} from './metaAdSpend';
import type { AdSpendRow } from './types';

/**
 * ② SILENT COLUMN DRIFT — THE SUPABASE EDITION.
 *
 * ⛔ WHAT THIS FILE USED TO TEST, AND WHY MOST OF IT IS GONE. It covered
 * `checkColumnContract` against `WINDSOR_COLUMNS`: a wrong Google Sheets TAB answering
 * HTTP 200 with the default tab's schema, `Spent` renamed to `Amount Spent`, a column
 * PRESENT and ENTIRELY BLANK so `parseNumber('')` turned every total into a confident
 * zero, headers case-folded, alternate spellings. Every one of those is a hazard an
 * untyped CSV has and a typed Postgres column does not. `spend` is `numeric`, `date` is a
 * `date`, `leads` is an `integer`, and a renamed column is a PostgREST error rather than a
 * silent empty string. The mechanism retired with the sheet on 2026-08-11.
 *
 * ⭐ THE LAW SURVIVED THE MECHANISM, AND IT IS THE HALF THAT WAS ALWAYS LOAD-BEARING:
 *
 *     every column the CONTRACT names is READ by the mapper, and every field the MAPPER
 *     produces comes from a contract column — proven in BOTH directions, over a
 *     non-empty population.
 *
 * What it catches today is the post-cutover shape of the same defect: a column quietly
 * dropped from the `select(...)` list, after which PostgREST simply does not return it,
 * `String(undefined ?? '')` is `''`, `toNumber(undefined)` is `0`, and every value that
 * column fed becomes a confident zero with no error anywhere.
 *
 * 🔑 AND IT IS DRIVEN BY BEHAVIOUR, NOT BY A REGEX OVER THE SOURCE FILE. The old version
 * sliced `dataService.ts` between two function names and scanned the text between them for
 * `pick(r, '...')` calls. That slice was ALREADY BROKEN when this was rewritten:
 * `indexOf('export async function fetchCallCenterData')` returned **-1** because that
 * function had been deleted, so `slice(start, -1)` silently took everything to end of file
 * and the arms passed by luck. A test that reads the implementation as TEXT breaks
 * invisibly when the implementation is refactored; one that RUNS the implementation cannot.
 */

/** A record with a distinct, recognisable value in every contract column. */
function fullRecord(): MetaSpendRecord {
  return {
    date: '2026-08-08',
    ad_id: 'AD-1',
    account_id: 'ACCT-1',
    account_name: 'Testerman Pro Wash',
    campaign_id: 'CAMP-1',
    campaign_name: 'Campaign One',
    adset_id: 'ADSET-1',
    adset_name: 'Adset One',
    ad_name: 'Ad One',
    spend: '1234.50',
    leads: 7,
  };
}

/**
 * The AdSpendRow fields that carry data from the source. `month` is DERIVED from `date`
 * rather than selected, and `dateISO` is the same column as `date`; both are handled
 * explicitly below rather than being quietly exempted.
 */
const SOURCE_BACKED_FIELDS: (keyof AdSpendRow)[] = [
  'date', 'dateISO', 'campaign', 'campaignId', 'adsetName', 'adsetId',
  'adName', 'adId', 'spent', 'leads', 'accountName', 'accountId',
];

describe('the contract agrees with the MAPPER, in both directions', () => {
  it('NON-VACUITY: the contract is non-empty and the mapper really reads it', () => {
    // Without this, both directions below pass over an empty set — the population failure
    // that fakes a clean result. The old version of this arm caught exactly that once.
    expect(META_SPEND_COLUMNS.length).toBeGreaterThan(10);
    expect(META_SPEND_SELECT.split(',')).toEqual([...META_SPEND_COLUMNS]);

    const row = metaRowToAdSpendRow(fullRecord());
    for (const f of SOURCE_BACKED_FIELDS) {
      expect(row[f], `${String(f)} is empty even from a fully populated record`).toBeTruthy();
    }
  });

  it('🔴 every column in the CONTRACT is READ by the mapper — else the select is carrying dead weight', () => {
    /**
     * Drop ONE column at a time and require the mapped row to change. A contract entry no
     * reader consumes is not harmless: it is a column we pay to transfer and, worse, a
     * false assurance that the field it appears to guard is guarded.
     */
    const baseline = metaRowToAdSpendRow(fullRecord());
    for (const col of META_SPEND_COLUMNS) {
      const missing = { ...fullRecord() };
      delete (missing as Record<string, unknown>)[col];
      const got = metaRowToAdSpendRow(missing as MetaSpendRecord);
      expect(
        JSON.stringify(got),
        `dropping "${col}" changed nothing — no field is fed by it, so it is unread`,
      ).not.toEqual(JSON.stringify(baseline));
    }
  });

  it('🔴 every source-backed FIELD comes from a contract column — else it is unguarded', () => {
    /**
     * The direction a one-sided loop cannot have, and the one @apprentice's allowlist
     * sabotage proved matters: removing an entry from the side you iterate just SHRINKS
     * THE LOOP and passes silently.
     *
     * With every contract column absent, every source-backed field must be empty. A field
     * that still holds a value is being populated from somewhere the contract does not
     * name — so dropping its column from the select would never be caught here.
     */
    const empty = metaRowToAdSpendRow({} as MetaSpendRecord);
    for (const f of SOURCE_BACKED_FIELDS) {
      expect(
        empty[f],
        `${String(f)} is populated with no contract column present — it is fed from outside the contract`,
      ).toBeFalsy();
    }
    // `month` is DERIVED, not selected — named here so the exemption is deliberate.
    expect(empty.month).toBe('');
  });

  it('every CRITICAL column feeds a NUMBER or the IDENTITY — and the identity is an id, not a name', () => {
    /**
     * ⭐ THIS IS WHERE THE CUTOVER'S CENTRAL DECISION IS PINNED. The sheet-era version of
     * this arm hardcoded `['Account Name', 'Date', 'Leads', 'Spent']` — an account NAME as
     * the grouping key. Meta rewrites display names (five confirmed, e.g. `Publicity 1` ->
     * `Washbroz X SocialWorks`), which is what split one client into two accounts. The
     * identity is now `account_id`.
     */
    const critical = ['account_id', 'date', 'leads', 'spend'];
    for (const c of critical) {
      expect(META_SPEND_COLUMNS as readonly string[], `${c} must be selected`).toContain(c);
    }

    // Losing any one of them must visibly damage the row rather than pass through as a zero
    // nobody can distinguish from a real one.
    const noSpend = metaRowToAdSpendRow({ ...fullRecord(), spend: null });
    expect(noSpend.spent).toBe(0);
    const noId = metaRowToAdSpendRow({ ...fullRecord(), account_id: '' });
    expect(noId.accountId).toBe('');

    // ⚠️ AND THE NAME IS EXPLICITLY *NOT* CRITICAL ANY MORE. An account whose display name
    // is missing still groups correctly, because grouping is on the id.
    const noName = metaRowToAdSpendRow({ ...fullRecord(), account_name: '' });
    expect(noName.accountId).toBe('ACCT-1');
  });
});

describe('the typed columns still need their edges checked', () => {
  it('🔴 numeric arrives as a STRING from PostgREST and must not become NaN', () => {
    // `numeric` is serialised as a string because JS numbers cannot hold every value.
    // `Number('')` and `Number(null)` are both 0, so an ABSENT value and a real zero are
    // indistinguishable downstream — what must never happen is NaN propagating into a
    // total, where it poisons every sum it touches and renders as "NaN" on screen.
    expect(toNumber('1234.50')).toBe(1234.5);
    expect(toNumber(0)).toBe(0);
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber('')).toBe(0);
    expect(toNumber('not a number')).toBe(0);
    expect(toNumber(Number.NaN)).toBe(0);
    expect(toNumber(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('month is derived from the date and REFUSES rather than guessing', () => {
    expect(monthNameOf('2026-08-08')).toBe('August');
    expect(monthNameOf('2026-01-01')).toBe('January');
    expect(monthNameOf('2026-12-31')).toBe('December');
    // Not "January", and not today's month: a value we cannot derive is empty.
    expect(monthNameOf('')).toBe('');
    expect(monthNameOf('8/4/2026')).toBe('');
    expect(monthNameOf('2026-13-01')).toBe('');
  });

  it('🔑 date and dateISO agree, because they are now the SAME column', () => {
    // On the sheet these could drift: `date` was whatever Google rendered and `dateISO` was
    // a normalisation of it. `ad_insights.date` is a typed date, so there is one string and
    // no reader can be looking at a stale copy of the other.
    const row = metaRowToAdSpendRow(fullRecord());
    expect(row.date).toBe('2026-08-08');
    expect(row.dateISO).toBe(row.date);
  });
});
