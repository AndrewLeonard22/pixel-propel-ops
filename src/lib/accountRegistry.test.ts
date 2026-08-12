import { describe, it, expect } from 'vitest';
import {
  accountIdIn, buildAccountRegistry, emptyAccountRegistry, normalizeAccountName,
  resolveProgram, resolveMediaBuyer, resolveStatus,
  type AdAccountRecord,
} from './accountRegistry';

/**
 * 🔴 THE DEFECT UNDER TEST: the account mapping screen was WRITE-ONLY.
 *
 * `ad_accounts.company_name` was read by three files, all inside Settings. Every other
 * screen resolved identity from the raw Meta name and program/media-buyer from the legacy
 * alias JSON. The user renamed an account, the Settings row updated, and nothing else in
 * the product changed — complaint 2 fixed on one screen out of seven.
 *
 * These arms measure the JOIN, because the join is the whole risk: the only key the two
 * data sets share is a NAME, and a wrong match here renames a client's account.
 */

const row = (o: Partial<AdAccountRecord>): AdAccountRecord => ({
  account_id: '1', meta_name: 'Acme', company_name: 'Acme Ltd',
  program: 'Done For You', media_buyer: 'Jez', status: 'active', ...o,
});

describe('the join key: exact, normalised, and refusing when it cannot be sure', () => {
  it('matches on the Meta account name after folding case and whitespace', () => {
    // All four shapes are live in the table: "STR ", "Co-Lights " etc. carry a trailing space.
    const r = buildAccountRegistry([row({ meta_name: 'Trimlight Phoenix ' })]);
    expect(r.byMetaName('Trimlight Phoenix')?.company).toBe('Acme Ltd');
    expect(r.byMetaName('  trimlight   phoenix  ')?.company).toBe('Acme Ltd');
  });

  it('⛔ IS NOT FUZZY. A near-miss resolves to nothing, never to the closest row', () => {
    const r = buildAccountRegistry([row({ meta_name: 'Backyard Paradiso' })]);
    // dataService runs a Levenshtein tier for APPOINTMENTS, where a wrong match costs one
    // booking. A wrong match here renames a client's whole account and relabels its program.
    expect(r.byMetaName('Backyard Paradise')).toBeNull();
    expect(r.byMetaName('Backyard')).toBeNull();
  });

  it('🔑 A COLLIDING NAME MAPS TO NOTHING — prefer the dupe over a coin flip', () => {
    const r = buildAccountRegistry([
      row({ account_id: '1', meta_name: 'Shared Name', company_name: 'Client A' }),
      row({ account_id: '2', meta_name: 'shared name ', company_name: 'Client B' }),
    ]);
    // Silently attributing one client's spend to another is strictly worse than not
    // resolving it. Both rows leave the index; neither wins.
    expect(r.byMetaName('Shared Name')).toBeNull();
    expect(r.size).toBe(0);
  });

  it('⛔ A JUNK META NAME IS NOT A KEY — a number must not match a number', () => {
    // One live row has the raw id in `meta_name`: "391432983081972, USD".
    const r = buildAccountRegistry([row({ meta_name: '391432983081972, USD' })]);
    expect(r.byMetaName('391432983081972, USD')).toBeNull();
    expect(r.size).toBe(0);
  });

  it('never promotes a number into the company slot', () => {
    // The original defect string, seeded from the legacy `airtableName` field.
    const r = buildAccountRegistry([row({ meta_name: 'Columbia Outdoor', company_name: '10170221, USD' })]);
    expect(r.byMetaName('Columbia Outdoor')?.company).toBeNull();
  });

  it('normalizeAccountName folds only case and whitespace', () => {
    expect(normalizeAccountName('  A  B ')).toBe('a b');
    expect(normalizeAccountName(null)).toBe('');
    // Punctuation is NOT folded: "Co-Lights" and "Co Lights" are different businesses
    // as far as this module is allowed to assume.
    expect(normalizeAccountName('Co-Lights')).not.toBe(normalizeAccountName('Co Lights'));
  });
});

