import { describe, it, expect } from 'vitest';
import { buildAccountSummaries } from './dataService';
import { buildAccountRegistry, emptyAccountRegistry, type AdAccountRecord } from './accountRegistry';
import { accountTitle } from './accountDisplay';
import { makeAdSpendRow, makeSettings } from '@/test/factories';

/**
 * 🔴 THE MAPPING SCREEN WAS WRITE-ONLY, measured end to end at the layer every screen reads.
 *
 * @andrew: "fix this account mapping ... it just seems so broken" and "it shouldn't even say
 * airtable. It should say company name." The Settings table wrote `ad_accounts`, and
 * `buildAccountSummaries` — the single function behind the Dashboard, Accounts, Campaigns
 * and Team screens — had never heard of it. It resolved the NAME from the raw Meta string
 * and the PROGRAM and MEDIA BUYER from the legacy `settings.accountAliases` JSON.
 *
 * These arms are at summary level rather than component level on purpose: five screens
 * consume this one object, so proving the resolution here proves it for all of them.
 */

const spend = (accountName: string) =>
  makeAdSpendRow({ accountName, campaignId: `c-${accountName}`, spent: 100, leads: 5 });

const record = (o: Partial<AdAccountRecord>): AdAccountRecord => ({
  account_id: '596293242787360', meta_name: 'Backyard Paradiso X SocialWorks',
  company_name: 'Backyard Paradiso', program: 'Done With You', media_buyer: 'Jez',
  status: 'active', ...o,
});

const summarise = (rows: AdAccountRecord[] | null, legacyAlias?: Record<string, unknown>) =>
  buildAccountSummaries(
    [spend('Backyard Paradiso X SocialWorks')],
    [],
    makeSettings(legacyAlias
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? { accountAliases: [legacyAlias as any] }
      : {}),
    undefined,
    rows ? buildAccountRegistry(rows) : emptyAccountRegistry(),
  ).accounts[0];

describe('🔴 the curated company name reaches every screen, not just Settings', () => {
  it('the summary carries the CLIENT name alongside the Meta match key', () => {
    const a = summarise([record({})]);
    expect(a.accountName).toBe('Backyard Paradiso X SocialWorks'); // the key, unchanged
    expect(a.companyName).toBe('Backyard Paradiso');               // what the user sees
    expect(accountTitle(a).label).toBe('Backyard Paradiso');
  });

  it('🔑 ANTI-VACUITY: without the registry it is still Meta\'s name, which is the defect', () => {
    const a = summarise(null);
    expect(a.companyName).toBeNull();
    expect(accountTitle(a).label).toBe('Backyard Paradiso X SocialWorks');
  });

  it('⛔ an unmapped account is NEVER labelled with its account id', () => {
    // One live row has the raw id in both columns: "391432983081972, USD".
    const junk = buildAccountSummaries(
      [spend('391432983081972, USD')], [], makeSettings(), undefined,
      buildAccountRegistry([record({ meta_name: '391432983081972, USD', company_name: null })]),
    ).accounts[0];
    expect(junk.companyName).toBeNull();
    expect(accountTitle(junk).label).toBe('Unnamed ad account');
  });
});

describe('🔴 program and media buyer come from the curated table, and admit when unset', () => {
  it('the curated program wins over the legacy alias', () => {
    const a = summarise([record({ program: 'Internal', media_buyer: 'Ash' })], {
      sheetName: 'Backyard Paradiso X SocialWorks', airtableName: 'Backyard Paradiso X SocialWorks',
      program: 'Done For You', mediaBuyer: 'Jez', status: 'Active',
    });
    // `Internal` could not previously reach ANY consumer: it was absent from the
    // AccountMapping union, so the footnote promising what it does was unkeepable.
    expect(a.program).toBe('Internal');
    expect(a.mediaBuyer).toBe('Ash');
  });

  it('a NULL curated program falls back to the legacy alias rather than erasing it', () => {
    const a = summarise([record({ program: null, media_buyer: null })], {
      sheetName: 'Backyard Paradiso X SocialWorks', airtableName: 'Backyard Paradiso X SocialWorks',
      program: 'Done With You', mediaBuyer: 'Jez', status: 'Active',
    });
    expect(a.program).toBe('Done With You');
    expect(a.mediaBuyer).toBe('Jez');
  });

  it('⭐ no program anywhere reads "Unknown" — it is NOT silently "Done For You"', () => {
    // Five live accounts have no program, one of them (No Streaks) spent $7,008 in 2026 and
    // last spent today. `getAccountMapping` defaulted them to 'Done For You', which then
    // chose which performance rule judged the media buyer's work.
    const a = summarise([record({ program: null })]);
    expect(a.program).toBe('Unknown');
  });

  it('archiving an account in the mapping screen actually reaches the groupings', () => {
    const a = summarise([record({ status: 'archived' })]);
    expect(a.status).toBe('Churned');
  });

  it('⛔ but `active` does not overwrite a finer legacy state', () => {
    const a = summarise([record({ status: 'active' })], {
      sheetName: 'Backyard Paradiso X SocialWorks', airtableName: 'Backyard Paradiso X SocialWorks',
      program: 'Done For You', mediaBuyer: '', status: 'Paused',
    });
    expect(a.status).toBe('Paused');
  });
});

describe('a name that cannot be resolved leaves the legacy answer alone', () => {
  it('a Meta name absent from ad_accounts changes nothing', () => {
    const a = summarise([record({ meta_name: 'Some Other Account' })], {
      sheetName: 'Backyard Paradiso X SocialWorks', airtableName: 'Backyard Paradiso X SocialWorks',
      program: 'Done For You', mediaBuyer: 'Jez', status: 'Active',
    });
    expect(a.companyName).toBeNull();
    expect(a.program).toBe('Done For You');
    expect(a.mediaBuyer).toBe('Jez');
  });
});
