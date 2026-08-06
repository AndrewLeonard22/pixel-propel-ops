import { useState, useMemo } from 'react';
import { useData } from '@/hooks/useData';
import { hasUsableData } from '@/lib/sourceStatus';
import { ConfigBanner, ErrorBanner, HonestNumbersBanner } from '@/components/common/Banners';
import { TableSkeleton } from '@/components/common/LoadingSkeleton';
import EmptyState from '@/components/common/EmptyState';
import { formatCurrency, formatNumber, formatPercent, buildAccountSummaries, buildTeamPerformance } from '@/lib/dataService';
import { startOfMonth, endOfMonth, subMonths, format } from 'date-fns';
// ⑤ shared date parser. The local copy removed here handed ISO date-only strings to
// new Date(), which parses them as UTC MIDNIGHT and renders the PREVIOUS calendar day
// west of UTC. Harmless today (the derived tab is all M/D/YYYY) and load-bearing the
// moment ③ repoints to the raw tab, which is 581/581 ISO.
import { parseSourceDate as parseDateSafe } from '@/lib/dates';

type DatePreset = 'all' | 'this_month' | 'last_month' | 'last_3_months' | 'custom';

export default function MediaBuying() {
  const { accounts, adSpend, appointments, callData, settings, loading, error, configured, refresh, honestNumbers, sources, settingsOrigin, settingsDetail} = useData();

  const [datePreset, setDatePreset] = useState<DatePreset>('this_month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

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

  const dateLabel = useMemo(() => {
    const now = new Date();
    switch (datePreset) {
      case 'this_month': return format(now, 'MMMM yyyy');
      case 'last_month': return format(subMonths(now, 1), 'MMMM yyyy');
      case 'last_3_months': return `${format(startOfMonth(subMonths(now, 2)), 'MMM yyyy')} – ${format(endOfMonth(now), 'MMM yyyy')}`;
      case 'custom':
        if (customFrom && customTo) return `${customFrom} → ${customTo}`;
        return 'Custom Range';
      default: return 'All Time';
    }
  }, [datePreset, customFrom, customTo]);

  const filteredAccounts = useMemo(() => {
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
    // ⭐ THE 5th ARGUMENT IS NOT OPTIONAL IN PRACTICE. It defaults `?? true`, so a
    // recompute that omits it ASSERTS EVERY SOURCE IS ALIVE and turns a dead source's em
    // dashes back into numbers the moment a user picks a date range. Measured on this
    // page: 5 honest em dashes per row became 5 fabricated values on "This Week".
    // Same flags as useData.tsx:203, so a filtered view cannot disagree with an unfiltered one.
    return buildAccountSummaries(filteredSpend, filteredAppts, settings, filteredCalls, {
      spend: hasUsableData(sources.windsor.state),
      appts: hasUsableData(sources.airtable.state),
      calls: hasUsableData(sources.callCenter.state),
    }).accounts;
  // `sources` IS A DEPENDENCY NOW, and omitting it would be a stale closure: the memo
  // reads the source states to build `known`, so a source dying without dateRange changing
  // would keep serving summaries stamped ALIVE.
  }, [accounts, adSpend, appointments, callData, settings, dateRange, sources]);

  const team = useMemo(() => buildTeamPerformance(filteredAccounts), [filteredAccounts]);

  // 🔴 EVERY NUMBER ON THIS PAGE TRAVERSES WINDSOR, AND NOTHING HERE CONSULTED IT.
  // @apprentice and @raccoon measured it: this page RE-DERIVES its own accounts via
  // buildAccountSummaries(filteredSpend, …), so a dead Windsor yields an EMPTY list and
  // every reduce(…, 0) returns a hard 0 — rendered with no guard of any kind. The
  // Dashboard had 5 of 9 tiles guarded and the plumbing to fix the rest; this page had
  // NO known-state plumbing at all.
  //
  // Gated at the PAGE rather than at each formatter: with Windsor dead there is no
  // subset of these numbers that remains knowable, so suppressing them individually
  // would leave a page of em dashes pretending to still be a report.
  if (!configured) return <div className="max-w-2xl mx-auto mt-20"><ConfigBanner origin={settingsOrigin} detail={settingsDetail} /></div>;
  if (!hasUsableData(sources.windsor.state)) {
    // ⚠️ THIS ONE IS A PER-PERSON SCORECARD. A fabricated "$0.00 revenue · 0 closed" is
    // not a dashboard reading wrong, it is a scorecard reading wrong ABOUT SOMEBODY.
    return (
      <div className="space-y-4 max-w-[1400px]">
        <h1 className="text-xl font-bold">Media Buying</h1>
        <HonestNumbersBanner messages={honestNumbers.messages} />
        <ErrorBanner message={`${sources.windsor.label} is unavailable, and every per-buyer figure is calculated from it. Nothing is shown rather than shown as zero.`} />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Header + date filter */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">Media Buying</h1>
          <HonestNumbersBanner messages={honestNumbers.messages} />
          <p className="text-sm text-muted-foreground mt-0.5">{dateLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
              <span className="text-sm text-muted-foreground">to</span>
              <input
                type="date"
                value={customTo}
                onChange={e => setCustomTo(e.target.value)}
                className="px-3 py-2 text-sm rounded-lg border bg-card focus:outline-none"
              />
            </div>
          )}
        </div>
      </div>

      {/* wrapped — a bare reference is called with the click event, which refresh read as override settings and silently refused */}
      {error && <ErrorBanner message={error} onRetry={() => refresh()} />}

      {loading ? <TableSkeleton rows={4} /> : team.length === 0 ? <EmptyState message="No media buyer data for this period." /> : (
        <>
          {/* Buyer cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {team.map(m => (
              <div key={m.name} className="card-elevated p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-bold shrink-0">
                    {m.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{m.name}</p>
                    <p className="text-xs text-muted-foreground">{m.accountsManaged} account{m.accountsManaged !== 1 ? 's' : ''}</p>
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

          {/* Leaderboard table */}
          <div>
            <h2 className="text-sm font-semibold text-foreground mb-3">Leaderboard</h2>
            <div className="card-elevated overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground text-left">
                    <th className="py-2 px-3">#</th>
                    <th className="py-2 px-3">Buyer</th>
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
