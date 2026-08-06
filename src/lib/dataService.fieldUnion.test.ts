import { describe, it, expect } from 'vitest';
import { mapAirtableRecords } from './dataService';

/**
 * 🔴 D2 — SAMPLING ONE ROW TO LEARN A SCHEMA.
 *
 * @fable queried the live Airtable directly (679 records) and found the Settings
 * column-mapping dropdown showing "— Select —" for a mapping that was CORRECT AND WORKING:
 *
 *     saved:  'Closed Revenue' → 'Closed Revenue ($)'     ← working
 *     shown:  — Select —                                   ← the option did not exist
 *
 * CAUSE, in this file: the field list was `Object.keys(records[0].fields)`. **AIRTABLE
 * OMITS EMPTY FIELDS PER RECORD**, and only 46 of 679 rows carry `Closed Revenue ($)`, so
 * it was absent from the sample row and therefore from the option list.
 *
 * 🔴 THE HAZARD WAS NOT COSMETIC. @andrew was about to pick something — «this is where i
 * should map it» — and ANY choice would have overwritten a working mapping with a blank,
 * taking his revenue to $0.
 *
 * ⭐ THE SHAPE: a sparse column is exactly the one a user needs to map, and exactly the one
 * a single-row sample cannot see. The rarer the field, the more likely it is missing from
 * the sample AND the more likely it is the one that matters.
 */
describe('the Airtable field list is the UNION across records', () => {
  it('🔴 THE DEFECT: a field present on only ONE LATE record is still offered', () => {
    // @fable's live ratio in miniature: the sparse field is on the last row, as it is on
    // 46 of 679. Reading record[0] alone loses it.
    const records = [
      { fields: { 'Client Name': 'A', 'Appointment Date': '8/4/2026' } },
      { fields: { 'Client Name': 'B', 'Appointment Date': '8/5/2026' } },
      { fields: { 'Client Name': 'C', 'Closed Revenue ($)': '1250' } },
    ];
    const { fields } = mapAirtableRecords(records, {});

    expect(fields).toContain('Closed Revenue ($)');
  });

  it('🔴 ANTI-VACUITY CONTROL: the common fields are still there — the union ADDS, never replaces', () => {
    // Without this, a fix that returned only the sparse keys would pass the arm above.
    const records = [
      { fields: { 'Client Name': 'A', 'Appointment Date': '8/4/2026' } },
      { fields: { 'Client Name': 'C', 'Closed Revenue ($)': '1250' } },
    ];
    const { fields } = mapAirtableRecords(records, {});

    expect(fields).toContain('Client Name');
    expect(fields).toContain('Appointment Date');
    expect(fields).toContain('Closed Revenue ($)');
  });

  it('does not duplicate a field that appears on every record', () => {
    const records = [{ fields: { A: '1' } }, { fields: { A: '2' } }, { fields: { A: '3' } }];
    expect(mapAirtableRecords(records, {}).fields).toEqual(['A']);
  });

  it('🔑 an explicitly supplied field list still WINS — the proxy already knows the schema', () => {
    // The proxy sends `fields`; that is authoritative and must not be recomputed from a
    // sample, which would be strictly worse information.
    const records = [{ fields: { A: '1' } }];
    expect(mapAirtableRecords(records, {}, ['FromProxy']).fields).toEqual(['FromProxy']);
  });

  it('survives records with no fields object at all', () => {
    const records = [{ fields: undefined as never }, { fields: { A: '1' } }];
    expect(mapAirtableRecords(records, {}).fields).toEqual(['A']);
  });

  it('empty input yields an empty list rather than throwing', () => {
    expect(mapAirtableRecords([], {}).fields).toEqual([]);
  });

  it('🔴 THE SCALE THAT MADE IT INVISIBLE: 1-in-N sparsity is still found', () => {
    // 679 records, one carrying the field — @fable's real ratio is 46/679, and a single
    // sparse row is the strictly harder case.
    const records = Array.from({ length: 679 }, (_, i) =>
      i === 678
        ? { fields: { 'Client Name': 'X', 'Closed Revenue ($)': '99' } }
        : { fields: { 'Client Name': 'X' } },
    );
    expect(mapAirtableRecords(records, {}).fields).toContain('Closed Revenue ($)');
  });
});
