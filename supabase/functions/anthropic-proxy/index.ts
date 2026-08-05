/**
 * Anthropic proxy — the server-side half of order ② for the AI assistant.
 *
 * WHY THIS EXISTS: `AIChatPanel` used to call api.anthropic.com DIRECTLY FROM THE
 * BROWSER, reading the key from `settings.anthropicApiKey` — a field persisted to
 * `app_settings`, which the anon role can read. It also had to set the header
 * `anthropic-dangerous-direct-browser-access: true` to do it. Anthropic named that
 * header accurately. The key was verified live, authenticating.
 *
 * ROTATION: `supabase secrets set ANTHROPIC_API_KEY=...`. No schema change, no
 * migration, no client redeploy.
 *
 * FAILURE CONTRACT — same as the Airtable proxy and for the same reason: a dead
 * assistant must not look like a thoughtful silence. Every failure carries a
 * machine-readable status and a non-2xx code; `not_configured` is distinct from
 * `auth_failed` is distinct from `unreachable`.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function fail(status: string, message: string, httpCode: number): Response {
  return new Response(JSON.stringify({ status, message, content: null }), {
    status: httpCode,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) {
    return fail('not_configured', 'ANTHROPIC_API_KEY is not set on this deployment.', 503);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return fail('vendor_error', 'Request body was not valid JSON.', 400);
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        // ⛔ NOTE the header that is NOT here: no
        // `anthropic-dangerous-direct-browser-access`. This is a server, which is
        // the entire point — that header existed only because the call was being
        // made from a browser holding a key it should never have had.
      },
      body: JSON.stringify(payload),
    });

    if (res.status === 401 || res.status === 403) {
      return fail(
        'auth_failed',
        'Anthropic rejected our credentials. The key may have been rotated or revoked.',
        502,
      );
    }
    if (res.status === 429) {
      // Distinct from a failure: it will succeed later. Saying so lets the UI
      // offer "try again" honestly instead of implying the feature is broken.
      return fail('rate_limited', 'Anthropic rate limit reached. Try again shortly.', 429);
    }
    if (!res.ok) {
      return fail('vendor_error', `Anthropic returned HTTP ${res.status}.`, 502);
    }

    const data = await res.json();
    return new Response(JSON.stringify({ status: 'ok', ...data }), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return fail('unreachable', `Could not reach Anthropic: ${(e as Error).message}`, 502);
  }
});
