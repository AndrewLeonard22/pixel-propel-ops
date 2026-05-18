import { useState, useMemo } from 'react';
import { useData } from '@/hooks/useData';
import { X, PhoneCall } from 'lucide-react';
import type { CallRow, AppointmentRow } from '@/lib/types';
import {
  startOfDay, endOfDay,
  startOfWeek, endOfWeek,
  subDays, format,
} from 'date-fns';
import DateRangePicker, { type DateRange, thisMonthRange } from '@/components/DateRangePicker';
import { normalizeName, levenshteinSimilarity } from '@/lib/dataService';
import {
  BarChart, Bar, LabelList, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { useNavigate } from 'react-router-dom';

interface SetterStats {
  agentName: string;
  dialsMade: number;
  pickups: number;
  pickupPct: number;
  convos90Plus: number;
  convoPct: number;
  bookings: number;
  convoToBookPct: number;
  dialsPerBooking: number | null;
  avgTalkTime: number | null;
  avgCallGap: number | null;
}

function parseDateSafe(dateStr: string): Date | null {
  if (!dateStr) return null;
  // ISO date-only strings must be forced to local time to avoid UTC-offset shift
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return new Date(dateStr + 'T00:00:00');
  const normalized = dateStr.replace(/(\d+:\d+)(am|pm)/i, (_, time, ampm) => `${time} ${ampm.toUpperCase()}`);
  let d = new Date(normalized);
  if (!isNaN(d.getTime())) return d;
  const dateOnly = dateStr.replace(/\s+\d+:\d+\s*(am|pm)?\s*$/i, '').trim();
  if (dateOnly && dateOnly !== dateStr) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return new Date(dateOnly + 'T00:00:00');
    d = new Date(dateOnly);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function computeSetterStats(
  agentName: string,
  rows: CallRow[],
  agentAppts: AppointmentRow[],
): SetterStats {
  const dialsMade = rows.length;
  const noAnswers = rows.filter(r => (r.callDisposition || '').trim().toLowerCase() === 'no answer').length;
  const badNumbers = rows.filter(r => (r.callDisposition || '').trim().toLowerCase() === 'bad number').length;
  const pickups = dialsMade - noAnswers - badNumbers;
  const pickupPct = (dialsMade - badNumbers) > 0 ? (pickups / (dialsMade - badNumbers)) * 100 : 0;
  const convos90Plus = rows.filter(r => r.callDuration >= 90).length;
  const convoPct = pickups > 0 ? (convos90Plus / pickups) * 100 : 0;
  const bookings = agentAppts.length;
  const convoToBookPct = convos90Plus > 0 ? (bookings / convos90Plus) * 100 : 0;
  const dialsPerBooking = bookings > 0 ? dialsMade / bookings : null;

  const pickupRows = rows.filter(r => {
    const d = (r.callDisposition || '').trim().toLowerCase();
    return d !== 'no answer' && d !== 'bad number';
  });
  const avgTalkTime = pickupRows.length > 0
    ? pickupRows.reduce((s, r) => s + r.callDuration, 0) / pickupRows.length / 60
    : null;

  // end-of-call → start-of-next gap, capped at 60 min to exclude end-of-day breaks
  const sorted = [...rows]
    .map(r => ({ start: parseDateSafe(r.timestamp)?.getTime() ?? 0, dur: r.callDuration * 1000 }))
    .filter(r => r.start > 0)
    .sort((a, b) => a.start - b.start);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = (sorted[i].start - (sorted[i - 1].start + sorted[i - 1].dur)) / 60000;
    if (gap >= 0 && gap < 60) gaps.push(gap);
  }
  const avgCallGap = gaps.length > 0 ? gaps.reduce((s, g) => s + g, 0) / gaps.length : null;

  return {
    agentName, dialsMade, pickups, pickupPct,
    convos90Plus, convoPct, bookings, convoToBookPct,
    dialsPerBooking, avgTalkTime, avgCallGap,
  };
}

const CHART_COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#f97316', '#ec4899',
];

