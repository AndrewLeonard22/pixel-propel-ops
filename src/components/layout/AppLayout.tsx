import AppSidebar from './AppSidebar';
import { RefreshCw } from 'lucide-react';
import { useData } from '@/hooks/useData';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { lastUpdated, refresh, loading } = useData();

  const timeAgo = lastUpdated
    ? `${Math.round((Date.now() - lastUpdated.getTime()) / 60000)} min ago`
    : null;

  return (
    <div className="flex min-h-screen w-full bg-background">
      <AppSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b flex items-center justify-between px-6 bg-card shrink-0">
          <div className="lg:hidden w-10" /> {/* spacer for mobile hamburger */}
          <div className="hidden lg:block" />
          <div className="flex items-center gap-3">
            {timeAgo && (
              <span className="text-xs text-muted-foreground">Updated {timeAgo}</span>
            )}
            <button
              onClick={refresh}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border hover:bg-accent transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </header>
        <main className="flex-1 p-6 fade-in">
          {children}
        </main>
      </div>
    </div>
  );
}
