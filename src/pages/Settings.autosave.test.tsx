import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { makeSettings } from '@/test/factories';
import type { SourceKey, SourceStatus } from '@/lib/sourceStatus';
import type { SettingsOrigin } from '@/lib/config';

/**
 * 🔴 @bird's P0, ISOLATED ON THE DEPLOYED BUILD IN ONE RUN, ONE VARIABLE:
 *
 *     in-app CLICK to /settings  ->  landed /settings   writes: 0
 *     DIRECT URL  to /settings   ->  landed /settings   writes: 52
 *
 * A FULL PAGE LOAD upserts `app_settings` with no edit, no click and no Save. A refresh,
 * a bookmark, or a shared link all take that path — and a refresh is the single most
 * natural thing to do on a page that looks stale.
 *
 * ⭐ THE SPA REWRITE ARMED IT. Before that landed `/settings` returned a hard 404, so no
 * full page load was possible at all. A correct fix made an unreachable defect reachable,
 * and nothing in its diff predicted that.
 *
 * THE MECHANISM: `form` is seeded from localStorage at mount, the async settings load then
 * calls setSettings with a NEW OBJECT, the hydration effect copies it into `form`, and the
 * autosave effect — whose dependency array cannot tell "the user typed" from "we just
 * loaded" — fires. HYDRATION COUNTED AS AN EDIT.
 *
 * ⚠️ AND THE MIRROR DEFECT, WHICH NOBODY HAD NAMED AND WHICH THE SAME LINE CAUSED: on the
 * in-app path there is no remount, so `settings` never changed identity, `hydrated` stayed
 * FALSE FOREVER, and the autosave was PERMANENTLY DEAD. @bird's measured 0 writes was
 * simultaneously SAFE and BROKEN. Both arms below exist because a fix for either one alone
 * is satisfiable by breaking the other.
 */
const performed = vi.hoisted(() => ({ saves: [] as unknown[], rejectWith: null as string | null }));
vi.mock('@/lib/config', async () => {
  const actual = await vi.importActual<typeof import('@/lib/config')>('@/lib/config');
  return {
    ...actual,
    saveSettings: async (s: unknown) => {
      performed.saves.push(s);
      // The clobber guard refuses BY THROW, by design. This is that path.
      if (performed.rejectWith) throw new Error(performed.rejectWith);
    },
    saveAccountMappings: async () => {},
    loadAccountMappings: () => [],
    // ⚠️ NON-EMPTY, DELIBERATELY. My first version of this file returned [] here, so the
    // `dbMappings.length > 0` branch never ran and a SECOND no-edit autosave trigger was
    // invisible. An unrealistic fixture did not weaken a test — it hid a live defect.
    loadAccountMappingsAsync: async () => [{ sheetName: 'Acme', airtableName: 'Acme Inc', program: 'DFY', status: 'Active' }],
  };
});

const useDataMock = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useData', () => ({ useData: useDataMock }));

const { default: SettingsPage, stableStringify } = await import('./Settings');

const DB_SETTINGS = makeSettings({
  googleSheetUrl: 'https://docs.google.com/spreadsheets/d/REAL/edit',
  airtableBaseId: 'appREAL',
  excludedCampaigns: ['a', 'b', 'c', 'd'],
});

function status(over: Partial<SourceStatus> = {}): SourceStatus {
  return { label: 'src', state: 'valid', error: null, missingSettings: [], configured: true, ...over } as SourceStatus;
}

function mount(origin: SettingsOrigin, settingsLoaded = true) {
  useDataMock.mockReturnValue({
    settings: DB_SETTINGS,
    setSettings: () => {},
    adSpend: [], accounts: [], callData: [], appointments: [],
    refresh: async () => {},
    settingsOrigin: origin,
    settingsDetail: null,
    settingsLoaded,
    sources: {
      windsor: status(), airtable: status(), callCenter: status(),
    } as Record<SourceKey, SourceStatus>,
  });
  return render(<SettingsPage />);
}

/** Let the 800ms autosave debounce elapse. */
async function letAutosaveFire() {
  // FLUSH PENDING PROMISES FIRST, THEN LET TIME PASS. The settings and mappings loads are
  // promises; the autosave is a timer that can only be SCHEDULED once both have settled.
  // Advancing the clock before flushing meant the schedule happened after the advance and
  // nothing ever fired — a harness that could not observe the behaviour under test.
  await act(async () => {});
  await act(async () => { vi.advanceTimersByTime(1200); });
  await act(async () => {});
}

