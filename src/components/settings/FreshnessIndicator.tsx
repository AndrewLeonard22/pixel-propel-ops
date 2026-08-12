/**
 * "Ad spend updated 1.5 hours ago" — and it must visibly degrade when the pipeline is not
 * healthy. See src/lib/adFreshness.ts for why `ad_pull_runs` is the source and why the two
 * obvious alternatives both read FRESH over a dead pipeline.
 */
import { RefreshCw } from 'lucide-react';
import {
  useAdFreshness, freshnessLine, freshnessShortLine, freshnessTone, freshnessTextTone,
  freshnessDetail, relativeTime, parsePullErrors, type AdFreshness,
} from '@/lib/adFreshness';
import { cn } from '@/lib/utils';

/**
 * The header form: one dot, one muted line. Replaces two clocks, does not add a third.
 * `compact` uses the short sentence; the full one and the run detail stay in the tooltip.
 */
export function FreshnessBadge({ f, compact = false }: { f: AdFreshness; compact?: boolean }) {
  return (
    <span
      className={cn('flex items-center gap-1.5 text-xs min-w-0', freshnessTextTone(f.state))}
      title={compact ? `${freshnessLine(f)} ${freshnessDetail(f)}` : freshnessDetail(f)}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', freshnessTone(f.state))} />
      <span className="truncate">{compact ? freshnessShortLine(f) : freshnessLine(f)}</span>
    </span>
  );
}

/**
 * The header instance, self-fetching.
 *
 * ⚠️ THE SEPARATOR IS RENDERED HERE, NOT BY THE HEADER. AppLayout used to draw a bare
 * `<span>·</span>` unconditionally between two CONDITIONAL siblings, and this component
 * returns `null` while its query is in flight — so every single page load showed a middot
 * floating with nothing on either side, and it stayed there forever if the query failed.
 * A separator is only a separator when there is something on both sides of it, which only
 * the thing on the right can know.
 */
export function HeaderFreshness({ separator = false }: { separator?: boolean }) {
  const f = useAdFreshness();
  /**
   * ⚠️ NOT `return null` WHILE LOADING. It was, and the header then popped a ~180px element
   * into an already-laid-out flex row on every single page load, shoving the Refresh button
   * left and back again. A skeleton of the same height holds the space, and it deliberately
   * carries NO dot colour and NO words: an unresolved query must not paint a state.
   */
  if (f.loading) {
    return (
      <>
        {separator && <span className="hidden sm:block text-muted-foreground/30 text-xs">·</span>}
        <span
          aria-hidden
          className="hidden sm:block h-3 w-[150px] rounded bg-muted-foreground/10 animate-pulse"
        />
      </>
    );
  }
  return (
    <>
      {separator && <span className="hidden sm:block text-muted-foreground/30 text-xs">·</span>}
      <FreshnessBadge f={f} compact />
    </>
  );
}

const fmtInt = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('en-US');

/**
 * ⛔ ONE TEMPLATE PER BREAKPOINT, SHARED BY THE HEADER AND EVERY ROW — the same law as
 * `COLS` in AccountsTable.tsx, and this table is why the law needs restating.
 *
 * 🔴 THE DEFECT THIS REPLACES, one section below the table that fixed it. This grid was a
 * single non-responsive `grid-cols-[1fr_88px_92px_88px_96px]`: 364px of fixed tracks plus
 * 24px of `px-3`, a 388px floor with no breakpoint variants and no `min-w-0` anywhere. Below
 * 412px there is not that much room — `AppLayout` gives `p-3`, so a 375px phone has 351px —
 * and the arithmetic is font-independent: the `1fr` "Started" track computes to ZERO, the
 * date and "2 hours ago" render as literally nothing, and the row overflows by 37px. iPhone
 * SE and 13 mini (375), Galaxy S (360), Pixel (393) and iPhone 14 (390) all hit it.
 *
 * ⭐ THE RULE, restated: a hidden column MUST also drop its track, in this same constant.
 * Track order matches DOM order because hidden children are skipped and the survivors fill
 * the tracks in sequence.
 *
 *   < 640    started | result
 *   ≥ 640    started | accounts | result
 *   ≥ 768    started | accounts | rows | result
 *   ≥ 1024   started | accounts | result            ← the settings rail appears here
 *   ≥ 1280   started | duration | accounts | rows | result
 *
 * ⚠️ 1024 GOES BACKWARDS ON PURPOSE, for the reason spelled out in AccountsTable: at `lg`
 * the app sidebar AND the 184px settings rail both mount, so the layout gains ~450px of
 * chrome while the viewport gains one pixel. Available width, not viewport width, drives
 * the template.
 */
