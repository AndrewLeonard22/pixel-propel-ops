import { useState, useMemo, useCallback } from 'react';
import { useData } from '@/hooks/useData';
import { ConfigBanner, ErrorBanner, HonestNumbersBanner } from '@/components/common/Banners';
import { KPISkeleton, TableSkeleton } from '@/components/common/LoadingSkeleton';
import EmptyState from '@/components/common/EmptyState';
import PerformanceBadge from '@/components/common/PerformanceBadge';
import { formatCurrency, formatNumber, formatPercent, formatDate, buildAccountSummaries, metricIsMeaningful } from '@/lib/dataService';
import { saveSettings, saveAccountMappings, loadAccountMappings, getAccountMapping } from '@/lib/config';
import { ChevronDown, ChevronRight, Search, AlertTriangle, Check, X } from 'lucide-react';
import type { AccountSummary, CampaignSummary, PerformanceLevel, AppointmentRow, CallRow, AccountMapping, AppSettings } from '@/lib/types';
import DateRangePicker, { type DateRange, ALL_TIME } from '@/components/DateRangePicker';
import { hasUsableData } from '@/lib/sourceStatus';

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
  // ISO date-only strings (YYYY-MM-DD) must be forced to local time — without
  // the time suffix, JS parses them as UTC midnight, which shifts the date back
  // by the local UTC offset (e.g. one full day behind in US timezones).
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return new Date(dateStr + 'T00:00:00');
  const normalized = dateStr.replace(/(\d+:\d+)(am|pm)/i, (_, time, ampm) => `${time} ${ampm.toUpperCase()}`);
  let d = new Date(normalized);
  if (!isNaN(d.getTime())) return d;
  const dateOnly = dateStr.replace(/\s+\d+:\d+\s*(am|pm)?\s*$/i, '').trim();
  if (dateOnly && dateOnly !== dateStr) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return new Date(dateOnly + 'T00:00:00');
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

/**
 * The only honest render for a source that did not answer. A zero here is a CLAIM — that
 * the account booked nothing, closed nothing, earned nothing — and a dead feed cannot
 * support it. @bird measured the tiles printing this while the table beside them printed
 * $0.00 from the same dead source.
 *
 * ⚠️ ALWAYS COMPARE `=== false`, NEVER `!flag`. The flags are OPTIONAL: Targets.tsx and
 * TeamPerformance.tsx build summaries without source outcomes, so their rows carry
 * `undefined`, which means KNOWN. `!undefined` is true and would blank two working pages —
 * the mirror of the bug this fixes.
 */
const UNKNOWN = '—';

/**
 * THE THREE RATIO BADGES, KEYED ON THE FLAG AND THE DENOMINATOR — NEVER ON THE VALUE.
 *
 * @raccoon (RACC-030/031) measured the two failure shapes that were sitting side by side
 * in this file with OPPOSITE policies:
 *
 *   CostPerApptBadge   value === 0 -> grey, but PRINTS $0.00       fabricates a number  🔴
 *   LeadToApptBadge    value === 0 -> "—"                          fails safe, still wrong
 *
 * Both were inferring "do we know this" FROM THE VALUE. The second only looks correct: a
 * genuine 0% lead-to-appointment rate — a real and bad result a buyer needs to see — was
 * being rendered as if we had no idea. Copying it would have fixed one badge and preserved
 * the class in the other.
 *
 * ⚠️ AND IT GOT WORSE THE MOMENT I MADE "—" MEAN "the source did not answer": the same
 * glyph then carried two unrelated meanings on one row, so a reader could not tell a dead
 * feed from a zero. The value is no longer consulted for knownness anywhere.
 */
export function RatioBadge({ known, denominator, color, children }: {
  known: boolean | undefined;
  denominator: number;
  color: string;
  children: React.ReactNode;
}) {
  if (!metricIsMeaningful(known, denominator)) {
    return <span className="font-mono-tabular text-muted-foreground">{UNKNOWN}</span>;
  }
  return <span className={`font-mono-tabular font-semibold ${color}`}>{children}</span>;
}

