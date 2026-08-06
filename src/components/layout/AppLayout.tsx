import { useEffect, useState, useMemo } from 'react';
import AppSidebar from './AppSidebar';
import { RefreshCw } from 'lucide-react';
import { useData } from '@/hooks/useData';
import { describeFreshness, freshnessLabel, freshnessWarning } from '@/lib/dataFreshness';
import AIChatPanel from '@/components/AIChatPanel';
import SourceStatusBanner from '@/components/common/SourceStatusBanner';

/**
 * How long ago the app last pulled data, as a string that actually advances.
 *
 * THE BUG THIS REPLACES: `Date.now()` was evaluated during render with no timer anywhere,
 * and AppLayout sits above <Routes>, so navigation does not re-render it. It re-rendered
 * only during a refresh cycle — which meant the label was frozen at "Updated 0 min ago"
 * for as long as the tab stayed open. It failed in the flattering direction, always
 * understating staleness, on the one element whose entire job is to report staleness.
 */
function useTimeAgo(at: Date | null): string | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!at) return;
    const id = setInterval(() => tick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, [at]);
  if (!at) return null;
  const mins = Math.floor((Date.now() - at.getTime()) / 60000);
  if (mins < 1) return 'less than a minute ago';
  if (mins === 1) return '1 minute ago';
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.floor(mins / 60);
  return hrs === 1 ? 'over an hour ago' : `over ${hrs} hours ago`;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { lastUpdated, refresh, loading, adSpend } = useData();
  // Recomputed from the CURRENT feed, so it can never describe data the app has moved past.
  // `new Date()` is read here rather than module scope: a long-lived tab must not keep
  // comparing against the day it was opened.
  const freshness = useMemo(
    () => describeFreshness(adSpend, new Date().toISOString().slice(0, 10)),
    [adSpend],
  );
  const timeAgo = useTimeAgo(lastUpdated);

  return (
    <div className="flex min-h-screen w-full bg-background">
      <AppSidebar />
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        <header className="h-14 border-b flex items-center justify-between px-6 bg-card shrink-0">
          <div className="lg:hidden w-10" /> {/* spacer for mobile hamburger */}
          <div className="hidden lg:block" />
          <div className="flex items-center gap-3">
            {/**
              * TWO CLOCKS, SIDE BY SIDE, AND THE SECOND ONE IS NEW.
              *
              * "Fetched" is a BROWSER fact about the FETCH. @bird measured that it was the
              * ONLY freshness signal on the entire dashboard, with zero source dates
              * rendered anywhere — so on the day the sheet's array formula runs out, the
              * fetch still returns 200, the parse is still clean, and the screen still says
              * "Fetched less than a minute ago" over data that stopped moving. THE FREEZE
              * HAD NO SYMPTOM, and every honest-state we shipped stayed silent because
              * nothing FAILED.
              *
              * ⭐ THE COMMENT THAT USED TO BE HERE SAID THE SOURCE-DATE NORMALISATION "IS
              * NOT BUILT YET". IT IS — `normalizeSourceDate` populates `dateISO` on every
              * ad spend row, and has for a while. A true note went stale and then read as a
              * reason not to build the thing it was describing.
              */}
            {freshness.latestDate && (
              <span
                className={`text-xs ${freshness.state === 'stale' ? 'text-destructive font-medium' : 'text-muted-foreground'}`}
                title="The newest date present in the ad spend data itself. This is the clock that matters."
              >
                {freshnessLabel(freshness)}
              </span>
            )}
            {timeAgo && (
              <span className="text-xs text-muted-foreground" title="When this browser last pulled data. Not the age of the data in the source.">
                Fetched {timeAgo}
              </span>
            )}
            <button
              onClick={() => refresh()}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border hover:bg-accent transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-3 sm:p-6 fade-in space-y-4">
          {/* Global, because four of the seven pages never read the error state and a
              source failure was invisible on all of them. Silent when everything is valid. */}
          <SourceStatusBanner />
          {children}
        </main>
      </div>
      <AIChatPanel />
    </div>
  );
}