beforeEach(() => {
  performed.saves.length = 0;
  performed.rejectWith = null;
  useDataMock.mockReset();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('Settings autosave — a page LOAD is not an EDIT', () => {
  it('🔴 @bird\'s P0: a full page load writes NOTHING', async () => {
    mount('database');
    await letAutosaveFire();

    expect(performed.saves).toHaveLength(0);
  });

  it('🔴 ANTI-VACUITY CONTROL: a REAL edit still saves', async () => {
    // Without this the fix is satisfiable by disabling the autosave outright — which is
    // exactly the mirror defect the in-app path already had, so this is not hypothetical.
    mount('database');
    await letAutosaveFire();
    expect(performed.saves).toHaveLength(0);

    const input = screen.getAllByRole('textbox')[0];
    fireEvent.change(input, { target: { value: 'https://docs.google.com/spreadsheets/d/EDITED/edit' } });
    await letAutosaveFire();

    expect(performed.saves).toHaveLength(1);
  });

  it('🔑 the autosave is ARMED on the in-app path too — the mirror defect', async () => {
    // The old gate keyed on `settings` changing IDENTITY, which only happens on a remount.
    // Clicking in from the nav left `hydrated` false forever and the feature dead. The
    // arm above proves an edit saves; this states the property it was proving.
    mount('database');
    const input = screen.getAllByRole('textbox')[0];
    fireEvent.change(input, { target: { value: 'https://docs.google.com/spreadsheets/d/X/edit' } });
    await letAutosaveFire();

    expect(performed.saves.length).toBeGreaterThan(0);
  });

  it('🔴 @raccoon\'s BLOCKER: an UNVERIFIED origin refuses to write even after an edit', async () => {
    // Stale-but-populated local config overwriting a fresher database row. His guard
    // measured safe:true on that shape because it refuses POPULATED -> EMPTY, not
    // POPULATED -> FEWER. If we never read the database, the only safe write is none.
    mount('local-not-configured');
    const input = screen.getAllByRole('textbox')[0];
    fireEvent.change(input, { target: { value: 'https://docs.google.com/spreadsheets/d/X/edit' } });
    await letAutosaveFire();

    expect(performed.saves).toHaveLength(0);
  });

  it('an UNREACHABLE database also refuses', async () => {
    mount('local-unreachable');
    const input = screen.getAllByRole('textbox')[0];
    fireEvent.change(input, { target: { value: 'https://docs.google.com/spreadsheets/d/X/edit' } });
    await letAutosaveFire();

    expect(performed.saves).toHaveLength(0);
  });

  it('🔑 a genuinely EMPTY database still accepts a first-time setup', async () => {
    // 'local-no-row' is a real answer, not a failure — refusing here would make the app
    // impossible to configure, which is the mirror of the wipe.
    mount('local-no-row');
    const input = screen.getAllByRole('textbox')[0];
    fireEvent.change(input, { target: { value: 'https://docs.google.com/spreadsheets/d/NEW/edit' } });
    await letAutosaveFire();

    expect(performed.saves).toHaveLength(1);
  });

  it('🔴 THE SECOND NO-EDIT TRIGGER: the async ACCOUNT MAPPINGS load must not autosave', async () => {
    // Settings.tsx mounts, then loadAccountMappingsAsync resolves and calls
    // setAccountMappings — a change to an autosave dependency with no user involvement at
    // all. Same defect as @bird's P0, different trigger, and it fires on EVERY entry path
    // including the in-app click that was measured safe.
    mount('database');
    await letAutosaveFire();

    expect(performed.saves).toHaveLength(0);
  });

  it('🔑 THE OTHER ORDER: mappings landing BEFORE the settings load also writes nothing', async () => {
    // The comment in Settings.tsx claims the two loaders converge whichever order they land
    // in. That claim was untested until this arm, and an untested claim in a comment is a
    // test that never runs. Mount with the settings load still in flight, let the mappings
    // promise resolve first, THEN complete the settings load.
    const { rerender } = mount('database', /* settingsLoaded */ false);
    await letAutosaveFire();
    expect(performed.saves).toHaveLength(0);

    mount('database', true);          // re-arm the mock with the load resolved
    rerender(<SettingsPage />);
    await letAutosaveFire();

    expect(performed.saves).toHaveLength(0);
  });

  it('does not write while the settings load is still in flight', async () => {
    mount('database', /* settingsLoaded */ false);
    await letAutosaveFire();

    expect(performed.saves).toHaveLength(0);
  });

  it('🔴 a SECOND load after a save still writes nothing — the baseline is not one-shot', async () => {
    mount('database');
    const input = screen.getAllByRole('textbox')[0];
    fireEvent.change(input, { target: { value: 'https://docs.google.com/spreadsheets/d/X/edit' } });
    await letAutosaveFire();
    const afterEdit = performed.saves.length;

    // Nothing further happens without another edit — the debounce must not re-fire on
    // unrelated re-renders once the baseline has been updated.
    await letAutosaveFire();
    await letAutosaveFire();

    expect(performed.saves).toHaveLength(afterEdit);
  });
});

/**
 * @raccoon measured this edge on my fix and explicitly did NOT ask me to change it — he
 * rated it low severity and correct that key order is stable today. Fixed anyway, because
 * the failure mode IS @bird's P0 (an upsert with no user edit), and a claim about a
 * serialiser is exactly the kind of thing that should be run rather than asserted.
 */
describe('stableStringify — key ORDER must not read as an edit', () => {
  it('🔴 the edge @raccoon found: same values, different key order, SAME string', () => {
    expect(stableStringify({ a: 'x', b: 'y' })).toBe(stableStringify({ b: 'y', a: 'x' }));
  });

  it('and plain JSON.stringify does NOT — so the fix is not a no-op', () => {
    // The control. Without this, the assertion above passes trivially if stableStringify
    // were ever reduced back to JSON.stringify on an already-ordered fixture.
    expect(JSON.stringify({ a: 'x', b: 'y' })).not.toBe(JSON.stringify({ b: 'y', a: 'x' }));
  });

  it('ANTI-VACUITY: genuinely different VALUES still differ', () => {
    expect(stableStringify({ a: 'x' })).not.toBe(stableStringify({ a: 'z' }));
  });

  it('sorts nested objects too, and does NOT reorder arrays', () => {
    expect(stableStringify({ o: { b: 1, a: 2 } })).toBe(stableStringify({ o: { a: 2, b: 1 } }));
    // Array order is MEANINGFUL for accountAliases — reordering it would hide a real edit.
    expect(stableStringify({ l: [1, 2] })).not.toBe(stableStringify({ l: [2, 1] }));
  });
});

/**
 * 🔴 THE FAILURE PATH — @raccoon found this INSIDE the P0 fix, and named exactly why my
 * ten existing arms could not see it: "all ten are on the success path or the early-return
 * path; none reaches the timeout body's failure."
 *
 * The baseline used to advance BEFORE the write was attempted. A refused write was recorded
 * as saved, and because the baseline then matched, RE-MAKING THE SAME EDIT WOULD NOT RETRY.
 * A refusal designed to be loud became an edit that silently never persisted — which is the
 * same shape as the wipe it was built to prevent, in the opposite direction.
 */
describe('Settings autosave — a REFUSED write must stay dirty and say so', () => {
  it('🔴 the baseline does NOT advance when the save is refused', async () => {
    mount('database');
    performed.rejectWith = 'refusing: this would blank 3 populated fields';

    const input = screen.getAllByRole('textbox')[0];
    fireEvent.change(input, { target: { value: 'https://docs.google.com/spreadsheets/d/A/edit' } });
    await letAutosaveFire();
    expect(performed.saves).toHaveLength(1); // attempted, and refused

    // ⭐ THE ACTUAL DEFECT: the SAME edit must retry. Before the fix the baseline had
    // already moved, so this second attempt was skipped and the edit was lost silently.
    // Edit away, then BACK to the refused value — each in its own debounce window, because
    // two changes inside one window collapse to a single scheduled save.
    fireEvent.change(input, { target: { value: 'https://docs.google.com/spreadsheets/d/B/edit' } });
    await letAutosaveFire();
    expect(performed.saves).toHaveLength(2);

    fireEvent.change(input, { target: { value: 'https://docs.google.com/spreadsheets/d/A/edit' } });
    await letAutosaveFire();

    // ⭐ THREE attempts. The refused value A is re-attempted rather than treated as saved —
    // before the fix the baseline had already advanced to A and this was skipped forever.
    expect(performed.saves).toHaveLength(3);
  });

  it('🔴 the refusal REACHES THE USER instead of being an unhandled rejection', async () => {
    mount('database');
    performed.rejectWith = 'refusing: this would blank 3 populated fields';

    fireEvent.change(screen.getAllByRole('textbox')[0], {
      target: { value: 'https://docs.google.com/spreadsheets/d/A/edit' },
    });
    await letAutosaveFire();

    // getBy, not findBy: findBy* polls on REAL timers and deadlocks while they are faked.
    // The probe confirmed the alert is in the DOM as soon as act() flushes the rejection.
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/would blank 3 populated fields/);
    expect(alert.textContent).toMatch(/NOT saved/);
  });

  it('says mappings may have saved SEPARATELY — Promise.all does not cancel siblings', async () => {
    // Measured behaviour, not a guess: a rejected Promise.all leaves sibling side effects
    // done. Claiming "nothing was written" would be the comfortable lie.
    mount('database');
    performed.rejectWith = 'refused';
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'https://docs.google.com/spreadsheets/d/A/edit' } });
    await letAutosaveFire();

    expect(screen.getByRole('alert').textContent).toMatch(/mappings may have saved separately/i);
  });

  it('🔑 ANTI-VACUITY CONTROL: a SUCCESSFUL save DOES advance the baseline', async () => {
    // Without this the fix is satisfiable by never advancing the baseline at all, which
    // would make every render after an edit re-save forever.
    mount('database');
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'https://docs.google.com/spreadsheets/d/A/edit' } });
    await letAutosaveFire();
    const after = performed.saves.length;
    expect(after).toBe(1);

    await letAutosaveFire();
    await letAutosaveFire();
    expect(performed.saves).toHaveLength(after);   // settled — no re-save loop
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

