import { useState, useMemo, useRef, useEffect } from 'react';
import { useData } from '@/hooks/useData';
import {
  ChevronLeft, ChevronRight, RefreshCw, CalendarDays, Users,
  TrendingUp, Clock, ChevronDown, Check,
} from 'lucide-react';
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addDays, subMonths, addMonths, isSameDay, isSameMonth, isToday,
  isPast, parseISO,
} from 'date-fns';
import type { AppointmentRow } from '@/lib/types';

function parseDateSafe(dateStr: string): Date | null {
  if (!dateStr) return null;
  try {
    const d = parseISO(dateStr);
    if (!isNaN(d.getTime())) return d;
  } catch {}
  const normalized = dateStr.replace(/(\d+:\d+)(am|pm)/i, (_, time, ampm) => `${time} ${ampm.toUpperCase()}`);
  const d = new Date(normalized);
  if (!isNaN(d.getTime())) return d;
  const dateOnly = dateStr.replace(/\s+\d+:\d+\s*(am|pm)?\s*$/i, '').trim();
  if (dateOnly && dateOnly !== dateStr) {
    const d2 = new Date(dateOnly);
    if (!isNaN(d2.getTime())) return d2;
  }
  return null;
}

function StatusBadge({ status }: { status: string }) {
  const s = (status || '').toLowerCase();
  let cls = 'bg-gray-100 text-gray-500';
  if (s === 'showed' || s === 'show')                cls = 'bg-green-50 text-green-700';
  else if (s === 'no show' || s === 'noshow' || s === 'no-show') cls = 'bg-red-50 text-red-600';
  else if (s === 'cancelled' || s === 'canceled')    cls = 'bg-orange-50 text-orange-600';
  else if (s === 'rescheduled')                      cls = 'bg-blue-50 text-blue-600';
  else if (s === 'pending' || s === 'scheduled')     cls = 'bg-blue-50 text-blue-600';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {status || 'Pending'}
    </span>
  );
}

