import { useData } from '@/hooks/useData';
import { ConfigBanner, ErrorBanner } from '@/components/common/Banners';
import { TableSkeleton } from '@/components/common/LoadingSkeleton';
import EmptyState from '@/components/common/EmptyState';
import { formatCurrency, formatNumber, formatPercent, buildTeamPerformance } from '@/lib/dataService';
import { useMemo } from 'react';

export default function TeamPerformance() {
  const { accounts, loading, error, configured, refresh } = useData();

  const team = useMemo(() => buildTeamPerformance(accounts), [accounts]);

  if (!configured) return <div className="max-w-2xl mx-auto mt-20"><ConfigBanner /></div>;

  return (
    <div className="space-y-6 max-w-[1400px]">
      <h1 className="text-xl font-bold">Team Performance</h1>
      {error && <ErrorBanner message={error} onRetry={refresh} />}

      {loading ? <TableSkeleton rows={4} /> : team.length === 0 ? <EmptyState message="No team data available" /> : (
        <>
          {/* Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {team.map(m => (
              <div key={m.name} className="card-elevated p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-bold">
                    {m.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{m.name}</p>
                    <p className="text-xs text-muted-foreground">{m.accountsManaged} accounts</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div><span className="text-muted-foreground">Spend</span><p className="font-mono-tabular font-semibold">{formatCurrency(m.totalSpend)}</p></div>
                  <div><span className="text-muted-foreground">Leads</span><p className="font-mono-tabular font-semibold">{formatNumber(m.totalLeads)}</p></div>
                  <div><span className="text-muted-foreground">Appts</span><p className="font-mono-tabular font-semibold">{formatNumber(m.totalAppointments)}</p></div>
                  <div><span className="text-muted-foreground">Avg CPL</span><p className="font-mono-tabular font-semibold">{formatCurrency(m.avgCPL)}</p></div>
                  <div><span className="text-muted-foreground">Closed</span><p className="font-mono-tabular font-semibold">{formatNumber(m.closedDeals)}</p></div>
                  <div><span className="text-muted-foreground">Revenue</span><p className="font-mono-tabular font-semibold">{formatCurrency(m.revenueGenerated)}</p></div>
                </div>
              </div>
            ))}
          </div>

          {/* Leaderboard */}
          <div>
            <h2 className="text-lg font-semibold mb-3">Leaderboard</h2>
            <div className="card-elevated overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground text-left">
                    <th className="py-2 px-3">#</th>
                    <th className="py-2 px-3">Name</th>
                    <th className="py-2 px-3 text-right">Accounts</th>
                    <th className="py-2 px-3 text-right">Spend</th>
                    <th className="py-2 px-3 text-right">Leads</th>
                    <th className="py-2 px-3 text-right">Appts</th>
                    <th className="py-2 px-3 text-right">Avg CPL</th>
                    <th className="py-2 px-3 text-right">Avg Lead %</th>
                    <th className="py-2 px-3 text-right">Closed</th>
                    <th className="py-2 px-3 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {team.map((m, i) => (
                    <tr key={m.name} className="border-b border-border/50 hover:bg-accent/30 transition-colors">
                      <td className="py-3 px-3 font-mono-tabular text-muted-foreground">{i + 1}</td>
                      <td className="py-3 px-3 font-medium">{m.name}</td>
                      <td className="py-3 px-3 text-right font-mono-tabular">{m.accountsManaged}</td>
                      <td className="py-3 px-3 text-right font-mono-tabular">{formatCurrency(m.totalSpend)}</td>
                      <td className="py-3 px-3 text-right font-mono-tabular">{formatNumber(m.totalLeads)}</td>
                      <td className="py-3 px-3 text-right font-mono-tabular">{formatNumber(m.totalAppointments)}</td>
                      <td className="py-3 px-3 text-right font-mono-tabular">{formatCurrency(m.avgCPL)}</td>
                      <td className="py-3 px-3 text-right font-mono-tabular">{formatPercent(m.avgLeadPercent)}</td>
                      <td className="py-3 px-3 text-right font-mono-tabular">{formatNumber(m.closedDeals)}</td>
                      <td className="py-3 px-3 text-right font-mono-tabular">{formatCurrency(m.revenueGenerated)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
