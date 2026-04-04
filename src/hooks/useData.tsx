import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import type { AppSettings, AdSpendRow, AppointmentRow, AccountSummary } from '@/lib/types';
import { loadSettings, loadSettingsAsync, isConfigured } from '@/lib/config';
import { fetchGoogleSheetData, fetchAirtableData, buildAccountSummaries } from '@/lib/dataService';

interface DataContextType {
  settings: AppSettings;
  setSettings: (s: AppSettings) => void;
  adSpend: AdSpendRow[];
  appointments: AppointmentRow[];
  accounts: AccountSummary[];
  unmatchedAppointments: AppointmentRow[];
  airtableFields: string[];
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  configured: boolean;
  refresh: (overrideSettings?: AppSettings) => Promise<void>;
}

const defaultDataContext: DataContextType = {
  settings: loadSettings(),
  setSettings: () => {},
  adSpend: [],
  appointments: [],
  accounts: [],
  unmatchedAppointments: [],
  airtableFields: [],
  loading: false,
  error: null,
  lastUpdated: null,
  configured: false,
  refresh: async () => {},
};

const DataContext = createContext<DataContextType>(defaultDataContext);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [adSpend, setAdSpend] = useState<AdSpendRow[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [unmatchedAppointments, setUnmatchedAppointments] = useState<AppointmentRow[]>([]);
  const [airtableFields, setAirtableFields] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const configured = isConfigured(settings);

  // Ref to always have the latest settings available
  const settingsRef = useRef<AppSettings>(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const refresh = useCallback(async (overrideSettings?: AppSettings) => {
    // Always use the ref — it's always the latest value, never stale
    const s = overrideSettings || settingsRef.current;
    if (!isConfigured(s)) return;
    setLoading(true);
    setError(null);
    try {
      const [sheetData, airtableResult] = await Promise.all([
        fetchGoogleSheetData(s),
        fetchAirtableData(s),
      ]);
      setAdSpend(sheetData);
      setAppointments(airtableResult.records);
      setAirtableFields(airtableResult.fields);
      const result = buildAccountSummaries(sheetData, airtableResult.records, s);
      setAccounts(result.accounts);
      setUnmatchedAppointments(result.unmatchedAppointments);
      setLastUpdated(new Date());
    } catch (e: any) {
      setError(e.message || 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load settings from DB on mount, then fetch data
  useEffect(() => {
    let cancelled = false;
    loadSettingsAsync().then(dbSettings => {
      if (cancelled) return;
      setSettings(dbSettings);
      if (isConfigured(dbSettings)) {
        // Pass dbSettings directly to avoid stale closure
        refresh(dbSettings);
      }
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <DataContext.Provider value={{
      settings, setSettings, adSpend, appointments, accounts, airtableFields,
      loading, error, lastUpdated, configured, refresh,
    }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  return useContext(DataContext);
}
