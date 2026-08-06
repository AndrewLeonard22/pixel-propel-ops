/**
 * REGRESSION LOCK — clicking a setter on /call-center crashed the whole application.
 *
 * WHAT BROKE: CallCenter.tsx used <LineChart> and <Line> in the "Last 30 Days" sparkline
 * but the recharts import block did not include them. JSX evaluates `jsx(LineChart, ...)`
 * eagerly when the parent's children are constructed, so mounting the panel throws
 * `ReferenceError: LineChart is not defined` BEFORE any layout happens — which means this
 * lock does NOT depend on recharts actually drawing anything in jsdom (ResponsiveContainer
 * measures 0x0 there and renders no chart). The identifier is dereferenced either way.
 *
 * WHY NOBODY SAW IT: CallCenter returns its "No call data yet" empty state while
 * callData.length === 0, so the panel is unreachable during the config outage. The crash
 * arms itself the moment call data comes back.
 *
 * POPULATION THIS LOCK COVERS, and how it was enumerated: `npx tsc -b --noEmit` at
 * fa43996 reported exactly 3 errors, all TS2304 "Cannot find name", all in CallCenter.tsx
 * (LineChart x2, Line x1) — that is the whole set of undefined identifiers in the repo,
 * and all three live in this one component. This lock mounts that component. It does NOT
 * claim to cover undefined identifiers elsewhere; the typecheck gate does that, and this
 * lock exists because the typecheck gate was RED at baseline and therefore not being read.
 *
 * SABOTAGE-PROVEN: written before the import was fixed. Run red (ReferenceError), then
 * the one-line import fix turns it green. Remove `LineChart, Line` from the recharts
 * import in CallCenter.tsx and this file fails again.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SetterDetailPanel } from './CallCenter';
import type { CallRow, AppointmentRow } from '@/lib/types';

// jsdom does not implement ResizeObserver and recharts' ResponsiveContainer requires it.
// This is an ENVIRONMENT gap, not a product defect — stubbed locally rather than in the
// shared src/test/setup.ts, which is @raccoon's scaffolding lane. @raccoon: this belongs
// in the shared setup, every seat mounting a recharts component will hit it.
// NOTE: the stub does NOT weaken this lock. The defect it guards throws at React ELEMENT
// CREATION, which happens before ResponsiveContainer ever mounts — re-proven by re-running
// the sabotage with this stub in place.
beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

const call = (over: Partial<CallRow> = {}): CallRow => ({
  timestamp: '8/4/2026 10:15am',
  ghlLocationName: 'Testerman Pro Wash',
  agentName: 'Jordan',
  callDuration: 120,
  callDisposition: 'answered',
  ...over,
});

const appt = (over: Partial<AppointmentRow> = {}): AppointmentRow => ({
  campaignName: 'C1', campaignId: '111', adSetName: 'AS1', adSetId: '211',
  adName: 'A1', adId: '311', client: 'Testerman Pro Wash',
  appointmentDate: '8/4/2026', dateAdded: '8/4/2026', showStatus: 'Showed',
  leadValid: 'valid', leadQuality: '', dqReason: '', projectValue: 0,
  closedRevenue: 0, leadStatus: '', amountCharged: 0, billed: '',
  clientPPARate: 0, setter: 'Jordan', clientBillingModel: '',
  ...over,
});

describe('SetterDetailPanel — the setter click must not crash the app', () => {
  it('mounts with real call data without throwing', () => {
    const calls = [call(), call({ callDuration: 15 }), call({ timestamp: '8/3/2026 9:00am' })];

    // If any identifier used in this component's JSX is undefined, React element
    // creation throws here and the whole app falls to the ErrorBoundary in production.
    expect(() =>
      render(
        <SetterDetailPanel
          agentName="Jordan"
          filteredCalls={calls}
          filteredAppts={[appt()]}
          allCalls={calls}
          dateLabel="This Month"
          onClose={vi.fn()}
        />,
      ),
    ).not.toThrow();

    // NON-VACUITY ANCHOR: prove the component really rendered rather than the assertion
    // passing over an empty tree. If the panel ever renders nothing, this fails and the
    // "did not throw" above stops being evidence of anything.
    expect(screen.getByText('Jordan')).toBeInTheDocument();
    expect(screen.getByText('Last 30 Days')).toBeInTheDocument();
  });

  it('mounts with an EMPTY call list without throwing', () => {
    // The sparkline path still constructs the chart elements with no rows, so this
    // exercises the same identifiers on the degenerate input.
    expect(() =>
      render(
        <SetterDetailPanel
          agentName="Sam"
          filteredCalls={[]}
          filteredAppts={[]}
          allCalls={[]}
          dateLabel="This Month"
          onClose={vi.fn()}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByText('Sam')).toBeInTheDocument();
  });
});
