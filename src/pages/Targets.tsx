import { useState, useMemo } from 'react';
import { useData } from '@/hooks/useData';
import { ConfigBanner } from '@/components/common/Banners';
import { formatCurrency, formatPercent, buildAccountSummaries } from '@/lib/dataService';
import { loadAccountMappings, getAccountMapping } from '@/lib/config';
import type { AccountMapping } from '@/lib/types';
import { startOfMonth, endOfMonth, subMonths } from 'date-fns';

type DatePreset = 'all' | 'this_month' | 'last_month' | 'last_3_months';

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

function MetricBar({
  label, scope, value, displayValue, zones, scaleMax, description
}: {
  label: string;
  scope: string;
  value: number;
  displayValue: string;
  zones: { flex: number; color: string; label: string }[];
  scaleMax: number;
  description: string;
  scaleLabels: string[];
}) {
  const markerPos = Math.min(Math.max((value / scaleMax) * 100, 1), 99);
  const valueColor = (() => {
    let cumulative = 0;
    const totalFlex = zones.reduce((s, z) => s + z.flex, 0);
    for (const zone of zones) {
      cumulative += zone.flex;
      if ((value / scaleMax) * totalFlex <= cumulative) {
        return zone.color === 'bg-emerald-500' ? 'text-emerald-600' : zone.color === 'bg-amber-500' ? 'text-amber-600' : 'text-red-600';
      }
    }
    return 'text-red-600';
  })();

  return (
    <div className="card-elevated p-5">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-sm font-semibold text-foreground">{label}</span>
        <span className={`text-lg font-bold font-mono-tabular ${valueColor}`}>{displayValue}</span>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">{scope}</p>
      <div className="relative">
        <div className="flex rounded-md overflow-hidden h-5">
          {zones.map((z, i) => (
            <div key={i} className={`${z.color} opacity-80 flex items-center justify-center overflow-hidden`} style={{ flex: z.flex }}>
              <span className="text-[9px] font-medium text-white/90 whitespace-nowrap overflow-hidden">{z.label}</span>
            </div>
          ))}
        </div>
        <div className="absolute top-0 h-5" style={{ left: `${markerPos}%`, transform: 'translateX(-50%)' }}>
          <div className="w-0.5 h-full bg-foreground rounded-full" />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground mt-2">{description}</p>
    </div>
  );
}

