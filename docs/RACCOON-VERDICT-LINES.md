# RACCOON — verdict lines, bounds, and one live blocker

Written to the tree because the coordination ring is **saturated at 200 signals** and has already
evicted @fable's own scope ruling. A bus post is dated and scrolls away; this file does not.
Every number below was measured, not recalled, and carries the command shape that produced it.

Head at time of writing: `stabilization @ 91790eb`.

---

## 🔴 LIVE BLOCKER — read before merging

**The branch name `stabilization` resolves to two different commits depending on where you type it,
and the stale one merges cleanly with exit 0.**

```
/Users/andrewleonard/Desktop/pixel-propel-ops   ← the worktree that OWNS the branch
   HEAD / local `stabilization` ............... 7fca10a     ← FIXED. This is the invariant.
   origin/stabilization ....................... moves with every ship
```

**Deliberately no commit count here.** It read "50", was 54 an hour later and 56 an hour after
that, and it climbs with every push — *a bare number in a file meant to outlive the session is the
narrated-count defect I raised against a colleague's docblocks, and I put one in my own file
within an hour of raising it.* **Regenerate it instead:**

```sh
git rev-list --count refs/heads/stabilization..origin/stabilization
```

The finding never depended on the count. It depends on `7fca10a` and on what that tree lacks —
both fixed properties of a fixed sha, verifiable at any later time:

Absent from `7fca10a`:

| path | at 7fca10a |
|---|---|
| `src/lib/honestNumbers.ts` | **MISSING** — the exclusion + defaulted-rate detectors, entirely |
| `scripts/gates.mjs` | **MISSING** — the whole gate ladder (`vite build` gate: **0** occurrences) |
| `dataService.ts`, `Dashboard.tsx`, `Agents.tsx`, `Targets.tsx`, `Banners.tsx`, `useData.tsx`, and more | differ |

*No count of differing files here either. It read "+15" and the true total is now 26 — it grows with
every ship, exactly like the commit count above it. **Second rotted number found in this file, and
found only because I enumerated all 54 numeric claims instead of grepping for the one shape I had
already caught.** An ad-hoc fix finds the instance; only a census finds the class. Regenerate:*

```sh
git diff --name-only 7fca10a origin/stabilization | wc -l
git show 7fca10a:scripts/gates.mjs        # → fatal: path does not exist. That is the finding.
```

*The `vite build`-gate comparison to "the head" was dropped for the same reason: `scripts/gates.mjs`
has been edited repeatedly tonight, so a number about **the head** rots while a number about
`7fca10a` cannot. **Only the pinned half was ever load-bearing.***

**Why it is silent:** `main` is an ancestor of `7fca10a`, so the merge is a clean fast-forward —
no conflict, exit 0. *"stabilization merged, fast-forward, no conflict"* would be a **true sentence
describing the shipping of a tree with no gate ladder and none of the detectors.** The reader
converts it to "the verified work is live."

**Every certification of this branch is against `fe172a3` / `44a7769` / `91790eb`** — Bird's 12 arms,
the four-gate ladder, the six-file bundle identity, 275/275. **None of it applies to `7fca10a`,
which nobody has driven since it was current.**

**Guard — immune by construction:**

```sh
git fetch origin && git merge --ff-only origin/stabilization
```

Merge the remote-tracking ref by name, never the bare local branch. `--ff-only` turns a surprise
into an error rather than a merge commit nobody tested. Print the merged sha and diff it against
the head you intend before using the word "merged".

**`main` is checked out in 0 of 8 worktrees**, so any `merge` route requires checking it out
somewhere first — re-introducing the staleness class. The route that touches no working tree at
all, dry-run verified (`fa43996..<head>  origin/stabilization -> main`):

```sh
git fetch origin && git push origin origin/stabilization:main
git fetch origin && git cat-file -e origin/main:scripts/gates.mjs && echo GATE_LADDER_PRESENT
```

### 🔴 The same directory carries a SECOND route to shipping the stale tree

`/Users/andrewleonard/Desktop/pixel-propel-ops` also holds `.vercel/project.json`
(→ project `pixel-propel-ops`), and `.vercel/` is **untracked and not gitignored**.

| from that directory | result |
|---|---|
| `git merge stabilization` | merges `7fca10a`, clean FF, exit 0 |
| a CLI production deploy | builds **that working tree** and ships it, **bypassing `main` entirely** |
| a broad stage-everything | commits `.vercel/` into the shared repo |

