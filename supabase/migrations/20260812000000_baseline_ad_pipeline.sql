-- ============================================================================
-- BASELINE: THE AD PIPELINE OBJECTS, WHICH EXISTED ONLY IN THE LIVE DATABASE.
--
-- 🔴 THE GAP THIS CLOSES. `ad_insights`, `ad_accounts`, `ad_pull_runs`, the
-- `ad_insights_resolved` view and `is_junk_company_name()` are the entire ad-spend
-- pipeline — 48,611 rows and $770,984.34 of the number this dashboard exists to show — and
-- NONE of them had a migration in this repository. Three verification passes reported it
-- independently. They were created by hand against the live project, so:
--
--   · the view carries BUSINESS LOGIC (which name is a company, which account counts as
--     unmapped) that could not be reviewed, diffed, or reasoned about from the repo;
--   · nobody could stand up a second environment, and there is no second environment;
--   · the only copy of the rule lived in a database that one DROP would take with it.
--
-- ⚠️ WHAT THIS FILE IS, PRECISELY. It is a TRANSCRIPT of the live objects as they stand on
-- 2026-08-12, dumped from `pg_get_viewdef` / `pg_get_functiondef` / `pg_constraint` /
-- `pg_indexes` and rewritten as idempotent DDL. It is NOT a claim that these statements ever
-- ran: they did not. It is safe to run against the live project (every statement is
-- IF NOT EXISTS or OR REPLACE and nothing here drops or rewrites data) and it is what a
-- fresh project needs to become this one.
--
-- ⛔ IT DOES NOT CREATE THE POLICIES. Read-policy state for these tables is deliberately
-- left to the two 2026-08-12 migrations that follow, so there is exactly one file that says
-- who may write what. Splitting shape from grants is what stops a later "recreate the table"
-- from quietly re-opening a door.
-- ============================================================================

