# Meta Marketing API pull — design

**Date:** 2026-08-11
**Status:** approved, ready for implementation plan
**Scope:** phase 1 only. Data lands in Supabase. Nothing user-facing changes.

## Problem

Ad spend reaches the dashboard through Windsor.ai writing a Google Sheet
(`FACEBOOK ADS DATA`, tab `Ads - Raw`), which a second tab (`Ads Data`) mirrors via
ARRAYFORMULA, which the browser downloads as a 7.5 MB CSV on every page load.

Measured failures of that pipeline on 2026-08-11:

| Failure | Cause |
|---|---|
| Dashboard blank, `#REF!` | Sheets grid ran out of rows; the mirror emitted one row per row of the raw tab's *grid*, including ~8,686 empty ones |
| 6 accounts absent 06-24 → 08-05 | Windsor's destination wrote a subset; nothing detected it |
| Aug 6 and Aug 9 held only those 6 | The inverse failure, on two days |
| $15,517.62 of spend missing over 30 days | Consequence of the above |
| Backfill doubled Aug 8/9/10 | `Columns to Match` did not dedupe; it appended |
| 318 rows / $6,298.53 of Mar 2025 deleted | Same run silently destroyed unrelated history |

The common root cause is using a spreadsheet as a database: no primary key, no
constraint, fixed grid, silent truncation, and writes that report success while
losing data.

## Goal

A scheduled pull from the Meta Marketing API into Postgres, where a primary key
makes duplication and silent loss structurally impossible.

**Phase 1 is done when** ad data lands in Supabase on a schedule and reconciles
against known-good figures. The dashboard keeps reading the Google Sheet. No app
code changes, so a bug in the pull cannot take the dashboard down.

## Evidence this works

Verified against the live API before designing anything, using Aug 8 as ground truth.
Restricted to the 20 accounts Windsor also reports:

| | Meta API | Windsor |
|---|---:|---:|
| rows | 78 | 78 |
| spend | $1,795.64 | $1,795.64 |
| leads | 54 | 54 |
| per-account mismatches | 0 | — |

Identical to the cent and to the individual account.

Two further findings:

- **Lead mapping is `actions[].action_type == 'lead'` and nothing else.** The response
  also carries `offsite_content_view_add_meta_leads`,
  `offsite_complete_registration_add_meta_leads` and `offsite_search_add_meta_leads`,
  which look lead-shaped and are not. Summing them gives 112 against a true 54.
- **The direct pull already sees more than Windsor.** Accounts `SocialWorks` and
  `no streaks & social works` returned $83.14 on Aug 8 and have never appeared in the
  dashboard.

Token discovery returns **64 ad accounts**, single page, zero errors. Standard Access
is sufficient; no App Review needed.

## Architecture

Supabase Edge Function invoked on a pg_cron schedule, following the existing
`supabase/functions/airtable-proxy` pattern in this repo.

```
pg_cron (daily 09:00 UTC)
    └─> edge function `meta-pull`
            ├─ GET /me/adaccounts                    discover accounts
            ├─ per account: GET act_<id>/insights    level=ad, time_increment=1
            ├─ map rows (pure function)
            ├─ upsert ad_insights on (date, ad_id)
            └─ write ad_pull_runs
```

**Portability.** The Meta fetch and row mapping live in a module with zero Supabase
imports; a thin adapter performs the write. Moving to another host swaps the adapter,
not the logic. The pure core is also the unit-testable surface.

09:00 UTC is chosen over Windsor's 04:00 so the two do not interleave while both run.

## Schema

```sql
create table public.ad_insights (
  date          date not null,
  ad_id         text not null,
  account_id    text not null,
  account_name  text not null,
  campaign_id   text,
  campaign_name text,
  adset_id      text,
  adset_name    text,
  ad_name       text,
  spend         numeric(12,2) not null default 0,
  leads         integer       not null default 0,
  fetched_at    timestamptz   not null default now(),
  primary key (date, ad_id)
);

create index ad_insights_date_idx    on public.ad_insights (date);
create index ad_insights_account_idx on public.ad_insights (account_name, date);
```

