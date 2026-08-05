/**
 * Tests for the configuration gate — item ① THE SITE IS BLANK.
 *
 * POPULATION: all 8 combinations of (googleSheetUrl, airtable creds, callCenterUrl)
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
      population:
        '8 combinations of googleSheetUrl / (airtableBaseId+airtableToken) / callCenterSheetUrl',
      real: isSourceConfigured,
      poisons: {
        'ANDs across vendors (the current isConfigured bug): googleSheet also requires airtable creds':
          ((s, src) =>
            src === 'googleSheet'
              ? !!(s.googleSheetUrl && s.airtableBaseId && s.airtableToken)
              : isSourceConfigured(s, src)) as typeof isSourceConfigured,
        'airtable ignores the token, checks only the base id': ((s, src) =>
          src === 'airtable'
            ? !!s.airtableBaseId
            : isSourceConfigured(s, src)) as typeof isSourceConfigured,
        'always configured': (() => true) as typeof isSourceConfigured,
        'never configured': (() => false) as typeof isSourceConfigured,
      },
      assertions: impl => {
        // googleSheet depends ONLY on googleSheetUrl
        expect(impl(makeSettings({ googleSheetUrl: '' }), 'googleSheet')).toBe(false);
        expect(
          impl(
            makeSettings({ airtableBaseId: '', airtableToken: '' }),
            'googleSheet',
          ),
        ).toBe(true); // <- the line that would have caught the blank site
        // airtable needs BOTH base id and token
        expect(impl(makeSettings({ airtableToken: '' }), 'airtable')).toBe(false);
        expect(impl(makeSettings({ airtableBaseId: '' }), 'airtable')).toBe(false);
        expect(impl(makeSettings(), 'airtable')).toBe(true);
        // callCenter depends ONLY on its url
        expect(impl(makeSettings({ callCenterSheetUrl: '' }), 'callCenter')).toBe(false);
        expect(
          impl(makeSettings({ googleSheetUrl: '' }), 'callCenter'),
        ).toBe(true);
      },
    });
  });

  it('enumerates all 8 combinations and no source leaks into another', () => {
    const table: { present: DataSource[]; settings: ReturnType<typeof makeSettings> }[] = [];
    for (const gs of [true, false]) {
      for (const at of [true, false]) {
        for (const cc of [true, false]) {
          const settings = makeSettings({
            googleSheetUrl: gs ? 'https://docs.google.com/spreadsheets/d/X/edit' : '',
            airtableBaseId: at ? 'appTEST123' : '',
            airtableToken: at ? 'test-token-placeholder' : '',
            callCenterSheetUrl: cc ? 'https://docs.google.com/spreadsheets/d/Y/edit' : '',
          });
          const present: DataSource[] = [];
          if (gs) present.push('googleSheet');
          if (at) present.push('airtable');
          if (cc) present.push('callCenter');
          table.push({ present, settings });
        }
      }
    }
    expect(table).toHaveLength(8); // population is non-empty and complete
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
  const windsorOnly = makeSettings({ airtableBaseId: '', airtableToken: '' });

  it('REPRODUCES the bug: a fetchable Windsor feed is suppressed by absent Airtable creds', () => {
    expect(isSourceConfigured(windsorOnly, 'googleSheet')).toBe(true); // data IS fetchable
    expect(isConfigured(windsorOnly)).toBe(false); // ...and the app refuses to fetch it
  });

  it('names the sources that SHOULD load in that state', () => {
    expect(configuredSources(windsorOnly)).toEqual(['googleSheet', 'callCenter']);
  });

  it('⚠️ GUARDS THE SEQUENCING CONSTRAINT: relaxing the gate alone is not the fix', () => {
    // fetchAirtableData THROWS when the token is absent, and refresh() wraps all three
    // fetches in a single Promise.all — so an ANY-source gate without per-source fetch
    // isolation converts a blank page into a red error with still-zero data.
    // This test exists to make that coupling visible if someone relaxes isConfigured:
    // it will need updating IN THE SAME CHANGE as useData.tsx's fetch isolation.
    expect(isConfigured(windsorOnly)).toBe(false);
    expect(configuredSources(windsorOnly).length).toBeGreaterThan(0);
  });
});
