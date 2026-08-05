-- ============================================================================
-- app_settings lockdown
--
-- REPLACES the four policies created by 20260228080106, which enabled RLS and
-- then granted anon SELECT / INSERT / UPDATE / DELETE with USING (true). The
-- gate was enabled and governed nothing: the Supabase publishable key ships in
-- the browser bundle and is in a public repo, so "anon" is the open internet.
-- A live Airtable PAT and a live Anthropic API key were readable from that row
-- by anyone, with no credential and no app access required.
--
-- WHY SELECT STAYS OPEN, DELIBERATELY:
--   This application has NO authentication of any kind — no login route, no
--   session, no getUser() call anywhere in src/. The anon role is its ONLY
--   identity. A policy that excludes anon excludes the application itself and
--   the dashboard goes dark. So the row is not made unreadable; it is made
--   SAFE TO READ, by removing the secrets from it and refusing to accept them
--   back (see the trigger below).
--
-- WHAT CHANGES:
--   1. the two credential fields are stripped from the stored settings
--   2. the four USING (true) policies are dropped
--   3. SELECT / INSERT / UPDATE are re-granted to anon (the app needs all three)
--   4. DELETE is NOT re-granted — nothing in the application deletes a settings
--      row, and the previous policy allowed any visitor to destroy the config
--   5. a trigger enforces what a policy cannot express:
--        (a) a credential field may never be stored, by anyone, ever
--        (b) an update may not blank a connection field that was set
--
--   (b) exists because on 2026-08-05T22:18:48Z a single write emptied every
--   connection field and both tokens, took the production dashboard down, and
--   destroyed 32 excluded-campaign ids that had no other copy. The table has no
--   audit trail, so the write could not even be attributed. This is Andrew's
--   "suspicious or incomplete refreshes must not replace valid data", applied
--   to settings rather than to Windsor rows.
--
-- ROTATION: credentials now live in server-side secrets. Rotating one is a
-- secrets change — no schema change, no migration, no code change.
-- ============================================================================

-- 1. ── strip the credentials out of the stored row ──────────────────────────
--    Idempotent: `-` on a jsonb object is a no-op when the key is absent.
UPDATE public.app_settings
   SET value = value - 'airtableToken' - 'anthropicApiKey'
 WHERE key = 'app_settings'
   AND (value ? 'airtableToken' OR value ? 'anthropicApiKey');

-- 2. ── drop the permissive policies ─────────────────────────────────────────
DROP POLICY IF EXISTS "Allow public read"   ON public.app_settings;
DROP POLICY IF EXISTS "Allow public insert" ON public.app_settings;
DROP POLICY IF EXISTS "Allow public update" ON public.app_settings;
DROP POLICY IF EXISTS "Allow public delete" ON public.app_settings;

-- RLS remains ENABLED from the original migration; assert it rather than assume.
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- 3. ── the guard, before the policies that rely on it ───────────────────────
CREATE OR REPLACE FUNCTION public.app_settings_reject_unsafe()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k                text;
  credential_keys  text[] := ARRAY['airtableToken', 'anthropicApiKey'];
  -- fields whose loss takes the product down or silently changes every number
  protected_keys   text[] := ARRAY['googleSheetUrl', 'callCenterSheetUrl', 'airtableBaseId'];
BEGIN
  -- (a) a credential may never be stored in this table, by anyone, ever.
  FOREACH k IN ARRAY credential_keys LOOP
    IF NEW.value ? k THEN
      RAISE EXCEPTION
        'app_settings must not carry credential field "%": this table is readable by anon', k
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  -- (b) an update may not blank a connection field that currently has a value.
  IF TG_OP = 'UPDATE' THEN
    FOREACH k IN ARRAY protected_keys LOOP
      IF coalesce(OLD.value ->> k, '') <> '' AND coalesce(NEW.value ->> k, '') = '' THEN
        RAISE EXCEPTION
          'refusing to blank "%": it currently has a value. Clear it explicitly if intended.', k
          USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_settings_reject_unsafe_trg ON public.app_settings;
CREATE TRIGGER app_settings_reject_unsafe_trg
  BEFORE INSERT OR UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.app_settings_reject_unsafe();

-- 4. ── the replacement policies ─────────────────────────────────────────────
--    SELECT / INSERT / UPDATE for anon, because the app has no other identity.
--    DELETE is deliberately absent: with RLS enabled and no policy, it is denied.
CREATE POLICY "app config is readable"
  ON public.app_settings FOR SELECT USING (true);

CREATE POLICY "app config is insertable"
  ON public.app_settings FOR INSERT WITH CHECK (true);

CREATE POLICY "app config is updatable"
  ON public.app_settings FOR UPDATE USING (true) WITH CHECK (true);

-- no DELETE policy, on purpose.

COMMENT ON TABLE public.app_settings IS
  'Non-secret application configuration. READABLE BY ANON BY DESIGN: this app has no '
  'authentication, so the anon role is the application. NEVER store a credential here — '
  'the trigger app_settings_reject_unsafe rejects it. Credentials live in server-side secrets.';
