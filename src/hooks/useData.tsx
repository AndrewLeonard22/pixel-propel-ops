import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { AppSettings, AdSpendRow, AppointmentRow, AccountSummary } from '@/lib/types';
import { loadSettings, isConfigured } from '@/lib/config';
import { fetchGoogleSheetData, fetchAirtableData, buildAccountSummaries } from '@/lib/dataService';

interface DataContextType {
  settings: AppSettings;
  setSettings: (s: AppSettings) => void;
  adSpend: AdSpendRow[];
  appointments: AppointmentRow[];
  accounts: AccountSummary[];
  airtableFields: string[];
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  configured: boolean;
  refresh: () => Promise<void>;
}

const DataContext = createContext<DataContextType | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [adSpend, setAdSpend] = useState<AdSpendRow[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [airtableFields, setAirtableFields] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const configured = isConfigured(settings);

  const refresh = useCallback(async () => {
    if (!isConfigured(settings)) return;
    setLoading(true);
    setError(null);
    try {
      const [sheetData, airtableResult] = await Promise.all([
        fetchGoogleSheetData(settings),
        fetchAirtableData(settings),
      ]);
      setAdSpend(sheetData);
      setAppointments(airtableResult.records);
      setAirtableFields(airtableResult.fields);
      const summaries = buildAccountSummaries(sheetData, airtableResult.records);
      setAccounts(summaries);
      setLastUpdated(new Date());
    } catch (e: any) {
      setError(e.message || 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, [settings]);

  useEffect(() => {
    if (configured) {
      refresh();
    }
  }, [configured]);

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
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
