/**
 * SETTER PAYOUT CALCULATION. Item ⑦ (RACC-037). This is money.
 *
 * WHY IT MOVED OUT OF Agents.tsx: it lived inline in a useMemo inside a page component,
 * which is why it had no tests and could not get any. It is arithmetic that decides what
 * people are paid; it belongs in a pure function.
 *
 * ═══ THE DEFECT ═══
 *   const rate = rateConfig?.rate ?? 5;
 *
 * A FABRICATED RATE THAT IS INDISTINGUISHABLE FROM A CONFIGURED ONE, and `handleExport`
 * prints it as fact: "Alice: 12 appointments × $5 = $60". Four ways it pays the wrong
 * amount with no symptom:
 *
 *   ① CONFIG WIPED — `setterBonusRates` destroyed the way `excludedCampaigns` was
 *     destroyed in the outage. EVERY setter silently falls back to $5 and the export
 *     still reads as though $5 were configured.
 *   ② PARTIAL LIST — a setter who was never added gets $5 in silence.
 *   ③ NAME MISMATCH — the lookup was `r.setterName === name`, exact. " Alice" vs
 *     "Alice", or "alice" vs "Alice", falls through to $5 while Settings shows the
 *     rate as configured. The two screens disagree and neither says so.
 *   ④ (Unknown) PAYEE — an appointment with a blank setter becomes a payee literally
 *     named "(Unknown)" who accrues appointments and gets paid.
 *
 * ═══ THE FIX ═══
 * The fallback still applies, so nothing vanishes from the screen — but it is LABELLED,
 * and the caller can see which rows are fabricated. A number the app invented must not
 * render identically to a number a human configured.
 */
import type { AppSettings, AppointmentRow } from './types';

/** Used only when a setter has no configured rate. Never silently, always labelled. */
export const FALLBACK_RATE = 5;

/** The bucket blank setters land in. Not a person, and not payable without a decision. */
export const UNKNOWN_SETTER = '(Unknown)';

export type RateSource = 'configured' | 'fallback';

export interface SetterPayoutRow {
  name: string;
  /** the appointments behind the count, for the per-setter detail list */
  appointments: AppointmentRow[];
  appointmentCount: number;
  rate: number;
  total: number;
  /** 'fallback' means NOBODY CONFIGURED THIS RATE. Show it. */
  rateSource: RateSource;
  /** false when the row needs a human decision before money moves */
  payable: boolean;
  /** why it is not payable / not trustworthy, for display */
  warning?: string;
}

export interface PayoutResult {
  rows: SetterPayoutRow[];
  /** total across PAYABLE rows only */
  payableTotal: number;
  /** total including unpayable rows — shown so the gap is visible, never hidden */
  grossTotal: number;
  /** rows a human must resolve before this payout run is trustworthy */
  needsReview: SetterPayoutRow[];
  /** true when NO rate at all was configured — the config-wipe signature */
  allRatesFabricated: boolean;
}

/** Match key for setter names: trims and case-folds, so " alice" finds "Alice". */
export function setterKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Look up a configured rate, tolerant of whitespace and case.
 * Returns null when nothing is configured — the caller decides what that means, rather
 * than receiving a number it cannot distinguish from a real one.
 */
export function findConfiguredRate(
  settings: Pick<AppSettings, 'setterBonusRates'>,
  name: string,
): number | null {
  const rates = settings.setterBonusRates || [];
  const key = setterKey(name);
  const hit = rates.find(r => setterKey(r.setterName || '') === key);
  if (!hit) return null;
  if (typeof hit.rate !== 'number' || !isFinite(hit.rate)) return null;
  return hit.rate;
}

/**
 * Group eligible appointments by setter and compute what each is owed.
 *
 * @param eligible appointments already filtered to the payout period and validity
 */
export function computeSetterPayouts(
  eligible: AppointmentRow[],
  settings: Pick<AppSettings, 'setterBonusRates' | 'inactiveSetters'>,
): PayoutResult {
  const groups = new Map<string, { display: string; appts: AppointmentRow[] }>();
  for (const appt of eligible) {
    const raw = (appt as { setter?: string }).setter;
    const display = (raw || '').trim() || UNKNOWN_SETTER;
    const key = setterKey(display);
    if (!groups.has(key)) groups.set(key, { display, appts: [] });
    groups.get(key)!.appts.push(appt);
  }

  // Inactive matching is key-based too, so " Alice" cannot dodge an "Alice" exclusion.
  const inactive = new Set((settings.inactiveSetters || []).map(setterKey));

  const rows: SetterPayoutRow[] = [];
  for (const { display, appts } of groups.values()) {
    if (inactive.has(setterKey(display))) continue;

    const configured = findConfiguredRate(settings, display);
    const isUnknown = setterKey(display) === setterKey(UNKNOWN_SETTER);
    const rate = configured ?? FALLBACK_RATE;
    const rateSource: RateSource = configured === null ? 'fallback' : 'configured';

    let warning: string | undefined;
    if (isUnknown) {
      warning =
        'Appointments with no setter recorded. Assign an owner before paying this row.';
    } else if (rateSource === 'fallback') {
      warning = `No rate configured for "${display}" — showing the $${FALLBACK_RATE} default, which nobody set.`;
    }

    rows.push({
      name: display,
      appointments: appts,
      appointmentCount: appts.length,
      rate,
      total: appts.length * rate,
      rateSource,
      payable: !isUnknown,
      warning,
    });
  }

  rows.sort((a, b) => b.total - a.total);

  const payableRows = rows.filter(r => r.payable);
  const namedRows = rows.filter(r => setterKey(r.name) !== setterKey(UNKNOWN_SETTER));

  return {
    rows,
    payableTotal: payableRows.reduce((s, r) => s + r.total, 0),
    grossTotal: rows.reduce((s, r) => s + r.total, 0),
    needsReview: rows.filter(r => !r.payable || r.rateSource === 'fallback'),
    // Only a signal when there ARE named setters to configure rates for.
    allRatesFabricated:
      namedRows.length > 0 && namedRows.every(r => r.rateSource === 'fallback'),
  };
}

/** Export text. Marks every fabricated rate, so the clipboard cannot lie either. */
export function formatPayoutExport(
  result: PayoutResult,
  periodLabel: string,
  formatCurrency: (n: number) => string,
): string {
  const lines = [`Setter Payout — ${periodLabel}`, ''];

  if (result.allRatesFabricated) {
    lines.push(
      `⚠️ NO SETTER RATES ARE CONFIGURED. Every rate below is the $${FALLBACK_RATE} default.`,
      '',
    );
  }

  for (const r of result.rows) {
    const flag = r.rateSource === 'fallback' ? ' (DEFAULT RATE — not configured)' : '';
    const unpayable = r.payable ? '' : ' (NEEDS OWNER — not included in total)';
    lines.push(
      `${r.name}: ${r.appointmentCount} appointment${r.appointmentCount !== 1 ? 's' : ''} × $${r.rate} = ${formatCurrency(r.total)}${flag}${unpayable}`,
    );
  }

  lines.push('', `Total: ${formatCurrency(result.payableTotal)}`);
  if (result.grossTotal !== result.payableTotal) {
    lines.push(
      `Excluded (needs owner): ${formatCurrency(result.grossTotal - result.payableTotal)}`,
    );
  }
  return lines.join('\n');
}
