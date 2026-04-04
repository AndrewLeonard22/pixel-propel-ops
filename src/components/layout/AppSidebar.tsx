import { Home, TrendingUp, Target, Settings, Menu, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useState } from 'react';

const navItems = [
  { label: 'Dashboard', path: '/', icon: Home },
  { label: 'Accounts', path: '/accounts', icon: Users },
  { label: 'Campaigns', path: '/campaigns', icon: BarChart2 },
  { label: 'Team Performance', path: '/team', icon: TrendingUp },
];

export default function AppSidebar() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const sidebarContent = (
    <div className="flex flex-col h-full" style={{ backgroundColor: '#0F172A' }}>
      {/* Brand */}
      <div className="h-14 flex items-center px-5 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold" style={{ backgroundColor: '#10B981', color: '#fff' }}>
            SW
          </div>
          <span className="text-[13px] font-semibold tracking-tight" style={{ color: '#e2e8f0' }}>SocialWorks</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 mt-4">
        {navItems.map(item => {
          const active = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 px-5 py-2 text-[13px] transition-colors"
              style={{
                color: active ? '#fff' : '#94a3b8',
                backgroundColor: active ? 'rgba(255,255,255,0.06)' : 'transparent',
                borderLeft: active ? '2px solid #10B981' : '2px solid transparent',
                fontWeight: active ? 500 : 400,
              }}
              onMouseEnter={e => {
                if (!active) {
                  (e.currentTarget as HTMLElement).style.color = '#e2e8f0';
                  (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.03)';
                }
              }}
              onMouseLeave={e => {
                if (!active) {
                  (e.currentTarget as HTMLElement).style.color = '#94a3b8';
                  (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                }
              }}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        <Link
          to="/settings"
          onClick={() => setMobileOpen(false)}
          className="flex items-center gap-2 text-[12px] transition-colors"
          style={{ color: '#64748b' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#94a3b8'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#64748b'; }}
        >
          <Settings className="w-3.5 h-3.5" />
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
        className="lg:hidden fixed top-4 left-4 z-50 p-2"
        style={{ backgroundColor: '#0F172A', color: '#e2e8f0', borderRadius: 4 }}
        aria-label="Toggle menu"
      >
        {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
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
