import { useState } from 'react';
import { useData } from '@/hooks/useData';
import { ConfigBanner, ErrorBanner } from '@/components/common/Banners';
import { TableSkeleton } from '@/components/common/LoadingSkeleton';
import EmptyState from '@/components/common/EmptyState';
import PerformanceBadge from '@/components/common/PerformanceBadge';
import { formatCurrency, formatNumber, formatPercent, formatDate, getPerformance } from '@/lib/dataService';
import type { AccountSummary } from '@/lib/types';
import { X } from 'lucide-react';

function AccountDetail({ account, onClose }: { account: AccountSummary; onClose: () => void }) {
  const showRate = account.appointmentList.length > 0
    ? (account.appointmentList.filter(a => a.showStatus?.toLowerCase() === 'showed' || a.showStatus?.toLowerCase() === 'show').length / account.appointmentList.length) * 100
    : 0;
  const closeRate = account.appointmentList.length > 0
    ? (account.closed / account.appointmentList.length) * 100
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-foreground/20" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-card border-l shadow-xl overflow-y-auto">
        <div className="sticky top-0 bg-card border-b p-4 flex items-center justify-between z-10">
          <h2 className="font-bold text-lg">{account.accountName}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Summary stats */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="card-elevated p-4">
              <p className="text-xs text-muted-foreground">Total Appointments</p>
              <p className="kpi-number">{formatNumber(account.appointments)}</p>
            </div>
            <div className="card-elevated p-4">
              <p className="text-xs text-muted-foreground">Show Rate</p>
              <p className="kpi-number">{formatPercent(showRate)}</p>
            </div>
            <div className="card-elevated p-4">
              <p className="text-xs text-muted-foreground">Close Rate</p>
              <p className="kpi-number">{formatPercent(closeRate)}</p>
            </div>
            <div className="card-elevated p-4">
              <p className="text-xs text-muted-foreground">Total Revenue</p>
              <p className="kpi-number">{formatCurrency(account.revenue)}</p>
            </div>
            <div className="card-elevated p-4">
              <p className="text-xs text-muted-foreground">Total Billed</p>
              <p className="kpi-number">{formatCurrency(account.billed)}</p>
            </div>
          </div>

          {/* Campaigns */}
          <div>
            <h3 className="font-semibold mb-3">Campaigns ({account.campaigns.length})</h3>
            <div className="space-y-2">
              {account.campaigns.map(c => (
                <div key={c.campaignId} className="card-elevated p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{c.campaignName}</span>
                    <PerformanceBadge level={c.performance} />
                  </div>
                  <div className="flex gap-4 text-xs font-mono-tabular text-muted-foreground">
                    <span>{formatCurrency(c.spend)}</span>
                    <span>{formatNumber(c.leads)} leads</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Appointment list */}
          <div>
            <h3 className="font-semibold mb-3">Appointments ({account.appointmentList.length})</h3>
            {account.appointmentList.length === 0 ? (
              <EmptyState message="No appointments found" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="text-left py-2 pr-4">Lead Name</th>
                      <th className="text-left py-2 pr-4">Date</th>
                      <th className="text-left py-2 pr-4">Show Status</th>
                      <th className="text-left py-2 pr-4">Lead Valid</th>
                      <th className="text-right py-2">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {account.appointmentList.slice(0, 50).map((appt, i) => (
                      <tr key={i} className="border-b border-border/50">
                        <td className="py-2 pr-4">{appt.client || '—'}</td>
                        <td className="py-2 pr-4 font-mono-tabular text-xs">{formatDate(appt.appointmentDate)}</td>
                        <td className="py-2 pr-4">{appt.showStatus || '—'}</td>
                        <td className="py-2 pr-4">{appt.leadValid || '—'}</td>
                        <td className="py-2 text-right font-mono-tabular">{formatCurrency(appt.closedRevenue)}</td>
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

type SortKey = 'accountName' | 'spend' | 'leads' | 'cpl' | 'appointments' | 'leadPercent' | 'costPerAppt' | 'qualified' | 'qualPercent' | 'closed' | 'revenue' | 'billed';

export default function Accounts() {
  const { accounts, loading, error, configured, refresh } = useData();
  const [selected, setSelected] = useState<AccountSummary | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('spend');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const sorted = [...accounts].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];
    if (typeof aVal === 'string') return sortDir === 'asc' ? (aVal as string).localeCompare(bVal as string) : (bVal as string).localeCompare(aVal as string);
    return sortDir === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
  });

  if (!configured) return <div className="max-w-2xl mx-auto mt-20"><ConfigBanner /></div>;

  const SortHeader = ({ label, field, className = '' }: { label: string; field: SortKey; className?: string }) => (
    <th
      className={`py-2 px-2 cursor-pointer hover:text-foreground transition-colors select-none ${className}`}
      onClick={() => toggleSort(field)}
    >
      {label} {sortKey === field ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </th>
  );

  return (
    <div className="space-y-6 max-w-[1400px]">
      <h1 className="text-xl font-bold">Accounts</h1>
      {error && <ErrorBanner message={error} onRetry={refresh} />}

      {loading ? <TableSkeleton rows={8} /> : sorted.length === 0 ? <EmptyState /> : (
        <div className="card-elevated overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground text-left">
                <SortHeader label="Account Name" field="accountName" />
                <th className="py-2 px-2">Program</th>
                <th className="py-2 px-2">Media Buyer</th>
                <SortHeader label="Spend" field="spend" className="text-right" />
                <SortHeader label="Leads" field="leads" className="text-right" />
                <SortHeader label="CPL" field="cpl" className="text-right" />
                <SortHeader label="Appts" field="appointments" className="text-right" />
                <SortHeader label="Lead %" field="leadPercent" className="text-right" />
                <SortHeader label="Cost/Appt" field="costPerAppt" className="text-right" />
                <SortHeader label="Closed" field="closed" className="text-right" />
                <SortHeader label="Revenue" field="revenue" className="text-right" />
                <SortHeader label="Billed" field="billed" className="text-right" />
              </tr>
            </thead>
            <tbody>
              {sorted.map(a => {
                const perf = getPerformance(a.cpl, a.leadPercent);
                return (
                  <tr
                    key={a.accountName}
                    onClick={() => setSelected(a)}
                    className="border-b border-border/50 hover:bg-accent/30 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-2 font-medium">{a.accountName}</td>
                    <td className="py-3 px-2 text-muted-foreground">{a.program}</td>
                    <td className="py-3 px-2 text-muted-foreground">{a.mediaBuyer || '—'}</td>
                    <td className="py-3 px-2 text-right font-mono-tabular">{formatCurrency(a.spend)}</td>
                    <td className="py-3 px-2 text-right font-mono-tabular">{formatNumber(a.leads)}</td>
                    <td className="py-3 px-2 text-right">
                      <span className={`font-mono-tabular font-semibold ${perf === 'good' ? 'text-success' : perf === 'fair' ? 'text-warning' : 'text-destructive'}`}>
                        {formatCurrency(a.cpl)}
                      </span>
                    </td>
                    <td className="py-3 px-2 text-right font-mono-tabular">{formatNumber(a.appointments)}</td>
                    <td className="py-3 px-2 text-right font-mono-tabular">{formatPercent(a.leadPercent)}</td>
                    <td className="py-3 px-2 text-right font-mono-tabular">{formatCurrency(a.costPerAppt)}</td>
                    <td className="py-3 px-2 text-right font-mono-tabular">{formatNumber(a.closed)}</td>
                    <td className="py-3 px-2 text-right font-mono-tabular">{formatCurrency(a.revenue)}</td>
                    <td className="py-3 px-2 text-right font-mono-tabular">{formatCurrency(a.billed)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && <AccountDetail account={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
