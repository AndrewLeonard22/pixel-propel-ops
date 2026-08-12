import { useState, useRef, useEffect } from 'react';
import { Calendar, Check, ChevronDown, X } from 'lucide-react';
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

/** One menu row, shaped exactly like `ui/combobox`'s `CommandItem`. */
function MenuRow({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={`flex h-8 w-full cursor-pointer items-center rounded-md px-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus-visible:bg-accent focus-visible:text-accent-foreground ${
        active ? 'font-medium text-foreground' : 'text-foreground'
      }`}
    >
      <span className="flex-1 truncate text-left">{label}</span>
      {active && <Check className="ml-2 h-3.5 w-3.5 shrink-0" />}
    </button>
  );
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

  /**
   * ⛔ THE CLEAR CONTROL IS A SIBLING, NOT A CHILD, and that is a correctness fix rather
   * than a layout one. It was a `<button>` nested INSIDE the trigger `<button>`, which no
   * HTML parser permits: the browser closes the outer button at the inner one's start tag,
   * so the DOM the user actually gets is not the DOM this file describes — the chevron ends
   * up outside the trigger, and hit-testing, focus order and `:hover` all follow the parsed
   * tree, not the source. It only ever "worked" because `stopPropagation` masked it.
   *
   * ⚠️ THE GEOMETRY IS `ui/combobox`'s, DELIBERATELY. Measured in one Dashboard toolbar row:
   * this control was 32px tall / 8px radius / `shadow-sm`, sitting beside three comboboxes
   * at 36px / 6px / no shadow — four sibling controls, three heights, two radii. Same
   * height, same radius, same border tokens, same focus treatment, no shadow. @andrew:
   * "the dropdowns on here look horrendous, look what modern software does", and modern
   * software's answer is that a toolbar's controls are one control repeated.
   */
  return (
    <div ref={ref} className="relative flex items-center gap-1">
      <button
        onClick={() => setOpen(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Date range: ${value.label}`}
        className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-2.5 text-sm font-medium transition-colors hover:border-border focus:outline-none focus-visible:border-ring data-[state=open]:border-ring"
        data-state={open ? 'open' : 'closed'}
      >
        <Calendar size={14} className="text-muted-foreground flex-shrink-0" />
        <span className={`truncate max-w-[160px] ${isAllTime ? 'text-muted-foreground' : 'text-foreground'}`}>
          {value.label}
        </span>
        <ChevronDown
          size={13}
          className={`text-muted-foreground transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {!isAllTime && includeAllTime && (
        <button
          onClick={selectAllTime}
          // 28px, over the 24px WCAG 2.5.8 floor. It was a bare 12px glyph.
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-row-hover hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label="Clear date range"
        >
          <X size={13} />
        </button>
      )}

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-60 max-h-[80vh] overflow-y-auto rounded-lg border border-border/70 bg-popover p-1 shadow-lg">
          {/* Rows are `ui/combobox`'s menu rows: 32px, 6px radius, label flush left, a
              check on the right marking the current value. The old rows carried the
              selection in a `bg-primary/10` FILL, which is the same paint the app uses for
              a pressed toolbar chip — one colour meaning two things. */}
          {includeAllTime && (
            <>
              <MenuRow label="All Time" active={isAllTime} onClick={selectAllTime} />
              <div className="my-1 -mx-1 border-t border-divider" />
            </>
          )}

          <div className="space-y-0.5">
            {presets.map((p) => (
              <MenuRow key={p.key} label={p.label} active={value.label === p.label} onClick={() => selectPreset(p)} />
            ))}
          </div>

          <div className="my-1 -mx-1 border-t border-divider" />

          <div className="p-1">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Custom range</p>
            <div className="space-y-1.5">
              <label htmlFor="date-range-from" className="sr-only">Custom range start date</label>
              <input
                id="date-range-from"
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs transition-colors hover:border-border focus:outline-none focus-visible:border-ring"
              />
              <label htmlFor="date-range-to" className="sr-only">Custom range end date</label>
              <input
                id="date-range-to"
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs transition-colors hover:border-border focus:outline-none focus-visible:border-ring"
              />
              <button
                onClick={applyCustom}
                disabled={!customFrom && !customTo}
                // `disabled:bg-muted` and not `disabled:opacity-40`: #1a6eff at 40% under
                // white text measures ~1.7:1. A disabled control should read as a different
                // control, not as an unreadable one. Same rule as the panel's Save button.
                className="h-8 w-full rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-[filter,colors] hover:brightness-95 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
