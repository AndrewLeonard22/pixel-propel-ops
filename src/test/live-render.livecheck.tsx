/**
 * LIVE RENDER HARNESS — renders the real Dashboard / Targets / TeamPerformance in jsdom
 * against the REAL production Supabase + Airtable and prints what is actually on screen.
 * Not a re-implementation of the arithmetic: this is the component tree the browser runs.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DataProvider } from '@/hooks/useData';
import Dashboard from '@/pages/Dashboard';
import Targets from '@/pages/Targets';
import TeamPerformance from '@/pages/TeamPerformance';

function tile(label: string): string | null {
  const els = Array.from(document.querySelectorAll('p'));
  const l = els.find(e => e.textContent?.trim().toLowerCase() === label.toLowerCase());
  return l?.nextElementSibling?.textContent?.trim() ?? null;
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><DataProvider>{ui}</DataProvider></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LIVE render', () => {
  it('Dashboard renders the post-cutover numbers', async () => {
    wrap(<Dashboard />);
    await waitFor(() => {
      const v = tile('Total Spend');
      expect(v && v !== '—' && v !== '$0.00').toBe(true);
    }, { timeout: 150000, interval: 500 });
    // Give the account registry + Airtable a beat to land and re-render.
    await waitFor(() => expect(tile('Total Appts')).not.toBe('0'), { timeout: 60000, interval: 500 });
    await new Promise(r => setTimeout(r, 4000));

    const out: Record<string, string | null> = {};
    for (const l of ['Total Spend', 'Total Leads', 'Avg CPL', 'Total Appts', 'Lead → Appt %', 'Avg Cost/Appt', 'Closed Deals', 'Total Revenue']) {
      out[l] = tile(l);
    }
    console.log('DASHBOARD_TILES ' + JSON.stringify(out));

    const body = document.body.textContent ?? '';
    for (const probe of ['Unmatched', 'Totals cover Active accounts only', 'INCOMPLETE', 'connected database holds no ad spend',
      // ⑦ the two disclosures added 2026-08-12: the deal tiles now count the wins that
      // belong to no account, and must SAY so — the unmatched banner never counted money.
      'from appointments not matched to an account', 'Internal excluded']) {
      const i = body.indexOf(probe);
      console.log(`BANNER[${probe}] ${i >= 0 ? JSON.stringify(body.slice(i, i + 220)) : 'ABSENT'}`);
    }
    // Row count in the account table
    console.log('ACCOUNT_ROWS ' + document.querySelectorAll('tbody tr').length);
    // A renamed account must render under its curated client name, not Meta's label
    for (const n of ['Washbroz', 'Columbia Outdoor Restoration', 'Pro Clean Mobile Wash', 'TrueClean', 'Hydro Pro Wash', 'Publicity 1', 'Christmas Light Pros']) {
      console.log(`NAME[${n}] ${body.includes(n)}`);
    }
    expect(tile('Total Spend')).toBeTruthy();
  });

  it('Targets renders', async () => {
    wrap(<Targets />);
    await waitFor(() => expect((document.body.textContent ?? '').length).toBeGreaterThan(500), { timeout: 150000, interval: 500 });
    await new Promise(r => setTimeout(r, 8000));
    const body = document.body.textContent ?? '';
    console.log('TARGETS_LEN ' + body.length);
    console.log('TARGETS_TEXT ' + JSON.stringify(body.slice(0, 1400)));
    expect(body.length).toBeGreaterThan(100);
  });

  it('TeamPerformance renders', async () => {
    wrap(<TeamPerformance />);
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const len = (document.body.textContent ?? '').length;
      if (i % 5 === 0) console.log(`TEAM_POLL i=${i} len=${len}`);
      if (len > 500) break;
    }
    const body = document.body.textContent ?? '';
    console.log('TEAM_LEN ' + body.length);
    console.log('TEAM_TEXT ' + JSON.stringify(body.slice(0, 400)));
    console.log('TEAM_FULL ' + JSON.stringify(body.slice(0, 1400)));
    expect(body.length).toBeGreaterThan(100);
  });
});
