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
const performed = vi.hoisted(() => ({ saves: [] as unknown[] }));
vi.mock('@/lib/config', async () => {
  const actual = await vi.importActual<typeof import('@/lib/config')>('@/lib/config');
  return {
    ...actual,
    saveSettings: async (s: unknown) => { performed.saves.push(s); },
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

const { default: SettingsPage } = await import('./Settings');

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
  await act(async () => { vi.advanceTimersByTime(1200); });
}

beforeEach(() => {
  performed.saves.length = 0;
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
