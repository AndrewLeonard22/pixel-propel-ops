import { describe, it, expect } from 'vitest';
import { fetchSelectChoices, tickedButMissing } from './airtableChoices';

/**
 * The payload shape is @fable's, read from @andrew's base via the Meta API — not invented.
 * Lead Status is a singleSelect with exactly SEVEN choices.
 */
const SEVEN = [
  'Follow up scheduled', 'Working on proposal', 'Comparing bids',
  'Waiting on decision', 'Waiting on their decision', 'Closed Won', 'Closed Lost',
];

const okBody = {
  tables: [
    { id: 'tblZGLMdPmvshqnxK', name: 'Clients', fields: [{ name: 'Name', type: 'singleLineText' }] },
    {
      id: 'tblVNsX6BmA2lwmOE',
      name: 'Appointments',
      fields: [
        { name: 'Client Name', type: 'multipleRecordLinks', options: { linkedTableId: 'tblZGLMdPmvshqnxK' } },
        { name: 'Lead Status', type: 'singleSelect', options: { choices: SEVEN.map(name => ({ name })) } },
        { name: 'Closed Revenue ($)', type: 'currency' },
      ],
    },
  ],
};

const fetchOf = (status: number, body: unknown): typeof fetch =>
  (async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })) as unknown as typeof fetch;

describe('fetchSelectChoices — his options, live', () => {
  it('✅ returns the seven real choices, in base order', async () => {
    const got = await fetchSelectChoices('appzEAl8r1TkFLiBR', 'Appointments', 'Lead Status', 'tok', fetchOf(200, okBody));
    expect(got).toEqual(SEVEN);
  });

  it('resolves the table by ID as well as by name', async () => {
    const got = await fetchSelectChoices('appzEAl8r1TkFLiBR', 'tblVNsX6BmA2lwmOE', 'Lead Status', 'tok', fetchOf(200, okBody));
    expect(got).toEqual(SEVEN);
  });

  describe('⛔ DEGRADE, NEVER THROW — every failure returns null, none rejects', () => {
    const cases: [string, () => Promise<string[] | null>][] = [
      ['403 — token lacks schema.bases:read', () => fetchSelectChoices('b', 'Appointments', 'Lead Status', 'tok', fetchOf(403, { error: 'NOT_AUTHORIZED' }))],
      ['404 — base does not exist', () => fetchSelectChoices('b', 'Appointments', 'Lead Status', 'tok', fetchOf(404, { error: 'NOT_FOUND' }))],
      ['network throws', () => fetchSelectChoices('b', 'Appointments', 'Lead Status', 'tok', (() => { throw new Error('offline'); }) as unknown as typeof fetch)],
      ['body is not JSON-shaped', () => fetchSelectChoices('b', 'Appointments', 'Lead Status', 'tok', fetchOf(200, 'nope'))],
      ['table missing', () => fetchSelectChoices('b', 'Nope', 'Lead Status', 'tok', fetchOf(200, okBody))],
      ['field renamed', () => fetchSelectChoices('b', 'Appointments', 'Deal Status', 'tok', fetchOf(200, okBody))],
      ['field is not a singleSelect', () => fetchSelectChoices('b', 'Appointments', 'Closed Revenue ($)', 'tok', fetchOf(200, okBody))],
      ['choices empty — a parse miss, not an answer', () => fetchSelectChoices('b', 'Appointments', 'Lead Status', 'tok', fetchOf(200, { tables: [{ name: 'Appointments', fields: [{ name: 'Lead Status', type: 'singleSelect', options: { choices: [] } }] }] }))],
      ['no token', () => fetchSelectChoices('b', 'Appointments', 'Lead Status', '', fetchOf(200, okBody))],
    ];

    for (const [label, run] of cases) {
      it(label, async () => {
        await expect(run()).resolves.toBeNull();
      });
    }
  });
});

describe('⭐ tickedButMissing — the same rot as the column dropdown, surfaced', () => {
  it('names a ticked status Airtable no longer has', () => {
    expect(tickedButMissing(['Closed Won', 'Deal Closed'], SEVEN)).toEqual(['Deal Closed']);
  });

  it('🔴 SILENT WHEN WE COULD NOT REACH THE BASE — absence of choices is not evidence of absence', () => {
    // The alarming-direction error: reporting "all 3 of your statuses are missing" because a
    // fetch failed. A 403 must produce no accusation at all.
    expect(tickedButMissing(['Closed Won', 'Comparing bids'], null)).toEqual([]);
    expect(tickedButMissing(['Closed Won'], [])).toEqual([]);
  });

  it('🔴 ANTI-VACUITY: silent when everything ticked DOES exist', () => {
    // Without this, a function returning [] always would pass the arm above.
    expect(tickedButMissing(['Closed Won', 'Closed Lost'], SEVEN)).toEqual([]);
  });

  it('matches case- and whitespace-insensitively, like the classifier', () => {
    expect(tickedButMissing(['  closed won '], SEVEN)).toEqual([]);
  });
});
