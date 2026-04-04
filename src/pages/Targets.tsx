import { useMemo } from 'react';
import { useData } from '@/hooks/useData';
import { ConfigBanner } from '@/components/common/Banners';
import { formatCurrency, formatPercent } from '@/lib/dataService';

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

    const mappings = loadAccountMappings();

    // Split accounts by program type, excluding Paused and Churned
    const dfyAccounts = accounts.filter(a => {
      const { program, status } = getAccountMapping(a.accountName, mappings);
      return status === 'Active' && program !== 'Done With You';
    });
    const dwyAccounts = accounts.filter(a => {
      const { program, status } = getAccountMapping(a.accountName, mappings);
      return status === 'Active' && program === 'Done With You';
    });
    const activeAccounts = [...dfyAccounts, ...dwyAccounts];

    // DFY metrics (CPA is the primary metric)
    const dfySpend = dfyAccounts.reduce((s, a) => s + a.spend, 0);
    const dfyLeads = dfyAccounts.reduce((s, a) => s + a.leads, 0);
    const dfyAppts = dfyAccounts.reduce((s, a) => s + a.appointments, 0);
    const dfyDials = dfyAccounts.reduce((s, a) => s + a.totalDials, 0);

    // DWY metrics (CPL is the primary metric)
    const dwySpend = dwyAccounts.reduce((s, a) => s + a.spend, 0);
    const dwyLeads = dwyAccounts.reduce((s, a) => s + a.leads, 0);

    // Overall metrics (active accounts only)
    const totalDials = activeAccounts.reduce((s, a) => s + a.totalDials, 0);
    const totalLeads = activeAccounts.reduce((s, a) => s + a.leads, 0);
    const totalAppts = activeAccounts.reduce((s, a) => s + a.appointments, 0);

    return {
      dfyAvgCPA: dfyAppts > 0 ? dfySpend / dfyAppts : 0,
      dfyAvgCPL: dfyLeads > 0 ? dfySpend / dfyLeads : 0,
      dwyAvgCPL: dwyLeads > 0 ? dwySpend / dwyLeads : 0,
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
