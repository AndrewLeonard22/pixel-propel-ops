import { describe, it, expect, vi } from 'vitest';
import { findLinkTarget, fetchLinkedNames, resolveLinkedClientNames, resolveRecordId } from './airtableLinks';
import { mapAirtableRecords, UNRESOLVED_CLIENT } from './dataService';

/**
 * RESOLVING LINKED-RECORD IDS TO NAMES.
 *
 * @andrew on the previous banner — which told him to add a Lookup field in Airtable —
 * «this is bs». Correct: it handed the CUSTOMER a chore to work around OUR limitation.
 *
 * ══ 🔴 MEASURED BEFORE CODING, AND IT CORRECTED THE PLAN ══
 * The brief said "if ① is 403, degrade". Measured against the live endpoint:
 *
 *     GET /v0/meta/bases/appFAKE.../tables                    → HTTP 404 {"error":"NOT_FOUND"}
 *     same with a syntactically valid but wrong Bearer        → HTTP 404 {"error":"NOT_FOUND"}
 *
 * ⇒ Airtable does not distinguish "no such base" from "your PAT cannot see it", so a PAT
 *   lacking `schema.bases:read` can surface as 404. Branching on 403 alone would have
 *   missed the exact case the degradation exists for. **Any non-2xx degrades.**
 *
 * ⚠️ EVERY DEGRADATION ARM ASSERTS THE SAME THING: the b50a4d0 invariant is untouched.
 * Unresolved ⇒ UNRESOLVED_CLIENT ⇒ counted as unmatched ⇒ NEVER a record id as a name.
 * Resolution is layered ON TOP of a refusal that already works.
 */
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const err = (status: number) => ({ ok: false, status, json: async () => ({ error: 'NOT_FOUND' }) });

const META = {
  tables: [
    {
      id: 'tblAppts', name: 'Appointments', primaryFieldId: 'fldA',
      fields: [
        { id: 'fldA', name: 'Name', type: 'singleLineText' },
        { id: 'fldL', name: 'Client Name', type: 'multipleRecordLinks', options: { linkedTableId: 'tblClients' } },
      ],
    },
    {
      id: 'tblClients', name: 'Clients', primaryFieldId: 'fldC',
      fields: [{ id: 'fldC', name: 'Client', type: 'singleLineText' }],
    },
  ],
};

