import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * THE COMPLAINT THIS FILE MEASURES, verbatim: "the UI is so shit. There's like cutoffs and
 * stuff on it", and "fix this account mapping ... it just seems so broken".
 *
 * ⭐ WHY A STRUCTURAL TEST AND NOT A SCREENSHOT. "Cutoffs" sounds like a look-at-it problem
 * and it is not: the old edit row was `flex flex-wrap` over fixed widths summing to 882px
 * inside an 864px box, so it wrapped at EVERY desktop width. Flexbox breaks on hypothetical
 * main size, before shrinking, which means the defect is a property of the CLASS LIST and is
 * decidable without rendering pixels. A screenshot proves one viewport; this proves the
 * mechanism.
 *
 * The law: ONE grid template, shared by the header and every row, so the columns cannot
 * drift apart. The old component declared its widths twice, differently, in read and edit
 * state — clicking a row injected a 190px column and collapsed the name cell by ~240px.
 */

const rows = [
  // The measured defect row: the raw Meta id sat in company_name and was rendered BOLD,
  // with the real client name as muted subtext. Inverted and wrong.
  { account_id: '10170221', meta_name: 'Columbia Outdoor Restoration X SocialWorks', company_name: '10170221, USD', program: 'Done For You', media_buyer: 'Jez', status: 'active', first_seen: '2025-01-01', last_seen: '2026-08-11' },
  // A curated mapping — the healthy control.
  { account_id: '596293242787360', meta_name: 'Backyard Paradiso', company_name: 'Backyard Paradiso Ltd', program: 'Done With You', media_buyer: 'Jez', status: 'active', first_seen: '2025-01-01', last_seen: '2026-08-11' },
  // Never mapped, and SPENDING. The most expensive thing this screen can fail to say.
  { account_id: '180824381572015', meta_name: 'SocialWorks', company_name: null, program: null, media_buyer: null, status: 'active', first_seen: '2025-01-01', last_seen: '2026-08-11' },
];
const spend = [
  { account_id: '10170221', spend_30d: 120, leads_30d: 3 },
  { account_id: '596293242787360', spend_30d: 10742.74, leads_30d: 230 },
  { account_id: '180824381572015', spend_30d: 5000, leads_30d: 40 },
];

const from = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (t: string) => from(t) },
  isSupabaseConfigured: true,
}));

beforeEach(() => {
  from.mockReset();
  from.mockImplementation((table: string) => ({
    select: () => Promise.resolve(
      table === 'ad_accounts' ? { data: rows, error: null } : { data: spend, error: null },
    ),
  }));
});

const { default: AccountsTable } = await import('./AccountsTable');

/**
 * Every element carrying the shared column template.
 * ⚠️ Filtered in JS, not by a CSS attribute selector: jsdom's selector engine cannot parse
 * an unescaped `[` inside an attribute value, so `[class*="grid-cols-["]` silently matches
 * NOTHING — a selector that returns an empty set makes every assertion below vacuous rather
 * than failing. Found by dumping the DOM, not by reading the selector.
 */
function gridded(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('*')]
    .filter(e => e.classList.contains('grid') && [...e.classList].some(c => c.startsWith('grid-cols-[')));
}

describe('🔴 THE CUTOFFS: column geometry is declared ONCE and shared', () => {
  it('the header and every row carry the IDENTICAL grid template', async () => {
    const { container } = render(<AccountsTable />);
    await screen.findByText('Backyard Paradiso Ltd');

    const els = gridded(container);
    // header + 3 rows
    expect(els.length).toBe(4);

    const templateOf = (el: HTMLElement) =>
      [...el.classList].find(c => c.startsWith('grid-cols-['));
    const templates = new Set(els.map(templateOf));

    // ⭐ ONE distinct template across the whole table. If read and edit states, or the
    // header and the rows, ever declare their widths separately again, this goes to 2.
    expect(templates.size, `templates found: ${[...templates].join(' | ')}`).toBe(1);
  });

  it('⛔ NOTHING IN THE TABLE MAY WRAP — `flex-wrap` is the mechanism of the defect', async () => {
    const { container } = render(<AccountsTable />);
    await screen.findByText('Backyard Paradiso Ltd');
    expect(container.querySelectorAll('[class*="flex-wrap"]')).toHaveLength(0);
  });

  it('every flexible cell can actually shrink — `min-w-0` is what lets text truncate', async () => {
    // A grid/flex child defaults to `min-width:auto`, so a long unbreakable name pushes the
    // track wider than its container instead of truncating. That IS the cutoff.
    const { container } = render(<AccountsTable />);
    await screen.findByText('Backyard Paradiso Ltd');
    const template = [...gridded(container)[0].classList].find(c => c.startsWith('grid-cols-['));
    expect(template).toContain('minmax(0,1fr)');
  });
});

