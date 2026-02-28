import { useState, useMemo } from 'react';
import { useData } from '@/hooks/useData';
import { ConfigBanner, ErrorBanner } from '@/components/common/Banners';
import { KPISkeleton, TableSkeleton } from '@/components/common/LoadingSkeleton';
import EmptyState from '@/components/common/EmptyState';
import PerformanceBadge from '@/components/common/PerformanceBadge';
import { formatCurrency, formatNumber, formatPercent, getPerformance, buildAccountSummaries } from '@/lib/dataService';
import { ChevronDown, ChevronRight, Search, AlertTriangle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import type { AccountSummary, CampaignSummary, PerformanceLevel } from '@/lib/types';
import { startOfMonth, endOfMonth, subMonths } from 'date-fns';

type DatePreset = 'all' | 'this_month' | 'last_month' | 'last_3_months' | 'custom';

function parseDateSafe(dateStr: string): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
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

function AccountRow({ account }: { account: AccountSummary }) {
  const [expanded, setExpanded] = useState(false);
  const perf = getPerformance(account.cpl, account.leadPercent);
  const isDWY = account.program === 'Done With You';

  return (
    <div className="card-elevated overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-4 p-4 text-left hover:bg-accent/30 transition-colors"
      >
        <span className="text-muted-foreground">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
        <div className="flex-1 min-w-0">
         <div className="flex items-center gap-2">
            <span className="font-semibold text-sm truncate">{account.accountName}</span>
            {account.appointments === 0 && account.revenue === 0 && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">No Airtable match found — check aliases in Settings.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <span className="text-xs text-muted-foreground">{account.campaigns.length} campaigns</span>
            {account.mediaBuyer && <span className="text-xs text-muted-foreground">· {account.mediaBuyer}</span>}
            <PerformanceBadge level={perf} />
          </div>
        </div>
        <div className="hidden md:flex items-center gap-6 text-xs font-mono-tabular shrink-0">
          <span className="w-20 text-right">{formatCurrency(account.spend)}</span>
          <span className="w-12 text-right">{formatNumber(account.leads)}</span>
          <span className="w-16 text-right"><CPLBadge value={account.cpl} /></span>
          {isDWY ? (
            <span className="w-[252px] text-right text-muted-foreground text-xs italic">Ads only</span>
          ) : (
            <>
              <span className="w-12 text-right">{formatNumber(account.appointments)}</span>
              <span className="w-14 text-right">{formatPercent(account.leadPercent)}</span>
              <span className="w-20 text-right">{formatCurrency(account.costPerAppt)}</span>
              <span className="w-12 text-right">{formatNumber(account.closed)}</span>
              <span className="w-20 text-right">{formatCurrency(account.revenue)}</span>
            </>
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t bg-accent/20">
          <div className="hidden md:flex items-center gap-4 px-4 py-2 text-xs text-muted-foreground font-medium border-b">
            <span className="w-4" />
            <span className="flex-1 pl-6">Campaign</span>
            <span className="w-20 text-right">Spend</span>
            <span className="w-12 text-right">Leads</span>
            <span className="w-16 text-right">CPL</span>
            {!isDWY && (
              <>
                <span className="w-12 text-right">Appts</span>
                <span className="w-14 text-right">Lead %</span>
                <span className="w-16 text-right">Cost/A</span>
                <span className="w-12 text-right">Closed</span>
                <span className="w-20 text-right">Revenue</span>
              </>
            )}
          </div>
          {account.campaigns.map(c => (
            <CampaignRow key={c.campaignId} campaign={c} isDWY={isDWY} />
          ))}
        </div>
      )}
    </div>
  );
}

function CampaignRow({ campaign, isDWY }: { campaign: CampaignSummary; isDWY: boolean }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-accent/30 transition-colors"
      >
        <span className="text-muted-foreground">
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </span>
        <div className="flex-1 min-w-0 pl-2">
          <div className="flex items-center gap-2">
            <span className="text-sm truncate">{campaign.campaignName}</span>
            <PerformanceBadge level={campaign.performance} />
            <span className="text-xs text-muted-foreground">{campaign.adSets.length} ad sets</span>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-6 text-xs font-mono-tabular shrink-0">
          <span className="w-20 text-right">{formatCurrency(campaign.spend)}</span>
          <span className="w-12 text-right">{formatNumber(campaign.leads)}</span>
          <span className="w-16 text-right"><CPLBadge value={campaign.cpl} /></span>
          {!isDWY && (
            <>
              <span className="w-12 text-right">{formatNumber(campaign.appointments)}</span>
              <span className="w-14 text-right">{formatPercent(campaign.leadPercent)}</span>
              <span className="w-16 text-right">{formatCurrency(campaign.costPerAppt)}</span>
              <span className="w-12 text-right">{formatNumber(campaign.closed)}</span>
              <span className="w-20 text-right">{formatCurrency(campaign.revenue)}</span>
            </>
          )}
        </div>
      </button>

      {expanded && campaign.adSets.length > 0 && (
        <div className="bg-accent/10">
          {campaign.adSets.map(as => (
            <div key={as.adSetId} className="flex items-center gap-4 px-4 py-2.5 pl-14 text-xs border-t border-border/50">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-muted-foreground">{as.adSetName}</span>
                  <PerformanceBadge level={as.performance} />
                  <span className="text-muted-foreground">{as.adCount} ads</span>
                </div>
              </div>
              <div className="hidden md:flex items-center gap-6 font-mono-tabular shrink-0">
                <span className="w-20 text-right">{formatCurrency(as.spend)}</span>
                <span className="w-12 text-right">{formatNumber(as.leads)}</span>
                <span className="w-16 text-right"><CPLBadge value={as.cpl} /></span>
                {!isDWY && (
                  <>
                    <span className="w-12 text-right">{formatNumber(as.appointments)}</span>
                    <span className="w-14 text-right">{formatPercent(as.leadPercent)}</span>
                    <span className="w-16 text-right">{formatCurrency(as.costPerAppt)}</span>
                    <span className="w-12 text-right">{formatNumber(as.closed)}</span>
                    <span className="w-20 text-right">{formatCurrency(as.revenue)}</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
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
      if (!d) return true; // keep rows with unparseable dates
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });

    const filteredAppts = appointments.filter(row => {
      const d = parseDateSafe(row.appointmentDate);
      if (!d) return true;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });

    return buildAccountSummaries(filteredSpend, filteredAppts, settings);
  }, [accounts, adSpend, appointments, settings, dateRange]);

  const filteredAccounts = useMemo(() => {
    return dateFilteredAccounts.filter(a => {
      if (search && !a.accountName.toLowerCase().includes(search.toLowerCase())) return false;
      if (accountFilter !== 'all' && a.accountName !== accountFilter) return false;
      if (perfFilter !== 'all') {
        const perf = getPerformance(a.cpl, a.leadPercent);
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

  if (!configured) {
    return (
      <div className="max-w-2xl mx-auto mt-20">
        <ConfigBanner />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
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
        <div className="space-y-3">
          {/* Column headers */}
          <div className="hidden md:flex items-center gap-4 px-4 text-xs text-muted-foreground font-medium">
            <span className="w-4" />
            <span className="flex-1">Account</span>
            <span className="w-20 text-right">Spend</span>
            <span className="w-12 text-right">Leads</span>
            <span className="w-16 text-right">CPL</span>
            <span className="w-12 text-right">Appts</span>
            <span className="w-14 text-right">Lead %</span>
            <span className="w-20 text-right">Cost/Appt</span>
            <span className="w-12 text-right">Closed</span>
            <span className="w-20 text-right">Revenue</span>
          </div>
          {filteredAccounts.map(a => (
            <AccountRow key={a.accountName} account={a} />
          ))}
        </div>
      )}
    </div>
  );
}
