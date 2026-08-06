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
serves. Main is an **ancestor** of the head, so a fast-forward is possible: no divergence,
no conflict. Unmerged is a decision, not an obstacle.

⚠️ **The size of that gap is NOT quoted here, because it drifts with every push.** An
earlier version of this line said *82 commits / 67 files / +8,513 −303*; measured again
later it was *97 / 69 / +8,946*. Three of the four numbers had rotted while the sentence
still read as current. **Regenerate it instead:**

```
git rev-list --count origin/main..origin/stabilization
git diff --shortstat origin/main..origin/stabilization
```

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
   - PROVEN AT THE COMPONENT LAYER: its own test file renders it directly.
     (`grep -c '<HonestNumbersBanner' src/components/common/HonestNumbersBanner.test.tsx`)
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
   `Accounts.tsx` and `Campaigns.tsx` carry **zero windsor guards** — measured, with a
   control. ⚠️ CORRECTED: an earlier version of this line said they *render money*. That
   was never measured and the source contradicts it — both gate the whole table behind
   `sorted.length === 0 ? <EmptyState/>`, and every remaining formatter sits in a
   per-account sub-component an empty list never invokes. Same structure as `Targets`
   and `TeamPerformance`. I measured a GUARD and asserted a RENDER. Routing
   either is a single line in `App.tsx` and re-opens the axis without touching the page.
   Closing shape, if ever needed: one test reading `App.tsx` asserting every routed page
   names windsor — so the **route** fails, not the page.

   ⚡ **RE-RUN IT RATHER THAN TRUSTING THE SHA.** @raccoon's formulation, earned on
   @bird's comparator: *a certification pinned to a SHA decays faster than it can be
   published; one pinned to an ARTEFACT does not — and what makes that work is not rigour,
   it is being CHEAP ENOUGH TO RE-RUN every time the target moves.* So:

   ```
   git diff --name-only <certified-sha>..HEAD -- src/App.tsx     # empty ⇒ population unmoved
   git diff --name-status <certified-sha>..HEAD -- src/pages/ | grep -E '^[AD]'
   grep -c 'sources.windsor' src/pages/{Dashboard,Targets,TeamPerformance,Agents}.tsx
   grep -c 'sources.windsor' src/pages/Settings.tsx    # CONTROL: expect 0
   ```

   Re-run at `1444a95`: App.tsx unchanged since `fe172a3`, no page added or removed,
   guards 1·2·2·2, control 0. **The census still holds — measured, not inherited.**

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

## 🔴 THE MERGE — see also `docs/RACCOON-VERDICT-LINES.md`

The local branch `stabilization` (owned by the Desktop worktree) is stale at **`7fca10a`**
and has no `scripts/gates.mjs` and no `src/lib/honestNumbers.ts`. The *distance* is not
quoted — it grew 49 → 50 → 51 → 59 across the night; the **sha** is the stable fact and
`git rev-list --count stabilization..origin/stabilization` regenerates the rest. Merging the
**bare name** fast-forwards **cleanly, exit 0**, and ships that tree. Git reports nothing
wrong because nothing is wrong by git's definition.

```
❌  git merge stabilization
✅  git fetch origin && git merge --ff-only origin/stabilization
    then: git cat-file -e HEAD:scripts/gates.mjs   ← absent ⇒ you merged the wrong tree
```

**Root cause is mine:** I pushed `HEAD:stabilization` ~40 times, which moves the remote ref
and never `refs/heads/stabilization`. Every "head == remote" I published was true *of my
worktree*; I verified the refs I was moving and never enumerated the one I was not.

## 🔻 RETRACTED: "Targets and Media Buying fabricated every number"

`bfdfe75`'s commit message says that. **It is not established, and the source contradicts
it.** At `7fca10a`, with Windsor dead:

```
Targets.tsx :113  if (filteredAccounts.length === 0) return null;
            :150  if (!stats) return null;        ⇒ renders NOTHING
TeamPerformance   all 13 formatter sites are INSIDE team.map(…)
                  empty team ⇒ zero iterations ⇒ zero money rendered
@bird drove it:   /targets 0 money tokens · /team 0 money tokens
```

Neither page **can** fabricate money in that state. My tests only ever asserted absence
*after* the fix; my sabotage arms proved the **gate** works, never that the **defect**
existed. ⇒ **Those two fixes are PREVENTIVE, not corrective.** They name the dead source
instead of rendering an empty page — a real improvement on an honest-states branch, and
not the repair the commit message claims.

