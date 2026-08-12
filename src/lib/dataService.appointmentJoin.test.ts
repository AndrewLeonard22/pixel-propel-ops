import { describe, it, expect } from 'vitest';
import { buildAccountSummaries, accountIdentityKey } from './dataService';
import { buildAccountRegistry, type AirtableNameLink, type AdAccountRecord } from './accountRegistry';
import { makeSettings, makeAdSpendRow } from '@/test/factories';
import type { AppointmentRow, AdSpendRow } from './types';

/**
 * 🔒 THE APPOINTMENT JOIN ACROSS THE SUPABASE CUTOVER — THE TEST THAT DID NOT EXIST.
 *
 * 🔴 THE GAP THIS FILLS, MEASURED BEFORE THE CUTOVER: of 697 tests, ZERO passed both a
 * populated `accountAliases` AND appointments into `buildAccountSummaries`. Tier 2 (the
 * manual alias) had no coverage at all. Every other test matched a client to an account by
 * EXACT NAME EQUALITY, which is Tier 3 — not the path the renamed accounts use.
 *
 * ⭐ WHY THAT MATTERED HERE SPECIFICALLY. The chain was:
 *
 *     appt.client -> accountAliases[].airtableName -> accountAliases[].sheetName
 *                 -> the name the GOOGLE SHEET used for the account
 *
 * The cutover changes the right-hand end: account identity now comes from
 * `ad_insights.account_id`. Meta REWRITES display names — five confirmed, including
 * `Publicity 1` -> `Washbroz X SocialWorks` and `Christmas Light Pros` -> `Hydro Pro Wash
 * X SocialWorks`, neither of which any similarity metric would ever pair — so an alias
 * table keyed on the sheet's HISTORICAL names silently stops resolving. Nothing goes red.
 * No banner fires. `unmatchedAppointments` grows, and the only surface that would show it
 * reads as a pre-existing note.
 *
 * ⚠️ `airtableName` IS A JOIN KEY, NOT A DISPLAY LABEL. A previous agent nearly "cleaned"
 * it, which would have detached four accounts from their appointments while fixing nothing
 * visible. These arms are what make that edit go red.
 */

const ACCOUNTS: AdAccountRecord[] = [
  // The rename that started this: the sheet knew it as `Publicity 1`.
  { account_id: '322974296642516', meta_name: 'Washbroz X SocialWorks', company_name: 'Washbroz', program: 'Done For You', media_buyer: 'Sam', status: 'active' },
  // One account, MANY Airtable client names — the shape a scalar column cannot hold.
  { account_id: '596293242787360', meta_name: 'Backyard Paradiso', company_name: 'Backyard Paradiso', program: 'Done For You', media_buyer: 'Alex', status: 'active' },
];

/** The seeded `ad_account_airtable_names` rows for those accounts. */
const LINKS: AirtableNameLink[] = [
  { airtable_name_key: 'washbroz llc', airtable_name: 'Washbroz LLC', account_id: '322974296642516' },
  { airtable_name_key: 'new jersey l backyard paradiso', airtable_name: 'New Jersey l Backyard Paradiso', account_id: '596293242787360' },
  { airtable_name_key: 'naples l backyard paradiso', airtable_name: 'Naples l Backyard Paradiso', account_id: '596293242787360' },
];

const registry = () => buildAccountRegistry(ACCOUNTS, LINKS);

/** A spend row as the SUPABASE source produces it: id-bearing, Meta's CURRENT name. */
function metaRow(over: Partial<AdSpendRow> = {}): AdSpendRow {
  return makeAdSpendRow({ campaignId: '', ...over });
}

function appt(client: string, over: Partial<AppointmentRow> = {}): AppointmentRow {
  return { client, campaignId: '', appointmentDate: '2026-08-08', dateAdded: '2026-08-08', ...over } as AppointmentRow;
}

