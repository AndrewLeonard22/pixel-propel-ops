import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { makeSettings } from '@/test/factories';
import type { SourceKey, SourceStatus } from '@/lib/sourceStatus';

/**
 * 🔴 D2, SECOND HALF — AND NOTHING VERIFIED IT UNTIL THIS FILE.
 *
 * @bird gated the first half live: `Closed Revenue ($)` now appears in all 13 mapping
 * dropdowns, 37 options each, so the destructive click is gone and $1,609,728.72 is no
 * longer one click from $0.
 *
 * ⚠️ AND HE NAMED THE BOUND HONESTLY: *"I proved the OPTION IS SELECTABLE. I did not verify
 * that the Closed-Revenue-labelled dropdown displays its SAVED value rather than «— Select
 * —» — that needs the label→select join and I stopped short rather than guess."*
 *
 * ⇒ He could not check it and I had never tested it: the saved-value `<option>` existed in
 *   `Settings.tsx` and in NO test file. A wire with no arm, on the half that protects a
 *   mapping the union CANNOT save — a renamed field or a re-pointed table is absent from
 *   the fetch no matter how many records you union.
 *
 * ⭐ AND @bird's OTHER FINDING SHAPED THIS FILE: *"the mapping UI does not exist until the
 * Airtable field fetch runs"*. His first pass read 0-of-124 and he did not file it —
 * correctly, because a cold `/settings` has no column-mapping UI at all. So this test
 * DRIVES Test Connection first. A test that rendered and read selects immediately would
 * measure a page where the fix cannot appear, and report a correct fix as broken.
 */
const useDataMock = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useData', () => ({ useData: useDataMock }));

const airtableImpl = vi.hoisted(() => vi.fn());
vi.mock('@/lib/dataService', async () => {
  const actual = await vi.importActual<typeof import('@/lib/dataService')>('@/lib/dataService');
  return { ...actual, fetchAirtableData: airtableImpl };
});

vi.mock('@/lib/config', async () => {
  const actual = await vi.importActual<typeof import('@/lib/config')>('@/lib/config');
  return {
    ...actual,
    saveSettings: async () => {},
    saveAccountMappings: async () => {},
    loadAccountMappings: () => [],
    loadAccountMappingsAsync: async () => [],
  };
});

const { default: SettingsPage } = await import('./Settings');

/** The saved mapping is CORRECT and WORKING; the column is simply not in today's fetch. */
const SAVED = 'Closed Revenue ($)';
const SETTINGS = makeSettings({
  airtableBaseId: 'appREAL',
  columnMappings: { 'Closed Revenue': SAVED },
});

function status(o: Partial<SourceStatus> = {}): SourceStatus {
  return { label: 's', state: 'valid', error: null, missingSettings: [], configured: true, ...o } as SourceStatus;
}

function mount() {
  useDataMock.mockReturnValue({
    settings: SETTINGS,
    setSettings: () => {},
    adSpend: [], accounts: [], callData: [], appointments: [],
    refresh: async () => {},
    settingsOrigin: 'database' as const, settingsDetail: null, settingsLoaded: true,
    sources: { windsor: status(), airtable: status(), callCenter: status() } as Record<SourceKey, SourceStatus>,
  });
  return render(<SettingsPage />);
}

/** Drive the real control — the mapping UI does not exist until this resolves. */
async function reachTheMappingUI(fields: string[]) {
  airtableImpl.mockResolvedValue({ records: [], fields, unresolvedLinks: 0 });
  // ⚠️ THREE sections each render a "Test Connection" button — Google Sheets, the call
  // centre, and Airtable. Target it through the AIRTABLE SECTION rather than by index:
  // an index would silently drift the day a section is added or reordered, and would then
  // be testing a different source's button while still passing. @bird's law — target by
  // property, never by position.
  const airtableSection = screen.getByText('Airtable Connection').closest('section');
  expect(airtableSection).toBeTruthy();
  fireEvent.click(within(airtableSection as HTMLElement).getByRole('button', { name: /test connection/i }));
  await waitFor(() => expect(screen.getByText(/Column Mappings/i)).toBeVisible());
}

beforeEach(() => {
  useDataMock.mockReset();
  airtableImpl.mockReset();
  localStorage.clear();
});

describe('the mapping select never presents a WORKING saved value as unchosen', () => {
  it('🔴 CONTROL FIRST — @bird\'s finding: no mapping UI at all before the fetch', () => {
    // His first pass read 0-of-124 against a control that had not rendered. Asserting the
    // pre-state here means the arms below cannot silently measure the same empty page.
    mount();
    expect(screen.queryByText(/Column Mappings/i)).not.toBeInTheDocument();
  });

  it('🔴 THE SAVED VALUE IS STILL AN OPTION when the fetch does not contain it', async () => {
    mount();
    // A realistic fetch that simply lacks the sparse column — a renamed field, or a table
    // re-pointed. The union cannot help here: the column is absent from every record.
    await reachTheMappingUI(['Client Name', 'Appointment Date', 'Lead Status']);

    expect(screen.getByText(`${SAVED} (saved — not in the current Airtable fetch)`)).toBeInTheDocument();
  });

  it('🔴 AND THE SELECT DISPLAYS IT — the exact join @bird could not make', async () => {
    mount();
    await reachTheMappingUI(['Client Name', 'Appointment Date', 'Lead Status']);

    // Find the select by its own label, not by position: 13 selects render and an index
    // would silently drift the day a mapping is added.
    const label = screen.getByText('Closed Revenue');
    const select = label.parentElement?.querySelector('select') as HTMLSelectElement;

    expect(select).toBeTruthy();
    expect(select.value).toBe(SAVED);          // NOT '' — not "— Select —"
  });

  it('🔑 ANTI-VACUITY CONTROL: when the fetch DOES contain it, no "(saved…)" note appears', async () => {
    // Without this, a fix that always rendered the extra option would pass above — and the
    // note would then be permanent furniture on a perfectly healthy mapping.
    mount();
    await reachTheMappingUI(['Client Name', SAVED]);

    expect(screen.queryByText(/saved — not in the current Airtable fetch/)).not.toBeInTheDocument();
    const select = screen.getByText('Closed Revenue').parentElement?.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe(SAVED);          // still selected, via the real option
  });

  it('an UNMAPPED column still shows "— Select —" — the honest empty state survives', async () => {
    mount();
    await reachTheMappingUI(['Client Name']);

    const select = screen.getByText('Campaign Name').parentElement?.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('');
  });
});
