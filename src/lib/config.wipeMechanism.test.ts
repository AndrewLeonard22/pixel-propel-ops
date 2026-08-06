/**
 * ⚠️ RENAMED IN THE MERGE, CONTENT UNTOUCHED. @raccoon and I independently created
 * `config.clobber.test.ts` — an add/add conflict — because we tested the same incident
 * from opposite ends. Rather than fold two files together under a merge deadline, both
 * survive whole:
 *
 *   config.clobber.test.ts       (anvil)    tests the GUARD — does saveSettings REFUSE?
 *   config.wipeMechanism.test.ts (raccoon)  tests the MECHANISM — how the wipe happens
 *
 * ⭐ His is the one that documents WHY the guard exists, and it is still live evidence:
 * these tests pass because the mocked DB returns no current row, which is exactly the
 * case my guard cannot judge and therefore allows. So this file describes a path the
 * guard narrows but does not close.
 */
/**
 * 🔴 THE CONFIG-WIPE MECHANISM, PROVEN.
 *
 * This explains how `excludedCampaigns` went 32 -> 0 without anyone editing Settings,
 * and it is still live: it will happen again the next time anyone clicks the wrong
 * control on a fresh browser.
 *
 * ═══ THE CHAIN ═══
 *   ① useData.tsx:41   settings starts as loadSettings() — a SYNCHRONOUS localStorage
 *                      read. On a parse error or an empty store it is DEFAULT_SETTINGS.
 *   ② useData.tsx:90   loadSettingsAsync() replaces it with the DB row LATER, in a
 *                      useEffect. There is a window where component state holds the
 *                      localStorage snapshot and the DB holds the real config.
 *   ③ config.ts:171    saveSettings() is a FULL-OBJECT REPLACE of the shared row,
 *                      not a merge of changed fields.
 *   ④ Dashboard:481    handleAssign spreads that possibly-stale `settings` and saves.
 *      Dashboard:674   handleToggleExclude does the same to toggle ONE campaign.
 *
 * ⇒ ONE CLICK IN THAT WINDOW OVERWRITES THE PRODUCTION CONFIG WITH WHATEVER THE BROWSER
 *   HAPPENED TO HAVE. Every field the browser lacked is destroyed. No error, no warning,
 *   and the writer believes they toggled one campaign.
 *
 * POPULATION: the two save paths reachable from the Dashboard (assign, toggle-exclude),
 * against the three states component `settings` can hold before the async load lands.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSettings } from '@/test/factories';
import type { AppSettings } from './types';

/** Captures what actually reaches the database. */
const upserts: { key: string; value: Record<string, unknown> }[] = [];

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      upsert: (row: { key: string; value: Record<string, unknown> }) => {
        upserts.push({ key: row.key, value: row.value });
        return Promise.resolve({ error: null });
      },
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
      }),
    }),
  },
}));

beforeEach(() => {
  upserts.length = 0;
  localStorage.clear();
});

describe('🔴 saveSettings is a FULL REPLACE, not a merge', () => {
  it('writes every field it was handed — so a stale caller destroys what it never had', async () => {
    const { saveSettings } = await import('./config');

    // The DB row (conceptually) holds a fully-populated config, including 32 exclusions.
    // The CALLER holds a stale copy with none of them.
    const stale = makeSettings({ excludedCampaigns: [], accountAliases: [] });
    await saveSettings(stale);

    expect(upserts).toHaveLength(1);
    const written = upserts[0].value;
    // The write carries the caller's empty arrays. Nothing merges the DB's 32 back in.
    expect(written.excludedCampaigns).toEqual([]);
    expect(written.accountAliases).toEqual([]);
    // 🔴 THE PROOF: the payload is the WHOLE object, so absence in the caller is
    // indistinguishable from a deliberate clear.
    expect(Object.keys(written).length).toBeGreaterThan(5);
  });

  it('a partial update of ONE field still rewrites ALL of them', async () => {
    const { saveSettings } = await import('./config');
    const full = makeSettings({
      excludedCampaigns: ['a', 'b', 'c'],
      inactiveSetters: ['Bob'],
    });

    // Simulate handleToggleExclude: change ONE field, save the WHOLE object.
    const afterToggle: AppSettings = { ...full, excludedCampaigns: ['a', 'b'] };
    await saveSettings(afterToggle);

    const written = upserts[0].value;
    expect(written.excludedCampaigns).toEqual(['a', 'b']);
    // every unrelated field rode along on a single-campaign toggle
    expect(written.inactiveSetters).toEqual(['Bob']);
    expect(written).toHaveProperty('perfThresholds');
    expect(written).toHaveProperty('columnMappings');
  });
});

describe('🔴 the stale source: loadSettings() is synchronous localStorage', () => {
  it('returns DEFAULTS when localStorage is empty — the state a fresh browser starts in', async () => {
    const { loadSettings } = await import('./config');
    const s = loadSettings();
    expect(s.excludedCampaigns).toEqual([]);
    expect(s.googleSheetUrl).toBe('');
  });

  it('returns DEFAULTS when localStorage is CORRUPT, silently', async () => {
    localStorage.setItem('socialworks_settings', '{not valid json');
    const { loadSettings } = await import('./config');
    const s = loadSettings();
    // the catch swallows the parse error and hands back defaults
    expect(s.excludedCampaigns).toEqual([]);
    expect(s.perfThresholds.goodCpl).toBe(25);
  });
});

describe('🔴 COMPOSED: the wipe, end to end', () => {
  it('a click before the async load lands writes DEFAULTS over a populated row', async () => {
    const { loadSettings, saveSettings } = await import('./config');

    // ① fresh browser, nothing cached -> component state is DEFAULTS
    const atMount = loadSettings();
    expect(atMount.excludedCampaigns).toEqual([]);

    // ② user clicks "exclude campaign" BEFORE loadSettingsAsync resolves.
    //    handleToggleExclude spreads the mounted (default) settings.
    const afterClick: AppSettings = {
      ...atMount,
      excludedCampaigns: ['the-one-they-clicked'],
    };
    await saveSettings(afterClick);

    // ③ what landed in the shared production row:
    const written = upserts[0].value as unknown as AppSettings;
    expect(written.excludedCampaigns).toEqual(['the-one-they-clicked']);
    // 🔴 the 32 exclusions that were in the DB are GONE, and so is everything else
    //    the browser never loaded. This is the outage, reproduced.
    expect(written.googleSheetUrl).toBe('');
    expect(written.accountAliases).toEqual([]);
    expect(written.setterBonusRates).toEqual([]);
  });

  it('CONTROL: the same click AFTER the DB load carries the real config through', async () => {
    const { saveSettings } = await import('./config');

    // loadSettingsAsync has landed: component state is the real row
    const loaded = makeSettings({
      excludedCampaigns: Array.from({ length: 32 }, (_, i) => `c${i}`),
      setterBonusRates: [{ setterName: 'Alice', rate: 10 }],
    });
    const afterClick: AppSettings = {
      ...loaded,
      excludedCampaigns: [...loaded.excludedCampaigns, 'c32'],
    };
    await saveSettings(afterClick);

    const written = upserts[0].value as unknown as AppSettings;
    expect(written.excludedCampaigns).toHaveLength(33); // nothing lost
    expect(written.setterBonusRates).toHaveLength(1);
    // ⇒ the defect is a RACE, not a broken write. That is why it is intermittent,
    //   and why it looks like "someone wiped the config".
  });
});
