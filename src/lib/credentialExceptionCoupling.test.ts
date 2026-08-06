import { describe, it, expect } from 'vitest';
import cfgSrc from './config.ts?raw';
import dsSrc from './dataService.ts?raw';
import { ALLOWED_CONFIG_KEYS } from './config';

/**
 * ⛔ THE LIVE CREDENTIAL EXCEPTION, AND THE THING THAT RETIRES IT.
 *
 * `airtableToken` is KNOWINGLY re-admitted to ALLOWED_CONFIG_KEYS (@fable, owner-ordered) so the
 * product keeps working until `airtable-proxy` is deployed. It is stored in a WORLD-READABLE row.
 * The source says «REMOVE THIS LINE the moment airtable-proxy is deployed and verified».
 *
 * 🔴 A COMMENT SAYING «REMOVE THIS» IS A PREFERENCE, NOT A MECHANISM. Nobody will remember, and
 * the cost of forgetting is a live credential sitting in a public table indefinitely. Half a rule
 * is a preference; this file is the other half.
 *
 * THE COUPLING: the exception exists ONLY to feed the direct-Airtable FALLBACK in
 * `fetchAirtableData` (`if (invokeError && settings.airtableToken)`). Those two facts are one
 * decision, so they must move together — whoever deletes the fallback is forced to delete the
 * allowlist entry in the SAME commit, and whoever deletes the allowlist entry is forced to
 * delete the fallback.
 *
 * ⚖️ BOUND, STATED: this is a SOURCE coupling. It cannot tell you whether the proxy is actually
 * deployed — that is a live fact no test can hold. What it guarantees is that the exception
 * cannot outlive the ONLY code path that justifies it.
 */
const hasDirectFallback =
  /invokeError\s*&&\s*settings\.airtableToken/.test(dsSrc) &&
  /Authorization:\s*`Bearer \$\{settings\.airtableToken\}`/.test(dsSrc);

const tokenAllowlisted = (ALLOWED_CONFIG_KEYS as readonly string[]).includes('airtableToken');

describe('the airtableToken exception cannot outlive its justification', () => {
  it('⛔ allowlisted ⇔ the direct fallback exists — they move together or the build fails', () => {
    expect(
      tokenAllowlisted,
      hasDirectFallback
        ? 'the direct-Airtable fallback still reads settings.airtableToken, so the token MUST stay ' +
          'allowlisted or that path is dead code that silently stops working'
        : '🔴 THE DIRECT FALLBACK IS GONE — nothing reads settings.airtableToken any more, so the ' +
          'credential exception has NO justification left. REMOVE `airtableToken` from ' +
          'ALLOWED_CONFIG_KEYS (config.ts) — that deletion is the whole rollback, and the token ' +
          'must be treated as compromised and rotated.',
    ).toBe(hasDirectFallback);
  });

  it('the exception is documented at the line, not only in a commit message', () => {
    expect(cfgSrc, 'the allowlist entry must carry its own expiry condition').toMatch(
      /REMOVE THIS LINE the moment airtable-proxy is deployed/,
    );
    expect(cfgSrc, 'and must say the token is compromised while it stands').toMatch(
      /treated as compromised and rotated/,
    );
  });

  it('CONTROL: this test can fail — both halves are read from source, not asserted', () => {
    // If either probe silently matched nothing, the coupling above would be vacuously true.
    expect(dsSrc.length, 'dataService source must actually be readable').toBeGreaterThan(1000);
    expect(cfgSrc.length, 'config source must actually be readable').toBeGreaterThan(1000);
    expect(
      /settings\.airtableToken/.test(dsSrc),
      'the token reference must be findable at all — if this fails the probe is dead, ' +
        'not the fallback',
    ).toBe(true);
  });
});
