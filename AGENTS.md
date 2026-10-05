# PIXEL PROPEL OPS — agent instructions

Loaded on top of `~/.codex/AGENTS.md` (your identity and the coordination bus).
If you have not read the bus this session, do that before touching anything here.

## WHAT THIS IS

The paid-media tracker at https://adsdata.socialworkspro.com (no auth wall).
Andrew's goal: make it trustworthy enough that a future Head of Paid Media can
run ~30 ad accounts on it **without Andrew hand-checking the numbers.**

Stack: Vite + React + TS + Tailwind, Supabase, Vitest. Source feed is a Windsor
Google Sheet ("FACEBOOK ADS DATA").

## THE DOCS ARE THE TRUTH, NOT THIS FILE

    ~/pixel-audit/docs/CHARTER.md          Andrew's brief verbatim, standards, the seat split
    ~/pixel-audit/docs/SOURCE-BASELINE.md  what was measured off the live Windsor sheet
    ~/pixel-audit/docs/SEAT-*.md           per-seat briefs
    ~/pixel-audit/docs/CODEX-TECHNICAL-COLEAD.md   yours
    ~/pixel-audit/ledger/FINDINGS-codex.jsonl      your findings go here, append only

## GATES BEFORE ANY CLAIM THAT SOMETHING WORKS

    bun run test      vitest
    bun run gates     the repo's own gate script
    npx tsc -b --noEmit

Running them is the claim. Reading them is not.

## THREE MEASURED FACTS THAT CHANGE HOW YOU READ THIS CODE

1. **The Windsor feed has NO Account Id column.** Campaign, Adset and Ad ids are
   all present; the account is a human-typed name, 61 distinct spellings. Fuzzy
   name matching in this app is a symptom. The stable id was never exported, so
   no amount of fixing the matching code can fix it.
2. **Dates are M/D/YYYY strings.** A lexical max returns `"9/9/2025"` while the
   true max is `2026-08-04`. Any string comparison reports a healthy feed as
   eleven months stale and mis-filters every date range.
3. **`app_settings` RLS is enabled and then defeated** by four `USING (true)`
   policies, and `.env` is tracked in git with no `.env` rule in `.gitignore`.
   That the ingredients are public is measured. Whether live tokens are actually
   in there is a separate claim and belongs to apprentice, not you.

## THE STANDING RULING ON TRUST

Andrew: *"tell them not to trust anything, its shit code from lovable, our
engineers are much better."*

The normal law here is that you grep the TESTS before calling behaviour a bug,
because a countersigned test is a contract. **That law is suspended for this
repo.** The inherited suite was one file asserting `true === true`. Nothing was
ratified, reviewed or countersigned, so behaviour that looks deliberate is not
evidence that it was.

The operational half, because trust-nothing is about evidence and not verdicts:
it does NOT mean assume everything is broken. The SOURCE is healthier than the
APP (38,944 rows, zero duplicates, zero blank identifiers, one day stale). A
confident wrong finding costs Andrew more than a missed one, because a wrong
number one is a wrong routing table that aims every idle seat at settled work.
