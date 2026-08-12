/**
 * Ad account ⇄ company. The screen @andrew called "so broken".
 *
 * Keyed on `account_id`, which Meta does not let anyone edit. The previous mapping was
 * keyed on the DISPLAY NAME: four accounts were renamed in Meta between 2025 and 2026
 * (proven by identical spend to the cent) and each one silently detached from its client.
 *
 * ⭐ COLUMN GEOMETRY LIVES IN ONE CONSTANT, USED BY THE HEADER AND EVERY ROW.
 *
 * ⚠️ AMENDED, because the first version of this comment was true and INCOMPLETE, and an
 * incomplete law makes the wrong move look like compliance. "One template" was read as
 * "one grid-template-columns string", and the responsive `hidden` classes were then hung
 * on the CHILDREN alone — which does not remove the tracks, and collapsed the company
 * column to 0px. The law is: one constant holds BOTH the per-breakpoint templates AND the
 * per-cell visibility, and they change together. See `COLS` below.
 */
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Search, X, ArrowUp, ArrowDown } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { classifyMapping, displayCompany, displayMetaName, formatMoney, type MappingState } from '@/lib/accountDisplay';
import AccountEditPanel from './AccountEditPanel';

export interface AdAccount {
  account_id: string;
  meta_name: string | null;
  company_name: string | null;
  program: string | null;
  media_buyer: string | null;
  status: string;
  first_seen: string | null;
  last_seen: string | null;
  spend_30d?: number | null;
  leads_30d?: number | null;
}

/**
 * ⛔ ONE TEMPLATE PER BREAKPOINT, SHARED BY THE HEADER AND EVERY ROW.
 *
 * 🔴 THE DEFECT THIS REPLACES — and it was the ORIGINAL "cutoffs" complaint, reintroduced
 * by the fix for it. There was a single non-responsive template of six tracks, and the
 * columns were hidden with `hidden sm:block` / `md:` / `lg:` on the CHILDREN.
 * `display:none` removes a grid ITEM; it does not remove a TRACK. Explicit tracks are
 * always generated. So 492px of fixed tracks plus 60px of gaps stayed on the grid at every
 * viewport, `minmax(0,1fr)` dutifully absorbed the whole deficit, and the company column —
 * the entire point of the screen — computed to ZERO between 1024 and 1076px and overflowed
 * the page by 225px at 375px.
 *
 * ⭐ THE RULE: whenever a column is hidden, the TEMPLATE changes too, in the same constant.
 * Track order below always matches DOM order, because hidden children are skipped and the
 * survivors fill the tracks in sequence.
 *
 *   < 640    company | spend | edit
 *   ≥ 640    company | program | spend | edit
 *   ≥ 768    company | program | buyer | spend | edit
 *   ≥ 1024   company | program | spend | edit          ← see below
 *   ≥ 1280   company | program | buyer | spend | edit
 *   ≥ 1536   company | id | program | buyer | spend | edit
 *
 * ⚠️ 1024 GOES BACKWARDS ON PURPOSE, and this is the non-obvious part. At exactly `lg` the
 * 220px app sidebar and the 184px settings rail both appear (plus a 48px gap) — the layout
 * gains 452px of chrome while the viewport gains one pixel. A monotonic column set would
 * leave the company name 112px there. The template is driven by AVAILABLE WIDTH, not by
 * viewport width, and at `lg` the available width drops.
 *
 * 🔴 AND `xl` REINTRODUCED THE SAME DEFECT ONE BREAKPOINT LATER, which is why this comment
 * is being amended a second time. The available width at 1280 is ~780px, identical to 1279
 * (the chrome already mounted at `lg`; nothing else changes at `xl`). The old `xl` template
 * spent 236 of those pixels bringing BOTH Account ID (128px) and Media buyer (96px) back at
 * once, so the company track fell from 507px to 260px ON ONE EXTRA PIXEL OF VIEWPORT —
 * measured: 18 of 52 company names clipped at 1280 against 0 at 1440, and 36 of 52 Meta-name
 * subtitles, which is the string you read to DECIDE the mapping.
 *
 * ⭐ THE RULE THAT FIXES IT: a column may only come back when the width that pays for it has
 * actually arrived. Media buyer (96px) returns at `xl`, where ~780px can carry it. Account ID
 * is the widest optional column and the one with a guaranteed fallback — it is rendered
 * inline under the company name at every width where its column is absent — so it waits for
 * `2xl` (1536px, ~1036px available). Nothing is lost at any width; only the SHAPE moves.
 *
 * `minmax(0,1fr)` and not `1fr`: a bare `1fr` has an `auto` minimum, so a long unbreakable
 * name pushes the grid wider than its container instead of truncating.
 */