const RUN_COLS = [
  'grid items-center gap-3',
  'grid-cols-[minmax(0,1fr)_84px]',
  'sm:grid-cols-[minmax(0,1fr)_92px_84px]',
  'md:grid-cols-[minmax(0,1fr)_92px_88px_84px]',
  'lg:grid-cols-[minmax(0,1fr)_92px_84px]',
  'xl:grid-cols-[minmax(0,1fr)_88px_92px_88px_84px]',
].join(' ');

/** Visibility per optional cell. MUST stay in step with the templates above. */
const RUN_DURATION = 'hidden xl:block';
const RUN_ACCOUNTS = 'hidden sm:block';
const RUN_ROWS = 'hidden md:block lg:hidden xl:block';

/**
 * The same horizontal gutter the accounts table uses, so the two sections line up — and the
 * same negative margin, so both tables put their first column at the same x as the section
 * heading above them. See ROW_X in AccountsTable.tsx for why it is 3 and not 4.
 */
const RUN_X = 'px-3';
const RUN_SURFACE_X = '-mx-3';

/** The Settings section: the line, a refresh, then the last five runs as a ruled table. */
export default function FreshnessSection() {
  const f = useAdFreshness();

  return (
    <div className="space-y-4">
      {/* Stacks below `sm`: the `partial` sentence runs to 96 characters, and centring a
          40px button against three wrapped lines of it puts the control in the middle of
          nowhere. */}
      <div className="flex flex-col items-start gap-3 rounded-lg bg-surface-raised px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0 space-y-1">
          <div className={cn('flex items-center gap-2 text-sm font-medium', freshnessTextTone(f.state))}>
            <span className={cn('h-2 w-2 rounded-full shrink-0', freshnessTone(f.state))} />
            <span>{f.loading ? 'Reading pull history' : freshnessLine(f)}</span>
          </div>
          <p className="text-[13px] text-muted-foreground">
            {f.lastSuccess
              ? `Last pull ran ${new Date(f.lastSuccess.finished_at!).toLocaleString()}, covering ${fmtInt(f.lastSuccess.accounts_ok)} accounts and ${fmtInt(f.lastSuccess.rows_upserted)} rows.`
              : 'Meta ad spend is pulled automatically every 3 hours.'}
          </p>
        </div>
        <button
          onClick={f.reload}
          disabled={f.loading}
          className="shrink-0 flex items-center gap-2 h-9 px-3 text-[13px] font-medium rounded-md border border-input bg-background hover:bg-row-hover transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', f.loading && 'animate-spin')} />
          Check again
        </button>
      </div>

      {/* Every failed account named, never counted. "2 accounts failed" cannot tell anyone
          which client's spend is missing from the totals they are about to read. */}
      {f.latest && parsePullErrors(f.latest.error).length > 0 && (
        <ul className="space-y-1.5">
          {parsePullErrors(f.latest.error).map((e, i) => (
            <li key={i} className="text-[13px] text-muted-foreground">
              <span className="text-foreground">{e.account ?? 'Unknown account'}</span>
              {' '}could not be pulled{e.chunk ? ` for ${e.chunk}` : ''}: {e.error ?? 'unknown error'}
            </li>
          ))}
        </ul>
      )}

      {/* ⚠️ A GRID OF DIVS ANNOUNCES AS A WALL OF UNRELATED TEXT. This is a table by every
          definition except the DOM's, so it carries the roles a table carries: without them
          a screen reader reads five runs as fifteen loose strings with no column names. */}
      <div role="table" aria-label="Recent Meta pulls" className={RUN_SURFACE_X}>
        <div className={cn(RUN_COLS, 'h-9 border-b border-divider text-xs font-medium text-muted-foreground', RUN_X)} role="row">
          <div role="columnheader">Started</div>
          <div role="columnheader" className={cn(RUN_DURATION, 'text-right')}>Duration</div>
          <div role="columnheader" className={cn(RUN_ACCOUNTS, 'text-right')}>Accounts</div>
          <div role="columnheader" className={cn(RUN_ROWS, 'text-right')}>Rows</div>
          <div role="columnheader" className="text-right">Result</div>
        </div>
        {/* ⚠️ `role="row"` / `role="cell"`, because `role="table"` REQUIRES row-ish children
            (`aria-required-children`) and these two branches were role-less divs — so in the
            loading and never-pulled states the table was structurally invalid and AT was
            free to drop the subtree, taking the "no pull has ever run" sentence with it.
            That sentence is the single most important thing this section can say. */}
        {f.loading ? (
          <div role="row">
            <div role="cell" className={cn('py-6 text-[13px] text-muted-foreground', RUN_X)}>Loading pull history</div>
          </div>
        ) : f.runs.length === 0 ? (
          <div role="row">
            <div role="cell" className={cn('py-6 text-[13px] text-muted-foreground', RUN_X)}>
              No pull has been recorded yet. This is not the same as a pull returning nothing.
            </div>
          </div>
        ) : (
          f.runs.map(r => {
            const started = new Date(r.started_at);
            const dur = r.finished_at
              ? Math.max(0, (Date.parse(r.finished_at) - Date.parse(r.started_at)) / 1000)
              : null;
            const tone = r.status === 'ok' ? 'text-muted-foreground'
              : r.status === 'partial' ? 'text-warning-strong'
              : r.status === 'running' ? 'text-muted-foreground'
              : 'text-destructive';
            return (
              <div
                key={r.id}
                className={cn(
                  RUN_COLS,
                  'h-12 border-b border-divider last:border-b-0 text-[13px] hover:bg-row-hover transition-colors',
                  RUN_X,
                )}
                role="row"
              >
                {/* Everything the hidden columns carry has to survive somewhere, so the
                    narrow form folds duration and counts into the `title`. A column that is
                    dropped without its value going anywhere is data deleted, not hidden. */}
                <div
                  role="cell"
                  className="min-w-0 truncate text-foreground"
                  title={`${started.toLocaleString()}${dur == null ? '' : ` · ran ${dur.toFixed(0)}s`} · ${fmtInt(r.accounts_ok)} accounts, ${fmtInt(r.rows_upserted)} rows`}
                >
                  {started.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  <span className="text-muted-foreground"> · {relativeTime(Date.now() - started.getTime())}</span>
                </div>
                <div role="cell" className={cn(RUN_DURATION, 'text-right font-mono-tabular text-muted-foreground')}>
                  {dur == null ? '—' : `${dur.toFixed(0)}s`}
                </div>
                <div role="cell" className={cn(RUN_ACCOUNTS, 'text-right font-mono-tabular text-muted-foreground')}>
                  {fmtInt(r.accounts_ok)}{r.accounts_failed ? ` / ${fmtInt(r.accounts_discovered)}` : ''}
                </div>
                <div role="cell" className={cn(RUN_ROWS, 'text-right font-mono-tabular text-muted-foreground')}>{fmtInt(r.rows_upserted)}</div>
                <div role="cell" className={cn('text-right capitalize truncate', tone)}>{r.status}</div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
