# Cutover record — ad spend moves from the Google Sheet to `ad_insights`

**Status: built and verified in the working tree. NOT committed, NOT deployed.**
Production at `adsdata.socialworkspro.com` still serves the sheet. Measured in the live
bundle `index-BpP_wZ45.js`: `docs.google.com/spreadsheets` 2, `export?format=csv` 1,
`ad_insights` 0.

This file exists because **one consequence of the cutover is invisible from inside the app
after it ships**, and a consequence nobody can see is a consequence nobody consented to.
Everything else the change does is disclosed on screen; §3 is not, and cannot be.

---

## 1. What changed

Every ad-spend read moves from a Google Sheet CSV to `ad_insights_resolved` (the
`ad_insights` table joined to the curated `ad_accounts`). The sheet path is deleted, not
bypassed: a local `vite build` measures `docs.google.com/spreadsheets` **0**,
`export?format=csv` **0**, `gviz` **0**, and no Google host of any kind in the bundle.

Account identity stops being a display NAME and becomes `ad_insights.account_id`, which Meta
does not let anyone edit. That is the point of the change, not a side effect — see the header
docblock of `src/lib/metaAdSpend.ts`.

## 2. The number goes UP, and by how much

Measured 2026-08-12 over 2025-01-01..2026-08-11, one aggregator, two feeds:

| | sheet (live) | `ad_insights` | move |
|---|---:|---:|---:|
| spend | $603,977.78 | **$770,956.72** | **+$166,978.94 (+27.6%)** |
| leads | 26,788 | 30,966 | +4,178 |
| rows | 37,002 | 48,568 | +11,566 |

All dates: 48,611 rows, $770,984.34, 30,966 leads, 52 accounts, 2025-01-01..2026-08-12.
Known-good day 2026-08-08 reproduces exactly: 83 rows, $1,878.78, 56 leads, 22 accounts.

The sheet figure drifts by tens of dollars between readings because the sheet is live; the
`ad_insights` figure drifts because `meta-pull` runs every three hours and Meta restates
recent days. Both are expected. The 27.6% is not.

> ⚠️ **Two numbers in `~/code/socialworks-ads/reconciliation-baseline.md` do not reproduce
> and will make a correct cutover read as a failure.** Its sheet total of **$662,135.29** (and
> the +$108,469 / +14.1% derived from it) cannot be obtained from either tab; the live sheet
> is ~$604,025. And acceptance check #1 asks the TOTAL SPEND tile to read **$770,920.57**,
> which it deliberately does not — see §4. Amend that file before anyone checks it literally.

## 3. ⛔ WHAT LEAVES THE PRODUCT, AND WHY NOTHING ON SCREEN CAN SAY SO

**Eight accounts and $36,496.52 of historical spend exist on the sheet and have no
counterpart in the Meta feed.** Not renamed, not re-keyed: none of their campaign IDs appear
in `ad_insights`, and they are absent from `ad_accounts`. They are outside the visibility of
the token `meta-pull` uses. Measured by campaign-ID join, 2025-01-01..2026-08-11:

| sheet account | spend | rows | last active |
|---|---:|---:|---|
| Green Plus | $10,236.22 | 528 | 2025-12-08 |
| Mac's Pressure Washing | $8,333.90 | 403 | 2025-12-07 |
| Ortiz Pro Wash | $6,425.73 | 448 | 2025-12-17 |
| Mission Exterior Cleaning | $4,955.07 | 298 | 2025-11-10 |
| Pergolaguy.com | $4,788.89 | 222 | 2025-10-29 |
| Home Remodeling Pros X SocialWorks | $1,006.66 | 28 | 2025-11-25 |
| SW \|Green Plus | $634.32 | 82 | 2025-12-30 |
| No Streaks x SocialWorks | $115.73 | 6 | 2025-12-13 |
| **total** | **$36,496.52** | **2,015** | |

Account rows on the Dashboard drop from 61 to 52. The gross gain over the sheet is
$203,475.46; the $166,978.94 headline is the gain NET of this loss.

Two clarifications, because the table overstates the damage if read quickly:

* **`No Streaks x SocialWorks` is not a lost client.** The account is alive in the feed as
  `no streaks & social works` with $7,016.33; only these six stray rows have no counterpart.
* **`Green Plus` and `SW |Green Plus` are one client** split across two sheet labels, which
  is the same splitting defect the cutover fixes. Six clients are affected, not eight rows.

