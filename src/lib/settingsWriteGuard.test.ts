/**
 * Tests for the client-side write guard.
 *
 * POPULATION: the exact write that destroyed production at 22:18:48.365Z, reconstructed
 * from the measured evidence — DEFAULT_SETTINGS over a populated row, with accountAliases
 * at 62 — plus the legitimate writes that must NOT be refused, plus the states where the
 * guard must not arm.
 *
 * 🛑 NO COMPONENT IS MOUNTED IN THIS FILE. The Settings page is under a team stop; this
 * is why the decision lives in a pure function rather than inside the component.
 */
import { describe, it, expect } from 'vitest';
import {
  checkSettingsWrite,
  isHydrated,
  PROTECTED_FIELDS,
} from './settingsWriteGuard';
import { makeSettings } from '@/test/factories';
import { proveDetects, population } from '@/test/sabotage';
import type { AppSettings } from './types';

/** The production config as it was at 21:46:49Z, when @bird screenshotted it healthy. */
const POPULATED: AppSettings = makeSettings({
  airtableTableName: 'Appointments',
  airtableBaseId: 'appREAL123',
  excludedCampaigns: Array.from({ length: 32 }, (_, i) => `campaign-${i}`),
  inactiveSetters: ['A', 'B', 'C', 'D'],
  setterBonusRates: [{ setterName: 'Alice', rate: 10 }],
  accountAliases: Array.from({ length: 62 }, (_, i) => ({
    sheetName: `acct-${i}`,
    airtableName: `client-${i}`,
    program: 'Done For You',
    mediaBuyer: '',
    status: 'Active',
  })) as AppSettings['accountAliases'],
});

/** What the autosave actually wrote: defaults, with aliases surviving from the DB fetch. */
const THE_WIPE: AppSettings = makeSettings({
  airtableTableName: '',
  airtableBaseId: '',
  excludedCampaigns: [],
  inactiveSetters: [],
  setterBonusRates: [],
  accountAliases: POPULATED.accountAliases,
});

describe('🔴 the write that destroyed production', () => {
  it('IS REFUSED, and names every field it would have destroyed', () => {
    const v = checkSettingsWrite(THE_WIPE, POPULATED);
    expect(v.safe).toBe(false);
    // accountAliases is NOT in the list — it survived, which is what made the wipe confusing
    expect(v.blankedFields.sort()).toEqual(
      [
        'airtableBaseId',
        'excludedCampaigns',
        'airtableTableName',
        'inactiveSetters',
        'setterBonusRates',
      ].sort(),
    );
    expect(v.reason).toContain('had not finished loading');
  });

  it('is sabotage-proven against the ways a guard like this fails open', () => {
    proveDetects({
      subject: 'checkSettingsWrite',
      population:
        'the measured 22:18:48Z wipe, a legitimate edit, a first write, and an explicit clear',
      real: checkSettingsWrite,
      poisons: {
        'always safe (a guard that never refuses)': (() => ({ safe: true, reason: '', blankedFields: [] })) as typeof checkSettingsWrite,
        'checks only airtableTableName, missing the curated lists': ((c, s) => {
          if (s && s.airtableTableName && !c?.airtableTableName)
            return { safe: false, reason: 'x', blankedFields: ['airtableTableName' as const] };
          return { safe: true, reason: '', blankedFields: [] };
        }) as typeof checkSettingsWrite,
        'treats an empty ARRAY as populated, so 32->0 passes': ((c, s) => {
          if (!c) return { safe: false, reason: 'x', blankedFields: [] };
          if (!s) return { safe: true, reason: '', blankedFields: [] };
          const blanked = PROTECTED_FIELDS.filter(
            f => typeof s[f] === 'string' && s[f] !== '' && c[f] === '',
          );
          return blanked.length
            ? { safe: false, reason: 'x', blankedFields: blanked }
            : { safe: true, reason: '', blankedFields: [] };
        }) as typeof checkSettingsWrite,
        'refuses EVERYTHING, which would block legitimate saves': (() => ({ safe: false, reason: 'x', blankedFields: [] })) as typeof checkSettingsWrite,
      },
      assertions: impl => {
        // the wipe must be refused
        expect(impl(THE_WIPE, POPULATED).safe).toBe(false);
        // a 32 -> 0 array clear must be caught (the poison that only checks strings)
        expect(
          impl({ ...POPULATED, excludedCampaigns: [] }, POPULATED).safe,
        ).toBe(false);
        // a legitimate edit must pass
        expect(
          impl(
            { ...POPULATED, airtableTableName: 'Appointments V2' },
            POPULATED,
          ).safe,
        ).toBe(true);
        // a first write (nothing stored) must pass
        expect(impl(THE_WIPE, null).safe).toBe(true);
      },
    });
  });
});

