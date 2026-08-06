import { describe, it, expect } from 'vitest';
import { isAirtableRecordId, mapAirtableRecords, buildAccountSummaries, UNRESOLVED_CLIENT } from './dataService';
import { makeAdSpendRow, makeSettings } from '@/test/factories';

/**
 * A — AN AIRTABLE RECORD ID MUST NEVER RENDER AS A NAME.
 *
 * @andrew saw `recXXXXXXXXXXXXXX` in the appointments ACCOUNT column. Cause: `Client Name`
 * is a LINKED-RECORD field, so Airtable returns an ARRAY OF RECORD IDS, and getField did
 * `val[0]` — handing the id straight through as the client name.
 *
 * ⭐ AN ID DISPLAYED AS A NAME IS A LABEL THAT IS NOT AN IDENTITY. And it is worse than a
 * blank: the 4-tier matcher treats it as a real client name, Tier 3 caches it, Tier 4
 * fuzzy-matches it, and THE APPOINTMENT GETS ATTRIBUTED TO AN ACCOUNT ON THE STRENGTH OF A
 * RECORD ID. A wrong number wearing a name.
 *
 * ⚠️ THIS IS THE INVARIANT HALF, DELIBERATELY INDEPENDENT OF THE FIX. @bird is pulling the
 * raw payload to decide whether a text field already carries the name (a columnMappings
 * change, no code) or whether the link must be resolved against the linked table. Either
 * way an unresolved id must not render as a name — so that half does not wait on the answer.
 */
describe('isAirtableRecordId', () => {
  it('recognises the documented shape: rec + 14 chars', () => {
    expect(isAirtableRecordId('rec1234567890abcd')).toBe(true);
    expect(isAirtableRecordId('recABCdef123456Z')).toBe(false); // 13 — wrong length
  });

  it('🔑 ANCHORED — a real client called "Recovery Plumbing" is NOT an id', () => {
    // The mirror defect: over-eager detection would blank legitimate client names, and a
    // customer named "Recovery…" is entirely plausible.
    expect(isAirtableRecordId('Recovery Plumbing')).toBe(false);
    expect(isAirtableRecordId('Rec')).toBe(false);
    expect(isAirtableRecordId('prefix rec1234567890abcd')).toBe(false);
    expect(isAirtableRecordId('rec1234567890abcd suffix')).toBe(false);
  });

  it('is not fooled by non-strings', () => {
    expect(isAirtableRecordId(undefined)).toBe(false);
    expect(isAirtableRecordId(['rec1234567890abcd'])).toBe(false);
  });
});

describe('mapAirtableRecords — a linked-record id never becomes a client name', () => {
  const MAPPINGS: Record<string, string> = {};

  it('🔴 THE DEFECT: a linked Client Name array yields UNRESOLVED, not the id', () => {
    const { records, unresolvedLinks } = mapAirtableRecords(
      [{ fields: { 'Client Name': ['rec1234567890abcd'], 'Appointment Date': '8/4/2026' } }],
      MAPPINGS,
    );

    // 🔴 A READABLE SENTINEL, NOT ''. An empty client is FALSY, and every consumer that
    // guards on `a.client` dropped the row — that over-correction EMPTIED THE APPOINTMENTS
    // PAGE in production. The appointment exists; only its ACCOUNT is unknown.
    expect(records[0].client).toBe(UNRESOLVED_CLIENT);
    expect(records[0].client).not.toBe('');
    expect(records[0].clientUnresolved).toBe(true);
    expect(unresolvedLinks).toBe(1);             // counted, not swallowed
  });

  it('🔴 ANTI-VACUITY CONTROL: a real linked NAME still comes through', () => {
    // Linked-record fields can also return the primary field's TEXT. Blanking those would
    // be the mirror defect — refusing every array — and would empty the whole column.
    const { records, unresolvedLinks } = mapAirtableRecords(
      [{ fields: { 'Client Name': ['Acme Corp'], 'Appointment Date': '8/4/2026' } }],
      MAPPINGS,
    );

    expect(records[0].client).toBe('Acme Corp');
    expect(records[0].clientUnresolved).toBe(false);
    expect(unresolvedLinks).toBe(0);
  });

  it('a plain text Client Name is untouched', () => {
    const { records } = mapAirtableRecords([{ fields: { 'Client Name': 'Acme Corp' } }], MAPPINGS);
    expect(records[0].client).toBe('Acme Corp');
  });

  it('counts EVERY unresolved link across records and fields', () => {
    const { unresolvedLinks } = mapAirtableRecords(
      [
        { fields: { 'Client Name': ['rec1234567890abcd'], 'Campaign Name': ['recABCDEFGHIJKLMN'] } },
        { fields: { 'Client Name': ['rec99999999999999'] } },
      ],
      MAPPINGS,
    );
    expect(unresolvedLinks).toBe(3);   // 3, not 6: the counter must not double-count
  });
});

