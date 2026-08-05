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
-- WHY SELECT/INSERT/UPDATE STAY OPEN, DELIBERATELY:
--   This application has NO authentication of any kind — no login route, no
--   session, no getUser() call anywhere in src/. The anon role is its ONLY
--   identity. A policy that excludes anon excludes the application itself and
--   the dashboard goes dark. So the row is not made unreadable; it is made
--   SAFE TO HOLD, by refusing to store anything that is not declared config.
--
--   ⚠️ RESIDUAL, AND IT IS ANDREW'S TO ACCEPT, NOT A FOOTNOTE: anon can still
--   CHANGE a value it is allowed to hold. A stranger can repoint googleSheetUrl
--   at a different sheet or rewrite the account mappings. The guard below stops
--   BLANKING a connection field; it does not stop CHANGING one. Closing that
--   requires authentication, which this app does not have.
-- ============================================================================

-- 1. ── strip the credentials out of the stored row ──────────────────────────
UPDATE public.app_settings
   SET value = value - 'airtableToken' - 'anthropicApiKey'
 WHERE key = 'app_settings'
   AND (value ? 'airtableToken' OR value ? 'anthropicApiKey');

-- 2. ── drop the permissive policies ─────────────────────────────────────────
DROP POLICY IF EXISTS "Allow public read"   ON public.app_settings;
DROP POLICY IF EXISTS "Allow public insert" ON public.app_settings;
DROP POLICY IF EXISTS "Allow public update" ON public.app_settings;
DROP POLICY IF EXISTS "Allow public delete" ON public.app_settings;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- 3. ── the guard ────────────────────────────────────────────────────────────
--
-- ⭐ THIS IS AN ALLOWLIST, NOT A BLOCKLIST, AND THAT INVERSION IS THE POINT.
--
-- The first version of this guard held a list of FORBIDDEN keys
-- (airtableToken, anthropicApiKey). That is a HAND-MAINTAINED REGISTRY: add a
-- metaAccessToken or a ghlToken tomorrow and it walks straight in, because the
-- safe behaviour required somebody to REMEMBER to register it. A new field
-- must FAIL until it is declared, not PASS until someone remembers it.
--
-- So: every top-level key must be on ALLOWED_CONFIG_KEYS. Adding a legitimate
-- setting now requires editing this list in a migration — deliberately a small
-- amount of friction in exchange for a door that cannot be left open by
-- omission.
--
-- POPULATION THIS GUARD COVERS, STATED RATHER THAN IMPLIED:
--   (a) TOP-LEVEL KEYS, EXACT CASE — via the allowlist.
--       A nested key (value->'airtable'->>'token') is NOT a top-level key and
--       the allowlist alone would not see it.
--   (b) THE ENTIRE SERIALISED VALUE — via credential-shaped pattern matching,
--       which DOES see nested keys, nested values, and any casing, because it
--       matches on the SHAPE OF THE SECRET rather than on the name of its key.
--   ⇒ (b) exists precisely because (a) is top-level and case-sensitive. Neither
--     covers the other; the pair is the guard.
--
CREATE OR REPLACE FUNCTION public.app_settings_reject_unsafe()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k text;
  serialised text;
  -- Every key the application is permitted to store. ANYTHING ELSE IS REJECTED.
  allowed_config_keys text[] := ARRAY[
    'googleSheetUrl', 'googleSheetTab',
    'callCenterSheetUrl', 'callCenterSheetTab',
    'airtableBaseId', 'airtableTableName',
    'columnMappings', 'accountAliases', 'perfThresholds',
    'excludedCampaigns', 'setterBonusRates',
    'activeSetters', 'inactiveSetters',
    'showPausedAccounts', 'showChurnedAccounts', 'pausedThresholdDays'
  ];
  -- fields whose loss takes the product down or silently changes every number
  protected_keys text[] := ARRAY['googleSheetUrl', 'callCenterSheetUrl', 'airtableBaseId'];
BEGIN
  -- Only the settings row carries a config object; other keys hold arrays.
  IF NEW.key = 'app_settings' THEN

    -- (a) ALLOWLIST: an undeclared top-level key is refused.
    FOR k IN SELECT jsonb_object_keys(NEW.value) LOOP
      IF NOT (k = ANY (allowed_config_keys)) THEN
        RAISE EXCEPTION
          'app_settings rejects undeclared key "%": this row is readable by anon, so every '
          'field must be declared in ALLOWED_CONFIG_KEYS before it can be stored', k
          USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;

    -- (b) SHAPE CHECK over the WHOLE value, nested included, case-insensitive.
    --     Catches a credential smuggled under an allowed key, or nested, or
    --     under a differently-cased name — none of which (a) can see.
    serialised := NEW.value::text;
    IF serialised ~* 'sk-ant-[A-Za-z0-9_-]{20}'                    -- Anthropic
       OR serialised ~  'pat[A-Za-z0-9]{14}\.[A-Za-z0-9]{40}'      -- Airtable PAT
       OR serialised ~  '\mkey[A-Za-z0-9]{14}\M'                   -- Airtable legacy
       OR serialised ~  '\mgh[pousr]_[A-Za-z0-9]{30}'              -- GitHub
       OR serialised ~  '\mAKIA[0-9A-Z]{16}\M'                     -- AWS
       OR serialised ~  '\mAIza[0-9A-Za-z_-]{30}'                  -- Google API
       OR serialised ~  '\mxox[baprs]-[0-9A-Za-z-]{10}'            -- Slack
       OR serialised ~  'eyJ[A-Za-z0-9_-]{10}\.eyJ[A-Za-z0-9_-]{10}\.'  -- JWT
       OR serialised ~  '-----BEGIN [A-Z ]*PRIVATE KEY-----'       -- PEM
    THEN
      RAISE EXCEPTION
        'app_settings rejects a credential-shaped value: this row is readable by anon. '
        'Credentials belong in server-side secrets.'
        USING ERRCODE = 'check_violation';
    END IF;

    -- (c) an update may not blank a connection field that currently has a value.
    IF TG_OP = 'UPDATE' THEN
      FOREACH k IN ARRAY protected_keys LOOP
        IF coalesce(OLD.value ->> k, '') <> '' AND coalesce(NEW.value ->> k, '') = '' THEN
          RAISE EXCEPTION
            'refusing to blank "%": it currently has a value. Clear it explicitly if intended.', k
            USING ERRCODE = 'check_violation';
        END IF;
      END LOOP;
    END IF;

  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_settings_reject_unsafe_trg ON public.app_settings;
CREATE TRIGGER app_settings_reject_unsafe_trg
  BEFORE INSERT OR UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.app_settings_reject_unsafe();

-- 4. ── the replacement policies ─────────────────────────────────────────────
CREATE POLICY "app config is readable"
  ON public.app_settings FOR SELECT USING (true);

CREATE POLICY "app config is insertable"
  ON public.app_settings FOR INSERT WITH CHECK (true);

CREATE POLICY "app config is updatable"
  ON public.app_settings FOR UPDATE USING (true) WITH CHECK (true);

-- DELETE: no policy, on purpose. With RLS enabled, absence denies it — and an
-- absent policy cannot be edited open by accident the way a permissive one can.

COMMENT ON TABLE public.app_settings IS
  'Non-secret application configuration. READABLE AND WRITABLE BY ANON BY DESIGN: this app '
  'has no authentication, so the anon role is the application. Every storable key is '
  'declared in app_settings_reject_unsafe (ALLOWLIST — an undeclared key is refused), and '
  'credential-shaped values are rejected anywhere in the object including nested. '
  'RESIDUAL: anon can still CHANGE an allowed value. Closing that needs authentication.';
