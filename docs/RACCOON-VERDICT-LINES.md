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
   HEAD / local `stabilization` ............... 7fca10a
   origin/stabilization ....................... 91790eb
   behind by .................................. 50 commits
```

Absent from `7fca10a`:

| path | at 7fca10a |
|---|---|
| `src/lib/honestNumbers.ts` | **MISSING** — the exclusion + defaulted-rate detectors, entirely |
| `scripts/gates.mjs` | **MISSING** — the whole gate ladder (`vite build` gate: 0 occurrences vs 2 at head) |
| `dataService.ts`, `Dashboard.tsx`, `Agents.tsx`, `Targets.tsx`, `Banners.tsx`, `useData.tsx`, +15 | differ |

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

---

## Disclosed and NOT closed

1. **The setter-rate arm cannot fire tonight.** Its silence is *correct*, and that is locked in a
   test so a NO cannot be misread as a broken detector. Blocked on the same secret as appointments.
2. **Both client clobber guards fail OPEN on a transient read.** @apprentice's DB trigger cannot
   fail that way and **is not applied** ⇒ unmitigated in production.
3. **The banner is tested at the WRONG LAYER, not untested.** `HonestNumbersBanner.test.tsx` exists
   (9 refs, 8 renders) and mounts no page; **0 of 3 page-mounting test files assert on the banner.**
   Deleting all three mounts leaves the suite green. The fix is one assertion in
   `pages.windsorDead.test.tsx` — deliberately **not** written, because writing it would make
   @anvil's published "revert: 30 seconds" false. **Rule first, then write it, and only on KEEP.**
4. **`honestNumbers.test.ts:167`** uses `not.toMatch(/\d+ setters?/)` — a **literal space**. Line
   183 guards the same property with `\s+`. Measured: against `"3 setters"` the `:167` form
   does not match, so the assertion **passes for the wrong reason**. Fix = copy `:183` onto `:167`.

## Bounds on my own results

- **The routed-page census returns "none left" ON THE 8 PAGES ROUTED AT the head** — not in general.
  `Accounts.tsx` and `Campaigns.tsx` render money with **zero** windsor guards and are one line in
  `App.tsx` from live. Three of the eight routed pages entered the population by exactly that
  one-line move. *An exhaustive census is exhaustive over the population it enumerated — and when
  the membership predicate lives in another file, the census has an expiry date it cannot see.*
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

## Verified at `91790eb`, independently

```
gate ladder v3 — all three cells, run by me, not taken on report
  ① ordinary uncommitted work in dataService.ts   GATES_EXIT=0   both ✅   work survived
  ② leftover __GATE_CONTROL_POISON marker         GATES_EXIT=1   ds 🔴 main ✅
  ③ leftover import poison in main.tsx            GATES_EXIT=1   ds ✅ main 🔴
  tree clean after each · discriminates per file in both directions
npm run build → BUILD_EXIT=0 · 2,827 modules · dist/assets/index-BJl69MGR.js 1,055,045 bytes
```
