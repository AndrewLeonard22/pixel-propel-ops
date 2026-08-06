/**
 * The proxies' FAILURE CONTRACT, pinned.
 *
 * ⚠️ THESE ARE DENO EDGE FUNCTIONS AND OUR TYPECHECK DOES NOT COVER THEM.
 * `tsconfig.app.json` includes only `src`, so `tsc -b` exiting 0 says NOTHING about
 * supabase/functions. Nor can vitest execute them — they call `Deno.serve`. So this
 * file asserts the properties that matter STRUCTURALLY, over the source text, and says
 * plainly what it does not cover.
 *
 * WHY IT IS WORTH DOING ANYWAY: a proxy is precisely where this product's central
 * defect gets rebuilt. `fetchCallCenterData` returned `[]` for a 403, a 404, a network
 * error and a quiet day alike, and a dead source rendered as "0 dials" with no error —
 * measured on production. Returning `{records: []}` on failure is the ERGONOMIC thing
 * to write in a proxy, which is exactly why it needs a guard rather than good intentions.
 *
 * POPULATION: both proxy source files, every `fail(...)` call site in each, and the
 * single success path in each. Enumerated by parsing the files, not sampled.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PROXIES = ['airtable-proxy', 'anthropic-proxy'] as const;

const read = (name: string) =>
  readFileSync(join(process.cwd(), 'supabase/functions', name, 'index.ts'), 'utf8');

describe('proxy failure contract — a failure is never a 200', () => {
  for (const name of PROXIES) {
    describe(name, () => {
      const src = read(name);

      it('has at least one failure path — an empty population would pass vacuously', () => {
        const failCalls = src.match(/fail\(\s*'/g) ?? [];
        expect(failCalls.length, 'no fail() call sites found — is the parse right?')
          .toBeGreaterThan(2);
      });

      it('🔴 EVERY fail() call uses a NON-2XX http code', () => {
        // fail(status, message, httpCode) — third argument.
        const calls = [...src.matchAll(/fail\(\s*'[^']+',[\s\S]{0,240}?,\s*(\d{3})\s*\)/g)];
        expect(calls.length, 'parsed no fail() call sites').toBeGreaterThan(2);
        for (const c of calls) {
          const code = Number(c[1]);
          const is2xx = code >= 200 && code < 300;
          expect(is2xx, `fail() used HTTP ${code} — a failure must never be 2xx`).toBe(false);
        }
      });

      it('distinguishes not_configured from the failure statuses', () => {
        // "we never asked" and "we asked and it broke" are different facts, and an
        // empty list is only honest under the first when the status says so.
        expect(src).toContain("'not_configured'");
        expect(src).toContain("'unreachable'");
        expect(src).toContain("'vendor_error'");
      });

      it('🔑 has an auth_failed status — the likely failure right after a rotation', () => {
        // If a rotated key ever renders as "zero appointments", moving the token
        // server-side will have bought nothing.
        expect(src).toContain("'auth_failed'");
        expect(src).toMatch(/40[13]/); // keyed off the vendor's 401/403
      });

      it('reads its credential from the environment, never from a request or a table', () => {
        expect(src).toMatch(/Deno\.env\.get\('(AIRTABLE_TOKEN|ANTHROPIC_API_KEY)'\)/);
        // the whole point: rotation is a secrets change, so no credential may be
        // accepted from the caller
        expect(src).not.toMatch(/body\.(token|apiKey|api_key)/);
      });
    });
  }

  it('the anthropic proxy does NOT send the dangerous-direct-browser header', () => {
    // That header existed only because the call was made from a browser holding a key
    // it should never have had. A server has no use for it, and its presence would
    // mean somebody had pointed this at a browser again.
    expect(read('anthropic-proxy')).not.toMatch(
      /anthropic-dangerous-direct-browser-access['"]?\s*:\s*['"]true/,
    );
  });

  it('CONTROL: these assertions FAIL against a proxy that laundders failure into 200', () => {
    // Without this the suite above could pass on any file containing the right words.
    const bad = `
      function fail(status, message, httpCode) {
        return new Response(JSON.stringify({ status, records: [] }), { status: 200 });
      }
      fail('vendor_error', 'boom', 200);
    `;
    const calls = [...bad.matchAll(/fail\(\s*'[^']+',[\s\S]{0,240}?,\s*(\d{3})\s*\)/g)];
    expect(calls.length).toBeGreaterThan(0);
    const code = Number(calls[0][1]);
    const is2xx = code >= 200 && code < 300;
    expect(is2xx, 'the poison must be CAUGHT by the same predicate the real test uses').toBe(true);
    expect(bad).not.toContain("'auth_failed'"); // and it lacks the status entirely
  });
});