export function CPLBadge({ value, leads, known }: { value: number; leads: number; known?: boolean }) {
  const color = value < 35 ? 'text-success' : value <= 55 ? 'text-warning' : 'text-destructive';
  return <RatioBadge known={known} denominator={leads} color={color}>{formatCurrency(value)}</RatioBadge>;
}

export function CostPerApptBadge({ value, appointments, known }: { value: number; appointments: number; known?: boolean }) {
  const color = value < 180 ? 'text-success' : value <= 240 ? 'text-warning' : 'text-destructive';
  return <RatioBadge known={known} denominator={appointments} color={color}>{formatCurrency(value)}</RatioBadge>;
}

export function LeadToApptBadge({ value, leads, known }: { value: number; leads: number; known?: boolean }) {
  // A true 0% now renders as 0% — it is a real result, not an absence.
  const color = value >= 10 ? 'text-success' : value >= 5 ? 'text-warning' : 'text-destructive';
  return <RatioBadge known={known} denominator={leads} color={color}>{formatPercent(value)}</RatioBadge>;
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

export function AccountRow({ account, onSelect }: { account: AccountSummary; onSelect: (account: AccountSummary) => void }) {
  const mappings = loadAccountMappings();
  const { program, status } = getAccountMapping(account.accountName, mappings);
  // A coloured performance border is a verdict. Two of its three inputs come from sources
  // that may not have answered, so a dead feed would paint every account "poor" — a claim
  // about the buyer's work, drawn from nothing.
  const perfKnown = account.spendKnown !== false && account.apptsKnown !== false;
  const perf = (status === 'Paused' || status === 'Churned' || !perfKnown)
    ? null
    : getPerfByProgram(program, account.cpl, account.costPerAppt, account.appointments);

  return (
    <tr
      onClick={() => onSelect(account)}
      className="cursor-pointer hover:bg-accent/30 transition-colors"
      style={perf ? { borderLeft: `3px solid hsl(var(--${perf === 'good' ? 'success' : perf === 'fair' ? 'warning' : 'destructive'}))` } : undefined}
    >
      <td className="py-3 px-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm truncate">{account.accountName}</span>
          <span className="text-xs text-muted-foreground">{account.campaigns.length} campaigns</span>
          {account.mediaBuyer && <span className="text-xs text-muted-foreground">· {account.mediaBuyer}</span>}
        </div>
      </td>
      <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap">{account.spendKnown === false ? UNKNOWN : formatCurrency(account.spend)}</td>
      <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap hidden md:table-cell">{account.spendKnown === false ? UNKNOWN : formatNumber(account.leads)}</td>
      <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap hidden md:table-cell"><CPLBadge value={account.cpl} leads={account.leads} known={account.spendKnown} /></td>
      <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap hidden md:table-cell">{account.callsKnown === false ? UNKNOWN : formatNumber(account.totalDials)}</td>
      <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap">{account.apptsKnown === false ? UNKNOWN : formatNumber(account.appointments)}</td>
      <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap hidden md:table-cell">
        {/* Two sources: leads come from Windsor, appointments from Airtable. Either one
            dead makes the ratio unknowable, not zero. */}
        <LeadToApptBadge value={account.leadPercent} leads={account.leads} known={account.spendKnown === false || account.apptsKnown === false ? false : undefined} />
      </td>
      <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap"><CostPerApptBadge value={account.costPerAppt} appointments={account.appointments} known={account.spendKnown === false || account.apptsKnown === false ? false : undefined} /></td>
      <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap hidden md:table-cell">{account.apptsKnown === false ? UNKNOWN : formatNumber(account.closed)}</td>
      <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap hidden md:table-cell">{account.apptsKnown === false ? UNKNOWN : formatCurrency(account.revenue)}</td>
    </tr>
  );
}

// === Account Detail Panel (slide-over) ===



function AccountDetailPanel({ account, settings, onClose, onToggleExclude }: {
  account: AccountSummary;
  settings: AppSettings;
  onClose: () => void;
  onToggleExclude: (campaignId: string) => Promise<void>;
}) {
  const mappings = loadAccountMappings();
  const { program } = getAccountMapping(account.accountName, mappings);

  const showedCount = account.appointmentList.filter(a => {
    const s = (a.showStatus || '').toLowerCase();
    return s === 'showed' || s === 'show';
  }).length;

  const dialsPerLead = account.leads > 0 ? (account.totalDials / account.leads).toFixed(1) : '0';
  const showRate = account.appointmentList.length > 0 ? (showedCount / account.appointmentList.length) * 100 : 0;
  const closeRate = account.appointmentList.length > 0 ? (account.closed / account.appointmentList.length) * 100 : 0;

  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(new Set());
  const toggleCampaign = (id: string) => setExpandedCampaigns(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const [expandedAdSets, setExpandedAdSets] = useState<Set<string>>(new Set());
  const toggleAdSet = (id: string) => setExpandedAdSets(prev => {
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
        className="relative w-full sm:max-w-2xl bg-card border-l shadow-xl overflow-y-auto animate-in slide-in-from-right duration-300"
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="card-elevated p-3">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Spend</p>
              <p className="text-lg font-bold font-mono-tabular text-foreground">{formatCurrency(account.spend)}</p>
            </div>
            <div className="card-elevated p-3">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">CPL</p>
              <p className="text-lg font-bold font-mono-tabular"><CPLBadge value={account.cpl} leads={account.leads} known={account.spendKnown} /></p>
            </div>
            <div className="card-elevated p-3">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Cost/Appt</p>
              <p className="text-lg font-bold font-mono-tabular"><CostPerApptBadge value={account.costPerAppt} appointments={account.appointments} known={account.spendKnown === false || account.apptsKnown === false ? false : undefined} /></p>
            </div>
            <div className="card-elevated p-3">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Revenue</p>
              <p className="text-lg font-bold font-mono-tabular text-foreground">{formatCurrency(account.revenue)}</p>
            </div>
          </div>

          {/* Dial Activity */}
          {account.totalDials > 0 && (
            <div className="border border-border rounded-lg px-4 py-3 flex items-center gap-5">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-violet-500" />
                <span className="text-xs font-semibold text-foreground">Dial activity</span>
              </div>
              <div className="flex gap-4 text-sm font-mono-tabular">
                <span><span className="font-semibold text-foreground">{formatNumber(account.totalDials)}</span> <span className="text-[11px] text-muted-foreground font-sans">dials</span></span>
                <span><span className="font-semibold text-foreground">{dialsPerLeadFunnel}</span> <span className="text-[11px] text-muted-foreground font-sans">per lead</span></span>
                <span><span className="font-semibold text-foreground">{dialBookingRate}%</span> <span className="text-[11px] text-muted-foreground font-sans">booking rate</span></span>
              </div>
            </div>
          )}

          {/* Section 2 — Conversion Funnel */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">Conversion funnel</h3>
            {account.leads === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No lead data</p>
            ) : (
              <div className="flex flex-col gap-1">
                {/* Leads */}
                <div className="flex items-center gap-2.5">
                  <span className="w-[90px] text-xs text-muted-foreground text-right">Leads</span>
                  <div className="flex-1 h-6 rounded-md bg-muted/30 overflow-hidden">
                    <div className="h-full rounded-md bg-indigo-400" style={{ width: '100%' }} />
                  </div>
                  <span className="w-12 text-sm font-mono-tabular font-semibold text-foreground text-right">{formatNumber(account.leads)}</span>
                </div>
                {/* Lead to Appt conversion */}
                <div className="flex items-center gap-1.5 ml-[100px]">
                  <span className="text-[13px] font-semibold text-foreground">{formatPercent(account.leadPercent)}</span>
                  <span className="text-[11px] text-muted-foreground">converted to appointments</span>
                </div>
                {/* Appointments */}
                <div className="flex items-center gap-2.5">
                  <span className="w-[90px] text-xs text-muted-foreground text-right">Appointments</span>
                  <div className="flex-1 h-6 rounded-md bg-muted/30 overflow-hidden">
                    <div className="h-full rounded-md bg-amber-400" style={{ width: `${Math.max(account.leads > 0 ? (account.appointments / account.leads) * 100 : 0, account.appointments > 0 ? 3 : 0)}%` }} />
                  </div>
                  <span className="w-12 text-sm font-mono-tabular font-semibold text-foreground text-right">{formatNumber(account.appointments)}</span>
                </div>
                {/* Show rate */}
                <div className="flex items-center gap-1.5 ml-[100px]">
                  <span className="text-[13px] font-semibold text-foreground">{formatPercent(account.appointments > 0 ? (showedCount / account.appointments) * 100 : 0)}</span>
                  <span className="text-[11px] text-muted-foreground">showed up</span>
                </div>
                {/* Showed */}
                <div className="flex items-center gap-2.5">
                  <span className="w-[90px] text-xs text-muted-foreground text-right">Showed</span>
                  <div className="flex-1 h-6 rounded-md bg-muted/30 overflow-hidden">
                    <div className="h-full rounded-md bg-emerald-400" style={{ width: `${Math.max(account.leads > 0 ? (showedCount / account.leads) * 100 : 0, showedCount > 0 ? 3 : 0)}%` }} />
                  </div>
                  <span className="w-12 text-sm font-mono-tabular font-semibold text-foreground text-right">{formatNumber(showedCount)}</span>
                </div>
                {/* Close rate */}
                <div className="flex items-center gap-1.5 ml-[100px]">
                  <span className="text-[13px] font-semibold text-foreground">{formatPercent(showedCount > 0 ? (account.closed / showedCount) * 100 : 0)}</span>
                  <span className="text-[11px] text-muted-foreground">closed won</span>
                </div>
                {/* Closed */}
                <div className="flex items-center gap-2.5">
                  <span className="w-[90px] text-xs text-muted-foreground text-right">Closed</span>
                  <div className="flex-1 h-6 rounded-md bg-muted/30 overflow-hidden">
                    <div className="h-full rounded-md bg-emerald-600" style={{ width: `${Math.max(account.leads > 0 ? (account.closed / account.leads) * 100 : 0, account.closed > 0 ? 3 : 0)}%` }} />
                  </div>
                  <span className="w-12 text-sm font-mono-tabular font-semibold text-foreground text-right">{formatNumber(account.closed)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Section 3 — Campaign Breakdown */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">Campaigns ({account.campaigns.length})</h3>
            <div className="space-y-2">
              {account.campaigns.map(c => {
                const isExcluded = (settings.excludedCampaigns || []).includes(c.campaignId);
                const cPerf = isExcluded ? null : getPerfByProgram(program, c.cpl, c.costPerAppt, c.appointments);
                const isExpanded = expandedCampaigns.has(c.campaignId);
                return (
                  <div key={c.campaignId} className={`card-elevated overflow-hidden${isExcluded ? ' opacity-60' : ''}`}>
                    <div
                      className="p-3 cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => toggleCampaign(c.campaignId)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-start gap-2 flex-1 min-w-0">
                          {isExpanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" />}
                          <span className="text-sm font-medium leading-snug">{c.campaignName}</span>
                          {isExcluded && <span className="text-[10px] font-medium text-muted-foreground px-1.5 py-0.5 rounded bg-muted shrink-0 mt-0.5">Excluded</span>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                          {!isExcluded && cPerf && <PerformanceBadge level={cPerf} />}
                          <input
                            type="checkbox"
                            checked={!isExcluded}
                            onChange={() => onToggleExclude(c.campaignId)}
                            className="w-3.5 h-3.5 accent-primary cursor-pointer"
                            title={isExcluded ? 'Include in performance metrics' : 'Exclude from performance metrics'}
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-3 mt-1.5 ml-5">
                        <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">SPEND</span><span className="text-xs font-mono-tabular font-semibold">{formatCurrency(c.spend)}</span></span>
                        <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">LEADS</span><span className="text-xs font-mono-tabular font-semibold">{c.leads}</span></span>
                        <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">CPL</span><span className="text-xs font-mono-tabular font-semibold"><CPLBadge value={c.cpl} leads={c.leads} known={account.spendKnown} /></span></span>
                        <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">APPTS</span><span className="text-xs font-mono-tabular font-semibold">{c.appointments}</span></span>
                        <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">CPA</span><span className="text-xs font-mono-tabular font-semibold"><CostPerApptBadge value={c.costPerAppt} appointments={c.appointments} known={account.spendKnown === false || account.apptsKnown === false ? false : undefined} /></span></span>
                      </div>
                    </div>
                    {isExpanded && c.adSets && c.adSets.length > 0 && (
                      <div className="border-t border-border">
                        {c.adSets.map((as, idx) => {
                          const asPerf = getPerfByProgram(program, as.cpl, as.costPerAppt, as.appointments);
                          const asKey = as.adSetId || String(idx);
                          const isAdSetExpanded = expandedAdSets.has(asKey);
                          return (
                            <div key={asKey} className={idx > 0 ? 'border-t border-border/50' : ''}>
                              <div
                                className="pl-4 pr-3 py-2 cursor-pointer hover:bg-muted/20 transition-colors"
                                onClick={() => toggleAdSet(asKey)}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  {isAdSetExpanded ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
                                  <span className="text-xs text-foreground truncate">{as.adSetName}</span>
                                  {asPerf && <PerformanceBadge level={asPerf} />}
                                  <span className="text-[10px] text-muted-foreground">{as.adCount} ads</span>
                                </div>
                                <div className="flex flex-wrap gap-3 mt-1 pl-5">
                                  <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">SPEND</span><span className="text-[11px] font-mono-tabular font-semibold">{formatCurrency(as.spend)}</span></span>
                                  <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">LEADS</span><span className="text-[11px] font-mono-tabular font-semibold">{as.leads}</span></span>
                                  <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">CPL</span><span className="text-[11px] font-mono-tabular font-semibold"><CPLBadge value={as.cpl} leads={as.leads} known={account.spendKnown} /></span></span>
                                  <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">APPTS</span><span className="text-[11px] font-mono-tabular font-semibold">{as.appointments}</span></span>
                                  <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">CPA</span><span className="text-[11px] font-mono-tabular font-semibold"><CostPerApptBadge value={as.costPerAppt} appointments={as.appointments} known={account.spendKnown === false || account.apptsKnown === false ? false : undefined} /></span></span>
                                </div>
                              </div>
                              {isAdSetExpanded && as.ads && as.ads.length > 0 && (
                                <div className="border-t border-border/40 bg-muted/10">
                                  {as.ads.map((ad, adIdx) => (
                                    <div key={ad.adId || adIdx} className={`pl-10 pr-3 py-2 ${adIdx > 0 ? 'border-t border-border/30' : ''}`}>
                                      <div className="flex items-center gap-1.5 min-w-0 mb-1">
                                        <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
                                        <span className="text-[11px] text-foreground truncate">{ad.adName || 'Unnamed Ad'}</span>
                                      </div>
                                      <div className="flex flex-wrap gap-3 pl-3">
                                        <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">SPEND</span><span className="text-[10px] font-mono-tabular font-semibold">{formatCurrency(ad.spend)}</span></span>
                                        <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">LEADS</span><span className="text-[10px] font-mono-tabular font-semibold">{ad.leads}</span></span>
                                        <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">CPL</span><span className="text-[10px] font-mono-tabular font-semibold"><CPLBadge value={ad.cpl} leads={ad.leads} known={account.spendKnown} /></span></span>
                                        <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">APPTS</span><span className="text-[10px] font-mono-tabular font-semibold">{ad.appointments}</span></span>
                                        <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">CPA</span><span className="text-[10px] font-mono-tabular font-semibold"><CostPerApptBadge value={ad.costPerAppt} appointments={ad.appointments} known={account.spendKnown === false || account.apptsKnown === false ? false : undefined} /></span></span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
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
                      <th className="text-left px-2 align-middle">Setter</th>
                      <th className="text-left px-2 align-middle">Date</th>
                      <th className="text-left px-2 align-middle">Show Status</th>
                      <th className="text-left px-2 align-middle">Lead Valid</th>
                      <th className="text-right pr-2 align-middle">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentAppts.map((appt, i) => (
                      <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="px-2 py-1.5 text-foreground">{appt.setter || '—'}</td>
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
  const { accounts, adSpend, appointments, unmatchedAppointments, callData, settings, loading, error, configured, settingsLoaded, sources, refresh, setSettings, honestNumbers } = useData();
  const [assignedClients, setAssignedClients] = useState<Set<string>>(new Set());
  const [recentlyAssigned, setRecentlyAssigned] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [perfFilter, setPerfFilter] = useState<'all' | PerformanceLevel>('all');
  const [accountFilter, setAccountFilter] = useState('all');
  const [dateRange, setDateRange] = useState<DateRange>(ALL_TIME);
  const [selectedAccountName, setSelectedAccountName] = useState<string | null>(null);

  const dateFilteredAccounts = useMemo(() => {
    const { from, to } = dateRange;
    if (!from && !to) return accounts;
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
    const mappings = loadAccountMappings();
    
    const activeAccounts = filteredAccounts.filter(a => {
      const { status } = getAccountMapping(a.accountName, mappings);
      return status === 'Active';
    });
    
    const dfyAccounts = activeAccounts.filter(a => {
      const { program } = getAccountMapping(a.accountName, mappings);
      return program !== 'Done With You';
    });
    
    const spend = activeAccounts.reduce((s, a) => s + a.spend, 0);
    const leads = activeAccounts.reduce((s, a) => s + a.leads, 0);
    const perfSpend = activeAccounts.reduce((s, a) => s + a.performanceSpend, 0);
    const perfLeads = activeAccounts.reduce((s, a) => s + a.performanceLeads, 0);
    const appts = activeAccounts.reduce((s, a) => s + a.appointments, 0);
    const closed = activeAccounts.reduce((s, a) => s + a.closed, 0);
    const revenue = activeAccounts.reduce((s, a) => s + a.revenue, 0);
    const dials = activeAccounts.reduce((s, a) => s + a.totalDials, 0);

    const dfyPerfSpend = dfyAccounts.reduce((s, a) => s + a.performanceSpend, 0);
    const dfyAppts = dfyAccounts.reduce((s, a) => s + a.appointments, 0);

    return {
      spend, leads,
      cpl: perfLeads > 0 ? perfSpend / perfLeads : 0,
      appts, dials,
      leadToApptPct: perfLeads > 0 ? (appts / perfLeads) * 100 : 0,
      costPerAppt: dfyAppts > 0 ? dfyPerfSpend / dfyAppts : 0,
      closed, revenue,
    };
  }, [filteredAccounts]);

  // Derive selectedAccount from name so it auto-updates after refresh
  const selectedAccount = useMemo(
    () => selectedAccountName ? dateFilteredAccounts.find(a => a.accountName === selectedAccountName) ?? null : null,
    [selectedAccountName, dateFilteredAccounts],
  );

  const handleToggleExclude = useCallback(async (campaignId: string) => {
    const current = settings.excludedCampaigns || [];
    const updated = current.includes(campaignId)
      ? current.filter(id => id !== campaignId)
      : [...current, campaignId];
    const updatedSettings = { ...settings, excludedCampaigns: updated };
    setSettings(updatedSettings);
    await saveSettings(updatedSettings);
    await refresh(updatedSettings);
  }, [settings, setSettings, refresh]);

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

  // Whether a KPI may print a number at all. `hasUsableData` is true for valid and for
  // stale (real data, just older) — it is false for failed and not-configured, where the
  // only honest render is an em dash.
  const spendOk = hasUsableData(sources.windsor.state);
  const apptsOk = hasUsableData(sources.airtable.state);
  const callsOk = hasUsableData(sources.callCenter.state);

  // "Not configured" is a claim about the user's setup. Until the settings have come back
  // from the database we have not looked, and on a cold browser (new device, cleared
  // storage, private window) the local cache is empty, so this used to assert a definite
  // negative for the length of a network round trip.
  if (!settingsLoaded) {
    return (
      <div className="space-y-6 w-full">
        <h1 className="text-xl font-bold">Dashboard</h1>
        <KPISkeleton />
      </div>
    );
  }

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

      {/* Above every number it describes. The exclusion loss inflates every CPL and
          cost-per-appointment on this page, and until this rendered, nothing said so. */}
      <HonestNumbersBanner messages={honestNumbers.messages} />

      {/* WRAPPED, not onRetry={refresh}: React hands a bare handler reference its click
          event as the first argument, which refresh read as an override settings object —
          it then failed its own isConfigured guard and returned without starting anything.
          The Retry button did nothing at all. */}
      {error && <ErrorBanner message={error} onRetry={() => refresh()} />}

      {/* KPIs — a number is only printed when the source behind it actually delivered.
          A dead source reads "—", never "$0.00". Andrew's question is "is this zero real,
          or did something fail", and on this row it used to be unanswerable for 8 of 9. */}
      {loading ? (
        <KPISkeleton />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KPICard label="Total Spend" value={spendOk ? formatCurrency(totals.spend) : '—'} />
          <KPICard label="Total Leads" value={spendOk ? formatNumber(totals.leads) : '—'} />
          <KPICard label="Avg CPL" value={spendOk && totals.cpl > 0 ? formatCurrency(totals.cpl) : '—'} />
          <KPICard label="Total Dials" value={callsOk ? formatNumber(totals.dials) : '—'} />
          <KPICard label="Total Appts" value={apptsOk ? formatNumber(totals.appts) : '—'} />
          <KPICard label="Lead → Appt %" value={spendOk && apptsOk && totals.leadToApptPct > 0 ? formatPercent(totals.leadToApptPct) : '—'} mono={false} />
          <KPICard label="Avg Cost/Appt" value={spendOk && apptsOk && totals.costPerAppt > 0 ? formatCurrency(totals.costPerAppt) : '—'} />
          <KPICard label="Closed Deals" value={apptsOk ? formatNumber(totals.closed) : '—'} />
          <KPICard label="Total Revenue" value={apptsOk ? formatCurrency(totals.revenue) : '—'} />
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
        <DateRangePicker value={dateRange} onChange={setDateRange} includeAllTime />
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
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-20 bg-background shadow-sm">
                <tr className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wide border-b border-border" style={{ height: '40px' }}>
                  <th className="text-left px-3 align-middle">Account</th>
                  <th className="text-right px-3 align-middle">Spend</th>
                  <th className="text-right px-3 align-middle hidden md:table-cell">Leads</th>
                  <th className="text-right px-3 align-middle hidden md:table-cell">CPL</th>
                  <th className="text-right px-3 align-middle hidden md:table-cell">Dials</th>
                  <th className="text-right px-3 align-middle">Appts</th>
                  <th className="text-right px-3 align-middle hidden md:table-cell">L→A %</th>
                  <th className="text-right px-3 align-middle">Cost/Appt</th>
                  <th className="text-right px-3 align-middle hidden md:table-cell">Closed</th>
                  <th className="text-right px-3 align-middle hidden md:table-cell">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {accountGroups.map(g => (
                  <AccountSection key={g.label} group={g} onSelect={a => setSelectedAccountName(a.accountName)} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Account Detail Panel */}
      {selectedAccount && (
        <AccountDetailPanel
          account={selectedAccount}
          settings={settings}
          onClose={() => setSelectedAccountName(null)}
          onToggleExclude={handleToggleExclude}
        />
      )}
    </div>
  );
}