describe('🔴 THE INVERSION: "it shouldn\'t even say airtable, it should say company name"', () => {
  it('a raw account id is NEVER rendered as the company name', async () => {
    render(<AccountsTable />);
    await screen.findByText('Backyard Paradiso Ltd');

    // The number must not appear as a company anywhere. It is still allowed in the
    // Account ID column, so this asserts on the exact junk string, which only ever came
    // from company_name.
    expect(screen.queryByText('10170221, USD')).not.toBeInTheDocument();
  });

  it('the row with junk instead of a name says so, and still shows the real Meta name', async () => {
    render(<AccountsTable />);
    await screen.findByText('Columbia Outdoor Restoration X SocialWorks');

    // Named honestly rather than silently showing the number.
    expect(screen.getAllByText('Unmapped').length).toBeGreaterThan(0);
  });

  it('🔑 ANTI-VACUITY: a real company name IS rendered as the title', async () => {
    // Without this, the arms above pass if the component rendered nothing at all.
    render(<AccountsTable />);
    expect(await screen.findByText('Backyard Paradiso Ltd')).toBeInTheDocument();
  });
});

describe('🔴 SORT: an unmapped account that is SPENDING must be impossible to miss', () => {
  it('needs-attention rows come first, ordered by spend', async () => {
    const { container } = render(<AccountsTable />);
    await screen.findByText('Backyard Paradiso Ltd');

    const dataRows = gridded(container).slice(1); // drop the header
    const titles = dataRows.map(r => r.textContent ?? '');

    // $5,000 unmapped outranks the $120 unmapped, and both outrank the healthy $10,742 row.
    expect(titles[0]).toContain('SocialWorks');
    expect(titles[1]).toContain('Columbia Outdoor Restoration');
    expect(titles[2]).toContain('Backyard Paradiso Ltd');
  });

  it('the spend is rendered, which is what turns the badge into a priority', async () => {
    render(<AccountsTable />);
    expect(await screen.findByText('$5,000')).toBeInTheDocument();
    expect(screen.getByText('$10,743')).toBeInTheDocument();
  });
});

