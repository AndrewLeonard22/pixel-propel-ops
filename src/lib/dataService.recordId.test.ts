import { describe, it, expect } from 'vitest';
import { isAirtableRecordId, mapAirtableRecords, buildAccountSummaries } from './dataService';
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

    expect(records[0].client).toBe('');          // NOT 'rec1234567890abcd'
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
    expect(unresolvedLinks).toBe(3);
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
