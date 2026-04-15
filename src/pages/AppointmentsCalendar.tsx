import { useState, useMemo } from 'react';
import { useData } from '@/hooks/useData';
import { ChevronLeft, ChevronRight, X, Calendar, Clock, User, Tag } from 'lucide-react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, subMonths, isSameDay, isSameMonth, isToday, isPast, isFuture, parseISO } from 'date-fns';
import type { AppointmentRow } from '@/lib/types';

function parseDateSafe(dateStr: string): Date | null {
  if (!dateStr) return null;
  // Try ISO parse first
  try {
    const d = parseISO(dateStr);
    if (!isNaN(d.getTime())) return d;
  } catch {}
  // Try normalizing am/pm spacing
  const normalized = dateStr.replace(/(\d+:\d+)(am|pm)/i, (_, time, ampm) => `${time} ${ampm.toUpperCase()}`);
  const d = new Date(normalized);
  if (!isNaN(d.getTime())) return d;
  // Try date-only
  const dateOnly = dateStr.replace(/\s+\d+:\d+\s*(am|pm)?\s*$/i, '').trim();
  if (dateOnly && dateOnly !== dateStr) {
    const d2 = new Date(dateOnly);
    if (!isNaN(d2.getTime())) return d2;
  }
  return null;
}

function ShowStatusBadge({ status }: { status: string }) {
  const s = (status || '').toLowerCase();
  let bg = 'bg-muted text-muted-foreground';
  if (s === 'showed' || s === 'show') bg = 'bg-emerald-100 text-emerald-700';
  else if (s === 'no show' || s === 'noshow' || s === 'no-show') bg = 'bg-red-100 text-red-600';
  else if (s === 'pending' || s === 'scheduled') bg = 'bg-blue-100 text-blue-700';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${bg}`}>
      {status || 'Unknown'}
    </span>
  );
}

interface DayAppointments {
  date: Date;
  appointments: AppointmentRow[];
}

export default function AppointmentsCalendar() {
  const { appointments, accounts, loading } = useData();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [accountFilter, setAccountFilter] = useState('all');

  // Filter appointments by account
  const filteredAppointments = useMemo(() => {
    if (accountFilter === 'all') return appointments;
    return appointments.filter(a => {
      const client = (a.client || '').toLowerCase().trim();
      const account = accountFilter.toLowerCase().trim();
      return client === account || client.includes(account) || account.includes(client);
    });
  }, [appointments, accountFilter]);

  // Build a map of date string → appointments
  const appointmentsByDate = useMemo(() => {
    const map = new Map<string, AppointmentRow[]>();
    for (const appt of filteredAppointments) {
      const d = parseDateSafe(appt.appointmentDate || appt.dateAdded);
      if (!d) continue;
      const key = format(d, 'yyyy-MM-dd');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(appt);
    }
    return map;
  }, [filteredAppointments]);

  // Build calendar grid for current month
  const calendarDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 0 });
    const days: Date[] = [];
    let d = start;
    while (d <= end) {
      days.push(d);
      d = addDays(d, 1);
    }
    return days;
  }, [currentMonth]);

  // Stats for current month
  const monthStats = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const now = new Date();
    let total = 0, upcoming = 0, past = 0, showed = 0;
    for (const appt of filteredAppointments) {
      const d = parseDateSafe(appt.appointmentDate || appt.dateAdded);
      if (!d || d < monthStart || d > monthEnd) continue;
      total++;
      if (d > now) upcoming++;
      else past++;
      const s = (appt.showStatus || '').toLowerCase();
      if (s === 'showed' || s === 'show') showed++;
    }
    return { total, upcoming, past, showed };
  }, [filteredAppointments, currentMonth]);

  const selectedDayAppts = useMemo(() => {
    if (!selectedDay) return [];
    const key = format(selectedDay, 'yyyy-MM-dd');
    return appointmentsByDate.get(key) || [];
  }, [selectedDay, appointmentsByDate]);

  const getApptCount = (day: Date) => {
    const key = format(day, 'yyyy-MM-dd');
    return appointmentsByDate.get(key)?.length || 0;
  };

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Appointments Calendar</h1>
        <select
          value={accountFilter}
          onChange={e => setAccountFilter(e.target.value)}
          className="px-3 py-2 text-sm rounded-lg border bg-card focus:outline-none"
        >
          <option value="all">All Accounts</option>
          {accounts.map(a => (
            <option key={a.accountName} value={a.accountName}>{a.accountName}</option>
          ))}
        </select>
      </div>

      {/* Month stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card-elevated p-4">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">This Month</p>
          <p className="text-2xl font-bold font-mono-tabular text-foreground">{monthStats.total}</p>
        </div>
        <div className="card-elevated p-4">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Upcoming</p>
          <p className="text-2xl font-bold font-mono-tabular text-blue-500">{monthStats.upcoming}</p>
        </div>
        <div className="card-elevated p-4">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Past</p>
          <p className="text-2xl font-bold font-mono-tabular text-muted-foreground">{monthStats.past}</p>
        </div>
        <div className="card-elevated p-4">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Showed</p>
          <p className="text-2xl font-bold font-mono-tabular text-emerald-500">{monthStats.showed}</p>
        </div>
      </div>

      {/* Calendar */}
      <div className="card-elevated overflow-hidden">
        {/* Month header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <button
            onClick={() => setCurrentMonth(m => subMonths(m, 1))}
            className="p-1.5 rounded-md hover:bg-muted transition-colors"
          >
            <ChevronLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <h2 className="text-base font-semibold text-foreground">
            {format(currentMonth, 'MMMM yyyy')}
          </h2>
          <button
            onClick={() => setCurrentMonth(m => addMonths(m, 1))}
            className="p-1.5 rounded-md hover:bg-muted transition-colors"
          >
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 border-b border-border">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="py-2 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        {loading ? (
          <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">Loading appointments...</div>
        ) : (
          <div className="grid grid-cols-7">
            {calendarDays.map((day, idx) => {
              const count = getApptCount(day);
              const inMonth = isSameMonth(day, currentMonth);
              const isSelected = selectedDay ? isSameDay(day, selectedDay) : false;
              const today = isToday(day);
              const past = isPast(day) && !today;
              const future = isFuture(day);

              return (
                <button
                  key={idx}
                  onClick={() => {
                    if (count > 0) setSelectedDay(isSelected ? null : day);
                  }}
                  className={`
                    min-h-[72px] p-2 text-left border-b border-r border-border/50 transition-colors relative
                    ${!inMonth ? 'opacity-30' : ''}
                    ${isSelected ? 'bg-primary/10 ring-1 ring-inset ring-primary/30' : count > 0 ? 'hover:bg-accent/30 cursor-pointer' : 'cursor-default'}
                    ${idx % 7 === 6 ? 'border-r-0' : ''}
                    ${idx >= calendarDays.length - 7 ? 'border-b-0' : ''}
                  `}
                >
                  {/* Day number */}
                  <span className={`
                    inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-medium
                    ${today ? 'bg-primary text-primary-foreground' : 'text-foreground'}
                    ${!inMonth ? 'text-muted-foreground' : ''}
                  `}>
                    {format(day, 'd')}
                  </span>

                  {/* Appointment dots/count */}
                  {count > 0 && inMonth && (
                    <div className="mt-1 flex flex-wrap gap-0.5">
                      {count <= 3 ? (
                        Array.from({ length: count }).map((_, i) => (
                          <span
                            key={i}
                            className={`w-1.5 h-1.5 rounded-full ${past ? 'bg-muted-foreground/50' : future || today ? 'bg-blue-500' : 'bg-muted-foreground/50'}`}
                          />
                        ))
                      ) : (
                        <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${past && !today ? 'bg-muted text-muted-foreground' : 'bg-blue-100 text-blue-700'}`}>
                          {count}
                        </span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-500" /> Upcoming
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-muted-foreground/50" /> Past
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-flex w-5 h-5 rounded-full bg-primary items-center justify-center text-[9px] text-primary-foreground font-bold">·</span> Today
        </span>
      </div>

      {/* Selected day panel */}
      {selectedDay && (
        <div className="card-elevated overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">
                {format(selectedDay, 'EEEE, MMMM d, yyyy')}
              </h3>
              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                {selectedDayAppts.length} appointment{selectedDayAppts.length !== 1 ? 's' : ''}
              </span>
            </div>
            <button onClick={() => setSelectedDay(null)} className="p-1.5 rounded-md hover:bg-muted transition-colors">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>

          <div className="divide-y divide-border">
            {selectedDayAppts.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">No appointments on this day.</p>
            ) : (
              selectedDayAppts.map((appt, i) => (
                <div key={i} className="px-5 py-3 flex flex-wrap items-start gap-x-6 gap-y-1.5 hover:bg-muted/20 transition-colors">
                  <div className="flex items-center gap-2 min-w-[160px]">
                    <Tag className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-semibold text-foreground">{appt.client || '—'}</span>
                  </div>
                  {appt.setter && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <User className="w-3.5 h-3.5 shrink-0" />
                      <span>{appt.setter}</span>
                    </div>
                  )}
                  {(appt.appointmentDate || appt.dateAdded) && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono-tabular">
                      <Clock className="w-3.5 h-3.5 shrink-0" />
                      <span>{appt.appointmentDate || appt.dateAdded}</span>
                    </div>
                  )}
                  <ShowStatusBadge status={appt.showStatus} />
                  {appt.leadValid && (
                    <span className="text-xs text-muted-foreground">
                      Lead: <span className="text-foreground font-medium">{appt.leadValid}</span>
                    </span>
                  )}
                  {(appt.closedRevenue || 0) > 0 && (
                    <span className="text-xs font-semibold text-emerald-600 font-mono-tabular">
                      ${(appt.closedRevenue || 0).toLocaleString()}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Agenda list — upcoming appointments across all months */}
      <div className="card-elevated overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">
            All Appointments — {format(currentMonth, 'MMMM yyyy')}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">All appointments scheduled in this month, sorted by date</p>
        </div>
        <AgendaList appointments={filteredAppointments} month={currentMonth} />
      </div>
    </div>
  );
}

function AgendaList({ appointments, month }: { appointments: AppointmentRow[]; month: Date }) {
  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);

  const sorted = useMemo(() => {
    return appointments
      .map(a => ({ appt: a, date: parseDateSafe(a.appointmentDate || a.dateAdded) }))
      .filter(({ date }) => date && date >= monthStart && date <= monthEnd)
      .sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));
  }, [appointments, month]);

  if (sorted.length === 0) {
    return (
      <div className="px-5 py-8 text-center text-sm text-muted-foreground">
        No appointments in {format(month, 'MMMM yyyy')}.
      </div>
    );
  }

  // Group by date
  const groups: { dateLabel: string; items: typeof sorted }[] = [];
  let currentKey = '';
  for (const item of sorted) {
    const key = item.date ? format(item.date, 'yyyy-MM-dd') : 'unknown';
    const label = item.date ? format(item.date, 'EEE, MMM d') : 'Unknown date';
    if (key !== currentKey) {
      groups.push({ dateLabel: label, items: [] });
      currentKey = key;
    }
    groups[groups.length - 1].items.push(item);
  }

  return (
    <div className="overflow-y-auto max-h-[400px]">
      {groups.map((group, gi) => (
        <div key={gi}>
          <div className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm px-5 py-1.5 flex items-center gap-2 border-b border-border/50">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{group.dateLabel}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-background text-muted-foreground">{group.items.length}</span>
          </div>
          {group.items.map(({ appt }, i) => (
            <div key={i} className="px-5 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/40 hover:bg-muted/20 transition-colors">
              <span className="text-sm font-semibold text-foreground min-w-[140px]">{appt.client || '—'}</span>
              {appt.setter && <span className="text-xs text-muted-foreground">{appt.setter}</span>}
              <ShowStatusBadge status={appt.showStatus} />
              {(appt.closedRevenue || 0) > 0 && (
                <span className="text-xs font-semibold text-emerald-600 font-mono-tabular ml-auto">
                  ${(appt.closedRevenue || 0).toLocaleString()}
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
