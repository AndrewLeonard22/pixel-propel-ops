/**
 * Searchable, optionally CREATABLE combobox.
 *
 * WHY THIS EXISTS RATHER THAN A `Select` — @andrew: "the dropdowns on here look
 * horrendous, look what modern software does."
 *
 * The fix is not a prettier dropdown, it is matching the control to the option set:
 *   fixed and small   -> segmented control (see segmented.tsx)
 *   open-ended        -> this
 * `media_buyer` has exactly ONE distinct value in the live table. A fixed `Select` there
 * makes it structurally impossible to hire a second media buyer; a bare `<Input>` lets
 * "jez", "Jez " and "Jezz" each mint a new buyer and fragment every downstream
 * `group by media_buyer`. A creatable combobox is the only control that is both open and
 * convergent.
 *
 * Built on `cmdk` + `@radix-ui/react-popover`, both already installed, both already
 * wrapped in src/components/ui. ZERO new dependencies.
 *
 * ⛔ NOT INSTALLED FROM 21st.dev: `@shugar/combobox` (id 4030) has exactly the right
 * interaction model and paints itself with Vercel Geist tokens (`bg-background-100`,
 * `shadow-border`, `gray-alpha-400`) that do not exist in this repo's tailwind config.
 * Installing it forks the token system to obtain one control. The BEHAVIOUR is taken from
 * it, the paint is ours.
 */
import * as React from 'react';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';

/**
 * An option is either a bare string (value === label, the common case) or a value/label
 * pair. The pair form exists because the five native `<select>`s this control replaced on
 * Dashboard, Targets and Team all store a KEY (`this_month`) and show a SENTENCE
 * ("This Month"); without it those pages would have had to keep their native selects,
 * which is the whole complaint.
 */
export type ComboboxOption = string | { value: string; label: string };

const optValue = (o: ComboboxOption) => (typeof o === 'string' ? o : o.value);
const optLabel = (o: ComboboxOption) => (typeof o === 'string' ? o : o.label);

export interface ComboboxProps {
  value: string | null;
  onChange: (v: string | null) => void;
  options: ComboboxOption[];
  /**
   * Show the search box. Defaults to "only when the list is long enough to need it": a
   * filter field over four fixed options is chrome that costs a keystroke and saves none.
   */
  searchable?: boolean;
  placeholder?: string;
  /** Offer `Create "<query>"` when nothing matches. */
  creatable?: boolean;
  /** Offer an explicit "none" row, so a set value can be UNSET. */
  clearable?: boolean;
  clearLabel?: string;
  emptyLabel?: string;
  searchPlaceholder?: string;
  className?: string;
  id?: string;
  /**
   * 🔴 REQUIRED IN PRACTICE, AND THE REASON THIS PROP EXISTS AT ALL.
   *
   * axe-core `button-name`, impact CRITICAL, on every one of the nine call sites: the
   * trigger announced NOTHING. The trap is that it looks labelled — the button's text
   * content is the selected value ("Jez"), which names a `role="button"` for free. But
   * `role="combobox"` is NOT in the "name from content" set, so the accname algorithm skips
   * step 2F entirely and falls off the end with an empty string. A control that renders its
   * own state and still has no name is exactly the "a label is not an identity" shape: the
   * visible string is a VALUE, and a value is not a name.
   *
   * So the name has to be supplied, not inferred. Pass `aria-labelledby` when a real
   * `<label>`/heading already exists on screen (the two panel fields do), `aria-label`
   * when the only cue is positional (every toolbar filter).
   */
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

export function Combobox({
  value, onChange, options,
  searchable,
  placeholder = 'Select',
  creatable = false,
  clearable = false,
  clearLabel = 'None',
  emptyLabel = 'No matches.',
  searchPlaceholder = 'Search',
  className,
  id,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');

  const showSearch = searchable ?? (creatable || options.length > 7);
  const exact = options.some(o => optLabel(o).toLowerCase() === query.trim().toLowerCase());
  const showCreate = creatable && query.trim().length > 0 && !exact;
  const selectedLabel = options.find(o => optValue(o) === value);

  const commit = (v: string | null) => { onChange(v); setOpen(false); setQuery(''); };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(''); }}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          className={cn(
            // 1px border that CHANGES COLOUR on focus. No `ring-2 ring-offset-2`: that is
            // 4px of blue bloom outside the control, which collides with its neighbour
            // across a gap. Linear and the Anthropic console both use an inset border shift.
            'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-2.5 text-sm',
            'transition-colors hover:border-border focus:outline-none focus-visible:border-ring',
            'data-[state=open]:border-ring',
            className,
          )}
        >
          {/* `title` on every truncating string in this control. A value the user chose and
              can no longer read is a control that hides its own state. */}
          <span
            className={cn('truncate', !value && 'text-muted-foreground')}
            title={value ? (selectedLabel ? optLabel(selectedLabel) : value) : undefined}
          >
            {value ? (selectedLabel ? optLabel(selectedLabel) : value) : placeholder}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-40" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        // Wider than the trigger on purpose. Radix's default
        // `min-w-[var(--radix-select-trigger-width)]` is what makes a 110px status menu
        // render as a 110px popover, which is most of why the old selects felt cheap.
        className="w-[--radix-popover-trigger-width] min-w-[240px] p-0 rounded-lg border-border/70 shadow-lg"
      >
        <Command>
          {showSearch && (
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder={searchPlaceholder}
              className="h-9 text-sm"
            />
          )}
          <CommandList className="max-h-[280px]">
            {!showCreate && <CommandEmpty className="py-6 text-center text-sm text-muted-foreground">{emptyLabel}</CommandEmpty>}
            <CommandGroup className="p-1">
              {clearable && (
                <CommandItem
                  value={clearLabel}
                  onSelect={() => commit(null)}
                  className="h-8 rounded-md px-2 text-sm text-muted-foreground aria-selected:bg-accent aria-selected:text-accent-foreground"
                >
                  <span className="flex-1 truncate">{clearLabel}</span>
                  {value == null && <Check className="ml-2 h-3.5 w-3.5 shrink-0" />}
                </CommandItem>
              )}
              {options.map(o => {
                const v = optValue(o);
                const label = optLabel(o);
                return (
                  <CommandItem
                    key={v}
                    // cmdk filters on this string, so it must be the LABEL: filtering a
                    // date preset list on `last_3_months` means typing "Last 3" matches
                    // nothing while the row it should match is on screen.
                    value={label}
                    onSelect={() => commit(v)}
                    className="h-8 rounded-md px-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
                  >
                    {/* Label starts at the LEFT EDGE and the check sits on the right. The
                        stock shadcn SelectItem reserves a permanently empty 32px left gutter
                        for its indicator, which in a three-option menu is most of the menu. */}
                    <span className={cn('flex-1 truncate', value === v && 'font-medium')} title={label}>{label}</span>
                    {value === v && <Check className="ml-2 h-3.5 w-3.5 shrink-0" />}
                  </CommandItem>
                );
              })}
              {showCreate && (
                <CommandItem
                  value={`__create__${query}`}
                  onSelect={() => commit(query.trim())}
                  className="h-8 rounded-md px-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
                >
                  <Plus className="mr-2 h-3.5 w-3.5 shrink-0 opacity-60" />
                  <span className="truncate">Create &ldquo;{query.trim()}&rdquo;</span>
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
