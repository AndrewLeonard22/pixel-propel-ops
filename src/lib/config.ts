import { supabase } from '@/integrations/supabase/client';
import type { AppSettings } from './types';

const SETTINGS_KEY = 'socialworks_settings';
const ACCOUNT_MAPPINGS_KEY = 'accountMappings';

const DEFAULT_SETTINGS: AppSettings = {
  googleSheetUrl: '',
  googleSheetTab: 'Ads Data',
  airtableBaseId: '',
  airtableTableName: 'Appointments',
  airtableToken: '',
  columnMappings: {
    'Client Name': 'Client Name',
    'Campaign Name': 'Campaign Name',
    'Campaign ID': 'Campaign ID',
    'Ad Set Name': 'Ad Set Name',
    'Ad Set ID': 'Ad Set ID',
    'Ad Name': 'Ad Name',
    'Ad ID': 'Ad ID',
    'Appointment Date': 'Appointment Date',
    'Show Status': 'Show Status',
    'Lead Valid': 'Lead Valid',
    'Closed Revenue': 'Closed Revenue ($)',
    'Amount Charged': 'Amount Charged',
    'Project Value': 'Project Value',
    'Setter': 'Setter',
    'Lead Status': 'Lead Status',
    'Lead Quality': 'Lead Quality',
    'DQ Reason': 'DQ Reason',
    'Date Added': 'Date Added',
    'Billed': 'Billed?',
    'Client PPA Rate': 'Client PPA Rate',
    'Client Billing Model': 'Client Billing Model',
  },
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
};

// --- localStorage helpers (fallback/cache) ---

function loadSettingsFromLocal(): AppSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    const parsedSettings = stored ? JSON.parse(stored) : {};
    
    // Always prefer the dedicated accountMappings key — it's what Settings.tsx writes to
    const mappingsStored = localStorage.getItem(ACCOUNT_MAPPINGS_KEY);
    const aliasStored = localStorage.getItem('accountAliases');
    const parsedMappings = mappingsStored 
      ? JSON.parse(mappingsStored) 
      : aliasStored 
        ? JSON.parse(aliasStored) 
        : parsedSettings.accountAliases;

    return {
      ...DEFAULT_SETTINGS,
      ...parsedSettings,
      accountAliases: Array.isArray(parsedMappings) ? parsedMappings : DEFAULT_SETTINGS.accountAliases,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettingsToLocal(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  localStorage.setItem('accountAliases', JSON.stringify(settings.accountAliases || []));
}

function loadAccountMappingsFromLocal(): any[] {
  try {
    const stored = localStorage.getItem(ACCOUNT_MAPPINGS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveAccountMappingsToLocal(mappings: any[]): void {
  localStorage.setItem(ACCOUNT_MAPPINGS_KEY, JSON.stringify(mappings));
}

// --- Database helpers ---

async function upsertSetting(key: string, value: any): Promise<void> {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) console.warn('Failed to save setting to DB:', error.message);
}

async function fetchSetting<T>(key: string): Promise<T | null> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) {
    console.warn('Failed to read setting from DB:', error.message);
    return null;
  }
  return data?.value as T | null;
}

// --- Public API ---

/** Synchronous load from localStorage (used for initial render) */
export function loadSettings(): AppSettings {
  return loadSettingsFromLocal();
}

/** Async load: tries DB first, falls back to localStorage, caches result */
export async function loadSettingsAsync(): Promise<AppSettings> {
  try {
    const [dbSettings, dbMappings] = await Promise.all([
      fetchSetting<AppSettings>('app_settings'),
      fetchSetting<any[]>('account_mappings'),
    ]);

    if (dbSettings && typeof dbSettings === 'object' && dbSettings.googleSheetUrl !== undefined) {
      const merged = {
        ...DEFAULT_SETTINGS,
        ...dbSettings,
        // Always use the latest default column mappings merged with any user customizations
        // This prevents stale column mappings from persisting in the DB
        columnMappings: {
          ...DEFAULT_SETTINGS.columnMappings,
          ...(dbSettings.columnMappings || {}),
        },
      };
      if (Array.isArray(dbMappings) && dbMappings.length > 0) {
        merged.accountAliases = dbMappings;
      }
      saveSettingsToLocal(merged);
      if (Array.isArray(dbMappings) && dbMappings.length > 0) {
        saveAccountMappingsToLocal(dbMappings);
      }
      return merged;
    }
  } catch {
    // fall through to local
  }
  return loadSettingsFromLocal();
}

/** Save to both DB and localStorage */
export async function saveSettings(settings: AppSettings): Promise<void> {
  saveSettingsToLocal(settings);
  await upsertSetting('app_settings', settings);
}

/** Synchronous load account mappings from localStorage */
export function loadAccountMappings(): any[] {
  return loadAccountMappingsFromLocal();
}

/** Async load account mappings: DB first, localStorage fallback */
export async function loadAccountMappingsAsync(): Promise<any[]> {
  try {
    const dbMappings = await fetchSetting<any[]>('account_mappings');
    if (Array.isArray(dbMappings) && dbMappings.length > 0) {
      saveAccountMappingsToLocal(dbMappings);
      return dbMappings;
    }
  } catch {
    // fall through
  }
  return loadAccountMappingsFromLocal();
}

/** Save account mappings to both DB and localStorage */
export async function saveAccountMappings(mappings: any[]): Promise<void> {
  saveAccountMappingsToLocal(mappings);
  await upsertSetting('account_mappings', mappings);
}

export function isConfigured(settings: AppSettings): boolean {
  return !!(settings.googleSheetUrl && settings.airtableBaseId && settings.airtableToken);
}

export function convertSheetUrlToCsv(url: string, tab?: string): string {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) return '';
  const spreadsheetId = match[1];
  const gidMatch = url.match(/gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : '0';
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
}

export { DEFAULT_SETTINGS };
