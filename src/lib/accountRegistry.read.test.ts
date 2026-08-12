import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 🔒 THE READ SIDE OF THE REGISTRY — `fetchAccountRegistry`, which had no test.
 *
 * `accountRegistry.test.ts` covers `buildAccountRegistry`, which is pure. The function that
 * actually talks to the database was untested, and that is where the refusal-becomes-a-value
 * hazard lives: a failed read and an empty table are the same shape (`data: []`) unless
 * something deliberately keeps them apart.
 *
 * Measured 2026-08-12 by mutation: replacing
 *     if (accounts.error || !Array.isArray(accounts.data)) return EMPTY;
 * with `if (false)` left the entire suite green. Under that mutation a transient network
 * failure produces a registry reporting `known: true` and `size: 0` — "we asked, and this
 * account does not exist" — and every screen in the app silently reverts to Meta's raw
 * names and default programs with nothing on screen to say why. The stale, real legacy
 * names are strictly better than a confident nothing, and `known` is the flag that decides
 * which one the caller gets.
 *
 * ⛔ THE TWO TABLES ARE NOT EQUALLY CRITICAL, and the asymmetry is deliberate:
 *   ad_accounts fails               -> the whole registry is unknown (fall back to legacy)
 *   ad_account_airtable_names fails -> the registry still answers; only the join links go
 * Losing the entire account mapping in order to recover an appointment-join fallback would
 * trade a large outage for a small one.
 */

const h = vi.hoisted(() => ({
  accounts: { data: null as unknown, error: null as { message: string } | null },
  names: { data: null as unknown, error: null as { message: string } | null },
  /** Which tables were actually queried, so "it read the right thing" is falsifiable. */
  asked: [] as string[],
  /** Force the client itself to blow up, not just answer with an error. */
  throwOn: null as string | null,
}));

vi.mock('@/integrations/supabase/client', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: (table: string) => {
      h.asked.push(table);
      if (h.throwOn === table) throw new Error('client exploded');
      return {
        select: () =>
          Promise.resolve(table === 'ad_accounts' ? h.accounts : h.names),
      };
    },
  },
}));

const { fetchAccountRegistry } = await import('./accountRegistry');

const ACCOUNT = {
  account_id: '596293242787360',
  meta_name: 'Backyard Paradiso',
  company_name: 'Backyard Paradiso',
  program: 'Done For You',
  media_buyer: 'Jez',
  status: 'active',
};
const LINK = {
  airtable_name_key: 'new jersey l backyard paradiso',
  airtable_name: 'New Jersey l Backyard Paradiso',
  account_id: '596293242787360',
};

beforeEach(() => {
  h.accounts = { data: [ACCOUNT], error: null };
  h.names = { data: [LINK], error: null };
  h.asked = [];
  h.throwOn = null;
});

describe('a failed read is not "there are no accounts"', () => {
  it('🔴 an ad_accounts ERROR resolves to known:false, NOT to an empty index', async () => {
    h.accounts = { data: null, error: { message: 'permission denied for table ad_accounts' } };
    const r = await fetchAccountRegistry();
    // `known` is the whole point: the caller uses it to decide whether to keep the legacy
    // names. `size === 0` alone cannot tell "we could not look" from "there is nothing".
    expect(r.known).toBe(false);
    expect(r.size).toBe(0);
    expect(r.byMetaName('Backyard Paradiso')).toBeNull();
  });

  it('🔴 a THROWN client error resolves the same way, rather than propagating', async () => {
    // The registry is read during a refresh that also loads spend and appointments. A throw
    // escaping here would take a working screen down over a mapping table.
    h.throwOn = 'ad_accounts';
    const r = await fetchAccountRegistry();
    expect(r.known).toBe(false);
  });

  it('🔴 a non-array payload is refused rather than trusted', async () => {
    // PostgREST answering an object (a bare error body, a single-row shape) must not be
    // spread into an index. `.data` being truthy is not the same as it being rows.
    h.accounts = { data: { message: 'nope' }, error: null };
    expect((await fetchAccountRegistry()).known).toBe(false);
  });

  it('🔴 AN ERROR BESIDE ROWS IS STILL AN ERROR — the rows may be a PARTIAL answer', async () => {
    /**
     * ⭐ THE ONLY ARM THAT MAKES THE `accounts.error` CLAUSE LOAD-BEARING, and it exists
     * because measuring found the other three do not.
     *
     * Deleting the whole guard leaves `data: null` and `data: {…}` behaving identically:
     * `buildAccountRegistry` throws on a non-iterable and the function's own try/catch
     * returns the same EMPTY. Those three arms therefore pass with the guard removed —
     * they test the catch, not the check.
     *
     * An error arriving ALONGSIDE a well-formed array is the shape the two cannot both
     * handle. Without the `error` clause it builds a confident registry over what may be a
     * truncated read: `known: true`, one account, and 51 others silently missing — which
     * the app renders as "these accounts are unmapped" rather than "we could not look".
     * Reporting a partial read as a complete one is the whole defect class this file guards.
     */
    h.accounts = { data: [ACCOUNT], error: { message: 'statement timeout, partial result' } };
    const r = await fetchAccountRegistry();
    expect(r.known).toBe(false);
    expect(r.size).toBe(0);
    expect(r.byMetaName('Backyard Paradiso')).toBeNull();
  });

  it('⭐ CONTROL: a genuinely EMPTY table is known:true with size 0 — a real answer', async () => {
    // Without this arm the three above are satisfiable by "always report unknown", and the
    // distinction the whole module is built on would be untested in the affirmative
    // direction. An empty table is a fact; a failed read is not.
    h.accounts = { data: [], error: null };
    const r = await fetchAccountRegistry();
    expect(r.known).toBe(true);
    expect(r.size).toBe(0);
  });

  it('⭐ CONTROL: a healthy read indexes the account and answers', async () => {
    const r = await fetchAccountRegistry();
    expect(r.known).toBe(true);
    expect(r.size).toBe(1);
    expect(r.byMetaName('Backyard Paradiso')?.company).toBe('Backyard Paradiso');
    expect(h.asked).toContain('ad_accounts');
    expect(h.asked).toContain('ad_account_airtable_names');
  });
});

describe('the Airtable link table degrades on its own, without taking the registry down', () => {
  it('🔴 its failure leaves the ACCOUNT mapping intact and only drops the join links', async () => {
    h.names = { data: null, error: { message: 'relation "ad_account_airtable_names" does not exist' } };
    const r = await fetchAccountRegistry();
    // The registry still knows what it knows.
    expect(r.known).toBe(true);
    expect(r.byMetaName('Backyard Paradiso')?.company).toBe('Backyard Paradiso');
    // Only the appointment-join path degrades, to exactly what existed before that table.
    expect(r.airtableNameCount).toBe(0);
    expect(r.airtableNameToAccountId('New Jersey l Backyard Paradiso')).toBeNull();
  });

  it('🔴 a missing link table must NOT be reported as a mapped-name count', async () => {
    // `airtableNameCount` feeds "N client names mapped". Counting a failed read as 0 mapped
    // names is honest ONLY because `known` above stays true and the accounts still resolve;
    // it must never come back non-zero from a payload that is not rows.
    h.names = { data: { error: 'boom' }, error: null };
    const r = await fetchAccountRegistry();
    expect(r.airtableNameCount).toBe(0);
  });

  it('⭐ CONTROL: with both reads healthy the stable join path answers', async () => {
    const r = await fetchAccountRegistry();
    expect(r.airtableNameCount).toBe(1);
    expect(r.airtableNameToAccountId('New Jersey l Backyard Paradiso')).toBe('596293242787360');
  });
});
