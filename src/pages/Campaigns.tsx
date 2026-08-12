import { useState, useMemo } from 'react';
import { useData } from '@/hooks/useData';
import { ConfigBanner, ErrorBanner, HonestNumbersBanner } from '@/components/common/Banners';
import { TableSkeleton } from '@/components/common/LoadingSkeleton';
import EmptyState from '@/components/common/EmptyState';
import PerformanceBadge from '@/components/common/PerformanceBadge';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/dataService';
import type { CampaignSummary } from '@/lib/types';
import { Search } from 'lucide-react';
import { Combobox } from '@/components/ui/combobox';
import { accountTitle } from '@/lib/accountDisplay';

type SortKey = 'campaignName' | 'accountName' | 'spend' | 'leads' | 'cpl' | 'appointments' | 'leadPercent' | 'costPerAppt' | 'closed' | 'revenue';

export default function Campaigns() {
  const { accounts, loading, error, configured, refresh, honestNumbers, settingsOrigin, settingsDetail} = useData();
  /**
   * ⭐ The campaign rows carry the Meta account NAME, not the client's. Resolving it here
   * off the summaries the page already has (rather than re-fetching `ad_accounts`) keeps
   * this column agreeing with the Accounts page by construction.
   */
  const companyByAccount = useMemo(
    () => new Map(accounts.map(a => [a.accountName, accountTitle(a).label])),
    [accounts],
  );
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

  if (!configured) return <div className="max-w-2xl mx-auto mt-20"><ConfigBanner origin={settingsOrigin} detail={settingsDetail} /></div>;

  const SortHeader = ({ label, field, className = '' }: { label: string; field: SortKey; className?: string }) => (
    <th className={`py-2 px-2 cursor-pointer hover:text-foreground transition-colors select-none ${className}`} onClick={() => toggleSort(field)}>
      {label} {sortKey === field ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </th>
  );

  return (
    <div className="space-y-6 max-w-[1400px]">
      <h1 className="text-xl font-bold">Campaigns</h1>
      <HonestNumbersBanner messages={honestNumbers.messages} />
      {/* wrapped — a bare reference is called with the click event, which refresh read as override settings and silently refused */}
      {error && <ErrorBanner message={error} onRetry={() => refresh()} />}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <label htmlFor="campaign-search" className="sr-only">Search campaigns by name</label>
          {/* `focus:border-ring` and NOT `ring-2`: a 4px halo outside the control collides
              with its neighbour across the gap. Same 1px inset idiom as ui/combobox. */}
          <input id="campaign-search" type="text" placeholder="Search campaigns..." value={search} onChange={e => setSearch(e.target.value)}
            className="pl-9 pr-4 h-9 text-sm rounded-md border border-input bg-background transition-colors hover:border-border focus:outline-none focus-visible:border-ring w-56 min-w-0" />
        </div>
        {/* 🔴 A RAW NATIVE `<select>` WAS STILL SHIPPING HERE — @andrew: "the dropdowns on
            here look horrendous, look what modern software does". Dashboard.tsx carries a
            comment saying this exact pattern was the defect and was fixed; Campaigns was
            never touched, so the complaint was still live on a top-level page. It also had
            `focus:outline-none` with nothing put back, so keyboard focus was invisible. */}
        <Combobox
          aria-label="Filter campaigns by account"
          value={accountFilter}
          onChange={v => setAccountFilter(v ?? 'all')}
          // value = the match key (Meta's name), label = what the user calls the client.
          options={[
            { value: 'all', label: 'All accounts' },
            ...accounts.map(a => ({ value: a.accountName, label: accountTitle(a).label })),
          ]}
          searchPlaceholder="Search accounts"
          emptyLabel="No matching account."
          className="w-56"
        />
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
                  <td className="py-3 px-2 text-muted-foreground" title={c.accountName}>
                    {companyByAccount.get(c.accountName) ?? c.accountName}
                  </td>
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
