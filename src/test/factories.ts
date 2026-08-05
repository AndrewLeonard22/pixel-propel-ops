/**
 * Typed fixture factories for the whole suite.
 *
 * WHY THIS EXISTS: every seat needs an AppSettings / AdSpendRow / AppointmentRow to test
 * against, and hand-rolling them per test file guarantees they drift apart. Build from
 * the real types so a schema change breaks the factory (loudly) instead of the tests
 * (silently, and only sometimes).
 *
 * RULE: factories produce the MINIMAL VALID shape. A test that needs a hostile value
 * passes it explicitly, so the hostile value is visible AT THE TEST, not buried here.
 */
import type {
  AppSettings,
  AdSpendRow,
  AppointmentRow,
  CallRow,
} from '@/lib/types';

/** A fully-configured settings object. Override any field to test a partial config. */
export function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    googleSheetUrl: 'https://docs.google.com/spreadsheets/d/TESTSHEETID/edit',
    googleSheetTab: 'Ads Data',
    callCenterSheetUrl: 'https://docs.google.com/spreadsheets/d/TESTCALLID/edit',
    callCenterSheetTab: 'RAW DATA',
    airtableBaseId: 'appTEST123',
    airtableTableName: 'Appointments',
    // NOT a credential: a syntactically-shaped placeholder so tests exercise the
    // presence branch. Never put a real token in a fixture.
    airtableToken: 'test-token-placeholder',
    columnMappings: {},
    showPausedAccounts: true,
    showChurnedAccounts: true,
    pausedThresholdDays: 1,
    accountAliases: [],
    perfThresholds: {
      goodCpl: 25,
      goodLeadPercent: 5,
      poorCpl: 50,
      poorLeadPercent: 2,
    },
    anthropicApiKey: '',
    excludedCampaigns: [],
    setterBonusRates: [],
    inactiveSetters: [],
    ...overrides,
  };
}

export function makeAdSpendRow(overrides: Partial<AdSpendRow> = {}): AdSpendRow {
  return {
    month: '',
    date: '8/4/2026',
    campaign: 'Test Campaign',
    campaignId: '111',
    adsetName: 'Test Adset',
    adsetId: '222',
    adName: 'Test Ad',
    adId: '333',
    spent: 100,
    leads: 5,
    accountName: 'Test Account',
    ...overrides,
  };
}

export function makeAppointmentRow(
  overrides: Partial<AppointmentRow> = {},
): AppointmentRow {
  return {
    campaignName: 'Test Campaign',
    campaignId: '111',
    adSetName: 'Test Adset',
    adSetId: '222',
    adName: 'Test Ad',
    adId: '333',
    client: 'Test Account',
    appointmentDate: '8/4/2026',
    dateAdded: '8/4/2026',
    showStatus: 'Showed',
    leadValid: 'Yes',
    leadQuality: '',
    dqReason: '',
    projectValue: 0,
    ...overrides,
  } as AppointmentRow;
}

export function makeCallRow(overrides: Partial<CallRow> = {}): CallRow {
  return {
    timestamp: '8/4/2026',
    ghlLocationName: 'Test Account',
    agentName: 'Agent A',
    callDuration: 60,
    callDisposition: 'answered',
    ...overrides,
  } as CallRow;
}

/**
 * The date shapes MEASURED in the live Windsor feed and the Airtable export.
 * Any date-handling test should run against this whole set, not a chosen member.
 * Population: 581 distinct source days, all M/D/YYYY, plus 4 rows carrying Google
 * Sheets serials introduced by our own derived-tab formula.
 */
export const REAL_DATE_SHAPES = {
  /** the live Windsor format — the ONLY shape in the raw feed */
  slashMDY: '8/4/2026',
  /** ambiguous: day <= 12, so D/M vs M/D cannot be distinguished by inspection */
  slashAmbiguous: '1/2/2025',
  /** Google Sheets serial — 4 rows in the derived tab parse to year 45884 */
  sheetsSerial: '45884',
  /** ISO — produced by any normalisation we add; must round-trip */
  iso: '2026-08-04',
  /** empty cell */
  empty: '',
  /** unparseable */
  garbage: 'not a date',
} as const;