const COLS = [
  'grid items-center gap-3',
  'grid-cols-[minmax(0,1fr)_88px_44px]',
  'sm:grid-cols-[minmax(0,1fr)_104px_88px_44px]',
  'md:grid-cols-[minmax(0,1fr)_104px_96px_88px_44px]',
  'lg:grid-cols-[minmax(0,1fr)_104px_88px_44px]',
  'xl:grid-cols-[minmax(0,1fr)_104px_96px_88px_44px]',
  '2xl:grid-cols-[minmax(0,1fr)_128px_104px_96px_88px_44px]',
].join(' ');

/** Visibility for each optional cell. MUST stay in step with the templates above. */
const CELL_ID = 'hidden 2xl:block';
const CELL_PROGRAM = 'hidden sm:block';
const CELL_BUYER = 'hidden md:block lg:hidden xl:block';

/**
 * One horizontal gutter for the whole surface, matching the Data freshness block — and it
 * really does match now, which the previous version of this comment claimed while the
 * freshness block used `px-3`.
 *
 * ⭐ THE NEGATIVE MARGIN IS THE POINT. The section `<h2>` sits at x=0 and every column used
 * to start at x=16, so the heading and the column it names did not line up — four different
 * left edges on one page. The Linear members reference aligns the section title with the
 * first column exactly. Pulling the surface out by its own gutter puts the TEXT at x=0
 * while the hover and selected fills still have padding to breathe in.
 *
 * `3` and not `4`: AppLayout's mobile padding is `p-3`, so `-mx-3` exactly consumes it and
 * the fill runs to the viewport edge. `-mx-4` would exceed it and give the page a 4px
 * horizontal scroll, which is the cutoff defect in miniature.
 */
const ROW_X = 'px-3';
const SURFACE_X = '-mx-3';

/**
 * ⛔ `status` IS NOT IN HERE. It was, and no header ever set it: there is no status column,
 * so that branch of the comparator was unreachable code claiming a feature.
 */
type SortKeyName = 'company' | 'spend' | 'program' | 'buyer';

/** Needs-attention first, and within that the expensive ones first. */
const STATE_RANK: Record<MappingState, number> = { unmapped: 0, unconfirmed: 1, mapped: 2 };

/**
 * ⚠️ ONE STATE, ONE WORD. The pill said "Auto", the filter said "33 unconfirmed" and the
 * panel said "copied from Meta automatically" — three names for one thing, so clicking a
 * control labelled "unconfirmed" filtered down to rows labelled "Auto" and the user had to
 * infer they were the same population. The filter's word wins, because it is the one that
 * also appears as a count.
 */
function StatePill({ state }: { state: MappingState }) {
  if (state === 'mapped') return null;
  const unmapped = state === 'unmapped';
  return (
    <span
      className={cn(
        // `leading-4`: without an explicit line-height an arbitrary `text-[11px]` falls
        // through to `normal`, whose fractional value is what made rows ragged. 16 + 4 = 20,
        // exactly the `leading-5` of the name it sits beside, so the pill cannot set the
        // line's height.
        'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium leading-4',
        unmapped ? 'bg-warning/10 text-warning-strong' : 'bg-muted text-muted-foreground',
      )}
      title={unmapped
        ? 'No company name. This account’s spend is not attributed to any client.'
        : 'Copied from Meta automatically. Nobody has confirmed this is the client’s name.'}
    >
      {unmapped ? 'Unmapped' : 'Unconfirmed'}
    </span>
  );
}

/**
 * 🔴 `role="columnheader"` WAS ON THE `<button>` ITSELF, WHICH DELETED THE BUTTON.
 *
 * axe-core: `aria-allowed-role`, 4 nodes. An explicit `role` REPLACES the implicit one, so
 * the element stopped being a button to assistive tech entirely: AT announced "column
 * header, Company, sort ascending" with nothing anywhere saying it could be activated. The
 * sort control was invisible to exactly the users who most need to be told it exists.
 *
 * ⭐ The correct shape is the one a real `<table>` has: the CELL carries `columnheader` and
 * `aria-sort` (a property of the column, not of the control), and the button lives INSIDE
 * it keeping its own native role. The wrapper is the grid item, so the geometry is unchanged.
 */
