/**
 * Tests for account identity. Item ④.
 *
 * POPULATION: the exact collisions measured on the live derived tab — 2 trailing-space
 * twin pairs (Co-Lights, Trimlight Phoenix) and 4 Meta-id values — plus the negative
 * cases that must NOT merge. Real values, real row counts, real spend.
 */
import { describe, it, expect } from 'vitest';
import {
  accountKey,
  isIdShapedAccount,
  resolveAccountIdentities, detectRenameSuspects, type AccountSpan, type RenameSuspect, } from './accounts';
import { proveDetects, population } from '@/test/sabotage';

/** The four id-shaped values in the live feed, verbatim. */
const LIVE_IDS = [
  '10170221, USD',
  '103578393327348, USD',
  '222178771, USD',
  '391432983081972, USD',
];

describe('accountKey', () => {
  it(`is sabotage-proven ${population('trailing space, case, internal runs, and pairs that must NOT merge')}`, () => {
    proveDetects({
      subject: 'accountKey',
      population:
        'the 2 live twin pairs, case variants, internal whitespace runs, and distinct-but-similar names',
      real: accountKey,
      poisons: {
        'THE LIVE BUG: raw string, no normalisation at all': ((s: string) =>
          String(s ?? '')) as typeof accountKey,
        'trims but does not case-fold': ((s: string) =>
          String(s ?? '').trim()) as typeof accountKey,
        'case-folds but does not trim': ((s: string) =>
          String(s ?? '').toLowerCase()) as typeof accountKey,
        'over-merges by stripping punctuation — would fuse two real advertisers': ((
          s: string,
        ) =>
          String(s ?? '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '')) as typeof accountKey,
      },
      assertions: impl => {
        // the live twins MUST collapse
        expect(impl('Co-Lights ')).toBe(impl('Co-Lights'));
        expect(impl('Trimlight Phoenix ')).toBe(impl('Trimlight Phoenix'));
        // case must collapse
        expect(impl('CO-LIGHTS')).toBe(impl('co-lights'));
        // internal whitespace runs must collapse
        expect(impl('Turf  Pros   Solution')).toBe(impl('Turf Pros Solution'));
        // 🔴 and these must NOT merge — punctuation is meaning, not formatting
        expect(impl('Co-Lights')).not.toBe(impl('Co Lights'));
      },
    });
  });
});

describe('isIdShapedAccount', () => {
  it('flags all four live Meta-id values', () => {
    for (const v of LIVE_IDS) expect(isIdShapedAccount(v)).toBe(true);
  });

  it('does not flag real account names, including ones containing digits', () => {
    for (const v of [
      'Co-Lights',
      'Trimlight Phoenix',
      'ApexCleaningC0',
      'Publicity 1',
      'PSDC',
      '',
    ]) {
      expect(isIdShapedAccount(v)).toBe(false);
    }
  });
});

describe('🔴 resolveAccountIdentities — the money-splitting case', () => {
  it('merges the Co-Lights twins into ONE account and keeps both variants visible', () => {
    // real row counts: 'Co-Lights' 104, 'Co-Lights ' 57
    const rows = [
      ...Array(104).fill('Co-Lights'),
      ...Array(57).fill('Co-Lights '),
    ];
    const ids = resolveAccountIdentities(rows);
    expect(ids.size).toBe(1); // was 2 accounts on the dashboard
    const co = ids.get('co-lights')!;
    expect(co.wasSplit).toBe(true);
    expect(co.variants).toHaveLength(2);
    expect(co.display).toBe('Co-Lights'); // the trimmed, more frequent spelling
  });

  it('merges Trimlight Phoenix even though the UNTRIMMED spelling is more common', () => {
    // real row counts: 'Trimlight Phoenix' 66, 'Trimlight Phoenix ' 128 <- untrimmed wins on count
    const rows = [
      ...Array(66).fill('Trimlight Phoenix'),
      ...Array(128).fill('Trimlight Phoenix '),
    ];
    const ids = resolveAccountIdentities(rows);
    expect(ids.size).toBe(1);
    const t = ids.get('trimlight phoenix')!;
    expect(t.wasSplit).toBe(true);
    // display is trimmed regardless of which raw spelling won
    expect(t.display).toBe('Trimlight Phoenix');
  });

  it('marks id-shaped accounts as needing a human mapping, and does NOT invent a name', () => {
    const ids = resolveAccountIdentities(LIVE_IDS);
    expect(ids.size).toBe(4);
    for (const id of ids.values()) {
      expect(id.needsMapping).toBe(true);
      expect(id.wasSplit).toBe(false);
      // the raw value is preserved — nothing guesses at the advertiser
      expect(id.display).toMatch(/^\d{6,}, USD$/);
    }
  });

  it('leaves genuinely distinct accounts distinct', () => {
    const ids = resolveAccountIdentities([
      'Co-Lights',
      'Co Lights',
      'Light Kings Holiday Lighting',
    ]);
    expect(ids.size).toBe(3);
    expect([...ids.values()].every(i => !i.wasSplit)).toBe(true);
  });

  it('ignores empty and whitespace-only names rather than creating a blank account', () => {
    const ids = resolveAccountIdentities(['', '   ', null, undefined, 'Real Account']);
    expect(ids.size).toBe(1);
    expect(ids.get('real account')!.display).toBe('Real Account');
  });

  it('display selection is deterministic, not row-order dependent', () => {
    const a = resolveAccountIdentities(['Co-Lights ', 'Co-Lights']);
    const b = resolveAccountIdentities(['Co-Lights', 'Co-Lights ']);
    expect(a.get('co-lights')!.display).toBe(b.get('co-lights')!.display);
  });
});

describe('🔴 detectRenameSuspects — one account split in two by a rename', () => {
  // @fable's MEASURED live case: 3 shared campaign ids, spans abutting with zero overlap.
  const publicity: AccountSpan = {
    name: 'Publicity 1', campaignIds: ['c1', 'c2', 'c3', 'c9'],
    firstDay: '2026-05-01', lastDay: '2026-06-14',
  };
  const washbroz: AccountSpan = {
    name: 'Washbroz X SocialWorks', campaignIds: ['c1', 'c2', 'c3', 'c7'],
    firstDay: '2026-06-15', lastDay: '2026-08-05',
  };

  it('is sabotage-proven against the ways this detector fails', () => {
    proveDetects({
      subject: 'detectRenameSuspects',
      population:
        "@fable's measured rename, a genuine hand-off that OVERLAPS, two unrelated accounts, a same-account whitespace twin, and a campaign that moved with a long gap",
      real: detectRenameSuspects,
      poisons: {
        'ignores the date spans — every shared id becomes a rename': ((spans) => {
          const out: RenameSuspect[] = [];
          for (const a of spans) for (const b of spans) {
            if (a === b) continue;
            const shared = a.campaignIds.filter(i => b.campaignIds.includes(i));
            if (shared.length) out.push({ before: a.name, after: b.name, sharedCampaignIds: shared, gapDays: 0 });
          }
          return out;
        }) as typeof detectRenameSuspects,
        'ignores the shared ids — every abutting pair becomes a rename': ((spans) => {
          const out: RenameSuspect[] = [];
          for (const a of spans) for (const b of spans) {
            if (a === b) continue;
            if (a.lastDay < b.firstDay) out.push({ before: a.name, after: b.name, sharedCampaignIds: [], gapDays: 0 });
          }
          return out;
        }) as typeof detectRenameSuspects,
        'finds nothing, ever': (() => []) as typeof detectRenameSuspects,
        'accepts an OVERLAP as a rename (uses <= instead of <)': ((spans) => {
          const out: RenameSuspect[] = [];
          for (const a of spans) for (const b of spans) {
            if (a === b) continue;
            if (a.lastDay <= b.lastDay) {
              const shared = a.campaignIds.filter(i => b.campaignIds.includes(i));
              if (shared.length) out.push({ before: a.name, after: b.name, sharedCampaignIds: shared, gapDays: 0 });
            }
          }
          return out;
        }) as typeof detectRenameSuspects,
      },
      assertions: impl => {
        // ① THE REAL CASE: shared ids + abutting spans ⇒ exactly one suspect, correctly ordered
        const hit = impl([publicity, washbroz]);
        expect(hit).toHaveLength(1);
        expect(hit[0].before).toBe('Publicity 1');
        expect(hit[0].after).toBe('Washbroz X SocialWorks');
        expect(hit[0].sharedCampaignIds).toEqual(['c1', 'c2', 'c3']);

        // ② A GENUINE HAND-OFF THAT OVERLAPS is NOT a rename — the campaign moved while
        //    both accounts were live. This is @fable's "16 of 190 ids under two names".
        expect(impl([
          { ...publicity, lastDay: '2026-07-01' },
          { ...washbroz, firstDay: '2026-06-15' },
        ])).toHaveLength(0);

        // ③ TWO UNRELATED ACCOUNTS that merely abut share nothing ⇒ silent
        expect(impl([
          { name: 'A', campaignIds: ['x'], firstDay: '2026-05-01', lastDay: '2026-06-14' },
          { name: 'B', campaignIds: ['y'], firstDay: '2026-06-15', lastDay: '2026-08-05' },
        ])).toHaveLength(0);

        // ④ A LONG GAP is a campaign reused months later, not a rename
        expect(impl([
          publicity,
          { ...washbroz, firstDay: '2026-09-01' },
        ])).toHaveLength(0);
      },
    });
  });

  it('🔴 a whitespace TWIN is not a rename — that is the other defect and it must not be reported here', () => {
    expect(detectRenameSuspects([
      { name: 'Acme  Corp', campaignIds: ['c1'], firstDay: '2026-05-01', lastDay: '2026-06-14' },
      { name: 'Acme Corp', campaignIds: ['c1'], firstDay: '2026-06-15', lastDay: '2026-08-05' },
    ])).toHaveLength(0);
  });

  it('REPORTS, never merges — the output names both sides and decides nothing', () => {
    const s = detectRenameSuspects([publicity, washbroz])[0];
    expect(Object.keys(s).sort()).toEqual(['after', 'before', 'gapDays', 'sharedCampaignIds']);
    expect(s.gapDays).toBe(1);
  });
});