**The deploy route needs no merge at all**, so the merge guard above does not cover it. Every
certification of this branch is against `origin/stabilization`; a deploy from that directory never
touches it and prints success. This is @dash's law — *a local config file is a claim about the
world, not the world* — and it is the same shape as the merge blocker: **a local name resolving to
the wrong object, an operation that succeeds, and no error anyone would see.** Guard: name the
remote object (a deployment id, `origin/stabilization`), never the local alias or the directory.

*Its two "uncommitted changes" are `.vercel/` and a screenshot — **no code**. I cited "dirty=2"
twice as if it were work in progress without ever printing what it was; a count without its
predicate, inside my own blocker. Nobody loses anything by fast-forwarding that checkout.*

**Checked and NOT found here:** the rollback-pinned production target @dash confirmed on Relay
(a build goes Ready and never takes the alias). The rollback runbook commit `316539af` is in the
**`quo-dashboard`** repo, not this one, and this tree carries no runbook. **That is absence of
evidence in the tree, not proof of a clean alias** — only @bird can answer it, holding both the
drill history and the served-bytes instrument.

---

## Disclosed and NOT closed

1. **The setter-rate arm cannot fire tonight.** Its silence is *correct*, and that is locked in a
   test so a NO cannot be misread as a broken detector. Blocked on the same secret as appointments.
2. **Both client clobber guards fail OPEN on a transient read.** @apprentice's DB trigger cannot
   fail that way and **is not applied** ⇒ unmitigated in production.
3. **The banner is tested at the WRONG LAYER, not untested.** `HonestNumbersBanner.test.tsx` exists
   (9 refs, **7** renders — see below) and mounts no page; **0 of 3 page-mounting test files
   assert on the banner.**

   🔻 **CORRECTED — and this one was WRONG FROM BIRTH, not drifted.** I published "8 renders".
   It is **7**, and it was 7 at `fe172a3` where I first wrote it: the file is byte-identical
   (112 lines) at that sha and at the head, so the value never moved — **it was wrong the moment
   I typed it.** I had the grep output on screen and *counted the lines by eye* instead of piping
   them to `wc -l`. **@anvil then inherited "8" from my post, unmeasured, into his own verdict
   file, and caught it only by re-deriving at source.** *A drift check cannot see this class:
   nothing changed, because it was never anchored to anything.* Regenerate:

   ```sh
   git show HEAD:src/components/common/HonestNumbersBanner.test.tsx | grep -c 'render(<HonestNumbersBanner'
   ```
   Deleting all three mounts leaves the suite green. The fix is one assertion in
   `pages.windsorDead.test.tsx` — deliberately **not** written, because writing it would make
   @anvil's published "revert: 30 seconds" false. **Rule first, then write it, and only on KEEP.**
4. **`honestNumbers.test.ts:167`** uses `not.toMatch(/\d+ setters?/)` — a **literal space**. Line
   183 guards the same property with `\s+`. Measured: against `"3 setters"` the `:167` form
   does not match, so the assertion **passes for the wrong reason**. Fix = copy `:183` onto `:167`.

## Bounds on my own results

- **The routed-page census returns "none left" ON THE 8 PAGES ROUTED AT the head** — not in general.
  `Accounts.tsx` and `Campaigns.tsx` carry **zero** windsor guards and are one line in `App.tsx`
  from live. Three of the eight routed pages entered the population by exactly that one-line move.
  *An exhaustive census is exhaustive over the population it enumerated — and when the membership
  predicate lives in another file, the census has an expiry date it cannot see.*

  🔻 **CORRECTED.** This bullet previously read *"render money with zero windsor guards"*. The
  guard count is measured and stands; **the rendering consequence was never measured and the source
  contradicts it.** Both pages gate their entire table on `sorted.length === 0 ? <EmptyState/>`
  (`Accounts.tsx:149`, `Campaigns.tsx:72`), and every remaining formatter sits inside a
  per-account sub-component that an empty list never invokes. **With no accounts they render an
  empty state, not fabricated money** — the same structure @anvil retracted for `Targets`/
  `TeamPerformance` (`:113`/`:150` return null; all 13 TeamPerformance formatters inside
  `team.map`). *"The guard is absent" and "money gets fabricated" are two different claims, and
  only the first was ever established.* I measured a guard and asserted a render. **Measuring does
  not license explaining** — and four seats carried the fabrication consequence without one of us
  driving it, because each hop inherited it from the mechanism rather than from a screen.
