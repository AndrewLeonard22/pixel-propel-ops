/**
 * WHEN THE AD SPEND WAS LAST PULLED — @andrew: "there should be a way to see the last time
 * the ad spend was updated" (e.g. "1.5 hours ago").
 *
 * 🔴 THE OBVIOUS SOURCE IS ALREADY BROKEN, AND IT LOOKS FINE TODAY.
 *
 * `max(ad_insights.fetched_at)` is the column everyone reaches for. It is `default now()`
 * on INSERT and the writer upserts with `Prefer: resolution=merge-duplicates` over a
 * payload that has no `fetched_at` key — so PostgREST's generated `ON CONFLICT DO UPDATE`
 * never touches it. Measured on the live table: run 7 rewrote all 259 rows in its range and
 * moved `fetched_at` on ZERO of them.
 *
 * So that column means "when a brand-new (date, ad_id) was first seen", not "when we last
 * refreshed". Under healthy 3-hourly operation the trailing window is almost entirely
 * updates, so it only advances at day rollover: it sits anywhere from 0 to ~24h stale WHILE
 * PERFECTLY HEALTHY, which makes a real 8-hour outage indistinguishable from a quiet
 * Tuesday. Worse, a run that dies partway still inserts new rows first, so it can jump
 * FORWARD on a failed run.
 *
 * ⛔ `cron.job_run_details` is disqualified twice: it lives in the `cron` schema which
 * PostgREST cannot reach, and its command is `select net.http_post(...)`. pg_net is
 * asynchronous, so the row reads `succeeded` as soon as the request is QUEUED — it would
 * say "ran 20 minutes ago, succeeded" over a pipeline returning 500 every cycle. That is
 * a signal that cannot fail, which means it is not a signal.
 *
 * ⭐ `ad_pull_runs` IS THE ONLY CANDIDATE THAT CANNOT READ FRESH WHEN THE PIPELINE IS DEAD.
 * If the cron stops, no row is written at all, so the newest timestamp freezes and the
 * rendered age grows without bound. It ages honestly and monotonically.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/** The pg_cron job `meta-pull-3h` fires every 3 hours. Every threshold below DERIVES from this. */
export const PULL_INTERVAL_HOURS = 3;
/**
 * One missed cycle is noise, two is a signal. Derived rather than written as a literal `6`,
 * so moving the cron to hourly cannot strand a rule that then certifies a 5-hour outage as
 * healthy — the stale-law shape.
 */
export const STALE_AFTER_HOURS = PULL_INTERVAL_HOURS * 2;
/** A run still `running` past this is not slow, it is dead: the isolate was killed. */
export const STUCK_AFTER_MINUTES = 15;

export interface PullRun {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  accounts_ok: number | null;
  accounts_failed: number | null;
  accounts_discovered: number | null;
  rows_upserted: number | null;
  error: string | null;
}

export type FreshnessState =
  | 'fresh'    // recent, and the last run succeeded outright
  | 'partial'  // the last run finished with accounts dropped: some spend IS missing
  | 'failed'   // the last run errored; what is on screen is older than it looks
  | 'stale'    // nothing has succeeded for two full cycles. Fires on ELAPSED TIME.
  | 'stuck'    // a run started and never reported back
  | 'unknown'; // no rows, or the query failed. NEVER "just now".

export interface AdFreshness {
  state: FreshnessState;
  /** Newest run that actually produced data. The age shown always describes THIS. */
  lastSuccess: PullRun | null;
  /** Newest run by start time, whatever became of it. Its status drives the state. */
  latest: PullRun | null;
  loading: boolean;
  /** Millisecond age of `lastSuccess`, or null when unknown. Never defaulted to 0. */
  ageMs: number | null;
  runs: PullRun[];
}

/** One failed account inside `ad_pull_runs.error`, which is a JSON array as text. */
export interface PullError { account?: string; error?: string; chunk?: string }

export function parsePullErrors(raw: string | null): PullError[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as PullError[]) : [{ error: String(raw) }];
  } catch {
    return [{ error: raw }];
  }
}

/**
 * "1.5 hours ago" — @andrew's own words, and finer than the app's existing `useTimeAgo`,
 * which coarsens everything past an hour to "over an hour ago".
 */