describe('honest states', () => {
  it('a FAILED LOAD says so and offers a retry — it is not an empty table', async () => {
    from.mockImplementation((table: string) => ({
      select: () => Promise.resolve(
        table === 'ad_accounts'
          ? { data: null, error: { message: 'permission denied for table ad_accounts' } }
          : { data: [], error: null },
      ),
    }));
    render(<AccountsTable />);
    expect(await screen.findByText(/permission denied/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('⭐ A FAILED SPEND READ DOES NOT BLANK THE TABLE — spend is decoration on identity', async () => {
    // Two reads, two blast radii. Losing the aggregate must cost the PRIORITISATION, not
    // the mapping screen, or a slow view takes down the thing it was only annotating.
    from.mockImplementation((table: string) => ({
      select: () => Promise.resolve(
        table === 'ad_accounts'
          ? { data: rows, error: null }
          : { data: null, error: { message: 'relation does not exist' } },
      ),
    }));
    const { container } = render(<AccountsTable />);
    expect(await screen.findByText('Backyard Paradiso Ltd')).toBeInTheDocument();
    expect(gridded(container).slice(1)).toHaveLength(3);
  });

  it('an EMPTY table and a FAILED one read differently', async () => {
    from.mockImplementation(() => ({ select: () => Promise.resolve({ data: [], error: null }) }));
    render(<AccountsTable />);
    expect(await screen.findByText(/appear automatically after the first Meta pull/)).toBeInTheDocument();
  });
});

describe('the edit control is reachable without a mouse hover', () => {
  it('⛔ NOT `opacity-0` — that makes every row permanently uneditable on touch', async () => {
    const { container } = render(<AccountsTable />);
    await screen.findByText('Backyard Paradiso Ltd');

    const editButtons = [...container.querySelectorAll('button')].filter(
      b => /^Edit/.test(b.getAttribute('aria-label') ?? ''),
    );
    expect(editButtons.length).toBe(3);
    for (const b of editButtons) {
      // Present at rest, low contrast — what the Linear members table does. A control that
      // is invisible until hover does not exist on a touch device, and it stays CLICKABLE
      // at opacity 0, so a mouse user can hit a button they cannot see.
      expect(b.className).not.toMatch(/opacity-0/);
    }
  });
});

/**
 * 🔴 THE CUTOFF CAME BACK THROUGH THE FIX FOR IT.
 *
 * The first version declared ONE six-track template and hid columns with `hidden sm:block`
 * on the CHILDREN. `display:none` removes a grid ITEM; it does not remove a TRACK. So
 * 492px of fixed tracks plus 60px of gaps stayed on the grid at EVERY viewport,
 * `minmax(0,1fr)` absorbed the whole deficit, and the company column computed to 0px
 * between 1024 and 1076px and overflowed a 375px page by 225px.
 *
 * The law: a hidden column must also drop its track. Both halves live in one constant, so
 * this is decidable from the class list without rendering pixels — the same reason the
 * original test is structural rather than a screenshot.
 */
describe('⛔ HIDING A COLUMN MUST ALSO DROP ITS TRACK', () => {
  /**
   * ⚠️ `[a-z]{2}` COULD NOT SEE `2xl:`. It matched sm/md/lg/xl and silently skipped the
   * widest breakpoint the moment one was declared — so the law below would have gone on
   * passing while the template and the visibility classes drifted apart at exactly the
   * width the Account ID column now returns at. A checker blind to a breakpoint is worse
   * than no checker at that breakpoint: it reports "covered".
   */
  const BREAKPOINTS = ['', 'sm', 'md', 'lg', 'xl', '2xl'] as const;
  const templates = (el: HTMLElement) =>
    [...el.classList].filter(c => /^(?:[a-z0-9]+:)?grid-cols-\[/.test(c));

  /** Track count of one `grid-cols-[a_b_c]` class. */
  const trackCount = (cls: string) =>
    cls.replace(/^(?:[a-z0-9]+:)?grid-cols-\[/, '').replace(/\]$/, '').split('_').length;

  /** Which optional cells survive at a breakpoint, from their visibility classes. */
  const visibleAt = (el: HTMLElement, bp: (typeof BREAKPOINTS)[number]) => {
    const order = [...BREAKPOINTS] as string[];
    const at = order.indexOf(bp);
    return [...el.children].filter(child => {
      const cls = [...(child as HTMLElement).classList];
      // Last directive at or below the active breakpoint wins, exactly as CSS resolves it.
      let shown = true;
      for (const b of order.slice(0, at + 1)) {
        const prefix = b ? `${b}:` : '';
        if (cls.includes(`${prefix}hidden`)) shown = false;
        else if (cls.includes(`${prefix}block`) || cls.includes(`${prefix}flex`)) shown = true;
      }
      return shown;
    }).length;
  };

  it('every breakpoint declares its own template, and the header and rows share them', async () => {
    const { container } = render(<AccountsTable />);
    await screen.findByText('Backyard Paradiso Ltd');

    const els = gridded(container);
    expect(els.length).toBe(4); // header + 3 rows

    // ⭐ Still ONE geometry, now a responsive one: every element carries the IDENTICAL set.
    const sets = new Set(els.map(e => templates(e).sort().join('|')));
    expect(sets.size, [...sets].join('\n')).toBe(1);

    // And it is genuinely responsive — a single template is the defect.
    expect(templates(els[0]).length).toBeGreaterThan(1);
  });

  it('🔑 THE COUNTS MATCH: tracks at a breakpoint === cells visible at that breakpoint', async () => {
    const { container } = render(<AccountsTable />);
    await screen.findByText('Backyard Paradiso Ltd');
    const row = gridded(container)[1];

    const byBp = Object.fromEntries(
      templates(row).map(c => [c.includes(':') ? c.split(':')[0] : '', trackCount(c)]),
    ) as Record<string, number>;

    // Every breakpoint that has a template must have exactly that many visible children.
    // This is the assertion the original file was missing: it checked that ONE template
    // existed and never that the template matched what was on screen.
    for (const bp of BREAKPOINTS) {
      expect(byBp[bp], `no template declared at "${bp || 'base'}"`).toBeGreaterThan(0);
      expect(visibleAt(row, bp), `breakpoint "${bp || 'base'}"`).toBe(byBp[bp]);
    }
  });

  it('the flexible track is always first and always shrinkable', async () => {
    const { container } = render(<AccountsTable />);
    await screen.findByText('Backyard Paradiso Ltd');
    for (const c of templates(gridded(container)[0])) {
      expect(c, c).toContain('minmax(0,1fr)');
      // Exactly one flexible track. Two would reintroduce a name column that cannot be
      // reasoned about, which is how the widths drifted apart the first time.
      expect(c.match(/1fr/g)?.length, c).toBe(1);
    }
  });
});

/**
 * 🔴 "34 need a company name" ON A TABLE WHERE 51 OF 52 HAVE ONE.
 *
 * The rail counted `classifyMapping(r) !== 'mapped'` and labelled the total as missing
 * names. 33 of those 34 were `unconfirmed`: the name is present, byte-identical to Meta's,
 * and merely never confirmed. Same class of wrongness as the bug that started this — a
 * screen stating something it has not earned.
 */
describe('🔴 THE COUNTER MUST NOT CLAIM MORE THAN IT MEASURED', () => {
  it('counts unmapped and unconfirmed separately, and labels each for what it is', async () => {
    render(<AccountsTable />);
    await screen.findByText('Backyard Paradiso Ltd');

    // Fixture: 1 unmapped (null company), 1 unconfirmed (company === meta_name is false
    // here, so it is 'mapped'), 1 with junk that classifies unmapped. Measured, not assumed:
    // '10170221, USD' -> unmapped, null -> unmapped, 'Backyard Paradiso Ltd' -> mapped.
    expect(screen.getByText('2 need a company name')).toBeInTheDocument();
    // ⭐ And it must NOT be the "everything that is not mapped" total under that wording.
    expect(screen.queryByText(/^3 need a company name$/)).not.toBeInTheDocument();
  });

  it('an unconfirmed row is counted as unconfirmed, never as a missing name', async () => {
    from.mockImplementation((table: string) => ({
      select: () => Promise.resolve(
        table === 'ad_accounts'
          ? {
              data: [
                // company_name byte-identical to meta_name: present, never confirmed.
                { account_id: '1', meta_name: 'ApexCleaningC0', company_name: 'ApexCleaningC0', program: 'Done For You', media_buyer: 'Jez', status: 'active', first_seen: null, last_seen: null },
                { account_id: '2', meta_name: 'Backyard Paradiso', company_name: 'Backyard Paradiso Ltd', program: 'Done For You', media_buyer: 'Jez', status: 'active', first_seen: null, last_seen: null },
              ],
              error: null,
            }
          : { data: [], error: null },
      ),
    }));
    render(<AccountsTable />);
    await screen.findByText('Backyard Paradiso Ltd');

    expect(screen.getByText('1 unconfirmed')).toBeInTheDocument();
    expect(screen.queryByText(/need a company name/)).not.toBeInTheDocument();
  });

  it('singular reads "1 needs", not "1 need"', async () => {
    from.mockImplementation((table: string) => ({
      select: () => Promise.resolve(
        table === 'ad_accounts'
          ? {
              data: [
                { account_id: '3', meta_name: 'SocialWorks', company_name: null, program: null, media_buyer: null, status: 'active', first_seen: null, last_seen: null },
                { account_id: '2', meta_name: 'Backyard Paradiso', company_name: 'Backyard Paradiso Ltd', program: 'Done For You', media_buyer: 'Jez', status: 'active', first_seen: null, last_seen: null },
              ],
              error: null,
            }
          : { data: [], error: null },
      ),
    }));
    render(<AccountsTable />);
    await screen.findByText('Backyard Paradiso Ltd');
    expect(screen.getByText('1 needs a company name')).toBeInTheDocument();
  });
});

describe('a measured $0 is rendered as $0, not as an em dash', () => {
  it('🔴 `!n` turned every zero-spend account into "we do not know"', async () => {
    from.mockImplementation((table: string) => ({
      select: () => Promise.resolve(
        table === 'ad_accounts'
          ? { data: [rows[1]], error: null }
          : { data: [{ account_id: '596293242787360', spend_30d: 0, leads_30d: 0 }], error: null },
      ),
    }));
    render(<AccountsTable />);
    await screen.findByText('Backyard Paradiso Ltd');
    expect(screen.getByText('$0')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });
});

/**
 * 🔴 A ROLE REPLACES THE IMPLICIT ROLE — IT DOES NOT DECORATE IT.
 *
 * The sort controls were `<button role="columnheader">`. axe-core flagged it as
 * `aria-allowed-role` on four nodes, and the consequence is worse than the rule name
 * suggests: the explicit role OVERWROTE the native one, so assistive tech was told these
 * were column headers and never told they could be pressed. The sorting affordance was
 * invisible to exactly the users who cannot see the arrow.
 *
 * The shape a real `<table>` has: the CELL carries `columnheader` + `aria-sort` (both are
 * properties of the column), the BUTTON lives inside it keeping its own role.
 */
describe('🔴 the sort headers are buttons INSIDE columnheaders, not buttons pretending to be columnheaders', () => {
  it('every columnheader keeps its role, and the sortable ones contain a real button', async () => {
    render(<AccountsTable />);
    await screen.findByText('Backyard Paradiso Ltd');

    const headers = screen.getAllByRole('columnheader');
    // Company, Account ID, Program, Media buyer, 30d spend, Edit.
    expect(headers).toHaveLength(6);

    // ⛔ THE ASSERTION THAT ACTUALLY CATCHES THE DEFECT: no columnheader may BE a button.
    for (const h of headers) expect(h.tagName).not.toBe('BUTTON');

    // ...and the four sortable ones must each still expose a pressable control.
    const withButtons = headers.filter(h => h.querySelector('button'));
    expect(withButtons).toHaveLength(4);
  });

  it('`aria-sort` names the CURRENT column and only that one', async () => {
    render(<AccountsTable />);
    await screen.findByText('Backyard Paradiso Ltd');
    const sorted = screen.getAllByRole('columnheader').filter(h => h.getAttribute('aria-sort') !== 'none' && h.hasAttribute('aria-sort'));
    expect(sorted).toHaveLength(1);
    expect(sorted[0]).toHaveTextContent('Company');
  });

  it('the sort button fills the 36px header row rather than being a 16px strip inside it', async () => {
    // Measured: the button was 16px tall in a 36px row — under the 24px WCAG 2.5.8 floor,
    // with 20px of dead space that looked exactly as clickable as the part that was.
    render(<AccountsTable />);
    await screen.findByText('Backyard Paradiso Ltd');
    const btn = screen.getByRole('button', { name: 'Company' });
    expect(btn.className).toContain('h-full');
    expect(btn.parentElement?.className).toContain('self-stretch');
  });
});

/**
 * 🔴 THE COMPANY COLUMN WAS NARROWEST AT THE TWO COMMONEST LAPTOP WIDTHS.
 *
 * Measured company-track widths: 1023→595, 1024→252, 1279→507, 1280→260, 1440→368. The
 * `lg` reversal is documented and deliberate; `xl` then did the SAME THING one breakpoint
 * later by bringing Account ID (128px) and Media buyer (96px) back together on one extra
 * pixel of viewport, clipping 18 of 52 company names and 36 of 52 Meta-name subtitles.
 */
describe('🔴 a column may only return when the width that pays for it has arrived', () => {
  it('the widest optional column (Account ID) waits for 2xl, and its inline fallback waits with it', async () => {
    const { container } = render(<AccountsTable />);
    await screen.findByText('Backyard Paradiso Ltd');
    const header = gridded(container)[0];
    const cls = [...header.classList];

    // xl adds Media buyer only — five tracks, not six.
    const xl = cls.find(c => c.startsWith('xl:grid-cols-['))!;
    const xl2 = cls.find(c => c.startsWith('2xl:grid-cols-['))!;
    const tracks = (t: string) => t.slice(t.indexOf('[') + 1, -1).split('_').length;
    expect(tracks(xl)).toBe(5);
    expect(tracks(xl2)).toBe(6);

    // ⭐ THE LAW: template and cell visibility change TOGETHER. An `Account ID` column that
    // appears at 2xl while its cells say `xl` is the zero-width-column defect, restored.
    const idHeader = screen.getAllByRole('columnheader').find(h => h.textContent === 'Account ID')!;
    expect(idHeader.className).toContain('2xl:block');
    expect(idHeader.className).not.toMatch(/(^|\s)xl:block/);
  });

  it('the id is never simply dropped — it renders inline wherever its column is absent', async () => {
    render(<AccountsTable />);
    await screen.findByText('Backyard Paradiso Ltd');
    // Two nodes carry it: the inline subtext (hidden from 2xl) and the column (shown from 2xl).
    const inline = screen.getAllByTitle('10170221').find(e => e.className.includes('2xl:hidden'));
    expect(inline).toBeTruthy();
  });
});

describe('🔴 the two attention counts are controls, and had no rest-state cue on any device', () => {
  it('they carry a border at rest, not only a hover colour', async () => {
    render(<AccountsTable />);
    await screen.findByText('Backyard Paradiso Ltd');
    const chip = screen.getByRole('button', { name: /need a company name/ });
    // `hover:text-…` is not an affordance on touch, where the hover never arrives.
    expect(chip.className).toMatch(/border-warning-strong\/25/);
    // ...and 24px, the WCAG 2.5.8 floor these two were 4px under.
    expect(chip.className).toContain('h-6');
  });

  it('the static total beside them is NOT a button — the distinction is the point', async () => {
    render(<AccountsTable />);
    await screen.findByText('Backyard Paradiso Ltd');
    expect(screen.queryByRole('button', { name: /^\d+ accounts$/ })).not.toBeInTheDocument();
  });
});

describe('🔴 `role="table"` requires row children, and three of four states had none', () => {
  it('the load-failure branch is a row with a cell, not a bare div', async () => {
    from.mockImplementation((table: string) => ({
      select: () => Promise.resolve(
        table === 'ad_accounts'
          ? { data: null, error: { message: 'permission denied for table ad_accounts' } }
          : { data: [], error: null },
      ),
    }));
    render(<AccountsTable />);
    await screen.findByText(/permission denied/);
    // The message must live inside the table's own row structure, or AT may drop the subtree.
    // Rows here are the header row and the message row; the message is the last one.
    const rows = screen.getAllByRole('row');
    expect(rows.at(-1)!.querySelector('[role="cell"]')?.textContent).toMatch(/permission denied/);
  });

  it('the empty-filter branch is a row with a cell too', async () => {
    from.mockImplementation((table: string) => ({
      select: () => Promise.resolve(table === 'ad_accounts' ? { data: [], error: null } : { data: [], error: null }),
    }));
    render(<AccountsTable />);
    await screen.findByText(/No ad accounts yet/);
    const rows = screen.getAllByRole('row');
    expect(rows.at(-1)!.querySelector('[role="cell"]')?.textContent).toMatch(/No ad accounts yet/);
  });
});
