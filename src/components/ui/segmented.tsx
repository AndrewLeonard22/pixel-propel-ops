/**
 * Segmented control — the right shape for a SMALL, FIXED option set.
 *
 * A closed dropdown showing one of three options costs a click to reveal what a segmented
 * control shows at rest, in the same vertical space. `program` has exactly three values and
 * `status` has three; neither is user-extensible, so neither should be a popover.
 *
 * Deliberately NOT pill-heavy (Andrew's rubric: "rounded corners, but not overly
 * pill-heavy") and the selected cell lifts with a 1px shadow rather than a fill of the
 * accent colour, which is reserved for selection STATE elsewhere on the page.
 */
import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  value: T | null;
  /** `null` only ever arrives when `allowDeselect` is set. */
  onChange: (v: T | null) => void;
  options: readonly SegmentedOption<T>[];
  /**
   * ⭐ A CONTROL THAT CAN ONLY SET AND NEVER UNSET IS A ONE-WAY DOOR.
   * `ad_accounts.program` is nullable, five live rows are null, and the table renders `—`
   * for them — but once this control had been touched there was no way back to that state.
   * The native `<select>` it replaced could return to the empty option for free, so the
   * "modern" replacement was strictly less capable than the thing it was an upgrade on.
   * Clicking the selected cell clears it.
   */
  allowDeselect?: boolean;
  className?: string;
  'aria-label'?: string;
}

export function Segmented<T extends string>({
  value, onChange, options, className, allowDeselect = false, ...rest
}: SegmentedProps<T>) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  /**
   * ⚠️ THE ROLE FOLLOWS THE BEHAVIOUR, IT DOES NOT DECORATE IT.
   *
   * A `radio` that unchecks itself when you press it again is not a radio: the WAI-ARIA
   * radiogroup pattern guarantees exactly one checked member, and `allowDeselect` makes a
   * state with zero checked members reachable on purpose (five live `program` rows are
   * null). A screen reader announcing "radio, not checked" for every cell of a group that
   * is legitimately empty describes a broken form rather than an empty field.
   *
   * So: deselectable groups are a `group` of toggle buttons (`aria-pressed`), which is the
   * pattern that actually permits "none of these". Non-deselectable groups (Status, which
   * is NOT NULL in the database) stay a real radiogroup, because there the guarantee holds.
   */
  const asRadio = !allowDeselect;

  // Roving tabindex: the group is ONE tab stop and arrows move within it. A radiogroup
  // where every cell is tabbable makes a three-option field cost three tabs to pass.
  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    /**
     * ⚠️ FROM AN EMPTY GROUP, ARROW-RIGHT USED TO SELECT OPTION **2**. Nothing was selected,
     * so `tabIndex` put focus on cell 0, `i` was 0, and `(0 + 1) % n` skipped straight past
     * the option the user was standing on. The first arrow press out of an unset field
     * commits the cell that has focus; movement starts from the press after that.
     */
    if (value == null) {
      onChange(options[i].value);
      refs.current[i]?.focus();
      return;
    }
    const next = e.key === 'ArrowRight'
      ? (i + 1) % options.length
      : (i - 1 + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role={asRadio ? 'radiogroup' : 'group'}
      aria-label={rest['aria-label']}
      /**
       * ⚠️ THE TRACK IS SIZED TO MATCH `ui/combobox`, NOT TO ITS OWN TASTE, because the two
       * are stacked in one 420px panel and measured 36 / 38 / 36 / 38 px with 6px / 8px
       * radii — four controls in one column agreeing on their left and right edges and on
       * nothing else. `h-9` pins the track at the combobox's 36px (`p-0.5` + 1px border +
       * an `h-8` cell adds up to 38), `rounded-md` is the combobox's 6px, and the cells drop
       * to `rounded-[3px]` so the inner radius stays concentric with the outer one instead
       * of being a second, larger curve inside it.
       */
      className={cn(
        'inline-flex h-9 w-full items-center gap-0.5 rounded-md bg-surface-raised p-0.5 border border-border/60',
        className,
      )}
    >
      {options.map((o, i) => {
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            ref={el => { refs.current[i] = el; }}
            type="button"
            role={asRadio ? 'radio' : undefined}
            aria-checked={asRadio ? selected : undefined}
            aria-pressed={asRadio ? undefined : selected}
            tabIndex={selected || (value == null && i === 0) ? 0 : -1}
            onClick={() => onChange(allowDeselect && selected ? null : o.value)}
            onKeyDown={e => onKeyDown(e, i)}
            className={cn(
              // `text-sm` and not `text-[13px]`: this control's only neighbours are two
              // `ui/combobox` triggers in the same 420px column, and those are `text-sm`.
              // A 1px type difference between two controls that sit on top of each other is
              // read as a mistake, not as hierarchy.
              'flex-1 h-full rounded-[3px] px-2 text-sm font-medium transition-colors',
              'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              /**
               * ⚠️ THE SELECTED CELL NEEDS A CUE THAT IS NOT A SHADOW. `bg-background` over
               * a `bg-surface-raised` track is a LIFT in light mode and a RECESS in dark
               * (background 10% L under a 13% L track), and the 6%-black shadow that was
               * carrying the rest of the signal is invisible on a dark ground. A 1px border
               * in the same token family reads identically in both, so the control does not
               * depend on which way the palette runs.
               */
              selected
                ? 'bg-background text-foreground border border-border shadow-[0_1px_2px_rgb(0_0_0_/_0.06)]'
                : 'border border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="block truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