describe('a failed read is NOT "there are no accounts"', () => {
  it('the empty registry says it was never told anything', () => {
    const r = emptyAccountRegistry();
    expect(r.known).toBe(false);
    expect(r.byMetaName('anything')).toBeNull();
  });

  it('🔑 ANTI-VACUITY: a real read says so, even when it returns zero usable rows', () => {
    // Without this arm, `known` could be hardcoded false and every arm above still passes.
    expect(buildAccountRegistry([]).known).toBe(true);
    expect(buildAccountRegistry([row({})]).known).toBe(true);
  });
});

describe('precedence: a curated value wins, an ABSENT one does not overwrite', () => {
  const id = (o: Partial<ReturnType<typeof mk>>) => ({ ...mk(), ...o });
  function mk() {
    return { accountId: '1', company: 'Acme Ltd', program: 'Internal', mediaBuyer: 'Jez', status: 'active' as string | null };
  }

  it('the curated program beats the legacy alias', () => {
    expect(resolveProgram(id({}), 'Done For You')).toBe('Internal');
  });

  it('a NULL curated program falls through to the legacy alias, it does not erase it', () => {
    // Five live rows have no program. Null is the absence of an answer, not an answer.
    expect(resolveProgram(id({ program: null }), 'Done With You')).toBe('Done With You');
    expect(resolveProgram(null, 'Done With You')).toBe('Done With You');
  });

  it('nothing anywhere resolves to null — never to a default program', () => {
    // `getAccountMapping` used to return 'Done For You' here, which is a refusal rendered
    // as a confident fact and then used to pick which rule judges the media buyer.
    expect(resolveProgram(id({ program: null }), null)).toBeNull();
    expect(resolveProgram(id({ program: null }), '   ')).toBeNull();
  });

  it('media buyer follows the same rule', () => {
    expect(resolveMediaBuyer(id({ mediaBuyer: null }), 'Legacy')).toBe('Legacy');
    expect(resolveMediaBuyer(id({}), 'Legacy')).toBe('Jez');
    expect(resolveMediaBuyer(null, null)).toBeNull();
  });
});

describe('status: the ONE place the two models touch, and it is one-directional', () => {
  const withStatus = (s: string | null) =>
    ({ accountId: '1', company: 'A', program: null, mediaBuyer: null, status: s });

  it('⭐ `archived` OVERRIDES to Churned, so the Archived control is not a no-op', () => {
    // The panel wrote the column, the table drew a chip, and every dashboard grouping went
    // on treating the account as live. A control whose only effect is to draw its own label
    // is not a control.
    expect(resolveStatus(withStatus('archived'), 'Active')).toBe('Churned');
  });

  it('⛔ `active` OVERRIDES NOTHING — a coarser field must not overwrite a finer one', () => {
    // The legacy store distinguishes Paused from Active; `ad_accounts` cannot express
    // Paused at all, so letting `active` win would destroy information.
    expect(resolveStatus(withStatus('active'), 'Paused')).toBe('Paused');
    expect(resolveStatus(withStatus('active'), 'Churned')).toBe('Churned');
  });

  it('falls back to Active only when nothing anywhere says otherwise', () => {
    expect(resolveStatus(null, null)).toBe('Active');
    expect(resolveStatus(withStatus(null), '')).toBe('Active');
  });
});

/**
 * ⭐ THE STRINGS @andrew POINTED AT ARE THE PRIMARY KEY.
 *
 * Measured against the live feed 2026-08-12: 14 of 62 ad-spend account names match no
 * `meta_name`, and four of them are "<digits>, USD" — the Meta `account_id`, which is
 * `ad_accounts`' primary key. So the rows that read worst on screen resolve with the
 * STRONGEST key in the system, not the weakest.
 */
