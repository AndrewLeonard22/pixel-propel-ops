import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * 🔴 THE TRACKED `.env` POINTED AT A PROJECT WITH NO AD DATA IN IT, AND NOTHING SAID SO.
 *
 * Measured 2026-08-12, and reported independently by three verification passes:
 *
 *     git show HEAD:.env  ->  VITE_SUPABASE_URL="https://tclghhfozyfsdkqyaftc.supabase.co"
 *     the ad rows live in ->  https://mlwoztsytapxjgfldyzv.supabase.co   (48,611 of them)
 *
 * ⭐ WHY THIS IS A TEST AND NOT A README LINE. `.env` is DELIBERATELY GIT-TRACKED here — it
 * holds only the project ref, URL and publishable key, all of which Vite compiles into the
 * client bundle and are public to every visitor by design (the reasoning is in .gitignore).
 * Tracked means it is BUILD INPUT: whatever is committed is what a clean checkout ships.
 * So a wrong value in this file is not a local misconfiguration, it is a shipped one.
 *
 * ⚠️ AND IT FAILS QUIETLY, WHICH IS THE WHOLE PROBLEM. The wrong project answers the ad-spend
 * read with HTTP 200 and body `[]` — a perfectly successful conversation with a database that
 * has nothing in it. Every guard downstream agreed: the fetch succeeded, the source was
 * `valid`, and 0 fetched === 0 expected read as `complete`. $0.00 on every tile with a green
 * badge. `checkMetaCompleteness`'s `source-empty` state now catches that at RUNTIME, in the
 * browser, after a user has already loaded a dashboard of zeros. This catches it in the
 * suite, before anyone builds.
 *
 * ⛔ THE URL AND THE KEY ARE CHECKED AGAINST EACH OTHER, not just against a constant. A key
 * from one project with a URL from another is the shape nothing else can see: PostgREST
 * answers 401 for some paths and the app degrades in ways that look like an outage rather
 * than a config error. The publishable key is an unsigned-to-us JWT whose `ref` claim names
 * its project, so the two halves can be compared directly.
 */

/** The project that holds `ad_insights` / `ad_accounts` — verified live, 2026-08-12. */
const AD_DATA_PROJECT = 'mlwoztsytapxjgfldyzv';
/** The project the tracked `.env` used to name. Kept so the failure message can say WHICH mistake. */
const WRONG_PROJECT = 'tclghhfozyfsdkqyaftc';

const ENV_PATH = path.resolve(__dirname, '../../../.env');

function readEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

/** The `ref` claim out of a Supabase publishable key. Never verified — only read. */
function refOfKey(key: string): string | null {
  const payload = key.split('.')[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    );
    return typeof json.ref === 'string' ? json.ref : null;
  } catch {
    return null;
  }
}

describe('🔴 the tracked .env must name the project that holds the ad data', () => {
  it('the file exists at all — it is build input, not a local convenience', () => {
    // Untracking it once produced a deployed app with no database URL that read nobody's
    // settings. Its ABSENCE is a shipping failure, so it is asserted rather than skipped.
    expect(existsSync(ENV_PATH)).toBe(true);
  });

  it('VITE_SUPABASE_URL is the ad-data project, not the empty one', () => {
    const env = readEnv();
    expect(env.VITE_SUPABASE_URL).toBe(`https://${AD_DATA_PROJECT}.supabase.co`);
    // Named explicitly, because "not equal to the right value" and "equal to the KNOWN
    // WRONG value" send a reader to two different places.
    expect(env.VITE_SUPABASE_URL).not.toContain(WRONG_PROJECT);
  });

  it('VITE_SUPABASE_PROJECT_ID agrees with the URL', () => {
    const env = readEnv();
    expect(env.VITE_SUPABASE_PROJECT_ID).toBe(AD_DATA_PROJECT);
  });

  it('🔴 the PUBLISHABLE KEY belongs to the same project as the URL', () => {
    // The half a constant comparison cannot see. A key and a URL from different projects
    // is not a typo anyone spots by eye — both values look entirely normal.
    const env = readEnv();
    const keyRef = refOfKey(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '');
    expect(keyRef).toBe(AD_DATA_PROJECT);
    expect(keyRef).toBe(env.VITE_SUPABASE_PROJECT_ID);
  });

  it('🔑 ANTI-VACUITY: the reader really does read, and really does discriminate', () => {
    // Without this the four arms above are satisfiable by a parser that returns the same
    // string for everything, or by `refOfKey` returning null on every input and the
    // expectation being written against null.
    const env = readEnv();
    expect(Object.keys(env).length).toBeGreaterThanOrEqual(3);
    expect(refOfKey('not.a.jwt')).toBeNull();
    expect(refOfKey('')).toBeNull();
    expect(AD_DATA_PROJECT).not.toBe(WRONG_PROJECT);
    // And a key minted for the wrong project is REJECTED by the same reader that accepts
    // the real one — the arm above cannot pass by accident of parsing.
    const wrongKey =
      'x.' + Buffer.from(JSON.stringify({ iss: 'supabase', ref: WRONG_PROJECT, role: 'anon' })).toString('base64url') + '.y';
    expect(refOfKey(wrongKey)).toBe(WRONG_PROJECT);
    expect(refOfKey(wrongKey)).not.toBe(AD_DATA_PROJECT);
  });
});
