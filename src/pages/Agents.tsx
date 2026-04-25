import { useState, useMemo } from 'react';
import { useData } from '@/hooks/useData';
import { ConfigBanner } from '@/components/common/Banners';
import { formatCurrency, formatDate } from '@/lib/dataService';
import { ChevronLeft, ChevronRight, Copy, Check } from 'lucide-react';
import { endOfMonth, addMonths, subMonths, format, startOfMonth } from 'date-fns';

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

type PayPeriod = 'first' | 'second';

export default function Agents() {
  const { accounts, settings, configured } = useData();
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
        const d = parseDateSafe(appt.appointmentDate);
        if (!d) return false;
        return d >= periodRange.from && d <= periodRange.to;
      });
  }, [accounts, periodRange]);

  const setterGroups = useMemo(() => {
    const groups = new Map<string, typeof eligibleAppointments>();
    for (const appt of eligibleAppointments) {
      const setter = appt.setter?.trim() || '(Unknown)';
      if (!groups.has(setter)) groups.set(setter, []);
      groups.get(setter)!.push(appt);
    }
    const allowed = settings.activeSetters || [];
    return Array.from(groups.entries())
      .filter(([name]) => allowed.length === 0 || allowed.includes(name))
      .map(([name, appts]) => {
        const rateConfig = (settings.setterBonusRates || []).find(r => r.setterName === name);
        const rate = rateConfig?.rate ?? 5;
        return { name, appts, rate, total: appts.length * rate };
      })
      .sort((a, b) => b.total - a.total);
  }, [eligibleAppointments, settings.setterBonusRates, settings.activeSetters]);

  const grandTotal = useMemo(() => setterGroups.reduce((s, g) => s + g.total, 0), [setterGroups]);

  const handleExport = () => {
    const lines = [
      `Setter Payout — ${periodLabel}`,
      '',
      ...setterGroups.map(g => `${g.name}: ${g.appts.length} appointment${g.appts.length !== 1 ? 's' : ''} × $${g.rate} = ${formatCurrency(g.total)}`),
      '',
      `Total: ${formatCurrency(grandTotal)}`,
    ];
    navigator.clipboard.writeText(lines.join('\n'));
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

      {/* Setter cards */}
      {setterGroups.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          No valid appointments found for this pay period.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {setterGroups.map(({ name, appts, rate, total }) => (
            <div key={name} className="card-elevated p-5 space-y-4">
              {/* Setter header */}
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-bold shrink-0">
                  {name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">{name}</p>
                  <p className="text-xs text-muted-foreground">${rate}/appt bonus rate</p>
                </div>
                <div className="ml-auto text-right shrink-0">
                  <p className={`text-xl font-bold font-mono-tabular ${total > 0 ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                    {formatCurrency(total)}
                  </p>
                  <p className="text-xs text-muted-foreground">{appts.length} appt{appts.length !== 1 ? 's' : ''}</p>
                </div>
              </div>

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
