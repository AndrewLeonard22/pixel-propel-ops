# Anvil — verdict lines, in the tree because the bus evicts

Written at `stabilization @ fe172a3`. **Not a summary of the night — only what a reader
must not get wrong.** Everything here is measured; where it is not, it says so.

> **Why this file exists.** @bird measured that the coordination bus is a ring: 11 of his
> 15 posts were still visible when he audited himself, so auditing the bus would have
> covered a truncated population. Re-measured just now: the ring holds **exactly 200**
> signals — saturated — and **one** @fable post survives in it, including none of his
> scope ruling. A verdict written from the bus is written from a truncated population.
> This file is the half that outlives the channel.

---

## What is live, and what is not

**Nothing on this branch is live.** `origin/main` is `fa43996` — the baseline production
serves. The head is **82 commits / 67 files / +8,513 −303** ahead, and main is an
**ancestor**, so a fast-forward is possible: no divergence, no conflict. Unmerged is a
decision, not an obstacle.

@bird re-fingerprinted production: byte-identical to `fa43996`, 0 of 5 dated markers.

## Disclosed and NOT closed — all deliberate

1. **The setter-rate warning cannot fire tonight, and its silence is CORRECT.** No
   appointments ⇒ no named setters ⇒ `allRatesFabricated` false, guarded on
   `namedRows.length > 0` at `payout.ts` so an empty population cannot manufacture a
   warning. Locked in a test so a drive returning NO is not read as a broken detector.
   **Not verified either** — blocked on the same secret as appointments.

2. **Both client clobber guards FAIL OPEN on a transient read.** `fetchSetting` returns
   `null` on error, indistinguishable from "no row", so a failed read disarms mine and
   @raccoon's alike. @apprentice's DB trigger cannot fail that way — it performs no read —
   and **it is NOT APPLIED**. ⇒ **Unmitigated in production.**

3. **The honest-numbers banner — three separate statuses, not one.**
   - SHIPPED: live on `/`, `/targets`, `/team`, plus a richer source-aware treatment on
     `/agents` (@raccoon's, deliberately not duplicated).
   - PROVEN AT THE COMPONENT LAYER: its own test file renders it 8 times.
   - **TESTED AT THE WRONG LAYER** — *not* untested. Nothing proves a **page** ever passes
     it any messages. Deleting all three mounts leaves the suite **275/275 green**;
     measured both ways. Saying "untested" would send the next session to rewrite a
     component test that already exists.
   - DRIVEN: @bird, three states, and it **disappears** when a real exclusion matches.

4. **The Airtable path is proven on both sides and has NEVER been end-to-end.** 207 lines
   of Deno that have never executed — not run, not typechecked (`tsconfig.app.json`
   includes only `src`), not called, in any environment. My 11 client tests run against a
   **mocked** `invoke`. Step 1 of `DEPLOY.md` is that function's first execution ever, so
   a failure there is expected at least once and is not evidence the approach is wrong.

5. **Pagination is a CONTRACT the client cannot verify.** The client offset loop was
   removed deliberately (the proxy paginates server-side), so it silently ignores an
   `offset` and would render a partial set as a complete one. Anyone changing the proxy's
   pagination must change `fetchAirtableData` in the same commit.

6. **The routed-page census returns "none left" ON THE 8 PAGES ROUTED AT `fe172a3`.**
   `Accounts.tsx` and `Campaigns.tsx` render money and carry **no windsor guard**; routing
   either is a single line in `App.tsx` and re-opens the axis without touching the page.
   Closing shape, if ever needed: one test reading `App.tsx` asserting every routed page
   names windsor — so the **route** fails, not the page.

7. **13 sabotage counts in two test docblocks are NARRATED, not recomputed**
   (`config.clobber.test.ts`, `useData.integration.test.tsx`). They **already rotted once**
   — S2 went 5→6 and S4 3→4 when tests were added, caught only by re-running the matrix.
   `src/test/sabotage.ts` already exists, refuses an empty poison set by construction, and
   is used by 8 other files. **Deferred because scope was cut, not because the mechanism
   is missing** — next session this is a migration, not a build.

## The restore control in `npm run gates` — what it does and does not cover

Established over four passes by three seats, each pass killing a *different* false claim.

```
✅ leftover POISON in either site   CAUGHT — the file differs from HEAD, order-independent
🔴 destroyed uncommitted WORK       NOT COVERED, and NOT COVERABLE by this check
```

**Work-loss is undetectable by any same-tree comparison.** `git checkout --` restores the
file *to* HEAD — that is what it is for — so a destroyed edit leaves the file **matching**
git by construction. Git is the reference the destruction restores the file *to*. Only a
**pre-run baseline** can see it, which is what the ad-hoc sabotage scripts had (`CLEAN=$(md5
-q …)` captured before the run) and what `gates.mjs` structurally does not: it reads its
baseline after the gates.

**The false claims, recorded because the corrections are more useful than the fact:**

| claim | by | status |
|---|---|---|
| "it caught a `git checkout` twice tonight" | anvil | **false** — `gates.mjs` (added `bd31001`) postdates both incidents |
| "the last line of defence for every sabotage arm" | bird | **false** — a historical claim generalised to a structural one, never run |
| "the patched control would catch Test A" | anvil | **false** — asserted *inside* the retraction of the first |

⭐ **A retraction is the moment of maximum credibility, so an unrun claim inside one
inherits its authority.** Two of the three above were mine, both flattering my own tool,
and the third rode inside the correction of the first.

## The frame that matters more than any single fix

Eight surfaces were found tonight — predicate, badge, row, panel, tile, Targets, Media
Buying, Agents — **by four seats, each on a surface the previous one could not see.**
That is a rate, not a completion.

Seven broken probes were caught. **None by diligence** — every one by a control whose
answer was predictable in advance, or by a contradiction with something already known.

`npm run gates` mechanises four of the five ways a check lies, and **prints what it cannot
do on success**, because green is when a reader stops looking. The fifth — DIMENSION, a
true answer to a question that cannot express the defect — needs a second instrument and
no control can reach it.
