import { useState, useMemo } from 'react';
import { useData } from '@/hooks/useData';
import { ConfigBanner, ErrorBanner } from '@/components/common/Banners';
import { KPISkeleton, TableSkeleton } from '@/components/common/LoadingSkeleton';
import EmptyState from '@/components/common/EmptyState';
import PerformanceBadge from '@/components/common/PerformanceBadge';
import { formatCurrency, formatNumber, formatPercent, getPerformance } from '@/lib/dataService';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import type { AccountSummary, CampaignSummary, PerformanceLevel } from '@/lib/types';

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
            <span className="text-xs text-muted-foreground">{account.campaigns.length} campaigns</span>
            {account.mediaBuyer && <span className="text-xs text-muted-foreground">· {account.mediaBuyer}</span>}
            <PerformanceBadge level={perf} />
          </div>
        </div>
        <div className="hidden md:flex items-center gap-6 text-xs font-mono-tabular shrink-0">
          <span className="w-20 text-right">{formatCurrency(account.spend)}</span>
          <span className="w-12 text-right">{formatNumber(account.leads)}</span>
          <span className="w-16 text-right"><CPLBadge value={account.cpl} /></span>
          <span className="w-12 text-right">{formatNumber(account.appointments)}</span>
          <span className="w-14 text-right">{formatPercent(account.leadPercent)}</span>
          <span className="w-20 text-right">{formatCurrency(account.costPerAppt)}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t bg-accent/20">
          {/* Column headers */}
          <div className="hidden md:flex items-center gap-4 px-4 py-2 text-xs text-muted-foreground font-medium border-b">
            <span className="w-4" />
            <span className="flex-1 pl-6">Campaign</span>
            <span className="w-20 text-right">Spend</span>
            <span className="w-12 text-right">Leads</span>
            <span className="w-16 text-right">CPL</span>
            <span className="w-12 text-right">Appts</span>
            <span className="w-14 text-right">Lead %</span>
            <span className="w-16 text-right">Cost/A</span>
            <span className="w-12 text-right">Closed</span>
            <span className="w-20 text-right">Revenue</span>
          </div>
          {account.campaigns.map(c => (
            <CampaignRow key={c.campaignId} campaign={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function CampaignRow({ campaign }: { campaign: CampaignSummary }) {
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
          <span className="w-12 text-right">{formatNumber(campaign.appointments)}</span>
          <span className="w-14 text-right">{formatPercent(campaign.leadPercent)}</span>
          <span className="w-16 text-right">{formatCurrency(campaign.costPerAppt)}</span>
          <span className="w-12 text-right">{formatNumber(campaign.closed)}</span>
          <span className="w-20 text-right">{formatCurrency(campaign.revenue)}</span>
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
                <span className="w-12 text-right">{formatNumber(as.appointments)}</span>
                <span className="w-14 text-right">{formatPercent(as.leadPercent)}</span>
                <span className="w-16 text-right">{formatCurrency(as.costPerAppt)}</span>
                <span className="w-12 text-right">{formatNumber(as.closed)}</span>
                <span className="w-20 text-right">{formatCurrency(as.revenue)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { accounts, loading, error, configured, refresh } = useData();
  const [search, setSearch] = useState('');
  const [perfFilter, setPerfFilter] = useState<'all' | PerformanceLevel>('all');
  const [accountFilter, setAccountFilter] = useState('all');

  const filteredAccounts = useMemo(() => {
    return accounts.filter(a => {
      if (search && !a.accountName.toLowerCase().includes(search.toLowerCase())) return false;
      if (accountFilter !== 'all' && a.accountName !== accountFilter) return false;
      if (perfFilter !== 'all') {
        const perf = getPerformance(a.cpl, a.leadPercent);
        if (perf !== perfFilter) return false;
      }
      return true;
    });
  }, [accounts, search, perfFilter, accountFilter]);

  const totals = useMemo(() => {
    const spend = filteredAccounts.reduce((s, a) => s + a.spend, 0);
    const leads = filteredAccounts.reduce((s, a) => s + a.leads, 0);
    const appts = filteredAccounts.reduce((s, a) => s + a.appointments, 0);
    const closed = filteredAccounts.reduce((s, a) => s + a.closed, 0);
    const revenue = filteredAccounts.reduce((s, a) => s + a.revenue, 0);
    const qualified = filteredAccounts.reduce((s, a) => s + a.qualified, 0);
    return {
      spend,
      leads,
      cpl: leads > 0 ? spend / leads : 0,
      appts,
      calls: appts, // Using appointments as calls proxy
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
          </div>
          {filteredAccounts.map(a => (
            <AccountRow key={a.accountName} account={a} />
          ))}
        </div>
      )}
    </div>
  );
}
