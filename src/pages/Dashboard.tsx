import { useState, useMemo, useCallback } from 'react';
import { useData } from '@/hooks/useData';
import { ConfigBanner, ErrorBanner } from '@/components/common/Banners';
import { KPISkeleton, TableSkeleton } from '@/components/common/LoadingSkeleton';
import EmptyState from '@/components/common/EmptyState';
import PerformanceBadge from '@/components/common/PerformanceBadge';
import { formatCurrency, formatNumber, formatPercent, formatDate, buildAccountSummaries } from '@/lib/dataService';
import { saveSettings, saveAccountMappings } from '@/lib/config';
import { ChevronDown, ChevronRight, Search, AlertTriangle, Check } from 'lucide-react';
import type { AccountSummary, CampaignSummary, PerformanceLevel } from '@/lib/types';
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

function AccountSection({ group }: { group: AccountGroup }) {
  const [open, setOpen] = useState(group.defaultOpen);
  if (group.accounts.length === 0) return null;

  return (
    <>
      <tr>
        <td colSpan={10} className="pt-4 pb-2">
          <button
            onClick={() => setOpen(!open)}
            className="flex items-center gap-2"
          >
            <span className="text-muted-foreground">
              {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</span>
            <span className="text-xs px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground font-medium">{group.accounts.length}</span>
          </button>
        </td>
      </tr>
      {open && group.accounts.map(a => (
        <AccountRow key={a.accountName} account={a} />
      ))}
    </>
  );
}

function parseDateSafe(dateStr: string): Date | null {
  if (!dateStr) return null;
  
  // Normalize Airtable cellFormat=string times: "3/18/2026 10:05am" → "3/18/2026 10:05 AM"
  // JS Date needs space before AM/PM in some engines
  const normalized = dateStr.replace(/(\d+:\d+)(am|pm)/i, (_, time, ampm) => `${time} ${ampm.toUpperCase()}`);
  
  let d = new Date(normalized);
  if (!isNaN(d.getTime())) return d;
  
  // Fallback: strip time portion entirely for date-only comparison
  // Matches patterns like " 8:30 AM", " 2:00pm", " 10:05am"
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
  const color = value < 25 ? 'text-success' : value <= 50 ? 'text-warning' : 'text-destructive';
  return <span className={`font-mono-tabular font-semibold ${color}`}>{formatCurrency(value)}</span>;
}

function getPerfByProgram(program: string, cpl: number, costPerAppt: number, appointments: number): PerformanceLevel | null {
  if (program === 'Done With You') {
    if (cpl === 0) return null;
    if (cpl < 30) return 'good';
    if (cpl <= 50) return 'fair';
    return 'poor';
  }
  // Done For You (default)
  if (costPerAppt === 0 || appointments === 0) return null;
  if (costPerAppt < 200) return 'good';
  if (costPerAppt <= 350) return 'fair';
  return 'poor';
}

function AccountRow({ account }: { account: AccountSummary }) {
  const [expanded, setExpanded] = useState(false);
  const mappings = loadAccountMappings();
  const { program, status } = getAccountMapping(account.accountName, mappings);
  const perf = (status === 'Paused' || status === 'Churned') ? null : getPerfByProgram(program, account.cpl, account.costPerAppt, account.appointments);

  return (
    <>
      <tr
        onClick={() => setExpanded(!expanded)}
        className="cursor-pointer hover:bg-accent/30 transition-colors"
      >
        <td className="px-2 py-3 text-center text-muted-foreground">
          {expanded ? <ChevronDown className="w-4 h-4 inline" /> : <ChevronRight className="w-4 h-4 inline" />}
        </td>
        <td className="py-3 pl-2 pr-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm truncate">{account.accountName}</span>
            <span className="text-xs text-muted-foreground">{account.campaigns.length} campaigns</span>
            {account.mediaBuyer && <span className="text-xs text-muted-foreground">· {account.mediaBuyer}</span>}
            {perf ? <PerformanceBadge level={perf} /> : null}
          </div>
        </td>
        <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap">{formatCurrency(account.spend)}</td>
        <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap">{formatNumber(account.leads)}</td>
        <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap"><CPLBadge value={account.cpl} /></td>
        <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap">{formatNumber(account.appointments)}</td>
        <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap">{formatPercent(account.leadPercent)}</td>
        <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap">{formatCurrency(account.costPerAppt)}</td>
        <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap">{formatNumber(account.closed)}</td>
        <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap">{formatCurrency(account.revenue)}</td>
      </tr>
      {expanded && (
        <>
          <tr className="bg-muted/30 border-t border-border/40">
            <td className="w-10" />
            <td className="py-1.5 pl-6 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Campaign</td>
            <td className="py-1.5 px-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Spend</td>
            <td className="py-1.5 px-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Leads</td>
            <td className="py-1.5 px-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">CPL</td>
            <td className="py-1.5 px-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Appts</td>
            <td className="py-1.5 px-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Lead %</td>
            <td className="py-1.5 px-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Cost/A</td>
            <td className="py-1.5 px-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Closed</td>
            <td className="py-1.5 px-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Revenue</td>
          </tr>
          {account.campaigns.map(c => (
            <CampaignRow key={c.campaignId} campaign={c} program={program} />
          ))}
        </>
      )}
    </>
  );
}

function CampaignRow({ campaign, program }: { campaign: CampaignSummary; program: string }) {
  const [expanded, setExpanded] = useState(false);
  const perf = getPerfByProgram(program, campaign.cpl, campaign.costPerAppt, campaign.appointments);

  return (
    <>
      <tr
        onClick={() => setExpanded(!expanded)}
        className="cursor-pointer hover:bg-accent/30 transition-colors bg-accent/20 border-t"
      >
        <td className="px-2 py-2.5 text-center text-muted-foreground">
          {expanded ? <ChevronDown className="w-3.5 h-3.5 inline" /> : <ChevronRight className="w-3.5 h-3.5 inline" />}
        </td>
        <td className="py-2.5 pl-6 pr-3">
          <div className="flex items-center gap-2">
            <span className="text-sm truncate">{campaign.campaignName}</span>
            {perf ? <PerformanceBadge level={perf} /> : null}
            <span className="text-xs text-muted-foreground">{campaign.adSets.length} ad sets</span>
          </div>
        </td>
        <td className="text-right font-mono-tabular text-xs py-2.5 px-3 whitespace-nowrap">{formatCurrency(campaign.spend)}</td>
        <td className="text-right font-mono-tabular text-xs py-2.5 px-3 whitespace-nowrap">{formatNumber(campaign.leads)}</td>
        <td className="text-right font-mono-tabular text-xs py-2.5 px-3 whitespace-nowrap"><CPLBadge value={campaign.cpl} /></td>
        <td className="text-right font-mono-tabular text-xs py-2.5 px-3 whitespace-nowrap">{formatNumber(campaign.appointments)}</td>
        <td className="text-right font-mono-tabular text-xs py-2.5 px-3 whitespace-nowrap">{formatPercent(campaign.leadPercent)}</td>
        <td className="text-right font-mono-tabular text-xs py-2.5 px-3 whitespace-nowrap">{formatCurrency(campaign.costPerAppt)}</td>
        <td className="text-right font-mono-tabular text-xs py-2.5 px-3 whitespace-nowrap">{formatNumber(campaign.closed)}</td>
        <td className="text-right font-mono-tabular text-xs py-2.5 px-3 whitespace-nowrap">{formatCurrency(campaign.revenue)}</td>
      </tr>
      {expanded && campaign.adSets.map(as => {
        const asPerf = getPerfByProgram(program, as.cpl, as.costPerAppt, as.appointments);
        return (
        <tr key={as.adSetId} className="bg-accent/10 border-t border-border/50">
          <td />
          <td className="py-2 pl-10 pr-3">
            <div className="flex items-center gap-2">
              <span className="text-xs truncate text-muted-foreground">{as.adSetName}</span>
              {asPerf ? <PerformanceBadge level={asPerf} /> : null}
              <span className="text-xs text-muted-foreground">{as.adCount} ads</span>
            </div>
          </td>
          <td className="text-right font-mono-tabular text-xs py-2 px-3 whitespace-nowrap">{formatCurrency(as.spend)}</td>
          <td className="text-right font-mono-tabular text-xs py-2 px-3 whitespace-nowrap">{formatNumber(as.leads)}</td>
          <td className="text-right font-mono-tabular text-xs py-2 px-3 whitespace-nowrap"><CPLBadge value={as.cpl} /></td>
          <td className="text-right font-mono-tabular text-xs py-2 px-3 whitespace-nowrap">{formatNumber(as.appointments)}</td>
          <td className="text-right font-mono-tabular text-xs py-2 px-3 whitespace-nowrap">{formatPercent(as.leadPercent)}</td>
          <td className="text-right font-mono-tabular text-xs py-2 px-3 whitespace-nowrap">{formatCurrency(as.costPerAppt)}</td>
          <td className="text-right font-mono-tabular text-xs py-2 px-3 whitespace-nowrap">{formatNumber(as.closed)}</td>
          <td className="text-right font-mono-tabular text-xs py-2 px-3 whitespace-nowrap">{formatCurrency(as.revenue)}</td>
        </tr>
        );
      })}
    </>
  );
}

export default function Dashboard() {
  const { accounts, adSpend, appointments, settings, loading, error, configured, refresh } = useData();
  const [search, setSearch] = useState('');
  const [perfFilter, setPerfFilter] = useState<'all' | PerformanceLevel>('all');
  const [accountFilter, setAccountFilter] = useState('all');
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // Compute date range
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

  // Filter raw data by date range and rebuild summaries
  const dateFilteredAccounts = useMemo(() => {
    if (!dateRange.from && !dateRange.to) return accounts;

    const from = dateRange.from;
    const to = dateRange.to;

    const filteredSpend = adSpend.filter(row => {
      const d = parseDateSafe(row.date);
      if (!d) return false; // exclude rows with unparseable dates when filtering by date
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });

    const filteredAppts = appointments.filter(row => {
      const d = parseDateSafe(row.dateAdded || row.appointmentDate);
      if (!d) return false; // exclude rows with unparseable dates when filtering by date
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });

    return buildAccountSummaries(filteredSpend, filteredAppts, settings).accounts;
  }, [accounts, adSpend, appointments, settings, dateRange]);

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
    return {
      spend,
      leads,
      cpl: leads > 0 ? spend / leads : 0,
      appts,
      calls: appts,
      callConv: leads > 0 ? (appts / leads) * 100 : 0,
      costPerAppt: appts > 0 ? spend / appts : 0,
      closed,
      revenue,
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
          <KPICard label="Total Appointments" value={formatNumber(totals.appts)} />
          <KPICard label="Total Calls" value={formatNumber(totals.calls)} />
          <KPICard label="Call Conv %" value={formatPercent(totals.callConv)} />
          <KPICard label="Avg Cost/Appt" value={formatCurrency(totals.costPerAppt)} />
          <KPICard label="Closed Deals" value={formatNumber(totals.closed)} />
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

      {/* Account Cards */}
      {loading ? (
        <TableSkeleton rows={5} />
      ) : filteredAccounts.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-y-auto max-h-[70vh]">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '40px' }} />
                <col />
                <col style={{ width: '110px' }} />
                <col style={{ width: '70px' }} />
                <col style={{ width: '90px' }} />
                <col style={{ width: '70px' }} />
                <col style={{ width: '75px' }} />
                <col style={{ width: '100px' }} />
                <col style={{ width: '70px' }} />
                <col style={{ width: '110px' }} />
              </colgroup>
              <thead className="sticky top-0 z-20 bg-background shadow-sm">
                <tr className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wide border-b border-border" style={{ height: '40px' }}>
                  <th className="align-middle" />
                  <th className="text-left pl-2 align-middle">Account</th>
                  <th className="text-right px-3 align-middle">Spend</th>
                  <th className="text-right px-3 align-middle">Leads</th>
                  <th className="text-right px-3 align-middle">CPL</th>
                  <th className="text-right px-3 align-middle">Appts</th>
                  <th className="text-right px-3 align-middle">Lead %</th>
                  <th className="text-right px-3 align-middle">Cost/Appt</th>
                  <th className="text-right px-3 align-middle">Closed</th>
                  <th className="text-right px-3 align-middle">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {accountGroups.map(g => (
                  <AccountSection key={g.label} group={g} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
