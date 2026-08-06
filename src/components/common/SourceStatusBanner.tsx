import { AlertTriangle, PlugZap, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useData } from '@/hooks/useData';
import { needsAttention, SOURCE_KEYS, type SourceStatus } from '@/lib/sourceStatus';

/**
 * Says, per source, what is wrong and what the numbers on screen are worth.
 *
 * WHY IT IS GLOBAL: four of the seven routed pages never read the error state at all, so
 * a total pipeline failure produced no visible signal anywhere on /targets, /agents,
 * /calendar or /call-center. Mounting this in AppLayout means a source failure is visible
 * wherever the user happens to be standing, rather than only on the two pages whose
 * author happened to destructure `error`.
 *
 * It is silent when everything is valid — a banner that is always present is furniture.
 */
function stateLine(s: SourceStatus): { icon: typeof AlertTriangle; tone: string; text: string } | null {
  switch (s.state) {
    case 'not-configured':
      return {
        icon: PlugZap,
        tone: 'text-muted-foreground',
        // Enumerate what is missing. "Not configured" alone does not tell anyone what to type.
        text: `${s.label} — not connected. Missing: ${s.missingSettings.join(', ')}. Nothing is shown for it.`,
      };
    case 'failed':
      return {
        icon: AlertTriangle,
        tone: 'text-destructive',
        // The failure's own words, and an explicit statement that the absence is not a zero.
        text: `${s.label} — could not load${s.error ? `: ${s.error}` : ''}. Its numbers are shown as — , not as zero.`,
      };
    case 'stale':
      return {
        icon: Clock,
        tone: 'text-warning',
        text: `${s.label} — the latest refresh failed${s.error ? ` (${s.error})` : ''}. Showing the last good data${
          s.lastSuccessAt ? `, received ${s.lastSuccessAt.toLocaleTimeString()}` : ''
        }.`,
      };
    case 'incomplete':
      // Reserved for Phase 2's validation report. Nothing produces this state yet; it is
      // handled here so wiring it up is a one-line change rather than a UI project.
      return {
        icon: AlertTriangle,
        tone: 'text-warning',
        text: `${s.label} — the last refresh did not pass validation${s.error ? `: ${s.error}` : ''}. Treat these numbers as provisional.`,
      };
    default:
      return null;
  }
}

export default function SourceStatusBanner() {
  const { sources, refresh, settingsLoaded, loading } = useData();

  // Before the settings have loaded, "not connected" is not known to be true. Saying it
  // early is the same defect as printing a zero for a source that failed.
  if (!settingsLoaded) return null;

  const problems = SOURCE_KEYS.map(k => sources[k]).filter(needsAttention);
  if (problems.length === 0) return null;

  const anyRetryable = problems.some(s => s.state === 'failed' || s.state === 'stale' || s.state === 'incomplete');

  return (
    <div className="border border-border rounded-xl bg-card px-4 py-3 space-y-2" role="status" aria-live="polite">
      {problems.map(s => {
        const line = stateLine(s);
        if (!line) return null;
        const Icon = line.icon;
        return (
          <div key={s.key} className="flex items-start gap-2.5 text-sm">
            <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${line.tone}`} />
            <p className="flex-1 text-foreground/90">{line.text}</p>
          </div>
        );
      })}
      <div className="flex items-center gap-3 pt-1">
        {anyRetryable && (
          <button
            // Wrapped, NOT `onClick={refresh}`. Passing the reference hands refresh the
            // click event as its first argument, which it used to read as override
            // settings — the reason the old Retry button did nothing at all.
            onClick={() => refresh()}
            disabled={loading}
            className="text-xs font-medium underline text-foreground disabled:opacity-50"
          >
            Try again
          </button>
        )}
        <Link to="/settings" className="text-xs font-medium underline text-muted-foreground">
          Open Settings
        </Link>
      </div>
    </div>
  );
}
