import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A FAILED READ MUST NOT BE REPORTED AS AN ANSWER.
 *
 * @bird drove the deployed site and found the app BOOTING while unable to reach its
 * database: #root 17,655 bytes, 0 page errors, 2× ERR_NAME_NOT_RESOLVED, 0 account rows.
 * The screen said "Configure your data sources — connect your Google Sheet and Airtable in
 * Settings", which is a claim about @andrew's setup. The truth was that the BUILD shipped
 * without VITE_SUPABASE_URL and had never asked him anything.
 *
 * ⭐ HIS LAW, AND IT IS WHY THIS FILE EXISTS: "BOOTS ≠ WORKS, and the safe-looking row is
 * the one that caused twenty minutes of misdiagnosis." A green boot is not a working app,
 * and the failure mode of conflating them is that the software blames the user.
 *
 * ⚠️ THE POPULATION HERE IS THE FOUR ORIGINS, NOT THE HAPPY PATH. Three of them are
 * fallbacks to the local copy and they used to be INDISTINGUISHABLE — the same
 * `loadSettingsFromLocal()` return, with the reason discarded at two separate layers
 * (`fetchSetting` swallowed it into `null`, then `loadSettingsAsync` swallowed that into a
 * bare `catch`). Every arm below exists to prove one of them is now separable.
 */
const state = vi.hoisted(() => ({
  configured: true,
  settings: { data: null as unknown, error: null as { message: string } | null },
  mappings: { data: null as unknown, error: null as { message: string } | null },
  throwOnRead: false,
}));

vi.mock('@/integrations/supabase/client', () => ({
  get isSupabaseConfigured() {
    return state.configured;
  },
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_col: string, key: string) => ({
          maybeSingle: async () => {
            if (state.throwOnRead) throw new Error('TypeError: Failed to fetch');
            return key === 'app_settings' ? state.settings : state.mappings;
          },
        }),
      }),
    }),
  },
}));

const { loadSettingsWithSource, settingsAreUnverified } = await import('./config');

/** A row shaped the way loadSettingsWithSource requires to accept it as authoritative. */
const REAL_ROW = { airtableTableName: 'Appointments', airtableBaseId: 'appREAL' };

beforeEach(() => {
  localStorage.clear();
  state.configured = true;
  state.settings = { data: null, error: null };
  state.mappings = { data: null, error: null };
  state.throwOnRead = false;
});

describe('loadSettingsWithSource — the reason for a fallback survives to the caller', () => {
  it('ANTI-VACUITY CONTROL: a real row reads as origin "database"', async () => {
    // Without this arm every assertion below is satisfiable by a function that always
    // reports a failure, which would be the mirror defect: refusing to trust a live read.
    state.settings = { data: { value: REAL_ROW }, error: null };

    const r = await loadSettingsWithSource();

    expect(r.origin).toBe('database');
    expect(r.detail).toBeNull();
    expect(r.settings.airtableBaseId).toBe(REAL_ROW.airtableBaseId);
    expect(settingsAreUnverified(r.origin)).toBe(false);
  });

  it('🔴 THE LIVE FAILURE: an unconfigured BUILD is "local-not-configured", not "no row"', async () => {
    // This is the exact state @bird measured on adsdata. The old code produced the same
    // output here as it did for a genuinely empty database.
    state.configured = false;
    state.settings = { data: { value: REAL_ROW }, error: null }; // would succeed IF asked

    const r = await loadSettingsWithSource();

    expect(r.origin).toBe('local-not-configured');
    expect(settingsAreUnverified(r.origin)).toBe(true);
    // ⭐ AND THE ROW WAS NEVER CONSULTED — proof we did not merely relabel a read that
    // happened. A build with no URL must not send a request at all.
    expect(r.settings.airtableBaseId).toBe('');
  });

  it('a read ERROR is "local-unreachable" and carries the underlying message', async () => {
    state.settings = { data: null, error: { message: 'TypeError: Failed to fetch' } };

    const r = await loadSettingsWithSource();

    expect(r.origin).toBe('local-unreachable');
    expect(r.detail).toBe('TypeError: Failed to fetch');
    expect(settingsAreUnverified(r.origin)).toBe(true);
  });

  it('a THROWN read is also "local-unreachable" rather than an unhandled rejection', async () => {
    state.throwOnRead = true;

    const r = await loadSettingsWithSource();

    expect(r.origin).toBe('local-unreachable');
    expect(r.detail).toMatch(/Failed to fetch/);
  });

  it('🔑 THE ONE HONEST "CONFIGURE YOUR SOURCES": the DB answered and held nothing', async () => {
    // The database was reachable and really has no settings. This is the only origin where
    // pointing the user at Settings is true, and it must stay distinct from the two above.
    state.settings = { data: null, error: null };

    const r = await loadSettingsWithSource();

    expect(r.origin).toBe('local-no-row');
    expect(settingsAreUnverified(r.origin)).toBe(false);
  });

  it('an UNUSABLE row (present but not settings-shaped) is "local-no-row", not a database answer', async () => {
    state.settings = { data: { value: { unrelated: true } }, error: null };

    expect((await loadSettingsWithSource()).origin).toBe('local-no-row');
  });

  it('🔴 THE THREE FALLBACKS ARE MUTUALLY DISTINGUISHABLE — before this fix they were not', async () => {
    // The defect was IDENTITY: three different causes producing one indistinguishable
    // result. Asserting each origin separately cannot catch a regression that collapses
    // two of them onto the same value, so the identity itself is the assertion.
    state.configured = false;
    const notConfigured = (await loadSettingsWithSource()).origin;

    state.configured = true;
    state.settings = { data: null, error: { message: 'boom' } };
    const unreachable = (await loadSettingsWithSource()).origin;

    state.settings = { data: null, error: null };
    const noRow = (await loadSettingsWithSource()).origin;

    expect(new Set([notConfigured, unreachable, noRow]).size).toBe(3);
  });

  it('a dead MAPPINGS read does not downgrade a good SETTINGS read', async () => {
    // The origin is a statement about app_settings, the row `configured` derives from.
    // Letting a secondary read demote it would make the banner fire on a working app.
    state.settings = { data: { value: REAL_ROW }, error: null };
    state.mappings = { data: null, error: { message: 'boom' } };

    expect((await loadSettingsWithSource()).origin).toBe('database');
  });

  it('detail is NEVER invented for an origin that has no underlying error', async () => {
    state.configured = false;
    expect((await loadSettingsWithSource()).detail).toBeNull();

    state.configured = true;
    state.settings = { data: null, error: null };
    expect((await loadSettingsWithSource()).detail).toBeNull();
  });
});
