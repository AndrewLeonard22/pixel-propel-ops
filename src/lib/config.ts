import type { AppSettings } from './types';

const SETTINGS_KEY = 'socialworks_settings';

const DEFAULT_SETTINGS: AppSettings = {
  googleSheetUrl: '',
  googleSheetTab: 'Ads Data',
  airtableBaseId: '',
  airtableTableName: 'Appointments',
  airtableToken: '',
  columnMappings: {
    'Client Name': 'Client',
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
};

export function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch {
    // ignore parse errors
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function isConfigured(settings: AppSettings): boolean {
  return !!(settings.googleSheetUrl && settings.airtableBaseId && settings.airtableToken);
}

export function convertSheetUrlToCsv(url: string, tab?: string): string {
  // Extract spreadsheet ID
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) return '';
  const spreadsheetId = match[1];
  
  // Extract gid if present, otherwise default to 0
  const gidMatch = url.match(/gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : '0';
  
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
}

export { DEFAULT_SETTINGS };
