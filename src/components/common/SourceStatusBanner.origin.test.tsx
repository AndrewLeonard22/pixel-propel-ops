import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SourceKey, SourceStatus } from '@/lib/sourceStatus';
import type { SettingsOrigin } from '@/lib/config';

/**
 * THE NINETEEN. @bird drove every routed page of the live broken deployment:
 *
 *   route          "Missing:" lines    names the real cause?
 *   /                     3                   false
 *   /agents               3                   false
 *   /call-center          4                   false
 *   /targets              3                   false
 *   /team                 3                   false
 *   /calendar             3                   false
 *                       ────
 *                        19 sentences blaming @andrew's configuration
 *   occurrences of supabase / database / deployment across all of them:  ZERO
 *
 * @raccoon reconciled it to the source: this component × 6 routes = 18, plus
 * CallCenter.tsx:704 = 19. Neither census could see the whole number — his counted
 * TEMPLATES, @bird's counted RENDERS, and 19 is their product.
 *
 * ⭐ WHY THIS FILE EXISTS SEPARATELY FROM ConfigBanner.test.tsx, AND IT IS THE WHOLE
 * LESSON: ConfigBanner only mounts when `configured` is FALSE, and it returns early. That
 * is the COLD-browser surface. @bird measured a WARM browser, where `configured` is true,
 * ConfigBanner never renders, and THIS component does all nineteen of the talking. I fixed
 * ConfigBanner first and it closed none of the 19. A sound fix to one surface is not a
 * claim about the other — the two are invisible to each other's tests.
 */
const useDataMock = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useData', () => ({ useData: useDataMock }));

const { default: SourceStatusBanner } = await import('./SourceStatusBanner');

function status(over: Partial<SourceStatus>): SourceStatus {
  return {
    label: 'Ad spend (Windsor)',
    state: 'valid',
    error: null,
    missingSettings: [],
    configured: true,
    ...over,
  } as SourceStatus;
}

function mount(origin: SettingsOrigin, detail: string | null = null) {
  useDataMock.mockReturnValue({
    settingsLoaded: true,
    loading: false,
    refresh: () => {},
    settingsOrigin: origin,
    settingsDetail: detail,
    sources: {
      windsor: status({ label: 'Ad spend (Windsor)', state: 'not-configured', configured: false, missingSettings: ['Google Sheet URL'] }),
      airtable: status({ label: 'Appointments (Airtable)', state: 'not-configured', configured: false, missingSettings: ['Airtable base ID'] }),
      callCenter: status({ label: 'Calls (call-centre sheet)', state: 'not-configured', configured: false, missingSettings: ['Call centre sheet URL'] }),
    } as Record<SourceKey, SourceStatus>,
  });
  return render(<MemoryRouter><SourceStatusBanner /></MemoryRouter>);
}

beforeEach(() => useDataMock.mockReset());

describe('SourceStatusBanner — 18 of @bird’s 19 false claims come from here', () => {
  it('🔴 ANTI-VACUITY CONTROL: with a VERIFIED origin the per-source lines still enumerate', () => {
    // Without this arm the fix is satisfiable by deleting the "Missing:" copy outright,
    // which would destroy the signal a genuinely unconfigured user needs.
    const { container } = mount('local-no-row');

    expect(container.textContent).toMatch(/Missing: Google Sheet URL/);
    expect(container.textContent).toMatch(/Missing: Airtable base ID/);
    // Three sources, three claims — @raccoon's per-route template count.
    expect((container.textContent ?? '').match(/Missing:/g) ?? []).toHaveLength(3);
  });

  it('🔴 THE LIVE STATE: an unconfigured BUILD emits ZERO "Missing:" claims', () => {
    const { container } = mount('local-not-configured');

    expect((container.textContent ?? '').match(/Missing:/g) ?? []).toHaveLength(0);
    expect(container.textContent).toMatch(/deployed without its database URL/i);
    // @bird's measurement of the defect: ZERO occurrences of the real cause on any route.
    expect(container.textContent).toMatch(/database/i);
  });

  it('it does NOT name any individual source as not-connected when we never read settings', () => {
    const { container } = mount('local-not-configured');
    expect(container.textContent).not.toMatch(/not connected/i);
    expect(container.textContent).toMatch(/has not been lost or changed/i);
  });

  it('an UNREACHABLE database says so, shows the reason, and OFFERS retry', () => {
    const { container } = mount('local-unreachable', 'TypeError: Failed to fetch');

    expect(container.textContent).toMatch(/could not be read from the database/i);
    expect(container.textContent).toMatch(/TypeError: Failed to fetch/);
    expect(screen.getByRole('button', { name: /try again/i })).toBeVisible();
  });

  it('🔑 an unconfigured BUILD offers NO retry — a button that cannot work is a false promise', () => {
    mount('local-not-configured');
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('stays silent before the settings have loaded', () => {
    useDataMock.mockReturnValue({
      settingsLoaded: false,
      loading: true,
      refresh: () => {},
      settingsOrigin: 'local-not-configured' as SettingsOrigin,
      settingsDetail: null,
      sources: { windsor: status({}), airtable: status({}), callCenter: status({}) } as Record<SourceKey, SourceStatus>,
    });
    const { container } = render(<MemoryRouter><SourceStatusBanner /></MemoryRouter>);
    expect(container.textContent).toBe('');
  });

  it('🔴 THE COUNT @bird MEASURED: 3 per route before, 0 after — same sources, same mount', () => {
    // The defect is a COUNT across routes, so the assertion is a count. Asserting only
    // that the new copy is present would pass even if all three lies stayed beside it.
    const before = mount('local-no-row').container.textContent ?? '';
    useDataMock.mockReset();
    const after = mount('local-not-configured').container.textContent ?? '';

    expect((before.match(/Missing:/g) ?? []).length).toBe(3);
    expect((after.match(/Missing:/g) ?? []).length).toBe(0);
    expect(before).not.toBe(after);
  });
});
