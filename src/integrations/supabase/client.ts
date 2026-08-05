// Originally generated. Edited deliberately — see the note below before regenerating.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/**
 * A MISSING ENV VAR MUST DEGRADE, NOT ANNIHILATE.
 *
 * This module used to call createClient() with the raw values at module scope. When
 * `.env` became correctly untracked, `createClient` threw "supabaseUrl is required"
 * DURING IMPORT — and because config.ts imports this, and everything imports config.ts,
 * the whole application died before React mounted. Measured: #root 0 bytes, white screen,
 * zero requests. The suite showed the same failure until it was stubbed.
 *
 * A config-loading problem should surface as "settings could not be loaded", which the
 * app already handles by falling back to localStorage. It should not be an import-time
 * crash that takes the entire dashboard with it, because the failure then names Supabase
 * rather than the missing variable, and NOTHING renders to say so.
 *
 * So: fall back to a syntactically valid placeholder origin that resolves to nothing.
 * Requests fail as ordinary network errors, which the callers already catch.
 */
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

if (!isSupabaseConfigured && typeof console !== 'undefined') {
  console.error(
    'Supabase is not configured: VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are missing. ' +
      'Copy .env.example to .env. Saved settings cannot be loaded from the database; ' +
      'the app will fall back to locally stored settings.',
  );
}

export const supabase = createClient<Database>(
  SUPABASE_URL || 'https://unconfigured.invalid',
  SUPABASE_PUBLISHABLE_KEY || 'unconfigured',
  {
    auth: {
      storage: localStorage,
      persistSession: true,
      autoRefreshToken: true,
    },
  },
);
