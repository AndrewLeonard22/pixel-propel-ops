import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConfigBanner } from './Banners';
import type { SettingsOrigin } from '@/lib/config';

/**
 * THE BANNER NAMES A PARTY, AND NAMING THE WRONG ONE IS THE DEFECT.
 *
 * "Configure your data sources — connect your Google Sheet and Airtable in Settings" is a
 * statement about the USER's setup. On 2026-08-05 the deployed build had no database URL,
 * so it never read anything, and that sentence went on screen anyway. @bird: "a booted
 * empty page reads as «@andrew's config is wrong» rather than «our build has no database
 * URL»" — twenty minutes spent debugging the wrong system.
 *
 * ⚠️ THE PREDICATE IS TESTED IN config.settingsOrigin.test.ts. THIS IS THE CONSUMER, and
 * they are blind to each other's defects: `settingsAreUnverified` can be perfect while the
 * banner ignores it, and the banner can be perfect while no page passes it an origin. The
 * third arm — that every call site supplies one — is a REACHABILITY question a render test
 * cannot answer, which is why `origin` is a REQUIRED prop rather than an optional one:
 * the typechecker is the instrument for that, not this file.
 */
function renderBanner(origin: SettingsOrigin, detail?: string | null) {
  return render(
    <MemoryRouter>
      <ConfigBanner origin={origin} detail={detail} />
    </MemoryRouter>,
  );
}

describe('ConfigBanner — it must blame the deployment, not the user, when we never looked', () => {
  it('🔴 ANTI-VACUITY CONTROL: a real empty database still says "configure your data sources"', () => {
    // Without this arm the fix is satisfiable by ALWAYS showing the deployment error, which
    // would be the mirror defect: refusing to tell a genuinely unconfigured user what to do.
    renderBanner('local-no-row');

    expect(screen.getByText(/configure your data sources/i)).toBeVisible();
    expect(screen.getByRole('link', { name: /go to settings/i })).toBeVisible();
    expect(screen.queryByText(/no database connection/i)).not.toBeInTheDocument();
  });

  it('THE LIVE FAILURE: an unconfigured build says the DEPLOYMENT is missing its database', () => {
    renderBanner('local-not-configured');

    expect(screen.getByText(/no database connection/i)).toBeVisible();
    expect(screen.getByText(/deployed without its database URL/i)).toBeVisible();
    // ⭐ THE LOAD-BEARING NEGATIVE: the sentence that misdirected @bird for twenty minutes.
    expect(screen.queryByText(/configure your data sources/i)).not.toBeInTheDocument();
    // And it must NOT send anyone to Settings — there is nothing to fix there.
    expect(screen.queryByRole('link', { name: /go to settings/i })).not.toBeInTheDocument();
  });

  it('it says the saved configuration is INTACT — the question a user actually has', () => {
    // A user seeing an empty dashboard after a config wipe needs to know whether their
    // settings are gone. An unreachable database tells us nothing about that either way,
    // so the banner must not imply loss.
    renderBanner('local-not-configured');
    expect(screen.getByText(/has not been lost or changed/i)).toBeVisible();
  });

  it('an UNREACHABLE database is a different sentence again, and shows the reason', () => {
    renderBanner('local-unreachable', 'TypeError: Failed to fetch');

    expect(screen.getByText(/could not reach the database/i)).toBeVisible();
    expect(screen.getByText(/TypeError: Failed to fetch/)).toBeVisible();
    expect(screen.queryByText(/configure your data sources/i)).not.toBeInTheDocument();
    // "deployed without its database URL" is a specific claim, false in this state.
    expect(screen.queryByText(/deployed without its database URL/i)).not.toBeInTheDocument();
  });

  it('renders no detail line when there is no underlying message', () => {
    const { container } = renderBanner('local-unreachable', null);
    expect(container.querySelector('.font-mono')).toBeNull();
  });

  it('🔴 THE THREE STATES ARE DISTINGUISHABLE ON SCREEN — same component, different words', () => {
    // The defect was that a user could not tell these apart, so per-state assertions are
    // not enough: a regression that collapses two of them would pass every arm above that
    // only checks for presence. Compare the rendered text itself.
    const text = (o: SettingsOrigin) => {
      const { container, unmount } = renderBanner(o);
      const t = container.textContent ?? '';
      unmount();
      return t;
    };

    const noRow = text('local-no-row');
    const notConfigured = text('local-not-configured');
    const unreachable = text('local-unreachable');

    expect(new Set([noRow, notConfigured, unreachable]).size).toBe(3);
  });

  it('the two unverified states use role="alert"; the ordinary setup prompt does not', () => {
    // A missing database is not the same class of message as "you have not set up yet",
    // and assistive technology should not hear them identically either.
    const { unmount } = renderBanner('local-not-configured');
    expect(screen.getByRole('alert')).toBeVisible();
    unmount();

    renderBanner('local-no-row');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
