import { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronDown, X } from 'lucide-react';
import {
  startOfDay, endOfDay,
  startOfWeek, endOfWeek,
  startOfMonth, endOfMonth,
  subMonths, format,
} from 'date-fns';

export interface DateRange {
  from: Date | undefined;
  to: Date | undefined;
  label: string;
}

export const ALL_TIME: DateRange = { from: undefined, to: undefined, label: 'All Time' };

export function thisMonthRange(): DateRange {
  const now = new Date();
  return { from: startOfMonth(now), to: endOfMonth(now), label: format(now, 'MMMM yyyy') };
}

type PresetKey = 'today' | 'this_week' | 'this_month' | 'last_month' | 'last_3_months';

interface Preset {
  key: PresetKey;
  label: string;
  build: () => { from: Date; to: Date };
}

function buildPresets(): Preset[] {
  const now = new Date();
  return [
    {
      key: 'today',
      label: 'Today',
      build: () => ({ from: startOfDay(now), to: endOfDay(now) }),
    },
    {
      key: 'this_week',
      label: 'This Week',
      build: () => ({
        from: startOfWeek(now, { weekStartsOn: 1 }),
        to: endOfWeek(now, { weekStartsOn: 1 }),
      }),
    },
    {
      key: 'this_month',
      label: format(now, 'MMMM yyyy'),
      build: () => ({ from: startOfMonth(now), to: endOfMonth(now) }),
    },
    {
      key: 'last_month',
      label: format(subMonths(now, 1), 'MMMM yyyy'),
      build: () => {
        const last = subMonths(now, 1);
        return { from: startOfMonth(last), to: endOfMonth(last) };
      },
    },
    {
      key: 'last_3_months',
      label: 'Last 3 Months',
      build: () => ({ from: startOfMonth(subMonths(now, 2)), to: endOfDay(now) }),
    },
  ];
}

interface Props {
  value: DateRange;
  onChange: (range: DateRange) => void;
  includeAllTime?: boolean;
}

export default function DateRangePicker({ value, onChange, includeAllTime = true }: Props) {
  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const presets = buildPresets();
  const isAllTime = !value.from && !value.to;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const selectPreset = (p: Preset) => {
    const { from, to } = p.build();
    onChange({ from, to, label: p.label });
    setOpen(false);
  };

  const selectAllTime = () => {
    onChange(ALL_TIME);
    setOpen(false);
  };

  const applyCustom = () => {
    if (!customFrom && !customTo) return;
    // Append T00:00:00 to force local-time parsing instead of UTC
    const from = customFrom ? startOfDay(new Date(customFrom + 'T00:00:00')) : undefined;
    const to = customTo ? endOfDay(new Date(customTo + 'T00:00:00')) : undefined;
    const label =
      customFrom && customTo
        ? `${customFrom} → ${customTo}`
        : customFrom
        ? `From ${customFrom}`
        : `Until ${customTo}`;
    onChange({ from, to, label });
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 text-sm bg-card border border-border rounded-lg hover:bg-accent/30 transition-colors font-medium shadow-sm"
      >
        <Calendar size={14} className="text-muted-foreground flex-shrink-0" />
        <span className={`truncate max-w-[160px] ${isAllTime ? 'text-muted-foreground' : 'text-foreground'}`}>
          {value.label}
        </span>
        {!isAllTime && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (includeAllTime) selectAllTime();
            }}
            className="text-muted-foreground hover:text-foreground ml-0.5"
          >
            <X size={12} />
          </button>
        )}
        <ChevronDown
          size={13}
          className={`text-muted-foreground transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 bg-card border border-border rounded-xl shadow-lg p-3 w-60 overflow-y-auto max-h-[80vh]">
          {includeAllTime && (
            <>
              <button
                onClick={selectAllTime}
                className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-colors ${
                  isAllTime
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-foreground hover:bg-accent/30'
                }`}
              >
                All Time
              </button>
              <div className="my-2 border-t border-border" />
            </>
          )}

          <div className="space-y-0.5">
            {presets.map((p) => {
              const active = value.label === p.label;
              return (
                <button
                  key={p.key}
                  onClick={() => selectPreset(p)}
                  className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-colors ${
                    active
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-foreground hover:bg-accent/30'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          <div className="my-2 border-t border-border" />

          <div className="px-1">
            <p className="text-xs font-medium text-muted-foreground mb-2">Custom Range</p>
            <div className="space-y-1.5">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                placeholder="From"
                className="w-full px-2.5 py-1.5 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                placeholder="To"
                className="w-full px-2.5 py-1.5 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              <button
                onClick={applyCustom}
                disabled={!customFrom && !customTo}
                className="w-full px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