export default function AppointmentsCalendar() {
  const { appointments, loading, refresh } = useData();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  // Unique client names from appointments
  const clientNames = useMemo(() => {
    const names = new Set<string>();
    appointments.forEach(a => { if (a.client) names.add(a.client); });
    return Array.from(names).sort();
  }, [appointments]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const allSelected = selectedClients.size === 0;

  function toggleClient(name: string) {
    setSelectedClients(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
    setSelectedDay(null);
  }

  function toggleAll() {
    setSelectedClients(new Set());
    setSelectedDay(null);
  }

  const filtered = useMemo(() => {
    if (selectedClients.size === 0) return appointments;
    return appointments.filter(a => a.client && selectedClients.has(a.client));
  }, [appointments, selectedClients]);

  // date key → appointments
  const apptMap = useMemo(() => {
    const map = new Map<string, AppointmentRow[]>();
    filtered.forEach(a => {
      const d = parseDateSafe(a.appointmentDate || a.dateAdded);
      if (!d) return;
      const k = format(d, 'yyyy-MM-dd');
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(a);
    });
    return map;
  }, [filtered]);

  // Calendar grid days
  const calendarDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 0 });
    const end   = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 0 });
    const days: Date[] = [];
    let d = start;
    while (d <= end) { days.push(d); d = addDays(d, 1); }
    return days;
  }, [currentMonth]);

  // Month stats
  const stats = useMemo(() => {
    const mStart = startOfMonth(currentMonth);
    const mEnd   = endOfMonth(currentMonth);
    const now    = new Date();
    let total = 0, upcoming = 0, showed = 0;
    filtered.forEach(a => {
      const d = parseDateSafe(a.appointmentDate || a.dateAdded);
      if (!d || d < mStart || d > mEnd) return;
      total++;
      if (d > now) upcoming++;
      const s = (a.showStatus || '').toLowerCase();
      if (s === 'showed' || s === 'show') showed++;
    });
    return { total, upcoming, past: total - upcoming, showed };
  }, [filtered, currentMonth]);

  // Selected day appointments, sorted by time
  const selectedAppts = useMemo(() => {
    if (!selectedDay) return [];
    const key = format(selectedDay, 'yyyy-MM-dd');
    return (apptMap.get(key) || []).slice().sort((a, b) => {
      const da = parseDateSafe(a.appointmentDate || a.dateAdded);
      const db = parseDateSafe(b.appointmentDate || b.dateAdded);
      return (da?.getTime() || 0) - (db?.getTime() || 0);
    });
  }, [selectedDay, apptMap]);

  const today = new Date();

  return (
    <div className="space-y-5 fade-in">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-foreground tracking-tight">Appointments Calendar</h1>
          <p className="text-xs text-muted-foreground mt-0.5">All accounts · appointment overview</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Multi-select client filter */}
          <div className="relative" ref={filterRef}>
            <button
              onClick={() => setFilterOpen(o => !o)}
              className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-border bg-white hover:bg-slate-50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <Users size={13} className="text-muted-foreground" />
              <span className="font-medium">
                {allSelected
                  ? 'All Accounts'
                  : selectedClients.size === 1
                  ? Array.from(selectedClients)[0]
                  : `${selectedClients.size} accounts`}
              </span>
              {!allSelected && (
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary text-white text-[9px] font-bold">
                  {selectedClients.size}
                </span>
              )}
              <ChevronDown size={13} className={`text-muted-foreground transition-transform ${filterOpen ? 'rotate-180' : ''}`} />
            </button>

            {filterOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-64 bg-white border border-border rounded-xl shadow-lg z-30 overflow-hidden">
                <button
                  onClick={toggleAll}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors border-b border-border"
                >
                  <span className={`w-4 h-4 rounded flex items-center justify-center border flex-shrink-0 transition-colors ${allSelected ? 'bg-primary border-primary' : 'border-border'}`}>
                    {allSelected && <Check size={10} className="text-white" strokeWidth={3} />}
                  </span>
                  <span className="text-sm font-semibold text-foreground">All Accounts</span>
                  <span className="ml-auto text-xs text-muted-foreground">{appointments.length}</span>
                </button>
                <div className="max-h-64 overflow-y-auto py-1">
                  {clientNames.map(name => {
                    const checked = selectedClients.has(name);
                    const count = appointments.filter(a => a.client === name).length;
                    return (
                      <button
                        key={name}
                        onClick={() => toggleClient(name)}
                        className="w-full flex items-center gap-3 px-4 py-2 hover:bg-slate-50 transition-colors"
                      >
                        <span className={`w-4 h-4 rounded flex items-center justify-center border flex-shrink-0 transition-colors ${checked ? 'bg-primary border-primary' : 'border-border'}`}>
                          {checked && <Check size={10} className="text-white" strokeWidth={3} />}
                        </span>
                        <span className="text-sm text-foreground truncate text-left">{name}</span>
                        <span className="ml-auto text-xs text-muted-foreground flex-shrink-0">{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => refresh()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-border bg-white hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'This Month', value: stats.total,    icon: CalendarDays, color: 'text-foreground' },
          { label: 'Upcoming',   value: stats.upcoming, icon: Clock,        color: 'text-primary' },
          { label: 'Past',       value: stats.past,     icon: Users,        color: 'text-muted-foreground' },
          { label: 'Showed Up',  value: stats.showed,   icon: TrendingUp,   color: 'text-green-600' },
        ].map(s => (
          <div key={s.label} className="card-elevated px-4 py-4 sm:px-5 sm:py-5">
            <s.icon size={15} className="text-muted-foreground mb-3" strokeWidth={1.5} />
            <div className={`text-2xl sm:text-[1.75rem] font-bold tracking-tight leading-none tabular-nums ${loading ? 'text-muted-foreground/30' : s.color}`}>
              {loading ? '—' : s.value}
            </div>
            <div className="text-[11px] sm:text-xs font-medium text-muted-foreground mt-2">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Calendar + detail — two column on lg+ */}
      <div className="flex flex-col lg:flex-row gap-4">

        {/* Calendar card */}
        <div className="card-elevated flex-1 min-w-0 overflow-hidden">

          {/* Month nav */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <button
              onClick={() => { setCurrentMonth(m => subMonths(m, 1)); setSelectedDay(null); }}
              className="p-1.5 rounded-lg hover:bg-slate-50 transition-colors text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-foreground">{format(currentMonth, 'MMMM yyyy')}</span>
              <button
                onClick={() => { setCurrentMonth(new Date()); setSelectedDay(null); }}
                className="text-[11px] font-semibold text-primary hover:text-primary/70 transition-colors px-2 py-1 rounded-md hover:bg-primary/5"
              >
                Today
              </button>
            </div>
            <button
              onClick={() => { setCurrentMonth(m => addMonths(m, 1)); setSelectedDay(null); }}
              className="p-1.5 rounded-lg hover:bg-slate-50 transition-colors text-muted-foreground hover:text-foreground"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 border-b border-border bg-slate-50/60">
            {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
              <div key={d} className="py-2.5 text-center text-[10px] font-bold text-muted-foreground/70 uppercase tracking-widest">
                {d}
              </div>
            ))}
          </div>

          {/* Grid */}
          {loading ? (
            <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
              <RefreshCw size={14} className="animate-spin mr-2" />Loading…
            </div>
          ) : (
            <div className="grid grid-cols-7">
              {calendarDays.map((day, idx) => {
                const inMonth = isSameMonth(day, currentMonth);
                const todayDay = isToday(day);
                const past    = isPast(day) && !todayDay;
                const isSel   = selectedDay ? isSameDay(day, selectedDay) : false;
                const key     = format(day, 'yyyy-MM-dd');
                const count   = apptMap.get(key)?.length || 0;
                const borderR = idx % 7 !== 6;
                const borderB = idx < calendarDays.length - 7;

                return (
                  <button
                    key={idx}
                    onClick={() => count > 0 && setSelectedDay(isSel ? null : day)}
                    disabled={count === 0}
                    className={[
                      'min-h-[64px] p-2 text-left transition-colors',
                      borderR ? 'border-r border-border/50' : '',
                      borderB ? 'border-b border-border/50' : '',
                      isSel   ? 'bg-primary/[0.06]' : '',
                      count > 0 && !isSel ? 'hover:bg-slate-50 cursor-pointer' : '',
                      count === 0 ? 'cursor-default' : '',
                      !inMonth ? 'opacity-25' : '',
                    ].join(' ')}
                  >
                    <span className={[
                      'inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-semibold',
                      todayDay ? 'bg-primary text-white' : '',
                      isSel && !todayDay ? 'text-primary font-bold' : '',
                      !todayDay && !isSel ? 'text-foreground' : '',
                    ].join(' ')}>
                      {format(day, 'd')}
                    </span>

                    {count > 0 && inMonth && (
                      <div className="mt-1 flex items-center gap-0.5 flex-wrap">
                        {count <= 4
                          ? Array.from({ length: count }).map((_, i) => (
                              <span key={i} className={`w-1.5 h-1.5 rounded-full ${past ? 'bg-slate-300' : 'bg-primary/60'}`} />
                            ))
                          : <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${past ? 'bg-slate-100 text-slate-400' : 'bg-primary/10 text-primary'}`}>{count}</span>
                        }
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Detail panel */}
        <div className="card-elevated lg:w-80 flex-shrink-0 flex flex-col overflow-hidden">
          {selectedDay && selectedAppts.length > 0 ? (
            <>
              <div className="px-5 py-4 border-b border-border">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {format(selectedDay, 'EEE, MMM d')}
                </p>
                <p className="text-sm font-bold text-foreground mt-0.5">
                  {selectedAppts.length} appointment{selectedAppts.length !== 1 ? 's' : ''}
                </p>
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-border">
                {selectedAppts.map((appt, i) => {
                  const d = parseDateSafe(appt.appointmentDate || appt.dateAdded);
                  return (
                    <div key={i} className="px-5 py-3.5 hover:bg-slate-50/60 transition-colors">
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div>
                          <p className="text-sm font-semibold text-foreground leading-tight">{appt.client || '—'}</p>
                          {appt.setter && (
                            <p className="text-xs text-muted-foreground mt-0.5">{appt.setter}</p>
                          )}
                        </div>
                        {d && (
                          <span className="text-[11px] text-muted-foreground font-medium tabular-nums flex-shrink-0 mt-0.5">
                            {format(d, 'h:mm a')}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <StatusBadge status={appt.showStatus} />
                        {(appt.closedRevenue || 0) > 0 && (
                          <span className="text-xs font-semibold text-green-600 tabular-nums">
                            ${appt.closedRevenue.toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-center">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
                <CalendarDays size={20} className="text-muted-foreground/50" />
              </div>
              <p className="text-sm font-medium text-foreground">
                {selectedDay ? 'No appointments' : 'Select a day'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {selectedDay
                  ? `Nothing scheduled on ${format(selectedDay, 'MMM d')}`
                  : 'Click any day with appointments to see details'
                }
              </p>
            </div>
          )}
        </div>

      </div>

      {/* Upcoming appointments list */}
      <UpcomingList appointments={filtered} />

    </div>
  );
}

function UpcomingList({ appointments }: { appointments: AppointmentRow[] }) {
  const now = new Date();

  const upcoming = useMemo(() => {
    return appointments
      .map(a => ({ appt: a, date: parseDateSafe(a.appointmentDate || a.dateAdded) }))
      .filter(({ date }) => date && date >= now)
      .sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0))
      .slice(0, 20);
  }, [appointments]);

  if (upcoming.length === 0) return null;

  return (
    <div className="card-elevated overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">Upcoming Appointments</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Next {upcoming.length} scheduled across all accounts</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[500px]">
          <thead>
            <tr className="border-b border-border bg-slate-50">
              {['Date & Time', 'Account', 'Setter', 'Status'].map(h => (
                <th key={h} className="text-left text-[11px] font-semibold text-muted-foreground/70 px-5 py-3 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {upcoming.map(({ appt, date }, i) => (
              <tr key={i} className="border-b border-border/60 hover:bg-slate-50/60 transition-colors">
                <td className="px-5 py-3 text-sm text-foreground whitespace-nowrap tabular-nums">
                  {date && format(date, 'MMM d, yyyy')}
                  {date && (
                    <span className="text-muted-foreground ml-2">{format(date, 'h:mm a')}</span>
                  )}
                </td>
                <td className="px-5 py-3 text-sm font-medium text-foreground">{appt.client || '—'}</td>
                <td className="px-5 py-3 text-sm text-muted-foreground">{appt.setter || '—'}</td>
                <td className="px-5 py-3"><StatusBadge status={appt.showStatus} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
