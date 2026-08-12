/**
 * CLIENT-SIDE WRITE GUARD FOR app_settings.
 *
 * WHY: on 2026-08-05 at 22:18:48.365Z the production config was destroyed by an ordinary
 * page load. The causal chain, every link measured by a different seat:
 *   ① Settings.tsx:116 autosaves 800ms after [form, accountMappings] changes.
 *      First render is skipped; the async mappings load then fires setAccountMappings.
 *      ⇒ OPENING THE PAGE WRITES. No click.
 *   ② `form` is useState(settings) — initialised ONCE, and NEVER re-synced when
 *      loadSettingsAsync resolves. On a cold browser it holds DEFAULT_SETTINGS forever.
 *   ③ The live row was later measured as DEFAULT_SETTINGS on 8 of 8 fields, including
 *      perfThresholds value-for-value and all 21 columnMappings pairs.
 *   ④ accountAliases survived at 62 because it loads from a DIFFERENT source.
 *
 * THIS FILE IS THE SINK-SIDE HALF. Gating the autosave fixes ONE caller; refusing the
 * write defends all three (Settings save, Dashboard handleAssign, handleToggleExclude)
 * and keeps defending them if a regenerated client forgets the gate.
 *
 * ⚠️ IT IS A NET, NOT THE REPAIR. It refuses a destructive write; it does not stop the
 * page attempting one. Both layers are needed — this is the one that survives a rewrite.
 *
 * THE RULE: a write may add and may change, but it may not BLANK a field that the
 * currently-stored config has populated. Clearing a field is a real user action, so the
 * caller must say so explicitly rather than have it inferred from a default-shaped object.
 */
import type { AppSettings } from './types';

/** Fields whose loss is destructive and not self-healing. */
export const PROTECTED_FIELDS = [
  /**
   * ⚠️ `googleSheetUrl` STOOD HERE UNTIL 2026-08-11 and was REPLACED, not dropped. It went
   * out with the Google Sheet feed; `airtableTableName` takes its slot so the guard keeps
   * covering TWO connection scalars rather than one. Shrinking this list quietly weakens
   * every arm that iterates it, which is the one way this file can rot without going red.
   */
  'airtableTableName',
  'airtableBaseId',
  'excludedCampaigns',
  'setterBonusRates',
  'inactiveSetters',
  'accountAliases',
] as const;

export type ProtectedField = (typeof PROTECTED_FIELDS)[number];

/**
 * Deliberately NOT a discriminated union. A caller that reads `.reason` on a safe
 * verdict should get an empty string, not a compile error that tempts a cast — and the
 * refusal reason must be readable without narrowing, because it goes straight to a log.
 */
export interface WriteVerdict {
  safe: boolean;
  /** empty when safe */
  reason: string;
  /** always present; empty when safe */
  blankedFields: ProtectedField[];
}

/**
 * Empty for our purposes: '', [], {}, null, undefined. Zero and false are NOT empty —
 * they are values a user can legitimately choose.
 *
 * 🔻 The `{}` arm was MISSING until @apprentice diffed this against his database guard.
 * Without it, `columnMappings` (21 pairs) and `perfThresholds` (4 keys) emptied to `{}`
 * read as NOT EMPTY and passed straight through — the client layer was structurally
 * blind to an emptied object.
 */
function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

/**
 * Would writing `candidate` over `stored` destroy populated configuration?
 *
 * @param stored the config as it currently exists. `null` means "not yet loaded" —
 *   which is itself unsafe to write over, because we cannot know what we would erase.
 * @param allowClear set when a human explicitly cleared fields, e.g. a real Save.
 */
export function checkSettingsWrite(
  candidate: Partial<AppSettings> | null | undefined,
  stored: Partial<AppSettings> | null | undefined,
  opts: { allowClear?: boolean } = {},
): WriteVerdict {
  if (!candidate) {
    return { safe: false, reason: 'no candidate settings to write', blankedFields: [] };
  }
  // Nothing stored yet -> nothing to destroy. A first write is safe.
  if (stored === null || stored === undefined) return { safe: true, reason: '', blankedFields: [] };

  // 🔑 DRIVEN BY THE KEYS OF `stored`, NOT BY A TYPED LIST.
  //
  // A hardcoded PROTECTED_FIELDS typed against AppSettings CANNOT NAME a key the type
  // does not model — and `activeSetters` was exactly that: absent from the interface,
  // present in the row, and DELETED OUTRIGHT by the wipe. The single most destroyed
  // field was the one a typed list is structurally unable to protect.
  //
  // Reading the keys off the stored row instead catches every off-schema field by
  // construction, including ones nobody has thought of yet. PROTECTED_FIELDS remains as
  // the documented floor and is asserted by the tests.
  const storedRecord = stored as Record<string, unknown>;
  const candidateRecord = candidate as Record<string, unknown>;
  const blanked = Object.keys(storedRecord).filter(
    f => !isEmptyValue(storedRecord[f]) && isEmptyValue(candidateRecord[f]),
  ) as ProtectedField[];

  if (blanked.length === 0) return { safe: true, reason: '', blankedFields: [] };
  if (opts.allowClear) return { safe: true, reason: '', blankedFields: blanked };

  return {
    safe: false,
    reason:
      `refusing to write: ${blanked.length} populated field(s) would be blanked ` +
      `(${blanked.join(', ')}). This is the signature of a save from a page that had ` +
      `not finished loading. If the clear is intentional, pass allowClear.`,
    blankedFields: blanked,
  };
}

/**
 * Has the config finished loading into component state?
 *
 * The autosave must not run before this is true. `form` is seeded synchronously from
 * localStorage and only later replaced by the database value; a save in between writes
 * whatever the browser happened to have, which on a cold browser is DEFAULT_SETTINGS.
 *
 * Deliberately NOT "settings is non-empty": a genuinely empty config is a legitimate
 * state, and keying on emptiness would make the guard unarmable exactly when the config
 * is already wiped — the state we are in right now.
 */
export function isHydrated(loadCompleted: boolean, formSyncedAt: number | null): boolean {
  return loadCompleted && formSyncedAt !== null;
}
