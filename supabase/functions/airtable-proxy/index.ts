/**
 * Airtable proxy — the server-side half of order ②.
 *
 * WHY THIS EXISTS: `fetchAirtableData` used to read `settings.airtableToken` and send it
 * from the user's browser. That token was persisted to `app_settings`, a table readable
 * by the anon role — i.e. by anyone — and it was verified live, authenticating. Removing
 * it from the table closed the exposure and left the app with no way to reach Airtable,
 * because a static SPA has nowhere to keep a secret. This is that "somewhere".
 *
 * ROTATION: `supabase secrets set AIRTABLE_TOKEN=...`. No schema change, no migration,
 * no code change, no redeploy of the client.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FAILURE CONTRACT — the part that is NOT boilerplate, and the reason this file
 * is longer than the fetch it wraps.
 *
 * This product's central defect is that a failure and an empty answer are the same
 * value. `fetchCallCenterData` returned `[]` for a 403, a 404, a network error and a
 * genuinely quiet day alike, so a dead source rendered as "0 dials" with no error —
 * measured on production. A proxy is exactly where that mistake gets rebuilt, because
 * returning `{records: []}` on failure is the ergonomic thing to write.
 *
 * SO, EXPLICITLY:
 *   · this function NEVER returns 200 with an empty body to signal a problem
 *   · every failure carries a MACHINE-READABLE `status` and a human `message`
 *   · `not_configured` is DISTINCT from `failed` — we never asked, versus we asked
 *     and it broke. An empty list is only honest when the status is `ok`.
 *   · `auth_failed` is its own status, because after a rotation THAT is the likely
 *     failure and it must not read as "zero appointments"
 *   · a non-2xx from Airtable produces a non-2xx from us. We do not launder a
 *     vendor error into a successful-looking response.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Status = 'ok' | 'not_configured' | 'auth_failed' | 'unreachable' | 'vendor_error';

function fail(status: Exclude<Status, 'ok'>, message: string, httpCode: number): Response {
  // NOTE the http code: a failure is never a 200. A caller that only checks
  // `response.ok` must still be told something went wrong.
  return new Response(JSON.stringify({ status, message, records: null }), {
    status: httpCode,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const token = Deno.env.get('AIRTABLE_TOKEN');
  if (!token) {
    // NOT a failure of Airtable — a failure of OUR deployment. Named separately so the
    // dashboard can say "not connected" rather than "Airtable is down".
    return fail('not_configured', 'AIRTABLE_TOKEN is not set on this deployment.', 503);
  }

  let baseId: string, tableName: string;
  try {
    const body = await req.json();
    baseId = String(body.baseId ?? '');
    tableName = String(body.tableName ?? '');
  } catch {
    return fail('vendor_error', 'Request body was not valid JSON.', 400);
  }
  if (!baseId || !tableName) {
    return fail('not_configured', 'Airtable base id and table name are required.', 400);
  }

  const records: unknown[] = [];
  let fields: string[] = [];
  let offset: string | undefined;

  try {
    do {
      const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`);
      url.searchParams.set('pageSize', '100');
      url.searchParams.set('cellFormat', 'string');
      url.searchParams.set('timeZone', 'America/New_York');
      url.searchParams.set('userLocale', 'en-us');
      if (offset) url.searchParams.set('offset', offset);

      const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });

      if (res.status === 401 || res.status === 403) {
        // ⭐ THE STATUS THAT MATTERS AFTER A ROTATION. If this ever renders as
        // "zero appointments" the whole point of moving the token has been lost.
        return fail(
          'auth_failed',
          'Airtable rejected our credentials. The token may have been rotated or revoked.',
          502,
        );
      }
      if (!res.ok) {
        return fail('vendor_error', `Airtable returned HTTP ${res.status}.`, 502);
      }

      const page = await res.json();
      if (fields.length === 0 && page.records?.length) {
        fields = Object.keys(page.records[0].fields ?? {});
      }
      for (const r of page.records ?? []) records.push(r);
      offset = page.offset;
    } while (offset);
  } catch (e) {
    // A thrown fetch is a NETWORK problem, not an empty table. Distinct status.
    return fail('unreachable', `Could not reach Airtable: ${(e as Error).message}`, 502);
  }

  // ⚠️ `records: []` is returned ONLY here, under status 'ok'. An empty list with
  // status ok means "we asked, Airtable answered, there is genuinely nothing" —
  // which is a real and different fact from every branch above.
  return new Response(JSON.stringify({ status: 'ok' satisfies Status, records, fields }), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