describe('THE RENAME: an account Meta renamed keeps its appointments', () => {
  const spend = [metaRow({ accountId: '322974296642516', accountName: 'Washbroz X SocialWorks' })];

  it('🔴 resolves through account_id, NOT through the name the sheet used', () => {
    // The appointment names the client; the account calls itself something else entirely.
    // Only `ad_account_airtable_names` bridges them.
    const r = buildAccountSummaries(spend, [appt('Washbroz LLC')], makeSettings(), undefined, registry());

    expect(r.unmatchedAppointments).toHaveLength(0);
    expect(r.accounts).toHaveLength(1);
    expect(r.accounts[0].appointments).toBe(1);
    expect(r.accounts[0].companyName).toBe('Washbroz');
  });

  it('🔴 ANTI-VACUITY CONTROL: without the link table the SAME appointment goes unmatched', () => {
    /**
     * The arm that makes the one above mean something. If this also passed, the join could
     * be succeeding through fuzzy matching or through some accident of the fixture rather
     * than through the id path — and a test that passes either way proves nothing.
     *
     * ⚠️ AND IT PROVES THE FUZZY TIER CANNOT RESCUE THIS. `Washbroz LLC` vs
     * `Washbroz X SocialWorks` is below the 0.85 Levenshtein threshold, which is precisely
     * why a name-based cutover loses these accounts silently.
     */
    const noLinks = buildAccountRegistry(ACCOUNTS, []);
    const r = buildAccountSummaries(spend, [appt('Washbroz LLC')], makeSettings(), undefined, noLinks);

    expect(r.unmatchedAppointments).toHaveLength(1);
    expect(r.accounts[0].appointments).toBe(0);
  });

  it('the STALE sheet-keyed alias no longer resolves — and that is why the link table exists', () => {
    // `accountAliases` still says `Publicity 1`, the name the sheet used. Post-cutover no
    // account answers to it. This is the silent detachment, reproduced deliberately.
    const stale = makeSettings({
      accountAliases: [{ sheetName: 'Publicity 1', airtableName: 'Washbroz LLC', program: '', mediaBuyer: '', status: '' }],
    });
    const withoutLinks = buildAccountSummaries(spend, [appt('Washbroz LLC')], stale, undefined, buildAccountRegistry(ACCOUNTS, []));
    expect(withoutLinks.unmatchedAppointments).toHaveLength(1);

    // ⭐ AND THE LINK TABLE OVERRIDES IT, because it is applied second on purpose: when both
    // answer, the id-keyed row is the one that survives a rename.
    const withLinks = buildAccountSummaries(spend, [appt('Washbroz LLC')], stale, undefined, registry());
    expect(withLinks.unmatchedAppointments).toHaveLength(0);
  });
});

describe('ONE ACCOUNT, MANY CLIENT NAMES — the shape a scalar column cannot hold', () => {
  it('🔴 four Airtable client names all land on the one account_id that serves them', () => {
    /**
     * Measured against the live Airtable: `596293242787360` (Backyard Paradiso) receives
     * appointments under FOUR distinct client names. A single `ad_accounts.airtable_name`
     * column would keep one and drop three — ~130 appointments — which is why the mapping
     * is a table keyed on the NAME, with the account on the many side.
     */
    const spend = [metaRow({ accountId: '596293242787360', accountName: 'Backyard Paradiso' })];
    const r = buildAccountSummaries(
      spend,
      [appt('New Jersey l Backyard Paradiso'), appt('Naples l Backyard Paradiso')],
      makeSettings(), undefined, registry(),
    );

    expect(r.unmatchedAppointments).toHaveLength(0);
    expect(r.accounts).toHaveLength(1);
    expect(r.accounts[0].appointments).toBe(2);
  });
});

describe('grouping is on the ID, so a rename cannot split one client in two', () => {
  it('🔴 THE DEFECT THE SHEET HAD: two names, one account_id — ONE account, not two', () => {
    // The sheet carried BOTH names for a renamed account and grouped on the name, so one
    // client became two accounts with two half-histories. Grouping on the id merges them.
    const spend = [
      metaRow({ accountId: '322974296642516', accountName: 'Publicity 1', spent: 100, leads: 2 }),
      metaRow({ accountId: '322974296642516', accountName: 'Washbroz X SocialWorks', adId: 'x2', spent: 250, leads: 3 }),
    ];
    const r = buildAccountSummaries(spend, [], makeSettings(), undefined, registry());

    expect(r.accounts).toHaveLength(1);
    expect(r.accounts[0].spend).toBe(350);
    expect(r.accounts[0].leads).toBe(5);
  });

  it('🔑 THE FALLBACK SURVIVES: rows with NO accountId still group by name, exactly as before', () => {
    /**
     * ~600 tests build `AdSpendRow` by hand and none of them set `accountId`. That fallback
     * is what let the source swap happen without rewriting them, and it must stay
     * falsifiable rather than becoming dead code.
     */
    const legacy = [
      makeAdSpendRow({ accountName: 'Acme', spent: 10 }),
      makeAdSpendRow({ accountName: 'ACME', adId: 'x2', spent: 15 }),
      makeAdSpendRow({ accountName: 'Other', adId: 'x3', spent: 5 }),
    ];
    const r = buildAccountSummaries(legacy, [], makeSettings());
    expect(r.accounts).toHaveLength(2);
    expect(r.accounts.find(a => a.accountName === 'Acme')?.spend).toBe(25);
  });

  it('accountIdentityKey prefers the id and falls back to the folded name — one definition', () => {
    // Exported precisely so the matcher and the alias maps cannot each hold a slightly
    // different copy of this rule. A second, near-identical key is how Targets would
    // reclassify accounts that Dashboard resolved correctly.
    expect(accountIdentityKey({ accountId: '123', accountName: 'Anything' })).toBe('123');
    expect(accountIdentityKey({ accountId: '', accountName: '  Acme  ' })).toBe('acme');
    expect(accountIdentityKey({ accountId: undefined, accountName: '' })).toBe('unknown');
  });
});

