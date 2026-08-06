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
/**
 * 🔴 PRESENCE IS NOT VALIDITY, AND THAT GAP WAS THE BLANK PAGE.
 *
 * The previous guard was `SUPABASE_URL || 'https://unconfigured.invalid'`. `||` only
 * catches an ABSENT value. A value that is PRESENT AND INVALID — a bare project ref, a
 * host with no scheme, a placeholder — passes straight through to createClient, which
 * throws `Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL` AT MODULE SCOPE.
 *
 * @bird drove the deployed site: #root 0 bytes, ONE network request (its own HTML), that
 * exact error. The bundle dies at import, React never mounts, and NONE of the app runs —
 * which is why every measurement of the settings row was true and irrelevant.
 *
 * I wrote the original fallback for the MISSING case and never asked what an INVALID
 * value would do. Reproduced before fixing:
 *     ""                    -> falls back, OK
 *     "https://x.supabase.co" -> OK
 *     "abcdefghijklmnop"    -> THROWS   ⬅ the deployed shape
 *     "x.supabase.co"       -> THROWS
 */
function usableUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? raw : null;
  } catch {
    return null;
  }
}

const RESOLVED_URL = usableUrl(SUPABASE_URL);

export const isSupabaseConfigured = Boolean(RESOLVED_URL && SUPABASE_PUBLISHABLE_KEY);

if (!isSupabaseConfigured && typeof console !== 'undefined') {
  // Name WHICH failure it is: absent and invalid send someone to different places.
  const why = SUPABASE_URL && !RESOLVED_URL
    ? `VITE_SUPABASE_URL is set but is not a valid http(s) URL (received: ${JSON.stringify(SUPABASE_URL)}). ` +
      'It must be the full project URL, e.g. https://<ref>.supabase.co — not the bare project ref.'
    : 'VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are missing. Copy .env.example to .env.';
  console.error(
    `Supabase is not configured: ${why} Saved settings cannot be loaded from the database; ` +
      'the app will fall back to locally stored settings.',
  );
}

export const supabase = createClient<Database>(
  RESOLVED_URL || 'https://unconfigured.invalid',
  SUPABASE_PUBLISHABLE_KEY || 'unconfigured',
  {
    auth: {
      storage: localStorage,
      persistSession: true,
      autoRefreshToken: true,
    },
  },
);
