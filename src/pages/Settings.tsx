import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useData } from '@/hooks/useData';
import { saveSettings, saveAccountMappings, loadAccountMappings, loadAccountMappingsAsync } from '@/lib/config';
import { fetchGoogleSheetData, fetchAirtableData } from '@/lib/dataService';
import type { AppSettings } from '@/lib/types';
import { CheckCircle, AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react';

const REQUIRED_MAPPINGS = [
  'Client Name', 'Campaign Name', 'Campaign ID', 'Ad Set Name', 'Ad Set ID',
  'Ad Name', 'Ad ID', 'Appointment Date', 'Show Status', 'Lead Valid',
  'Closed Revenue', 'Amount Charged', 'Project Value',
];

interface AccountMapping {
  sheetName: string;
  airtableName: string;
  program: 'Done For You' | 'Done With You' | 'Other';
  mediaBuyer: string;
  status: 'Active' | 'Paused' | 'Churned';
}

export default function SettingsPage() {
  const { settings, setSettings, adSpend, refresh } = useData();
  const [form, setForm] = useState<AppSettings>(settings);
  const [showToken, setShowToken] = useState(false);
  const [sheetStatus, setSheetStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [sheetPreview, setSheetPreview] = useState<Record<string, string>[]>([]);
  const [sheetError, setSheetError] = useState('');
  const [airtableStatus, setAirtableStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [airtableFields, setAirtableFields] = useState<string[]>([]);
  const [airtableError, setAirtableError] = useState('');
  const [saved, setSaved] = useState(false);
  const [accountMappings, setAccountMappings] = useState<AccountMapping[]>(loadAccountMappings);
  const isFirstRender = useRef(true);

  // On mount, load the latest account mappings from the DB to ensure we have the most up-to-date aliases
  useEffect(() => {
    loadAccountMappingsAsync().then(dbMappings => {
      if (dbMappings && dbMappings.length > 0) {
        setAccountMappings(dbMappings);
      }
    });
  }, []);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Derive unique account names from loaded adSpend data
  const uniqueSheetAccounts = useMemo(() => {
    const names = new Set<string>();
    for (const row of adSpend) {
      if (row.accountName) names.add(row.accountName);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [adSpend]);

// When unique accounts change, only ADD new accounts — never overwrite existing user-configured entries
useEffect(() => {
  if (uniqueSheetAccounts.length === 0) return;
  setAccountMappings(prev => {
    const existing = new Map(prev.map(m => [m.sheetName.trim().toLowerCase(), m]));
    let changed = false;
    const updated = [...prev];

    for (const name of uniqueSheetAccounts) {
      const key = name.trim().toLowerCase();
      if (!existing.has(key)) {
        // Only add accounts that don't already exist — never touch existing ones
        updated.push({ sheetName: name, airtableName: name, program: 'Done For You' as const, mediaBuyer: '', status: 'Active' as const });
        changed = true;
      }
    }

    // Return the same reference if nothing changed — prevents unnecessary re-renders and saves
    return changed ? updated : prev;
  });
}, [uniqueSheetAccounts]);

  // Autosave: debounce form + accountMappings changes
  const performSave = useCallback(async (formToSave: AppSettings, mappingsToSave: AccountMapping[]) => {
    const settingsWithAliases = { ...formToSave, accountAliases: mappingsToSave };
    await Promise.all([
      saveSettings(settingsWithAliases),
      saveAccountMappings(mappingsToSave),
    ]);
    setSettings(settingsWithAliases);
    // Now refresh will always use the latest settings via the ref
    await refresh(settingsWithAliases);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [setSettings, refresh]);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      performSave(form, accountMappings);
    }, 800);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [form, accountMappings, performSave]);

  const updateForm = (patch: Partial<AppSettings>) => {
    setForm(prev => ({ ...prev, ...patch }));
  };

  const updateMapping = (key: string, value: string) => {
    setForm(prev => ({
      ...prev,
      columnMappings: { ...prev.columnMappings, [key]: value },
    }));
  };

  const updateAccountMapping = (index: number, patch: Partial<AccountMapping>) => {
    setAccountMappings(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], ...patch };
      return updated;
    });
  };

  const testSheet = async () => {
    setSheetStatus('loading');
    setSheetError('');
    try {
      const data = await fetchGoogleSheetData(form);
      setSheetPreview(data.slice(0, 3).map(r => r as any));
      setSheetStatus('success');
    } catch (e: any) {
      setSheetError(e.message);
      setSheetStatus('error');
    }
  };

  const testAirtable = async () => {
    setAirtableStatus('loading');
    setAirtableError('');
    try {
      const result = await fetchAirtableData(form);
      setAirtableFields(result.fields);
      setAirtableStatus('success');
    } catch (e: any) {
      setAirtableError(e.message);
      setAirtableStatus('error');
    }
  };

  return (
    <div className="space-y-8 max-w-3xl">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold">Settings</h1>
        {saved && <span className="text-success text-sm flex items-center gap-1 animate-in fade-in"><CheckCircle className="w-4 h-4" /> Saved</span>}
      </div>

      {/* Section 1: Google Sheets */}
      <section className="card-elevated p-6 space-y-4">
        <h2 className="font-semibold text-base">Google Sheets Connection</h2>
        <div>
          <label className="text-sm font-medium text-muted-foreground">Google Sheet URL</label>
          <input
            type="url"
            value={form.googleSheetUrl}
            onChange={e => updateForm({ googleSheetUrl: e.target.value })}
            placeholder="https://docs.google.com/spreadsheets/d/..."
            className="mt-1 w-full px-3 py-2 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-muted-foreground">Tab/Sheet Name</label>
          <input
            type="text"
            value={form.googleSheetTab}
            onChange={e => updateForm({ googleSheetTab: e.target.value })}
            className="mt-1 w-full px-3 py-2 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>
        <div className="flex items-center gap-3">
          <button onClick={testSheet} disabled={!form.googleSheetUrl || sheetStatus === 'loading'}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50">
            {sheetStatus === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Test Connection'}
          </button>
          {sheetStatus === 'success' && <span className="flex items-center gap-1 text-success text-sm"><CheckCircle className="w-4 h-4" /> Connected</span>}
          {sheetStatus === 'error' && <span className="flex items-center gap-1 text-destructive text-sm"><AlertCircle className="w-4 h-4" /> {sheetError}</span>}
        </div>
        {sheetStatus === 'success' && sheetPreview.length > 0 && (
          <div className="overflow-x-auto">
            <p className="text-xs text-muted-foreground mb-2">Preview (first 3 rows):</p>
            <table className="text-xs">
              <thead>
                <tr className="border-b">
                  {Object.keys(sheetPreview[0]).slice(0, 6).map(h => (
                    <th key={h} className="py-1 px-2 text-left text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheetPreview.map((row, i) => (
                  <tr key={i} className="border-b border-border/50">
                    {Object.values(row).slice(0, 6).map((v, j) => (
                      <td key={j} className="py-1 px-2 font-mono-tabular">{String(v)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Section 2: Airtable */}
      <section className="card-elevated p-6 space-y-4">
        <h2 className="font-semibold text-base">Airtable Connection</h2>
        <div>
          <label className="text-sm font-medium text-muted-foreground">Base ID</label>
          <input
            type="text"
            value={form.airtableBaseId}
            onChange={e => updateForm({ airtableBaseId: e.target.value })}
            placeholder="appXXXXXXXXXXXXXX"
            className="mt-1 w-full px-3 py-2 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-muted-foreground">Table Name</label>
          <input
            type="text"
            value={form.airtableTableName}
            onChange={e => updateForm({ airtableTableName: e.target.value })}
            className="mt-1 w-full px-3 py-2 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-muted-foreground">Personal Access Token</label>
          <div className="relative mt-1">
            <input
              type={showToken ? 'text' : 'password'}
              value={form.airtableToken}
              onChange={e => updateForm({ airtableToken: e.target.value })}
              placeholder="pat..."
              className="w-full px-3 py-2 pr-10 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
            <button onClick={() => setShowToken(!showToken)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={testAirtable} disabled={!form.airtableBaseId || !form.airtableToken || airtableStatus === 'loading'}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50">
            {airtableStatus === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Test Connection'}
          </button>
          {airtableStatus === 'success' && <span className="flex items-center gap-1 text-success text-sm"><CheckCircle className="w-4 h-4" /> Connected</span>}
          {airtableStatus === 'error' && <span className="flex items-center gap-1 text-destructive text-sm"><AlertCircle className="w-4 h-4" /> {airtableError}</span>}
        </div>
        {airtableStatus === 'success' && airtableFields.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Available columns:</p>
            <div className="flex flex-wrap gap-1.5">
              {airtableFields.map(f => (
                <span key={f} className="px-2 py-1 rounded-md bg-accent text-xs font-medium">{f}</span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Section 3: Column Mappings */}
      {airtableFields.length > 0 && (
        <section className="card-elevated p-6 space-y-4">
          <h2 className="font-semibold text-base">Column Mappings (Airtable)</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {REQUIRED_MAPPINGS.map(key => (
              <div key={key}>
                <label className="text-xs font-medium text-muted-foreground">{key}</label>
                <select
                  value={form.columnMappings[key] || ''}
                  onChange={e => updateMapping(key, e.target.value)}
                  className="mt-1 w-full px-3 py-2 text-sm rounded-lg border bg-background focus:outline-none"
                >
                  <option value="">— Select —</option>
                  {airtableFields.map(f => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Section 4: Account Mappings */}
      {uniqueSheetAccounts.length > 0 && (
        <section className="card-elevated p-6 space-y-4">
          <h2 className="font-semibold text-base">Account Mappings</h2>
          <p className="text-xs text-muted-foreground">
            Map each Ad Account Name to the matching Airtable Name. Set program, media buyer, and status for Dashboard grouping.
          </p>
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className="flex-1">Ad Account Name</span>
            <span className="flex-1">Airtable Name</span>
            <span className="w-36">Program</span>
            <span className="w-32">Media Buyer</span>
            <span className="w-28">Status</span>
          </div>
          {accountMappings.map((mapping, i) => (
            <div key={mapping.sheetName} className="flex items-center gap-2">
              <span className="flex-1 px-3 py-2 text-sm rounded-lg border bg-muted/50 truncate">
                {mapping.sheetName}
              </span>
              <input
                type="text"
                value={mapping.airtableName}
                onChange={e => updateAccountMapping(i, { airtableName: e.target.value })}
                className="flex-1 px-3 py-2 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
              <select
                value={mapping.program || 'Done For You'}
                onChange={e => updateAccountMapping(i, { program: e.target.value as AccountMapping['program'] })}
                className="w-36 px-3 py-2 text-sm rounded-lg border bg-background focus:outline-none"
              >
                <option value="Done For You">Done For You</option>
                <option value="Done With You">Done With You</option>
                <option value="Other">Other</option>
              </select>
              <input
                type="text"
                value={mapping.mediaBuyer || ''}
                onChange={e => updateAccountMapping(i, { mediaBuyer: e.target.value })}
                placeholder="Unassigned"
                className="w-32 px-3 py-2 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
              <select
                value={mapping.status || 'Active'}
                onChange={e => updateAccountMapping(i, { status: e.target.value as AccountMapping['status'] })}
                className="w-28 px-3 py-2 text-sm rounded-lg border bg-background focus:outline-none"
              >
                <option value="Active">Active</option>
                <option value="Paused">Paused</option>
                <option value="Churned">Churned</option>
              </select>
            </div>
          ))}
        </section>
      )}

      {/* Section 5: Account Groups */}
      <section className="card-elevated p-6 space-y-4">
        <h2 className="font-semibold text-base">Account Groups</h2>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={form.showPausedAccounts} onChange={e => updateForm({ showPausedAccounts: e.target.checked })}
            className="rounded border-input" />
          <span className="text-sm">Show Paused Accounts</span>
        </label>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={form.showChurnedAccounts} onChange={e => updateForm({ showChurnedAccounts: e.target.checked })}
            className="rounded border-input" />
          <span className="text-sm">Show Churned Accounts</span>
        </label>
        <div>
          <label className="text-sm font-medium text-muted-foreground">Paused Threshold (days)</label>
          <input
            type="number"
            value={form.pausedThresholdDays}
            onChange={e => updateForm({ pausedThresholdDays: parseInt(e.target.value) || 1 })}
            min={1}
            className="mt-1 w-24 px-3 py-2 text-sm rounded-lg border bg-background focus:outline-none"
          />
        </div>
      </section>
    </div>
  );
}