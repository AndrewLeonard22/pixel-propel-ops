-- =====================================================================
-- 🔴 THE ATTRIBUTION JOIN KEYS WERE ANON-WRITABLE. Measured 2026-08-12, applied same day.
--
-- `ad_account_airtable_names` was created with the same policy pair as `ad_accounts` and
-- `app_settings`: read to anon, and `FOR ALL TO anon, authenticated USING (true)`. Copying
-- the neighbours' posture was the mistake, because this table is not like its neighbours.
--
-- WHAT IT ACTUALLY GUARDS. `ad_accounts.company_name` is a LABEL: corrupt it and a heading
-- reads wrong until someone notices. This table is the FUNCTION `Airtable "Client Name" ->
-- account_id` -- the stable path the cutover put every appointment through, in place of the
-- display-name join that Meta's renames kept breaking. Rewrite a row here and appointments
-- silently attach to the wrong client. There is no error, no banner and no zero: the
-- dashboard renders confident numbers for the wrong accounts, which is the exact failure
-- shape the cutover existed to end.
--
-- WHY THE GRANT WAS WORTH NOTHING TO GIVE UP. The app NEVER writes this table -- measured
-- across all of src/: one `.select()` in accountRegistry.ts and no insert, update, upsert or
-- delete anywhere. The write policy was unused surface from the day it was written.
--
-- ⚠️ THE PUBLISHABLE KEY IS PUBLIC BY DESIGN. It is compiled into the client bundle (see the
-- note in .gitignore). "anon" is therefore not a trusted role, it is every visitor, so an
-- anon write grant is a public write grant.
--
-- WHAT STILL WRITES. Seeding and maintenance use the service role, which bypasses RLS
-- entirely. Nothing that legitimately writes here loses anything.
--
-- ⛔ IF A UI EVER NEEDS TO EDIT THESE MAPPINGS, do not restore this policy. Put the edit
-- behind a definer function or the service role, so that the thing granted is "change one
-- mapping", not "rewrite the client attribution table".
-- =====================================================================

DROP POLICY IF EXISTS ad_account_airtable_names_write ON ad_account_airtable_names;

-- Read stays. The registry has to be readable by the browser or attribution cannot happen.
DROP POLICY IF EXISTS ad_account_airtable_names_read ON ad_account_airtable_names;
CREATE POLICY ad_account_airtable_names_read
  ON ad_account_airtable_names FOR SELECT TO anon, authenticated USING (true);

COMMENT ON TABLE ad_account_airtable_names IS
  'JOIN KEYS from Airtable "Client Name" to Meta account_id. One account has MANY names. '
  'These are match keys, NOT display labels -- never "clean" them. Display: ad_accounts.company_name. '
  'READ-ONLY to anon/authenticated: writes are service-role only, because a rewritten row '
  're-points appointments at the wrong client and renders as ordinary numbers.';