describe('an appointment that cannot be attributed is VISIBLE, never dropped', () => {
  it('🔴 an account with NO spend rows leaves its appointments in the unmatched bucket', () => {
    /**
     * ⚠️ THE MEASURED COST OF THIS CUTOVER, PINNED SO IT CANNOT BE MISTAKEN FOR A BUG.
     * Three ad accounts carrying 57 live appointments have ZERO rows in `ad_insights` —
     * Meta no longer returns them, so their spend history is not in the database at all.
     * Green Plus Remodeling (30), Pergola Guy (24), Home Remodeling Pros Central PA (3).
     *
     * They must land in `unmatchedAppointments`, where the Dashboard's TOTAL APPTS tile
     * still counts them and says the composition changed. Silently discarding them would
     * turn a visible, explainable 57 into a number nobody could reconcile.
     */
    const spend = [metaRow({ accountId: '596293242787360', accountName: 'Backyard Paradiso' })];
    const r = buildAccountSummaries(
      spend, [appt('New Jersey l Backyard Paradiso'), appt('Green Plus Remodeling')],
      makeSettings(), undefined, registry(),
    );

    expect(r.accounts[0].appointments).toBe(1);
    expect(r.unmatchedAppointments.map(a => a.client)).toEqual(['Green Plus Remodeling']);
    // CONSERVATION: attributed + unmatched = every appointment. Nothing evaporates.
    const attributed = r.accounts.reduce((n, a) => n + a.appointments, 0);
    expect(attributed + r.unmatchedAppointments.length).toBe(2);
  });

  it('an UNRESOLVED client is never joined on its placeholder name', () => {
    // A linked-record id is not a name; attributing on it would collapse every unresolved
    // appointment onto one pseudo-account, which is worse than leaving them unmatched.
    const spend = [metaRow({ accountId: '596293242787360', accountName: 'Backyard Paradiso' })];
    const r = buildAccountSummaries(
      spend, [appt('New Jersey l Backyard Paradiso', { clientUnresolved: true })],
      makeSettings(), undefined, registry(),
    );
    expect(r.unmatchedAppointments).toHaveLength(1);
  });
});

describe('the link table refuses to guess', () => {
  it('🔴 a client name claimed by TWO accounts resolves to NEITHER', () => {
    // Same rule as the meta-name index one module over: preferring the dupe over a
    // coin-flip. Silently attributing one client's appointments to another account is
    // strictly worse than not attributing them.
    const colliding: AirtableNameLink[] = [
      { airtable_name_key: 'shared', airtable_name: 'Shared', account_id: '322974296642516' },
      { airtable_name_key: 'shared', airtable_name: 'Shared', account_id: '596293242787360' },
    ];
    const reg = buildAccountRegistry(ACCOUNTS, colliding);
    expect(reg.airtableNameToAccountId('Shared')).toBeNull();
    // CONTROL: a non-colliding name in the same registry still resolves.
    expect(buildAccountRegistry(ACCOUNTS, LINKS).airtableNameToAccountId('Washbroz LLC'))
      .toBe('322974296642516');
  });

  it('matches case-insensitively and tolerates the spacing Airtable actually stores', () => {
    // Live values carry trailing and doubled spaces ('San Antonio l Backyard Paradiso ').
    // Folding them is normalisation; it is NOT fuzzy matching and nothing else is folded.
    const reg = registry();
    expect(reg.airtableNameToAccountId('  new jersey l  backyard paradiso ')).toBe('596293242787360');
    expect(reg.airtableNameToAccountId('New Jersey Backyard Paradiso')).toBeNull();
    expect(reg.airtableNameToAccountId('')).toBeNull();
  });

  it('a registry that could not read the table answers nothing rather than "no names"', () => {
    const reg = buildAccountRegistry(ACCOUNTS, []);
    expect(reg.airtableNameCount).toBe(0);
    expect(reg.airtableNameToAccountId('Washbroz LLC')).toBeNull();
    expect(registry().airtableNameCount).toBe(3);
  });
});