`(date, ad_id)` verified unique across all 39,268 rows of live sheet history, with
zero blanks in either column. An ad belongs to exactly one adset, so the pair is a
true key rather than a convenient one.

```sql
create table public.ad_pull_runs (
  id                  bigserial primary key,
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  date_from           date not null,
  date_to             date not null,
  accounts_discovered int,
  accounts_ok         int,
  accounts_failed     int,
  rows_upserted       int,
  status              text not null,     -- running | ok | partial | failed
  error               text
);
```

**RLS.** Enabled on both tables. `ad_insights` gets an anon SELECT policy so the
dashboard can read it later. No anon write policy: only the Edge Function's service
role writes. This deliberately does not repeat the mistake corrected in
`20260806000000_lock_down_app_settings.sql`, where anon held full write access to a
table holding live credentials.

## The pull

**Discovery.** `GET /v23.0/me/adaccounts?fields=id,name&limit=200`, following paging.
Accounts are never hardcoded, so a newly assigned account is picked up on the next run
with no code change.

**Per account.** `GET /v23.0/{account_id}/insights` with:

- `level=ad`
- `time_increment=1` — one row per ad per day, matching the existing grain
- `time_range={"since":…,"until":…}`
- `fields=account_id,account_name,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,actions`
- `limit=500`, following paging

**Mapping.** `spend` parsed as numeric. `leads` = sum of `actions[].value` where
`action_type == 'lead'`, 0 when `actions` is absent. Meta omits `actions` entirely for
rows with no conversions, so absence means zero, not unknown.

**Write.** Upsert on `(date, ad_id)`, batched. Re-running any range any number of times
converges to the same rows.

**Daily schedule** pulls a 3-day trailing window, not just yesterday. Meta restates
recent numbers as attribution settles, and upserting is idempotent, so re-pulling is
free. Windsor's `last_1d` had no such tolerance: a single missed night was permanent.

## Backfill

Same function, explicit `date_from` / `date_to`, invoked manually. Chunked by month per
account. Ranges beyond a few weeks use Meta's async report flow: POST to the insights
edge, poll the report run id, fetch results. Target range is **2025-01-01 → yesterday**,
matching the sheet's span so the two can be reconciled.

## Error handling

The design lesson from Windsor is that a partial write must never report success.

- **Per-account isolation.** One account failing is recorded and the other 63 still land.
- **Rate limits** (codes 17, 613) get exponential backoff and retry.
- **Run status** is `ok` only when `accounts_failed = 0`. Any failure yields `partial`,
  which is a distinct state from success and from total failure.
- **No destructive operations.** The function only ever upserts. It has no delete path,
  so it cannot repeat what the Windsor backfill did to March 2025.

## Verification

Before the schedule is enabled:

1. Aug 8 must reproduce 78 rows / $1,795.64 / 54 leads across the 20 shared accounts.
2. Day-by-day reconciliation of Jul 12 → Aug 11 against the Windsor API pull already
   captured, tolerating only the known extra accounts.
3. Re-run the same range twice; row count and totals must not move.

Unit tests cover the pure core: the `actions[] → leads` mapping (including the
lookalike action types that must be excluded), row mapping, and date handling.

## Out of scope for phase 1

- Dashboard reading from Supabase
- Decommissioning Windsor or the Google Sheet
- Alert delivery. Run rows capture anomalies; wiring them to a notification is later.
- Migrating off Lovable Cloud. The official export carries Edge Functions and cron, so
  anything built here moves with it.

## Deployment

Lovable Cloud manages this Supabase project, so there is no Supabase CLI access.

| Artifact | Path |
|---|---|
| Migration | `supabase/migrations/<ts>_meta_ad_insights.sql`, applied via Lovable |
| Function | `supabase/functions/meta-pull/`, deployed by Lovable from the repo |
| Secret | `META_ACCESS_TOKEN`, set by the owner in Cloud → Secrets |

## Open items

- Whether Lovable applies repo migrations automatically or needs to be asked. Assume
  asked; confirm on first run.
- Meta Graph API version is pinned at `v23.0`, the version verified working today.