function pctColor(pct: number, good: number, ok: number): string {
  if (pct >= good) return 'text-emerald-600';
  if (pct >= ok) return 'text-yellow-500';
  return 'text-red-500';
}

function StatItem({ label, value, colorClass }: { label: string; value: string; colorClass?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">{label}</span>
      <span className={`text-sm font-bold font-mono-tabular leading-tight ${colorClass || 'text-foreground'}`}>{value}</span>
    </div>
  );
}

function SetterCard({ stats, onClick }: { stats: SetterStats; onClick: () => void }) {
  const f = (n: number) => n.toFixed(1);
  return (
    <div
      className="card-elevated cursor-pointer hover:ring-1 hover:ring-ring/20 transition-all overflow-hidden"
      onClick={onClick}
    >
      {/* Header: name + hero dials/bookings */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border/60">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold shrink-0">
            {(stats.agentName || '?').charAt(0).toUpperCase()}
          </div>
          <span className="font-semibold text-sm text-foreground">{stats.agentName}</span>
        </div>
        <div className="flex items-center gap-5">
          <div className="text-right">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none mb-0.5">Dials</p>
            <p className="text-xl font-bold font-mono-tabular text-foreground leading-none">{stats.dialsMade}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none mb-0.5">Bookings</p>
            <p className="text-xl font-bold font-mono-tabular text-emerald-600 leading-none">{stats.bookings}</p>
          </div>
        </div>
      </div>

      {/* 8-stat grid: 4 cols × 2 rows */}
      <div className="px-5 py-4 grid grid-cols-4 gap-x-3 gap-y-4">
        <StatItem label="Pickups" value={String(stats.pickups)} />
        <StatItem
          label="Pickup %"
          value={stats.dialsMade > 0 ? `${f(stats.pickupPct)}%` : '—'}
          colorClass={stats.dialsMade > 0 ? pctColor(stats.pickupPct, 25, 15) : undefined}
        />
        <StatItem label="90s+ Convos" value={String(stats.convos90Plus)} />
        <StatItem
          label="Convo %"
          value={stats.pickups > 0 ? `${f(stats.convoPct)}%` : '—'}
          colorClass={stats.pickups > 0 ? pctColor(stats.convoPct, 40, 20) : undefined}
        />
        <StatItem
          label="Talk Time"
          value={stats.avgTalkTime !== null ? `${f(stats.avgTalkTime)}m` : '—'}
        />
        <StatItem
          label="Call Gap"
          value={stats.avgCallGap !== null ? `${f(stats.avgCallGap)}m` : '—'}
        />
        <StatItem
          label="Convo→Book"
          value={stats.convos90Plus > 0 ? `${f(stats.convoToBookPct)}%` : '—'}
          colorClass={stats.convos90Plus > 0 ? pctColor(stats.convoToBookPct, 8, 3) : undefined}
        />
        <StatItem
          label="Dials/Book"
          value={stats.dialsPerBooking !== null ? f(stats.dialsPerBooking) : '—'}
        />
      </div>
    </div>
  );
}

function TrendChart({ callData, activeSetters, appointments }: {
  callData: CallRow[];
  activeSetters: string[];
  appointments: AppointmentRow[];
}) {
  const today = new Date();
  const todayStr = format(today, 'yyyy-MM-dd');

  const days = useMemo(
    () => Array.from({ length: 14 }, (_, i) => subDays(today, 13 - i)),
    [],
  );

  // Per-day per-setter dials + bookings
  const data = useMemo(() => {
    return days.map(date => {
      const dayStart = startOfDay(date);
      const dayEnd = endOfDay(date);
      const label = format(date, 'M/d');
      const isToday = format(date, 'yyyy-MM-dd') === todayStr;
      let totalDials = 0;
      let totalBookings = 0;
      const bySetterDials: Record<string, number> = {};
      const bySetterBookings: Record<string, number> = {};
      for (const setter of activeSetters) {
        const dials = callData.filter(r => {
          const d = parseDateSafe(r.timestamp);
          return d && d >= dayStart && d <= dayEnd && (r.agentName || '').trim() === setter;
        }).length;
        const normalizedSetter = normalizeName(setter);
        const bookings = appointments.filter(a => {
          const d = parseDateSafe(a.dateAdded || a.appointmentDate);
          return d && d >= dayStart && d <= dayEnd &&
            normalizeName((a.setter || '').trim()) === normalizedSetter;
        }).length;
        bySetterDials[setter] = dials;
        bySetterBookings[setter] = bookings;
        totalDials += dials;
        totalBookings += bookings;
      }
      return { label, isToday, bySetterDials, bySetterBookings, totalDials, totalBookings };
    });
  }, [callData, activeSetters, appointments, days]);

  if (activeSetters.length === 0) return null;

  // Flat data for the bar chart (one entry per day)
  const chartData = data.map(d => {
    const entry: Record<string, number | string> = { date: d.label, total: d.totalDials };
    for (const setter of activeSetters) entry[setter] = d.bySetterDials[setter] ?? 0;
    return entry;
  });

  // Column totals (all 14 days) per setter
  const setterTotals = Object.fromEntries(
    activeSetters.map(s => [
      s,
      {
        dials: data.reduce((n, d) => n + (d.bySetterDials[s] ?? 0), 0),
        bookings: data.reduce((n, d) => n + (d.bySetterBookings[s] ?? 0), 0),
      },
    ]),
  );
  const grandDials = data.reduce((n, d) => n + d.totalDials, 0);
  const grandBookings = data.reduce((n, d) => n + d.totalBookings, 0);

  return (
    <div className="card-elevated p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-semibold text-foreground">Daily Activity — Last 14 Days</h2>
        <div className="flex items-center gap-4">
          {activeSetters.map((s, i) => (
            <div key={s} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
              <span className="text-[11px] text-muted-foreground">{s.split(' ')[0]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Stacked bar chart */}
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={chartData} margin={{ top: 18, right: 4, left: -22, bottom: 0 }} barCategoryGap="30%">
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10 }} allowDecimals={false} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))' }} cursor={{ fill: 'hsl(var(--accent))', opacity: 0.4 }} />
          {activeSetters.map((s, i) => {
            const isTop = i === activeSetters.length - 1;
            return (
              <Bar key={s} dataKey={s} stackId="s" fill={CHART_COLORS[i % CHART_COLORS.length]} radius={isTop ? [3, 3, 0, 0] : [0, 0, 0, 0]}>
                {isTop && (
                  <LabelList dataKey="total" position="top" style={{ fontSize: 10, fontWeight: 600, fill: 'hsl(var(--muted-foreground))' }} formatter={(v: number) => v > 0 ? v : ''} />
                )}
              </Bar>
            );
          })}
        </BarChart>
      </ResponsiveContainer>

      {/* Horizontal breakdown — dates as columns, setters as rows */}
      <div className="mt-5 overflow-x-auto">
        <table className="border-collapse text-xs w-full" style={{ minWidth: `${14 * 40 + 160}px` }}>
          {/* Date header row */}
          <thead>
            <tr className="border-b-2 border-border">
              <th className="text-left pb-2 pr-2 w-20 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Setter</th>
              <th className="text-left pb-2 pr-3 w-16 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"></th>
              {data.map((d, i) => (
                <th key={i} className={`text-center pb-2 px-1 text-[10px] font-semibold min-w-[36px] ${d.isToday ? 'text-primary' : 'text-muted-foreground'}`}>
                  {d.label}
                  {d.isToday && <div className="w-1 h-1 rounded-full bg-primary mx-auto mt-0.5" />}
                </th>
              ))}
              <th className="text-center pb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-l border-border">Total</th>
            </tr>
          </thead>
          <tbody>
            {/* One dials row + one bookings row per setter */}
            {activeSetters.flatMap((setter, si) => {
              const color = CHART_COLORS[si % CHART_COLORS.length];
              const totals = setterTotals[setter];
              const isLastSetter = si === activeSetters.length - 1;
              return [
                // Dials row
                <tr key={`${setter}-d`} className="border-b border-border/30">
                  <td className="py-1.5 pr-2 font-semibold text-foreground text-xs">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: color }} />
                      {setter.split(' ')[0]}
                    </div>
                  </td>
                  <td className="py-1.5 pr-3 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Dials</td>
                  {data.map((d, di) => {
                    const v = d.bySetterDials[setter] ?? 0;
                    return (
                      <td key={di} className={`text-center px-1 py-1.5 font-mono-tabular ${d.isToday ? 'bg-primary/5' : ''} ${v === 0 ? 'text-muted-foreground/25' : 'text-foreground'}`}>
                        {v > 0 ? v : '—'}
                      </td>
                    );
                  })}
                  <td className="text-center px-3 py-1.5 font-mono-tabular font-semibold text-foreground border-l border-border">
                    {totals.dials || '—'}
                  </td>
                </tr>,
                // Bookings row
                <tr key={`${setter}-b`} className={isLastSetter ? 'border-b-2 border-border' : 'border-b border-border'}>
                  <td className="py-1 pr-2" />
                  <td className="py-1 pr-3 text-[10px] font-medium text-emerald-600 uppercase tracking-wider">Booked</td>
                  {data.map((d, di) => {
                    const v = d.bySetterBookings[setter] ?? 0;
                    return (
                      <td key={di} className={`text-center px-1 py-1 font-mono-tabular ${d.isToday ? 'bg-primary/5' : ''} ${v === 0 ? 'text-muted-foreground/25' : 'text-emerald-600 font-semibold'}`}>
                        {v > 0 ? v : '—'}
                      </td>
                    );
                  })}
                  <td className="text-center px-3 py-1 font-mono-tabular font-semibold text-emerald-600 border-l border-border">
                    {totals.bookings > 0 ? totals.bookings : '—'}
                  </td>
                </tr>,
              ];
            })}
            {/* Totals rows */}
            <tr className="bg-muted/30 border-b border-border/40">
              <td className="py-1.5 pr-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total</td>
              <td className="py-1.5 pr-3 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Dials</td>
              {data.map((d, di) => (
                <td key={di} className={`text-center px-1 py-1.5 font-mono-tabular font-semibold ${d.isToday ? 'bg-primary/10' : ''} ${d.totalDials === 0 ? 'text-muted-foreground/25' : 'text-foreground'}`}>
                  {d.totalDials > 0 ? d.totalDials : '—'}
                </td>
              ))}
              <td className="text-center px-3 py-1.5 font-mono-tabular font-bold text-foreground border-l border-border">{grandDials || '—'}</td>
            </tr>
            <tr className="bg-muted/30">
              <td className="py-1 pr-2" />
              <td className="py-1 pr-3 text-[10px] font-medium text-emerald-600 uppercase tracking-wider">Booked</td>
              {data.map((d, di) => (
                <td key={di} className={`text-center px-1 py-1 font-mono-tabular font-semibold ${d.isToday ? 'bg-primary/10' : ''} ${d.totalBookings === 0 ? 'text-muted-foreground/25' : 'text-emerald-600'}`}>
                  {d.totalBookings > 0 ? d.totalBookings : '—'}
                </td>
              ))}
              <td className="text-center px-3 py-1 font-mono-tabular font-bold text-emerald-600 border-l border-border">
                {grandBookings > 0 ? grandBookings : '—'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SetterDetailPanel({
  agentName,
  filteredCalls,
  filteredAppts,
  allCalls,
  dateLabel,
  onClose,
}: {
  agentName: string;
  filteredCalls: CallRow[];
  filteredAppts: AppointmentRow[];
  allCalls: CallRow[];
  dateLabel: string;
  onClose: () => void;
}) {
  const stats = computeSetterStats(agentName, filteredCalls, filteredAppts);
  const f = (n: number) => n.toFixed(1);

  const byAccount = useMemo(() => {
    // Group dials keyed by normalizeName(ghlLocationName) so "&"/"and" etc. collapse
    const map = new Map<string, { dials: number; rawName: string }>();
    for (const call of filteredCalls) {
      const rawName = (call.ghlLocationName || '').trim() || '(Unknown)';
      const key = normalizeName(rawName) || rawName.toLowerCase();
      const entry = map.get(key) || { dials: 0, rawName };
      entry.dials++;
      map.set(key, entry);
    }

    // Match appt.client → account via exact-normalized then fuzzy fallback
    const bookedByKey = new Map<string, number>();
    const accountKeys = Array.from(map.keys());
    for (const appt of filteredAppts) {
      const client = (appt.client || '').trim();
      if (!client) continue;
      const normalizedClient = normalizeName(client);

      // Exact match after normalization
      if (map.has(normalizedClient)) {
        bookedByKey.set(normalizedClient, (bookedByKey.get(normalizedClient) ?? 0) + 1);
        continue;
      }

      // Fuzzy fallback (same thresholds as dial matching in dataService)
      const scores = accountKeys
        .map(k => ({ key: k, score: levenshteinSimilarity(normalizedClient, k) }))
        .sort((a, b) => b.score - a.score);
      if (scores.length > 0 && scores[0].score >= 0.75) {
        const secondScore = scores.length > 1 ? scores[1].score : 0;
        if (scores[0].score - secondScore >= 0.10) {
          bookedByKey.set(scores[0].key, (bookedByKey.get(scores[0].key) ?? 0) + 1);
        }
      }
    }

    return Array.from(map.entries())
      .map(([key, v]) => {
        const booked = bookedByKey.get(key) ?? 0;
        return {
          name: v.rawName,
          dials: v.dials,
          booked,
          dialsPerBooking: booked > 0 ? (v.dials / booked).toFixed(1) : '—',
        };
      })
      .sort((a, b) => b.dials - a.dials);
  }, [filteredCalls, filteredAppts]);

  const last30 = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 30 }, (_, i) => {
      const date = subDays(today, 29 - i);
      const dayStart = startOfDay(date);
      const dayEnd = endOfDay(date);
      return {
        date: format(date, 'MMM d'),
        dials: allCalls.filter(r => {
          const d = parseDateSafe(r.timestamp);
          return d && d >= dayStart && d <= dayEnd && (r.agentName || '').trim() === agentName;
        }).length,
      };
    });
  }, [allCalls, agentName]);

  const kpis = [
    { label: 'Dials Made', value: String(stats.dialsMade) },
    { label: 'Pickups', value: String(stats.pickups) },
    { label: 'Pickup %', value: stats.dialsMade > 0 ? `${f(stats.pickupPct)}%` : '—' },
    { label: '90+ Second Convos', value: String(stats.convos90Plus) },
    { label: 'Convo %', value: stats.pickups > 0 ? `${f(stats.convoPct)}%` : '—' },
    { label: 'Avg Talk Time', value: stats.avgTalkTime !== null ? `${f(stats.avgTalkTime)} min` : '—' },
    { label: 'Avg Call Gap', value: stats.avgCallGap !== null ? `${f(stats.avgCallGap)} min` : '—' },
    { label: 'Bookings', value: String(stats.bookings) },
    { label: 'Convo-to-Book %', value: stats.convos90Plus > 0 ? `${f(stats.convoToBookPct)}%` : '—' },
    { label: 'Dials Per Booking', value: stats.dialsPerBooking !== null ? f(stats.dialsPerBooking) : '—' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full sm:max-w-lg bg-card border-l shadow-xl overflow-y-auto animate-in slide-in-from-right duration-300"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-card border-b px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">{agentName}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{stats.dialsMade} dials · {dateLabel}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted transition-colors">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* KPI summary */}
          <div className="grid grid-cols-2 gap-3">
            {kpis.map(({ label, value }, i) => (
              <div key={label} className={`card-elevated p-3 ${i === kpis.length - 1 && kpis.length % 2 !== 0 ? 'col-span-2' : ''}`}>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
                <p className="text-lg font-bold font-mono-tabular text-foreground">{value}</p>
              </div>
            ))}
          </div>

          {/* Dials by Account */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">Dials by Account</h3>
            {byAccount.length === 0 ? (
              <p className="text-sm text-muted-foreground">No data for this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide border-b border-border" style={{ height: 32 }}>
                      <th className="text-left px-2 align-middle">Account</th>
                      <th className="text-right px-2 align-middle">Dials</th>
                      <th className="text-right px-2 align-middle">Booked</th>
                      <th className="text-right px-2 align-middle">Dials/Book</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byAccount.map(row => (
                      <tr key={row.name} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="px-2 py-2 font-medium">{row.name}</td>
                        <td className="px-2 py-2 text-right font-mono-tabular">{row.dials}</td>
                        <td className="px-2 py-2 text-right font-mono-tabular">{row.booked}</td>
                        <td className="px-2 py-2 text-right font-mono-tabular text-muted-foreground">{row.dialsPerBooking}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Last 30 Days sparkline */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">Last 30 Days</h3>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={last30} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={6} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                <Line type="monotone" dataKey="dials" stroke="#6366f1" strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CallCenter() {
  const { callData, appointments, settings, loading } = useData();
  const navigate = useNavigate();

  const [dateRange, setDateRange] = useState<DateRange>(thisMonthRange);
  const [selectedSetter, setSelectedSetter] = useState<string | null>(null);

  const activeSetters = useMemo(() => {
    const names = new Set<string>();
    for (const row of callData) {
      const name = (row.agentName || '').trim();
      if (name) names.add(name);
    }
    const allNames = Array.from(names).sort();
    const inactive = settings.inactiveSetters || [];
    if (inactive.length === 0) return allNames;
    return allNames.filter(n => !inactive.includes(n));
  }, [callData, settings.inactiveSetters]);

  const dateLabel = dateRange.label;

  const filteredCalls = useMemo(() => {
    const { from, to } = dateRange;
    if (!from && !to) return callData;
    return callData.filter(row => {
      const d = parseDateSafe(row.timestamp);
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [callData, dateRange]);

  // Appointments filtered to the active date range (by dateAdded or appointmentDate)
  const rangeAppts = useMemo(() => {
    const { from, to } = dateRange;
    return appointments.filter(a => {
      const d = parseDateSafe(a.dateAdded || a.appointmentDate);
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [appointments, dateRange]);

  const todayCalls = useMemo(() => {
    const now = new Date();
    const dayStart = startOfDay(now);
    const dayEnd = endOfDay(now);
    return callData.filter(row => {
      const d = parseDateSafe(row.timestamp);
      return d !== null && d >= dayStart && d <= dayEnd;
    });
  }, [callData]);

  // Today's appointments booked (by setter)
  const todayBookedByAgent = useMemo(() => {
    const now = new Date();
    const dayStart = startOfDay(now);
    const dayEnd = endOfDay(now);
    const map = new Map<string, number>();
    for (const a of appointments) {
      const d = parseDateSafe(a.dateAdded || a.appointmentDate);
      if (!d || d < dayStart || d > dayEnd) continue;
      const setter = (a.setter || '').trim();
      if (!setter) continue;
      map.set(setter, (map.get(setter) ?? 0) + 1);
    }
    return map;
  }, [appointments]);

  const setterStats = useMemo(() => {
    const callGroups = new Map<string, CallRow[]>();
    for (const setter of activeSetters) callGroups.set(setter, []);
    for (const call of filteredCalls) {
      const name = (call.agentName || '').trim();
      if (callGroups.has(name)) callGroups.get(name)!.push(call);
    }
    return Array.from(callGroups.entries())
      .map(([name, rows]) => {
        const normalizedName = normalizeName(name);
        const agentAppts = rangeAppts.filter(
          a => normalizeName((a.setter || '').trim()) === normalizedName
        );
        return computeSetterStats(name, rows, agentAppts);
      })
      .sort((a, b) => b.dialsMade - a.dialsMade);
  }, [filteredCalls, rangeAppts, activeSetters]);

  const todayStatsByAgent = useMemo(() => {
    const map = new Map<string, { dials: number; booked: number }>();
    for (const call of todayCalls) {
      const name = (call.agentName || '').trim();
      if (!name) continue;
      const entry = map.get(name) || { dials: 0, booked: 0 };
      entry.dials++;
      map.set(name, entry);
    }
    // Merge today's booked appointments — match setter name to call-center agent name
    // using normalizeName so minor spelling/punctuation differences don't break it
    for (const [setter, count] of todayBookedByAgent) {
      const normalizedSetter = normalizeName(setter);
      let matchedKey: string | null = map.has(setter) ? setter : null;
      if (!matchedKey) {
        for (const k of map.keys()) {
          if (normalizeName(k) === normalizedSetter) { matchedKey = k; break; }
        }
      }
      const key = matchedKey ?? setter;
      const entry = map.get(key) || { dials: 0, booked: 0 };
      entry.booked = count;
      map.set(key, entry);
    }
    return map;
  }, [todayCalls, todayBookedByAgent]);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-bold">Call Center</h1>
        <div className="flex flex-wrap gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card-elevated h-24 w-40 animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card-elevated h-40 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!settings.callCenterSheetUrl || callData.length === 0) {
    return (
      <div className="max-w-lg mx-auto mt-20 text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto">
          <PhoneCall className="w-8 h-8 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">No call data yet</h2>
        <p className="text-sm text-muted-foreground">
          {!settings.callCenterSheetUrl
            ? 'Connect your call center sheet in Settings to see setter performance.'
            : 'No call records found. Check that your call center sheet URL and tab name are correct.'}
        </p>
        <button
          onClick={() => navigate('/settings')}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
        >
          Go to Settings
        </button>
      </div>
    );
  }

  const selectedSetterCalls = selectedSetter
    ? filteredCalls.filter(r => (r.agentName || '').trim() === selectedSetter)
    : [];

  const selectedSetterAppts = selectedSetter
    ? rangeAppts.filter(a => (a.setter || '').trim().toLowerCase() === selectedSetter.toLowerCase())
    : [];

  return (
    <div className="space-y-8 max-w-[1400px]">
      {/* Page header + date filter */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Call Center</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Setter activity and performance</p>
        </div>
        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      {/* SECTION 1 — Today's Snapshot */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Today's Snapshot</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <div className="card-elevated p-4">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Total Dials</p>
            <p className="kpi-number text-foreground leading-none">{todayCalls.length}</p>
          </div>
          {activeSetters.map(setter => {
            const s = todayStatsByAgent.get(setter) || { dials: 0, booked: 0 };
            return (
              <div key={setter} className="card-elevated p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-[10px] font-bold shrink-0">
                    {setter.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-xs font-semibold truncate text-foreground">{setter}</span>
                </div>
                <div className="flex gap-4">
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none mb-1">Dials</p>
                    <p className="text-xl font-bold font-mono-tabular text-foreground leading-none">{s.dials}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none mb-1">Booked</p>
                    <p className="text-xl font-bold font-mono-tabular text-emerald-600 leading-none">{s.booked}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* SECTION 2 — Setter Performance Grid */}
      <section>
        <div className="mb-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Setter Performance</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{dateLabel}</p>
        </div>
        {setterStats.length === 0 || setterStats.every(s => s.dialsMade === 0) ? (
          <p className="text-sm text-muted-foreground text-center py-10">No calls in this date range.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {setterStats.map(stats => (
              <SetterCard
                key={stats.agentName}
                stats={stats}
                onClick={() => setSelectedSetter(stats.agentName)}
              />
            ))}
          </div>
        )}
      </section>

      {/* SECTION 3 — 14-Day Trend */}
      <TrendChart callData={callData} activeSetters={activeSetters} appointments={appointments} />

      {/* Setter Detail Panel */}
      {selectedSetter && (
        <SetterDetailPanel
          agentName={selectedSetter}
          filteredCalls={selectedSetterCalls}
          filteredAppts={selectedSetterAppts}
          allCalls={callData}
          dateLabel={dateLabel}
          onClose={() => setSelectedSetter(null)}
        />
      )}
    </div>
  );
}
