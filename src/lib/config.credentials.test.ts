/**
 * Tests for order item ② — CREDENTIALS OUT OF app_settings.
 *
 * WHAT WENT WRONG, so the next reader knows what these guard:
 * `airtableToken` and `anthropicApiKey` were fields on AppSettings, and AppSettings is
 * persisted to the `app_settings` table. That table had RLS enabled and then four
 * policies granting anon SELECT/INSERT/UPDATE/DELETE with USING (true). The Supabase
 * publishable key ships in the browser bundle and the repo is public, so "anon" is the
 * open internet. A live Airtable PAT and a live Anthropic key were readable by anyone,
 * with no credential and no app access required — verified live, both authenticating.
 *
 * POPULATION: every key in CREDENTIAL_KEYS (2), across every sink that persists settings
 * (localStorage via saveSettingsToLocal, the DB via saveSettings) and every source that
 * adopts them (localStorage on load, the DB row on load). Enumerated from the exported
 * constant rather than hardcoded, so adding a credential without adding it to the strip
 * list fails HERE rather than in production.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripCredentials, CREDENTIAL_KEYS } from './config';
import { proveDetects, population } from '@/test/sabotage';

/** A settings-shaped object carrying both credentials, as a legacy row/localStorage would. */
const withCredentials = () => ({
  googleSheetUrl: 'https://docs.google.com/spreadsheets/d/X/edit',
  airtableBaseId: 'appTEST123',
  airtableToken: 'pat_PLACEHOLDER_NOT_A_REAL_TOKEN',
  anthropicApiKey: 'sk-ant-PLACEHOLDER_NOT_A_REAL_KEY',
  excludedCampaigns: ['c1', 'c2'],
  pausedThresholdDays: 1,
});

describe('stripCredentials — a credential can never be persisted', () => {
  it(`is sabotage-proven ${population('both CREDENTIAL_KEYS, present / absent / empty-string')}`, () => {
    proveDetects({
      subject: 'stripCredentials',
      population:
        'both keys in CREDENTIAL_KEYS, in each of: present-with-value, present-but-empty, absent',
      real: stripCredentials as (o: Record<string, unknown>) => Record<string, unknown>,
      poisons: {
        // The single most likely real-world mistake: fix the one that was in the news.
        'strips airtableToken only': (o => {
          const c = { ...o };
          delete c.airtableToken;
          return c;
        }) as (o: Record<string, unknown>) => Record<string, unknown>,
        'strips anthropicApiKey only': (o => {
          const c = { ...o };
          delete c.anthropicApiKey;
          return c;
        }) as (o: Record<string, unknown>) => Record<string, unknown>,
        // Looks right, and leaves the KEY present with an empty value — which still
        // writes the key to the row and trips the DB trigger.
        'blanks the values instead of removing the keys': (o => {
          const c = { ...o };
          for (const k of CREDENTIAL_KEYS) if (k in c) c[k] = '';
          return c;
        }) as (o: Record<string, unknown>) => Record<string, unknown>,
        // The classic: only acts when the value is truthy, so an empty-string
        // credential key survives and is persisted.
        'only strips keys that have a truthy value': (o => {
          const c = { ...o };
          for (const k of CREDENTIAL_KEYS) if (c[k]) delete c[k];
          return c;
        }) as (o: Record<string, unknown>) => Record<string, unknown>,
        'does nothing': (o => o) as (o: Record<string, unknown>) => Record<string, unknown>,
      },
      assertions: impl => {
        // ① both keys are ABSENT — `in`, not falsy. A present key with an empty value
        //    is still a key, still written, still rejected by the DB trigger.
        const cleaned = impl(withCredentials());
        for (const key of CREDENTIAL_KEYS) {
          expect(key in cleaned, `${key} must not survive`).toBe(false);
        }

        // ② a key present with an EMPTY STRING is removed too, not merely left blank.
        const emptied = impl({ ...withCredentials(), airtableToken: '', anthropicApiKey: '' });
        for (const key of CREDENTIAL_KEYS) {
          expect(key in emptied, `${key} must not survive even when empty`).toBe(false);
        }

        // ③ non-credential configuration is untouched — the strip must not be a wipe.
        expect(cleaned.googleSheetUrl).toBe('https://docs.google.com/spreadsheets/d/X/edit');
        expect(cleaned.airtableBaseId).toBe('appTEST123');
        expect(cleaned.excludedCampaigns).toEqual(['c1', 'c2']);
      },
    });
  });

  it('does not mutate its input — a caller holding the original must not be silently altered', () => {
    const original = withCredentials();
    stripCredentials(original);
    expect('airtableToken' in original).toBe(true);
  });

  it('is idempotent and safe on an object that never had credentials', () => {
    const plain = { googleSheetUrl: 'x', airtableBaseId: 'y' };
    expect(stripCredentials(plain)).toEqual(plain);
    expect(stripCredentials(stripCredentials(withCredentials()))).toEqual(
      stripCredentials(withCredentials()),
    );
  });

  it('CREDENTIAL_KEYS is non-empty — an empty strip list would make every assertion vacuous', () => {
    expect(CREDENTIAL_KEYS.length).toBeGreaterThan(0);
  });
});

describe('the app_settings lockdown migration', () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      'supabase/migrations/20260806000000_lock_down_app_settings.sql',
    ),
    'utf8',
  );

  it('drops all four of the original USING (true) policies by name', () => {
    for (const name of [
      'Allow public read',
      'Allow public insert',
      'Allow public update',
      'Allow public delete',
    ]) {
      expect(sql, `must drop policy "${name}"`).toContain(`DROP POLICY IF EXISTS "${name}"`);
    }
  });

  it('grants no DELETE policy — a visitor must not be able to destroy the config', () => {
    // The 2026-08-05 wipe destroyed 32 excluded-campaign ids that had no other copy.
    expect(sql).not.toMatch(/CREATE POLICY[^;]*FOR DELETE/i);
  });

  it('strips both credential keys from the stored row', () => {
    for (const key of CREDENTIAL_KEYS) {
      expect(sql, `migration must remove ${key} from the row`).toContain(`- '${key}'`);
    }
  });

  it('installs a trigger that rejects a credential on INSERT *and* UPDATE', () => {
    expect(sql).toContain('BEFORE INSERT OR UPDATE ON public.app_settings');
    for (const key of CREDENTIAL_KEYS) {
      expect(sql).toContain(`'${key}'`);
    }
  });

  it('CONTROL: these assertions fail against a permissive migration', () => {
    // Without this the four assertions above could all pass on any file containing the
    // right words. Proves they discriminate.
    const permissive = `
      CREATE POLICY "Allow public read" ON public.app_settings FOR SELECT USING (true);
      CREATE POLICY "Allow public delete" ON public.app_settings FOR DELETE USING (true);
    `;
    expect(permissive).not.toContain('DROP POLICY IF EXISTS "Allow public read"');
    expect(permissive).toMatch(/CREATE POLICY[^;]*FOR DELETE/i);
  });
});