describe('🔴 "10170221, USD" is an ACCOUNT ID, and an id is a real key', () => {
  const live = [
    row({ account_id: '10170221', meta_name: 'Columbia Outdoor Restoration X SocialWorks', company_name: 'Columbia Outdoor Restoration' }),
    row({ account_id: '103578393327348', meta_name: 'TrueClean X SocialWorks', company_name: 'TrueClean' }),
    row({ account_id: '222178771', meta_name: 'Pro Clean Mobile Wash X SocialWorks', company_name: 'Pro Clean Mobile Wash' }),
  ];

  it('resolves the exact four shapes the ad-spend feed carries', () => {
    const r = buildAccountRegistry(live);
    expect(r.byMetaName('10170221, USD')?.company).toBe('Columbia Outdoor Restoration');
    expect(r.byMetaName('103578393327348, USD')?.company).toBe('TrueClean');
    expect(r.byMetaName('222178771, USD')?.company).toBe('Pro Clean Mobile Wash');
    // A bare id, no currency suffix.
    expect(r.byMetaName('10170221')?.company).toBe('Columbia Outdoor Restoration');
  });

  it('the id beats the name when both could match, because a key beats a label', () => {
    const r = buildAccountRegistry([
      ...live,
      // A mischievous row literally NAMED after another account's id.
      row({ account_id: '999', meta_name: '10170221', company_name: 'Impostor' }),
    ]);
    expect(r.byMetaName('10170221')?.accountId).toBe('10170221');
  });

  it('⛔ THE SHAPE IS NARROW — a stray numeral does not drag a row in', () => {
    const r = buildAccountRegistry(live);
    expect(accountIdIn('Publicity 1')).toBeNull();
    expect(accountIdIn('Safe Turf Ad Account')).toBeNull();
    expect(accountIdIn('10170221 Columbia')).toBeNull();
    expect(accountIdIn('10170221, USD')).toBe('10170221');
    expect(accountIdIn('10170221 , usd')).toBe('10170221');
    expect(r.byMetaName('Publicity 1')).toBeNull();
  });

  it('an id that is in the feed but not in the table still resolves to nothing', () => {
    expect(buildAccountRegistry(live).byMetaName('55555, USD')).toBeNull();
  });
});

