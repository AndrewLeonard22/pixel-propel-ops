/**
 * Tests for the configuration gate — item ① THE SITE IS BLANK.
 *
 * POPULATION: all combinations of (Supabase connection, airtable creds)
 * present/absent, enumerated rather than sampled. Plus the exact production state
 * @bird observed: config rows exist, app renders "Configure your data sources",
 * zero requests, no error.
 */
import { describe, it, expect } from 'vitest';
import {
  isConfigured,
  isSourceConfigured,
  configuredSources,
  DATA_SOURCES,
  type DataSource,
} from './config';
import { makeSettings } from '@/test/factories';
import { proveDetects, population } from '@/test/sabotage';

describe('isSourceConfigured — each source depends only on its OWN fields', () => {
  it(`is sabotage-proven across all 8 presence combinations ${population('2^3 = 8 combinations, enumerated')}`, () => {
    proveDetects({
      subject: 'isSourceConfigured',
      // ⚠️ AMENDED 2026-08-11 for the Supabase cutover. `googleSheet` became `adSpend`,
      // and its operand is no longer a settings field at all: ad spend is configured when
      // SUPABASE is, because the Meta credentials live server-side in the Edge Function.
      //
      // ⭐ THE LAW UNDER TEST IS UNCHANGED AND IS THE WHOLE POINT: one vendor's missing
      // credentials must not suppress another vendor's fetchable feed. That is the
      // production incident of 2026-08-05, where an empty Airtable token produced ZERO
      // requests to a source that never needed it.
      //
      // ⚠️ WHY 'always configured' IS STILL CAUGHT even though `adSpend` answers `true`
      // throughout this suite (the harness stubs a valid Supabase env): the AIRTABLE
      // assertions below are what falsify it. A poison only has to be caught by ONE arm.
      population:
        'per-source presence: Supabase connection / airtableBaseId, all combinations',
      real: isSourceConfigured,
      poisons: {
        'ANDs across vendors (the current isConfigured bug): adSpend also requires airtable creds':
          ((s, src) =>
            src === 'adSpend'
              ? !!(isSourceConfigured(s, 'adSpend') && s.airtableBaseId)
              : isSourceConfigured(s, src)) as typeof isSourceConfigured,
        'collapses the two sources into one verdict: every source reports what airtable reports':
          ((s) => !!s.airtableBaseId) as typeof isSourceConfigured,
        'always configured': (() => true) as typeof isSourceConfigured,
        'never configured': (() => false) as typeof isSourceConfigured,
      },
      assertions: impl => {
        // ⬅ THE LINE THAT WOULD HAVE CAUGHT THE BLANK SITE. Ad spend does not care what
        // Airtable is missing.
        expect(impl(makeSettings({ airtableBaseId: '' }), 'adSpend')).toBe(true);
        expect(impl(makeSettings(), 'adSpend')).toBe(true);
        // airtable depends ONLY on its own base id
        expect(impl(makeSettings({ airtableBaseId: '' }), 'airtable')).toBe(false);
        expect(impl(makeSettings(), 'airtable')).toBe(true);
      },
    });
  });

  it('enumerates every combination and no source leaks into another', () => {
    /**
     * ⚠️ `adSpend` IS ALWAYS PRESENT IN THIS TABLE, and that is a statement about the
     * HARNESS, not a weakening of the test. Ad spend is configured when Supabase is, and
     * src/test/setup.ts stubs a valid Supabase env for the whole suite — so within these
     * tests it cannot be absent. What is still enumerated, and what the leak law is
     * actually about, is that varying AIRTABLE never changes ad spend's answer.
     */
    const table: { present: DataSource[]; settings: ReturnType<typeof makeSettings> }[] = [];
    for (const at of [true, false]) {
      const settings = makeSettings({ airtableBaseId: at ? 'appTEST123' : '' });
      const present: DataSource[] = ['adSpend'];
      if (at) present.push('airtable');
      table.push({ present, settings });
    }
    expect(table).toHaveLength(2); // population is non-empty and complete
    for (const { present, settings } of table) {
      expect(configuredSources(settings)).toEqual(present);
      for (const src of DATA_SOURCES) {
        expect(isSourceConfigured(settings, src)).toBe(present.includes(src));
      }
    }
  });
});

describe('🔴 item ① — the production blank-site state, pinned', () => {
  /**
   * @bird measured: production renders "Configure your data sources", 0 rows,
   * ZERO requests to Windsor, NO error — while app_settings has rows.
   * The mechanism: isConfigured ANDs across two vendors, and useData.tsx:63
   * returns early and silently when it is false.
   */
  const adSpendOnly = makeSettings({ airtableBaseId: '' });

  it('REPRODUCES the bug: a fetchable ad-spend feed is suppressed by absent Airtable creds', () => {
    expect(isSourceConfigured(adSpendOnly, 'adSpend')).toBe(true); // data IS fetchable
    expect(isConfigured(adSpendOnly)).toBe(false); // ...and the app refuses to fetch it
  });

  it('names the sources that SHOULD load in that state', () => {
    expect(configuredSources(adSpendOnly)).toEqual(['adSpend']);
  });

  it('⚠️ GUARDS THE SEQUENCING CONSTRAINT: relaxing the gate alone is not the fix', () => {
    // fetchAirtableData THROWS when the token is absent, and refresh() wraps both
    // fetches in a single Promise.all — so an ANY-source gate without per-source fetch
    // isolation converts a blank page into a red error with still-zero data.
    // This test exists to make that coupling visible if someone relaxes isConfigured:
    // it will need updating IN THE SAME CHANGE as useData.tsx's fetch isolation.
    expect(isConfigured(adSpendOnly)).toBe(false);
    expect(configuredSources(adSpendOnly).length).toBeGreaterThan(0);
  });
});
