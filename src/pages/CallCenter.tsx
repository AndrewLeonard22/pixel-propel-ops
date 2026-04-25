import { useState, useMemo } from 'react';
import { useData } from '@/hooks/useData';
import { X, PhoneCall } from 'lucide-react';
import type { CallRow, AppSettings } from '@/lib/types';
import {
  startOfDay, endOfDay,
  startOfWeek, endOfWeek,
  startOfMonth, endOfMonth,
  subMonths, subDays, format,
} from 'date-fns';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { useNavigate } from 'react-router-dom';

type DatePreset = 'today' | 'this_week' | 'this_month' | 'last_month' | 'custom';

interface SetterStats {
  agentName: string;
  totalDials: number;
  pickups: number;
  pickupPct: number;
  conversations: number;
  convoPct: number;
  bookedAppts: number;
  abrPct: number;
  dialsPerBooking: number | null;
  avgTalkTime: number | null; // minutes
}

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

function isPickup(disposition: string): boolean {
  const d = (disposition || '').toLowerCase().trim();
  return d !== 'no answer' && d !== 'voicemail' && d !== '';
}

function computeSetterStats(agentName: string, rows: CallRow[]): SetterStats {
  const totalDials = rows.length;
  const pickupRows = rows.filter(r => isPickup(r.callDisposition));
  const pickups = pickupRows.length;
  const pickupPct = totalDials > 0 ? (pickups / totalDials) * 100 : 0;
  const conversations = pickupRows.filter(r => r.callDuration >= 90).length;
  const convoPct = pickups > 0 ? (conversations / pickups) * 100 : 0;
  const bookedAppts = rows.filter(r => (r.callDisposition || '').toLowerCase().includes('booked')).length;
  const abrPct = pickups > 0 ? (bookedAppts / pickups) * 100 : 0;
  const dialsPerBooking = bookedAppts > 0 ? totalDials / bookedAppts : null;
  const avgTalkTime = pickups > 0
    ? pickupRows.reduce((s, r) => s + r.callDuration, 0) / pickups / 60
    : null;
  return { agentName, totalDials, pickups, pickupPct, conversations, convoPct, bookedAppts, abrPct, dialsPerBooking, avgTalkTime };
}

function getAccountNameForLocation(ghlLocationName: string, settings: AppSettings): string {
  const key = (ghlLocationName || '').trim().toLowerCase();
  if (!key) return '(Unknown)';
  const match = settings.accountAliases.find(a => {
    const sheetKey = (a.sheetName || '').trim().toLowerCase();
    const airtableKey = (a.airtableName || '').trim().toLowerCase();
    return sheetKey === key || airtableKey === key ||
      sheetKey.includes(key) || key.includes(sheetKey);
  });
  return match?.sheetName || ghlLocationName;
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
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
      <span className={`text-sm font-bold font-mono-tabular ${colorClass || 'text-foreground'}`}>{value}</span>
    </div>
  );
}

function SetterCard({ stats, onClick }: { stats: SetterStats; onClick: () => void }) {
  const f = (n: number) => n.toFixed(1);
  return (
    <div
      className="card-elevated p-5 cursor-pointer hover:ring-1 hover:ring-ring/20 transition-all"
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold shrink-0">
            {(stats.agentName || '?').charAt(0).toUpperCase()}
          </div>
          <span className="font-semibold text-sm text-foreground">{stats.agentName}</span>
        </div>
        <PhoneCall className="w-4 h-4 text-muted-foreground" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatItem label="Dials Made" value={String(stats.totalDials)} />
        <StatItem label="Avg Talk Time" value={stats.avgTalkTime !== null ? `${f(stats.avgTalkTime)}m` : '—'} />
        <StatItem
          label="Pickup %"
          value={stats.totalDials > 0 ? `${f(stats.pickupPct)}%` : '—'}
          colorClass={stats.totalDials > 0 ? pctColor(stats.pickupPct, 25, 15) : undefined}
        />
        <StatItem
          label="Convo %"
          value={stats.pickups > 0 ? `${f(stats.convoPct)}%` : '—'}
          colorClass={stats.pickups > 0 ? pctColor(stats.convoPct, 40, 20) : undefined}
        />
        <StatItem label="Booked Appts" value={String(stats.bookedAppts)} />
        <StatItem
          label="ABR %"
          value={stats.pickups > 0 ? `${f(stats.abrPct)}%` : '—'}
          colorClass={stats.pickups > 0 ? pctColor(stats.abrPct, 8, 3) : undefined}
        />
        <StatItem
          label="Dials Per Booking"
          value={stats.dialsPerBooking !== null ? f(stats.dialsPerBooking) : '—'}
        />
      </div>
    </div>
  );
}

