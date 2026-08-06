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

  // ── the two retired credential keys ──────────────────────────────────────
  //
  // 🔴 THE REGRESSION THESE EXIST FOR, STATED SO IT CANNOT BE TIDIED AWAY:
  // the first version of this migration REJECTED any undeclared key, full stop.
  // The DEPLOYED frontend still models airtableToken/anthropicApiKey and sends
  // both on every save (empty, but present). So applying the migration before a
  // frontend deploy would have made EVERY save from /settings fail — and I told
  // Andrew to apply it FIRST, in ten separate posts, while he was mid-restore.
  // ⇒ The defect was not in the SQL. It was in the ORDER the SQL required.
  const retiredKeys = (() => {
    const block = sql.split('retired_credential_keys text[] := ARRAY[')[1];
    expect(block, 'migration must declare retired_credential_keys').toBeTruthy();
    return [...block.split('];')[0].matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
  })();

  it('the retired credential keys are NOT on the allowlist — they can never be STORED', () => {
    expect(retiredKeys).toEqual(expect.arrayContaining(['airtableToken', 'anthropicApiKey']));
    for (const key of retiredKeys) {
      expect(ALLOWED_CONFIG_KEYS as readonly string[], `${key} must never be storable`).not.toContain(key);
    }
  });

  it('🎯 an EMPTY retired key is STRIPPED, a NON-EMPTY one is REFUSED — the asymmetry IS the fix', () => {
    const a0 = sql.split('(a0)')[2] ?? sql.split('retired_credential_keys text[] := ARRAY[')[1];
    // strips: the key is removed from the row rather than rejected
    expect(sql, 'an empty retired key must be stripped from NEW.value').toMatch(
      /NEW\.value\s*:=\s*NEW\.value\s*-\s*k/,
    );
    // refuses: but only when it actually carries a value
    expect(sql, 'a NON-EMPTY retired key must still raise').toMatch(
      /coalesce\(NEW\.value ->> k, ''\)\s*<>\s*''/,
    );
    expect(sql).toContain('refuses to store');
    // and the refusal must say WHERE the value belongs, or the user just retypes it
    expect(sql, 'the refusal must name the correct home for the secret').toMatch(
      /Edge Function secrets/i,
    );
    expect(a0.length).toBeGreaterThan(0);
  });

  it('🔴 REGRESSION: the payload the DEPLOYED frontend sends must be ACCEPTED', () => {
    // The exact top-level key set a browser running the shipped bundle upserts:
    // every declared setting, PLUS the two credential fields it still models.
    const deployedPayloadKeys = [...ALLOWED_CONFIG_KEYS, ...retiredKeys];

    for (const key of deployedPayloadKeys) {
      const declared = (ALLOWED_CONFIG_KEYS as readonly string[]).includes(key);
      const retired = retiredKeys.includes(key);
      expect(
        declared || retired,
        `${key} is sent by the deployed site but is neither declared nor retired — ` +
          `applying this migration would make every save fail`,
      ).toBe(true);
    }

    // CONTROL — this assertion must be capable of FAILING. A key that is neither
    // declared nor retired is exactly what breaks a save, and it must be caught.
    const smuggled = 'metaAccessToken';
    expect((ALLOWED_CONFIG_KEYS as readonly string[]).includes(smuggled)).toBe(false);
    expect(retiredKeys.includes(smuggled)).toBe(false);
    // ⇒ so an undeclared key IS still rejected: the fix did not open the door,
    //   it only stopped the door falling on the two fields we are retiring.
    expect(sql).toContain('rejects undeclared key');
  });

  it('🔴 the guard covers EVERY ROW, not just app_settings', () => {
    // account_mappings holds 62 mappings and is the row that SURVIVED the wipe.
    // The whole guard body used to sit inside `IF NEW.key = 'app_settings'`, so
    // that row had no shape check and no collapse protection whatsoever.
    // ⚠️ Measure CODE, not prose. An earlier version of this test split on 'BEGIN',
    // which also occurs inside the PEM pattern `-----BEGIN ... PRIVATE KEY-----`,
    // so it silently measured a fragment. Strip line comments first: the guard's own
    // documentation quotes the very strings being searched for.
    const body = sql.replace(/^\s*--.*$/gm, '');
    const scoped = body.indexOf("IF NEW.key = 'app_settings' THEN");
    expect(scoped, 'the app_settings-specific block must still exist').toBeGreaterThan(0);

    // the shape check must appear BEFORE the key-scoped block, i.e. unscoped
    const shapeAt = body.indexOf('sk-ant-');
    expect(shapeAt, 'credential-shape check must exist').toBeGreaterThan(0);
    expect(
      shapeAt < scoped,
      'the credential-shape check must run on EVERY row — if it sits inside the ' +
        'app_settings block, account_mappings can hold a credential',
    ).toBe(true);

    // and the collapse guard must likewise be unscoped
    const collapseAt = body.indexOf('refusing to empty row');
    expect(collapseAt, 'an every-row collapse guard must exist').toBeGreaterThan(0);
    expect(
      collapseAt < scoped,
      'the collapse guard must run on EVERY row, so a key nobody has created yet ' +
        'is protected the day it appears',
    ).toBe(true);
  });

  it('the every-row collapse guard is keyed on SHAPE, not on a list of row names', () => {
    // comments stripped for the same reason as above — the block's own commentary
    // names `account_mappings` deliberately, and a naive match would read that as code
    const body = sql
      .replace(/^\s*--.*$/gm, '')
      .split("IF NEW.key = 'app_settings' THEN")[0];
    // it must not name account_mappings — naming rows is the enumeration this replaced
    expect(body).not.toContain("'account_mappings'");
    // a scalar row must be exempt, or a legitimate string write would be refused
    expect(body, 'non-collections must be exempt via a sentinel').toContain('ELSE -1');
    expect(body).toMatch(/old_n > 0 AND new_n = 0/);
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

  it('🎯 the guard fires on THE OBSERVED ATTACK SHAPE, not on an imagined one', () => {
    // @bird measured the live row as DEFAULT_SETTINGS field-for-field (8/8 exact,
    // including perfThresholds as a 4-tuple and all 21 columnMappings pairs), and
    // @raccoon found the mechanism: Settings.tsx:116 debounce-autosaves
    // performSave(form, accountMappings) where `form` is stuck on DEFAULTS.
    //
    // performSave does `{ ...formToSave, accountAliases: mappingsToSave }` — READ, not
    // assumed: that is why accountAliases survives at 62 while the blob fields empty.
    //
    // So the write is DEFAULTS-with-real-aliases over the real row. These are the
    // transitions it actually causes, and each must be covered:
    const preWipe = {
      googleSheetUrl: 'https://docs.google.com/spreadsheets/d/X/edit',
      callCenterSheetUrl: 'https://docs.google.com/spreadsheets/d/Y/edit',
      airtableBaseId: 'appTEST123',
      excludedCampaigns: new Array(32).fill('c'),
      inactiveSetters: new Array(4).fill('s'),
      accountAliases: new Array(62).fill({}),
    };
    const defaultsWrite = {
      googleSheetUrl: '',
      callCenterSheetUrl: '',
      airtableBaseId: '',
      excludedCampaigns: [],
      inactiveSetters: [],
      accountAliases: new Array(62).fill({}), // ← replaced with the loaded mappings
    };

    const scalarHits = ['googleSheetUrl', 'callCenterSheetUrl', 'airtableBaseId'].filter(
      k => preWipe[k] !== '' && defaultsWrite[k] === '',
    );
    const collectionHits = ['excludedCampaigns', 'inactiveSetters', 'accountAliases'].filter(
      k => (preWipe[k] as unknown[]).length > 0 && (defaultsWrite[k] as unknown[]).length === 0,
    );

    expect(scalarHits).toEqual(['googleSheetUrl', 'callCenterSheetUrl', 'airtableBaseId']);
    expect(collectionHits).toEqual(['excludedCampaigns', 'inactiveSetters']);
    // ⚠️ accountAliases is deliberately NOT in that list — performSave repopulates it,
    // so it never makes the transition. If a future reader "fixes" the guard by
    // trusting a table instead of reading performSave, this is the line that objects.
    expect(collectionHits).not.toContain('accountAliases');

    // and every field that DOES transition must be named in the migration's guards
    for (const k of [...scalarHits, ...collectionHits]) {
      expect(sql, `guard must cover ${k}`).toContain(`'${k}'`);
    }
    // FIVE independent conditions fire on this shape — the write is refused five ways.
    expect(scalarHits.length + collectionHits.length).toBe(5);
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
