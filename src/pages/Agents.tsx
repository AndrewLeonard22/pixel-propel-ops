import { useState, useMemo } from 'react';
import { useData } from '@/hooks/useData';
import { hasUsableData } from '@/lib/sourceStatus';
import { ConfigBanner } from '@/components/common/Banners';
import { formatCurrency, formatDate } from '@/lib/dataService';
import { ChevronLeft, ChevronRight, Copy, Check, AlertTriangle } from 'lucide-react';
import { endOfMonth, addMonths, subMonths, format, startOfMonth } from 'date-fns';
// ⑤ one of the six divergent parseDateSafe copies, replaced by the shared parser.
// The local copy handed ISO strings to `new Date()`, which reads them as UTC midnight
// and renders the PREVIOUS calendar day west of UTC.
import { parseSourceDate } from '@/lib/dates';
// ⑦ the payout arithmetic, moved out of this component so it can be tested at all.
import { computeSetterPayouts, formatPayoutExport } from '@/lib/payout';

type PayPeriod = 'first' | 'second';

export default function Agents() {
  const { accounts, settings, configured, sources } = useData();
  // 🔴 Payouts are derived ENTIRELY from Airtable appointments. If that source did not
  // answer, an empty setter list is UNKNOWN, not zero — and "No valid appointments
  // found" would be the same lie BIRD-008 caught on the dashboard, on this page.
  const apptsOk = hasUsableData(sources.airtable.state);
  const [payPeriod, setPayPeriod] = useState<PayPeriod>('first');
  const [viewDate, setViewDate] = useState(() => startOfMonth(new Date()));
  const [copied, setCopied] = useState(false);

  const periodRange = useMemo(() => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    if (payPeriod === 'first') {
      return {
        from: new Date(year, month, 1),
        to: new Date(year, month, 15, 23, 59, 59),
      };
    }
    return {
      from: new Date(year, month, 16),
      to: endOfMonth(viewDate),
    };
  }, [payPeriod, viewDate]);

  const periodLabel = useMemo(() => {
    const lastDay = endOfMonth(viewDate).getDate();
    return payPeriod === 'first'
      ? `${format(viewDate, 'MMMM yyyy')} 1–15`
      : `${format(viewDate, 'MMMM yyyy')} 16–${lastDay}`;
  }, [payPeriod, viewDate]);

  const eligibleAppointments = useMemo(() => {
    return accounts
      .flatMap(a => a.appointmentList)
      .filter(appt => {
        if ((appt.leadValid || '').toLowerCase() !== 'valid') return false;
        const d = parseSourceDate(appt.appointmentDate);
        if (!d) return false;
        return d >= periodRange.from && d <= periodRange.to;
      });
  }, [accounts, periodRange]);

  const payout = useMemo(
    () => computeSetterPayouts(eligibleAppointments, settings),
    [eligibleAppointments, settings],
  );

  const setterGroups = payout.rows;
  // Only PAYABLE rows count. The (Unknown) bucket is shown but not paid.
  const grandTotal = payout.payableTotal;

  const handleExport = () => {
    navigator.clipboard.writeText(
      formatPayoutExport(payout, periodLabel, formatCurrency),
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!configured) return <ConfigBanner />;

  return (
    <div className="space-y-6">
      {/* Header + controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Agents</h1>
          <p className="text-sm text-muted-foreground mt-1">Setter bonus payouts</p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Month navigation */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setViewDate(d => subMonths(d, 1))}
              className="p-1.5 rounded hover:bg-accent transition-colors"
            >
              <ChevronLeft className="w-4 h-4 text-muted-foreground" />
            </button>
            <span className="text-sm font-medium w-32 text-center">{format(viewDate, 'MMMM yyyy')}</span>
            <button
              onClick={() => setViewDate(d => addMonths(d, 1))}
              className="p-1.5 rounded hover:bg-accent transition-colors"
            >
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>

          {/* Period toggle */}
          <div className="flex rounded-lg border overflow-hidden">
            <button
              onClick={() => setPayPeriod('first')}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${payPeriod === 'first' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-accent'}`}
            >
              1st – 15th
            </button>
            <button
              onClick={() => setPayPeriod('second')}
              className={`px-3 py-1.5 text-sm font-medium transition-colors border-l ${payPeriod === 'second' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-accent'}`}
            >
              16th – end
            </button>
          </div>
        </div>
      </div>

      {/* ⑦ The config-wipe signature: every rate on screen is invented. Say so ONCE,
           loudly, because the per-card note is easy to read past. */}
      {payout.allRatesFabricated && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-amber-700">No setter bonus rates are configured.</p>
            <p className="text-amber-700/90 mt-0.5">
              Every amount below uses the $5 default, which nobody set. Set the real rates in
              Settings before paying out.
            </p>
          </div>
        </div>
      )}

      {/* Setter cards */}
      {!apptsOk ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
          <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-destructive">
              {sources.airtable.label} — {sources.airtable.state === 'not-configured'
                ? `not connected. Missing: ${sources.airtable.missingSettings.join(', ')}.`
                : `could not load${sources.airtable.error ? `: ${sources.airtable.error}` : ''}.`}
            </p>
            <p className="text-destructive/90 mt-0.5">
              Payouts are calculated from appointments, so none can be shown. This is
              unknown, not zero — do not read it as "nobody is owed anything".
            </p>
          </div>
        </div>
      ) : setterGroups.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          No valid appointments in this pay period. Appointments loaded correctly — this
          is a real zero.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {setterGroups.map(({ name, appointments: appts, rate, total, rateSource, payable, warning }) => (
            <div key={name} className="card-elevated p-5 space-y-4">
              {/* Setter header */}
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-bold shrink-0">
                  {name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">{name}</p>
                  <p className="text-xs text-muted-foreground">
                    ${rate}/appt bonus rate
                    {rateSource === 'fallback' && (
                      <span className="ml-1 text-amber-600 font-medium">(default — not configured)</span>
                    )}
                  </p>
                </div>
                <div className="ml-auto text-right shrink-0">
                  <p className={`text-xl font-bold font-mono-tabular ${total > 0 ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                    {formatCurrency(total)}
                  </p>
                  <p className="text-xs text-muted-foreground">{appts.length} appt{appts.length !== 1 ? 's' : ''}</p>
                </div>
              </div>

              {/* ⑦ why this row is not trustworthy, at the row it applies to */}
              {warning && (
                <div className={`flex items-start gap-1.5 text-xs rounded px-2 py-1.5 ${payable ? 'bg-amber-500/10 text-amber-700' : 'bg-destructive/10 text-destructive'}`}>
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{warning}</span>
                </div>
              )}

              {/* Stats row */}
              <div className="flex gap-6 text-xs">
                <div>
                  <p className="text-muted-foreground">Eligible Appts</p>
                  <p className="font-mono-tabular font-semibold text-sm mt-0.5">{appts.length}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Bonus Rate</p>
                  <p className="font-mono-tabular font-semibold text-sm mt-0.5">{formatCurrency(rate)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Amount Owed</p>
                  <p className={`font-mono-tabular font-semibold text-sm mt-0.5 ${total > 0 ? 'text-emerald-600' : ''}`}>{formatCurrency(total)}</p>
                </div>
              </div>

              {/* Appointment mini list */}
              <div className="border-t border-border pt-3">
                <div className="space-y-1.5 max-h-[140px] overflow-y-auto">
                  {appts.map((appt, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-foreground truncate">{appt.client || '—'}</span>
                      <span className="text-muted-foreground font-mono-tabular shrink-0 ml-2">{formatDate(appt.appointmentDate)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Payout summary bar */}
      <div className="card-elevated border p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs text-muted-foreground">Total payout — {periodLabel}</p>
          <p className={`text-2xl font-bold font-mono-tabular mt-0.5 ${grandTotal > 0 ? 'text-emerald-600' : 'text-foreground'}`}>
            {formatCurrency(grandTotal)}
          </p>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border hover:bg-accent transition-colors"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
          {copied ? 'Copied!' : 'Export'}
        </button>
      </div>
    </div>
  );
}
