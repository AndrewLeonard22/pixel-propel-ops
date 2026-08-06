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
-- ⚠️ WITH ONE DELIBERATE EXCEPTION, AND IT IS AN EXCEPTION TO THE *REJECTION*,
-- NEVER TO THE *STORAGE*: the two retired credential keys are stripped when
-- empty instead of refused, because the deployed frontend still sends them.
-- They are not on the allowlist and they can never be stored. See (a0).
-- ⇒ A guard whose correctness depends on a deploy landing first is a guard that
--   will be run in the wrong order. This one no longer has an order.
--
-- POPULATION THIS GUARD COVERS, STATED RATHER THAN IMPLIED:
--   (a0) THE TWO RETIRED CREDENTIAL KEYS — stripped if empty, REFUSED if not.
--   (a) TOP-LEVEL KEYS, EXACT CASE — via the allowlist.
--       A nested key (value->'airtable'->>'token') is NOT a top-level key and
--       the allowlist alone would not see it.
--   (b) THE ENTIRE SERIALISED VALUE — via credential-shaped pattern matching,
--       which DOES see nested keys, nested values, and any casing, because it
--       matches on the SHAPE OF THE SECRET rather than on the name of its key.
--   ⇒ (b) exists precisely because (a) is top-level and case-sensitive. Neither
--     covers the other; the pair is the guard.
--   ⇒ AND (b) IS WHY (a0)'s STRIP IS SAFE: a credential smuggled under one of
--     the retired names is caught by its SHAPE even if the strip ran first —
--     except it cannot get that far, because (a0) refuses a non-empty one.
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
    -- the RAW tab name, for the truncation detector (item ①). A tab name, not a secret.
    'adsRawTabName',
    'callCenterSheetUrl', 'callCenterSheetTab',
    'airtableBaseId', 'airtableTableName',
    'columnMappings', 'accountAliases', 'perfThresholds',
    'excludedCampaigns', 'setterBonusRates',
    'activeSetters', 'inactiveSetters',
    'showPausedAccounts', 'showChurnedAccounts', 'pausedThresholdDays',
    -- which Airtable "Lead Status" choices count as CLOSED WON (@raccoon's D1 build,
    -- Andrew: «yeah make it mappable»). His own Airtable option labels, not a secret.
    -- ⚠️ DELIBERATELY NOT IN protected_collections BELOW — a decision, not an omission.
    -- That guard refuses old_n > 0 -> new_n = 0, so at ONE ticked status the last untick
    -- becomes impossible AND the error tells the user to "remove them one at a time",
    -- advice that cannot be followed when you are already at one. A guard whose own
    -- instruction is unactionable trains people to route around it. The right defence is
    -- @raccoon's fallback (ABSENT => the hardcoded list), which makes an empty value
    -- harmless rather than unreachable.
    'closedWonStatuses'
  ];
  -- ⚠️ THE TWO CREDENTIAL FIELDS THE OLD FRONTEND STILL MODELS.
  -- These are NOT on the allowlist and never will be. They get SPECIAL handling below
  -- rather than a flat rejection, and the reason is a deployment fact, not a design taste:
  -- the DEPLOYED frontend still carries both fields and sends them on EVERY save (empty,
  -- but present). A flat rejection would make this migration correct only AFTER a frontend
  -- deploy nobody here controls — i.e. correct in exactly one ordering. Orderings get run
  -- in the wrong order; I proved that on myself by telling Andrew to apply this FIRST,
  -- ten times, which would have frozen every save on the page mid-restore.
  retired_credential_keys text[] := ARRAY['airtableToken', 'anthropicApiKey'];
  -- scalar fields whose loss takes the product down
  protected_keys text[] := ARRAY['googleSheetUrl', 'callCenterSheetUrl', 'airtableBaseId'];
  -- COLLECTIONS whose loss silently changes every number without breaking anything.
  -- @raccoon reproduced the mechanism (raccoon/stab ce0f31b): useData seeds `settings`
  -- from SYNCHRONOUS localStorage, the DB row replaces it LATER in a useEffect, and
  -- saveSettings is a FULL-OBJECT REPLACE — so one click on "exclude campaign" or
  -- "assign appointment" INSIDE THAT WINDOW writes the browser's copy over the shared
  -- row. That is a RACE, not a broken write, which is why it looked like an intruder.
  --
  -- ⚠️ THE SCALAR GUARD ABOVE ONLY CATCHES IT WHEN A CONNECTION FIELD IS ALSO BLANKED.
  -- If the stale browser copy happens to hold a populated googleSheetUrl, no scalar is
  -- blanked, the guard stays silent, AND THE CURATED LISTS ARE STILL DESTROYED — which
  -- is exactly the 32-exclusions loss nobody could attribute.
  protected_collections text[] := ARRAY[
    'excludedCampaigns', 'setterBonusRates', 'activeSetters',
    'inactiveSetters', 'accountAliases', 'columnMappings', 'perfThresholds'
  ];
  old_n int;
  new_n int;
