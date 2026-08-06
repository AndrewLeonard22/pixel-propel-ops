import { AlertTriangle, PlugZap, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useData } from '@/hooks/useData';
import { needsAttention, SOURCE_KEYS, type SourceStatus } from '@/lib/sourceStatus';
import { settingsAreUnverified } from '@/lib/config';
import { describeFreshness, freshnessWarning } from '@/lib/dataFreshness';
import { completenessMessage } from '@/lib/sheetCompleteness';
import { rejectionMessage } from '@/lib/refreshValidation';

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
  const { sources, refresh, settingsLoaded, loading, settingsOrigin, settingsDetail, adSpend, completeness, refreshVerdict, unresolvedClients } = useData();

  // Before the settings have loaded, "not connected" is not known to be true. Saying it
  // early is the same defect as printing a zero for a source that failed.
  if (!settingsLoaded) return null;

  /**
   * 🔴 THE LINES BELOW NAME THE USER'S SETTINGS, SO THEY MUST NOT RUN WHEN WE NEVER READ THEM.
   *
   * @bird drove every routed page of the live broken deployment and counted NINETEEN
   * "Missing: …" sentences across SIX routes — eighteen of them from this one component,
   * three per route — and ZERO of them contained the words supabase, database or
   * deployment. Every one blamed @andrew's configuration for a build that shipped without
   * its database URL and had never read his settings at all.
   *
   * ⚠️ `missingSettings` IS DERIVED FROM AN UNVERIFIED LOCAL COPY in the two unverified
   * origins, so enumerating it is inventing a specific, actionable, WRONG instruction.
   * "Missing: Google Sheet URL" sends someone to paste a URL that may already be set.
   *
   * ⭐ AND THIS COMPONENT COULD NOT HAVE BEEN FIXED FROM ConfigBanner: that banner only
   * renders when `configured` is FALSE and returns early, so it is a COLD-browser surface.
   * @bird measured a WARM browser, where `configured` is true, ConfigBanner never mounts,
   * and this is the component doing the talking. Two surfaces, one defect, and fixing the
   * first says nothing about the second.
   */
  if (settingsAreUnverified(settingsOrigin)) {
    const isBuild = settingsOrigin === 'local-not-configured';
    return (
      <div className="border border-destructive/30 rounded-xl bg-destructive/5 px-4 py-3 space-y-2" role="alert">
        <div className="flex items-start gap-2.5 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-destructive" />
          <p className="flex-1 text-foreground/90">
            {isBuild
              ? 'This app was deployed without its database URL, so it never read your settings. Nothing below reflects your account, and your saved configuration has not been lost or changed.'
              : 'Your settings could not be read from the database, so nothing below reflects your account. Your saved configuration has not been lost or changed.'}
            {settingsDetail ? ` (${settingsDetail})` : ''}
          </p>
        </div>
        {/* Retry is offered ONLY where retrying can work. A build with no URL will never
            succeed on a second attempt, and a button that cannot help is a false promise. */}
        {!isBuild && (
          <button
            onClick={() => refresh()}
            disabled={loading}
            className="text-xs font-medium underline text-foreground disabled:opacity-50"
          >
            Try again
          </button>
        )}
      </div>
    );
  }

  const problems = SOURCE_KEYS.map(k => sources[k]).filter(needsAttention);

  /**
   * 🔴 A FROZEN FEED IS NOT A FAILED SOURCE, WHICH IS WHY IT REACHED NOBODY.
   * Every predicate above asks whether a source FAILED. When the sheet's array formula runs
   * out, the fetch is 200, the parse is clean, and `needsAttention` is false for all three —
   * so this banner stayed silent over data that had stopped moving. @bird: "the freeze has
   * no symptom." A stale feed is a finding even when nothing is broken.
   */
  const staleFeed = freshnessWarning(describeFreshness(adSpend, new Date().toISOString().slice(0, 10)));

  /**
   * 🔴 THE CLIFF. A truncating sheet is not a failed source either — the fetch is 200 and
   * the rows that DO arrive are real. Only a row-count comparison can see it, and only this
   * banner can say so. 'unverifiable' is reported too: not knowing is a state, and silently
   * treating it as health is the fail-open this detector exists to refuse.
   */
  const incomplete = completenessMessage(completeness);
  /** ③ A rejected refresh: the numbers below are the LAST GOOD ones, and must say so. */
  const rejected = refreshVerdict ? rejectionMessage(refreshVerdict) : null;

  /**
   * A — @bird measured `Client Name` returning a RECORD ID on 99 of 100 records. Those
   * appointments now go UNMATCHED rather than being attributed on the strength of an id —
   * correct, and potentially most of the appointment data, so it CANNOT be silent. Without
   * this line the appointment counts would simply be lower and nothing would say why.
   */
  const unresolved = unresolvedClients > 0
    ? `${unresolvedClients.toLocaleString()} appointment${unresolvedClients > 1 ? 's are' : ' is'} not matched to an account: ` +
      `Airtable's "Client Name" is a LINKED RECORD, so it returns a record id rather than the client's name. ` +
      `They are counted in the totals but cannot be credited to an account. ` +
      `TO FIX: in Airtable, add a Lookup field on the Appointments table that pulls Name from the linked Client record, ` +
      `then point "Client Name" at it in Settings → column mappings.`
    : null;

  if (problems.length === 0 && !staleFeed && !incomplete && !rejected && !unresolved) return null;

  const anyRetryable = problems.some(s => s.state === 'failed' || s.state === 'stale' || s.state === 'incomplete');

  return (
    <div className="border border-border rounded-xl bg-card px-4 py-3 space-y-2" role="status" aria-live="polite">
      {unresolved && (
        <div className="flex items-start gap-2.5 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-destructive" />
          <p className="flex-1 text-foreground/90">{unresolved}</p>
        </div>
      )}
      {rejected && (
        <div className="flex items-start gap-2.5 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-destructive" />
          <p className="flex-1 text-foreground/90">{rejected}</p>
        </div>
      )}
      {incomplete && (
        <div className="flex items-start gap-2.5 text-sm">
          <AlertTriangle
            className={`w-4 h-4 mt-0.5 shrink-0 ${completeness.state === 'truncated' ? 'text-destructive' : 'text-muted-foreground'}`}
          />
          <p className="flex-1 text-foreground/90">{incomplete}</p>
        </div>
      )}
      {staleFeed && (
        <div className="flex items-start gap-2.5 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-warning" />
          <p className="flex-1 text-foreground/90">{staleFeed}</p>
        </div>
      )}
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
