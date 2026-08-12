import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * 🔴 THE CUTOFF CAME BACK ONE SECTION BELOW THE TABLE THAT FIXED IT.
 *
 * AccountsTable.tsx documents the law at length — a hidden column must also drop its TRACK,
 * and both halves live in one constant — and its sibling on the same page ignored it. The
 * pull-history grid was a single non-responsive `grid-cols-[1fr_88px_92px_88px_96px]`:
 * 364px of fixed tracks plus 24px of padding, a 388px floor with no breakpoint variants.
 * AppLayout gives `p-3` below `sm`, so a 375px phone has 351px. The `1fr` "Started" track
 * therefore computes to ZERO and the row overflows by 37px, on every device narrower than
 * 412px.
 *
 * ⭐ THE POINT OF THIS FILE: AccountsTable's test enforced the law FOR ONE COMPONENT. A law
 * with one enforced instance is a law the next component will break, which is exactly what
 * happened. The check now applies to both grids on the page.
 */

const runs = [
  { id: 3, started_at: '2026-08-12T03:00:00Z', finished_at: '2026-08-12T03:00:15Z', status: 'ok', accounts_ok: 64, accounts_failed: 0, accounts_discovered: 64, rows_upserted: 259, error: null },
  { id: 2, started_at: '2026-08-12T00:00:00Z', finished_at: '2026-08-12T00:00:19Z', status: 'ok', accounts_ok: 64, accounts_failed: 0, accounts_discovered: 64, rows_upserted: 260, error: null },
];

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => {
      const q: Record<string, unknown> = {};
      const chain = new Proxy(q, {
        get: (_t, prop) => {
          if (prop === 'then') return (res: (v: unknown) => void) => res({ data: runs, error: null });
          return () => chain;
        },
      });
      return chain;
    },
  },
  isSupabaseConfigured: true,
}));

const { default: FreshnessSection } = await import('./FreshnessIndicator');

/** Every element carrying a responsive column template. See AccountsTable.test.tsx. */
function gridded(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('*')]
    .filter(e => e.classList.contains('grid') && [...e.classList].some(c => c.startsWith('grid-cols-[')));
}

const templates = (el: HTMLElement) =>
  [...el.classList].filter(c => /^(?:[a-z]{2}:)?grid-cols-\[/.test(c));

const trackCount = (cls: string) =>
  cls.replace(/^(?:[a-z]{2}:)?grid-cols-\[/, '').replace(/\]$/, '').split('_').length;

/** Which cells survive at a breakpoint, resolved exactly as CSS resolves them. */
const visibleAt = (el: HTMLElement, bp: '' | 'sm' | 'md' | 'lg' | 'xl') => {
  const order = ['', 'sm', 'md', 'lg', 'xl'];
  const at = order.indexOf(bp);
  return [...el.children].filter(child => {
    const cls = [...(child as HTMLElement).classList];
    let shown = true;
    for (const b of order.slice(0, at + 1)) {
      const prefix = b ? `${b}:` : '';
      if (cls.includes(`${prefix}hidden`)) shown = false;
      else if (cls.includes(`${prefix}block`) || cls.includes(`${prefix}flex`)) shown = true;
    }
    return shown;
  }).length;
};

beforeEach(() => vi.clearAllMocks());

describe('⛔ HIDING A COLUMN MUST ALSO DROP ITS TRACK — the pull history obeys it too', () => {
  it('the header and every row carry the IDENTICAL responsive template set', async () => {
    const { container } = render(<FreshnessSection />);
    await screen.findAllByText(/^ok$/);

    const els = gridded(container);
    expect(els.length).toBe(1 + runs.length);

    const sets = new Set(els.map(e => templates(e).sort().join('|')));
    expect(sets.size, [...sets].join('\n')).toBe(1);

    // And it is genuinely responsive. A single template IS the defect.
    expect(templates(els[0]).length).toBeGreaterThan(1);
  });

  it('🔑 THE COUNTS MATCH: tracks at a breakpoint === cells visible at that breakpoint', async () => {
    const { container } = render(<FreshnessSection />);
    await screen.findAllByText(/^ok$/);
    const row = gridded(container)[1];

    const byBp = Object.fromEntries(
      templates(row).map(c => [c.includes(':') ? c.split(':')[0] : '', trackCount(c)]),
    ) as Record<string, number>;

    for (const bp of ['', 'sm', 'md', 'lg', 'xl'] as const) {
      expect(byBp[bp], `no template declared at "${bp || 'base'}"`).toBeGreaterThan(0);
      expect(visibleAt(row, bp), `breakpoint "${bp || 'base'}"`).toBe(byBp[bp]);
    }
  });

  it('the flexible track is first, singular, and can actually shrink', async () => {
    const { container } = render(<FreshnessSection />);
    await screen.findAllByText(/^ok$/);
    for (const c of templates(gridded(container)[0])) {
      // A bare `1fr` has an `auto` minimum, so a long date string pushes the grid wider
      // than its container instead of truncating. That IS the cutoff.
      expect(c, c).toContain('minmax(0,1fr)');
      expect(c.match(/1fr/g)?.length, c).toBe(1);
    }
  });

  it('⛔ NOTHING HERE MAY WRAP — wrapping is the mechanism of the original defect', async () => {
    const { container } = render(<FreshnessSection />);
    await screen.findAllByText(/^ok$/);
    expect(container.querySelectorAll('[class*="flex-wrap"]')).toHaveLength(0);
  });
});

describe('a grid of divs still has to announce as a table', () => {
  it('carries table, row and columnheader roles', async () => {
    render(<FreshnessSection />);
    await screen.findAllByText(/^ok$/);
    // Without these a screen reader gets five runs as fifteen loose strings with no column
    // names attached to any of them.
    expect(screen.getByRole('table', { name: /recent meta pulls/i })).toBeInTheDocument();
    expect(screen.getAllByRole('row').length).toBe(1 + runs.length);
    expect(screen.getAllByRole('columnheader').length).toBe(5);
  });

  it('a dropped column keeps its value reachable in the row title, never deletes it', async () => {
    const { container } = render(<FreshnessSection />);
    await screen.findAllByText(/^ok$/);
    const first = gridded(container)[1].querySelector('[title]') as HTMLElement;
    // Duration and the row count are hidden at narrow widths. Hidden is not deleted.
    expect(first.getAttribute('title')).toMatch(/ran \d+s/);
    expect(first.getAttribute('title')).toMatch(/rows/);
  });
});
