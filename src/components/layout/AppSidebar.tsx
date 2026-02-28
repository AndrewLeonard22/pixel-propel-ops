import { Home, Users, BarChart2, TrendingUp, Settings, Menu, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useState } from 'react';
import logo from '@/assets/logo.jpg';

const navItems = [
  { label: 'Dashboard', path: '/', icon: Home },
  { label: 'Accounts', path: '/accounts', icon: Users },
  { label: 'Campaigns', path: '/campaigns', icon: BarChart2 },
  { label: 'Team Performance', path: '/team', icon: TrendingUp },
  { label: 'Settings', path: '/settings', icon: Settings },
];

export default function AppSidebar() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const sidebarContent = (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
      {/* Logo */}
      <div className="p-5 flex items-center gap-3">
        <img src={logo} alt="SocialWorks Growth Partners" className="h-8 w-auto" />
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 mt-4 space-y-1">
        {navItems.map(item => {
          const active = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                active
                  ? 'bg-sidebar-accent text-sidebar-foreground font-medium'
                  : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent/50'
              }`}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-sidebar-border">
        <span className="text-xs text-sidebar-muted">v2.0</span>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-lg bg-sidebar text-sidebar-foreground"
        aria-label="Toggle menu"
      >
        {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-foreground/20 z-40"
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
