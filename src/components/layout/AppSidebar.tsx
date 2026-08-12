/**
 * 🔴 THE PALETTE EXISTED TWICE AND ONLY ONE COPY COULD BE CHANGED.
 *
 * Every colour in this file was an inline `style={{…}}` hex literal — nine of them, plus two
 * `onMouseEnter`/`onMouseLeave` pairs writing `.style.color` directly on the DOM node —
 * while `tailwind.config.ts` already defines `bg-sidebar`, `text-sidebar-foreground`,
 * `border-sidebar-border`, `bg-sidebar-accent` and `text-sidebar-muted` for those EXACT
 * values (see `--sidebar-*` in index.css). So the app carried two copies of one palette and
 * the one that actually painted the screen was invisible to the token system: a theme change
 * would move every surface in the product except the first one you look at.
 *
 * ⛔ AND HAND-ROLLED HOVER IS NOT A STYLE, IT IS STATE. `onMouseLeave` resetting a literal
 * is a `:hover` that can get stuck — a click that unmounts the row, or a re-render between
 * the two events, leaves the hovered colour painted with no pointer on it. CSS `:hover`
 * cannot desynchronise, because there is no synchronising to do.
 *
 * ⭐ Also fixes a real navigation defect: `/agents` is a routed, finished page that appeared
 * in NO nav, reachable only by typing the URL, and `Accounts` / `Campaigns` are two complete
 * pages this repo actively maintains (both are named as live surfaces in accountRegistry.ts)
 * that were routed nowhere at all. See App.tsx.
 */
import { Home, TrendingUp, Target, Settings, Menu, X, CalendarDays, Building2, Megaphone, Users } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const navItems = [
  { label: 'Dashboard', path: '/', icon: Home },
  { label: 'Accounts', path: '/accounts', icon: Building2 },
  { label: 'Campaigns', path: '/campaigns', icon: Megaphone },
  { label: 'Appointments', path: '/calendar', icon: CalendarDays },
  // Labelled "Agents" and not "Setters": the page's own <h1> says Agents, and a nav item
  // whose word does not appear on the page it opens is a second name for one thing.
  { label: 'Agents', path: '/agents', icon: Users },
  { label: 'Media Buying', path: '/team', icon: TrendingUp },
  { label: 'Targets', path: '/targets', icon: Target },
];

export default function AppSidebar() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const sidebarContent = (
    <div className="flex h-full flex-col bg-sidebar">
      {/* Brand */}
      <div className="flex h-14 items-center border-b border-sidebar-border px-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-sidebar-primary text-[10px] font-bold text-sidebar-primary-foreground">
            SW
          </div>
          <span className="text-[13px] font-semibold tracking-tight text-sidebar-foreground">SocialWorks</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="mt-4 flex-1">
        {navItems.map(item => {
          const active = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={() => setMobileOpen(false)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 border-l-2 px-5 py-2 text-[13px] transition-colors',
                active
                  ? 'border-sidebar-primary bg-sidebar-primary/[0.16] font-medium text-sidebar-foreground'
                  : 'border-transparent text-sidebar-muted hover:bg-sidebar-primary/[0.08] hover:text-sidebar-foreground',
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border px-5 py-3">
        <Link
          to="/settings"
          onClick={() => setMobileOpen(false)}
          aria-current={location.pathname === '/settings' ? 'page' : undefined}
          className={cn(
            'flex items-center gap-2 text-[12px] transition-colors hover:text-sidebar-muted',
            location.pathname === '/settings' ? 'text-sidebar-foreground' : 'text-sidebar-muted/70',
          )}
        >
          <Settings className="h-3.5 w-3.5" />
          <span>Settings</span>
        </Link>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="fixed left-4 top-4 z-50 rounded bg-sidebar p-2 text-sidebar-foreground lg:hidden"
        aria-label="Toggle menu"
        aria-expanded={mobileOpen}
      >
        {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <aside className={`lg:hidden fixed inset-y-0 left-0 z-40 w-[220px] transform transition-transform ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {sidebarContent}
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden lg:block w-[220px] shrink-0 h-screen sticky top-0">
        {sidebarContent}
      </aside>
    </>
  );
}
