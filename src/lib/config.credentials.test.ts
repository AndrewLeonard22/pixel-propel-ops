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
import { sanitizeSettings, ALLOWED_CONFIG_KEYS, DELETED_FEATURE_KEYS } from './config';
import { proveDetects, population } from '@/test/sabotage';

type Bag = Record<string, unknown>;

/** Settings-shaped, carrying both known credentials AND one nobody has registered. */
const withCredentials = (): Bag => ({
  airtableTableName: 'Appointments',
  airtableBaseId: 'appTEST123',
  // ⛔ A RETIRED key, carried deliberately: a browser holding a stale localStorage copy
  // still sends it, and the allowlist must strip it exactly as it strips a credential.
  googleSheetUrl: 'https://docs.google.com/spreadsheets/d/X/edit',
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
        // ⛔ airtableToken is DECLARED as an owner-ordered exception (2026-08-05) and is
        //    therefore expected to SURVIVE. The inversion is unchanged and still proven by
        //    anthropicApiKey and by metaAccessToken — a credential the guard never named,
        //    which is the case that kills every blocklist design.
        for (const key of ['anthropicApiKey', 'metaAccessToken']) {
          expect(key in cleaned, `undeclared key ${key} must not survive`).toBe(false);
        }
        /**
         * ⭐ AND A RETIRED FEATURE KEY IS REFUSED BY THE SAME MECHANISM, with no extra
         * code — because the guard is an ALLOWLIST. `googleSheetUrl` was declared config
         * until 2026-08-11; a browser with a stale localStorage copy still sends it, and
         * it must not be written back into the row it was retired from. A blocklist design
         * would have needed a new entry here and would not have got one.
         */
        expect('googleSheetUrl' in cleaned, 'a retired key must not be re-persisted').toBe(false);
        expect(
          cleaned.airtableToken,
          'airtableToken is a declared exception and must survive until airtable-proxy ships',
        ).toBeDefined();

        // ② present-but-EMPTY is still a key, still written, still refused by the DB.
        const emptied = impl({ ...withCredentials(), airtableToken: '', metaAccessToken: '' });
        for (const key of ['metaAccessToken']) {
          expect(key in emptied, `${key} must not survive even when empty`).toBe(false);
        }

        // ③ declared configuration is UNTOUCHED — the guard must not be a wipe.
        expect(cleaned.airtableTableName).toBe('Appointments');
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
    /* THE TWO ALLOWLISTS MUST AGREE **IN BOTH DIRECTIONS**, and for a while this only
       checked one. Iterating ALLOWED_CONFIG_KEYS proves every CLIENT key exists in the SQL —
       but DELETING a key from the client simply shrinks the loop, so that direction passed
       silently. My own truth table caught it: "remove from client only" stayed GREEN while
       "remove from SQL only" went red.
       ⇒ AND THE UNGUARDED DIRECTION IS THE ONE THAT LOSES DATA. A key present in the SQL but
         missing from the client is STRIPPED BY sanitizeSettings ON EVERY SAVE — the setting
         silently never persists, which is exactly how `adsRawTabName` would have failed. */
    for (const key of ALLOWED_CONFIG_KEYS) {
      expect(sql, `SQL allowlist is missing ${key}`).toContain(`'${key}'`);
    }
    const sqlKeys = [
      ...(sql.split('allowed_config_keys text[] := ARRAY[')[1] ?? '').split('];')[0].matchAll(/'([A-Za-z]+)'/g),
    ].map((m) => m[1]);
    expect(sqlKeys.length, 'the SQL allowlist must be parseable — an empty parse would make this vacuous').toBeGreaterThan(5);
    for (const key of sqlKeys) {
      if ((DELETED_FEATURE_KEYS as readonly string[]).includes(key)) continue;
      expect(
        ALLOWED_CONFIG_KEYS as readonly string[],
        `CLIENT allowlist is missing ${key} — sanitizeSettings will STRIP it on every save ` +
          `and the setting will silently never persist`,
      ).toContain(key);
    }
  });

  /**
   * ⛔ KEYS WHOSE FEATURE WAS DELETED, 2026-08-11 — declared rather than dropped from the
   * guard, so the drift lock still covers every other key.
   *
   * The call-centre feature was removed entirely: its sheet had never been connected in
   * production (`callCenterSheetUrl` was `''`), so every dial figure the app rendered was a
   * confident zero standing in for data that never existed.
   *
   * `googleSheetUrl` / `googleSheetTab` / `adsRawTabName` joined the list on 2026-08-11 when
   * ad spend moved to `ad_insights`. The sheet had been silently short $166,895 of spend —
   * 27.6%, including the whole of July 2026.
   *
   * ⭐ THE LIST NOW LIVES IN config.ts AND IS IMPORTED HERE, rather than being restated in
   * this file. A retirement declared only in a test is a retirement the production code
   * cannot be checked against — and this arm's entire job is to check them against each
   * other.
   *
   * ⭐ NO MIGRATION IS REQUIRED, AND THAT IS THE WHOLE REASON THIS EXEMPTION IS SAFE:
   * `allowed_config_keys` is a PERMIT list, not a REQUIRE list. Sending fewer keys is always
   * legal, so a key the SQL still permits and the client no longer sends is inert.
   *
   * ⚠️ THE HALF THAT WOULD HAVE BROKEN PRODUCTION, and it is the reason the removal had to
   * be atomic: `settingsWriteGuard` computes blanked fields from `Object.keys(stored)` —
   * EVERY key, not just PROTECTED_FIELDS. The live row holds `callCenterSheetTab: "RAW DATA"`,
   * populated. Had the field been dropped from `AppSettings` while staying in
   * `ALLOWED_CONFIG_KEYS`, `sanitizeSettings` would have kept loading it into `settings`
   * while `form` (seeded from DEFAULT_SETTINGS on a cold browser) lacked it, the guard would
   * have read that as a blanking, and EVERY settings autosave would have been refused.
   * ⇒ `ALLOWED_CONFIG_KEYS` and `AppSettings`/`DEFAULT_SETTINGS` must change together.
   */
  it('the retired keys are gone from the CLIENT allowlist, atomically with their type', async () => {
    // ⚠️ NON-EMPTY, or every loop below passes over nothing.
    expect(DELETED_FEATURE_KEYS.length).toBeGreaterThan(0);
    for (const key of DELETED_FEATURE_KEYS) {
      expect(ALLOWED_CONFIG_KEYS as readonly string[], `${key} must no longer be sent`).not.toContain(key);
    }
    // ANTI-VACUITY: the exemption above must not be able to hide a key the client still
    // models. If AppSettings ever regains one of these, the pair has drifted apart again.
    const defaults = (await import('./config')).DEFAULT_SETTINGS as unknown as Record<string, unknown>;
    for (const key of DELETED_FEATURE_KEYS) {
      expect(defaults, `${key} is still in DEFAULT_SETTINGS`).not.toHaveProperty(key);
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

  // ⛔ OWNER-ORDERED EXCEPTION, 2026-08-05 — declared here rather than deleted, so the guard
  // still covers everything else and the exception is VISIBLE in the suite instead of being
  // a quietly weakened assertion. Andrew: «JUST PUT THE ACCESS TOKEN BACK IN PIXEL».
  // We relocated airtableToken server-side without deploying airtable-proxy, so appointments
  // went dark. The token is re-admitted to restore the product; the exposure is REAL and the
  // token in use must be treated as compromised.
  // ⇒ WHEN airtable-proxy IS DEPLOYED: delete 'airtableToken' from ALLOWED_CONFIG_KEYS and
  //   delete it from OWNER_ORDERED_EXCEPTIONS below. This test then re-tightens by itself.
  const OWNER_ORDERED_EXCEPTIONS = ['airtableToken'];

  it('the retired credential keys are NOT on the allowlist — except declared owner exceptions', () => {
    expect(retiredKeys).toEqual(expect.arrayContaining(['airtableToken', 'anthropicApiKey']));
    for (const key of retiredKeys) {
      if (OWNER_ORDERED_EXCEPTIONS.includes(key)) continue;
      expect(ALLOWED_CONFIG_KEYS as readonly string[], `${key} must never be storable`).not.toContain(key);
    }
  });

  it('the exception list is MINIMAL — anthropicApiKey is still refused, and every exception is real', () => {
    // A blanket exception would make the test above vacuous. Two guards against that:
    expect(OWNER_ORDERED_EXCEPTIONS, 'anthropicApiKey was never ordered back').not.toContain(
      'anthropicApiKey',
    );
    expect(ALLOWED_CONFIG_KEYS as readonly string[]).not.toContain('anthropicApiKey');
    // And an exception that is no longer on the allowlist is stale — remove it from this list.
    for (const key of OWNER_ORDERED_EXCEPTIONS) {
      expect(
        ALLOWED_CONFIG_KEYS as readonly string[],
        `${key} is listed as an exception but is not actually allowed — the list has rotted`,
      ).toContain(key);
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

  /**
   * ⑪ A RETIRED KEY MUST LEAVE THE **PROTECTED** LISTS TOO, AND THAT HALF WAS UNGUARDED.
   *
   * 🔴 THE LANDMINE THIS CLOSES. `protected_keys` named `googleSheetUrl` and
   * `callCenterSheetUrl` — both retired with their features, both now STRIPPED from every
   * write by `sanitizeSettings`, and `googleSheetUrl` still sitting non-empty in the live
   * row (measured 2026-08-12). Guard (c) refuses exactly "old non-empty, new blank", so
   * applying this migration would have refused EVERY SETTINGS AUTOSAVE IN PRODUCTION — the
   * same outage this file's own commentary was written about, re-armed by a guard that was
   * correct when written and never amended when the feature it protected was deleted.
   *
   * ⭐ THE ASYMMETRY THAT MADE IT INVISIBLE, and it is the whole reason this arm exists
   * beside the allowlist arms above. `allowed_config_keys` is a PERMIT list: a retired key
   * left in it is INERT, which is why leaving one there is explicitly exempted a few tests
   * up. `protected_keys` is a REQUIRE list: a retired key left in it BANS THE WRITE. Two
   * arrays, one file, opposite consequences for the identical mistake — and only one of them
   * was locked. The exemption granted to the harmless list had quietly been read as covering
   * the dangerous one.
   *
   * ⛔ NOT A RESTATEMENT OF `DELETED_FEATURE_KEYS`. It is imported from config.ts, so a
   * retirement declared in the production code is what drives this, rather than a second
   * list in a test that can agree with nothing.
   */
  const arrayIn = (name: string): string[] => {
    const block = sql.split(`${name} text[] := ARRAY[`)[1];
    expect(block, `migration must declare ${name}`).toBeTruthy();
    return [...block.split('];')[0].matchAll(/'([A-Za-z]+)'/g)].map(m => m[1]);
  };

  it('🔴 no RETIRED key may sit in protected_keys or protected_collections — that BANS the write', () => {
    const protectedKeys = arrayIn('protected_keys');
    const protectedCollections = arrayIn('protected_collections');
    // ⚠️ ANTI-VACUITY FIRST. An unparseable array yields [] and every loop below passes over
    // nothing — the READ failure mode, which fakes a zero and reads as a clean gate.
    expect(protectedKeys.length, 'protected_keys must parse').toBeGreaterThan(0);
    expect(protectedCollections.length, 'protected_collections must parse').toBeGreaterThan(0);
    expect(DELETED_FEATURE_KEYS.length).toBeGreaterThan(0);

    for (const key of DELETED_FEATURE_KEYS) {
      expect(
        protectedKeys,
        `${key} is RETIRED but still in protected_keys — sanitizeSettings strips it from ` +
          `every write, so guard (c) would refuse every settings autosave`,
      ).not.toContain(key);
      expect(
        protectedCollections,
        `${key} is RETIRED but still in protected_collections — guard (d) would refuse ` +
          `every settings autosave`,
      ).not.toContain(key);
    }
  });

  it('🔑 and every PROTECTED key is one the client still sends — protecting a ghost is banning a save', () => {
    /**
     * The positive half, and it catches the same defect one move earlier: a key can be
     * dropped from `AppSettings` without anyone remembering to add it to
     * `DELETED_FEATURE_KEYS`, and then the arm above passes over an empty exemption while
     * the guard still refuses the write. This asks the question from the other end — is
     * every protected field actually still sent? — so both spellings of the mistake are red.
     */
    for (const key of arrayIn('protected_keys')) {
      expect(
        ALLOWED_CONFIG_KEYS as readonly string[],
        `protected_keys names "${key}", which sanitizeSettings does not send. Guard (c) ` +
          `refuses "was populated, now blank", so this refuses every save.`,
      ).toContain(key);
    }
    for (const key of arrayIn('protected_collections')) {
      expect(
        ALLOWED_CONFIG_KEYS as readonly string[],
        `protected_collections names "${key}", which sanitizeSettings does not send.`,
      ).toContain(key);
    }
  });

  it('🔴 THE CLIENT→SQL ALLOWLIST CHECK READS THE ARRAY, not the whole file', () => {
    /**
     * ⛔ THE VACUITY THIS CLOSES, and it is live rather than hypothetical. The arm above
     * asserts `expect(sql).toContain(`'${key}'`)` — the whole FILE. `airtableToken` appears
     * in this file, in `retired_credential_keys`, i.e. in the list of keys the guard
     * REJECTS. So a key that the database actively refuses satisfied a test whose stated
     * job is "the two allowlists agree". A membership test against the wrong set is the
     * PATTERN failure: it matched, and it meant nothing.
     *
     * Read against the parsed array instead, `airtableToken` is correctly NOT there — which
     * is why it is carried as a declared `OWNER_ORDERED_EXCEPTIONS` entry and not as a
     * silent pass. That exception is a real, standing blocker on applying this migration,
     * and it is now the only thing standing between these two lists.
     */
    const sqlAllowlist = arrayIn('allowed_config_keys');
    expect(sqlAllowlist.length).toBeGreaterThan(5);
    for (const key of ALLOWED_CONFIG_KEYS) {
      if (OWNER_ORDERED_EXCEPTIONS.includes(key)) continue;
      expect(
        sqlAllowlist,
        `${key} is on the CLIENT allowlist but not the SQL one — applying this migration ` +
          `would reject every save that carries it`,
      ).toContain(key);
    }
    // CONTROL: the check can fail. A key on neither list must not be found.
    expect(sqlAllowlist).not.toContain('metaAccessToken');
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

  it('🎯 the bulk-deletion guard catches a PARTIAL revert, not only a wipe to empty', () => {
    const body = sql.replace(/^\s*--.*$/gm, '');
    // @raccoon's bound on the collapse guard: 62 -> 1 passed it. The realistic
    // clobber is a stale copy holding an OLDER populated list, not an empty one.
    expect(body, 'a magnitude rule must exist, not only old>0 && new=0').toMatch(
      /new_n < old_n - 1/,
    );
    expect(sql).toContain('refusing to remove');
  });

  it('⛔ the magnitude rule is ARRAYS-ONLY — on objects it would reject every save', () => {
    const body = sql.replace(/^\s*--.*$/gm, '');
    const magnitude = body.indexOf('new_n < old_n - 1');
    expect(magnitude).toBeGreaterThan(0);
    // the guarded line must be conditioned on BOTH sides being arrays
    const clause = body.slice(Math.max(0, magnitude - 220), magnitude + 40);
    expect(
      /jsonb_typeof\(OLD\.value\) = 'array'/.test(clause) &&
        /jsonb_typeof\(NEW\.value\) = 'array'/.test(clause),
      'the magnitude rule MUST be array-only: (a0) strips up to two keys from the ' +
        'app_settings OBJECT, so an object magnitude rule would compare a 17-key OLD ' +
        'against a 15-key NEW and reject every save from the deployed frontend',
    ).toBe(true);
  });

  it('CONTROL: the strip and the magnitude rule cannot collide — arithmetic, stated', () => {
    // The deployed frontend sends ALLOWED + the 2 retired keys. (a0) strips them.
    const sent = [...ALLOWED_CONFIG_KEYS, ...retiredKeys].length;
    const afterStrip = sent - retiredKeys.length;
    expect(afterStrip).toBe(sent - 2);
    // If the magnitude rule applied to objects, this write would be refused:
    expect(afterStrip < sent - 1, 'a 2-key strip DOES trip an object magnitude rule').toBe(true);
    // ⇒ which is exactly why the rule is array-only. This assertion documents the
    //   collision that the array-only scoping avoids, so nobody "generalises" it later.
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