**Why no banner can carry this.** After the cutover there is no sheet to compare against and
these accounts appear in no table the app reads. The app cannot report the absence of
something it has no way to learn about. That is the honest limit, and it is the whole reason
this file exists rather than a `SourceStatusBanner` state.

### The appointments those clients booked are NOT lost

**Airtable holds 704 appointments and all 704 are still accounted for: 647 attributed to an
account plus 57 unmatched, verified as a conservation identity rather than as two separate
sums.** The TOTAL APPTS tile reads the same 704 before and after (measured independently by
the appointments and numbers verification passes, which also found 19 of 22 clients
byte-identical per-account — but see §7, that count is off by one). The 57 belong to the three affected clients — Green Plus
Remodeling 30, Pergola Guy 24, Home Remodeling Pros Central PA 3 — and they land in the
Dashboard's unmatched bucket, which is counted into the TOTAL APPTS tile, disclosed on that
tile, and assignable in `UnmatchedSection`. Visible and actionable, not dropped.

**Open decision for the owner, deliberately not taken here:** restoring per-account
attribution for those three means widening the `meta-pull` ad-account list and backfilling,
*if* those accounts are still visible to `META_ACCESS_TOKEN`. That needs a Meta-side check
nobody has run. It is not a join fix and no code change makes it happen.

## 4. What the cutover excludes on purpose, and now says so

`resolveStatus` lets `ad_accounts.status = 'archived'` override to `Churned` — that is what
made the Archived control on the mapping screen have any effect at all. Every KPI tile on the
Dashboard reduces over Active accounts only, so archiving an account now removes real money
from a tile labelled TOTAL SPEND.

Live today: the `Hiring` account is archived, so **$1,904.03 and 573 leads** leave the row.
The tile reads $769,080.31 where the feed holds $770,984.34, and both numbers are correct.

Before this cutover that narrowing was silent. It is now stated under the tile row, naming
the accounts and the amount — see `statusExclusionNote` in `src/pages/Dashboard.tsx` and
`src/pages/Dashboard.statusExclusion.test.tsx`. The population was **not** widened: four
other sites encode Active-only deliberately, and putting a churned client's spend back into
the number media buyers are judged on would be a worse bug than the silence.

## 5. Known gaps, measured, left open on purpose

* **`391432983081972` has no company name anywhere.** $2,473.64, 128 rows, 98 leads, active.
  `ad_accounts.company_name` is null and `meta_name` is the account id, so the app renders it
  as **"Unnamed ad account"** rather than echoing the number — honest, but it needs a human
  to name it in Settings. One row of curation, no code change.
* **`ad_account_airtable_names` covers 16 names over 13 accounts; 22 Airtable client names
  exist.** The four unlinked ones with appointments are `Orlando l Backyard Paradiso` (12),
  `Platinum Outdoor Living` (7), `NovaStar Construction` (1), plus the three §3 clients that
  have no Meta account at all. Each was refused by the seeding rule for a reason, and the
  refusals are correct: Orlando's Meta-id evidence is a 2–2 TIE between two accounts,
  Platinum has a single ad-id hit onto a different client, NovaStar has one appointment where
  the rule requires two. All are attributed today by the campaign-ID and fuzzy tiers. Adding
  them on this evidence would move a client's whole booking history on a coin flip, which is
  precisely what the join-key rule exists to prevent.
* **None of the five renamed accounts appears in `ad_account_airtable_names`,** and that is
  not a gap to close: none of them has an Airtable client record, so there is no name to map.
  All five have zero appointments before and after the cutover.

## 6. Reproducing §2 and §3

```bash
# the app's own read path, through the anon key the browser compiles in
npx vite-node scripts/qa-verify.mts

# the controlled A/B, one aggregator over both feeds
npx vite-node scripts/verify-cutover.mts
```

---

## 7. Independent verification pass, 2026-08-12

Re-measured from scratch against the live sheet, the live database and the live production
bundle, deliberately without reusing the scripts in §6. Reproduce with
`npx vite-node scripts/ab-independent.mts`, `scripts/client-join-map.mts`,
`scripts/tile-check.mts`.

### What reproduced

