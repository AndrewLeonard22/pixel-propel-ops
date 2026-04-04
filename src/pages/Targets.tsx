import { useMemo } from 'react';
import { useData } from '@/hooks/useData';
import { ConfigBanner } from '@/components/common/Banners';
import { formatCurrency, formatPercent } from '@/lib/dataService';

function MetricBar({
  label, scope, value, displayValue, zones, scaleMax, description, scaleLabels
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
            <div key={i} className={`${z.color} opacity-80 flex items-center justify-center`} style={{ flex: z.flex }}>
              <span className="text-[9px] font-medium text-white/90">{z.label}</span>
            </div>
          ))}
        </div>
        <div className="absolute top-0 h-5" style={{ left: `${markerPos}%` }}>
          <div className="w-0.5 h-full bg-foreground rounded-full" />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground mt-2">{description}</p>
    </div>
  );
}

export default function Targets() {
  const { accounts, configured } = useData();

  const stats = useMemo(() => {
    if (accounts.length === 0) return null;
    const totalSpend = accounts.reduce((s, a) => s + a.spend, 0);
    const totalLeads = accounts.reduce((s, a) => s + a.leads, 0);
    const totalAppts = accounts.reduce((s, a) => s + a.appointments, 0);
    const totalDials = accounts.reduce((s, a) => s + a.totalDials, 0);
    return {
      avgCPA: totalAppts > 0 ? totalSpend / totalAppts : 0,
      avgCPL: totalLeads > 0 ? totalSpend / totalLeads : 0,
      dialsPerLead: totalLeads > 0 ? totalDials / totalLeads : 0,
      leadToAppt: totalLeads > 0 ? (totalAppts / totalLeads) * 100 : 0,
      dialBookingRate: totalDials > 0 ? (totalAppts / totalDials) * 100 : 0,
    };
  }, [accounts]);

  if (!configured) return <ConfigBanner />;
  if (!stats) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Targets</h1>
        <p className="text-sm text-muted-foreground mt-1">How you're performing against your benchmarks</p>
      </div>

      {/* Top summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card-elevated p-4">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Avg Cost/Appt</p>
          <p className={`text-xl font-bold font-mono-tabular ${stats.avgCPA <= 180 ? 'text-emerald-600' : stats.avgCPA <= 300 ? 'text-amber-600' : 'text-red-600'}`}>{formatCurrency(stats.avgCPA)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">Target: under $180</p>
        </div>
        <div className="card-elevated p-4">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Avg CPL</p>
          <p className={`text-xl font-bold font-mono-tabular ${stats.avgCPL <= 35 ? 'text-emerald-600' : stats.avgCPL <= 60 ? 'text-amber-600' : 'text-red-600'}`}>{formatCurrency(stats.avgCPL)}</p>
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
          label="Cost per Appointment"
          scope="All accounts, current period"
          value={stats.avgCPA}
          displayValue={formatCurrency(stats.avgCPA)}
          zones={[
            { flex: 3, color: 'bg-emerald-500', label: 'Great' },
            { flex: 2, color: 'bg-amber-500', label: 'OK' },
            { flex: 2, color: 'bg-red-500', label: 'High' },
          ]}
          scaleMax={500}
          scaleLabels={['$0', '$180', '$300', '$500']}
          description="Target: under $180. Green zone is $0–$214, yellow $214–$357, red $357+."
        />
        <MetricBar
          label="Cost per Lead"
          scope="All accounts, current period"
          value={stats.avgCPL}
          displayValue={formatCurrency(stats.avgCPL)}
          zones={[
            { flex: 3, color: 'bg-emerald-500', label: 'Great' },
            { flex: 2, color: 'bg-amber-500', label: 'OK' },
            { flex: 2, color: 'bg-red-500', label: 'High' },
          ]}
          scaleMax={100}
          scaleLabels={['$0', '$35', '$60', '$100']}
          description="Target: under $35. Measures ad efficiency at generating raw leads."
        />
        <MetricBar
          label="Lead-to-Appointment Rate"
          scope="All accounts, current period"
          value={stats.leadToAppt}
          displayValue={formatPercent(stats.leadToAppt)}
          zones={[
            { flex: 2, color: 'bg-red-500', label: 'Low' },
            { flex: 2, color: 'bg-amber-500', label: 'OK' },
            { flex: 3, color: 'bg-emerald-500', label: 'Strong' },
          ]}
          scaleMax={40}
          scaleLabels={['0%', '5%', '15%', '40%']}
          description="Target: above 15%. Higher is better — measures how well leads convert to booked appointments."
        />
        <MetricBar
          label="Dials per Lead"
          scope="All accounts, current period"
          value={stats.dialsPerLead}
          displayValue={stats.dialsPerLead.toFixed(1)}
          zones={[
            { flex: 2, color: 'bg-red-500', label: 'Low' },
            { flex: 3, color: 'bg-emerald-500', label: 'Good' },
            { flex: 2, color: 'bg-amber-500', label: 'High' },
          ]}
          scaleMax={20}
          scaleLabels={['0', '4', '10', '20']}
          description="Sweet spot: 4–10 dials per lead. Too low means leads aren't being worked; too high may indicate poor lead quality."
        />
        <MetricBar
          label="Dial Booking Rate"
          scope="All accounts, current period"
          value={stats.dialBookingRate}
          displayValue={formatPercent(stats.dialBookingRate)}
          zones={[
            { flex: 2, color: 'bg-red-500', label: 'Low' },
            { flex: 2, color: 'bg-amber-500', label: 'OK' },
            { flex: 3, color: 'bg-emerald-500', label: 'Strong' },
          ]}
          scaleMax={20}
          scaleLabels={['0%', '3%', '7%', '20%']}
          description="Target: above 7%. Percentage of dials that result in a booked appointment."
        />
      </div>
    </div>
  );
}
