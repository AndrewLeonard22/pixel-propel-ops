import { useState, useMemo, useCallback } from 'react';
import { useData } from '@/hooks/useData';
import { ConfigBanner, ErrorBanner } from '@/components/common/Banners';
import { KPISkeleton, TableSkeleton } from '@/components/common/LoadingSkeleton';
import EmptyState from '@/components/common/EmptyState';
import PerformanceBadge from '@/components/common/PerformanceBadge';
import { formatCurrency, formatNumber, formatPercent, formatDate, buildAccountSummaries } from '@/lib/dataService';
import { saveSettings, saveAccountMappings } from '@/lib/config';
import { ChevronDown, ChevronRight, Search, AlertTriangle, Check, X } from 'lucide-react';
import type { AccountSummary, CampaignSummary, PerformanceLevel, AppointmentRow, CallRow } from '@/lib/types';
import { startOfMonth, endOfMonth, subMonths } from 'date-fns';

type DatePreset = 'all' | 'this_month' | 'last_month' | 'last_3_months' | 'custom';

interface AccountMapping {
  sheetName: string;
  airtableName: string;
  program: 'Done For You' | 'Done With You' | 'Other';
  status: 'Active' | 'Paused' | 'Churned';
}

function loadAccountMappings(): AccountMapping[] {
  try {
    const stored = localStorage.getItem('accountMappings');
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function getAccountMapping(accountName: string, mappings: AccountMapping[]): { program: string; status: string } {
  const match = mappings.find(m => m.sheetName.trim().toLowerCase() === accountName.trim().toLowerCase());
  return {
    program: match?.program || 'Done For You',
    status: match?.status || 'Active',
  };
}

interface AccountGroup {
  label: string;
  accounts: AccountSummary[];
  defaultOpen: boolean;
}

function AccountSection({ group, onSelect }: { group: AccountGroup; onSelect: (account: AccountSummary) => void }) {
  if (group.accounts.length === 0) return null;

  return (
    <>
      <tr>
        <td colSpan={9} className="pt-4 pb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</span>
            <span className="text-xs px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground font-medium">{group.accounts.length}</span>
          </div>
        </td>
      </tr>
      {group.accounts.map(a => (
        <AccountRow key={a.accountName} account={a} onSelect={onSelect} />
      ))}
    </>
  );
}

function parseDateSafe(dateStr: string): Date | null {
  if (!dateStr) return null;
  const normalized = dateStr.replace(/(\d+:\d+)(am|pm)/i, (_, time, ampm) => `${time} ${ampm.toUpperCase()}`);
  let d = new Date(normalized);
  if (!isNaN(d.getTime())) return d;
  const dateOnly = dateStr.replace(/\s+\d+:\d+\s*(am|pm)?\s*$/i, '').trim();
  if (dateOnly && dateOnly !== dateStr) {
    d = new Date(dateOnly);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function KPICard({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="card-elevated p-5">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
      <p className={mono ? 'kpi-number text-foreground' : 'text-2xl font-bold text-foreground'}>{value}</p>
    </div>
  );
}

function CPLBadge({ value }: { value: number }) {
  const color = value === 0 ? 'text-muted-foreground' : value < 35 ? 'text-success' : value <= 55 ? 'text-warning' : 'text-destructive';
  return <span className={`font-mono-tabular font-semibold ${color}`}>{formatCurrency(value)}</span>;
}

function CostPerApptBadge({ value }: { value: number }) {
  const color = value === 0 ? 'text-muted-foreground' : value < 180 ? 'text-success' : value <= 240 ? 'text-warning' : 'text-destructive';
  return <span className={`font-mono-tabular font-semibold ${color}`}>{formatCurrency(value)}</span>;
}

function getPerfByProgram(program: string, cpl: number, costPerAppt: number, appointments: number): PerformanceLevel | null {
  if (program === 'Done With You') {
    if (cpl === 0) return null;
    if (cpl < 35) return 'good';
    if (cpl <= 55) return 'fair';
    return 'poor';
  }
  if (costPerAppt === 0 || appointments === 0) return null;
  if (costPerAppt < 180) return 'good';
  if (costPerAppt <= 240) return 'fair';
  return 'poor';
}

function AccountRow({ account, onSelect }: { account: AccountSummary; onSelect: (account: AccountSummary) => void }) {
  const mappings = loadAccountMappings();
  const { program, status } = getAccountMapping(account.accountName, mappings);
  const perf = (status === 'Paused' || status === 'Churned') ? null : getPerfByProgram(program, account.cpl, account.costPerAppt, account.appointments);

  return (
    <tr
      onClick={() => onSelect(account)}
      className="cursor-pointer hover:bg-accent/30 transition-colors"
      style={perf ? { borderLeft: `3px solid hsl(var(--${perf === 'good' ? 'success' : perf === 'fair' ? 'warning' : 'destructive'}))` } : undefined}
    >
      <td className="py-3 pl-3 pr-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm truncate">{account.accountName}</span>
          <span className="text-xs text-muted-foreground">{account.campaigns.length} campaigns</span>
          {account.mediaBuyer && <span className="text-xs text-muted-foreground">· {account.mediaBuyer}</span>}
        </div>
      </td>
      <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap">{formatCurrency(account.spend)}</td>
      <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap">{formatNumber(account.leads)}</td>
      <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap"><CPLBadge value={account.cpl} /></td>
      <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap">{formatNumber(account.totalDials)}</td>
      <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap">{formatNumber(account.appointments)}</td>
      <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap"><CostPerApptBadge value={account.costPerAppt} /></td>
      <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap">{formatNumber(account.closed)}</td>
      <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap">{formatCurrency(account.revenue)}</td>
    </tr>
  );
}

// === Account Detail Panel (slide-over) ===



function AccountDetailPanel({ account, onClose }: { account: AccountSummary; onClose: () => void }) {
  const mappings = loadAccountMappings();
  const { program } = getAccountMapping(account.accountName, mappings);

  const showedCount = account.appointmentList.filter(a => {
    const s = (a.showStatus || '').toLowerCase();
    return s === 'showed' || s === 'show';
  }).length;

  const leadToAppt = account.leads > 0 && account.appointments > 0 ? (account.appointments / account.leads) * 100 : 0;
  const dialsPerLead = account.leads > 0 ? (account.totalDials / account.leads).toFixed(1) : '0';
  const showRate = account.appointmentList.length > 0 ? (showedCount / account.appointmentList.length) * 100 : 0;
  const closeRate = account.appointmentList.length > 0 ? (account.closed / account.appointmentList.length) * 100 : 0;

  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(new Set());
  const toggleCampaign = (id: string) => setExpandedCampaigns(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // Dial activity stats (separate from funnel)
  const dialBookingRate = account.totalDials > 0 ? ((account.appointments / account.totalDials) * 100).toFixed(1) : '—';
  const dialsPerLeadFunnel = account.leads > 0 ? (account.totalDials / account.leads).toFixed(1) : '—';

  // Build funnel stages (no Dials — it's a parallel activity, not a funnel stage)
  const funnelStages = [
    { label: 'Leads', value: account.leads, barClass: 'bg-indigo-100', textDark: false },
    { label: 'Appointments', value: account.appointments, barClass: 'bg-indigo-300', textDark: false },
    { label: 'Showed', value: showedCount, barClass: 'bg-indigo-500', textDark: true },
    { label: 'Closed', value: account.closed, barClass: 'bg-emerald-500', textDark: true },
  ];
  const leadsValue = account.leads;

  // Recent appointments sorted by dateAdded desc
  const recentAppts = [...account.appointmentList]
    .sort((a, b) => {
      const da = parseDateSafe(a.dateAdded || a.appointmentDate);
      const db = parseDateSafe(b.dateAdded || b.appointmentDate);
      return (db?.getTime() || 0) - (da?.getTime() || 0);
    })
    .slice(0, 30);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/40" />
      {/* Panel */}
      <div
        className="relative w-full max-w-2xl bg-card border-l shadow-xl overflow-y-auto animate-in slide-in-from-right duration-300"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-card border-b px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">{account.accountName}</h2>
            {account.mediaBuyer && <p className="text-xs text-muted-foreground">{account.mediaBuyer}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted transition-colors">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Section 1 — KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="card-elevated p-3">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Spend</p>
              <p className="text-lg font-bold font-mono-tabular text-foreground">{formatCurrency(account.spend)}</p>
            </div>
            <div className="card-elevated p-3">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">CPL</p>
              <p className="text-lg font-bold font-mono-tabular"><CPLBadge value={account.cpl} /></p>
            </div>
            <div className="card-elevated p-3">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Cost/Appt</p>
              <p className="text-lg font-bold font-mono-tabular"><CostPerApptBadge value={account.costPerAppt} /></p>
            </div>
            <div className="card-elevated p-3">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Lead-to-Appt</p>
              <p className="text-lg font-bold font-mono-tabular text-foreground">{formatPercent(leadToAppt)}</p>
            </div>
            <div className="card-elevated p-3">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Dials/Lead</p>
              <p className="text-lg font-bold font-mono-tabular text-foreground">{dialsPerLead}</p>
            </div>
            <div className="card-elevated p-3">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Show Rate</p>
              <p className="text-lg font-bold font-mono-tabular text-foreground">{formatPercent(showRate)}</p>
            </div>
            <div className="card-elevated p-3">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Close Rate</p>
              <p className="text-lg font-bold font-mono-tabular text-foreground">{formatPercent(closeRate)}</p>
            </div>
            <div className="card-elevated p-3">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Revenue</p>
              <p className="text-lg font-bold font-mono-tabular text-foreground">{formatCurrency(account.revenue)}</p>
            </div>
          </div>

          {/* Dial Activity Callout */}
          {account.totalDials > 0 && (
            <div className="bg-muted/30 rounded-lg px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dial Activity</span>
              <span className="text-sm font-mono-tabular text-foreground">
                {formatNumber(account.totalDials)} dials · {dialsPerLeadFunnel} per lead · {dialBookingRate}% booking rate
              </span>
            </div>
          )}

          {/* Section 2 — Funnel Visualization */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">Conversion Funnel</h3>
            {leadsValue === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No lead data</p>
            ) : (
              <div className="max-w-[500px] mx-auto">
                <div className="flex flex-col gap-0.5">
                  {funnelStages.map((stage, i) => {
                    const widthPct = leadsValue > 0 ? Math.max((stage.value / leadsValue) * 100, stage.value > 0 ? 8 : 0) : 0;
                    const nextStage = funnelStages[i + 1];
                    let conversionLabel: string | null = null;
                    if (nextStage && stage.value > 0) {
                      conversionLabel = `${((nextStage.value / stage.value) * 100).toFixed(1)}% →`;
                    } else if (nextStage && stage.value === 0) {
                      conversionLabel = '—';
                    }
                    const textColor = stage.textDark ? 'text-white' : 'text-indigo-900';
                    return (
                      <div key={stage.label}>
                        <div
                          className={`${stage.barClass} h-9 rounded-lg mx-auto relative flex items-center justify-between px-3 transition-all duration-500`}
                          style={{ width: `${widthPct}%` }}
                        >
                          <span className={`text-xs font-medium ${textColor} relative z-10`}>{stage.label}</span>
                          <span className={`text-sm font-mono-tabular font-bold ${textColor} relative z-10`}>{formatNumber(stage.value)}</span>
                        </div>
                        {conversionLabel && i < funnelStages.length - 1 && (
                          <p className="text-[10px] text-muted-foreground text-center py-0.5">{conversionLabel}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Section 3 — Campaign Breakdown */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">Campaigns ({account.campaigns.length})</h3>
            <div className="space-y-2">
              {account.campaigns.map(c => {
                const cPerf = getPerfByProgram(program, c.cpl, c.costPerAppt, c.appointments);
                const isExpanded = expandedCampaigns.has(c.campaignId);
                return (
                  <div key={c.campaignId} className="card-elevated overflow-hidden">
                    <div
                      className="p-3 cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => toggleCampaign(c.campaignId)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {isExpanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                          <span className="text-sm font-medium truncate max-w-[300px]">{c.campaignName}</span>
                        </div>
                        {cPerf && <PerformanceBadge level={cPerf} />}
                      </div>
                      <div className="flex flex-wrap gap-3 mt-1.5 ml-5">
                        <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">SPEND</span><span className="text-xs font-mono-tabular font-semibold">{formatCurrency(c.spend)}</span></span>
                        <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">LEADS</span><span className="text-xs font-mono-tabular font-semibold">{c.leads}</span></span>
                        <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">CPL</span><span className="text-xs font-mono-tabular font-semibold"><CPLBadge value={c.cpl} /></span></span>
                        <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">APPTS</span><span className="text-xs font-mono-tabular font-semibold">{c.appointments}</span></span>
                        <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">CPA</span><span className="text-xs font-mono-tabular font-semibold"><CostPerApptBadge value={c.costPerAppt} /></span></span>
                      </div>
                    </div>
                    {isExpanded && c.adSets && c.adSets.length > 0 && (
                      <div className="border-t border-border">
                        {c.adSets.map((as, idx) => {
                          const asPerf = getPerfByProgram(program, as.cpl, as.costPerAppt, as.appointments);
                          return (
                            <div key={as.adSetId || idx} className={`pl-4 pr-3 py-2 ${idx > 0 ? 'border-t border-border/50' : ''}`}>
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-xs text-foreground truncate">{as.adSetName}</span>
                                {asPerf && <PerformanceBadge level={asPerf} />}
                                <span className="text-[10px] text-muted-foreground">{as.adCount} ads</span>
                              </div>
                              <div className="flex flex-wrap gap-3 mt-1 pl-0">
                                <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">SPEND</span><span className="text-[11px] font-mono-tabular font-semibold">{formatCurrency(as.spend)}</span></span>
                                <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">LEADS</span><span className="text-[11px] font-mono-tabular font-semibold">{as.leads}</span></span>
                                <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">CPL</span><span className="text-[11px] font-mono-tabular font-semibold"><CPLBadge value={as.cpl} /></span></span>
                                <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">APPTS</span><span className="text-[11px] font-mono-tabular font-semibold">{as.appointments}</span></span>
                                <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">CPA</span><span className="text-[11px] font-mono-tabular font-semibold"><CostPerApptBadge value={as.costPerAppt} /></span></span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 4 — Recent Appointments */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">Appointments ({account.appointmentList.length})</h3>
            {recentAppts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No appointments found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide border-b border-border" style={{ height: '32px' }}>
                      <th className="text-left pl-2 align-middle">Setter</th>
                      <th className="text-left px-2 align-middle">Date</th>
                      <th className="text-left px-2 align-middle">Show Status</th>
                      <th className="text-left px-2 align-middle">Lead Valid</th>
                      <th className="text-right pr-2 align-middle">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentAppts.map((appt, i) => (
                      <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="pl-2 py-1.5 text-foreground">{appt.setter || '—'}</td>
                        <td className="px-2 py-1.5 text-muted-foreground font-mono-tabular">{formatDate(appt.dateAdded || appt.appointmentDate)}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{appt.showStatus || '—'}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{appt.leadValid || '—'}</td>
                        <td className="pr-2 py-1.5 text-right font-mono-tabular">{formatCurrency(appt.closedRevenue || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// === Unmatched Section (unchanged) ===

function UnmatchedSection({
  appointments,
  accounts,
  settings,
  setSettings,
  refresh,
  assignedClients,
  setAssignedClients,
  recentlyAssigned,
  setRecentlyAssigned,
}: {
  appointments: AppointmentRow[];
  accounts: AccountSummary[];
  settings: any;
  setSettings: (s: any) => void;
  refresh: (s?: any) => Promise<void>;
  assignedClients: Set<string>;
  setAssignedClients: React.Dispatch<React.SetStateAction<Set<string>>>;
  recentlyAssigned: Set<string>;
  setRecentlyAssigned: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  const [open, setOpen] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);

  const visibleAppts = appointments.filter(a => !assignedClients.has(a.client?.trim().toLowerCase() || ''));

  const handleAssign = useCallback(async (appt: AppointmentRow, accountName: string) => {
    const clientKey = appt.client?.trim().toLowerCase() || '';
    setAssigning(clientKey);
    try {
      const existingAliases = settings.accountAliases || [];
      const alreadyExists = existingAliases.some(
        (a: any) => a.airtableName?.trim().toLowerCase() === clientKey
      );
      if (!alreadyExists) {
        const newAlias = {
          sheetName: accountName,
          airtableName: appt.client?.trim() || '',
          program: 'Done For You' as const,
          mediaBuyer: '',
          status: 'Active' as const,
        };
        const updatedAliases = [...existingAliases, newAlias];
        const updatedSettings = { ...settings, accountAliases: updatedAliases };
        setSettings(updatedSettings);
        await Promise.all([
          saveSettings(updatedSettings),
          saveAccountMappings(updatedAliases),
        ]);
      }
      setRecentlyAssigned(prev => new Set(prev).add(clientKey));
      setTimeout(() => {
        setAssignedClients(prev => new Set(prev).add(clientKey));
        setRecentlyAssigned(prev => {
          const next = new Set(prev);
          next.delete(clientKey);
          return next;
        });
      }, 1500);
      await refresh();
    } finally {
      setAssigning(null);
    }
  }, [settings, setSettings, refresh, setAssignedClients, setRecentlyAssigned]);

  if (visibleAppts.length === 0) return null;

  const uniqueByClient = new Map<string, AppointmentRow>();
  for (const a of visibleAppts) {
    const key = a.client?.trim().toLowerCase() || a.campaignName || '';
    if (!uniqueByClient.has(key)) uniqueByClient.set(key, a);
  }
  const displayAppts = Array.from(uniqueByClient.values());

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden" style={{ borderLeftWidth: '4px', borderLeftColor: 'hsl(var(--warning, 45 93% 47%))' }}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
      >
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        <AlertTriangle className="w-4 h-4 text-yellow-500" />
        <span>{visibleAppts.length} Unmatched Appointment{visibleAppts.length !== 1 ? 's' : ''}</span>
        <span className="text-muted-foreground font-normal ml-1">({displayAppts.length} unique client{displayAppts.length !== 1 ? 's' : ''})</span>
      </button>
      {open && (
        <div className="border-t border-border overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wide border-b border-border" style={{ height: '36px' }}>
                <th className="text-left pl-4 align-middle">Client Name</th>
                <th className="text-left px-3 align-middle">Lead Name</th>
                <th className="text-left px-3 align-middle">Date Added</th>
                <th className="text-left px-3 align-middle">Campaign</th>
                <th className="text-left px-3 align-middle" style={{ width: '200px' }}>Assign to Account</th>
              </tr>
            </thead>
            <tbody>
              {displayAppts.map((appt, i) => {
                const clientKey = appt.client?.trim().toLowerCase() || '';
                const isAssigning = assigning === clientKey;
                const justAssigned = recentlyAssigned.has(clientKey);
                return (
                  <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="pl-4 py-2 font-medium">{appt.client || '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{appt.setter || '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground font-mono-tabular">{formatDate(appt.dateAdded || appt.appointmentDate)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{appt.campaignName || '—'}</td>
                    <td className="px-3 py-2">
                      {justAssigned ? (
                        <span className="inline-flex items-center gap-1 text-green-600 text-xs font-medium">
                          <Check className="w-3.5 h-3.5" /> Mapped!
                        </span>
                      ) : (
                        <select
                          disabled={isAssigning}
                          defaultValue=""
                          onChange={e => {
                            if (e.target.value) handleAssign(appt, e.target.value);
                          }}
                          className="px-2 py-1 text-xs rounded border bg-background focus:outline-none focus:ring-1 focus:ring-ring/30 w-full disabled:opacity-50"
                        >
                          <option value="" disabled>Select account…</option>
                          {accounts.map(a => (
                            <option key={a.accountName} value={a.accountName}>{a.accountName}</option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { accounts, adSpend, appointments, unmatchedAppointments, callData, settings, loading, error, configured, refresh, setSettings } = useData();
  const [assignedClients, setAssignedClients] = useState<Set<string>>(new Set());
  const [recentlyAssigned, setRecentlyAssigned] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [perfFilter, setPerfFilter] = useState<'all' | PerformanceLevel>('all');
  const [accountFilter, setAccountFilter] = useState('all');
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [selectedAccount, setSelectedAccount] = useState<AccountSummary | null>(null);

  const dateRange = useMemo(() => {
    const now = new Date();
    switch (datePreset) {
      case 'this_month':
        return { from: startOfMonth(now), to: endOfMonth(now) };
      case 'last_month': {
        const last = subMonths(now, 1);
        return { from: startOfMonth(last), to: endOfMonth(last) };
      }
      case 'last_3_months':
        return { from: startOfMonth(subMonths(now, 2)), to: endOfMonth(now) };
      case 'custom':
        return {
          from: customFrom ? new Date(customFrom) : undefined,
          to: customTo ? new Date(customTo) : undefined,
        };
      default:
        return { from: undefined, to: undefined };
    }
  }, [datePreset, customFrom, customTo]);

  const dateFilteredAccounts = useMemo(() => {
    if (!dateRange.from && !dateRange.to) return accounts;
    const from = dateRange.from;
    const to = dateRange.to;
    const filteredSpend = adSpend.filter(row => {
      const d = parseDateSafe(row.date);
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
    const filteredAppts = appointments.filter(row => {
      const d = parseDateSafe(row.dateAdded || row.appointmentDate);
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
    const filteredCalls = callData.filter(row => {
      const d = parseDateSafe(row.timestamp);
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
    return buildAccountSummaries(filteredSpend, filteredAppts, settings, filteredCalls).accounts;
  }, [accounts, adSpend, appointments, callData, settings, dateRange]);

  const filteredAccounts = useMemo(() => {
    return dateFilteredAccounts.filter(a => {
      if (search && !a.accountName.toLowerCase().includes(search.toLowerCase())) return false;
      if (accountFilter !== 'all' && a.accountName !== accountFilter) return false;
      if (perfFilter !== 'all') {
        const mappings = loadAccountMappings();
        const { program, status } = getAccountMapping(a.accountName, mappings);
        const perf = (status === 'Paused' || status === 'Churned') ? null : getPerfByProgram(program, a.cpl, a.costPerAppt, a.appointments);
        if (perf !== perfFilter) return false;
      }
      return true;
    });
  }, [dateFilteredAccounts, search, perfFilter, accountFilter]);

  const totals = useMemo(() => {
    const spend = filteredAccounts.reduce((s, a) => s + a.spend, 0);
    const leads = filteredAccounts.reduce((s, a) => s + a.leads, 0);
    const appts = filteredAccounts.reduce((s, a) => s + a.appointments, 0);
    const closed = filteredAccounts.reduce((s, a) => s + a.closed, 0);
    const revenue = filteredAccounts.reduce((s, a) => s + a.revenue, 0);
    const dials = filteredAccounts.reduce((s, a) => s + a.totalDials, 0);
    return {
      spend, leads,
      cpl: leads > 0 ? spend / leads : 0,
      appts, dials,
      costPerAppt: appts > 0 ? spend / appts : 0,
      closed, revenue,
    };
  }, [filteredAccounts]);

  const accountGroups = useMemo((): AccountGroup[] => {
    const mappings = loadAccountMappings();
    const dfy: AccountSummary[] = [];
    const dwy: AccountSummary[] = [];
    const paused: AccountSummary[] = [];
    const churned: AccountSummary[] = [];
    for (const a of filteredAccounts) {
      const { program, status } = getAccountMapping(a.accountName, mappings);
      if (status === 'Paused') { paused.push(a); continue; }
      if (status === 'Churned') { churned.push(a); continue; }
      if (program === 'Done With You') { dwy.push(a); continue; }
      dfy.push(a);
    }
    return [
      { label: 'Done For You — Active', accounts: dfy, defaultOpen: true },
      { label: 'Done With You — Active', accounts: dwy, defaultOpen: true },
      { label: 'Paused', accounts: paused, defaultOpen: false },
      { label: 'Churned', accounts: churned, defaultOpen: false },
    ];
  }, [filteredAccounts]);

  if (!configured) {
    return (
      <div className="max-w-2xl mx-auto mt-20">
        <ConfigBanner />
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full">
      <h1 className="text-xl font-bold">Dashboard</h1>

      {error && <ErrorBanner message={error} onRetry={refresh} />}

      {/* KPIs */}
      {loading ? (
        <KPISkeleton />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KPICard label="Total Spend" value={formatCurrency(totals.spend)} />
          <KPICard label="Total Leads" value={formatNumber(totals.leads)} />
          <KPICard label="Avg CPL" value={formatCurrency(totals.cpl)} />
          <KPICard label="Total Dials" value={formatNumber(totals.dials)} />
          <KPICard label="Total Appts" value={formatNumber(totals.appts)} />
          <KPICard label="Avg Cost/Appt" value={formatCurrency(totals.costPerAppt)} />
          <KPICard label="Closed Deals" value={formatNumber(totals.closed)} />
          <KPICard label="Total Revenue" value={formatCurrency(totals.revenue)} />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search accounts..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 text-sm rounded-lg border bg-card focus:outline-none focus:ring-2 focus:ring-ring/20 w-56"
          />
        </div>
        <select
          value={accountFilter}
          onChange={e => setAccountFilter(e.target.value)}
          className="px-3 py-2 text-sm rounded-lg border bg-card focus:outline-none"
        >
          <option value="all">All Accounts</option>
          {accounts.map(a => (
            <option key={a.accountName} value={a.accountName}>{a.accountName}</option>
          ))}
        </select>
        <select
          value={perfFilter}
          onChange={e => setPerfFilter(e.target.value as any)}
          className="px-3 py-2 text-sm rounded-lg border bg-card focus:outline-none"
        >
          <option value="all">All Performance</option>
          <option value="good">Good</option>
          <option value="fair">Fair</option>
          <option value="poor">Poor</option>
        </select>
        <select
          value={datePreset}
          onChange={e => setDatePreset(e.target.value as DatePreset)}
          className="px-3 py-2 text-sm rounded-lg border bg-card focus:outline-none"
        >
          <option value="all">All Time</option>
          <option value="this_month">This Month</option>
          <option value="last_month">Last Month</option>
          <option value="last_3_months">Last 3 Months</option>
          <option value="custom">Custom Range</option>
        </select>
        {datePreset === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border bg-card focus:outline-none"
            />
            <span className="text-muted-foreground text-sm">to</span>
            <input
              type="date"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border bg-card focus:outline-none"
            />
          </div>
        )}
      </div>

      {/* Unmatched Appointments */}
      {unmatchedAppointments.length > 0 && (
        <UnmatchedSection
          appointments={unmatchedAppointments}
          accounts={accounts}
          settings={settings}
          setSettings={setSettings}
          refresh={refresh}
          assignedClients={assignedClients}
          setAssignedClients={setAssignedClients}
          recentlyAssigned={recentlyAssigned}
          setRecentlyAssigned={setRecentlyAssigned}
        />
      )}

      {/* Account Table */}
      {loading ? (
        <TableSkeleton rows={5} />
      ) : filteredAccounts.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-y-auto max-h-[70vh]">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
              <colgroup>
                <col />
                <col style={{ width: '100px' }} />
                <col style={{ width: '65px' }} />
                <col style={{ width: '85px' }} />
                <col style={{ width: '65px' }} />
                <col style={{ width: '65px' }} />
                <col style={{ width: '95px' }} />
                <col style={{ width: '60px' }} />
                <col style={{ width: '100px' }} />
              </colgroup>
              <thead className="sticky top-0 z-20 bg-background shadow-sm">
                <tr className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wide border-b border-border" style={{ height: '40px' }}>
                  <th className="text-left pl-3 align-middle">Account</th>
                  <th className="text-right px-3 align-middle">Spend</th>
                  <th className="text-right px-3 align-middle">Leads</th>
                  <th className="text-right px-3 align-middle">CPL</th>
                  <th className="text-right px-3 align-middle">Dials</th>
                  <th className="text-right px-3 align-middle">Appts</th>
                  <th className="text-right px-3 align-middle">Cost/Appt</th>
                  <th className="text-right px-3 align-middle">Closed</th>
                  <th className="text-right px-3 align-middle">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {accountGroups.map(g => (
                  <AccountSection key={g.label} group={g} onSelect={setSelectedAccount} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Account Detail Panel */}
      {selectedAccount && <AccountDetailPanel account={selectedAccount} onClose={() => setSelectedAccount(null)} />}
    </div>
  );
}