describe('the downstream consequence — an id must not buy an ATTRIBUTION', () => {
  it('🔴 an unresolved appointment goes UNMATCHED rather than fuzzy-matching an account', () => {
    // This is why blanking is the right refusal rather than passing the id through. With
    // the id present, Tier 3 caches it as a client name and Tier 4 scores it against every
    // account — an appointment attributed on the strength of a record id.
    const { records } = mapAirtableRecords(
      [{ fields: { 'Client Name': ['rec1234567890abcd'], 'Appointment Date': '8/4/2026' } }],
      {},
    );

    const { accounts, unmatchedAppointments } = buildAccountSummaries(
      [makeAdSpendRow({ accountName: 'Acme', spent: 500, leads: 20 })],
      records,
      makeSettings(),
      [],
    );

    expect(unmatchedAppointments).toHaveLength(1);
    expect(accounts[0].appointments).toBe(0);
  });

  it('ANTI-VACUITY CONTROL: a resolved name DOES attribute', () => {
    const { records } = mapAirtableRecords(
      [{ fields: { 'Client Name': ['Acme'], 'Appointment Date': '8/4/2026' } }],
      {},
    );

    const { accounts, unmatchedAppointments } = buildAccountSummaries(
      [makeAdSpendRow({ accountName: 'Acme', spent: 500, leads: 20 })],
      records,
      makeSettings(),
      [],
    );

    expect(unmatchedAppointments).toHaveLength(0);
    expect(accounts[0].appointments).toBe(1);
  });
});

/**
 * 🔴 THE ARM THAT WOULD HAVE CAUGHT IT — @fable, after b50a4d0 EMPTIED THE APPOINTMENTS PAGE.
 *
 * 448 tests passed on a change that removed every appointment from the screen. Every arm
 * proved THE RECORD ID DOES NOT RENDER. Not one proved THE APPOINTMENT DOES.
 *
 * ⭐ "AN UNRESOLVED CLIENT IS A FACT ABOUT THE ATTRIBUTION, NOT ABOUT THE APPOINTMENT."
 * I refused to answer "which account" and then stopped answering "does this appointment
 * exist" — the refusal-as-a-value law running BACKWARDS. Refusing to answer is right;
 * deleting the row is not.
 *
 * ⚠️ ANTI-VACUITY AT THE FEATURE LEVEL, not the function level: every arm below asserts
 * something SURVIVES, because the previous set only asserted things were absent and a
 * function returning nothing at all satisfies all of those.
 */
describe('an unresolved appointment SURVIVES — it is counted, listed and dated', () => {
  const raw = [
    { fields: { 'Client Name': ['rec1234567890abcd'], 'Appointment Date': '8/4/2026', 'Show Status': 'Showed' } },
    { fields: { 'Client Name': ['recABCDEFGHIJKLMN'], 'Appointment Date': '8/5/2026', 'Show Status': 'Booked' } },
    { fields: { 'Client Name': ['Acme'], 'Appointment Date': '8/6/2026', 'Show Status': 'Booked' } },
  ];

  it('🔴 ALL THREE appointments exist — none is deleted by being unresolved', () => {
    const { records } = mapAirtableRecords(raw, {});
    expect(records).toHaveLength(3);
  });

  it('🔴 every unresolved row keeps a TRUTHY client — a falsy one is dropped by consumers', () => {
    // AppointmentsCalendar.tsx:94 filters `a.client && selectedClients.has(a.client)`.
    // A blank client is falsy, so the row vanishes from the list, the counts AND the
    // calendar. This is the precise line that emptied the page.
    const { records } = mapAirtableRecords(raw, {});
    for (const r of records) expect(Boolean(r.client)).toBe(true);
  });

  it('🔴 the unresolved rows keep their DATE — the calendar needs it to place them', () => {
    const { records } = mapAirtableRecords(raw, {});
    expect(records.map(r => r.appointmentDate)).toEqual(['8/4/2026', '8/5/2026', '8/6/2026']);
  });

  it('🔴 they keep their SHOW STATUS — the four tiles reduce over it', () => {
    const { records } = mapAirtableRecords(raw, {});
    expect(records.map(r => r.showStatus)).toEqual(['Showed', 'Booked', 'Booked']);
  });

  it('🔑 counted as UNMATCHED, not lost: unmatched + attributed = every appointment', () => {
    // The conservation check. Whatever the attribution decides, no appointment may vanish.
    const { records } = mapAirtableRecords(raw, {});
    const { accounts, unmatchedAppointments } = buildAccountSummaries(
      [makeAdSpendRow({ accountName: 'Acme', spent: 500, leads: 20 })], records, makeSettings(), [],
    );
    const attributed = accounts.reduce((n, a) => n + a.appointments, 0);

    expect(attributed + unmatchedAppointments.length).toBe(3);
    expect(attributed).toBe(1);                  // only the resolved one
    expect(unmatchedAppointments).toHaveLength(2);
  });

  it('🔴 the sentinel must NOT become a pseudo-account — no attribution on a placeholder', () => {
    // If the name tiers ran on '—', all unresolved appointments would collapse onto one
    // fake account, which is worse than the record id it replaced.
    const { records } = mapAirtableRecords(raw, {});
    const { accounts } = buildAccountSummaries(
      [makeAdSpendRow({ accountName: UNRESOLVED_CLIENT, spent: 1, leads: 1 })], records, makeSettings(), [],
    );
    const pseudo = accounts.find(a => a.accountName === UNRESOLVED_CLIENT);
    expect(pseudo?.appointments ?? 0).toBe(0);
  });

  it('⭐ TIER 1 STILL ATTRIBUTES an unresolved appointment — a campaign id is real evidence', () => {
    const withCampaign = mapAirtableRecords(
      [{ fields: { 'Client Name': ['rec1234567890abcd'], 'Campaign ID': '111', 'Appointment Date': '8/4/2026' } }], {},
    );
    const { accounts, unmatchedAppointments } = buildAccountSummaries(
      [makeAdSpendRow({ accountName: 'Acme', campaignId: '111', spent: 500, leads: 20 })],
      withCampaign.records, makeSettings(), [],
    );
    expect(accounts[0].appointments).toBe(1);
    expect(unmatchedAppointments).toHaveLength(0);
  });
});