export function relativeTime(ms: number | null): string {
  if (ms == null) return 'unknown';
  /**
   * ⚠️ `NaN` IS NOT `null`, AND IT USED TO PRINT. `null` was guarded and `< 0` was guarded;
   * `NaN` fails both comparisons, walked the whole ladder and emitted the literal string
   * "NaN days ago". Unreachable through `ageMs` (the hook maps NaN to null) but reachable
   * from the two callers that do their own arithmetic on `started_at` — FreshnessIndicator's
   * run list and the `stuck` sentence below — either of which can hold an unparseable
   * timestamp. A number that is not a number is a REFUSAL, and a refusal must render as one.
   */
  if (!Number.isFinite(ms)) return 'unknown';
  // A negative age means clock skew between the Deno writer and this browser. Unknown is
  // the honest read; "just now" would be the flattering one, and flattering is the bug.
  if (ms < 0) return 'unknown';
  const secs = ms / 1000;
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = secs / 3600;
  if (hours < 24) {
    /**
     * ⚠️ FLOOR, NOT ROUND — the label must never claim a number the STATE has not crossed.
     * `Math.round` made 5.9h read "6 hours ago" in GREEN while 6.0h read "6 hours ago" in
     * RED (STALE_AFTER_HOURS is 6). Same displayed number, opposite colours, on a badge
     * whose whole job is to be trusted at a glance. Flooring to the half hour makes the
     * printed age a LOWER BOUND on the real age, so the text can only ever lag the state
     * change, never announce one that has not happened.
     */
    const floored = Math.floor(hours * 2) / 2;           // down to the half hour
    const label = floored % 1 === 0 ? String(floored) : floored.toFixed(1);
    return `${label} hour${floored === 1 ? '' : 's'} ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * Derive the state from the two runs and the clock.
 *
 * ⚠️ ORDER IS THE ARGUMENT. `stale` is tested FIRST because it is the only state that fires
 * on ELAPSED TIME rather than on an error row — a silently stopped cron produces no error
 * row at all, so every other state depends on the pipeline being alive enough to report.
 * `partial` outranks `fresh` even when the data is 20 minutes old: run 3 finished with two
 * spending accounts dropped on a Meta rate limit, and a green dot over that is a lie.
 */
export function deriveState(
  latest: PullRun | null,
  lastSuccess: PullRun | null,
  now: number,
  /**
   * Every run in the window, newest first. Optional because `latest` + `lastSuccess` answer
   * most questions — but NOT the one below, which needs the runs BETWEEN them.
   */
  runs: readonly PullRun[] = [],
): FreshnessState {
  if (!latest && !lastSuccess) return 'unknown';
  const successAt = lastSuccess?.finished_at ? Date.parse(lastSuccess.finished_at) : NaN;
  const ageH = Number.isNaN(successAt) ? Infinity : (now - successAt) / 3_600_000;

  if (ageH >= STALE_AFTER_HOURS) return 'stale';
  if (latest?.status === 'running') {
    const startedAt = Date.parse(latest.started_at);
    if (!Number.isNaN(startedAt) && now - startedAt > STUCK_AFTER_MINUTES * 60_000) return 'stuck';
  }
  if (latest?.status === 'partial') return 'partial';
  if (latest && (latest.status === 'failed' || latest.status === 'error')) return 'failed';
  if (!lastSuccess) return 'unknown';
  /**
   * 🔴 AN IN-FLIGHT RUN MUST NOT LAUNDER THE FAILURE UNDERNEATH IT.
   *
   * Everything above inspects `runs[0]` ALONE. The cron fires every 3 hours, so this shape
   * is ordinary rather than exotic: a `running` row on top (younger than STUCK_AFTER_MINUTES,
   * so not yet `stuck`), a `failed` row beneath it, and a success 5 hours old underneath
   * that. `latest.status` is `running`, which matches no failure branch, so control fell
   * through to the counts of a run that DID succeed — and the badge went GREEN over a
   * pipeline whose most recent COMPLETED attempt errored.
   *
   * The age shown stayed truthful; only the dot lied, which is worse, because the dot is
   * the part anyone actually reads. `latest` is the newest run by START; health belongs to
   * the newest run that FINISHED. Those are the same row only when nothing is in flight.
   */
  const successAtMs = Date.parse(lastSuccess.finished_at ?? '');
  const failedSinceSuccess = runs.some(r => {
    if (r.status !== 'failed' && r.status !== 'error') return false;
    if (!r.finished_at) return false;
    const at = Date.parse(r.finished_at);
    if (Number.isNaN(at)) return false;
    return Number.isNaN(successAtMs) || at > successAtMs;
  });
  if (failedSinceSuccess) return 'failed';
  /**
   * 🔴 THE STATUS WORD IS NOT ALLOWED TO OUTRANK THE COUNTS IT CLAIMS TO SUMMARISE.
   *
   * Everything above this line trusts `latest.status`, and `status === 'ok'` was taken as
   * proof of health without ever looking at `accounts_discovered`, `accounts_ok` or
   * `rows_upserted` — which sit on the row already being read.
   *
   * That is reachable in production, not a thought experiment. `meta-pull` builds its
   * account list with `for (const a of (body.data as AccountRef[]) ?? [])`. When Meta
   * answers HTTP 200 with `{"data":[]}` — which is what a System User gets when its asset
   * assignments or `ads_management` scope are pulled, rather than an error — discovery
   * yields `[]`, the worker pool is `Math.min(6, 0)` = zero workers, `failures` stays
   * empty, and the writer computes `failures.length === 0 ? 'ok' : 'partial'` → **ok**.
   * The row lands as `ok / 0 discovered / 0 ok / 0 failed / 0 rows` and the badge says
   * GREEN every three hours, indefinitely, over a pipeline moving no money at all.
   *
   * That `?? []` is the refusal-becomes-a-value shape: "Meta told us nothing" is silently
   * converted into "there are zero accounts", which is then reported as health. The module
   * comment above is right that `ad_pull_runs` cannot read fresh over a DEAD pipeline; it
   * does not cover a LIVE pipeline moving zero rows, which is the same $770k blind spot.
   *
   * ⭐ So health is derived from the counts, not from the word. Deriving it here also
   * removes a stale-law risk: today the writer cannot emit `ok` alongside a non-zero
   * `accounts_failed`, so the reader's trust happens to be safe — and that coincidence is
   * one edit to the edge function away from ending.
   *
   * `null` counts are NOT treated as zero. An older row that predates a column, or a
   * column the reader failed to select, must not be convertible into "discovered nothing".
   * Only a measured zero is a measured zero.
   */
  const discovered = lastSuccess.accounts_discovered;
  const okCount = lastSuccess.accounts_ok;
  const failedCount = lastSuccess.accounts_failed;
  if (failedCount != null && failedCount > 0) return 'partial';
  if (discovered != null && discovered === 0) return 'partial';
  if (okCount != null && okCount === 0 && discovered != null && discovered > 0) return 'partial';
  return 'fresh';
}

/**
 * Why a run that says `ok` is not being shown as healthy. Empty when there is no such
 * contradiction. Kept beside `deriveState` so the two cannot drift.
 */
export function countsContradictOk(run: PullRun | null): string | null {
  if (!run) return null;
  if (run.accounts_failed != null && run.accounts_failed > 0) return 'accounts were dropped';
  if (run.accounts_discovered === 0) return 'Meta returned no ad accounts at all, so nothing was pulled';
  if (run.accounts_ok === 0 && (run.accounts_discovered ?? 0) > 0) return 'no account returned any data';
  return null;
}

/** The sentence shown to the user. No em-dashes anywhere in here, deliberately. */
export function freshnessLine(f: AdFreshness): string {
  const ago = relativeTime(f.ageMs);
  switch (f.state) {
    case 'fresh':
      return `Ad spend updated ${ago}`;
    case 'partial': {
      const failed = f.latest?.accounts_failed ?? 0;
      const total = f.latest?.accounts_discovered ?? 0;
      if (failed > 0 && total > 0) {
        return `Partly updated ${ago}. ${failed} of ${total} accounts failed, so these totals are missing their spend.`;
      }
      // The run said `ok` and its own counts say otherwise. Name the contradiction rather
      // than printing "0 of 0 accounts failed", which is what the sentence above degrades
      // to when the pipeline discovered nothing.
      const why = countsContradictOk(f.latest) ?? countsContradictOk(f.lastSuccess);
      if (why) return `The last pull reported success ${ago} but ${why}. The spend below has not been refreshed.`;
      return `Partly updated ${ago}. Some accounts are missing their spend.`;
    }
    case 'failed':
      return f.lastSuccess
        ? `Last update failed. Showing ad spend from ${ago}.`
        : 'Last update failed and no earlier pull has ever succeeded.';
    case 'stale':
      return `Ad spend last updated ${ago}. Updates have stopped.`;
    case 'stuck':
      return `An update started ${relativeTime(f.latest ? Date.now() - Date.parse(f.latest.started_at) : null)} and never finished. Showing ad spend from ${ago}.`;
    case 'unknown':
    default:
      return 'Ad spend update time unknown';
  }
}

/**
 * The HEADER form of the same fact — and it MUST NAME ITS PIPELINE.
 *
 * ⓵ Length. The full sentence can run to 96 characters ("Partly updated 1.5 hours ago. 2
 * of 64 accounts failed, so these totals are missing their spend.") into a 56px bar, where
 * it was clipped by a hard `max-w-[420px]`. A message truncated mid-clause is a worse
 * signal than a short one. The dot carries severity; the full sentence is in the tooltip
 * and on Settings.
 *
 * 🔴 ⓶ AND THE BIGGER REASON — MEASURED 2026-08-12, NOT INFERRED.
 * This badge is mounted in `AppLayout`, so it sits above the Dashboard's numbers. It
 * describes `ad_pull_runs`, which is the Meta → Supabase `ad_insights` pipeline. At the
 * time of writing the Dashboard's numbers did not come from there — `useData` fetched the
 * Google Sheet — and the two feeds were NOT the same data:
 *
 *     Google Sheet (what the Dashboard rendered)  37,006 rows   $604,025.09
 *     ad_insights  (what this badge describes)    48,566 rows   $770,780.83
 *
 * $166,755.74 apart, over the identical date range. So the unqualified sentence "Ad spend
 * updated 1.5 hours ago" was a confident freshness claim about numbers it does not
 * measure — a health signal wired to the wrong pipeline.
 *
 * ⚠️ AMENDED 2026-08-11, IN THE SAME CHANGE THAT MOVED THE FEED — because a law left
 * standing after its premise dies instructs the next reader to re-break the thing. The
 * sentence above said "UNTIL the Dashboard reads `ad_insights`, the header says WHICH feed
 * it is talking about", which reads as licence to drop the qualifier now that it does.
 *
 * ⛔ THE QUALIFIER STAYS, AND THE REASON IS NOW A DIFFERENT ONE. The badge still describes
 * `ad_pull_runs` — the PULL — while the Dashboard reads `ad_insights` — the TABLE the pull
 * writes. Those are one pipeline but not one fact: a pull can fail, stall or half-succeed
 * while the table keeps serving every row it already holds, which is exactly the state
 * `partial` and `stuck` exist to name. Saying "Meta pull failed" instead of "ad spend
 * failed" is what keeps the badge describing the thing it actually measured. The Settings
 * section keeps the unqualified wording because that whole section is explicitly about the
 * Meta pull.
 */
export function freshnessShortLine(f: AdFreshness): string {
  const ago = relativeTime(f.ageMs);
  switch (f.state) {
    case 'fresh':   return `Meta ad spend pulled ${ago}`;
    case 'partial': return `Meta pull partly succeeded ${ago}`;
    case 'failed':  return f.lastSuccess ? `Meta pull failed. Last good ${ago}` : 'Every Meta pull has failed';
    case 'stale':   return `Meta pulls stopped. Last ${ago}`;
    case 'stuck':   return `A Meta pull never finished. Last ${ago}`;
    default:        return 'Meta pull time unknown';
  }
}

/** Dot colour. `fresh` is the only state that earns green. */
export function freshnessTone(state: FreshnessState): string {
  switch (state) {
    case 'fresh':   return 'bg-success';
    case 'partial': return 'bg-warning';
    case 'failed':
    case 'stale':
    case 'stuck':   return 'bg-destructive';
    default:        return 'bg-muted-foreground/50';
  }
}

export function freshnessTextTone(state: FreshnessState): string {
  switch (state) {
    case 'partial': return 'text-warning-strong';
    case 'failed':
    case 'stale':
    case 'stuck':   return 'text-destructive';
    default:        return 'text-muted-foreground';
  }
}

/** The tooltip. Carries the detail the one-liner cannot hold. */
export function freshnessDetail(f: AdFreshness): string {
  if (!f.lastSuccess?.finished_at) {
    return `Ad spend is pulled from Meta every ${PULL_INTERVAL_HOURS} hours. No successful pull has been recorded.`;
  }
  const when = new Date(f.lastSuccess.finished_at).toLocaleString();
  let s = `Last successful Meta pull finished ${when}. Pulls run every ${PULL_INTERVAL_HOURS} hours.`;
  const errs = parsePullErrors(f.latest?.error ?? null);
  if (errs.length > 0) {
    const named = errs.map(e => `${e.account ?? 'an account'}: ${e.error ?? 'unknown error'}`);
    s += ` ${named.join('; ')}`;
  }
  return s;
}

const RUN_FIELDS =
  'id, started_at, finished_at, status, accounts_ok, accounts_failed, accounts_discovered, rows_upserted, error';

/**
 * TWO queries, because they answer two questions with two different horizons:
 *
 *   runs (newest 5, unfiltered) = whether the pipeline is healthy RIGHT NOW
 *   lastSuccess (newest ok/partial, unbounded) = the age of what is on screen
 *
 * ⛔ DO NOT collapse this back into one filtered query. Filtering the WINDOW to ok/partial
 * hides an actively failing pipeline behind an old-but-valid success time, which is the
 * fail-open this whole module exists to refuse.
 *
 * 🔴 AND DO NOT COLLAPSE IT BACK INTO ONE UNFILTERED QUERY EITHER, which is what it was.
 * `lastSuccess` was scanned out of the same 5 rows, and 5 rows at a 3-hour cadence is a
 * ~15 hour horizon. In an outage longer than that — precisely the scenario @andrew's ask
 * ("see the last time the ad spend was updated") exists for — every row in the window is a
 * failure, `lastSuccess` goes null, and the sentence degrades to "Ad spend last updated
 * unknown. Updates have stopped." Not a lie, but unanswerable exactly when it matters most.
 * The success query carries no window, so the age is always available.
 *
 * `finished_at` and not `started_at` orders the success query: a success is dated by when
 * its data landed, and a long run that started earlier can finish later.
 */
export function useAdFreshness(): AdFreshness & { reload: () => void } {
  const [runs, setRuns] = useState<PullRun[]>([]);
  const [successRow, setSuccessRow] = useState<PullRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);
  // Re-render on a timer so the label actually advances. Without this it freezes at
  // whatever it said on mount, which is the exact bug the header comment documents.
  const [, tick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const [window5, success] = await Promise.all([
        sb.from('ad_pull_runs').select(RUN_FIELDS).order('started_at', { ascending: false }).limit(5),
        sb.from('ad_pull_runs').select(RUN_FIELDS)
          .in('status', ['ok', 'partial'])
          .not('finished_at', 'is', null)
          .order('finished_at', { ascending: false })
          .limit(1),
      ]);
      if (cancelled) return;
      // A failed read is NOT "no runs". It resolves to `unknown`, never to a number.
      if (window5.error) { setFailed(true); setRuns([]); }
      else { setFailed(false); setRuns((window5.data ?? []) as PullRun[]); }
      // The success query failing is NOT "nothing has ever succeeded" — leaving it null
      // would be that claim. Null here only ever means the fallback scan gets to answer.
      setSuccessRow(success.error ? null : ((success.data?.[0] ?? null) as PullRun | null));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [nonce]);

  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const latest = runs[0] ?? null;
  // The unbounded query wins; the window scan is the fallback for when that read failed.
  const lastSuccess =
    successRow ?? runs.find(r => (r.status === 'ok' || r.status === 'partial') && r.finished_at) ?? null;
  const now = Date.now();
  const successAt = lastSuccess?.finished_at ? Date.parse(lastSuccess.finished_at) : NaN;
  const ageMs = Number.isNaN(successAt) ? null : now - successAt;
  // ⚠️ Both branches of the old ternary here returned 'unknown'. Harmless, and it read as an
  // unfinished edit hiding an intended distinction. There is none: a query still in flight
  // and a query that failed are both "we have not been told", and neither may render a time.
  const state: FreshnessState = loading || failed
    ? 'unknown'
    : deriveState(latest, lastSuccess, now, runs);

  return {
    state, latest, lastSuccess, ageMs, runs, loading,
    reload: () => setNonce(n => n + 1),
  };
}
