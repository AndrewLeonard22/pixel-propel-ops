/**
 * The Settings page model: a sticky in-page section rail beside one content column.
 * Taken from the Linear settings reference, which is a rail of quiet 32px items with a
 * pale-blue soft-selected state and NO card around the content.
 *
 * ⛔ `card-elevated` does not appear on this page any more. Seven stacked bordered boxes
 * with shadows, each holding more bordered boxes, is exactly "no cluttered card nesting"
 * and "no old admin dashboard feel" in the rubric. Sections are separated by space and a
 * heading, which is what the reference does.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface SettingsSection {
  id: string;
  label: string;
  group: string;
  title: string;
  description?: string;
  render: () => React.ReactNode;
}

export default function SettingsShell({
  sections, header,
}: {
  sections: SettingsSection[];
  header?: React.ReactNode;
}) {
  const [active, setActive] = useState(sections[0]?.id);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const refs = useRef<Record<string, HTMLElement | null>>({});

  const groups = useMemo(() => {
    const out: { group: string; items: SettingsSection[] }[] = [];
    for (const s of sections) {
      const last = out[out.length - 1];
      if (last && last.group === s.group) last.items.push(s);
      else out.push({ group: s.group, items: [s] });
    }
    return out;
  }, [sections]);

  // Scroll-spy against the SCROLL CONTAINER, not the window: AppLayout puts the scroll on
  // <main>, so an IntersectionObserver with a default (viewport) root would still work but
  // a window-scroll listener would never fire.
  useEffect(() => {
    /**
     * ⛔ DECORATION MUST NOT BE ABLE TO TAKE THE PAGE DOWN. `IntersectionObserver` is absent
     * in jsdom and in older browsers, and an unguarded `new IntersectionObserver` in an
     * effect throws during commit — which React escalates into unmounting the whole tree.
     * Measured: it took out all 24 Settings tests at once, and would have taken out the
     * settings page itself anywhere the API is missing.
     *
     * Highlighting the current section is a nicety. Without it the rail still navigates.
     */
    if (typeof IntersectionObserver === 'undefined') return;
    const el = scrollerRef.current?.closest('main') ?? null;
    const io = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target.id) setActive(visible.target.id);
      },
      { root: el, rootMargin: '0px 0px -70% 0px', threshold: 0 },
    );
    for (const s of sections) {
      const node = refs.current[s.id];
      if (node) io.observe(node);
    }
    return () => io.disconnect();
  }, [sections]);

  return (
    <div ref={scrollerRef} className="flex gap-12 max-w-[1120px]">
      <nav className="hidden lg:block w-[184px] shrink-0">
        <div className="sticky top-0 space-y-6 py-1">
          {groups.map(g => (
            <div key={g.group} className="space-y-0.5">
              {/* ⚠️ NOT `/70`. `--muted-foreground` was deliberately raised to 4.74:1 for
                  contrast, and diluting it to 70% opacity here put it back at #9d9d9d over
                  white — 2.7:1, at 12px, on the labels that say what the rail is grouped by.
                  A token tuned for contrast cannot be re-diluted at the call site. */}
              <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">{g.group}</div>
              {g.items.map(s => (
                <button
                  key={s.id}
                  onClick={() => refs.current[s.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className={cn(
                    'flex w-full items-center h-8 px-2 rounded-md text-[13px] text-left transition-colors',
                    'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                    active === s.id
                      ? 'bg-accent text-accent-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-row-hover',
                  )}
                >
                  <span className="truncate">{s.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </nav>

      <div className="min-w-0 flex-1 space-y-12">
        {header}
        {sections.map(s => (
          <section
            key={s.id}
            id={s.id}
            ref={el => { refs.current[s.id] = el; }}
            className="scroll-mt-4 space-y-4"
          >
            <div>
              <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{s.title}</h2>
              {s.description && (
                <p className="mt-1 text-[13px] text-muted-foreground">{s.description}</p>
              )}
            </div>
            {s.render()}
          </section>
        ))}
      </div>
    </div>
  );
}