/**
 * 🔴 A LOAD MUST NOT SWALLOW A CONCURRENT EDIT — found by probing my OWN failing test.
 *
 * The mappings loader resolves after mount. My first version of the mappings fix recorded
 * `{form: <whatever the form held at that moment>, mappings}` as the baseline, so an edit
 * made BEFORE the mappings landed was captured as ALREADY PERSISTED and the autosave
 * skipped it forever. The user watches themselves type and nothing is ever written.
 *
 * ⚖️ THE TEST FAILURE LOOKED LIKE A BAD TEST. It was a real defect, and the only reason I
 * did not "fix" the test to match the code is that I probed what was actually saved.
 */
describe('Settings autosave — an async LOAD must not adopt an in-flight edit', () => {
  it('🔴 an edit typed BEFORE the mappings load lands is still saved', async () => {
    mount('database');

    // Type immediately, in the same tick as mount — before the mappings promise resolves.
    fireEvent.change(screen.getAllByRole('textbox')[0], {
      target: { value: 'https://docs.google.com/spreadsheets/d/TYPED/edit' },
    });
    await letAutosaveFire();

    expect(performed.saves).toHaveLength(1);
    expect((performed.saves[0] as { googleSheetUrl: string }).googleSheetUrl).toMatch(/TYPED/);
  });

  it('ANTI-VACUITY CONTROL: with NO edit, the mappings load still writes nothing', async () => {
    // The other direction, which is the trigger this whole mechanism was added for.
    mount('database');
    await letAutosaveFire();
    expect(performed.saves).toHaveLength(0);
  });
});