describe('⛔ the Airtable name is a JOIN KEY and must be matched VERBATIM', () => {
  /**
   * 🔴 THE TRAP THIS PROJECT WAS WARNED ABOUT, AND THE SUITE COULD NOT SEE IT.
   *
   * A previous agent nearly "cleaned" the equivalent field in the legacy alias store, which
   * would have detached four accounts from their appointments while fixing nothing visible.
   * The same hazard survives the cutover, one table over: `ad_account_airtable_names.
   * airtable_name` must equal what Airtable's "Client Name" field LITERALLY contains,
   * including the odd spacing and the lowercase "l" separators.
   *
   * Measured 2026-08-12 by mutation: normalising the stored side with
   * `.replace(/[^a-z0-9 ]/gi, '')` left all 694 tests green, while silently detaching three
   * of the sixteen live links — 'Finer Lawn & Landscaping LLC', 'Premier Custom Decks &
   * Design' and 'Transforming Landscape Co.'. Ampersands and full stops are not decoration
   * in a match key.
   *
   * ⚠️ AND WHY IT WENT UNNOTICED IN PRODUCTION TOO: the appointment join is tiered, and the
   * campaign-id tier below it currently re-attaches every one of those appointments. So
   * "cleaning" the key costs ZERO appointments today and would cost 627 the day Meta
   * renames an account and the campaign-id tier is the thing that is missing. A guard whose
   * failure is invisible until the exact moment it is needed has to be pinned by a test,
   * because nothing else will report it.
   *
   * ⛔ NORMALISATION THAT IS ALLOWED: case, surrounding whitespace, and internal whitespace
   * runs — the same folding the database's own primary key applies (`lower(btrim(...))`).
   * Nothing else. These arms fix that boundary in both directions.
   */
  const link = (airtable_name: string, account_id = 'ACCT') => ({
    airtable_name_key: airtable_name.trim().toLowerCase(),
    airtable_name,
    account_id,
  });

  it('🔴 PUNCTUATION IS PART OF THE KEY: & and . survive into the index', () => {
    const r = buildAccountRegistry(
      [row({ account_id: 'A1' }), row({ account_id: 'A2' })],
      [link('Finer Lawn & Landscaping LLC', 'A1'), link('Transforming Landscape Co.', 'A2')],
    );
    expect(r.airtableNameToAccountId('Finer Lawn & Landscaping LLC')).toBe('A1');
    expect(r.airtableNameToAccountId('Transforming Landscape Co.')).toBe('A2');
    // The "cleaned" spelling is a DIFFERENT client name and must not resolve. This is the
    // arm that fails if either side of the join starts stripping characters.
    expect(r.airtableNameToAccountId('Finer Lawn Landscaping LLC')).toBeNull();
    expect(r.airtableNameToAccountId('Transforming Landscape Co')).toBeNull();
  });

  it('🔴 the lowercase "l" separator is DATA, not a typo to be tidied', () => {
    // Four live client names use it: 'New Jersey l Backyard Paradiso' and friends. It reads
    // like a pipe rendered badly, which is exactly what makes it tempting to "fix".
    const r = buildAccountRegistry([row({ account_id: 'BP' })], [link('New Jersey l Backyard Paradiso', 'BP')]);
    expect(r.airtableNameToAccountId('New Jersey l Backyard Paradiso')).toBe('BP');
    expect(r.airtableNameToAccountId('New Jersey | Backyard Paradiso')).toBeNull();
    expect(r.airtableNameToAccountId('New Jersey Backyard Paradiso')).toBeNull();
  });

  it('⭐ CONTROL: case and whitespace ARE folded, so this is not merely "exact equality"', () => {
    // Without this arm the three above are satisfiable by `===`, and the real normalisation
    // the database performs would be untested. Airtable's own values carry stray inner and
    // trailing spacing, so the folding is load-bearing in the other direction.
    const r = buildAccountRegistry([row({ account_id: 'BP' })], [link('San Antonio l Backyard Paradiso ', 'BP')]);
    expect(r.airtableNameToAccountId('  SAN ANTONIO   l  backyard paradiso  ')).toBe('BP');
  });

  it('🔴 ONE ACCOUNT, MANY NAMES — a scalar column would have dropped three of these', () => {
    // account_id 596293242787360 legitimately serves four Airtable client names. The
    // relation is one-to-many, which is why it is a table and not a column on ad_accounts.
    const names = [
      'New Jersey l Backyard Paradiso', 'Naples l Backyard Paradiso',
      'Backyard Paradiso Colorado LLC', 'San Antonio l Backyard Paradiso',
    ];
    const r = buildAccountRegistry([row({ account_id: 'BP' })], names.map(n => link(n, 'BP')));
    expect(r.airtableNameCount).toBe(4);
    for (const n of names) expect(r.airtableNameToAccountId(n)).toBe('BP');
  });

  it('🔴 a name claimed by TWO accounts resolves to NEITHER — prefer the dupe', () => {
    // The database makes the normalised name a PRIMARY KEY, so this cannot happen there.
    // The client-side index must not be able to disagree with that by picking a winner:
    // attributing one client's bookings to another is strictly worse than not resolving.
    const r = buildAccountRegistry(
      [row({ account_id: 'A1' }), row({ account_id: 'A2' })],
      [link('Shared Client', 'A1'), link('Shared Client', 'A2')],
    );
    expect(r.airtableNameToAccountId('Shared Client')).toBeNull();
    expect(r.airtableNameCount).toBe(0);
  });

  it('the same name repeated for the SAME account is not a collision', () => {
    // CONTROL on the rule above: dropping both entries is right only for a genuine conflict.
    const r = buildAccountRegistry([row({ account_id: 'A1' })], [link('Solo Client', 'A1'), link('Solo Client', 'A1')]);
    expect(r.airtableNameToAccountId('Solo Client')).toBe('A1');
  });
});
