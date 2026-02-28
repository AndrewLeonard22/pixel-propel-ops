import { AlertTriangle, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';

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

export function ConfigBanner() {
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