- **No formatter count is quoted anywhere.** Two seats measured it and got 15 and 17 from unstated
  patterns. The zero-guards finding never depended on the count. *A count published without its
  predicate is not a measurement, it is a rumour with a decimal point.*
- **NBSP is the SAFEST member of its class.** `\s` matches `U+00A0` and the testing-library
  normalizer collapses it — two nets. `\s` does **not** match `—` U+2014 or `–` U+2013, and nothing
  else does either. Bundle counts: em-dash ×69, en-dash ×12, NBSP ×1. So "3 of 27 exposed" is exact
  for NBSP and a **lower bound** on the class. The dash family needs a lint, not a regex fix.

## Laws earned here

- **A poison must be REACHABLE, or the optimiser deletes your experiment and hands you a clean
  zero.** A dead `export const __PROBE__` was tree-shaken; the bundle moved 0 bytes and the probe
  could not have detected anything. Every planted-fault control in a minified pipeline has this
  failure mode, and it fails toward "no change detected" — the flattering direction.
- **A restoration check must compare against a source OUTSIDE the process that did the damage** —
  but the right question is about the **marker**, not the **file**. v1 asked "is the file what I
  read?" (missed leftover poison). v2 asked "is the file what git has?" (cried wolf on ordinary
  edits to the most-edited file on the branch). v3 asks "does the poison marker occur?" and
  dominates both. *The file's other contents are none of the control's business.*
- **An adjacent fix reads as a closure.** `gates.mjs` was patched in the same function minutes after
  a finding it did not address; a reader converts "it was edited" into "it was addressed."
- **A control's reputation is inherited from the incident it is credited with, and that credit is
  the one thing nobody re-measures.** A control here was credited with catching two real incidents,
  amplified to "the last line of defence for every sabotage arm," and provably could not have —
  it did not exist yet. Three seats, four passes, four distinct false propositions.

## Verified independently — and here is how to re-verify, not just what I found

⚠️ **This section previously read "Verified at `91790eb`" and nothing else.** By the time you are
reading it, that sha is many commits back — the result was never wrong, it was **UNVERIFIED SINCE**,
which is a quieter status than wrong and reads exactly like current. *A certification pinned to a
sha decays faster than it can be published; what makes an artefact check work is not its rigour but
that it is **cheap enough to re-run every time the target moves**.* So: the commands first.

```sh
# ① ordinary uncommitted work must NOT cry wolf     → expect GATES_EXIT=0
printf '\n// WIP\n' >> src/lib/dataService.ts && npm run gates; echo "EXIT=$?"
git checkout -- src/lib/dataService.ts

# ② a leftover poison marker must be CAUGHT         → expect GATES_EXIT=1, dataService 🔴 / main ✅
printf '\nconst __GATE_CONTROL_POISON: number = "x";\n' >> src/lib/dataService.ts
npm run gates; echo "EXIT=$?"; git checkout -- src/lib/dataService.ts

# ③ a leftover import poison must be CAUGHT         → expect GATES_EXIT=1, dataService ✅ / main 🔴
printf "import '@/__gate_control_missing_module__';\n%s" "$(cat src/main.tsx)" > /tmp/m && cp /tmp/m src/main.tsx
npm run gates; echo "EXIT=$?"; git checkout -- src/main.tsx

# ④ the branch must BUILD — no gate ran this until it was added
npm run build; echo "BUILD_EXIT=$?"; find dist -type f | wc -l   # expect 0 and 6
```

**Each cell must FAIL in the stated direction; ①-only-green proves nothing, because a control that
can never say 🔴 is the defect this whole file is about.** Last re-run by me 12 commits after the
original pin: ① `EXIT=0` · ② `EXIT=1` ds🔴 main✅ · ③ `EXIT=1` ds✅ main🔴 · ④ `BUILD_EXIT=0`,
6 files, bundle byte-identical. **Still holding — measured, not inherited.**

The original pinned readings, kept as the record of what was true at `91790eb`:

```
gate ladder v3 — all three cells, run by me, not taken on report
  ① ordinary uncommitted work in dataService.ts   GATES_EXIT=0   both ✅   work survived
  ② leftover __GATE_CONTROL_POISON marker         GATES_EXIT=1   ds 🔴 main ✅
  ③ leftover import poison in main.tsx            GATES_EXIT=1   ds ✅ main 🔴
  tree clean after each · discriminates per file in both directions
npm run build → BUILD_EXIT=0 · 2,827 modules · dist/assets/index-BJl69MGR.js 1,055,045 bytes
```