function TrendChart({ callData, activeSetters }: { callData: CallRow[]; activeSetters: string[] }) {
  const chartData = useMemo(() => {
    const today = new Date();
    const dates = Array.from({ length: 14 }, (_, i) => subDays(today, 13 - i));
    return dates.map(date => {
      const dayStart = startOfDay(date);
      const dayEnd = endOfDay(date);
      const entry: Record<string, number | string> = { date: format(date, 'MMM d') };
      for (const setter of activeSetters) {
        entry[setter] = callData.filter(r => {
          const d = parseDateSafe(r.timestamp);
          return d && d >= dayStart && d <= dayEnd && (r.agentName || '').trim() === setter;
        }).length;
      }
      return entry;
    });
  }, [callData, activeSetters]);

  if (activeSetters.length === 0) return null;

  return (
    <div className="card-elevated p-5">
      <h2 className="text-sm font-semibold text-foreground mb-4">Daily Dials — Last 14 Days</h2>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} verticalAlign="top" />
          {activeSetters.map((setter, i) => (
            <Line
              key={setter}
              type="monotone"
              dataKey={setter}
              stroke={CHART_COLORS[i % CHART_COLORS.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function SetterDetailPanel({
  agentName,
  filteredCalls,
  allCalls,
  settings,
  dateLabel,
  onClose,
}: {
  agentName: string;
  filteredCalls: CallRow[];
  allCalls: CallRow[];
  settings: AppSettings;
  dateLabel: string;
  onClose: () => void;
}) {
  const stats = computeSetterStats(agentName, filteredCalls);
  const f = (n: number) => n.toFixed(1);

  const byAccount = useMemo(() => {
    const map = new Map<string, { dials: number; booked: number }>();
    for (const call of filteredCalls) {
      const loc = (call.ghlLocationName || '').trim();
      const name = getAccountNameForLocation(loc, settings);
      const entry = map.get(name) || { dials: 0, booked: 0 };
      entry.dials++;
      if ((call.callDisposition || '').toLowerCase().includes('booked')) entry.booked++;
      map.set(name, entry);
    }
    return Array.from(map.entries())
      .map(([name, v]) => ({
        name,
        dials: v.dials,
        booked: v.booked,
        dialsPerBooking: v.booked > 0 ? (v.dials / v.booked).toFixed(1) : '—',
      }))
      .sort((a, b) => b.dials - a.dials);
  }, [filteredCalls, settings]);

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
    { label: 'Dials Made', value: String(stats.totalDials) },
    { label: 'Avg Talk Time', value: stats.avgTalkTime !== null ? `${f(stats.avgTalkTime)} min` : '—' },
    { label: 'Pickups', value: stats.totalDials > 0 ? `${stats.pickups} (${f(stats.pickupPct)}%)` : '—' },
    { label: 'Conversations (90s+)', value: stats.pickups > 0 ? `${stats.conversations} (${f(stats.convoPct)}%)` : '—' },
    { label: 'Booked Appts', value: String(stats.bookedAppts) },
    { label: 'ABR %', value: stats.pickups > 0 ? `${f(stats.abrPct)}%` : '—' },
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
            <p className="text-xs text-muted-foreground mt-0.5">{stats.totalDials} dials · {dateLabel}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted transition-colors">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* KPI summary */}
          <div className="grid grid-cols-2 gap-3">
            {kpis.map(({ label, value }) => (
              <div key={label} className="card-elevated p-3">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">{label}</p>
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
  const { callData, settings, loading } = useData();
  const navigate = useNavigate();

  const [datePreset, setDatePreset] = useState<DatePreset>('this_month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [selectedSetter, setSelectedSetter] = useState<string | null>(null);

  const activeSetters = useMemo(() => {
    const names = new Set<string>();
    for (const row of callData) {
      const name = (row.agentName || '').trim();
      if (name) names.add(name);
    }
    return Array.from(names).sort();
  }, [callData]);

  const dateRange = useMemo(() => {
    const now = new Date();
    switch (datePreset) {
      case 'today':
        return { from: startOfDay(now), to: endOfDay(now) };
      case 'this_week':
        return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) };
      case 'this_month':
        return { from: startOfMonth(now), to: endOfMonth(now) };
      case 'last_month': {
        const last = subMonths(now, 1);
        return { from: startOfMonth(last), to: endOfMonth(last) };
      }
      case 'custom':
        return {
          from: customFrom ? startOfDay(new Date(customFrom + 'T00:00:00')) : undefined,
          to: customTo ? endOfDay(new Date(customTo + 'T00:00:00')) : undefined,
        };
    }
  }, [datePreset, customFrom, customTo]);

  const dateLabel = useMemo(() => {
    const now = new Date();
    switch (datePreset) {
      case 'today': return format(now, 'MMMM d, yyyy');
      case 'this_week': return `Week of ${format(startOfWeek(now, { weekStartsOn: 1 }), 'MMM d, yyyy')}`;
      case 'this_month': return format(now, 'MMMM yyyy');
      case 'last_month': return format(subMonths(now, 1), 'MMMM yyyy');
      case 'custom':
        if (customFrom && customTo) return `${customFrom} → ${customTo}`;
        return 'Custom Range';
    }
  }, [datePreset, customFrom, customTo]);

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

  const todayCalls = useMemo(() => {
    const now = new Date();
    const dayStart = startOfDay(now);
    const dayEnd = endOfDay(now);
    return callData.filter(row => {
      const d = parseDateSafe(row.timestamp);
      return d !== null && d >= dayStart && d <= dayEnd;
    });
  }, [callData]);

  const setterStats = useMemo(() => {
    const groups = new Map<string, CallRow[]>();
    for (const setter of activeSetters) groups.set(setter, []);
    for (const call of filteredCalls) {
      const name = (call.agentName || '').trim();
      if (groups.has(name)) groups.get(name)!.push(call);
    }
    return Array.from(groups.entries())
      .map(([name, rows]) => computeSetterStats(name, rows))
      .sort((a, b) => b.totalDials - a.totalDials);
  }, [filteredCalls, activeSetters]);

  const todayStatsByAgent = useMemo(() => {
    const map = new Map<string, { dials: number; booked: number }>();
    for (const call of todayCalls) {
      const name = (call.agentName || '').trim();
      if (!name) continue;
      const entry = map.get(name) || { dials: 0, booked: 0 };
      entry.dials++;
      if ((call.callDisposition || '').toLowerCase().includes('booked')) entry.booked++;
      map.set(name, entry);
    }
    return map;
  }, [todayCalls]);

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

  return (
    <div className="space-y-8">
      {/* Page header + date filter */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-bold text-foreground">Call Center</h1>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={datePreset}
            onChange={e => setDatePreset(e.target.value as DatePreset)}
            className="px-3 py-2 text-sm rounded-lg border bg-card focus:outline-none"
          >
            <option value="today">Today</option>
            <option value="this_week">This Week</option>
            <option value="this_month">This Month</option>
            <option value="last_month">Last Month</option>
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

      {/* SECTION 1 — Today's Snapshot */}
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-3">Today's Snapshot</h2>
        <div className="flex flex-wrap gap-4">
          <div className="card-elevated p-5 min-w-[160px]">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Total Dials Today</p>
            <p className="kpi-number text-foreground">{todayCalls.length}</p>
          </div>
          {activeSetters.map(setter => {
            const s = todayStatsByAgent.get(setter) || { dials: 0, booked: 0 };
            return (
              <div key={setter} className="card-elevated p-4 min-w-[140px]">
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-[10px] font-bold shrink-0">
                    {setter.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-xs font-semibold truncate text-foreground">{setter}</span>
                </div>
                <div className="flex gap-4 text-xs">
                  <div>
                    <p className="text-muted-foreground">Dials</p>
                    <p className="font-bold font-mono-tabular text-foreground mt-0.5">{s.dials}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Bookings</p>
                    <p className="font-bold font-mono-tabular text-foreground mt-0.5">{s.booked}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* SECTION 2 — Setter Performance Grid */}
      <div>
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-foreground">Setter Performance</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{dateLabel}</p>
        </div>
        {setterStats.length === 0 || setterStats.every(s => s.totalDials === 0) ? (
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
      </div>

      {/* SECTION 3 — 14-Day Trend */}
      <TrendChart callData={callData} activeSetters={activeSetters} />

      {/* Setter Detail Panel */}
      {selectedSetter && (
        <SetterDetailPanel
          agentName={selectedSetter}
          filteredCalls={selectedSetterCalls}
          allCalls={callData}
          settings={settings}
          dateLabel={dateLabel}
          onClose={() => setSelectedSetter(null)}
        />
      )}
    </div>
  );
}
