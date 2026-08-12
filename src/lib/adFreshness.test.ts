import { describe, it, expect } from 'vitest';
import {
  deriveState, relativeTime, parsePullErrors, freshnessLine, freshnessShortLine, freshnessTone,
  STALE_AFTER_HOURS, PULL_INTERVAL_HOURS, type PullRun, type AdFreshness,
} from './adFreshness';

const NOW = Date.parse('2026-08-12T06:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

const run = (over: Partial<PullRun> = {}): PullRun => ({
  id: 1,
  started_at: minsAgo(35),
  finished_at: minsAgo(34),
  status: 'ok',
  accounts_ok: 64, accounts_failed: 0, accounts_discovered: 64, rows_upserted: 259,
  error: null,
  ...over,
});

const fresh = (over: Partial<AdFreshness> = {}): AdFreshness => ({
  state: 'fresh', latest: run(), lastSuccess: run(), loading: false,
  ageMs: 34 * 60_000, runs: [run()], ...over,
});

describe('the threshold is DERIVED from the cron interval, never a literal', () => {
  it('is two missed cycles — one is noise, two is a signal', () => {
    expect(STALE_AFTER_HOURS).toBe(PULL_INTERVAL_HOURS * 2);
  });
});

describe('deriveState — a signal that cannot fail is not a signal', () => {
  it('a recent successful run is FRESH', () => {
    expect(deriveState(run(), run(), NOW)).toBe('fresh');
  });

  it('🔴 STALE FIRES ON ELAPSED TIME, not on an error row', () => {
    // THE LOAD-BEARING STATE. A silently stopped cron produces NO error row at all, so
    // every other state depends on the pipeline being alive enough to report. If this were
    // keyed on a status the screen would say "updated 3 hours ago" forever.
    const old = run({ finished_at: hoursAgo(9), started_at: hoursAgo(9) });
    expect(deriveState(old, old, NOW)).toBe('stale');
  });

  it('stale outranks even a currently-successful-looking latest row', () => {
    const old = run({ finished_at: hoursAgo(30), started_at: hoursAgo(30), status: 'ok' });
    expect(deriveState(old, old, NOW)).toBe('stale');
  });

  it('🔴 PARTIAL OUTRANKS FRESH — a green dot over dropped accounts is a lie', () => {
    // Run 3 on the live table finished with two SPENDING accounts dropped on a Meta rate
    // limit, and the UI called it fresh. The totals were missing their spend and nothing
    // on screen said so.
    const partial = run({ status: 'partial', accounts_failed: 2 });
    expect(deriveState(partial, partial, NOW)).toBe('partial');
  });

  it('a failed latest run reports FAILED while still dating the data from the last SUCCESS', () => {
    const failed = run({ id: 2, status: 'failed', started_at: minsAgo(5), finished_at: minsAgo(4) });
    expect(deriveState(failed, run(), NOW)).toBe('failed');
  });

  it('🔴 A STUCK RUN IS NOT A SLOW ONE: `running` past one interval never reported back', () => {
    // finishRun is only reached inside the handler's try/catch. If the isolate is killed
    // (edge timeout, OOM, the 150s pg_net timeout) the row stays `running` with a null
    // finished_at FOREVER. Filtering to ok/partial correctly excludes it from the age, but
    // the UI must still NOTICE it rather than staying silent.
    const stuck = run({ id: 2, status: 'running', started_at: hoursAgo(3), finished_at: null });
    expect(deriveState(stuck, run(), NOW)).toBe('stuck');
  });

  it('a run that started moments ago and is still running is NOT stuck', () => {
    const running = run({ id: 2, status: 'running', started_at: minsAgo(2), finished_at: null });
    expect(deriveState(running, run(), NOW)).toBe('fresh');
  });

  it('🔴 NO ROWS IS "unknown", NEVER "just now"', () => {
    // Defaulting a missing timestamp to now() is the fail-open this whole module exists to
    // refuse: it would report a pipeline that has never run as perfectly healthy.
    expect(deriveState(null, null, NOW)).toBe('unknown');
  });

  it('🔑 ANTI-VACUITY: the healthy path really is reachable', () => {
    // Without this, every assertion above is satisfiable by returning a non-fresh state
    // unconditionally — which would put a permanent red dot on a working product.
    expect(deriveState(run(), run(), NOW)).toBe('fresh');
    expect(freshnessTone('fresh')).toBe('bg-success');
  });
});

describe('relativeTime — @andrew asked for "1.5 hours ago", so it says that', () => {
  it('gives one decimal under a day, with a trailing .0 stripped', () => {
    expect(relativeTime(90 * 60_000)).toBe('1.5 hours ago');
    expect(relativeTime(3 * 3_600_000)).toBe('3 hours ago');
    expect(relativeTime(11.5 * 3_600_000)).toBe('11.5 hours ago');
  });

  it('degrades sensibly at the ends', () => {
    expect(relativeTime(30_000)).toBe('just now');
    expect(relativeTime(60_000)).toBe('1 minute ago');
    expect(relativeTime(12 * 60_000)).toBe('12 minutes ago');
    expect(relativeTime(26 * 3_600_000)).toBe('1 day ago');
  });

  it('🔴 an UNKNOWN age is the word "unknown", and so is a NEGATIVE one', () => {
    // finished_at is the Deno clock while started_at is the DB clock. Skew is negligible,
    // but a negative age must read as unknown and never as "just now" — that is the
    // flattering direction, on the one element whose job is to report staleness.
    expect(relativeTime(null)).toBe('unknown');
    expect(relativeTime(-5000)).toBe('unknown');
  });

  it('🔴 NaN IS A REFUSAL, NOT A DURATION — it must never print as one', () => {
    // `null` and `< 0` were both guarded; NaN fails BOTH comparisons and walked straight to
    // the bottom of the ladder, emitting the literal string "NaN days ago". Unreachable via
    // `ageMs` (the hook maps NaN to null) but wide open to the two callers that do their own
    // arithmetic on `started_at` — the run list and the `stuck` sentence — either of which
    // can hold an unparseable timestamp.
    expect(relativeTime(Number.NaN)).toBe('unknown');
    expect(relativeTime(Date.now() - Date.parse('not a timestamp'))).toBe('unknown');
    expect(relativeTime(Number.POSITIVE_INFINITY)).toBe('unknown');
  });

  it('🔴 THE LABEL MAY NEVER CLAIM A NUMBER THE STATE HAS NOT CROSSED', () => {
    /**
     * `Math.round` to the nearest half hour made 5.9h print "6 hours ago" in GREEN, while
     * 6.0h — STALE_AFTER_HOURS — printed "6 hours ago" in RED. Same words, opposite colour,
     * on a badge that exists to be trusted at a glance. Flooring makes the printed age a
     * LOWER BOUND, so the text can only ever lag the state, never announce one early.
     */
    expect(relativeTime(5.9 * 3_600_000)).toBe('5.5 hours ago');
    expect(relativeTime(5.99 * 3_600_000)).toBe('5.5 hours ago');
    expect(relativeTime(6 * 3_600_000)).toBe('6 hours ago');
    // Anti-vacuity: the boundary the colour actually turns on, so the two sides of this
    // test are measured against the same clock rather than against each other.
    const at = (h: number) => run({ finished_at: hoursAgo(h), started_at: hoursAgo(h) });
    expect(deriveState(at(5.9), at(5.9), NOW)).toBe('fresh');
    expect(deriveState(at(6), at(6), NOW)).toBe('stale');
  });
});

describe('the copy', () => {
  it('names the failed account COUNT and says what it costs, rather than just flagging', () => {
    const line = freshnessLine(fresh({
      state: 'partial',
      latest: run({ status: 'partial', accounts_failed: 2, accounts_discovered: 64 }),
    }));
    expect(line).toMatch(/2 of 64 accounts failed/);
    expect(line).toMatch(/missing their spend/);
  });

  it('🔴 the time shown always describes the LAST SUCCESS, never the failed attempt', () => {
    // The number answers "how old is what I am looking at". Dating it from a failed run
    // would report the data as fresher than it is.
    const line = freshnessLine(fresh({ state: 'failed', ageMs: 4 * 3_600_000 }));
    expect(line).toMatch(/from 4 hours ago/);
  });

  it('⛔ NO EM-DASHES in any user-facing string — @andrew reads them as AI-generated', () => {
    for (const state of ['fresh', 'partial', 'failed', 'stale', 'unknown'] as const) {
      expect(freshnessLine(fresh({ state })), state).not.toMatch(/—/);
    }
  });
});

describe('parsePullErrors — ad_pull_runs.error is a JSON array as TEXT', () => {
  it('parses the real shape the edge function writes', () => {
    const raw = JSON.stringify([
      { account: 'act_477252292686194 (Pacific Outdoor Living)', error: 'Meta error 4: Application request limit reached', chunk: '2025-05-01..2025-05-31' },
    ]);
    const [e] = parsePullErrors(raw);
    expect(e.account).toMatch(/Pacific Outdoor Living/);
    expect(e.error).toMatch(/request limit/);
  });

  it('never throws on a non-JSON or absent value — a parse failure must not blank the page', () => {
    expect(parsePullErrors(null)).toEqual([]);
    expect(parsePullErrors('boom')).toEqual([{ error: 'boom' }]);
  });
});

/**
 * 🔴 THE FAIL-OPEN THE FIRST VERSION SHIPPED WITH.
 *
 * `deriveState` read only `latest.status` and never looked at the counts sitting on the
 * same row. `meta-pull` builds its account list with `(body.data as AccountRef[]) ?? []`,
 * so when Meta answers HTTP 200 with `{"data":[]}` — what a System User gets when its
 * asset assignments or `ads_management` scope are pulled — discovery yields `[]`, the
 * worker pool is `Math.min(6, 0)` = zero workers, `failures` stays empty, and the writer
 * computes `failures.length === 0 ? 'ok' : 'partial'` → **ok**.
 *
 * The row lands `ok / 0 discovered / 0 ok / 0 failed / 0 rows` and the badge said GREEN,
 * every three hours, over a pipeline moving none of $770k.
 */
describe('the status word does not outrank the counts it summarises', () => {
  it('🔴 ok + 0 accounts DISCOVERED is not fresh — Meta returned nothing at all', () => {
    const empty = run({ accounts_discovered: 0, accounts_ok: 0, accounts_failed: 0, rows_upserted: 0 });
    expect(deriveState(empty, empty, NOW)).toBe('partial');
  });

  it('🔴 ok + accounts_failed > 0 is not fresh, whatever the status string says', () => {
    // The writer cannot emit this shape TODAY. That is a coincidence, one edit away from
    // ending, and a reader that depends on it is a stale law waiting to happen.
    const lying = run({ status: 'ok', accounts_failed: 2 });
    expect(deriveState(lying, lying, NOW)).toBe('partial');
  });

  it('ok + accounts discovered but none succeeded is not fresh', () => {
    const none = run({ accounts_discovered: 64, accounts_ok: 0, rows_upserted: 0 });
    expect(deriveState(none, none, NOW)).toBe('partial');
  });

  it('⭐ A NULL COUNT IS NOT A ZERO. An unread column must not become "discovered nothing"', () => {
    // The refusal-becomes-a-value shape again, one level up: `?? 0` here would turn "this
    // row predates the column" into a confident claim that the pull found no accounts.
    const older = run({ accounts_discovered: null, accounts_ok: null, accounts_failed: null });
    expect(deriveState(older, older, NOW)).toBe('fresh');
  });

  it('CONTROL: a genuinely healthy run is still fresh, so the arms above discriminate', () => {
    expect(deriveState(run(), run(), NOW)).toBe('fresh');
  });

  it('the sentence names the contradiction instead of printing "0 of 0 accounts failed"', () => {
    const empty = run({ accounts_discovered: 0, accounts_ok: 0, accounts_failed: 0, rows_upserted: 0 });
    const line = freshnessLine(fresh({ state: 'partial', latest: empty, lastSuccess: empty }));
    expect(line).toMatch(/no ad accounts at all/);
    expect(line).not.toMatch(/0 of 0/);
  });

  it('freshnessShortLine fits a header and never contradicts the dot', () => {
    for (const state of ['fresh', 'partial', 'failed', 'stale', 'stuck', 'unknown'] as const) {
      const s = freshnessShortLine(fresh({ state }));
      expect(s.length, `${state}: ${s}`).toBeLessThanOrEqual(56);
      expect(s, state).not.toMatch(/—/);
    }
    // The short form must not describe a broken pipeline with the healthy sentence.
    expect(freshnessShortLine(fresh({ state: 'stale' }))).not.toMatch(/^Meta ad spend pulled/);
  });

  /**
   * 🔴 MEASURED 2026-08-12: the header badge sits above numbers it does not describe.
   *   Google Sheet (Dashboard's actual feed)  37,006 rows  $604,025.09
   *   ad_insights  (what this module reads)   48,566 rows  $770,780.83
   * Same date range, $166,755.74 apart. So the header form has to name its pipeline; only
   * the Settings section, which is explicitly about the Meta pull, may speak unqualified.
   */
  it('⛔ the HEADER form names the pipeline it measures, because it is not the one on screen', () => {
    for (const state of ['fresh', 'partial', 'failed', 'stale', 'stuck', 'unknown'] as const) {
      expect(freshnessShortLine(fresh({ state })), state).toMatch(/Meta/);
    }
    // And it must never make the unqualified claim the Settings section is allowed to make.
    expect(freshnessShortLine(fresh({ state: 'fresh' }))).not.toBe(freshnessLine(fresh({ state: 'fresh' })));
  });
});

/**
 * 🔴 AN IN-FLIGHT RUN LAUNDERED THE FAILURE UNDERNEATH IT.
 *
 * `deriveState` inspected `runs[0]` alone. With a `running` row on top (younger than
 * STUCK_AFTER_MINUTES, so not yet `stuck`), a `failed` row beneath it, and a success under
 * six hours old, nothing matched a failure branch and control fell through to the COUNTS of
 * the run that succeeded. The badge went green over a pipeline whose most recent COMPLETED
 * attempt errored. The age stayed truthful; only the dot lied, which is worse, because the
 * dot is the part anyone reads.
 */
describe('🔴 a run still in flight must not hide the failure it sits on top of', () => {
  const running = run({ id: 3, status: 'running', started_at: minsAgo(2), finished_at: null });
  const failed = run({ id: 2, status: 'failed', started_at: hoursAgo(3), finished_at: hoursAgo(3), error: 'boom' });
  const success = run({ id: 1, status: 'ok', started_at: hoursAgo(5), finished_at: hoursAgo(5) });

  it('is NOT fresh, and is not green', () => {
    const state = deriveState(running, success, NOW, [running, failed, success]);
    expect(state).not.toBe('fresh');
    expect(state).toBe('failed');
    expect(freshnessTone(state)).toBe('bg-destructive');
  });

  it('🔑 ANTI-VACUITY: the same window WITHOUT the failed row is still green', () => {
    // Without this, the arm above passes if `running` on top simply disabled `fresh`.
    expect(deriveState(running, success, NOW, [running, success])).toBe('fresh');
  });

  it('a failure OLDER than the last success does not condemn a newer success', () => {
    const oldFail = run({ id: 0, status: 'failed', started_at: hoursAgo(9), finished_at: hoursAgo(9) });
    const newOk = run({ id: 4, status: 'ok', started_at: minsAgo(20), finished_at: minsAgo(19) });
    expect(deriveState(newOk, newOk, NOW, [newOk, oldFail])).toBe('fresh');
  });

  it('an unfinished failed row is not counted — it has no time to compare', () => {
    const halfFail = run({ id: 5, status: 'failed', started_at: minsAgo(3), finished_at: null });
    expect(deriveState(running, success, NOW, [running, halfFail, success])).toBe('fresh');
  });

  it('the old three-argument call still means what it meant', () => {
    // The `runs` parameter defaults to empty, so every pre-existing caller and every arm
    // above this block keeps its exact behaviour.
    expect(deriveState(run(), run(), NOW)).toBe('fresh');
  });
});

/**
 * 🔴 A LONG OUTAGE COULD NOT STATE ITS OWN AGE.
 *
 * `lastSuccess` was scanned out of the same five-row window as `latest`. Five rows at a
 * three-hour cadence is a ~15 hour horizon, so in any outage longer than that — precisely
 * the scenario @andrew's ask exists for — every row in the window is a failure, the age
 * goes null, and the sentence degrades to "Ad spend last updated unknown". Not a lie, but
 * unanswerable exactly when it matters most. `useAdFreshness` now runs a second, UNWINDOWED
 * query for the newest ok/partial run, so the age survives any length of outage.
 */
describe('🔴 the age of the data survives an outage longer than the run window', () => {
  const failures = [1, 2, 3, 4, 5].map(i =>
    run({ id: 10 + i, status: 'failed', started_at: hoursAgo(i * 3), finished_at: hoursAgo(i * 3) }));
  const ancientSuccess = run({ id: 1, status: 'ok', started_at: hoursAgo(72), finished_at: hoursAgo(72) });

  it('with the success found OUTSIDE the window, the sentence carries a real age', () => {
    const f = fresh({
      state: deriveState(failures[0], ancientSuccess, NOW, failures),
      latest: failures[0], lastSuccess: ancientSuccess, runs: failures,
      ageMs: NOW - Date.parse(ancientSuccess.finished_at!),
    });
    expect(f.state).toBe('stale');
    expect(freshnessLine(f)).toBe('Ad spend last updated 3 days ago. Updates have stopped.');
    expect(freshnessShortLine(f)).toBe('Meta pulls stopped. Last 3 days ago');
  });

  it('🔑 and the OLD behaviour is what this replaces: no success in window means "unknown"', () => {
    // The window scan alone cannot see past its five rows. This arm pins what that costs,
    // so a future edit that drops the second query fails here instead of shipping.
    const scanned = failures.find(r => (r.status === 'ok' || r.status === 'partial') && r.finished_at) ?? null;
    expect(scanned).toBeNull();
    const f = fresh({ state: 'stale', latest: failures[0], lastSuccess: null, runs: failures, ageMs: null });
    expect(freshnessLine(f)).toContain('unknown');
  });
});

describe('🔴 the STATUS WORD carries a state the counts cannot express', () => {
  /**
   * Measured 2026-08-12 by mutation: deleting
   *     if (latest?.status === 'partial') return 'partial';
   * left all 694 tests green. Every existing `partial` arm reaches the verdict through the
   * count-derived checks further down instead, because each one gives the SAME row to both
   * `latest` and `lastSuccess`, and that row carries `accounts_failed: 2`.
   *
   * ⭐ THE TWO ARE NOT THE SAME ROW WHEN A RUN IS IN FLIGHT, and that is the shape the
   * status branch exists for. `useAdFreshness` finds `lastSuccess` with
   * `.not('finished_at','is',null)`, so a partial run that has not written its finish time
   * is EXCLUDED from that query — `lastSuccess` falls back to the previous clean success,
   * whose counts are perfect. Read the counts alone and the badge goes GREEN over a pull
   * that is, right now, dropping accounts.
   */
  const unfinishedPartial = run({
    id: 99, status: 'partial', started_at: minsAgo(4), finished_at: null,
    accounts_failed: 3, accounts_ok: 61, accounts_discovered: 64,
  });
  const cleanEarlierSuccess = run({ id: 98, status: 'ok', started_at: hoursAgo(3), finished_at: hoursAgo(3) });

  it('an in-flight PARTIAL is partial, even though the last SUCCESS has flawless counts', () => {
    const state = deriveState(unfinishedPartial, cleanEarlierSuccess, NOW, [unfinishedPartial, cleanEarlierSuccess]);
    expect(state).toBe('partial');
  });

  it('⭐ CONTROL: the same shape with an OK latest is fresh, so the arm above discriminates', () => {
    // Without this, "always return partial" would satisfy the assertion above.
    const running = run({ id: 99, status: 'ok', started_at: minsAgo(4), finished_at: minsAgo(3) });
    expect(deriveState(running, cleanEarlierSuccess, NOW, [running, cleanEarlierSuccess])).toBe('fresh');
  });

  it('and the counts of the SUCCESS row are genuinely clean — the control is not accidental', () => {
    // Pins the premise: if this row ever gained a non-zero accounts_failed, the first arm
    // would pass through the count branch instead and stop testing the status branch.
    expect(cleanEarlierSuccess.accounts_failed).toBe(0);
    expect(cleanEarlierSuccess.accounts_discovered).toBe(64);
    expect(cleanEarlierSuccess.accounts_ok).toBe(64);
  });
});