function HeaderCell({
  label, sortKey, active, dir, onSort, className, align = 'start',
}: {
  label: string; sortKey: SortKeyName; active: boolean; dir: 'asc' | 'desc';
  onSort: (k: SortKeyName) => void; className?: string; align?: 'start' | 'end';
}) {
  const Arrow = dir === 'asc' ? ArrowUp : ArrowDown;
  /**
   * ⚠️ THE ARROW'S SPACE IS RESERVED WHETHER OR NOT IT IS DRAWN. It used to render only when
   * `active`, so clicking a header shifted its own label by 16px. `invisible` keeps the box
   * and drops the ink.
   *
   * 🔴 THAT FIX REMOVED THE JUMP AND MADE THE MISALIGNMENT PERMANENT, which is the whole
   * point of measuring rather than reasoning. On "30d spend" — the one right-aligned column —
   * a trailing reserved box sits BETWEEN the label and the track's right edge, so the header
   * ink ended 16px short of the numbers it names, at rest AND sorted, at every width. A
   * reserved gutter on the correct side is not a compromise: put the caret on the OUTSIDE of
   * the reading direction, so the label itself lands flush against the column edge. Linear's
   * numeric headers do exactly this.
   */
  const arrow = <Arrow className={cn('h-3 w-3 shrink-0', !active && 'invisible')} aria-hidden />;
  return (
    <div
      // `aria-sort` belongs on the columnheader, and without it a screen reader can hear the
      // button but never which column the table is currently ordered by.
      role="columnheader"
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      // `self-stretch` because the shared template is `items-center`: without it the grid
      // item is content-height and the button's `h-full` resolves against 16px, which is the
      // 16px target this is fixing.
      className={cn('flex min-w-0 items-stretch self-stretch', align === 'end' && 'justify-end', className)}
    >
      <button
        onClick={() => onSort(sortKey)}
        /**
         * ⚠️ `h-full` AND NOT A BARE INLINE ROW. The button measured 16px tall inside a 36px
         * header — under the 24px WCAG 2.5.8 floor, and the other 20px of the header row
         * looked exactly as clickable as the 16px that was. Filling the row makes the target
         * equal the thing that appears to be the target.
         */
        className={cn(
          'flex h-full min-w-0 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors',
          'rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        )}
      >
        {align === 'end' && arrow}
        <span className="truncate">{label}</span>
        {align === 'start' && arrow}
      </button>
    </div>
  );
}

export default function AccountsTable() {
  const [rows, setRows] = useState<AdAccount[]>([]);
  const [loading, setLoading] = useState(true);
  /**
   * 🔴 LOAD FAILURE AND SAVE FAILURE ARE DIFFERENT STATES AND MUST NOT SHARE ONE VARIABLE.
   * They did, and the table branched on it: one failed PATCH replaced all 52 rows plus the
   * in-progress draft with a raw Postgres message, with no way back. The save error now
   * lives in the panel, beside the field that produced it.
   */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  /**
   * 🔴 ONE COUNTER CANNOT LABEL TWO POPULATIONS, and pretending it can produced a sentence
   * that was simply false. The rail counted `classifyMapping(r) !== 'mapped'` and rendered
   * it as "34 need a company name" over a table where 51 of 52 rows HAVE one: 33 of those
   * 34 are `unconfirmed`, which means the name is present and merely copied from Meta
   * without anyone confirming it. Exactly the class of wrongness that started this project
   * — a screen stating something it had not earned — reintroduced by the screen that fixed
   * it. The two populations now get two counts, two labels and two filters.
   */
  const [filterState, setFilterState] = useState<MappingState | null>(null);
  const [sort, setSort] = useState<{ key: SortKeyName; dir: 'asc' | 'desc' }>({ key: 'company', dir: 'asc' });
  const [editing, setEditing] = useState<AdAccount | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const [acc, spend] = await Promise.all([
      sb.from('ad_accounts')
        .select('account_id, meta_name, company_name, program, media_buyer, status, first_seen, last_seen'),
      sb.from('ad_account_spend_30d').select('account_id, spend_30d, leads_30d'),
    ]);
    // An empty list and a failed load are DIFFERENT, and the screen this replaces rendered
    // them identically. Say which one happened.
    if (acc.error) {
      setLoadError(acc.error.message);
      setRows([]);
    } else {
      setLoadError(null);
      // Spend is decoration on top of identity: if only THAT read fails the table still
      // works, it just cannot prioritise. Never let it blank the page.
      const spendBy = new Map<string, { spend_30d: number; leads_30d: number }>(
        (spend.error ? [] : (spend.data ?? [])).map((s: { account_id: string; spend_30d: string | number; leads_30d: number }) =>
          [s.account_id, { spend_30d: Number(s.spend_30d) || 0, leads_30d: Number(s.leads_30d) || 0 }]),
      );
      setRows(((acc.data ?? []) as AdAccount[]).map(r => ({ ...r, ...spendBy.get(r.account_id) })));
    }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const companies = useMemo(
    () => [...new Set(rows.map(displayCompany).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const buyers = useMemo(
    () => [...new Set(rows.map(r => r.media_buyer?.trim()).filter((b): b is string => !!b))].sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = rows;
    if (q) {
      out = out.filter(r =>
        [r.meta_name, r.company_name, r.media_buyer, r.program, r.account_id]
          .some(v => (v ?? '').toLowerCase().includes(q)));
    }
    if (filterState) out = out.filter(r => classifyMapping(r) === filterState);

    const dir = sort.dir === 'asc' ? 1 : -1;
    const cmp = (a: AdAccount, b: AdAccount): number => {
      if (sort.key === 'spend') return ((a.spend_30d ?? 0) - (b.spend_30d ?? 0)) * dir;
      if (sort.key === 'program') return (a.program ?? '').localeCompare(b.program ?? '') * dir;
      if (sort.key === 'buyer') return (a.media_buyer ?? '').localeCompare(b.media_buyer ?? '') * dir;
      /**
       * ⭐ DEFAULT SORT: needs-attention first, then by 30d spend descending, then by the
       * name actually RENDERED. The old clause ordered by `company_name` while the column
       * displayed `company_name ?? meta_name` — two different sort keys inside one visible
       * column — and because digits collate before letters the four junk rows landed at
       * positions 8 to 11, the most prominent rows on the screen.
       *
       * Spend is the tie-break because an unmapped account quietly spending $34k/yr is the
       * single most expensive thing this table can fail to say.
       */
      const rank = STATE_RANK[classifyMapping(a)] - STATE_RANK[classifyMapping(b)];
      if (rank !== 0) return rank;
      // Attention-rank stays fixed under reversal on purpose: "show me the broken ones
      // last" is not a thing anyone wants, and the arrow reverses the NAME order, which is
      // what the header it sits on is labelled.
      const bySpend = (b.spend_30d ?? 0) - (a.spend_30d ?? 0);
      if (bySpend !== 0) return bySpend;
      const an = displayCompany(a) ?? displayMetaName(a) ?? a.account_id;
      const bn = displayCompany(b) ?? displayMetaName(b) ?? b.account_id;
      return an.localeCompare(bn) * dir;
    };
    return [...out].sort(cmp);
  }, [rows, search, filterState, sort]);

  // Counted separately because they are different claims. `unmapped` = there is no usable
  // company name at all. `unconfirmed` = there IS one, byte-identical to Meta's own name,
  // and nobody has ever agreed it is the client's name.
  const unmappedCount = rows.filter(r => classifyMapping(r) === 'unmapped').length;
  const unconfirmedCount = rows.filter(r => classifyMapping(r) === 'unconfirmed').length;

  const onSort = (key: SortKeyName) =>
    setSort(s => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));

  const save = async (id: string, patch: Partial<AdAccount>): Promise<string | null> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('ad_accounts')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('account_id', id);
    if (error) return error.message;
    setRows(prev => prev.map(r => (r.account_id === id ? { ...r, ...patch } as AdAccount : r)));
    return null;
  };

  const openRow = (r: AdAccount) => { setEditing(r); setPanelOpen(true); };

  return (
    <div className="space-y-4">
      {/**
        * The control rail: filter on the left, counts on the right. Both sit ON the table's
        * own grid gutter rather than floating above it in a separate box.
        *
        * 🔴 IT WAS A HARD-HEIGHT FLEX BOX WITH NO ESCAPE, which is the cutoff defect wearing
        * a different hat. `h-10` + `flex` + no `min-w-0` and no stacking, over content that
        * measures: the counts read "52 accounts · 1 needs a company name · 33 unconfirmed"
        * at ~367px, and a `w-60` `<input>` carries an intrinsic `size=20` minimum of ~239px
        * that keeps it from shrinking. ~623px needed. The Settings content column is
        * `viewport − sidebar − padding − 184px rail − 48px gap`: 780px at 1280 and 524px at
        * 1024, so it overflowed a 40px box from ~1100px down, and at 375px it was four lines
        * outside it.
        *
        * ⛔ `flex-wrap` IS NOT THE FIX and is banned by AccountsTable.test.tsx: wrapping is
        * how the old edit row failed, and a wrapped rail still overflows a fixed height.
        * Three real changes instead:
        *   ① stack below `sm` rather than wrap,
        *   ② `min-h-10`, so the box grows with its content instead of being overrun,
        *   ③ the plain "52 accounts" total is `hidden xl:inline`. Under a filter the count
        *      is INFORMATION ("7 of 52") and always shows; unfiltered it is decoration you
        *      can get by looking at the table, and dropping it is what buys the 90px that
        *      makes the two attention counts fit at 1024.
        */}
      <div className="flex min-h-10 flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="relative w-full min-w-0 sm:w-60">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          {/* ⚠️ A PLACEHOLDER IS NOT A LABEL: it is the field's only name here, and it
              disappears on the first keystroke, so from that moment the control has none.
              Visually hidden rather than visible, because the magnifier plus the placeholder
              already carry the meaning for sighted users. */}
          <label htmlFor="account-filter" className="sr-only">Filter accounts by name, id, program or media buyer</label>
          {/**
            * 🔴 `border-transparent hover:border-border` MEANT "NO BOX, EVER" ON TOUCH.
            * A rest state that only becomes visible on hover is not a rest state on a device
            * that has no hover — it is the permanent state, and the permanent state was a
            * magnifier and some grey text with no field around them. It also disagreed with
            * the app's other two search inputs (Dashboard, Campaigns), which are `h-9` inside
            * a real `border-input` box: one control, two languages, 32px against 36px.
            * The visible box wins on both counts, and the height matches so the two search
            * fields are the same control wherever you meet them.
            */}
          <input
            id="account-filter"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter accounts"
            // `min-w-0` on the input ITSELF. Without it the intrinsic size-20 width is a
            // floor the flex row cannot get under, whatever the wrapper says.
            className="h-9 w-full min-w-0 rounded-md border border-input bg-background pl-8 pr-9 text-[13px] placeholder:text-muted-foreground transition-colors hover:border-border focus-visible:border-ring focus:outline-none"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              // Was a bare 14x14 icon with zero padding — under both the 24px WCAG 2.5.8
              // minimum and any touch guideline. The icon is unchanged; the target is not.
              className="absolute right-1 top-1/2 -translate-y-1/2 grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-row-hover hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors"
              aria-label="Clear filter"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {/**
          * 🔴 THE TWO ATTENTION COUNTS WERE THE WHOLE TRIAGE WORKFLOW, DRESSED AS PROSE.
          * "52 accounts · 26 need a company name · 8 unconfirmed" read as one muted 12px
          * sentence; segments 2 and 3 were filter toggles and segments 1–3 differed only by
          * `font-medium`. No border, no underline, no chevron, no rest-state cue of any kind
          * — and `hover:text-…` is not a cue on touch, where the hover never arrives. They
          * were also 20px tall, under the 24px WCAG 2.5.8 floor.
          *
          * ⭐ THEY ARE CHIPS NOW: a hairline border AT REST is the affordance, present on
          * every device, and it is what separates them from the static total beside them —
          * which correctly stays plain text, because it is not a control. The middots are
          * gone with them: a separator between two bordered chips is noise, and the gap
          * already does that work.
          */}
        <div className="flex shrink-0 items-center gap-2 text-xs">
          {/* Counted from `rows`, and labelled "of N" so it can never read
              "Accounts 1 … 7 unmapped" the way the old bar did under a filter. */}
          <span className={cn('whitespace-nowrap text-muted-foreground', filtered.length === rows.length && 'hidden xl:inline')}>
            {filtered.length === rows.length
              ? `${rows.length} accounts`
              : `${filtered.length} of ${rows.length} accounts`}
          </span>
          {unmappedCount > 0 && (
            <button
              onClick={() => setFilterState(s => (s === 'unmapped' ? null : 'unmapped'))}
              // A toggle that stays pressed has to SAY it is pressed. The colour change
              // was the only signal, which is no signal at all without sight.
              aria-pressed={filterState === 'unmapped'}
              className={cn(
                'inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-md border px-2 font-medium transition-colors',
                'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                filterState === 'unmapped'
                  ? 'border-warning-strong/40 bg-warning/10 text-warning-strong'
                  : 'border-warning-strong/25 text-warning-strong hover:bg-warning/10',
              )}
            >
              {unmappedCount === 1 ? '1 needs a company name' : `${unmappedCount} need a company name`}
            </button>
          )}
          {unconfirmedCount > 0 && (
            <button
              onClick={() => setFilterState(s => (s === 'unconfirmed' ? null : 'unconfirmed'))}
              aria-pressed={filterState === 'unconfirmed'}
              className={cn(
                'inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-md border px-2 font-medium transition-colors',
                'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                filterState === 'unconfirmed'
                  ? 'border-transparent bg-accent text-accent-foreground'
                  : 'border-border text-muted-foreground hover:bg-row-hover hover:text-foreground',
              )}
              title="These names were copied from Meta automatically. Opening one and saving it is how you confirm it."
            >
              {unconfirmedCount} unconfirmed
            </button>
          )}
        </div>
      </div>

      {/* No outer border, no radius. It is RULED, not boxed — the single biggest departure
          from what shipped, and the main reason the old one read as an admin dashboard. */}
      {/**
        * ⚠️ THIS IS A TABLE, AND IT HAD NO TABLE SEMANTICS AT ALL. Nested divs with no
        * `role`, no `aria-sort` and no `aria-pressed`: a screen reader got 52 rows of
        * unassociated strings with no column names attached to any of them, on a screen
        * whose entire job is "which company is this account". The named design reference
        * (the Linear members table) is a real table; matching its LOOK while dropping its
        * STRUCTURE is copying the paint and leaving the mechanism.
        *
        * Roles rather than a `<table>` element because the responsive column set is driven
        * by `grid-template-columns` per breakpoint, which `display: table` cannot express.
        */}
      <div role="table" aria-label="Ad accounts" className={SURFACE_X}>
        <div className={cn(COLS, 'h-9 border-b border-divider', ROW_X)} role="row">
          <HeaderCell label="Company" sortKey="company" active={sort.key === 'company'} dir={sort.dir} onSort={onSort} />
          {/* Not sortable: an id has no meaningful order and a header that reorders rows
              into an arbitrary sequence is a control that does something for no reason. */}
          <span role="columnheader" className={cn(CELL_ID, 'text-xs font-medium text-muted-foreground')}>Account ID</span>
          <HeaderCell label="Program" sortKey="program" active={sort.key === 'program'} dir={sort.dir} onSort={onSort} className="hidden sm:flex" />
          <HeaderCell label="Media buyer" sortKey="buyer" active={sort.key === 'buyer'} dir={sort.dir} onSort={onSort} className="hidden md:flex lg:hidden xl:flex" />
          <HeaderCell label="30d spend" sortKey="spend" active={sort.key === 'spend'} dir={sort.dir} onSort={onSort} align="end" />
          <span role="columnheader" className="sr-only">Edit</span>
        </div>

        {loading ? (
          /**
           * Rows at the REAL 56px height, because a spinner collapses the table from
           * ~2,900px to 90px and the page jumps twice per load.
           *
           * ⚠️ TWELVE, NOT SIX. Six was still 336px against 52 real rows at 2,912px, so the
           * skeleton solved the "table becomes a spinner" jump and left a ~2,600px one
           * behind it, which is enough to re-fire the settings scroll-spy and move the rail
           * highlight under the reader's cursor. Twelve fills any realistic viewport, so
           * nothing below the fold moves when the data lands.
           */
          /**
           * ⚠️ `role="row"` ON THE SKELETONS, AND ON THE TWO MESSAGE BRANCHES BELOW.
           * `role="table"` REQUIRES row-ish children (`aria-required-children`), and all
           * three of these branches were bare `<div>`s with no role — so in the loading,
           * failed and empty states, which is every state except the happy one, the table
           * was structurally invalid and AT could legitimately drop the whole subtree.
           * A message inside a table is still a row with one cell spanning it.
           */
          Array.from({ length: 12 }).map((_, i) => (
            <div key={i} role="row" aria-hidden className={cn(COLS, 'h-14 border-b border-divider last:border-b-0', ROW_X)}>
              <div role="cell" className="space-y-1.5">
                <Skeleton className="h-3.5 w-48" />
                <Skeleton className="h-3 w-32" />
              </div>
              <div role="cell" className={CELL_ID}><Skeleton className="h-3 w-24" /></div>
              <div role="cell" className={CELL_PROGRAM}><Skeleton className="h-3 w-20" /></div>
              <div role="cell" className={CELL_BUYER}><Skeleton className="h-3 w-12" /></div>
              <div role="cell"><Skeleton className="h-3 w-14 ml-auto" /></div>
              <div role="cell" />
            </div>
          ))
        ) : loadError ? (
          <div role="row">
            <div role="cell" className="py-12 text-center space-y-3">
              <p className="text-[13px] text-destructive">Could not load accounts: {loadError}</p>
              <button onClick={() => void load()} className="text-[13px] font-medium underline text-foreground">
                Try again
              </button>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div role="row">
            <div role="cell" className="py-12 text-center space-y-3">
              <p className="text-[13px] text-muted-foreground">
                {rows.length === 0
                  ? 'No ad accounts yet. They appear automatically after the first Meta pull.'
                  : 'No accounts match that filter.'}
              </p>
              {rows.length > 0 && (
                <button
                  onClick={() => { setSearch(''); setFilterState(null); }}
                  className="text-[13px] font-medium underline text-foreground"
                >
                  Clear filter
                </button>
              )}
            </div>
          </div>
        ) : (
          filtered.map(r => {
            const state = classifyMapping(r);
            const company = displayCompany(r);
            const metaName = displayMetaName(r);
            const selected = panelOpen && editing?.account_id === r.account_id;
            return (
              <div
                key={r.account_id}
                // `onDoubleClick` was the ONLY row-level affordance, on a row painted
                // `cursor-default`. A gesture with no cursor change, no role and no
                // keyboard equivalent is not an affordance, it is a secret. Single click
                // opens (Linear's members table does the same) and the Edit button stays
                // as the explicit, focusable, screen-reader-reachable control.
                onClick={() => openRow(r)}
                role="row"
                aria-selected={selected}
                className={cn(
                  COLS,
                  // `last:border-b-0`: the table ended on a hairline with a paragraph under
                  // it, while all three of its sibling tables on this page already dropped
                  // theirs. A rule is a divider BETWEEN rows or it is a stray line.
                  'group min-h-[56px] border-b border-divider last:border-b-0 transition-colors cursor-pointer',
                  ROW_X,
                  /**
                   * 🔴 SELECTED AND HOVERED WERE THE SAME ROW. Measured: hover
                   * rgb(243,245,247) against selected rgb(240,244,255) — a 3/1/8 delta,
                   * which is nothing. The selected row is the panel's ONLY anchor back to
                   * the record being edited, on a screen whose entire task is comparative
                   * ("which of these near-identical ' X SocialWorks' names am I editing"),
                   * and it was indistinguishable from wherever the mouse happened to rest.
                   *
                   * ⭐ A FILL CANNOT CARRY THIS AND A SECOND FILL WOULD NOT EITHER — the
                   * two states need different SHAPES, not different shades. The 2px accent
                   * rule is a mark hover does not have at any strength, it survives both
                   * themes because it is the primary token rather than a tint of the
                   * ground, and it lands on the surface's own left edge.
                   *
                   * ⚠️ AND THE SELECTED ROW NOW HAS A HOVER OF ITS OWN. It had none, so the
                   * one row you are most likely to point at was the one row that gave no
                   * feedback when you did.
                   */
                  selected
                    ? 'bg-accent shadow-[inset_2px_0_0_0_hsl(var(--primary))] hover:bg-accent/70'
                    : 'hover:bg-row-hover',
                )}
              >
                {/* IDENTITY. The company is ALWAYS the title, the Meta name is ALWAYS the
                    subtext. Never inverted, whatever is in the column. */}
                {/**
                  * ⚠️ EVERY LINE IN THIS CELL CARRIES AN EXPLICIT `leading-*`, and that is
                  * the whole fix for the ragged mobile rhythm. Measured at 390px across 52
                  * rows: THREE distinct row heights — 59.50px ×34, 59.00px ×17, 58.00px ×1 —
                  * so the hairlines never landed on a rhythm. The cause is that `text-[13px]`
                  * and `text-[11px]` are arbitrary FONT SIZES with no line-height attached,
                  * so each line fell through to `normal`, which is computed from the font's
                  * own ascent/descent metrics and lands on fractional pixels that differ
                  * between the fallback stack and Geist as the webfont swaps in. Pinning the
                  * leading makes the row height arithmetic instead of typographic:
                  * 20 + 2 + 18 + 18 = 58px, identical on every row.
                  */}
                <div className="min-w-0" role="cell">
                  <div className="flex items-center gap-2">
                    {company ? (
                      <span className="truncate text-sm font-medium leading-5 text-foreground" title={company}>{company}</span>
                    ) : (
                      <span className="truncate text-sm italic leading-5 text-muted-foreground">
                        {metaName ? 'No company name' : 'Unknown account'}
                      </span>
                    )}
                    <StatePill state={state} />
                    {/* ⭐ ARCHIVING HAD NO VISIBLE EFFECT. The panel writes `status` and the
                        table rendered no trace of it, so the control appeared to do
                        nothing. It is a state, not a column: it belongs on the row it
                        describes. */}
                    {r.status === 'archived' && (
                      <span className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium leading-4 bg-muted text-muted-foreground">
                        Archived
                      </span>
                    )}
                  </div>
                  {/**
                    * ⚠️ THE ID AND THE META NAME STOPPED COMPETING FOR ONE LINE.
                    * The id chip is `shrink-0` and 15 digits is ~99px; at 375px the company
                    * track is ~163px, so the id won and the client name was cut to about six
                    * characters — the id displacing the name is the exact inversion this
                    * whole screen exists to undo, just at a smaller scale. Below `sm` they
                    * stack (the row is `min-h`, not `h`, so it simply grows); from `sm` up
                    * there is room for both on one line.
                    */}
                  <div className="mt-0.5 min-w-0 sm:flex sm:items-center sm:gap-2">
                    <span className="block truncate text-[13px] leading-[18px] text-muted-foreground" title={metaName ?? undefined}>
                      {metaName ?? `Meta reports only the id ${r.account_id}`}
                    </span>
                    {/* The id is its own element wherever the column is hidden.
                        Concatenated into the subtext it was the LAST thing in the string,
                        so it was the FIRST thing truncated away — and the id is the whole
                        reason this table is keyed the way it is. */}
                    <span className="block truncate sm:shrink-0 2xl:hidden font-mono-tabular text-[11px] leading-[18px] text-muted-foreground" title={r.account_id}>
                      {r.account_id}
                    </span>
                  </div>
                </div>

                <div role="cell" className={cn(CELL_ID, 'min-w-0 font-mono-tabular text-[13px] text-muted-foreground truncate')} title={r.account_id}>
                  {r.account_id}
                </div>
                <div role="cell" className={cn(CELL_PROGRAM, 'min-w-0 truncate text-[13px] text-muted-foreground')} title={r.program ?? 'No program set'}>
                  {r.program ?? '—'}
                </div>
                <div role="cell" className={cn(CELL_BUYER, 'min-w-0 truncate text-[13px] text-muted-foreground')} title={r.media_buyer ?? 'Unassigned'}>
                  {r.media_buyer ?? '—'}
                </div>
                {/* Spend is what turns the `Unmapped` pill from a label into a priority. */}
                <div role="cell" className={cn(
                  'truncate text-right font-mono-tabular text-[13px] tabular-nums',
                  state === 'unmapped' && (r.spend_30d ?? 0) > 0 ? 'text-warning-strong font-medium' : 'text-muted-foreground',
                )}>
                  {formatMoney(r.spend_30d)}
                </div>

                {/* Present at rest — `opacity-0 group-hover:opacity-100` makes the row
                    PERMANENTLY uneditable on touch, where there is no hover at all.
                    ⚠️ But "low contrast" was taken to `text-muted-foreground/50`, which is
                    1.76:1 on white: on a touch device, where the hover state never arrives,
                    that IS the permanent state. Recessed one step, not to the point of
                    invisibility. `hover:bg-accent` and not `hover:bg-background`: the
                    latter is LIGHTER than the row hover in light mode and DARKER in dark
                    mode, so the affordance inverted direction between themes. */}
                <div role="cell" className="justify-self-end">
                  <button
                    onClick={() => openRow(r)}
                    /**
                     * ⚠️ `hover:bg-accent` GAVE NO FEEDBACK ON THE OPEN ROW, because the open
                     * row is ALSO `bg-accent` — so on the one row you are most likely to
                     * click again, the button's hover state was identical to its rest state.
                     * A foreground-relative tint is visible over both the plain row and the
                     * selected one, and it inverts with the theme for free.
                     */
                    className="h-8 px-2.5 rounded-md text-[13px] text-muted-foreground group-hover:text-foreground group-focus-within:text-foreground hover:bg-foreground/[0.07] hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors"
                    aria-label={`Edit ${company ?? metaName ?? r.account_id}`}
                  >
                    Edit
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/**
        * 🔴 THIS SENTENCE USED TO BE FALSE, and it was false in the exact way this whole
        * project exists to stamp out: it stated an OUTCOME the code did not deliver. It read
        * "Mark agency and recruiting accounts as Internal so their spend is kept out of
        * client cost-per-lead." The panel writes `ad_accounts.program`; cost-per-lead read
        * `alias?.program` out of the legacy `app_settings.accountAliases` store, and
        * `AccountMapping['program']` was typed `'Done For You' | 'Done With You' | 'Other'`
        * so the literal string `Internal` could not reach the computation down ANY path.
        *
        * Both halves are now true: `src/lib/accountRegistry.ts` makes this table the source
        * of program and media buyer for every screen, and `Internal` is a first-class value
        * of the type. The sentence now claims only what is delivered — it labels and groups.
        * It deliberately does NOT claim the spend is excluded from anything, because no
        * rollup drops it, and promising that would put the lie back.
        */}
      <p className="text-xs text-muted-foreground">
        Mark agency and recruiting accounts as <span className="font-medium text-foreground">Internal</span> to
        keep them out of the client program groups. The company, program and media buyer set here
        are what every screen in the app reports by.
      </p>

      <AccountEditPanel
        account={editing}
        open={panelOpen}
        onOpenChange={setPanelOpen}
        companies={companies}
        buyers={buyers}
        onSave={save}
      />
    </div>
  );
}
