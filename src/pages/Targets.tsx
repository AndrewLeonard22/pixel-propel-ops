import { useState, useMemo } from 'react';
import { useData } from '@/hooks/useData';
import { hasUsableData } from '@/lib/sourceStatus';
import { ConfigBanner, ErrorBanner, HonestNumbersBanner } from '@/components/common/Banners';
import { formatCurrency, formatPercent, buildAccountSummaries } from '@/lib/dataService';
import { startOfMonth, endOfMonth, subMonths } from 'date-fns';
// ⑤ shared date parser. The local copy removed here handed ISO date-only strings to
// new Date(), which parses them as UTC MIDNIGHT and renders the PREVIOUS calendar day
// west of UTC. Harmless today (the derived tab is all M/D/YYYY) and load-bearing the
// moment ③ repoints to the raw tab, which is 581/581 ISO.
import { parseSourceDate as parseDateSafe } from '@/lib/dates';
import { Combobox } from '@/components/ui/combobox';

type DatePreset = 'all' | 'this_month' | 'last_month' | 'last_3_months';

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
        return zone.color === 'bg-success' ? 'text-success' : zone.color === 'bg-warning' ? 'text-warning-strong' : 'text-destructive';
      }
    }
    return 'text-destructive';
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
  const { accounts, adSpend, appointments, settings, configured, honestNumbers, sources, settingsOrigin, settingsDetail, accountRegistry} = useData();
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
    // ⭐ NEITHER TRAILING ARGUMENT IS OPTIONAL IN PRACTICE — both default to a value that
    // asserts something this page cannot know. `known` defaults `?? true` (omitting it
    // asserts every source is alive and turns a dead source's em dashes back into numbers;
    // measured here: 5 honest em dashes per row became 5 fabricated values on "This Week").
    // `registry` defaults to a registry that answers NOTHING, which is not neutral — it is
    // the pre-cutover identity model, so omitting it recomputed this page as if
    // `ad_accounts` did not exist. See the measured table in Dashboard.tsx; on THIS page it
    // moved program and media buyer, which are the two fields the targets are grouped by.
    // Same arguments as useData.tsx, so a filtered view cannot disagree with an unfiltered one.
    return buildAccountSummaries(filteredSpend, filteredAppts, settings, {
      spend: hasUsableData(sources.meta.state),
      appts: hasUsableData(sources.airtable.state),
    }, accountRegistry).accounts;
  // `sources` IS A DEPENDENCY NOW, and omitting it would be a stale closure: the memo
  // reads the source states to build `known`, so a source dying without dateRange changing
  // would keep serving summaries stamped ALIVE. `accountRegistry` is a dependency for the
  // same reason — it arrives on the data path, after the first render.
  }, [accounts, adSpend, appointments, settings, dateRange, sources, accountRegistry]);

  const stats = useMemo(() => {
    if (filteredAccounts.length === 0) return null;

    /**
     * 🔴 THIS PAGE WAS STILL ASKING THE RETIRED STORE WHO EACH ACCOUNT IS, AND IT NOW
     * DISAGREED WITH THE DASHBOARD ON SCREEN.
     *
     * It used to read `getAccountMapping(a.accountName, loadAccountMappings())` — matching
     * Meta's CURRENT display name against `accountAliases[].sheetName`, a key that was
     * written from the SHEET's names. Before the cutover that was harmless: the Dashboard
     * called the identical function, so both pages were wrong in the same direction and
     * therefore agreed. After it, the Dashboard resolves program and status from
     * `ad_accounts` via `account_id`, and this page did not — so ONE feed produced TWO
     * answers, and both were rendered as fact two clicks apart.
     *
     * Measured 2026-08-12 against the live sources — 4 of 52 accounts diverged:
     *   SocialWorks $51,056.88   Dashboard Internal        · Targets Done For You
     *   Hiring      $1,904.03    Dashboard Internal/Churned · Targets DFY/Active  ← an
     *                            ARCHIVED account was being counted into a live target
     *   No Streaks  $7,018.17    Dashboard Done With You   · Targets Done For You
     *   STR           $987.60    Dashboard Unknown         · Targets Done For You
     * Rendered consequence: DFY Cost/Appt read $652.88 here and $637.55 there, DFY CPL
     * $30.09 here and $31.51 there, for the SAME metric, window and feed.
     *
     * ⭐ `buildAccountSummaries` ALREADY RESOLVED THIS, above, using the same registry the
     * Dashboard uses — `a.program` and `a.status` are the resolved values. The fix is to stop
     * re-deriving identity from a second, retired source, not to teach the retired source the
     * new names. A name is not an identity, and joining on a display name is precisely the
     * bug the cutover removed; re-doing it on this page reintroduced it.
     */
    const activeAccounts = filteredAccounts.filter(a => a.status === 'Active');
    /**
     * `Internal` is OUR OWN agency and recruiting spend and books no client appointments, so
     * it is not part of a client-facing rate. It satisfied the old `!== 'Done With You'`
     * test, which put $51,056.88 with 0 appointments into the DFY cost-per-appointment
     * numerator. Mirrors `Dashboard.tsx`'s `dfyAccounts` — the same rule, written once per
     * page because both pages compute their own populations.
     */
    const dfyAccounts = activeAccounts.filter(a => a.program !== 'Done With You' && a.program !== 'Internal');
    const dwyAccounts = activeAccounts.filter(a => a.program === 'Done With You');

    // Use performanceSpend/performanceLeads so excluded campaigns don't inflate metrics
    const dfyPerfSpend = dfyAccounts.reduce((s, a) => s + a.performanceSpend, 0);
    const dfyPerfLeads = dfyAccounts.reduce((s, a) => s + a.performanceLeads, 0);
    const dfyAppts = dfyAccounts.reduce((s, a) => s + a.appointments, 0);

    const dwyPerfSpend = dwyAccounts.reduce((s, a) => s + a.performanceSpend, 0);
    const dwyPerfLeads = dwyAccounts.reduce((s, a) => s + a.performanceLeads, 0);

    /**
     * 🔴 THE LEAD-TO-APPOINTMENT RATE HAD A DENOMINATOR FROM ANOTHER POPULATION, and it
     * printed 2.1% against a target of "above 15%" while the Dashboard printed 4.9% for the
     * same window and the same feed.
     *
     * It divided ALL-active appointments by ALL-active leads. DWY means WE RUN THE ADS AND
     * THE CLIENT WORKS THE LEADS — those accounts contribute LEADS and, by construction, no
     * appointments — so every DWY lead was inflating the denominator of a conversion rate it
     * can never appear in the numerator of. The rate was understated by exactly the DWY lead
     * volume, and then coloured red against a benchmark it was never measured against.
     *
     * ⭐ THE POPULATION IS DFY, and it is not a preference — `Dashboard.tsx` carries the
     * measured argument and four other sites already encode the same split (the perf badge
     * rule, `dataService`'s CPL-vs-CPA judgement, the DFY/DWY split immediately above). This
     * page disagreeing with the Dashboard on a headline conversion rate is the visible half;
     * the wrong denominator is the cause.
     *
     * ⚠️ `dfyAppts` is DFY-only on BOTH sides of the division now, and the scope line under
     * the bar says so instead of the old, wrong "Funnel conversion".
     */
    return {
      dfyAvgCPA: dfyAppts > 0 ? dfyPerfSpend / dfyAppts : 0,
      dfyAvgCPL: dfyPerfLeads > 0 ? dfyPerfSpend / dfyPerfLeads : 0,
      dwyAvgCPL: dwyPerfLeads > 0 ? dwyPerfSpend / dwyPerfLeads : 0,
      leadToAppt: dfyPerfLeads > 0 ? (dfyAppts / dfyPerfLeads) * 100 : 0,
      dwyExcluded: dwyAccounts.length,
      internalExcluded: activeAccounts.filter(a => a.program === 'Internal').length,
    };
  }, [filteredAccounts]);

  // The one sentence that names both narrowings, reused by every DFY-scoped element below so
  // three copies cannot drift into three different claims about the same population.
  const dfyScope = (() => {
    if (!stats) return 'Done For You accounts';
    const parts: string[] = [];
    if (stats.dwyExcluded > 0) parts.push(`${stats.dwyExcluded} Done-With-You`);
    if (stats.internalExcluded > 0) parts.push(`${stats.internalExcluded} Internal`);
    return parts.length > 0
      ? `Done For You accounts · ${parts.join(' and ')} excluded`
      : 'Done For You accounts';
  })();

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
  if (!configured) return <ConfigBanner origin={settingsOrigin} detail={settingsDetail} />;
  if (!hasUsableData(sources.meta.state)) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-foreground">Targets</h1>
        <HonestNumbersBanner messages={honestNumbers.messages} />
        <ErrorBanner message={`${sources.meta.label} is unavailable, and every figure on this page is calculated from it. Nothing is shown rather than shown as zero.`} />
      </div>
    );
  }
  if (!stats) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Targets</h1>
          <HonestNumbersBanner messages={honestNumbers.messages} />
          <p className="text-sm text-muted-foreground mt-1">How you're performing against your benchmarks</p>
        </div>
        <Combobox
          aria-label="Date range"
          value={datePreset}
          onChange={v => setDatePreset((v ?? 'all') as DatePreset)}
          options={[
            { value: 'all', label: 'All time' },
            { value: 'this_month', label: 'This month' },
            { value: 'last_month', label: 'Last month' },
            { value: 'last_3_months', label: 'Last 3 months' },
          ]}
          className="w-44"
        />
      </div>

      {/* Top summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card-elevated p-4">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">DFY Cost/Appt</p>
          <p className={`text-xl font-bold font-mono-tabular ${stats.dfyAvgCPA < 180 ? 'text-success' : stats.dfyAvgCPA <= 240 ? 'text-warning-strong' : 'text-destructive'}`}>{formatCurrency(stats.dfyAvgCPA)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">Target: under $180</p>
        </div>
        <div className="card-elevated p-4">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">DFY CPL</p>
          <p className={`text-xl font-bold font-mono-tabular ${stats.dfyAvgCPL < 35 ? 'text-success' : stats.dfyAvgCPL <= 55 ? 'text-warning-strong' : 'text-destructive'}`}>{formatCurrency(stats.dfyAvgCPL)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">Target: under $35</p>
        </div>
        <div className="card-elevated p-4">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Lead-to-Appt</p>
          <p className={`text-xl font-bold font-mono-tabular ${stats.leadToAppt >= 15 ? 'text-success' : stats.leadToAppt >= 5 ? 'text-warning-strong' : 'text-destructive'}`}>{formatPercent(stats.leadToAppt)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">Target: above 15%</p>
        </div>
      </div>

      {/* Metric bars */}
      <div className="space-y-4">
        <MetricBar
          label="Cost per appointment"
          scope={`${dfyScope} · target under $180`}
          value={stats.dfyAvgCPA}
          displayValue={formatCurrency(stats.dfyAvgCPA)}
          zones={[
            { flex: 180, color: 'bg-success', label: 'Under $180' },
            { flex: 60, color: 'bg-warning', label: '$180–240' },
            { flex: 160, color: 'bg-destructive', label: 'Above $240' },
          ]}
          scaleMax={400}
          scaleLabels={['$0', '$180', '$240', '$400']}
          description="Our primary metric for DFY accounts. If CPA is red, check: are leads converting to appointments (lead-to-appt %), or is CPL too high?"
        />
        <MetricBar
          label="Cost per lead"
          scope={`${dfyScope} · target under $35`}
          value={stats.dfyAvgCPL}
          displayValue={formatCurrency(stats.dfyAvgCPL)}
          zones={[
            { flex: 35, color: 'bg-success', label: 'Under $35' },
            { flex: 20, color: 'bg-warning', label: '$35–55' },
            { flex: 45, color: 'bg-destructive', label: 'Above $55' },
          ]}
          scaleMax={100}
          scaleLabels={['$0', '$35', '$55', '$100']}
          description="What each lead costs from Facebook. High CPL = ad creative or targeting issue. This is on the media buyer."
        />
        <MetricBar
          label="Lead-to-appointment rate"
          scope={`${dfyScope} · target above 15%`}
          value={stats.leadToAppt}
          displayValue={formatPercent(stats.leadToAppt)}
          zones={[
            { flex: 5, color: 'bg-destructive', label: 'Under 5%' },
            { flex: 10, color: 'bg-warning', label: '5–15%' },
            { flex: 35, color: 'bg-success', label: 'Above 15%' },
          ]}
          scaleMax={50}
          scaleLabels={['0%', '5%', '15%', '50%']}
          description="What percentage of leads turn into booked appointments. Low rate = either bad leads (media buyer) or weak follow-up (setter)."
        />
      </div>
    </div>
  );
}