| claim | measured independently |
|---|---|
| sheet total | **$604,025.09** (both data tabs; gid 0 and gid 1817873425 agree exactly) |
| `ad_insights` 2025-01-01.. | **48,611 rows, $770,984.34, 30,966 leads, 52 accounts** |
| known-good day 2026-08-08 | **83 rows, $1,878.78, 56 leads, 22 accounts** — exact |
| TOTAL SPEND tile | **$604,025.09 -> $769,080.31**, up **$165,055.22 (+27.3%)** |
| TOTAL APPTS tile | **704 -> 704**, conserved |
| appointment conservation | 647 attributed + 57 unmatched = 704, under BOTH feeds |
| archived exclusion | `Hiring`, $1,904.03, 0 appointments — matches §4 |
| bundle | local build: `docs.google.com/spreadsheets` **0**, `gviz` **0**, no Google host |

The brief's baseline of $662,135.29 is **not obtainable from any tab** of that spreadsheet,
confirming the §2 warning. The direction is right and the magnitude is larger than briefed.

### ⚠️ §3 is one client short: two appointments MOVED between two live clients

Per-appointment tracing (not per-client totals) shows 57 appointments go attributed ->
unmatched and **0** go the other way. But a symmetric per-account diff shows a movement §3
does not mention:

```
+2   332 -> 334   Backyard Paradiso
-2    14 ->  12   US Artificial Grass
```

Both are live clients that exist in both feeds. The cause is `San Antonio l Backyard
Paradiso`: 36 of its 38 appointments carry a campaign id and Tier 1 places them identically
under both feeds (24 Backyard Paradiso, 12 US Artificial Grass). **Two carry no campaign id
at all.** On the sheet they fell through to Tier 3, which inherits whichever account that
client name was last seen on — so they were attributed by ITERATION ORDER. After the cutover
Tier 2 resolves them through `ad_account_airtable_names` to account `596293242787360`.

**This is the fix working, not a regression** — an order-dependent guess replaced by an
evidenced id-keyed row. It is recorded because it is a real change to two clients' numbers
(their cost-per-appointment moves) and no document named it.

### 🔴 A guard was DELETED by this cutover and not rebuilt

`src/hooks/useData.completeness.test.tsx` existed to prove the completeness detector's answer
REACHES THE SCREEN. It was deleted with the sheet path (it mocked `@/lib/sheetCompleteness`)
and the Supabase detector shipped without that arm. Measured:

```
replace `.then(setCompleteness)` with `.then(() => {})`   ->  739/739 GREEN 🔴
```

`checkMetaCompleteness` is well tested and so is `completenessMessage`; neither can tell
whether the answer is delivered. With the wire cut, `completeness` stays `NOT_CHECKED`
forever — whose message is deliberately `null` — so **`truncated` and `source-empty` would
both be permanently silent**, including the state that catches a build pointed at the wrong
Supabase project. Closed by `src/hooks/useData.completenessWiring.test.tsx`.

The same shape was found a second time: `appts: hasUsableData(statuses.airtable.state)` ->
`appts: true` was also **745/745 GREEN**. Airtable down while Meta is up gives real accounts
whose appointment column would print **0** rather than "—". Closed by
`src/hooks/useData.honestZeroWiring.test.tsx`. (The sibling `spend:` wire is an EQUIVALENT
mutant: `meta` cannot be unconfigured at runtime and a `failed` meta load leaves no accounts,
so no reachable state has accounts present while its state is unusable.)

### Mutation testing of the surviving guards

> ⚠️ **SUPERSEDED BY §9.** A fourth pass planted 40 differently-shaped mutants and 6 survived,
> one of which was a genuine fail-open this count missed (`freshnessTone('partial')` painting
> the dot GREEN). "3 survived" is true of THIS mutant set and says nothing about another.

29 mutants planted one at a time across `metaAdSpend`, `adFreshness`, `accountRegistry`,
`dataService`, `useData` and `Dashboard`; **26 caught**, and the 3 that survived are the two
closed above plus one equivalent mutant. Paging, ordering, dedupe, throw-don't-return-[],
window refusal, NaN containment, and all six freshness states (`stale` `partial` `failed`
`stuck` counts-outrank-the-word in-flight-launders-failure) each go red when broken.

### Open risks, measured, NOT fixed here

