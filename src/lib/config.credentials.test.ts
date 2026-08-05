/**
 * Tests for order item ② — CREDENTIALS OUT OF app_settings.
 *
 * WHAT WENT WRONG, so the next reader knows what these guard:
 * `airtableToken` and `anthropicApiKey` were fields on AppSettings, and AppSettings is
 * persisted to the `app_settings` table. That table had RLS enabled and then four
 * policies granting anon SELECT/INSERT/UPDATE/DELETE with USING (true). The Supabase
 * publishable key ships in the browser bundle and the repo is public, so "anon" is the
 * open internet. A live Airtable PAT and a live Anthropic key were readable by anyone —
 * verified live, both authenticating.
 *
 * ⭐ THE GUARD IS AN ALLOWLIST, AND THE CENTRAL TEST IS THAT AN UNDECLARED KEY IS
 * REFUSED — including a credential nobody has thought of yet. A blocklist passes every
 * test you can write about the two keys you already know about, and lets the third in.
 *
 * POPULATION: every key of AppSettings (declared, must survive) plus undeclared keys —
 * the two known credentials AND a never-before-seen one — enumerated from the exported
 * ALLOWED_CONFIG_KEYS rather than hardcoded, so adding a field without declaring it
 * fails HERE rather than in production.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sanitizeSettings, ALLOWED_CONFIG_KEYS } from './config';
import { proveDetects, population } from '@/test/sabotage';

type Bag = Record<string, unknown>;

/** Settings-shaped, carrying both known credentials AND one nobody has registered. */
const withCredentials = (): Bag => ({
  googleSheetUrl: 'https://docs.google.com/spreadsheets/d/X/edit',
  airtableBaseId: 'appTEST123',
  excludedCampaigns: ['c1', 'c2'],
  pausedThresholdDays: 1,
  airtableToken: 'pat_PLACEHOLDER_NOT_A_REAL_TOKEN',
  anthropicApiKey: 'sk-ant-PLACEHOLDER_NOT_A_REAL_KEY',
  // 🔴 THE ONE THAT MATTERS: a credential that did not exist when the guard was written.
  metaAccessToken: 'EAAG_PLACEHOLDER_NOT_A_REAL_TOKEN',
});

/** The old, rejected design: a hand-maintained list of forbidden keys. */
const blocklist = (forbidden: string[]) => (o: Bag): Bag => {
  const c = { ...o };
  for (const k of forbidden) delete c[k];
  return c;
};

describe('sanitizeSettings — only DECLARED config can be persisted', () => {
  it(`is sabotage-proven ${population('declared keys survive; undeclared keys — known AND unknown credentials — are refused')}`, () => {
    proveDetects({
      subject: 'sanitizeSettings',
      population:
        'every key in ALLOWED_CONFIG_KEYS (must survive) + airtableToken, anthropicApiKey ' +
        'and metaAccessToken (must not), the last being a credential the guard never named',
      real: sanitizeSettings as (o: Bag) => Bag,
      poisons: {
        // ⭐ THE POISON THAT JUSTIFIES THE WHOLE INVERSION. This is exactly what the
        // first version of this guard did, and it passes every test about the two
        // credentials we already knew about.
        'BLOCKLIST of the two known credentials (the original design)':
          blocklist(['airtableToken', 'anthropicApiKey']),
        'blocklist missing one of the two': blocklist(['airtableToken']),
        'blanks the values instead of removing the keys': ((o: Bag) => {
          const c = { ...o };
          for (const k of ['airtableToken', 'anthropicApiKey', 'metaAccessToken']) {
            if (k in c) c[k] = '';
          }
          return c;
        }) as (o: Bag) => Bag,
        'only removes keys whose value is truthy': ((o: Bag) => {
          const c = { ...o };
          for (const k of Object.keys(c)) {
            if (!ALLOWED_CONFIG_KEYS.includes(k as never) && c[k]) delete c[k];
          }
          return c;
        }) as (o: Bag) => Bag,
        'does nothing': ((o: Bag) => o) as (o: Bag) => Bag,
        'strips everything, including declared config': (() => ({})) as (o: Bag) => Bag,
      },
      assertions: impl => {
        const cleaned = impl(withCredentials());

        // ① THE INVERSION: an undeclared key is refused, whether or not anyone
        //    remembered to name it. `metaAccessToken` kills every blocklist.
        for (const key of ['airtableToken', 'anthropicApiKey', 'metaAccessToken']) {
          expect(key in cleaned, `undeclared key ${key} must not survive`).toBe(false);
        }

        // ② present-but-EMPTY is still a key, still written, still refused by the DB.
        const emptied = impl({ ...withCredentials(), airtableToken: '', metaAccessToken: '' });
        for (const key of ['airtableToken', 'metaAccessToken']) {
          expect(key in emptied, `${key} must not survive even when empty`).toBe(false);
        }

        // ③ declared configuration is UNTOUCHED — the guard must not be a wipe.
        expect(cleaned.googleSheetUrl).toBe('https://docs.google.com/spreadsheets/d/X/edit');
        expect(cleaned.airtableBaseId).toBe('appTEST123');
        expect(cleaned.excludedCampaigns).toEqual(['c1', 'c2']);
        expect(cleaned.pausedThresholdDays).toBe(1);
      },
    });
  });

  it('every key of a full settings object is declared — an omission would silently drop config', () => {
    // Guards the OTHER failure direction: too-narrow an allowlist deletes real settings.
    const full: Bag = {};
    for (const k of ALLOWED_CONFIG_KEYS) full[k] = 'x';
    expect(Object.keys(sanitizeSettings(full))).toHaveLength(ALLOWED_CONFIG_KEYS.length);
  });

  it('does not mutate its input', () => {
    const original = withCredentials();
    sanitizeSettings(original);
    expect('airtableToken' in original).toBe(true);
  });

  it('ALLOWED_CONFIG_KEYS is non-empty — an empty allowlist would strip all config', () => {
    expect(ALLOWED_CONFIG_KEYS.length).toBeGreaterThan(0);
  });

  it('⚠️ BOUND, ASSERTED NOT ASSUMED: this filter is TOP-LEVEL ONLY — nesting passes it', () => {
    // Documented limitation, pinned so nobody reads the guard as wider than it is.
    // The nested case is covered in the DATABASE by a credential-SHAPE check over the
    // whole serialised value. If that DB check is ever removed, this test is the record
    // of what stopped being covered.
    const nested = sanitizeSettings({
      columnMappings: { token: 'sk-ant-PLACEHOLDER_NOT_A_REAL_KEY' },
    } as Bag) as Bag;
    expect((nested.columnMappings as Bag).token).toBe('sk-ant-PLACEHOLDER_NOT_A_REAL_KEY');
  });
});