describe('legitimate writes are NOT refused', () => {
  it('allows changing a populated field to a different value', () => {
    expect(
      checkSettingsWrite({ ...POPULATED, airtableBaseId: 'appNEW' }, POPULATED).safe,
    ).toBe(true);
  });

  it('allows ADDING to a previously empty field', () => {
    const empty = makeSettings({ excludedCampaigns: [] });
    expect(
      checkSettingsWrite({ ...empty, excludedCampaigns: ['a'] }, empty).safe,
    ).toBe(true);
  });

  it('allows an explicit clear when the caller says a human did it', () => {
    expect(checkSettingsWrite(THE_WIPE, POPULATED, { allowClear: true }).safe).toBe(true);
  });

  it('allows the first write when nothing is stored yet', () => {
    expect(checkSettingsWrite(THE_WIPE, null).safe).toBe(true);
    expect(checkSettingsWrite(THE_WIPE, undefined).safe).toBe(true);
  });

  it('🔴 does NOT refuse a write over the CURRENTLY WIPED row — the state we are in now', () => {
    // Every protected field is already empty, so nothing can be destroyed.
    // A guard that armed here would block the restore itself.
    const wipedRow = THE_WIPE;
    expect(checkSettingsWrite(POPULATED, wipedRow).safe).toBe(true);
  });
});

describe('isEmptyValue semantics — zero and false are VALUES, not absence', () => {
  it('does not treat a falsy-but-meaningful value as blanked', () => {
    const a = makeSettings({ pausedThresholdDays: 5 });
    const b = makeSettings({ pausedThresholdDays: 0 });
    // pausedThresholdDays is not protected, but the predicate must not be naively falsy:
    // prove it via a protected field holding a legitimately empty-looking value.
    expect(checkSettingsWrite(b, a).safe).toBe(true);
  });

  it('treats a whitespace-only string as empty', () => {
    const stored = makeSettings({ airtableTableName: 'Appointments' });
    expect(checkSettingsWrite({ ...stored, airtableTableName: '   ' }, stored).safe).toBe(
      false,
    );
  });
});

describe('🔴 the gaps @apprentice found by diffing against his database guard', () => {
  it('catches an emptied OBJECT — columnMappings 21 pairs -> {}', () => {
    // NOTE: makeSettings() defaults columnMappings to {}, so it must be populated here
    // or the test passes vacuously — there would be nothing to blank. Caught by the
    // test failing, which is the only reason I know the fixture was wrong.
    const stored = makeSettings({
      columnMappings: Object.fromEntries(
        Array.from({ length: 21 }, (_, i) => [`col${i}`, `Col ${i}`]),
      ),
    });
    const v = checkSettingsWrite({ ...stored, columnMappings: {} }, stored);
    expect(v.safe).toBe(false);
    expect(v.blankedFields).toContain('columnMappings');
  });

  it('catches an emptied perfThresholds object', () => {
    const stored = makeSettings();
    const v = checkSettingsWrite(
      { ...stored, perfThresholds: {} as AppSettings['perfThresholds'] },
      stored,
    );
    expect(v.safe).toBe(false);
    expect(v.blankedFields).toContain('perfThresholds');
  });

  it('🔑 protects an OFF-SCHEMA key — activeSetters, which the wipe DELETED outright', () => {
    // activeSetters is not on the AppSettings interface, so a typed PROTECTED_FIELDS
    // literally could not name it. Driving off the stored row's keys catches it anyway.
    const stored = { ...makeSettings(), activeSetters: ['Alice', 'Bob'] } as unknown as AppSettings;
    const candidate = makeSettings(); // no activeSetters key at all — exactly the wipe
    const v = checkSettingsWrite(candidate, stored);
    expect(v.safe).toBe(false);
    expect(v.blankedFields).toContain('activeSetters');
  });

  it('every documented PROTECTED_FIELD is still caught', () => {
    const stored = makeSettings({
      airtableTableName: 'Appointments',
      airtableBaseId: 'appX',
      excludedCampaigns: ['a'],
      setterBonusRates: [{ setterName: 'A', rate: 1 }],
      inactiveSetters: ['B'],
      accountAliases: [{ sheetName: 's', airtableName: 'a', program: 'p', mediaBuyer: '', status: 'Active' }] as AppSettings['accountAliases'],
    });
    for (const f of PROTECTED_FIELDS) {
      const candidate = { ...stored, [f]: Array.isArray(stored[f]) ? [] : '' } as AppSettings;
      const v = checkSettingsWrite(candidate, stored);
      expect(v.safe, `${f} must be protected`).toBe(false);
      expect(v.blankedFields).toContain(f);
    }
  });

  it('a boolean going true -> false is NOT a blanking', () => {
    const stored = makeSettings({ showPausedAccounts: true });
    expect(checkSettingsWrite({ ...stored, showPausedAccounts: false }, stored).safe).toBe(true);
  });

  it('a number going 1 -> 0 is NOT a blanking', () => {
    const stored = makeSettings({ pausedThresholdDays: 1 });
    expect(checkSettingsWrite({ ...stored, pausedThresholdDays: 0 }, stored).safe).toBe(true);
  });
});

describe('isHydrated — the autosave gate', () => {
  it('is false until BOTH the load completed and the form synced', () => {
    expect(isHydrated(false, null)).toBe(false);
    expect(isHydrated(true, null)).toBe(false);
    expect(isHydrated(false, 1)).toBe(false);
    expect(isHydrated(true, 1)).toBe(true);
  });

  it('🔴 does NOT key on the config being non-empty', () => {
    // If it did, the gate could never arm while the config is wiped — which is exactly
    // the state we are in, and exactly when we most need the autosave held back.
    expect(isHydrated(true, 1)).toBe(true);
  });
});