/**
 * 🔒 @raccoon's MISSING ARM — THE GUARD IS PLUGGED IN.
 *
 * He applied @fable's wire-sabotage rule to his OWN guards and found four of six failing:
 *
 *   cut checkSettingsWrite's verdict to {safe:true}  ->  391 passed, NOTHING NOTICED
 *
 * ⇒ He could disconnect the guard that refuses the write which DESTROYED PRODUCTION at
 *   22:18:48Z, and the whole suite stayed green.
 *
 * ⭐ AND HIS DIAGNOSIS OF WHY POINTS AT THIS FILE: "@anvil's Settings.autosave arms test the
 * BASELINE and the ORIGIN — they never construct a write that would BLANK config, so
 * cutting the verdict changes nothing they observe." My arms exercised every path EXCEPT
 * the one the guard exists for. The predicate has 19 arms and 4 poisons; nothing connected
 * it to the page.
 *
 * ⚠️ AND BUILDING IT FOUND A SECOND DEFECT, MINE: the refusal path only wrote to
 * console.error. The guard refused correctly and the user saw NOTHING — the same defect I
 * fixed on the THROW path an hour ago and did not carry across to the REFUSE path two lines
 * away in the same function.
 */
describe('Settings autosave — the WRITE GUARD is actually wired to the page', () => {
  it('🔴 a write that would BLANK populated config is REFUSED — no save attempted', async () => {
    mount('database');

    // DB_SETTINGS has a populated googleSheetUrl. Emptying it is exactly the shape the
    // guard exists for: a populated field going blank, which is what the 22:18 wipe did.
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '' } });
    await letAutosaveFire();

    expect(performed.saves).toHaveLength(0);
  });

  it('🔴 and the REFUSAL IS VISIBLE — a guard nobody can see is a save that quietly worked', async () => {
    mount('database');
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '' } });
    await letAutosaveFire();

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/would be blanked/);
    expect(alert.textContent).toMatch(/googleSheetUrl/);
    expect(alert.textContent).toMatch(/NOT saved/);
  });

  it('🔑 ANTI-VACUITY CONTROL: a NON-blanking edit still saves', async () => {
    // Without this the arm above passes if the autosave were simply broken, which is the
    // mirror defect and one this file has already had once tonight.
    mount('database');
    fireEvent.change(screen.getAllByRole('textbox')[0], {
      target: { value: 'https://docs.google.com/spreadsheets/d/STILL-POPULATED/edit' },
    });
    await letAutosaveFire();

    expect(performed.saves).toHaveLength(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
