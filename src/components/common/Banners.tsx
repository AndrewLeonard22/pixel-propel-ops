import { AlertTriangle, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import { settingsAreUnverified, type SettingsOrigin } from '@/lib/config';

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="border border-destructive/30 bg-destructive/5 rounded-xl p-4 flex items-center gap-3">
      <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
      <p className="text-sm text-destructive flex-1">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="text-xs font-medium text-destructive underline">
          Retry
        </button>
      )}
    </div>
  );
}

/**
 * ⛔ THIS BANNER MAKES A CLAIM ABOUT WHOSE FAULT IT IS, AND IT USED TO GET IT WRONG.
 *
 * "Configure your data sources" is only true when the database ANSWERED and held no
 * settings. When the read never happened — no build URL, or the request failed — we do not
 * know what the user has configured, and sending them to Settings sends them to fix
 * something that may not be broken. On 2026-08-05 that is exactly what shipped: the build
 * had no VITE_SUPABASE_URL, every read died against `unconfigured.invalid`, and this banner
 * blamed @andrew for twenty minutes.
 *
 * ⇒ `origin` is REQUIRED rather than optional. An optional prop would have let all six call
 *   sites keep the old lie by default and go green, which is the same defect with a nicer
 *   type signature.
 */
export function ConfigBanner({ origin, detail }: { origin: SettingsOrigin; detail?: string | null }) {
  if (settingsAreUnverified(origin)) {
    const isBuild = origin === 'local-not-configured';
    return (
      <div
        role="alert"
        className="border border-destructive/30 bg-destructive/5 rounded-xl p-6 flex flex-col items-center gap-3 text-center"
      >
        <AlertTriangle className="w-8 h-8 text-destructive" />
        <h3 className="font-semibold text-foreground">
          {isBuild
            ? 'This app has no database connection'
            : 'Could not reach the database'}
        </h3>
        <p className="text-sm text-muted-foreground max-w-md">
          {isBuild
            ? 'This build was deployed without its database URL, so it never asked for your settings. Nothing on this screen reflects your account, and your saved configuration has not been lost or changed.'
            : 'Your settings could not be read, so this screen cannot show your data. Your saved configuration has not been lost or changed.'}
        </p>
        {/* NAMED, NOT GUESSED — and never invented when there is no underlying message. */}
        {detail && <p className="text-xs text-muted-foreground/80 font-mono max-w-md break-words">{detail}</p>}
        <p className="text-xs text-muted-foreground max-w-md">
          This is a problem with the deployment, not with your setup. Going to Settings will
          not fix it.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-warning/30 bg-warning/5 rounded-xl p-6 flex flex-col items-center gap-3 text-center">
      <Settings className="w-8 h-8 text-warning" />
      <h3 className="font-semibold text-foreground">Configure your data sources</h3>
      <p className="text-sm text-muted-foreground max-w-md">
        Connect your Google Sheet and Airtable in Settings to get started with your analytics dashboard.
      </p>
      <Link
        to="/settings"
        className="mt-2 inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
      >
        <Settings className="w-4 h-4" />
        Go to Settings
      </Link>
    </div>
  );
}

/**
 * THE HONEST-NUMBERS BANNER — the on-screen half of the mission.
 *
 * @andrew accepted the loss of the exclusion list and the setter rates. That makes
 * performanceSpend === totalSpend permanent and every cost-per-lead inflated, and it makes
 * every payout figure use a $5 default nobody set. The detectors for both have existed and
 * been correct for a while; NOTHING RENDERED THEM, which meant a user still saw exactly
 * what they saw before the work started.
 *
 * ⚠️ DELIBERATELY MINIMAL AND OPINION-FREE. It renders `honestNumbers.messages` verbatim
 * and invents no copy of its own — the sentences are @raccoon's and they are already
 * numberless by design, so that a count here can never contradict the page it describes.
 * @dash owns this surface; this exists so the mission is not undelivered at deploy, and it
 * is meant to be replaced rather than defended.
 *
 * NOT DISMISSABLE, on purpose: the condition it reports is not transient, it is the
 * permanent consequence of a deletion. A dismiss control would let the warning be silenced
 * while the numbers stayed wrong, which is the defect wearing a different hat.
 */
export function HonestNumbersBanner({ messages }: { messages: string[] }) {
  // Empty means everything is trustworthy. Rendering an empty banner would train the eye
  // to skip it, which is how a real warning stops being read.
  if (messages.length === 0) return null;

  return (
    <div
      role="status"
      className="border border-warning/40 bg-warning/5 rounded-xl p-4 flex items-start gap-3"
    >
      <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
      <div className="flex-1 space-y-1">
        <p className="text-sm font-semibold text-foreground">
          Some numbers on this page are not what they appear
        </p>
        <ul className="space-y-1">
          {messages.map(m => (
            <li key={m} className="text-sm text-muted-foreground">
              {m}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
