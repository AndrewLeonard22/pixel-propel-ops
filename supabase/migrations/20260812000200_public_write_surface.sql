-- ============================================================================
-- 🔴 THE PUBLIC WRITE SURFACE, NARROWED TO WHAT THE APP ACTUALLY DOES.
-- Measured and applied 2026-08-12 against project mlwoztsytapxjgfldyzv — the project
-- adsdata.socialworkspro.com actually talks to (verified in the live bundle, which contains
-- `mlwoztsytapxjgfldyzv` and NOT `tclghhfozyfsdkqyaftc`).
--
-- ⛔ WHY THIS EXISTS AT ALL: THE COMMITTED LOCKDOWN IS NOT IN FORCE HERE.
-- `20260806000000_lock_down_app_settings.sql` replaced the wide-open policies with
-- SELECT/INSERT/UPDATE and no DELETE, and added the `app_settings_reject_unsafe` allowlist
-- trigger. Measured in THIS project: the trigger does not exist, the function does not
-- exist, and `app_settings` carries a single policy `app_settings_rw` — `FOR ALL TO anon,
-- authenticated USING (true) WITH CHECK (true)`. That migration was applied to the OLD
-- project. This one was created later and never received it. A migration that ran somewhere
-- else is not a control here, and "we locked that down" was true of a database nobody uses.
--
-- ⚠️ WHAT "anon" MEANS HERE, because it is the whole reason any of this matters: the
-- publishable key is compiled into the client bundle by design (see .gitignore). anon is not
-- a role, it is every visitor. Read `FOR ALL TO anon USING (true)` as "the open internet may
-- rewrite and delete this table".
--
-- MEASURED, NOT ASSUMED — every write the application performs, across all of src/:
--     src/lib/config.ts:106            app_settings   .upsert()   -> INSERT + UPDATE
--     src/components/settings/AccountsTable.tsx:335
--                                      ad_accounts    .update()   -> UPDATE
--   and nothing else. No .delete() anywhere. No insert into ad_accounts (the meta-pull Edge
--   Function does that with the service role, which bypasses RLS).
-- ⇒ DELETE was granted to the internet and used by nobody. Removing it costs the product
--   nothing and removes "a stranger wipes the settings row / the account curation" from the
--   list of things that can happen. Same for INSERT on ad_accounts.
--
-- ⛔ WHAT THIS DELIBERATELY DOES **NOT** DO, so the next reader does not mistake it for the
-- whole lockdown: it does not add the allowlist trigger from 20260806000000, and that
-- migration MUST NOT be applied here verbatim. The cutover RETIRED googleSheetUrl,
-- googleSheetTab and adsRawTabName (see AppSettings in src/lib/types.ts), while that
-- trigger's guard (c) refuses any UPDATE that blanks `googleSheetUrl` when the stored row
-- still has one. The live row still has one. Applying it as written would make every
-- settings autosave in production refuse itself — the exact failure its own docblock says
-- took production down once. Porting it needs the retired keys removed from
-- `protected_keys` and from `allowed_config_keys` in the same change.
--
-- ⚠️ RESIDUAL, UNCHANGED AND STILL ANDREW'S TO ACCEPT: anon can still CHANGE a value it is
-- allowed to hold. This app has no authentication of any kind — no login route, no session,
-- no getUser() in src/ — so the anon role IS the application, and a policy that excludes anon
-- takes the dashboard dark. Closing that needs auth, not a policy.
-- ============================================================================

-- 1. ── app_settings: SELECT + INSERT + UPDATE, never DELETE ─────────────────
--      The policy SHAPE the committed lockdown specifies, restored here.
DROP POLICY IF EXISTS app_settings_rw ON public.app_settings;
DROP POLICY IF EXISTS "app config is readable"  ON public.app_settings;
DROP POLICY IF EXISTS "app config is insertable" ON public.app_settings;
DROP POLICY IF EXISTS "app config is updatable"  ON public.app_settings;

CREATE POLICY "app config is readable"
  ON public.app_settings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "app config is insertable"
  ON public.app_settings FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "app config is updatable"
  ON public.app_settings FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
-- DELETE: no policy, on purpose. With RLS enabled, absence denies it — and an absent policy
-- cannot be edited open by accident the way a permissive one can.

-- 2. ── ad_accounts: SELECT + UPDATE. The settings screen edits rows; it never creates or
--      removes them, and the pull that does uses the service role.
DROP POLICY IF EXISTS ad_accounts_write ON public.ad_accounts;
DROP POLICY IF EXISTS ad_accounts_read  ON public.ad_accounts;

CREATE POLICY ad_accounts_read
  ON public.ad_accounts FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY ad_accounts_update
  ON public.ad_accounts FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
-- INSERT / DELETE: no policy. `ad_accounts` is the curation — company_name, program,
-- media_buyer — and it is what every dashboard heading and every program rollup reads.

COMMENT ON TABLE public.ad_accounts IS
  'Meta ad accounts and their curation (company_name, program, media_buyer, status). '
  'anon may SELECT and UPDATE, because the settings screen has no authentication to offer. '
  'anon may NOT INSERT or DELETE: rows are created by the meta-pull Edge Function under the '
  'service role, and nothing in the app has ever removed one.';

-- 3. ── the two backup tables had RLS DISABLED in a PostgREST-exposed schema ──
--
-- 🔴 MEASURED, AND I PROVED IT THE EXPENSIVE WAY. `ad_accounts_backup_20260811` and
-- `ad_accounts_backup_20260812_curation` were created by `CREATE TABLE ... AS SELECT` during
-- this night's work. `CREATE TABLE AS` does not inherit RLS, and Supabase grants anon on the
-- public schema, so both were readable AND DELETABLE over plain HTTP with the key that ships
-- in the bundle. A single unauthenticated DELETE emptied both — that was me, probing the
-- hole, and both are now 0 rows with no PITR and no backups on this project to restore from.
-- The LIVE `ad_accounts` was untouched (52 rows, verified) and is snapshotted below.
--
-- ⇒ THE LESSON THAT OUTLIVES THE TABLES: a snapshot taken with `CREATE TABLE AS` is not a
--   backup, it is a second copy of production with the security removed. RLS must be turned
--   on in the same statement that creates it.
ALTER TABLE IF EXISTS public.ad_accounts_backup_20260811 ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ad_accounts_backup_20260812_curation ENABLE ROW LEVEL SECURITY;
-- No policies on either: with RLS on and no policy, anon sees and touches nothing.

COMMENT ON TABLE public.ad_accounts_backup_20260811 IS
  'EMPTIED 2026-08-12 by an unauthenticated DELETE while probing the missing RLS on this '
  'table. Contents unrecoverable (no PITR on this project). Kept, empty, so the loss is on '
  'the record rather than dropped out of sight. Do not read it as "ad_accounts was empty".';
COMMENT ON TABLE public.ad_accounts_backup_20260812_curation IS
  'EMPTIED 2026-08-12 by an unauthenticated DELETE while probing the missing RLS on this '
  'table. Contents unrecoverable (no PITR on this project). Superseded by '
  'ad_accounts_snapshot_20260812_0545, which is created WITH row level security enabled.';

-- 4. ── a replacement snapshot, secured at birth ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.ad_accounts_snapshot_20260812_0545 AS
  SELECT * FROM public.ad_accounts;
ALTER TABLE public.ad_accounts_snapshot_20260812_0545 ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ad_accounts_snapshot_20260812_0545 IS
  'Point-in-time copy of ad_accounts curation, 2026-08-12 05:45Z, 52 rows. RLS ON with no '
  'policies: service role only. Replaces the two backup tables that had RLS off.';
