import { useEffect, useState, useMemo } from 'react';
import AppSidebar from './AppSidebar';
import { RefreshCw } from 'lucide-react';
import { useData } from '@/hooks/useData';
import { describeFreshness, freshnessLabel, freshnessWarning } from '@/lib/dataFreshness';
import AIChatPanel from '@/components/AIChatPanel';
import SourceStatusBanner from '@/components/common/SourceStatusBanner';
import { HeaderFreshness } from '@/components/settings/FreshnessIndicator';

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
              * ⭐ THE PIPELINE CLOCK, NOT THE BROWSER CLOCK.
              *
              * There used to be TWO clocks here and the second one answered a question
              * nobody asked: "Fetched N ago" was `new Date()` set when the browser's fetch
              * RESOLVED, so it always read "less than a minute ago" — a browser fact
              * masquerading as data freshness, on the one element whose entire job is to
              * report staleness. It failed in the flattering direction by construction.
              *
              * @andrew asked for "the last time the ad spend was updated". That is a fact
              * about the META PULL, and it lives in `ad_pull_runs`. See src/lib/adFreshness.ts
              * for why the two obvious alternatives (max(fetched_at), cron.job_run_details)
              * both read FRESH over a dead pipeline.
              *
              * The source-date label stays beside it: they answer different questions
              * ("how new is the newest ROW" vs "when did we last SUCCEED"), and a frozen
              * feed moves one and not the other. The browser clock survives only as a
              * tooltip on the source-date label.
              */}
            {freshness.latestDate && (
              <span
                className={`text-xs ${freshness.state === 'stale' ? 'text-destructive font-medium' : 'text-muted-foreground'}`}
                title={`The newest date present in the ad spend data itself.${timeAgo ? ` This browser last pulled ${timeAgo}.` : ''}`}
              >
                {freshnessLabel(freshness)}
              </span>
            )}
            {/* The separator belongs to the badge, not to the header: `HeaderFreshness`
                returns null while its query is in flight, so a middot rendered here was
                shown alone on every page load. See FreshnessIndicator. */}
            <HeaderFreshness separator={!!freshness.latestDate} />
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
        {/* ⚠️ `pb-24` IS LOAD-BEARING, NOT WHITESPACE. `AIChatPanel`'s collapsed pill is
            `fixed bottom-5 right-5` and about 120x40px, so it sits over the last ~60px of
            the scroll content at the right edge — which on the accounts table is exactly
            where the last row's Edit button lives (`justify-self-end`). Scrolled to the
            bottom of 52 rows, the only pointer affordance on that row was underneath it. */}
        <main className="flex-1 overflow-y-auto p-3 sm:p-6 pb-24 sm:pb-24 fade-in space-y-4">
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
