-- =====================================================================
-- THE STABLE PATH FROM account_id TO THE AIRTABLE CLIENT NAME.
--
-- WHY A TABLE AND NOT A COLUMN ON ad_accounts.
-- The join audit sketched `ad_accounts.airtable_name text`. Measured against the live
-- Airtable (704 records) and the live campaign-id bridge, that shape cannot hold the data:
-- account_id 596293242787360 (Backyard Paradiso) legitimately serves FOUR Airtable client
-- names -- 'New Jersey l Backyard Paradiso', 'Naples l Backyard Paradiso', 'Backyard
-- Paradiso Colorado LLC', 'San Antonio l Backyard Paradiso'. A scalar column would keep one
-- and silently drop three, detaching ~130 appointments. The relation is one account to MANY
-- names, so it gets its own table.
--
-- THE KEY DIRECTION THAT MATTERS is name -> account: an appointment arrives carrying a
-- client NAME and needs an account. That direction IS a function, so the normalised name is
-- the PRIMARY KEY. One client name is claimed by exactly one account, enforced by the
-- database rather than by whichever row a loop happened to read last.
--
-- ⚠️ airtable_name IS A JOIN KEY, NOT A DISPLAY LABEL. It must equal what Airtable's
-- "Client Name" field literally contains, including the odd spacing and the lowercase "l"
-- separators. "Cleaning" it detaches appointments while fixing nothing visible. Display
-- names live in ad_accounts.company_name.
-- =====================================================================

CREATE TABLE IF NOT EXISTS ad_account_airtable_names (
  -- lower(btrim(airtable_name)). The join key, and the PK: a client name belongs to one
  -- account or to none. Stored rather than computed so the PK is the thing readers match on.
  airtable_name_key text PRIMARY KEY,
  -- Exactly as Airtable renders it. Kept so a human can see what is being matched.
  airtable_name     text NOT NULL,
  -- Meta's immutable account id. THE identity. Meta rewrites display names; it does not
  -- rewrite this. ON UPDATE CASCADE because the FK, not a name, is what survives a rename.
  account_id        text NOT NULL REFERENCES ad_accounts(account_id) ON UPDATE CASCADE,
  -- How this row was established, so a later reader can judge it rather than trust it.
  evidence          text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_account_airtable_names_key_is_normalised
    CHECK (airtable_name_key = lower(btrim(airtable_name))),
  CONSTRAINT ad_account_airtable_names_name_not_blank
    CHECK (btrim(airtable_name) <> '')
);

CREATE INDEX IF NOT EXISTS ad_account_airtable_names_account_id_idx
  ON ad_account_airtable_names (account_id);

COMMENT ON TABLE ad_account_airtable_names IS
  'JOIN KEYS from Airtable "Client Name" to Meta account_id. One account has MANY names. '
  'These are match keys, NOT display labels -- never "clean" them. Display: ad_accounts.company_name.';
COMMENT ON COLUMN ad_account_airtable_names.airtable_name IS
  'Verbatim Airtable "Client Name". Editing it to look tidier DETACHES that client''s appointments.';

ALTER TABLE ad_account_airtable_names ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ad_account_airtable_names_read ON ad_account_airtable_names;
CREATE POLICY ad_account_airtable_names_read
  ON ad_account_airtable_names FOR SELECT TO anon, authenticated USING (true);