⭐ Four seats carried "these pages fabricate money" without one of us driving it. The
consequence was inherited from the mechanism at every hop.

## ⚠️ A NOTE ON EVERY NUMBER IN THIS FILE

@raccoon raised drifting counts as a defect at me, then found one in his own durable file
and removed it. I audited mine on the same trigger: **42 numeric claims, of which two had
already rotted** — the head-vs-main size and the staleness distance.

**The rule this file now follows:** a number stays only if it is a property of a **pinned
sha** (line numbers at `7fca10a`, `207` lines of Deno) or of a **fixed measurement someone
else owns and attributed** (@bird's 11-of-15 posts, the 200-signal ring). Anything that
moves with a push carries **the command that regenerates it** instead of the value.

⭐ A count in a durable file reads as current forever — which is exactly why the durable
file is the worst place for one that drifts, and the best place for the command that
recomputes it.

## ⚠️ AND A SECOND FAILURE MODE MY OWN DRIFT AUDIT MISSED

@bird ran my audit on his files, fixed three real drifters, and reported that his
*classifier* was the worse instrument — 44 flagged, 41 false positives, because **nothing
lexical separates a number that ASSERTS A CURRENT STATE from one that NAMES A PAST
EVENT.** He had to read all 44 by hand.

Re-reading mine with that distinction found something my audit was not looking for:

```
"its own test file renders it 8 times"
   at fe172a3 — THE COMMIT WHERE I WROTE IT — the count was already 7.
   ⇒ NOT DRIFT. WRONG FROM BIRTH. I took "8 renders" from @raccoon's post and
     put it in a durable file without measuring it once.
"a control of 18 mentions"   ⇒ now 19. Ordinary drift.
```

⇒ **My audit tested whether numbers had CHANGED. It never tested whether they were RIGHT
WHEN WRITTEN.** Drift is one failure mode; **inheriting a peer's number unmeasured is
another, and no drift check can see it** — the value never moves, because it was never
anchored to anything in the first place.

⭐ This is the third time tonight I inherited a figure from another seat's post: his 23
formatters became my 25, his 8 renders became my 8, and both entered a verdict file. **A
number in a colleague's post arrives with their credibility attached and none of their
measurement.** Both are now commands.

## The frame that matters more than any single fix

Eight surfaces were found tonight — predicate, badge, row, panel, tile, Targets, Media
Buying, Agents — **by four seats, each on a surface the previous one could not see.**
That is a rate, not a completion.

⚠️ **DO NOT QUOTE A "DEMONSTRATED" COUNT. I published "six demonstrated, two preventive"
and I cannot support the six.** @raccoon measured what the suite can supply: **no test
asserts the defect state on any of the eight.** The only two positive `$0.00` assertions
both assert *correct* behaviour — an honest zero from a live source that must not be
suppressed — with a control proving the probe is not blind
(`grep -rho '\$0\.00' src --include='*.test.ts*' | wc -l`).

**"Demonstrated" is a property of a DRIVE, and only @bird holds that evidence.** The two
that fell out of the count fell out because he built `7fca10a` and looked. The correct
buckets are three, not two:

```
DEMONSTRATED    a pre-fix drive exists          ⇐ @bird's record, not mine to assert
PREVENTIVE      the source cannot produce it    ⇐ Targets · Media Buying · Accounts · Campaigns
NOT-STAGEABLE   no rig can reach the state      ⇐ appointments known-and-empty:
                                                   fetchAirtableData throws unconditionally,
                                                   so a browser can never produce it.
                                                   The test is the ONLY instrument that
                                                   reaches it — an honest limit, not a gap.
```

Filed as "preventive" the third bucket reads speculative; filed as "demonstrated" it is
unsupported. It is neither. **The classification belongs to the seat with the drive
record; I should not have assigned it from this one.**

Seven broken probes were caught. **None by diligence** — every one by a control whose
answer was predictable in advance, or by a contradiction with something already known.

`npm run gates` mechanises four of the five ways a check lies, and **prints what it cannot
do on success**, because green is when a reader stops looking. The fifth — DIMENSION, a
true answer to a question that cannot express the defect — needs a second instrument and
no control can reach it.