-- ── is_junk_company_name ────────────────────────────────────────────────────
--
-- ⭐ THE RULE THE VIEW LEANS ON, AND THE ONE PIECE OF REAL JUDGEMENT IN HERE. Meta hands
-- back account names that are not names: '', '10170221, USD', '222178771, USD',
-- '103578393327348, USD'. Those are the accounts whose DISPLAY NAME later changed to a real
-- company — the renames that split one client into two rows on the sheet. A name matching
-- `digits/commas/space + optional 3-letter currency` is an id wearing a label, so it is
-- refused as a company name rather than shown as one.
CREATE OR REPLACE FUNCTION public.is_junk_company_name(name text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  select name is null
      or btrim(name) = ''
      or btrim(name) ~* '^[0-9,[:space:]]+([A-Za-z]{3})?$';
$function$;

-- ── ad_accounts ─────────────────────────────────────────────────────────────
-- The curation. `account_id` is Meta's immutable id and THE identity; `meta_name` is
-- whatever Meta currently calls it, and Meta rewrites that — five confirmed renames.
CREATE TABLE IF NOT EXISTS public.ad_accounts (
  account_id   text PRIMARY KEY,
  meta_name    text NOT NULL,
  company_name text,
  program      text,
  media_buyer  text,
  status       text NOT NULL DEFAULT 'active',
  first_seen   date,
  last_seen    date,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_accounts_program_check
    CHECK (program = ANY (ARRAY['Done For You', 'Done With You', 'Internal']) OR program IS NULL)
);
CREATE INDEX IF NOT EXISTS ad_accounts_company_idx ON public.ad_accounts (company_name);

-- ── ad_insights ─────────────────────────────────────────────────────────────
-- One row per ad per DAY, written every three hours by the meta-pull Edge Function.
--
-- ⭐ PK (date, ad_id), AND IT IS LOAD-BEARING IN THE CLIENT TOO. `spendRowKey` in
-- src/lib/metaAdSpend.ts dedupes fetched pages on exactly this pair. Deduping on `ad_id`
-- alone would collapse an ad's entire history into one day.
CREATE TABLE IF NOT EXISTS public.ad_insights (
  date          date    NOT NULL,
  ad_id         text    NOT NULL,
  account_id    text    NOT NULL,
  account_name  text    NOT NULL,
  campaign_id   text,
  campaign_name text,
  adset_id      text,
  adset_name    text,
  ad_name       text,
  spend         numeric NOT NULL DEFAULT 0,
  leads         integer NOT NULL DEFAULT 0,
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (date, ad_id)
);
CREATE INDEX IF NOT EXISTS ad_insights_date_idx ON public.ad_insights (date DESC);
CREATE INDEX IF NOT EXISTS ad_insights_account_date_idx ON public.ad_insights (account_name, date DESC);

-- ── ad_pull_runs ────────────────────────────────────────────────────────────
-- The run log. `src/lib/adFreshness.ts` derives the whole fresh/partial/failed/stale/stuck
-- state machine from these rows, so the CHECK below is the enum that file switches on.
CREATE TABLE IF NOT EXISTS public.ad_pull_runs (
  id                  bigserial PRIMARY KEY,
  started_at          timestamptz NOT NULL DEFAULT now(),
  finished_at         timestamptz,
  date_from           date NOT NULL,
  date_to             date NOT NULL,
  accounts_discovered integer,
  accounts_ok         integer,
  accounts_failed     integer,
  rows_upserted       integer,
  status              text NOT NULL,
  error               text,
  api_warnings        text[],
  CONSTRAINT ad_pull_runs_status_check
    CHECK (status = ANY (ARRAY['running', 'ok', 'partial', 'failed']))
);
CREATE INDEX IF NOT EXISTS ad_pull_runs_started_idx ON public.ad_pull_runs (started_at DESC);

-- ── ad_insights_resolved ────────────────────────────────────────────────────
--
-- ⭐ THE VIEW THE APP ACTUALLY READS (`AD_SPEND_VIEW` in src/lib/metaAdSpend.ts), and the
-- reason the cutover is not "the same numbers from a nicer place": the curated company,
-- program and media buyer travel WITH the spend row, joined on `account_id`. That is the
-- join Meta's renames used to break when it was done by name on the client.
--
-- ⚠️ `company` FALLS BACK, IN ORDER, AND NEVER TO THE ID. The curated name, else Meta's
-- current name, else NULL — and an id-shaped name is refused at both steps, so an account
-- nobody has curated reads as NULL and shows up as `unmapped` rather than as "10170221, USD"
-- masquerading as a client.
CREATE OR REPLACE VIEW public.ad_insights_resolved AS
 SELECT i.date,
    i.ad_id,
    i.account_id,
    i.account_name,
    i.campaign_id,
    i.campaign_name,
    i.adset_id,
    i.adset_name,
    i.ad_name,
    i.spend,
    i.leads,
    i.fetched_at,
        CASE
            WHEN NOT is_junk_company_name(a.company_name) AND btrim(a.company_name) <> i.account_id THEN btrim(a.company_name)
            WHEN NOT is_junk_company_name(i.account_name) AND btrim(i.account_name) <> i.account_id THEN btrim(i.account_name)
            ELSE NULL::text
        END AS company,
    a.program,
    a.media_buyer,
    is_junk_company_name(a.company_name) OR btrim(a.company_name) = i.account_id AS unmapped
   FROM ad_insights i
     LEFT JOIN ad_accounts a ON a.account_id = i.account_id;

-- ── ad_account_spend_30d ────────────────────────────────────────────────────
-- Recency, for the settings screen's account triage.
CREATE OR REPLACE VIEW public.ad_account_spend_30d AS
 SELECT a.account_id,
    COALESCE(sum(i.spend) FILTER (WHERE i.date >= (CURRENT_DATE - 30)), 0::numeric)::numeric(14,2) AS spend_30d,
    COALESCE(sum(i.leads) FILTER (WHERE i.date >= (CURRENT_DATE - 30)), 0::bigint) AS leads_30d,
    max(i.date) FILTER (WHERE i.spend > 0::numeric) AS last_spend_date
   FROM ad_accounts a
     LEFT JOIN ad_insights i ON i.account_id = a.account_id
  GROUP BY a.account_id;

-- ── RLS on, read policies ───────────────────────────────────────────────────
-- ad_insights and ad_pull_runs are READ-ONLY to the browser. Only the meta-pull writes
-- them, and it holds the service role, which bypasses RLS.
ALTER TABLE public.ad_insights   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_pull_runs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_accounts   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ad_insights_read ON public.ad_insights;
CREATE POLICY ad_insights_read  ON public.ad_insights  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS ad_pull_runs_read ON public.ad_pull_runs;
CREATE POLICY ad_pull_runs_read ON public.ad_pull_runs FOR SELECT TO anon, authenticated USING (true);

COMMENT ON TABLE public.ad_insights IS
  'One row per ad per day from the Meta API, written by the meta-pull Edge Function every '
  '3 hours. PK (date, ad_id). READ-ONLY to anon: writes are service-role only.';
COMMENT ON TABLE public.ad_pull_runs IS
  'Run log for the meta-pull. src/lib/adFreshness.ts derives the whole freshness state '
  'machine from these rows. READ-ONLY to anon.';
COMMENT ON VIEW public.ad_insights_resolved IS
  'ad_insights joined to ad_accounts on account_id — the view the app reads. The curated '
  'company/program/media_buyer travel with the spend row so no display-name join is needed; '
  'Meta rewrites display names and that join is what kept breaking.';