describe('the app_settings lockdown migration', () => {
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/20260806000000_lock_down_app_settings.sql'),
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
    expect(sql).not.toMatch(/CREATE POLICY[^;]*FOR DELETE/i);
  });

  it('guards by ALLOWLIST, not by a list of forbidden keys', () => {
    expect(sql).toContain('allowed_config_keys');
    expect(sql).toContain('rejects undeclared key');
    // and the client allowlist must agree with the SQL one, key for key
    for (const key of ALLOWED_CONFIG_KEYS) {
      expect(sql, `SQL allowlist is missing ${key}`).toContain(`'${key}'`);
    }
  });

  it('rejects credential-shaped VALUES anywhere in the object, which covers nesting', () => {
    expect(sql).toContain('credential-shaped value');
    expect(sql).toContain('NEW.value::text'); // whole object, nested included
    expect(sql).toMatch(/sk-ant-/); // at least the two we have seen in this project
    expect(sql).toMatch(/pat\[A-Za-z0-9\]/);
  });

  it('installs the trigger on INSERT *and* UPDATE', () => {
    expect(sql).toContain('BEFORE INSERT OR UPDATE ON public.app_settings');
  });

  it('refuses to EMPTY a curated collection, not only to blank a connection string', () => {
    // @raccoon's reproduced race (raccoon/stab ce0f31b) writes the browser's stale copy
    // over the shared row. If that copy happens to hold a populated googleSheetUrl, the
    // scalar guard stays SILENT and the curated lists are destroyed anyway — which is
    // the 32-exclusions loss nobody could attribute. This is the half that catches it.
    expect(sql).toContain('protected_collections');
    expect(sql).toContain('refusing to empty');
    for (const key of ['excludedCampaigns', 'setterBonusRates', 'accountAliases']) {
      expect(sql, `collection guard must cover ${key}`).toContain(`'${key}'`);
    }
    // and it must count members, not merely test presence — an empty array IS present
    expect(sql).toContain('jsonb_array_length');
  });

  it('CONTROL: these assertions fail against a permissive migration', () => {
    const permissive = `
      CREATE POLICY "Allow public read" ON public.app_settings FOR SELECT USING (true);
      CREATE POLICY "Allow public delete" ON public.app_settings FOR DELETE USING (true);
    `;
    expect(permissive).not.toContain('DROP POLICY IF EXISTS "Allow public read"');
    expect(permissive).toMatch(/CREATE POLICY[^;]*FOR DELETE/i);
    expect(permissive).not.toContain('allowed_config_keys');
  });
});