export default function Targets() {
  const { accounts, adSpend, appointments, callData, settings, configured } = useData();
  const [datePreset, setDatePreset] = useState<DatePreset>('all');

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
      default:
        return { from: undefined, to: undefined };
    }
  }, [datePreset]);

  const filteredAccounts = useMemo(() => {
    if (!dateRange.from && !dateRange.to) return accounts;
    const { from, to } = dateRange;
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

  const stats = useMemo(() => {
    if (filteredAccounts.length === 0) return null;

    const mappings = loadAccountMappings();

    const dfyAccounts = filteredAccounts.filter(a => {
      const { program, status } = getAccountMapping(a.accountName, mappings);
      return status === 'Active' && program !== 'Done With You';
    });
    const dwyAccounts = filteredAccounts.filter(a => {
      const { program, status } = getAccountMapping(a.accountName, mappings);
      return status === 'Active' && program === 'Done With You';
    });
    const activeAccounts = [...dfyAccounts, ...dwyAccounts];

    // Use performanceSpend/performanceLeads so excluded campaigns don't inflate metrics
    const dfyPerfSpend = dfyAccounts.reduce((s, a) => s + a.performanceSpend, 0);
    const dfyPerfLeads = dfyAccounts.reduce((s, a) => s + a.performanceLeads, 0);
    const dfyAppts = dfyAccounts.reduce((s, a) => s + a.appointments, 0);

    const dwyPerfSpend = dwyAccounts.reduce((s, a) => s + a.performanceSpend, 0);
    const dwyPerfLeads = dwyAccounts.reduce((s, a) => s + a.performanceLeads, 0);

    const totalDials = activeAccounts.reduce((s, a) => s + a.totalDials, 0);
    const totalPerfLeads = activeAccounts.reduce((s, a) => s + a.performanceLeads, 0);
    const totalAppts = activeAccounts.reduce((s, a) => s + a.appointments, 0);

    return {
      dfyAvgCPA: dfyAppts > 0 ? dfyPerfSpend / dfyAppts : 0,
      dfyAvgCPL: dfyPerfLeads > 0 ? dfyPerfSpend / dfyPerfLeads : 0,
      dwyAvgCPL: dwyPerfLeads > 0 ? dwyPerfSpend / dwyPerfLeads : 0,
      dialsPerLead: totalPerfLeads > 0 ? totalDials / totalPerfLeads : 0,
      leadToAppt: totalPerfLeads > 0 ? (totalAppts / totalPerfLeads) * 100 : 0,
      dialBookingRate: totalDials > 0 ? (totalAppts / totalDials) * 100 : 0,
    };
  }, [filteredAccounts]);

  if (!configured) return <ConfigBanner />;
  if (!stats) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Targets</h1>
          <p className="text-sm text-muted-foreground mt-1">How you're performing against your benchmarks</p>
        </div>
        <select
          value={datePreset}
          onChange={e => setDatePreset(e.target.value as DatePreset)}
          className="px-3 py-2 text-sm rounded-lg border bg-card focus:outline-none"
        >
          <option value="all">All Time</option>
          <option value="this_month">This Month</option>
          <option value="last_month">Last Month</option>
          <option value="last_3_months">Last 3 Months</option>
        </select>
      </div>

      {/* Top summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card-elevated p-4">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">DFY Cost/Appt</p>
          <p className={`text-xl font-bold font-mono-tabular ${stats.dfyAvgCPA < 180 ? 'text-emerald-600' : stats.dfyAvgCPA <= 240 ? 'text-amber-600' : 'text-red-600'}`}>{formatCurrency(stats.dfyAvgCPA)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">Target: under $180</p>
        </div>
        <div className="card-elevated p-4">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">DFY CPL</p>
          <p className={`text-xl font-bold font-mono-tabular ${stats.dfyAvgCPL < 35 ? 'text-emerald-600' : stats.dfyAvgCPL <= 55 ? 'text-amber-600' : 'text-red-600'}`}>{formatCurrency(stats.dfyAvgCPL)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">Target: under $35</p>
        </div>
        <div className="card-elevated p-4">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Lead-to-Appt</p>
          <p className={`text-xl font-bold font-mono-tabular ${stats.leadToAppt >= 15 ? 'text-emerald-600' : stats.leadToAppt >= 5 ? 'text-amber-600' : 'text-red-600'}`}>{formatPercent(stats.leadToAppt)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">Target: above 15%</p>
        </div>
      </div>

      {/* Metric bars */}
      <div className="space-y-4">
        <MetricBar
          label="Cost per appointment"
          scope="Done For You accounts · target under $180"
          value={stats.dfyAvgCPA}
          displayValue={formatCurrency(stats.dfyAvgCPA)}
          zones={[
            { flex: 180, color: 'bg-emerald-500', label: 'Under $180' },
            { flex: 60, color: 'bg-amber-500', label: '$180–240' },
            { flex: 160, color: 'bg-red-500', label: 'Above $240' },
          ]}
          scaleMax={400}
          scaleLabels={['$0', '$180', '$240', '$400']}
          description="Our primary metric for DFY accounts. If CPA is red, check: are leads converting to appointments (lead-to-appt %), or is CPL too high?"
        />
        <MetricBar
          label="Cost per lead"
          scope="All accounts · target under $35"
          value={stats.dfyAvgCPL}
          displayValue={formatCurrency(stats.dfyAvgCPL)}
          zones={[
            { flex: 35, color: 'bg-emerald-500', label: 'Under $35' },
            { flex: 20, color: 'bg-amber-500', label: '$35–55' },
            { flex: 45, color: 'bg-red-500', label: 'Above $55' },
          ]}
          scaleMax={100}
          scaleLabels={['$0', '$35', '$55', '$100']}
          description="What each lead costs from Facebook. High CPL = ad creative or targeting issue. This is on the media buyer."
        />
        <MetricBar
          label="Dials per lead"
          scope="Call center efficiency · sweet spot 5–20"
          value={stats.dialsPerLead}
          displayValue={stats.dialsPerLead.toFixed(1)}
          zones={[
            { flex: 5, color: 'bg-red-500', label: 'Under 5' },
            { flex: 15, color: 'bg-emerald-500', label: '5–20' },
            { flex: 20, color: 'bg-amber-500', label: '20–40' },
            { flex: 20, color: 'bg-red-500', label: '40+' },
          ]}
          scaleMax={60}
          scaleLabels={['0', '5', '20', '40', '60']}
          description="Under 5 = not working leads hard enough. Over 40 = beating a dead list."
        />
        <MetricBar
          label="Lead-to-appointment rate"
          scope="Funnel conversion · target above 15%"
          value={stats.leadToAppt}
          displayValue={formatPercent(stats.leadToAppt)}
          zones={[
            { flex: 5, color: 'bg-red-500', label: 'Under 5%' },
            { flex: 10, color: 'bg-amber-500', label: '5–15%' },
            { flex: 35, color: 'bg-emerald-500', label: 'Above 15%' },
          ]}
          scaleMax={50}
          scaleLabels={['0%', '5%', '15%', '50%']}
          description="What percentage of leads turn into booked appointments. Low rate = either bad leads (media buyer) or weak follow-up (setter)."
        />
        <MetricBar
          label="Dial booking rate"
          scope="Dials to appointments · target above 8%"
          value={stats.dialBookingRate}
          displayValue={formatPercent(stats.dialBookingRate)}
          zones={[
            { flex: 2, color: 'bg-red-500', label: 'Under 2%' },
            { flex: 6, color: 'bg-amber-500', label: '2–8%' },
            { flex: 12, color: 'bg-emerald-500', label: 'Above 8%' },
          ]}
          scaleMax={20}
          scaleLabels={['0%', '2%', '8%', '20%']}
          description="Combines lead quality and setter skill into one number."
        />
      </div>
    </div>
  );
}
