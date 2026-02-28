import { useState, useEffect } from 'react';
import { useData } from '@/hooks/useData';
import { loadSettings, saveSettings, convertSheetUrlToCsv } from '@/lib/config';
import { fetchGoogleSheetData, fetchAirtableData } from '@/lib/dataService';
import type { AppSettings } from '@/lib/types';
import { CheckCircle, AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react';

const REQUIRED_MAPPINGS = [
  'Client Name', 'Campaign Name', 'Campaign ID', 'Ad Set Name', 'Ad Set ID',
  'Ad Name', 'Ad ID', 'Appointment Date', 'Show Status', 'Lead Valid',
  'Closed Revenue', 'Amount Charged', 'Project Value',
];

export default function SettingsPage() {
  const { settings, setSettings, refresh } = useData();
  const [form, setForm] = useState<AppSettings>(settings);
  const [showToken, setShowToken] = useState(false);
  const [sheetStatus, setSheetStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [sheetPreview, setSheetPreview] = useState<Record<string, string>[]>([]);
  const [sheetError, setSheetError] = useState('');
  const [airtableStatus, setAirtableStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [airtableFields, setAirtableFields] = useState<string[]>([]);
  const [airtableError, setAirtableError] = useState('');
  const [saved, setSaved] = useState(false);

  const updateForm = (patch: Partial<AppSettings>) => {
    setForm(prev => ({ ...prev, ...patch }));
  };

  const updateMapping = (key: string, value: string) => {
    setForm(prev => ({
      ...prev,
      columnMappings: { ...prev.columnMappings, [key]: value },
    }));
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

  const handleSave = () => {
    saveSettings(form);
    setSettings(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    refresh();
  };

  return (
    <div className="space-y-8 max-w-3xl">
      <h1 className="text-xl font-bold">Settings</h1>

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

      {/* Section 4: Account Name Aliases */}
      <section className="card-elevated p-6 space-y-4">
        <h2 className="font-semibold text-base">Account Name Aliases</h2>
        <p className="text-xs text-muted-foreground">Map Google Sheet account names to Airtable client names when they don't match exactly. The left side is the name as it appears in Google Sheets, the right side is the name as it appears in Airtable.</p>
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span className="flex-1">Google Sheet Account Name</span>
          <span className="w-6" />
          <span className="flex-1">Airtable Client Name</span>
          <span className="w-8" />
        </div>
        {(form.accountAliases || []).map((alias, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              value={alias.sheetName}
              onChange={e => {
                const updated = [...(form.accountAliases || [])];
                updated[i] = { ...updated[i], sheetName: e.target.value };
                updateForm({ accountAliases: updated });
              }}
              placeholder="e.g. BACKYARD PARADISO"
              className="flex-1 px-3 py-2 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
            <span className="text-muted-foreground text-sm">→</span>
            <input
              type="text"
              value={alias.airtableName}
              onChange={e => {
                const updated = [...(form.accountAliases || [])];
                updated[i] = { ...updated[i], airtableName: e.target.value };
                updateForm({ accountAliases: updated });
              }}
              placeholder="e.g. Backyard Paradiso"
              className="flex-1 px-3 py-2 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
            <button
              onClick={() => {
                const updated = (form.accountAliases || []).filter((_, j) => j !== i);
                updateForm({ accountAliases: updated });
              }}
              className="px-2 py-2 text-sm text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          onClick={() => updateForm({ accountAliases: [...(form.accountAliases || []), { sheetName: '', airtableName: '' }] })}
          className="px-4 py-2 text-sm font-medium rounded-lg border border-dashed border-border hover:bg-accent/30 transition-colors"
        >
          + Add Alias
        </button>
      </section>

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

      {/* Save */}
      <div className="flex items-center gap-3">
        <button onClick={handleSave}
          className="px-6 py-2.5 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity">
          Save Settings
        </button>
        {saved && <span className="text-success text-sm flex items-center gap-1"><CheckCircle className="w-4 h-4" /> Saved!</span>}
      </div>
    </div>
  );
}