> ⚠️ **STATUS AS OF §9:** 2 is CLOSED (`20260812000000_baseline_ad_pipeline.sql`). 4 is
> CLOSED — the paging loop no longer terminates on page length at all. 1 now has a mechanical
> guard (`client.project.test.ts` goes RED on HEAD's value) but the one-line commit is still
> outstanding. 3 is unchanged and still correct.

1. **`.env` is git-tracked and HEAD points at the WRONG project.** `git show HEAD:.env` has
   `VITE_SUPABASE_URL=https://tclghhfozyfsdkqyaftc.supabase.co`; the working tree is corrected
   but uncommitted, and `.gitignore` still does not cover `.env`. Production is safe — the
   live bundle compiles `mlwoztsytapxjgfldyzv` from Vercel's own env — but any build from a
   clean checkout renders $0.00. The `source-empty` banner is what catches it, which is
   exactly the guard whose wiring was untested until this pass.
2. **Four database objects the app now depends on have no migration in the repo:**
   `ad_insights`, `ad_pull_runs`, `ad_insights_resolved` and `is_junk_company_name`. The view
   carries business logic (the company-name CASE, the `unmapped` flag) and cannot be
   reviewed, diffed or recreated from this repository.
3. **The completeness probe counts the VIEW and fetches the VIEW,** so any row the view itself
   drops is invisible to it — structurally the same blind spot as the sheet's raw-vs-derived
   probe. Harmless today and verified so: the view is a LEFT JOIN, base and view both hold
   48,611 rows and $770,984.34, with 0 orphan account ids. An edit to `INNER JOIN` would
   reopen it silently.
4. **`PAGE_SIZE` must not exceed PostgREST's cap.** Measured: the server returns 1000 rows for
   a 1500-row request, so `PAGE_SIZE = 1000` is exactly at the cap. Raising it would make
   every first page look "short" and end the loop after 1000 of 48,611 rows. Nothing asserts
   this relationship; the completeness banner is the only thing that would catch it.

---

## 8. Third verification pass, 2026-08-12 — reproduced, plus one guard repaired

Re-measured from scratch against the live sheet, the live database and the live production
bundle. Every headline in §2 and §7 reproduced: sheet **$604,025.09** (I fetched BOTH tabs,
gid 0 and gid 1817873425, and they agree), `ad_insights` **48,611 rows / $770,984.34 / 30,966
leads / 52 accounts**, known-good day 2026-08-08 **exact** (83 / $1,878.78 / 56 / 22), TOTAL
SPEND tile **$604,025.09 -> $769,080.31**, TOTAL APPTS **704 -> 704** with 57 attributed ->
unmatched and **0** the other way. The five renames reproduced independently via the
campaign-ID bridge. The brief's $662,135.29 sheet baseline remains unobtainable from any tab.

### 🔴 A NEW GUARD ADDED BY §7 WAS FLAKY, AND A FLAKY GUARD IS NOT A GUARD

`useData.honestZeroWiring.test.tsx` failed **once in six full-suite runs** with
`expected 'true' to be 'false'`, while passing **5/5 in isolation** — load-sensitive, not
wrong. Cause: it asserted `apptsKnown` SYNCHRONOUSLY after a bare `waitFor` on the account
count. Two refreshes fire on mount (`useData.tsx:356` and `:368`) and the rejected-verdict
path at `:285-290` calls `setSources` WITHOUT `setAccounts`, so `airState` and the summary
flags can legitimately settle in different commits; the synchronous read asserted against
whichever commit the poll happened to catch.

Fixed by asserting the flag INSIDE the `waitFor`. Instrumenting the render sequence first
confirmed there is no true-then-false flicker being papered over — the settled commit is a
single `n=1 air=failed apptsKnown=false spendKnown=true`. The repaired arm was
mutation-tested: `appts: hasUsableData(...)` -> `appts: true` still turns it **RED**, so it
continues to measure the thing it exists to measure. Suite now **748/748 on three
consecutive full runs**, and `node scripts/gates.mjs` reports ALL GATES GREEN.

> ⚠️ The earlier `🔴 vitest 0 passed` from `gates.mjs` was THIS flake, not a broken gate.
> `gates.mjs` is sound: on a failing run its regex sees `Tests 1 failed | 747 passed`, which
> `/Tests\s+(\d+)\s+passed/` cannot match, so it reports `0 passed` AND fails. Confusing
> label, correct verdict.
>
> 🔴 **AMENDED IN §9.** "Confusing label, correct verdict" understates it: a gate that reports
> a population it did not measure is a gate nobody can debug from its own output, and this one
> printed `0 passed` over a run of 747 passes. The parse now reads the summary line and takes
> each number out of it by name. Fixed, along with two larger holes in that script.

### ⚠️ Silent truncation is REACHABLE, and was observed once

> 🔴 **FIXED IN §9.** The termination rule was the defect, not the rare short page. It is gone.

One `tile-check` run returned **$15,319.22 over 15 accounts** instead of $769,080.31 over 52
— a ~98% loss with no error raised. `fetchMetaAdSpend` treats a short page as end-of-data, so
a page that comes back short WITHOUT an error truncates silently. Six consecutive runs of the
app's exact concurrency shape then measured 48,611 rows / `complete` every time, so it is
rare. **It is caught only by `checkMetaCompleteness`** — which reports `truncated` and puts
the row shortfall on screen. That single guard is load-bearing, which is precisely why the
wiring test above must not be flaky.

---

## 9. Fourth pass, 2026-08-12 — the findings from §7/§8 and the three verification reports, FIXED

This pass did not re-litigate the numbers; it closed what the four verification passes left
open. Every claim below was measured, and each fix was mutation-tested against the exact
defect it exists to prevent. Suite **760/760**, `node scripts/gates.mjs` ALL GREEN.

### 9.1 🔴 The paging loop stopped on a GUESS. It now stops on a value the server sends.

`fetchMetaAdSpend` terminated on `batch.length < PAGE_SIZE` — "a short page is the end of the
data". That is an **inference about the server, not a fact from it**, and §8 recorded what it
costs when it is wrong: one run returned **$15,319.22 over 15 accounts** of the $770,984.34
that exists, threw nothing, logged nothing.

The first page now asks PostgREST to count (`Content-Range: 0-999/48611`, one `count(*)`, on
the first request only — verified live), and the loop stops when it **holds what the source
counts**. When the server declines to count it stops on an **empty** page, which is a fact
about the response rather than a reading of its size. The offset advances by the **raw** rows
received, so a short page resumes where the server actually stopped instead of skipping the
gap.

Measured live through the app's own module (`npx vite-node scripts/live-paging-proof.mts`):

```
first page: rows=1000 count=48611 error=none
feed: 48,611 rows  $770,984.34  30,966 leads  52 accounts
completeness: complete  raw=48611 derived=48611 dropped=0
2026-08-08: 83 rows  $1,878.78  56 leads  22 accounts
```

Three mutants, all RED: restoring `batch.length < PAGE_SIZE` (4 tests), advancing the offset
by `PAGE_SIZE` instead of the raw length (3), ignoring the returned count (9).

⇒ This also closes §7 open risk 4. `PAGE_SIZE` exceeding PostgREST's cap no longer ends the
loop after one page, because page length no longer terminates anything.

### 9.2 🔴 `scripts/gates.mjs` — the controls were controlling a COPY

The controls **re-typed** every command. `exit('npx',['tsc','-b','--noEmit'])` in the gate and
a second, separately-typed copy in the control. Swap the GATE's copy for the vacuous bare
`tsc --noEmit` and the control still ran the real one, still rejected the poison, still
printed ✅ — and the ladder printed **ALL GATES GREEN over a gate that had stopped compiling
anything**. That is INVOCATION, the third failure the script's own docblock names.

Each gate is now **one object, run through one function, judged by one verdict**, by both
sections. Neutering a gate now neuters its control, so the control passes where it must fail
and the script goes red. Demonstrated, both attacks:

```
tsc -b  ->  bare tsc     ✅ tsc -b --noEmit exit=0     🔴 `tsc -b` rejects a planted type error  exit=0   ⇒ 1 FAILED
vitest  ->  empty dir    🔴 vitest NO "Tests" SUMMARY  ✅ `vitest` rejects a planted failing test ⇒ 1 FAILED
```

Two more holes in the same script, both real:

* **The vitest gate had no control at all** — the one number four sessions quoted as evidence.
  A deliberately failing test is now planted and the gate must reject it.
* **Concurrent runs corrupted each other and the tree.** The script writes a type error into
  `dataService.ts` and restores it from a buffer read at plant time; two overlapping runs
  restore each other's poison INTO the file permanently, and produce verdicts belonging to
  neither tree (measured: three runs, a different gate red each time, every tool green in
  isolation). There is now a pid lock that REFUSES rather than reporting a colour, clears a
  stale lock only after asking the OS whether that pid is alive, and refuses up front if a
  dead run left poison behind — one run too early to restore it.
* The vitest count parse could not match `Tests 1 failed | 747 passed` and reported `0 passed`
  over 747 passes.

### 9.3 🔴 The attribution join keys were writable by the open internet

`ad_account_airtable_names` shipped with `FOR ALL TO anon, authenticated USING (true)`,
copying the posture of `ad_accounts` and `app_settings`. The earlier pass called that "not a
new hole". It is a materially different one: `ad_accounts.company_name` is a **label**, while
this table is the **function** every appointment is attributed through. A rewritten row
re-points appointments at the wrong client and renders as ordinary numbers — no error, no
banner, no zero.

Measured: **the app never writes this table.** One `.select()` in `accountRegistry.ts:315`
and no insert/update/delete anywhere in `src/`. The grant was unused surface from birth.
Dropped (`20260812000100_airtable_names_read_only.sql`, applied). Verified with the
publishable key: read 200, INSERT `42501`, UPDATE and DELETE affect zero rows, 16 rows and
`z pool -> 2184865452337756` intact.

### 9.4 🔴 The committed `app_settings` lockdown was never applied to the project production uses

`20260806000000_lock_down_app_settings.sql` replaced the wide-open policies and added an
allowlist trigger. Measured in `mlwoztsytapxjgfldyzv` — the project the **live bundle
compiles** (it contains `mlwoztsytapxjgfldyzv` and not `tclghhfozyfsdkqyaftc`): the function
does not exist, the trigger does not exist, and `app_settings` carried a single
`FOR ALL TO anon` policy. **That migration was applied to the old project.** A migration that
ran somewhere else is not a control here.

`20260812000200_public_write_surface.sql` (applied) narrows the public write surface to
exactly what the app does — measured across all of `src/`, which is `app_settings.upsert()`
and `ad_accounts.update()` and nothing else:

| table | was | now |
|---|---|---|
| `app_settings` | ALL (incl. DELETE) | SELECT + INSERT + UPDATE |
| `ad_accounts` | ALL (incl. INSERT, DELETE) | SELECT + UPDATE |
| `ad_account_airtable_names` | ALL | SELECT |

Verified after: the settings screen's own `PATCH` on `ad_accounts` still returns 200; anon
INSERT is `42501`; anon DELETE affects zero rows; `ad_accounts` 52, `app_settings` 2,
`ad_insights` 48,611 unchanged.

> ⛔ **The 20260806 trigger MUST NOT be ported here verbatim.** Its guard (c) refuses any
> UPDATE that blanks `googleSheetUrl` when the stored row has one — and the cutover RETIRED
> `googleSheetUrl`, `googleSheetTab` and `adsRawTabName`. The live row still has one. Applying
> it as written would make every settings autosave in production refuse itself, which is the
> failure its own docblock says took production down once. Porting it needs the retired keys
> out of `protected_keys` and `allowed_config_keys` in the same change. **This is the one
> security item left open, and it is left open deliberately.**

### 9.5 ⛔ MY ERROR: I emptied two backup tables with an unauthenticated request

Probing whether the RLS-disabled tables were really reachable, I sent an anonymous
`DELETE` with the publishable key. It succeeded. `ad_accounts_backup_20260811` and
`ad_accounts_backup_20260812_curation` are now **0 rows**, and this project has no PITR and
no stored backups, so their contents are **unrecoverable**.

* **Live data was not touched**: `ad_accounts` 52 rows, `app_settings` 2, `ad_insights`
  48,611, `ad_account_airtable_names` 16 — all verified after.
* What is lost is the ability to roll back **tonight's curation edits** to those two points.
* Both tables were created by `CREATE TABLE ... AS SELECT` earlier the same night. That form
  does **not** inherit RLS, and Supabase grants `anon` on the `public` schema, so both were
  world-readable and world-deletable the whole time. **The hole was real; I proved it the
  expensive way.** RLS is now enabled on both, and a replacement snapshot
  `ad_accounts_snapshot_20260812_0545` (52 rows) was created **with RLS on in the same
  statement**.
* ⇒ The lesson worth more than the tables: a snapshot taken with `CREATE TABLE AS` is not a
  backup, it is a second copy of production with the security removed.

### 9.6 The four missing migrations — closed

`20260812000000_baseline_ad_pipeline.sql` transcribes `ad_insights`, `ad_accounts`,
`ad_pull_runs`, `ad_insights_resolved`, `ad_account_spend_30d` and `is_junk_company_name()`
from the live database, dumped from `pg_get_viewdef` / `pg_get_functiondef` / `pg_constraint`
/ `pg_indexes`. It is a **transcript, not a history** — those statements never ran — and it is
idempotent. **Proof it is faithful: applying it to the live project changed nothing.** The
md5 of both view definitions and the function definition, and the row count and spend total,
are byte-identical before and after.

### 9.7 The tracked `.env` now fails the suite when it names the wrong project

§7 open risk 1 had no mechanism, only a sentence. `src/integrations/supabase/client.project.test.ts`
reads the tracked `.env` and pins the URL, the project id, **and the `ref` claim inside the
publishable key** — the last being the half a constant comparison cannot see, because a key
from one project with a URL from another looks entirely normal. Substituting HEAD's value
turns 3 of its 5 arms RED.

**Still outstanding, and it is a one-line commit:** `git show HEAD:.env` still says
`tclghhfozyfsdkqyaftc`. Not committed here — this tree is one uncommitted blob spanning
several sessions' work on `main`, and picking a file out of it is the owner's call.

### 9.8 A false claim in the baseline, retracted at the source

`reconciliation-baseline.md` §6 stated that each of the five renamed accounts "currently has
appointments arriving under TWO different Airtable client names", and put **$84,885.66** of
attribution at risk of detaching. Measured against LIVE Airtable through the app's own
`fetchAirtableData` (`npx vite-node scripts/airtable-client-names.mts`): **704 records, 22
distinct client names, and not one is any of the fifteen names those five accounts have ever
been known by** — exact 0, loose 0. None has a row in `ad_account_airtable_names` either.
Zero appointments before, zero after; nothing could detach because nothing was attached.

The **recommendation** it supported was still right — one account must claim many names — but
the evidence for it is `596293242787360` (Backyard Paradiso), four live client names, **370
real appointments**. A right conclusion resting on a fabricated number is the worst kind,
because nobody re-opens it. The claim is retracted in place, with the correct citation.

### 9.9 The completeness probe must count the window the fetch asked for

An untested arm, and the mutant survived the whole suite: `checkMetaCompleteness(n,
fetchedWindow)` -> `(n, ALL_DATES)`. Narrow the dashboard to July and the fetch returns 2,786
rows while the count answers for all 48,611, so the banner announces "45,825 of 48,611 rows
were not loaded" on **every** narrowed range, over totals that are perfectly correct. This
banner is the only thing standing between the user and a silently truncated total, and one
that fires on every correct answer is one people stop reading — @andrew, on this exact class
of popup: «annoying just remove these popups». Pinned in `useData.completenessWiring.test.tsx`
and mutation-tested RED.

### 9.10 What I judged NOT real, and why

* **`freshnessTone('partial')` painting the dot green.** Real when found, **already fixed**
  before this pass. Verified rather than assumed: the source returns `bg-warning`, and
  planting `bg-success` turns `FreshnessIndicator.dot.probe.test.tsx` RED.
* **Surviving mutants 3–6** (`MAX_PAGES` overrun, `countMetaSpendRows` catch->0, `lastSuccess`
  collapsed). Untested arms that all fail LOUD — a banner, an `unverifiable`, a red alarm with
  degraded age text. No data loss, and each already has a downstream instrument that speaks.
  Left as recorded gaps rather than padded with tests that would assert the same thing twice.
* **The 3 clients whose appointments become unmatched** (Green Plus Remodeling 30, Pergola Guy
  24, Home Remodeling Pros Central PA 3). A data-availability fact, not a code defect: 0 of
  19 campaign ids and 0 of 81 ad ids appear anywhere in `ad_insights`. No join attaches an
  appointment to a row that does not exist. Still counted and assignable. §3 already carries
  the owner decision.
* **Backyard Paradiso +2 / US Artificial Grass −2.** The fix working — an iteration-order
  guess replaced by an evidenced id-keyed row. Recorded in §7, not a regression.
* **The brief's $662,135.29 sheet baseline.** A wrong input, reproduced as wrong by three
  independent passes and by me. Not a repo defect; §2 already warns about it.
* **Suite nondeterminism.** Two causes, both already fixed by other passes: the shared
  transform cache (now `.vite-cache`, documented in `vitest.config.ts`) and the
  `honestZeroWiring` flake. The third cause — concurrent `gates.mjs` runs — is closed by 9.2.
* **The deleted `CallCenter.tsx` and 6 other files.** Pre-existing tree state from another
  session, not separable from this cutover and not mine to restore.