describe('① findLinkTarget', () => {
  it('finds the linked table AND the primary field NAME', async () => {
    // The name, not the id: records come back keyed by field NAME while meta identifies the
    // primary field by ID — without the mapping we would have rows and no label column.
    const f = vi.fn().mockResolvedValue(ok(META));
    await expect(findLinkTarget('appX', 'Appointments', 'Client Name', 'patX', f as never))
      .resolves.toEqual({ linkedTableId: 'tblClients', primaryFieldName: 'Client' });
  });

  it('🔴 DEGRADES ON 404 — the MEASURED shape of a PAT without schema access', async () => {
    const f = vi.fn().mockResolvedValue(err(404));
    await expect(findLinkTarget('appX', 'Appointments', 'Client Name', 'patX', f as never)).resolves.toBeNull();
  });

  it('degrades on 403 too — the shape the brief assumed', async () => {
    const f = vi.fn().mockResolvedValue(err(403));
    await expect(findLinkTarget('appX', 'Appointments', 'Client Name', 'patX', f as never)).resolves.toBeNull();
  });

  it('a NON-LINK field is a legitimate answer, not an error', async () => {
    // The column may already be plain text — nothing to resolve and nothing to report.
    const f = vi.fn().mockResolvedValue(ok(META));
    await expect(findLinkTarget('appX', 'Appointments', 'Name', 'patX', f as never)).resolves.toBeNull();
  });

  it('degrades on a malformed body, a missing table, and a thrown fetch', async () => {
    await expect(findLinkTarget('appX', 'Appointments', 'Client Name', 'patX',
      vi.fn().mockResolvedValue(ok({ nope: 1 })) as never)).resolves.toBeNull();
    await expect(findLinkTarget('appX', 'NoSuchTable', 'Client Name', 'patX',
      vi.fn().mockResolvedValue(ok(META)) as never)).resolves.toBeNull();
    await expect(findLinkTarget('appX', 'Appointments', 'Client Name', 'patX',
      vi.fn().mockRejectedValue(new Error('network')) as never)).resolves.toBeNull();
  });

  it('degrades when the linked table has no resolvable primary field name', async () => {
    const broken = { tables: [META.tables[0], { id: 'tblClients', name: 'Clients', primaryFieldId: 'fldMISSING', fields: [] }] };
    await expect(findLinkTarget('appX', 'Appointments', 'Client Name', 'patX',
      vi.fn().mockResolvedValue(ok(broken)) as never)).resolves.toBeNull();
  });

  it('sends no request at all without a base id or a token', async () => {
    const f = vi.fn();
    await expect(findLinkTarget('', 'T', 'F', 'patX', f as never)).resolves.toBeNull();
    await expect(findLinkTarget('appX', 'T', 'F', '', f as never)).resolves.toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});

describe('② fetchLinkedNames', () => {
  it('maps recordId → primary field value', async () => {
    const f = vi.fn().mockResolvedValue(ok({
      records: [{ id: 'rec1234567890abcd', fields: { Client: 'Acme Corp' } }],
    }));
    const names = await fetchLinkedNames('appX', 'tblClients', 'Client', 'patX', f as never);
    expect(names?.get('rec1234567890abcd')).toBe('Acme Corp');
  });

  it('🔴 FOLLOWS THE CURSOR — a partial resolution reads as a complete one', async () => {
    // Airtable caps at 100. Resolving only the first page would leave the rest as record
    // ids while the count implied everything worked — the exact failure this project exists
    // to remove, one layer down.
    const f = vi.fn()
      .mockResolvedValueOnce(ok({ records: [{ id: 'rec1111111111111a', fields: { Client: 'A' } }], offset: 'p2' }))
      .mockResolvedValueOnce(ok({ records: [{ id: 'rec2222222222222b', fields: { Client: 'B' } }] }));
    const names = await fetchLinkedNames('appX', 'tblClients', 'Client', 'patX', f as never);

    expect(names?.size).toBe(2);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('🔑 a BLANK primary value is left UNRESOLVED, not mapped to an empty string', async () => {
    // Mapping it to '' would resolve the id to a falsy value, which reads downstream as
    // "no client" — the same trap that emptied the appointments page.
    const f = vi.fn().mockResolvedValue(ok({
      records: [{ id: 'rec1234567890abcd', fields: { Client: '   ' } }],
    }));
    const names = await fetchLinkedNames('appX', 'tblClients', 'Client', 'patX', f as never);
    expect(names?.has('rec1234567890abcd')).toBe(false);
  });

  it('degrades on non-ok, malformed records, and a throw', async () => {
    for (const impl of [
      vi.fn().mockResolvedValue(err(401)),
      vi.fn().mockResolvedValue(ok({ records: 'nope' })),
      vi.fn().mockRejectedValue(new Error('network')),
    ]) {
      await expect(fetchLinkedNames('appX', 'tblClients', 'Client', 'patX', impl as never)).resolves.toBeNull();
    }
  });

  it('requests ONLY the primary field — a name lookup must not drag whole client rows', async () => {
    const f = vi.fn().mockResolvedValue(ok({ records: [] }));
    await fetchLinkedNames('appX', 'tblClients', 'Client', 'patX', f as never);
    expect(String(f.mock.calls[0][0])).toContain(`fields%5B%5D=${encodeURIComponent('Client')}`);
  });

  it('stops a runaway cursor rather than spinning forever in a browser', async () => {
    const f = vi.fn().mockResolvedValue(ok({ records: [], offset: 'always' }));
    await expect(fetchLinkedNames('appX', 'tblClients', 'Client', 'patX', f as never)).resolves.toBeNull();
    expect(f.mock.calls.length).toBeLessThanOrEqual(101);
  });
});

describe('resolveLinkedClientNames — ①+② with no branch for the caller', () => {
  it('returns names on the happy path', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(ok(META))
      .mockResolvedValueOnce(ok({ records: [{ id: 'rec1234567890abcd', fields: { Client: 'Acme' } }] }));
    const r = await resolveLinkedClientNames('appX', 'Appointments', 'Client Name', 'patX', f as never);
    expect(r.names.get('rec1234567890abcd')).toBe('Acme');
  });

  it('🔴 an EMPTY resolution on every failure — and no request without a token', async () => {
    const f = vi.fn();
    const r = await resolveLinkedClientNames('appX', 'Appointments', 'Client Name', undefined, f as never);
    expect(r.names.size).toBe(0);
    expect(f).not.toHaveBeenCalled();
  });

  it('step ② failing still degrades cleanly after step ① succeeded', async () => {
    const f = vi.fn().mockResolvedValueOnce(ok(META)).mockResolvedValueOnce(err(403));
    const r = await resolveLinkedClientNames('appX', 'Appointments', 'Client Name', 'patX', f as never);
    expect(r.names.size).toBe(0);
    expect(r.linkedTableId).toBe('tblClients');   // diagnostics survive the failure
  });
});

describe('③ THE INVARIANT SURVIVES — resolution never weakens the refusal', () => {
  const RECORDS = [{ fields: { 'Client Name': ['rec1234567890abcd'], 'Appointment Date': '8/4/2026' } }];

  it('🔴 RESOLVED: the id becomes the real NAME and nothing is unresolved', async () => {
    const names = new Map([['rec1234567890abcd', 'Acme Corp']]);
    const { records, unresolvedLinks } = mapAirtableRecords(RECORDS, {}, [], names);

    expect(records[0].client).toBe('Acme Corp');
    expect(records[0].clientUnresolved).toBeFalsy();
    expect(unresolvedLinks).toBe(0);
  });

  it('🔴 UNRESOLVED (empty map): EXACTLY today\'s behaviour, b50a4d0 intact', () => {
    const { records, unresolvedLinks } = mapAirtableRecords(RECORDS, {}, [], new Map());

    expect(records[0].client).toBe(UNRESOLVED_CLIENT);
    expect(records[0].client).not.toMatch(/^rec/);   // NEVER an id as a name
    expect(records[0].clientUnresolved).toBe(true);
    expect(unresolvedLinks).toBe(1);
  });

  it('🔑 A PARTIAL resolution stays HONEST — resolved ones drop out of the count, the rest do not', () => {
    // "if resolution works the unmatched count should drop toward zero, and if it does not,
    // SAY SO rather than letting a partial resolution read as a full one."
    const two = [
      { fields: { 'Client Name': ['rec1234567890abcd'] } },
      { fields: { 'Client Name': ['recZZZZZZZZZZZZZZ'] } },
    ];
    const names = new Map([['rec1234567890abcd', 'Acme']]);
    const { records, unresolvedLinks } = mapAirtableRecords(two, {}, [], names);

    expect(records[0].client).toBe('Acme');
    expect(records[1].client).toBe(UNRESOLVED_CLIENT);
    expect(unresolvedLinks).toBe(1);   // exactly the ones that did NOT resolve
  });

  it('DEFAULT ARGUMENT: an old caller passing no map behaves as before', () => {
    const { records } = mapAirtableRecords(RECORDS, {});
    expect(records[0].client).toBe(UNRESOLVED_CLIENT);
  });
});

describe('resolveRecordId', () => {
  it('resolves a known id, and refuses everything else', () => {
    const names = new Map([['rec1234567890abcd', 'Acme']]);
    expect(resolveRecordId('rec1234567890abcd', names)).toBe('Acme');
    expect(resolveRecordId('recUNKNOWN12345a', names)).toBeNull();
    expect(resolveRecordId('Acme Corp', names)).toBeNull();       // a real name is not an id
    expect(resolveRecordId('Recovery Plumbing', names)).toBeNull();
  });

  it('🔴 THE ID-SHAPE GUARD IS LOAD-BEARING — a non-id key in the map must NOT resolve', () => {
    // My first arm used values ABSENT from the map, so deleting the shape guard changed
    // nothing observable and the sabotage passed. The guard only shows its work when a
    // NON-ID string IS a key: without it, any plain client name colliding with the lookup
    // would be silently rewritten to whatever that key points at.
    const poisoned = new Map([
      ['rec1234567890abcd', 'Acme'],
      ['Acme Corp', 'WRONG — a name is not an id'],
    ]);
    expect(resolveRecordId('Acme Corp', poisoned)).toBeNull();
    expect(resolveRecordId('rec1234567890abcd', poisoned)).toBe('Acme');   // control
  });

  it('🔑 and the guard holds THROUGH the mapper — a plain name is never looked up', () => {
    const poisoned = new Map([['Acme Corp', 'WRONG']]);
    const { records, unresolvedLinks } = mapAirtableRecords(
      [{ fields: { 'Client Name': 'Acme Corp' } }], {}, [], poisoned,
    );
    expect(records[0].client).toBe('Acme Corp');   // untouched, not rewritten
    expect(unresolvedLinks).toBe(0);
  });
});