-- ⛔ NO WRITE POLICY, AND THAT IS THE POINT. Superseded 2026-08-12 -- see
-- 20260812000100_airtable_names_read_only.sql for the drop applied to the live project.
--
-- This migration originally granted `FOR ALL TO anon, authenticated USING (true)`, copying
-- the posture of ad_accounts and app_settings. Measured: THE APP NEVER WRITES THIS TABLE.
-- accountRegistry.ts:315 selects from it and nothing anywhere inserts, updates or deletes a
-- row. So the grant bought nothing and cost the one thing this table is for.
--
-- ⚠️ WHAT MAKES IT DIFFERENT FROM ITS NEIGHBOURS. ad_accounts holds LABELS -- rewrite
-- company_name and a heading is wrong until someone fixes it. This table holds the JOIN KEYS
-- that decide which client every appointment belongs to. The publishable key is compiled
-- into the bundle and is public to every visitor by design, so an anon write grant here
-- means any visitor can silently re-point 704 appointments at the wrong accounts, and the
-- result renders as ordinary numbers with no error anywhere. The cutover moved attribution
-- onto this table, which is exactly why its blast radius stopped matching its neighbours'.
--
-- Seeding and maintenance run with the service role, which bypasses RLS, so nothing that
-- legitimately writes here loses the ability to.
INSERT INTO ad_account_airtable_names (airtable_name_key, airtable_name, account_id, evidence)
VALUES
  ('new jersey l backyard paradiso','New Jersey l Backyard Paradiso','596293242787360','campaign-id bridge: strictly dominant account across >=2 evidenced appointments, measured 2026-08-11'),
  ('finer lawn & landscaping llc','Finer Lawn & Landscaping LLC','844179521641091','campaign-id bridge: strictly dominant account across >=2 evidenced appointments, measured 2026-08-11'),
  ('naples l backyard paradiso','Naples l Backyard Paradiso','596293242787360','campaign-id bridge: strictly dominant account across >=2 evidenced appointments, measured 2026-08-11'),
  ('backyard paradiso colorado llc','Backyard Paradiso Colorado LLC','596293242787360','campaign-id bridge: strictly dominant account across >=2 evidenced appointments, measured 2026-08-11'),
  ('md property maintenance and landscaping','MD Property Maintenance and Landscaping','1532987181109768','campaign-id bridge: strictly dominant account across >=2 evidenced appointments, measured 2026-08-11'),
  ('san antonio l backyard paradiso','San Antonio l Backyard Paradiso','596293242787360','campaign-id bridge: strictly dominant account across >=2 evidenced appointments, measured 2026-08-11'),
  ('smoky top contractor','Smoky Top Contractor','27535386859408587','campaign-id bridge: strictly dominant account across >=2 evidenced appointments, measured 2026-08-11'),
  ('premier custom decks & design','Premier Custom Decks & Design','825013296825825','campaign-id bridge: strictly dominant account across >=2 evidenced appointments, measured 2026-08-11'),
  ('patio perfections inc','Patio Perfections Inc','988167593730831','campaign-id bridge: strictly dominant account across >=2 evidenced appointments, measured 2026-08-11'),
  ('pergola shades','Pergola Shades','1433845298112329','campaign-id bridge: strictly dominant account across >=2 evidenced appointments, measured 2026-08-11'),
  ('transforming landscape co.','Transforming Landscape Co.','740053605582510','campaign-id bridge: strictly dominant account across >=2 evidenced appointments, measured 2026-08-11'),
  ('z pool','Z Pool','2184865452337756','campaign-id bridge: strictly dominant account across >=2 evidenced appointments, measured 2026-08-11'),
  ('pacific outdoor living','Pacific Outdoor Living','477252292686194','campaign-id bridge: strictly dominant account across >=2 evidenced appointments, measured 2026-08-11'),
  ('archadeck','Archadeck','1463834608824526','campaign-id bridge: strictly dominant account across >=2 evidenced appointments, measured 2026-08-11'),
  ('buddha builders llc','Buddha Builders LLC','1275764984481829','campaign-id bridge: strictly dominant account across >=2 evidenced appointments, measured 2026-08-11'),
  ('summer general construction llc','Summer General Construction LLC','805765432032132','campaign-id bridge: strictly dominant account across >=2 evidenced appointments, measured 2026-08-11')
ON CONFLICT (airtable_name_key) DO UPDATE
  SET account_id = EXCLUDED.account_id, airtable_name = EXCLUDED.airtable_name, evidence = EXCLUDED.evidence;