BEGIN
  -- ══ EVERY-ROW GUARDS ══════════════════════════════════════════════════════
  --
  -- 🔴 THESE USED TO SIT INSIDE `IF NEW.key = 'app_settings'`, WHICH MEANT THE
  -- ENTIRE GUARD INSPECTED ONE ROW OUT OF TWO. `account_mappings` — 62 account
  -- mappings, the row that SURVIVED the wipe and the reason accountAliases came
  -- back — was completely unguarded: a write emptying it to `[]` sailed through,
  -- and so did a credential smuggled into any of its fields.
  --
  -- Found by auditing a teammate's conclusion that this trigger was COMPLETE.
  -- A guard scoped to the row you were thinking about is not a guard on the TABLE.

  -- (b) CREDENTIAL SHAPE — every row, every key, nested included, any casing.
  --     No key of this table may EVER hold something credential-shaped, whether
  --     or not anyone has thought about that key yet.
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
      'app_settings rejects a credential-shaped value in row "%": this table is readable '
      'by anon. Credentials belong in Edge Function secrets.', NEW.key
      USING ERRCODE = 'check_violation';
  END IF;

  -- (e) COLLAPSE GUARD — ANY row, not a named list of them.
  --     An UPDATE may not take a populated collection to empty. Keyed on the
  --     SHAPE OF THE WRITE rather than on an enumeration of rows, so a key
  --     nobody has created yet is protected the day it appears.
  --     (@raccoon's «stop driving off a list» applied one layer down.)
  IF TG_OP = 'UPDATE' THEN
    old_n := CASE jsonb_typeof(OLD.value)
               WHEN 'array'  THEN jsonb_array_length(OLD.value)
               WHEN 'object' THEN (SELECT count(*)::int FROM jsonb_object_keys(OLD.value))
               ELSE -1 END;
    new_n := CASE jsonb_typeof(NEW.value)
               WHEN 'array'  THEN jsonb_array_length(NEW.value)
               WHEN 'object' THEN (SELECT count(*)::int FROM jsonb_object_keys(NEW.value))
               ELSE -1 END;
    -- -1 means "not a collection" — a scalar row is not this guard's business.
    IF old_n > 0 AND new_n = 0 THEN
      RAISE EXCEPTION
        'refusing to empty row "%": it currently holds % entries and this write leaves none. '
        'That is the shape of a stale-copy overwrite, not an edit.', NEW.key, old_n
        USING ERRCODE = 'check_violation';
    END IF;

    -- (e2) BULK-DELETION GUARD — ARRAYS ONLY, AND THE «ONLY» IS LOad-BEARING.
    --
    -- @raccoon's bound on (e): it catches TOTAL collapse, so 62 -> 1 passes. The
    -- realistic clobber is not a wipe to empty — it is a stale browser copy holding
    -- an OLDER, still-populated list, which reverts silently.
    --
    -- ⭐ WHY ±1 IS SAFE HERE AND NOT A GUESS: every UI writer moves these lists by
    -- exactly ONE. Dashboard.tsx handleToggleExclude(campaignId) does
    --   current.includes(id) ? current.filter(x => x !== id) : [...current, id]
    -- and Settings.tsx removes a setter with a single-name filter. There is NO
    -- bulk-remove control anywhere in src/. So a drop of 2+ in ONE write is not a
    -- user action — it is the signature of an overwrite.
    --
    -- ⛔ ARRAYS ONLY, because (a0) STRIPS up to two keys from the app_settings
    -- OBJECT. Applying a magnitude rule to objects would compare a 17-key OLD
    -- against a 15-key NEW and reject EVERY SAVE FROM THE DEPLOYED FRONTEND —
    -- the exact ordering defect this file already shipped once. Objects keep the
    -- total-collapse rule above; only arrays get the magnitude rule.
    -- ⚖️ RESIDUAL, STATED EXACTLY — a single removal (62 -> 61) is ALLOWED.
    --
    -- @raccoon censused all four protected arrays and the residual is SMALLER than
    -- "any -1 slips through":
    --     excludedCampaigns  Dashboard:742  filter-remove-one   ⇒ -1 IS legitimate
    --     inactiveSetters    Settings:196   ±1                  ⇒ -1 IS legitimate
    --     setterBonusRates   Settings:203-213 index-assign/append — NO REMOVAL PATH
    --     accountAliases     Settings:77/:217, Dashboard:550     — NO REMOVAL PATH
    -- ⇒ for the last two, a decrease of ONE is ALREADY an overwrite signature, and
    --   this -2 rule is looser than the data allows.
    --
    -- ⛔ DELIBERATELY NOT TIGHTENED, AND NOT FOR LACK OF TIME. A per-array threshold
    -- requires NAMING setterBonusRates and accountAliases — a hand-maintained
    -- registry, which is exactly the enumeration removed from this guard one commit
    -- earlier, and exactly why the original version could not see account_mappings
    -- at all. "Can only grow" is a property of the UI CODE, not of the stored VALUE,
    -- so there is no shape-keyed way to express it here. A numerically tighter guard
    -- built on a list would be a structurally weaker one.
    -- ⇒ If this is ever tightened, tighten it in the CLIENT, where the writers live.
    IF jsonb_typeof(OLD.value) = 'array' AND jsonb_typeof(NEW.value) = 'array'
       AND old_n > 0 AND new_n < old_n - 1 THEN
      RAISE EXCEPTION
        'refusing to remove % entries from row "%" in one write (% -> %): every control '
        'in this app changes these lists one at a time, so a bulk removal is the shape of '
        'a stale-copy overwrite. Remove them individually if intended.',
        old_n - new_n, NEW.key, old_n, new_n
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- ══ THE app_settings ROW SPECIFICALLY ═════════════════════════════════════
  -- Only this row carries a config OBJECT with named fields; the others hold arrays.
  IF NEW.key = 'app_settings' THEN

    -- (a0) THE TWO RETIRED CREDENTIAL KEYS — ASYMMETRIC ON PURPOSE.
    --
    --   EMPTY     -> STRIPPED silently. This is the deployed frontend saying "I still have
    --                a box for this and it is blank". Nothing is lost and nothing leaks, so
    --                refusing would only break a save that carries no secret.
    --   NON-EMPTY -> REJECTED, loudly, naming where the value belongs. A silent drop here
    --                would be worse than either: someone types a real token, sees the page
    --                say saved, and never learns it went nowhere — so they retype it, and
    --                the product stays broken for a reason the UI has hidden from them.
    --
    -- ⇒ The asymmetry is what makes this migration safe to apply at ANY point in the
    --   sequence, which is the property it should have had from the start.
    FOREACH k IN ARRAY retired_credential_keys LOOP
      IF NEW.value ? k THEN
        IF coalesce(NEW.value ->> k, '') <> '' THEN
          RAISE EXCEPTION
            'app_settings refuses to store "%": this row is world-readable, so credentials '
            'now live in Edge Function secrets. Set AIRTABLE_TOKEN / ANTHROPIC_API_KEY on '
            'the functions instead — the browser must never hold one.', k
            USING ERRCODE = 'check_violation';
        END IF;
        NEW.value := NEW.value - k;
      END IF;
    END LOOP;

    -- (a) ALLOWLIST: any OTHER undeclared top-level key is refused.
    FOR k IN SELECT jsonb_object_keys(NEW.value) LOOP
      IF NOT (k = ANY (allowed_config_keys)) THEN
        RAISE EXCEPTION
          'app_settings rejects undeclared key "%": this row is readable by anon, so every '
          'field must be declared in ALLOWED_CONFIG_KEYS before it can be stored', k
          USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;

    -- (b) MOVED OUT — the credential-shape check now runs on EVERY row, above.
    --     It was here, inside this `IF`, which is exactly how account_mappings
    --     ended up with no shape check at all.

    -- (c) an update may not blank a connection field that currently has a value.
    IF TG_OP = 'UPDATE' THEN
      FOREACH k IN ARRAY protected_keys LOOP
        IF coalesce(OLD.value ->> k, '') <> '' AND coalesce(NEW.value ->> k, '') = '' THEN
          RAISE EXCEPTION
            'refusing to blank "%": it currently has a value. Clear it explicitly if intended.', k
            USING ERRCODE = 'check_violation';
        END IF;
      END LOOP;

      -- (d) an update may not EMPTY a collection that currently has members.
      --     This is the half (c) cannot see: a stale-copy clobber that keeps the
      --     connection strings but drops the curated lists passes (c) silently.
      FOREACH k IN ARRAY protected_collections LOOP
        old_n := CASE jsonb_typeof(OLD.value -> k)
                   WHEN 'array'  THEN jsonb_array_length(OLD.value -> k)
                   WHEN 'object' THEN (SELECT count(*)::int FROM jsonb_object_keys(OLD.value -> k))
                   ELSE 0 END;
        new_n := CASE jsonb_typeof(NEW.value -> k)
                   WHEN 'array'  THEN jsonb_array_length(NEW.value -> k)
                   WHEN 'object' THEN (SELECT count(*)::int FROM jsonb_object_keys(NEW.value -> k))
                   ELSE 0 END;
        IF old_n > 0 AND new_n = 0 THEN
          RAISE EXCEPTION
            'refusing to empty "%": it currently holds % entries. This is the shape of a '
            'stale-copy overwrite, not an edit. Remove them one at a time if intended.', k, old_n
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
