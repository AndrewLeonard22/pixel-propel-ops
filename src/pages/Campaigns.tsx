import { useState, useMemo } from 'react';
import { useData } from '@/hooks/useData';
import { ConfigBanner, ErrorBanner } from '@/components/common/Banners';
import { TableSkeleton } from '@/components/common/LoadingSkeleton';
import EmptyState from '@/components/common/EmptyState';
import PerformanceBadge from '@/components/common/PerformanceBadge';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/dataService';
import type { CampaignSummary } from '@/lib/types';
import { Search } from 'lucide-react';

type SortKey = 'campaignName' | 'accountName' | 'spend' | 'leads' | 'cpl' | 'appointments' | 'leadPercent' | 'costPerAppt' | 'closed' | 'revenue';

export default function Campaigns() {
  const { accounts, loading, error, configured, refresh } = useData();
  const [search, setSearch] = useState('');
  const [accountFilter, setAccountFilter] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('spend');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const allCampaigns = useMemo(() => {
    return accounts.flatMap(a => a.campaigns);
  }, [accounts]);

  const filtered = useMemo(() => {
    return allCampaigns.filter(c => {
      if (search && !c.campaignName.toLowerCase().includes(search.toLowerCase())) return false;
      if (accountFilter !== 'all' && c.accountName !== accountFilter) return false;
      return true;
    });
  }, [allCampaigns, search, accountFilter]);

  const sorted = [...filtered].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];
    if (typeof aVal === 'string') return sortDir === 'asc' ? aVal.localeCompare(bVal as string) : (bVal as string).localeCompare(aVal);
    return sortDir === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  if (!configured) return <div className="max-w-2xl mx-auto mt-20"><ConfigBanner /></div>;

  const SortHeader = ({ label, field, className = '' }: { label: string; field: SortKey; className?: string }) => (
    <th className={`py-2 px-2 cursor-pointer hover:text-foreground transition-colors select-none ${className}`} onClick={() => toggleSort(field)}>
      {label} {sortKey === field ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </th>
  );

  return (
    <div className="space-y-6 max-w-[1400px]">
      <h1 className="text-xl font-bold">Campaigns</h1>
      {error && <ErrorBanner message={error} onRetry={refresh} />}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Search campaigns..." value={search} onChange={e => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 text-sm rounded-lg border bg-card focus:outline-none focus:ring-2 focus:ring-ring/20 w-56" />
        </div>
        <select value={accountFilter} onChange={e => setAccountFilter(e.target.value)}
          className="px-3 py-2 text-sm rounded-lg border bg-card focus:outline-none">
          <option value="all">All Accounts</option>
          {accounts.map(a => <option key={a.accountName} value={a.accountName}>{a.accountName}</option>)}
        </select>
      </div>

      {loading ? <TableSkeleton rows={8} /> : sorted.length === 0 ? <EmptyState /> : (
        <div className="card-elevated overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground text-left">
                <SortHeader label="Campaign" field="campaignName" />
                <SortHeader label="Account" field="accountName" />
                <SortHeader label="Spend" field="spend" className="text-right" />
                <SortHeader label="Leads" field="leads" className="text-right" />
                <SortHeader label="CPL" field="cpl" className="text-right" />
                <SortHeader label="Appts" field="appointments" className="text-right" />
                <SortHeader label="Lead %" field="leadPercent" className="text-right" />
                <SortHeader label="Cost/Appt" field="costPerAppt" className="text-right" />
                <SortHeader label="Closed" field="closed" className="text-right" />
                <SortHeader label="Revenue" field="revenue" className="text-right" />
                <th className="py-2 px-2">Performance</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c, i) => (
                <tr key={`${c.campaignId}-${i}`} className="border-b border-border/50 hover:bg-accent/30 transition-colors">
                  <td className="py-3 px-2 font-medium">{c.campaignName}</td>
                  <td className="py-3 px-2 text-muted-foreground">{c.accountName}</td>
                  <td className="py-3 px-2 text-right font-mono-tabular">{formatCurrency(c.spend)}</td>
                  <td className="py-3 px-2 text-right font-mono-tabular">{formatNumber(c.leads)}</td>
                  <td className="py-3 px-2 text-right font-mono-tabular">{formatCurrency(c.cpl)}</td>
                  <td className="py-3 px-2 text-right font-mono-tabular">{formatNumber(c.appointments)}</td>
                  <td className="py-3 px-2 text-right font-mono-tabular">{formatPercent(c.leadPercent)}</td>
                  <td className="py-3 px-2 text-right font-mono-tabular">{formatCurrency(c.costPerAppt)}</td>
                  <td className="py-3 px-2 text-right font-mono-tabular">{formatNumber(c.closed)}</td>
                  <td className="py-3 px-2 text-right font-mono-tabular">{formatCurrency(c.revenue)}</td>
                  <td className="py-3 px-2"><PerformanceBadge level={c.performance} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
