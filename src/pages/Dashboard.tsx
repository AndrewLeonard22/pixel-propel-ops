import { useState, useMemo, useCallback, useEffect } from 'react';
import { useData } from '@/hooks/useData';
import { ConfigBanner, ErrorBanner, HonestNumbersBanner } from '@/components/common/Banners';
import { KPISkeleton, TableSkeleton } from '@/components/common/LoadingSkeleton';
import EmptyState from '@/components/common/EmptyState';
import PerformanceBadge from '@/components/common/PerformanceBadge';
import { formatCurrency, formatNumber, formatPercent, formatDate, buildAccountSummaries, metricIsMeaningful, isClosedWon } from '@/lib/dataService';
import { saveSettings, saveAccountMappings } from '@/lib/config';
import { ChevronDown, ChevronRight, Search, AlertTriangle, Check, X } from 'lucide-react';
import type { AccountSummary, CampaignSummary, PerformanceLevel, AppointmentRow, AccountMapping, AppSettings } from '@/lib/types';
import DateRangePicker, { type DateRange, ALL_TIME } from '@/components/DateRangePicker';
import { Combobox } from '@/components/ui/combobox';
import { hasUsableData } from '@/lib/sourceStatus';
import { accountTitle } from '@/lib/accountDisplay';

interface AccountGroup {
  label: string;
  accounts: AccountSummary[];
  defaultOpen: boolean;
}

function AccountSection({ group, onSelect }: { group: AccountGroup; onSelect: (account: AccountSummary) => void }) {
  if (group.accounts.length === 0) return null;

  return (
    <>
      <tr>
        <td colSpan={9} className="pt-4 pb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</span>
            <span className="text-xs px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground font-medium">{group.accounts.length}</span>
          </div>
        </td>
      </tr>
      {group.accounts.map(a => (
        <AccountRow key={a.accountName} account={a} onSelect={onSelect} />
      ))}
    </>
  );
}

/**
 * A local Date -> the `YYYY-MM-DD` the SQL filter compares against, or undefined for an
 * open end.
 *
 * ⚠️ LOCAL PARTS, NEVER `toISOString()`. `ad_insights.date` is a calendar date with no
 * timezone; `toISOString` converts through UTC, so for any user west of Greenwich the
 * start of a month becomes the last day of the previous month and the query silently
 * returns the wrong window. The picker builds these Dates from local midnight, so local
 * getters are what round-trip them.
 */
function toIsoDay(d: Date | undefined): string | undefined {
  if (!d || Number.isNaN(d.getTime())) return undefined;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseDateSafe(dateStr: string): Date | null {
  if (!dateStr) return null;
  // ISO date-only strings (YYYY-MM-DD) must be forced to local time — without
  // the time suffix, JS parses them as UTC midnight, which shifts the date back
  // by the local UTC offset (e.g. one full day behind in US timezones).
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return new Date(dateStr + 'T00:00:00');
  const normalized = dateStr.replace(/(\d+:\d+)(am|pm)/i, (_, time, ampm) => `${time} ${ampm.toUpperCase()}`);
  let d = new Date(normalized);
  if (!isNaN(d.getTime())) return d;
  const dateOnly = dateStr.replace(/\s+\d+:\d+\s*(am|pm)?\s*$/i, '').trim();
  if (dateOnly && dateOnly !== dateStr) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return new Date(dateOnly + 'T00:00:00');
    d = new Date(dateOnly);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function KPICard({ label, value, mono = true, note }: { label: string; value: string; mono?: boolean; note?: string }) {
  return (
    <div className="card-elevated p-5">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
      <p className={mono ? 'kpi-number text-foreground' : 'text-2xl font-bold text-foreground'}>{value}</p>
      {/* ⭐ NAME THE POPULATION ON THE TILE. Two appointment tiles summed different
          populations for weeks and nothing on screen said which. A number whose
          population is unstated is a question the next reader has to re-open. */}
      {note && <p className="text-[11px] text-muted-foreground mt-1">{note}</p>}
    </div>
  );
}

/**
 * The only honest render for a source that did not answer. A zero here is a CLAIM — that
 * the account booked nothing, closed nothing, earned nothing — and a dead feed cannot
 * support it. @bird measured the tiles printing this while the table beside them printed
 * $0.00 from the same dead source.
 *
 * ⚠️ ALWAYS COMPARE `=== false`, NEVER `!flag`. The flags are OPTIONAL: Targets.tsx and
 * TeamPerformance.tsx build summaries without source outcomes, so their rows carry
 * `undefined`, which means KNOWN. `!undefined` is true and would blank two working pages —
 * the mirror of the bug this fixes.
 */
const UNKNOWN = '—';

/**
 * THE THREE RATIO BADGES, KEYED ON THE FLAG AND THE DENOMINATOR — NEVER ON THE VALUE.
 *
 * @raccoon (RACC-030/031) measured the two failure shapes that were sitting side by side
 * in this file with OPPOSITE policies:
 *
 *   CostPerApptBadge   value === 0 -> grey, but PRINTS $0.00       fabricates a number  🔴
 *   LeadToApptBadge    value === 0 -> "—"                          fails safe, still wrong
 *
 * Both were inferring "do we know this" FROM THE VALUE. The second only looks correct: a
 * genuine 0% lead-to-appointment rate — a real and bad result a buyer needs to see — was
 * being rendered as if we had no idea. Copying it would have fixed one badge and preserved
 * the class in the other.
 *
 * ⚠️ AND IT GOT WORSE THE MOMENT I MADE "—" MEAN "the source did not answer": the same
 * glyph then carried two unrelated meanings on one row, so a reader could not tell a dead
 * feed from a zero. The value is no longer consulted for knownness anywhere.
 */
export function RatioBadge({ known, denominator, color, children }: {
  known: boolean | undefined;
  denominator: number;
  color: string;
  children: React.ReactNode;
}) {
  if (!metricIsMeaningful(known, denominator)) {
    return <span className="font-mono-tabular text-muted-foreground">{UNKNOWN}</span>;
  }
  return <span className={`font-mono-tabular font-semibold ${color}`}>{children}</span>;
}

export function CPLBadge({ value, leads, known }: { value: number; leads: number; known?: boolean }) {
  const color = value < 35 ? 'text-success' : value <= 55 ? 'text-warning-strong' : 'text-destructive';
  return <RatioBadge known={known} denominator={leads} color={color}>{formatCurrency(value)}</RatioBadge>;
}

export function CostPerApptBadge({ value, appointments, known }: { value: number; appointments: number; known?: boolean }) {
  const color = value < 180 ? 'text-success' : value <= 240 ? 'text-warning-strong' : 'text-destructive';
  return <RatioBadge known={known} denominator={appointments} color={color}>{formatCurrency(value)}</RatioBadge>;
}

export function LeadToApptBadge({ value, leads, known }: { value: number; leads: number; known?: boolean }) {
  // A true 0% now renders as 0% — it is a real result, not an absence.
  const color = value >= 10 ? 'text-success' : value >= 5 ? 'text-warning-strong' : 'text-destructive';
  return <RatioBadge known={known} denominator={leads} color={color}>{formatPercent(value)}</RatioBadge>;
}

function getPerfByProgram(program: string, cpl: number, costPerAppt: number, appointments: number): PerformanceLevel | null {
  /**
   * 🔴 A VERDICT NEEDS A RULE, AND "no program set" IS NOT A RULE.
   *
   * Every branch below judges the media buyer's work, and the two branches are chosen by
   * PROGRAM. When the program is unset there is no basis to pick one — and this function
   * used to fall through to the DFY cost-per-appointment rule anyway, because its caller
   * defaulted a missing program to 'Done For You'. Five live accounts have no program, one
   * of which (No Streaks) spent $7,008 in 2026 and last spent today, so this was a real
   * verdict rendered from a guess.
   *
   * `Internal` is excluded for the opposite reason: it is agency and recruiting spend, and
   * client cost-per-lead targets are not what it should be measured against. Both return
   * null, which the row already renders as "no coloured border" rather than as "poor".
   */
  if (program === 'Unknown' || program === 'Internal') return null;
  if (program === 'Done With You') {
    if (cpl === 0) return null;
    if (cpl < 35) return 'good';
    if (cpl <= 55) return 'fair';
    return 'poor';
  }
  if (costPerAppt === 0 || appointments === 0) return null;
  if (costPerAppt < 180) return 'good';
  if (costPerAppt <= 240) return 'fair';
  return 'poor';
}

export function AccountRow({ account, onSelect }: { account: AccountSummary; onSelect: (account: AccountSummary) => void }) {
  /**
   * ⛔ ONE OWNER PER FIELD. This read `getAccountMapping(account.accountName, ...)` out of
   * the legacy localStorage alias store while the summary it was handed ALREADY carried
   * `program` and `status` — two resolvers, two default rules ('Done For You' here versus
   * 'Unknown' there), so the row could be judged by a rule the account was not grouped by.
   * The summary is the single owner now; it is built in one place (dataService) from the
   * curated `ad_accounts` mapping with the legacy store as fallback.
   */
  const { program, status } = account;
  const title = accountTitle(account);
  // A coloured performance border is a verdict. Two of its three inputs come from sources
  // that may not have answered, so a dead feed would paint every account "poor" — a claim
  // about the buyer's work, drawn from nothing.
  const perfKnown = account.spendKnown !== false && account.apptsKnown !== false;
  const perf = (status === 'Paused' || status === 'Churned' || !perfKnown)
    ? null
    : getPerfByProgram(program, account.cpl, account.costPerAppt, account.appointments);

  return (
    <tr
      onClick={() => onSelect(account)}
      className="cursor-pointer hover:bg-accent/30 transition-colors"
      style={perf ? { borderLeft: `3px solid hsl(var(--${perf === 'good' ? 'success' : perf === 'fair' ? 'warning' : 'destructive'}))` } : undefined}
    >
      <td className="py-3 px-3">
        <div className="flex items-center gap-2">
          {/* ⭐ THE CLIENT'S NAME, NOT META'S. This rendered `accountName` — the raw Meta
              string including " X SocialWorks" — which is why renaming an account in
              Settings changed nothing anywhere the user actually looks. */}
          <span className="font-semibold text-sm truncate" title={title.subtitle ?? title.label}>{title.label}</span>
          <span className="text-xs text-muted-foreground">{account.campaigns.length} campaigns</span>
          {account.mediaBuyer && <span className="text-xs text-muted-foreground">· {account.mediaBuyer}</span>}
        </div>
      </td>
      <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap">{account.spendKnown === false ? UNKNOWN : formatCurrency(account.spend)}</td>
      <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap hidden md:table-cell">{account.spendKnown === false ? UNKNOWN : formatNumber(account.leads)}</td>
      <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap hidden md:table-cell"><CPLBadge value={account.cpl} leads={account.leads} known={account.spendKnown} /></td>
      <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap">{account.apptsKnown === false ? UNKNOWN : formatNumber(account.appointments)}</td>
      <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap hidden md:table-cell">
        {/* Two sources: leads come from Windsor, appointments from Airtable. Either one
            dead makes the ratio unknowable, not zero. */}
        <LeadToApptBadge value={account.leadPercent} leads={account.leads} known={account.spendKnown === false || account.apptsKnown === false ? false : undefined} />
      </td>
      <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap"><CostPerApptBadge value={account.costPerAppt} appointments={account.appointments} known={account.spendKnown === false || account.apptsKnown === false ? false : undefined} /></td>
      <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap hidden md:table-cell">{account.apptsKnown === false ? UNKNOWN : formatNumber(account.closed)}</td>
      <td className="text-right font-mono-tabular text-xs py-3 px-3 whitespace-nowrap hidden md:table-cell">{account.apptsKnown === false ? UNKNOWN : formatCurrency(account.revenue)}</td>
    </tr>
  );
}

// === Account Detail Panel (slide-over) ===



export function AccountDetailPanel({ account, settings, onClose, onToggleExclude }: {
  account: AccountSummary;
  settings: AppSettings;
  onClose: () => void;
  onToggleExclude: (campaignId: string) => Promise<void>;
}) {
  const { program } = account;
  const panelTitle = accountTitle(account);

  // ⚠️ THE PANEL WAS UNGATED WHILE THE ROW ABOVE IT WAS NOT. @raccoon measured it: in the
  // SAME four-card grid, Cost/Appt refused correctly while the Revenue card beside it
  // fabricated $0.00 from the same dead source — 1 of 12 appointment-sourced expressions
  // mentioned apptsKnown. @bird's arms read the ROW and the TILES, both correctly gated;
  // the panel only renders on a CLICK and no arm clicked. Row, tile, panel — the fix had
  // landed on the two surfaces that were driven, which is the same layer-blindness the
  // W1/W2/W3 sabotage measured, arriving on a fourth surface.
  //
  // One helper rather than seven inline ternaries, so these cannot drift apart again.
  const apptsUnknown = account.apptsKnown === false;
  const appt = (render: () => string) => (apptsUnknown ? UNKNOWN : render());

  const showedCount = account.appointmentList.filter(a => {
    const s = (a.showStatus || '').toLowerCase();
    return s === 'showed' || s === 'show';
  }).length;

  // ⚠️ DEAD: showRate and closeRate are each referenced exactly once — here. Nothing
  // renders them, so they are not a display defect; naming them beats deleting code
  // at verdict time, when a removal cannot be driven.
  const showRate = account.appointmentList.length > 0 ? (showedCount / account.appointmentList.length) * 100 : 0;
  const closeRate = account.appointmentList.length > 0 ? (account.closed / account.appointmentList.length) * 100 : 0;

  const [showQuiet, setShowQuiet] = useState(false);
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(new Set());
  const toggleCampaign = (id: string) => setExpandedCampaigns(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const [expandedAdSets, setExpandedAdSets] = useState<Set<string>>(new Set());
  const toggleAdSet = (id: string) => setExpandedAdSets(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  /**
   * The funnel stages are rendered INLINE below, each with its own conversion caption.
   * A `funnelStages` array used to sit here carrying a FIFTH set of colours that nothing
   * read — deleted rather than recoloured, because a dead palette is how two of them drift.
   */
  const leadsValue = account.leads;

  // Recent appointments sorted by dateAdded desc
  /* Spend-descending, quiet ones separated. Both derived here so the render stays a map. */
  const sortedCampaigns = [...account.campaigns].sort((a, b) => b.spend - a.spend);
  const isQuiet = (c: CampaignSummary) => c.leads === 0 && c.appointments === 0;
  const quietCampaigns = sortedCampaigns.filter(isQuiet);
  const quietSpend = quietCampaigns.reduce((t, c) => t + c.spend, 0);
  const visibleCampaigns = showQuiet ? sortedCampaigns : sortedCampaigns.filter(c => !isQuiet(c));

  /* ⚠️ COLUMN EMPTINESS IS COMPUTED OVER THE WHOLE APPOINTMENT LIST, NOT THE 30 RENDERED
     ROWS. "empty on every appointment" read off a 30-row slice would be a claim about a
     population the reader cannot see — the denominator trap, in a sentence. */
  const allAppts = account.appointmentList;
  const emptyCols = ([
    ['Show Status', (a: AppointmentRow) => a.showStatus],
    ['Lead Valid', (a: AppointmentRow) => a.leadValid],
    ['Revenue', (a: AppointmentRow) => (a.closedRevenue ? String(a.closedRevenue) : '')],
  ] as const).filter(([, get]) => allAppts.length > 0 && allAppts.every(a => !String(get(a) ?? '').trim()))
    .map(([label]) => label);
  const hidden = new Set(emptyCols);

  const recentAppts = [...account.appointmentList]
    .sort((a, b) => {
      const da = parseDateSafe(a.dateAdded || a.appointmentDate);
      const db = parseDateSafe(b.dateAdded || b.appointmentDate);
      return (db?.getTime() || 0) - (da?.getTime() || 0);
    })
    .slice(0, 30);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/40" />
      {/* Panel */}
      <div
        className="relative w-full sm:max-w-2xl bg-card border-l shadow-xl overflow-y-auto animate-in slide-in-from-right duration-300"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-card border-b px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">{panelTitle.label}</h2>
            <p className="text-xs text-muted-foreground">
              {[panelTitle.subtitle, account.mediaBuyer].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted transition-colors">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Section 1 — KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="card-elevated p-3">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Spend</p>
              <p className="text-lg font-bold font-mono-tabular text-foreground">{formatCurrency(account.spend)}</p>
            </div>
            <div className="card-elevated p-3">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">CPL</p>
              <p className="text-lg font-bold font-mono-tabular"><CPLBadge value={account.cpl} leads={account.leads} known={account.spendKnown} /></p>
            </div>
            <div className="card-elevated p-3">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Cost/Appt</p>
              <p className="text-lg font-bold font-mono-tabular"><CostPerApptBadge value={account.costPerAppt} appointments={account.appointments} known={account.spendKnown === false || account.apptsKnown === false ? false : undefined} /></p>
            </div>
            <div className="card-elevated p-3">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Revenue</p>
              <p className="text-lg font-bold font-mono-tabular text-foreground">{appt(() => formatCurrency(account.revenue))}</p>
            </div>
          </div>

          {/* Section 2 — Conversion Funnel */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">Conversion funnel</h3>
            {account.leads === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No lead data</p>
            ) : (
              /* ⭐ THE BAR MEASURES THE CONVERSION, NOT THE MAGNITUDE — and that is a
                 correctness fix, not a restyle.
                 ────────────────────────────────────────────────────────────────────────
                 WAS: every width was a share of LEADS. On Backyard Paradiso that is
                 7,186 -> 323 -> 208 -> 19, a 378:1 range, so stages 2-4 computed to
                 4.5% / 2.9% / 0.26% and were then floored at 3% to stay visible. Three
                 different quantities rendered as the same dot. A PROPORTIONAL BAR
                 PHYSICALLY CANNOT SHOW THAT RANGE, and it degraded worst on the biggest
                 account — the one Andrew opens most.
                 ⛔ A LOG SCALE WOULD FIT, AND IT LIES: it makes a 378:1 drop look like a
                 gentle slope. Rejected on those grounds, not aesthetic ones.
                 ⇒ NOW: each bar is that stage's share of THE STAGE ABOVE IT. Every bar is
                 readable because a conversion rate is 0-100% by construction, and the bar
                 now depicts the number printed beside it instead of a magnitude it cannot
                 render. Magnitude still lives in the count column, exact and unscaled.
                 ⚠️ THE AXIS CHANGED, SO THE AXIS IS NAMED ON SCREEN (caption below). A bar
                 whose meaning silently changed is worse than the bar we replaced.
                 ⭐ AND THE HIERARCHY IS INVERTED, which is the actual ask: the rate is what
                 he is reading, so it is the largest thing on the row; the stage label is
                 the smallest. It used to be the other way round. */
              <div className="flex flex-col">
                <p className="text-[11px] text-muted-foreground mb-2">
                  Each bar is that stage&rsquo;s share of the stage above it. Counts are exact.
                </p>
                {([
                  {
                    key: 'leads', label: 'Leads', tint: 'bg-[#1a6eff]/25',
                    count: formatNumber(account.leads),
                    // The first stage has nothing above it — no rate exists, and inventing
                    // "100%" would read as a measured conversion. It gets a dash.
                    rate: null as string | null, frac: 1, of: null as string | null,
                  },
                  {
                    key: 'appts', label: 'Appointments', tint: 'bg-[#1a6eff]/45',
                    count: appt(() => formatNumber(account.appointments)),
                    rate: metricIsMeaningful(account.apptsKnown === false || account.spendKnown === false ? false : undefined, account.leads)
                      ? formatPercent(account.leadPercent) : UNKNOWN,
                    frac: account.leads > 0 ? account.appointments / account.leads : 0,
                    of: 'of leads',
                  },
                  {
                    key: 'showed', label: 'Showed', tint: 'bg-[#1a6eff]/70',
                    count: appt(() => formatNumber(showedCount)),
                    rate: metricIsMeaningful(account.apptsKnown, account.appointments)
                      ? formatPercent((showedCount / account.appointments) * 100) : UNKNOWN,
                    frac: account.appointments > 0 ? showedCount / account.appointments : 0,
                    of: 'of appointments',
                  },
                  {
                    key: 'closed', label: 'Closed', tint: 'bg-[#1a6eff]',
                    count: appt(() => formatNumber(account.closed)),
                    rate: metricIsMeaningful(account.apptsKnown, showedCount)
                      ? formatPercent((account.closed / showedCount) * 100) : UNKNOWN,
                    frac: showedCount > 0 ? account.closed / showedCount : 0,
                    of: 'of showed',
                  },
                ]).map(row => (
                  <div key={row.key} className="flex items-center gap-2.5 py-[3px]">
                    <span className="w-[84px] text-[11px] text-muted-foreground text-right shrink-0">{row.label}</span>
                    <div className="flex-1 h-5 rounded bg-muted/30 overflow-hidden">
                      {/* No visibility floor. A 0% conversion must render as an EMPTY bar —
                          the old `Math.max(..., 3)` drew a sliver for a stage that converted
                          nothing, which is the same class of lie as a fabricated zero. */}
                      <div
                        data-funnel-bar={row.key}
                        className={`h-full rounded ${row.tint}`}
                        style={{ width: `${Math.min(100, Math.max(0, row.frac * 100))}%` }}
                      />
                    </div>
                    {/* The FIRST stage has no stage above it, so no conversion exists to
                        report. That is NOT the same fact as UNKNOWN (we looked and could not
                        tell) — it is undefined by construction, so it renders blank rather
                        than borrowing the unknown sentinel and implying a failed read. */}
                    <span className="w-[52px] text-sm font-semibold font-mono-tabular text-foreground text-right shrink-0">
                      {row.rate ?? ''}
                    </span>
                    <span className="w-[42px] text-[10px] text-muted-foreground shrink-0 leading-tight">{row.of ?? ''}</span>
                    <span className="w-[60px] text-sm font-mono-tabular text-muted-foreground text-right shrink-0">{row.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 3 — Campaign Breakdown */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">Campaigns ({account.campaigns.length})</h3>
            {/* 🔴 NAME THE GAP RATHER THAN LET THE READER FIND IT.
                @andrew's Archadeck panel: campaign spend and leads reconcile to the account
                header, appointments do not — the rows sum to 6 and the header says 7. The
                missing appointment is REAL and attached to the account; it simply carries no
                campaign evidence, so no per-campaign reduce can see it.
                The 7 is right and the 6 is incomplete — so the panel says which, in the one
                place a reader is about to add the rows up. Same treatment the dashboard now
                gives its 43 unmatched appointments. */}
            {account.unattributedAppointments > 0 && (
              <p className="text-xs text-muted-foreground mb-2">
                These rows account for {account.appointments - account.unattributedAppointments} of{' '}
                {account.appointments} appointments — {account.unattributedAppointments}{' '}
                {account.unattributedAppointments === 1 ? 'is' : 'are'} not attributed to any campaign.
              </p>
            )}
            {/* ⭐ SORTED BY SPEND, DESCENDING. 42 unordered cards is a wall, and the order
                that matters to a media buyer is where the money went. Ties keep their
                original relative order (Array.prototype.sort is stable), so equal-spend
                campaigns do not shuffle between renders. */}
            {/* ⛔ THE QUIET ONES ARE FOLDED, NEVER DROPPED — and the fold STATES ITS COUNT.
                A campaign with no leads and no appointments is still real; hiding it
                silently is the class we spent the night removing. It collapses behind a
                line that says how many and what they have in common, and it opens. */}
            {quietCampaigns.length > 0 && (
              <button
                onClick={() => setShowQuiet(v => !v)}
                className="text-xs text-muted-foreground underline mb-2 block"
              >
                {showQuiet ? 'Hide' : 'Show'} {quietCampaigns.length} campaign{quietCampaigns.length === 1 ? '' : 's'} with no leads and no appointments
                {' '}({formatCurrency(quietSpend)} spend)
              </button>
            )}
            <div className="space-y-2">
              {visibleCampaigns.map(c => {
                const isExcluded = (settings.excludedCampaigns || []).includes(c.campaignId);
                const cPerf = isExcluded ? null : getPerfByProgram(program, c.cpl, c.costPerAppt, c.appointments);
                const isExpanded = expandedCampaigns.has(c.campaignId);
                return (
                  <div key={c.campaignId} className={`card-elevated overflow-hidden${isExcluded ? ' opacity-60' : ''}`}>
                    <div
                      className="p-3 cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => toggleCampaign(c.campaignId)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-start gap-2 flex-1 min-w-0">
                          {isExpanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" />}
                          <span className="text-sm font-medium leading-snug">{c.campaignName}</span>
                          {isExcluded && <span className="text-[10px] font-medium text-muted-foreground px-1.5 py-0.5 rounded bg-muted shrink-0 mt-0.5">Excluded</span>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                          {!isExcluded && cPerf && <PerformanceBadge level={cPerf} />}
                          <input
                            type="checkbox"
                            checked={!isExcluded}
                            onChange={() => onToggleExclude(c.campaignId)}
                            className="w-3.5 h-3.5 accent-primary cursor-pointer"
                            title={isExcluded ? 'Include in performance metrics' : 'Exclude from performance metrics'}
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-3 mt-1.5 ml-5">
                        <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">SPEND</span><span className="text-xs font-mono-tabular font-semibold">{formatCurrency(c.spend)}</span></span>
                        <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">LEADS</span><span className="text-xs font-mono-tabular font-semibold">{c.leads}</span></span>
                        <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">CPL</span><span className="text-xs font-mono-tabular font-semibold"><CPLBadge value={c.cpl} leads={c.leads} known={account.spendKnown} /></span></span>
                        <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">APPTS</span><span className="text-xs font-mono-tabular font-semibold">{appt(() => String(c.appointments))}</span></span>
                        <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">CPA</span><span className="text-xs font-mono-tabular font-semibold"><CostPerApptBadge value={c.costPerAppt} appointments={c.appointments} known={account.spendKnown === false || account.apptsKnown === false ? false : undefined} /></span></span>
                      </div>
                    </div>
                    {isExpanded && c.adSets && c.adSets.length > 0 && (
                      <div className="border-t border-border">
                        {c.adSets.map((as, idx) => {
                          const asPerf = getPerfByProgram(program, as.cpl, as.costPerAppt, as.appointments);
                          const asKey = as.adSetId || String(idx);
                          const isAdSetExpanded = expandedAdSets.has(asKey);
                          return (
                            <div key={asKey} className={idx > 0 ? 'border-t border-border/50' : ''}>
                              <div
                                className="pl-4 pr-3 py-2 cursor-pointer hover:bg-muted/20 transition-colors"
                                onClick={() => toggleAdSet(asKey)}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  {isAdSetExpanded ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
                                  <span className="text-xs text-foreground truncate">{as.adSetName}</span>
                                  {asPerf && <PerformanceBadge level={asPerf} />}
                                  <span className="text-[10px] text-muted-foreground">{as.adCount} ads</span>
                                </div>
                                <div className="flex flex-wrap gap-3 mt-1 pl-5">
                                  <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">SPEND</span><span className="text-[11px] font-mono-tabular font-semibold">{formatCurrency(as.spend)}</span></span>
                                  <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">LEADS</span><span className="text-[11px] font-mono-tabular font-semibold">{as.leads}</span></span>
                                  <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">CPL</span><span className="text-[11px] font-mono-tabular font-semibold"><CPLBadge value={as.cpl} leads={as.leads} known={account.spendKnown} /></span></span>
                                  <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">APPTS</span><span className="text-[11px] font-mono-tabular font-semibold">{appt(() => String(as.appointments))}</span></span>
                                  <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">CPA</span><span className="text-[11px] font-mono-tabular font-semibold"><CostPerApptBadge value={as.costPerAppt} appointments={as.appointments} known={account.spendKnown === false || account.apptsKnown === false ? false : undefined} /></span></span>
                                </div>
                              </div>
                              {isAdSetExpanded && as.ads && as.ads.length > 0 && (
                                <div className="border-t border-border/40 bg-muted/10">
                                  {as.ads.map((ad, adIdx) => (
                                    <div key={ad.adId || adIdx} className={`pl-10 pr-3 py-2 ${adIdx > 0 ? 'border-t border-border/30' : ''}`}>
                                      <div className="flex items-center gap-1.5 min-w-0 mb-1">
                                        <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
                                        <span className="text-[11px] text-foreground truncate">{ad.adName || 'Unnamed Ad'}</span>
                                      </div>
                                      <div className="flex flex-wrap gap-3 pl-3">
                                        <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">SPEND</span><span className="text-[10px] font-mono-tabular font-semibold">{formatCurrency(ad.spend)}</span></span>
                                        <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">LEADS</span><span className="text-[10px] font-mono-tabular font-semibold">{ad.leads}</span></span>
                                        <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">CPL</span><span className="text-[10px] font-mono-tabular font-semibold"><CPLBadge value={ad.cpl} leads={ad.leads} known={account.spendKnown} /></span></span>
                                        <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">APPTS</span><span className="text-[10px] font-mono-tabular font-semibold">{appt(() => String(ad.appointments))}</span></span>
                                        <span className="inline-flex flex-col"><span className="text-[10px] text-muted-foreground">CPA</span><span className="text-[10px] font-mono-tabular font-semibold"><CostPerApptBadge value={ad.costPerAppt} appointments={ad.appointments} known={account.spendKnown === false || account.apptsKnown === false ? false : undefined} /></span></span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 4 — Recent Appointments */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-1">Appointments ({account.appointmentList.length})</h3>
            {/* 🔴 THE TABLE WAS ALREADY TRUNCATED AND NOTHING SAID SO. The heading counts the
                whole list while the body renders `.slice(0, 30)` — on Backyard Paradiso that
                is 30 rows under a heading reading 323. A bound that cannot report reaching
                itself is a bound that lies, so it reports itself now. */}
            {account.appointmentList.length > recentAppts.length && (
              <p className="text-[11px] text-muted-foreground mb-2">
                Showing the {recentAppts.length} most recent of {account.appointmentList.length}.
              </p>
            )}
            {/* ⛔ AN ALL-EMPTY COLUMN IS INFORMATION — nobody is filling that field in — so it
                is NAMED when it collapses. Hiding it silently is the exact class we spent the
                night removing; the column goes, the fact does not. */}
            {emptyCols.length > 0 && (
              <p className="text-[11px] text-muted-foreground mb-2">
                {emptyCols.join(', ')} {emptyCols.length === 1 ? 'is' : 'are'} empty on all{' '}
                {account.appointmentList.length} appointments — column{emptyCols.length === 1 ? '' : 's'} hidden.
              </p>
            )}
            {recentAppts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No appointments found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide border-b border-border" style={{ height: '32px' }}>
                      <th className="text-left px-2 align-middle">Setter</th>
                      <th className="text-left px-2 align-middle">Date</th>
                      {!hidden.has('Show Status') && <th className="text-left px-2 align-middle">Show Status</th>}
                      {!hidden.has('Lead Valid') && <th className="text-left px-2 align-middle">Lead Valid</th>}
                      {!hidden.has('Revenue') && <th className="text-right pr-2 align-middle">Revenue</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {recentAppts.map((appt, i) => (
                      <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="px-2 py-1.5 text-foreground">{appt.setter || '—'}</td>
                        <td className="px-2 py-1.5 text-muted-foreground font-mono-tabular">{formatDate(appt.dateAdded || appt.appointmentDate)}</td>
                        {!hidden.has('Show Status') && <td className="px-2 py-1.5 text-muted-foreground">{appt.showStatus || '—'}</td>}
                        {!hidden.has('Lead Valid') && <td className="px-2 py-1.5 text-muted-foreground">{appt.leadValid || '—'}</td>}
                        {!hidden.has('Revenue') && <td className="pr-2 py-1.5 text-right font-mono-tabular">{formatCurrency(appt.closedRevenue || 0)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// === Unmatched Section (unchanged) ===

function UnmatchedSection({
  appointments,
  accounts,
  settings,
  setSettings,
  refresh,
  assignedClients,
  setAssignedClients,
  recentlyAssigned,
  setRecentlyAssigned,
}: {
  appointments: AppointmentRow[];
  accounts: AccountSummary[];
  settings: any;
  setSettings: (s: any) => void;
  refresh: (s?: any) => Promise<void>;
  assignedClients: Set<string>;
  setAssignedClients: React.Dispatch<React.SetStateAction<Set<string>>>;
  recentlyAssigned: Set<string>;
  setRecentlyAssigned: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  const [open, setOpen] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);

  const visibleAppts = appointments.filter(a => !assignedClients.has(a.client?.trim().toLowerCase() || ''));

  const handleAssign = useCallback(async (appt: AppointmentRow, accountName: string) => {
    const clientKey = appt.client?.trim().toLowerCase() || '';
    setAssigning(clientKey);
    try {
      const existingAliases = settings.accountAliases || [];
      const alreadyExists = existingAliases.some(
        (a: any) => a.airtableName?.trim().toLowerCase() === clientKey
      );
      if (!alreadyExists) {
        const newAlias = {
          sheetName: accountName,
          airtableName: appt.client?.trim() || '',
          program: 'Done For You' as const,
          mediaBuyer: '',
          status: 'Active' as const,
        };
        const updatedAliases = [...existingAliases, newAlias];
        const updatedSettings = { ...settings, accountAliases: updatedAliases };
        setSettings(updatedSettings);
        await Promise.all([
          saveSettings(updatedSettings),
          saveAccountMappings(updatedAliases),
        ]);
      }
      setRecentlyAssigned(prev => new Set(prev).add(clientKey));
      setTimeout(() => {
        setAssignedClients(prev => new Set(prev).add(clientKey));
        setRecentlyAssigned(prev => {
          const next = new Set(prev);
          next.delete(clientKey);
          return next;
        });
      }, 1500);
      await refresh();
    } finally {
      setAssigning(null);
    }
  }, [settings, setSettings, refresh, setAssignedClients, setRecentlyAssigned]);

  if (visibleAppts.length === 0) return null;

  const uniqueByClient = new Map<string, AppointmentRow>();
  for (const a of visibleAppts) {
    const key = a.client?.trim().toLowerCase() || a.campaignName || '';
    if (!uniqueByClient.has(key)) uniqueByClient.set(key, a);
  }
  const displayAppts = Array.from(uniqueByClient.values());

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden" style={{ borderLeftWidth: '4px', borderLeftColor: 'hsl(var(--warning, 45 93% 47%))' }}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
      >
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        <AlertTriangle className="w-4 h-4 text-warning-strong" />
        <span>{visibleAppts.length} Unmatched Appointment{visibleAppts.length !== 1 ? 's' : ''}</span>
        <span className="text-muted-foreground font-normal ml-1">({displayAppts.length} unique client{displayAppts.length !== 1 ? 's' : ''})</span>
      </button>
      {open && (
        <div className="border-t border-border overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wide border-b border-border" style={{ height: '36px' }}>
                <th className="text-left pl-4 align-middle">Client Name</th>
                <th className="text-left px-3 align-middle">Lead Name</th>
                <th className="text-left px-3 align-middle">Date Added</th>
                <th className="text-left px-3 align-middle">Campaign</th>
                <th className="text-left px-3 align-middle" style={{ width: '200px' }}>Assign to Account</th>
              </tr>
            </thead>
            <tbody>
              {displayAppts.map((appt, i) => {
                const clientKey = appt.client?.trim().toLowerCase() || '';
                const isAssigning = assigning === clientKey;
                const justAssigned = recentlyAssigned.has(clientKey);
                return (
                  <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="pl-4 py-2 font-medium">{appt.client || '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{appt.setter || '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground font-mono-tabular">{formatDate(appt.dateAdded || appt.appointmentDate)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{appt.campaignName || '—'}</td>
                    <td className="px-3 py-2">
                      {justAssigned ? (
                        <span className="inline-flex items-center gap-1 text-success text-xs font-medium">
                          <Check className="w-3.5 h-3.5" /> Mapped!
                        </span>
                      ) : (
                        // @andrew: "the dropdowns on here look horrendous, look what modern
                        // software does." A native <select> over 30+ account names, in a
                        // table cell, with no search. Same control the Settings panel uses.
                        <Combobox
                          aria-label={`Assign an account to the appointment for ${appt.client || 'this lead'}`}
                          value={null}
                          onChange={v => { if (v) handleAssign(appt, v); }}
                          options={accounts.map(a => a.accountName)}
                          placeholder={isAssigning ? 'Assigning…' : 'Select account'}
                          searchPlaceholder="Search accounts"
                          emptyLabel="No matching account."
                          className="h-8 text-xs"
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { accounts, adSpend, appointments, unmatchedAppointments, settings, loading, error, configured, settingsLoaded, sources, refresh, setSettings, honestNumbers, settingsOrigin, settingsDetail, accountRegistry} = useData();
  const [assignedClients, setAssignedClients] = useState<Set<string>>(new Set());
  const [recentlyAssigned, setRecentlyAssigned] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [perfFilter, setPerfFilter] = useState<'all' | PerformanceLevel>('all');
  const [accountFilter, setAccountFilter] = useState('all');
  const [dateRange, setDateRange] = useState<DateRange>(ALL_TIME);
  const [selectedAccountName, setSelectedAccountName] = useState<string | null>(null);

  /**
   * ⭐ PUSH THE DATE RANGE DOWN INTO SQL.
   *
   * Half the reason for leaving the Google Sheet: a CSV must be downloaded whole and
   * filtered here, so "This Month" cost the same 48,000-row transfer as All Time.
   * `ad_insights` answers a WHERE clause, so the same choice now narrows the QUERY.
   *
   * ⚠️ THE CLIENT-SIDE FILTER BELOW STAYS, and it is not redundant. It is what keeps this
   * page correct while the narrowed refetch is in the air — for that moment `adSpend` still
   * holds the WIDER set, and without the second filter the tiles would show the old range's
   * totals under the new range's label. It also still filters APPOINTMENTS, which come from
   * Airtable and are not narrowed by this query at all. Belt and braces, on purpose: after
   * the refetch lands the filter is simply a no-op over an already-correct set.
   */
  const { setSpendWindow } = useData();
  useEffect(() => {
    setSpendWindow({ from: toIsoDay(dateRange.from), to: toIsoDay(dateRange.to) });
  }, [dateRange, setSpendWindow]);

  /**
   * ⑥ RETURNS THE WHOLE RESULT NOW, NOT JUST `.accounts`.
   *
   * The unmatched appointments were being DISCARDED here, so the page had no date-filtered
   * count of them — and TOTAL APPTS could only ever sum what had been attributed. @bird:
   * "@andrew's headline is 636 when 679 exist."
   */
  const dateFilteredResult = useMemo(() => {
    const { from, to } = dateRange;
    if (!from && !to) return { accounts, unmatchedAppointments };
    const filteredSpend = adSpend.filter(row => {
      const d = parseDateSafe(row.date);
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
    const filteredAppts = appointments.filter(row => {
      const d = parseDateSafe(row.dateAdded || row.appointmentDate);
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
    /**
     * ⭐ BOTH TRAILING ARGUMENTS ARE OPTIONAL IN THE SIGNATURE AND MANDATORY IN PRACTICE.
     * Every one of them defaults to a value that ASSERTS something this page cannot know,
     * and each omission has already shipped once.
     *
     * ④ `known` defaults `?? true`, so omitting it asserts EVERY SOURCE IS ALIVE and turns
     *    a dead source's em dashes back into numbers the moment a user picks a date range.
     *    Measured on this page: 5 honest em dashes per row became 5 fabricated values on
     *    "This Week". Same flags as useData.tsx, so a filtered view cannot disagree with an
     *    unfiltered one.
     *
     * 🔴 ⑤ `registry` defaults to `emptyAccountRegistry()` — AND IT WAS OMITTED HERE, ON
     *    Targets, AND ON TeamPerformance. A registry that answers nothing is not neutral:
     *    it is the pre-cutover identity model. So picking ANY date range silently recomputed
     *    the whole page against `ad_accounts` as if that table did not exist. Measured over
     *    the identical rows, the argument as the ONLY variable
     *    (`scripts/probe-registry-drop.mts`):
     *
     *        TOTAL SPEND tile     $769,052.69  ->  $770,956.72
     *        TOTAL LEADS tile          30,393  ->      30,966
     *        company name         51 of 52 accounts fall back to Meta's raw label
     *                             ("Washbroz" -> "Washbroz X SocialWorks")
     *        program              3 accounts revert · media buyer 2 revert
     *        status               an ARCHIVED account returns as Active and re-enters
     *                             the Active-only totals above
     *
     *    ⇒ The unfiltered page and the filtered page answered with DIFFERENT ACCOUNT
     *    IDENTITIES, and the difference was invisible because both answers are plausible.
     *    It also killed the `ad_account_airtable_names` path — the stable
     *    Airtable-client-name -> `account_id` join — dropping appointments back onto the
     *    legacy alias store and the fuzzy tier, which is precisely the rename bug the
     *    cutover exists to remove.
     */
    return buildAccountSummaries(filteredSpend, filteredAppts, settings, {
      spend: hasUsableData(sources.meta.state),
      appts: hasUsableData(sources.airtable.state),
    }, accountRegistry);
  // `sources` IS A DEPENDENCY NOW, and omitting it would be a stale closure: the memo
  // reads the source states to build `known`, so a source dying without dateRange changing
  // would keep serving summaries stamped ALIVE. `accountRegistry` is a dependency for the
  // same reason: it arrives on the data path, so a memo that closed over the initial empty
  // one would keep serving Meta's raw names after the real mapping had loaded.
  }, [accounts, adSpend, appointments, settings, dateRange, sources, accountRegistry, unmatchedAppointments]);

  const dateFilteredAccounts = dateFilteredResult.accounts;

  const filteredAccounts = useMemo(() => {
    return dateFilteredAccounts.filter(a => {
      // Search both names. The box sits under a column that now shows the CLIENT name, and
      // filtering only on Meta's meant typing what you could see returned nothing.
      if (search) {
        const q = search.toLowerCase();
        const hay = `${a.accountName} ${a.companyName ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (accountFilter !== 'all' && a.accountName !== accountFilter) return false;
      if (perfFilter !== 'all') {
        const { program, status } = a;
        const perf = (status === 'Paused' || status === 'Churned') ? null : getPerfByProgram(program, a.cpl, a.costPerAppt, a.appointments);
        if (perf !== perfFilter) return false;
      }
      return true;
    });
  }, [dateFilteredAccounts, search, perfFilter, accountFilter]);

  const totals = useMemo(() => {
    const activeAccounts = filteredAccounts.filter(a => a.status === 'Active');
    /**
     * 🔴 `Internal` WAS FALLING INTO THE CLIENT-FACING DFY RATE, because this line asked
     * "not DWY" instead of asking what the population actually is.
     *
     * `Internal` is a NEW program value — it arrived with `ad_accounts` at the cutover — and
     * it means OUR OWN agency and recruiting spend, which books no client appointments. It
     * satisfied `!== 'Done With You'`, so it landed in the numerator of a rate whose
     * denominator it contributes nothing to. Measured 2026-08-12 on the live feed: the
     * `SocialWorks` account carries $51,056.88 and 0 appointments, and Avg Cost/Appt read
     * $637.55 where the client-facing population gives $549.82 — a 13.8% overstatement of
     * what it costs us to book a client an appointment, on the tile the media buyers are
     * judged on.
     *
     * ⭐ THE REST OF THE PAGE ALREADY KNEW. `getPerfByProgram` returns null for `Internal`
     * (line ~163: "it is agency and recruiting spend"), and the account table gives Internal
     * its own collapsed group. This reducer was the one place that had not been told.
     *
     * ⛔ IT LEAVES THE *TOTALS* ALONE ON PURPOSE. Total Spend and Total Leads still count
     * Internal, because they are totals over money we actually spent. Only the two RATE tiles
     * narrow, and the note under them names both exclusions.
     */
    const dfyAccounts = activeAccounts.filter(a => a.program !== 'Done With You' && a.program !== 'Internal');

    /**
     * 🔴 EVERY TILE ON THIS ROW IS ACTIVE-ONLY, AND THE ROW NEVER SAID SO.
     *
     * The line above has always been here, and the two disclosures further down (`dwyExcluded`
     * on the rate tiles, `unmatchedExcluded` on Total Appts) exist precisely because a tile
     * whose population is narrower than its label is a number the next reader has to re-open.
     * This filter is the THIRD narrowing on the same row and it was the only silent one.
     *
     * ⭐ THE CUTOVER MADE IT BITE. `resolveStatus` now lets `ad_accounts.status = 'archived'`
     * override to `Churned`, which is what made the Archived control a control at all — and it
     * immediately started removing real money from a tile labelled TOTAL SPEND. Measured
     * 2026-08-12 against the live feed: the `Hiring` account is archived, so $1,904.03 and 573
     * leads leave every total on this row, and the headline reads $769,080.31 where the feed
     * holds $770,984.34. Both numbers are correct; only one of them was explained.
     *
     * ⚠️ THE FIX IS THE DISCLOSURE, NOT THE POPULATION. Active-only is deliberate and is
     * encoded in four other places (the account groups below, Targets, TeamPerformance, the
     * performance filter). Widening the reducer here to "fix" the reconciliation would put a
     * churned client's spend back into the number the media buyers are judged on.
     */
    const inactiveAccounts = filteredAccounts.filter(a => a.status !== 'Active');
    const excludedSpend = inactiveAccounts.reduce((s, a) => s + a.spend, 0);
    const excludedLeads = inactiveAccounts.reduce((s, a) => s + a.leads, 0);
    const excludedNames = inactiveAccounts
      .filter(a => a.spend > 0 || a.leads > 0)
      .sort((x, y) => y.spend - x.spend)
      .map(a => accountTitle(a).label);


    const spend = activeAccounts.reduce((s, a) => s + a.spend, 0);
    const leads = activeAccounts.reduce((s, a) => s + a.leads, 0);
    const perfSpend = activeAccounts.reduce((s, a) => s + a.performanceSpend, 0);
    const perfLeads = activeAccounts.reduce((s, a) => s + a.performanceLeads, 0);
    /**
     * ⑥ A TOTAL MUST COUNT EVERY APPOINTMENT — @bird measured 636 on screen while 679
     * existed, and @fable's own sentence for this class is "a real booking invisible to
     * the headline".
     *
     * An UNMATCHED appointment belongs to no account, so reducing over accounts can never
     * see it. It is still a real booking on a real date.
     *
     * ⛔ ONLY WHEN THE VIEW IS NOT NARROWED TO A SUBSET OF ACCOUNTS. Under a search, an
     * account filter or a performance filter the tile describes THOSE accounts, and an
     * appointment that belongs to no account is not in that population — adding it there
     * would be the mirror defect, a number inflated by rows the filter excluded.
     *
     * ⚠️ AND IT IS DELIBERATELY NOT ADDED TO `dfyAppts` BELOW. @raccoon: "an unmatched appt
     * has no ACCOUNT so it has no PROGRAM; adding it to a DFY-only RATE attributes a
     * conversion to a population it may not be in. A TOTAL must count it, a RATE must not."
     */
    const viewIsNarrowed = Boolean(search) || accountFilter !== 'all' || perfFilter !== 'all';
    const unmatchedTotal = dateFilteredResult.unmatchedAppointments.length;
    const unmatchedInView = viewIsNarrowed ? 0 : unmatchedTotal;
    /**
     * 🟡 @bird: in a NARROWED view the 43 are correctly excluded — and the note explaining
     * them disappeared with them, because it was gated on the same value. Meanwhile the
     * banner two inches away still read "43 Unmatched Appointments".
     * ⇒ The app was dropping 43 appointments SILENTLY while another element on the same
     *   screen said they existed. The EXCLUSION is right; its DISCLOSURE vanished exactly
     *   when a reader would want it. So the note now speaks in BOTH states.
     */
    const unmatchedExcluded = viewIsNarrowed ? unmatchedTotal : 0;
    const appts = activeAccounts.reduce((s, a) => s + a.appointments, 0) + unmatchedInView;
    /**
     * 🔴 THE SAME LAW, APPLIED TO THE TWO TILES THAT WERE LEFT OUT OF IT — and this is the
     * defect the cutover exposed rather than caused.
     *
     * ⑥ above fixed TOTAL APPTS by adding `unmatchedInView` back. `closed` and `revenue`
     * still reduced over ACCOUNTS ONLY, so an unmatched appointment that is a CLOSED WON
     * DEAL left the headline with nothing on screen naming it. Measured 2026-08-12 against
     * the live sources: `Green Plus Remodeling`'s 30 detached appointments include 4 wins
     * worth $22,100, and the tiles read 43 / $1,598,243.72 where 47 / $1,620,343.72 exists.
     * The unmatched banner counts APPOINTMENTS and has never counted MONEY, so $22,100 of
     * real revenue was invisible to every reader of this page.
     *
     * ⚠️ A DETACHED APPOINTMENT IS STILL A REAL SIGNED DEAL. It has no ACCOUNT, which is why
     * it may not enter a per-account rate (see @raccoon's rule above), but "closed deals" and
     * "total revenue" are TOTALS over the business, not rates over a program. The identical
     * reasoning that put 57 bookings back into TOTAL APPTS puts their wins back here.
     *
     * ⛔ AND UNDER THE SAME NARROWING GUARD, for the same reason: in a filtered view these
     * tiles describe the accounts on screen, and an appointment belonging to no account is
     * not in that population. Excluded there, and SAID SO there — the disclosure speaks in
     * both states, exactly as `unmatchedExcluded` does.
     */
    const unmatchedWins = dateFilteredResult.unmatchedAppointments.filter(a => isClosedWon(a, settings));
    const unmatchedRevenueTotal = unmatchedWins.reduce((s, a) => s + (a.closedRevenue || 0), 0);
    const unmatchedClosedInView = viewIsNarrowed ? 0 : unmatchedWins.length;
    const unmatchedRevenueInView = viewIsNarrowed ? 0 : unmatchedRevenueTotal;
    const unmatchedClosedExcluded = viewIsNarrowed ? unmatchedWins.length : 0;
    const unmatchedRevenueExcluded = viewIsNarrowed ? unmatchedRevenueTotal : 0;
    const closed = activeAccounts.reduce((s, a) => s + a.closed, 0) + unmatchedClosedInView;
    const revenue = activeAccounts.reduce((s, a) => s + a.revenue, 0) + unmatchedRevenueInView;

    // ⭐ ONE POPULATION FOR BOTH APPOINTMENT TILES. Before this, `costPerAppt` summed
    // DFY-only spend over DFY-only appointments while `leadToApptPct` summed ALL-account
    // appointments over ALL-account leads. Each was internally consistent and they described
    // DIFFERENT BUSINESSES, with nothing on screen saying so.
    //
    // DFY is the correct population and it is not a preference — four sites already encode it:
    //   AIChatPanel.tsx  "Done With You (DWY): we only run ads, CLIENT HANDLES LEADS"
    //   dataService.ts   DWY is judged on CPL; DFY/Other on cost-per-appointment
    //   Dashboard.tsx    the same rule, mirrored, in getPerfByProgram
    //   Targets.tsx      DFY and DWY split into separate populations deliberately
    // DWY accounts contribute LEADS (we run their ads) and NOT appointments (their client
    // books them), so an all-accounts lead→appt rate is understated by exactly the DWY lead
    // volume. That is the defect: not a wrong sum, a denominator from another population.
    const dfyPerfSpend = dfyAccounts.reduce((s, a) => s + a.performanceSpend, 0);
    const dfyPerfLeads = dfyAccounts.reduce((s, a) => s + a.performanceLeads, 0);
    const dfyAppts = dfyAccounts.reduce((s, a) => s + a.appointments, 0);
    // Counted SEPARATELY rather than as one "excluded" number, because the note has to name
    // WHICH population left: "Done-With-You" and "Internal" are excluded for opposite
    // reasons (a client whose leads we do not work, versus spend that has no client at all),
    // and a single count would make the reader open the table to find out which.
    const dwyExcluded = activeAccounts.filter(a => a.program === 'Done With You').length;
    const internalExcluded = activeAccounts.filter(a => a.program === 'Internal').length;

    return {
      spend, leads,
      cpl: perfLeads > 0 ? perfSpend / perfLeads : 0,
      appts,
      leadToApptPct: dfyPerfLeads > 0 ? (dfyAppts / dfyPerfLeads) * 100 : 0,
      dwyExcluded,
      internalExcluded,
      costPerAppt: dfyAppts > 0 ? dfyPerfSpend / dfyAppts : 0,
      closed, revenue,
      unmatchedAppts: unmatchedInView,
      unmatchedExcluded,
      unmatchedClosed: unmatchedClosedInView,
      unmatchedRevenue: unmatchedRevenueInView,
      unmatchedClosedExcluded,
      unmatchedRevenueExcluded,
      excludedSpend, excludedLeads, excludedNames,
    };
  }, [filteredAccounts, dateFilteredResult, search, accountFilter, perfFilter, settings]);

  /**
   * ⭐ THE SENTENCE THAT MAKES THE ACTIVE-ONLY NARROWING READABLE, and the rules it follows.
   *
   * ① IT NAMES THE ACCOUNTS, not just a count. "1 account excluded" sends the reader to the
   *    table to work out which one; the name ends the question on the tile row.
   * ② IT SPEAKS ONLY WHEN MONEY OR LEADS ACTUALLY LEFT. A churned account with no spend in
   *    the window changes no total, and a banner that fires on every load is the thing
   *    @andrew asked to be removed («annoying just remove these popups»). Silence here is
   *    earned by measurement, not by omission.
   * ③ IT IS NOT GATED ON `spendOk`. When the feed is dead the tiles read "—" and there are no
   *    account rows at all, so `excludedNames` is empty and this says nothing anyway.
   */
  const excludedNames = totals.excludedNames;
  const statusExclusionNote =
    excludedNames.length > 0
      ? `Totals cover Active accounts only. Excluded: ${
          excludedNames.slice(0, 3).join(', ')
        }${excludedNames.length > 3 ? `, and ${excludedNames.length - 3} more` : ''} (${
          formatCurrency(totals.excludedSpend)
        }, ${formatNumber(totals.excludedLeads)} leads).`
      : null;

  // Derive selectedAccount from name so it auto-updates after refresh
  // Both appointment tiles are Done-For-You only; the note says so on the tile itself, and
  // it now names `Internal` too — see the `dfyAccounts` block for why that spend used to be
  // inside a client-facing rate and what it did to the number.
  const apptPopulationNote = (() => {
    const parts: string[] = [];
    if (totals.dwyExcluded > 0) parts.push(`${totals.dwyExcluded} Done-With-You`);
    if (totals.internalExcluded > 0) parts.push(`${totals.internalExcluded} Internal`);
    return parts.length > 0
      ? `Done-For-You accounts only — ${parts.join(' and ')} excluded`
      : 'Done-For-You accounts only';
  })();

  /**
   * ⭐ THE MONEY THAT IS IN — OR OUT OF — THE TWO DEAL TILES, SAID ON THE TILES.
   *
   * A total whose composition changes with a filter, and says nothing, is the defect one
   * level up from a wrong number: the reader has no way to know the question changed. This
   * is the same sentence pattern TOTAL APPTS already carries, applied to the two tiles that
   * were quietly reducing over accounts only while $22,100 of real closed revenue sat in the
   * unmatched bucket.
   */
  const unmatchedDealsNote =
    totals.unmatchedClosed > 0
      ? `includes ${totals.unmatchedClosed} from appointments not matched to an account`
      : totals.unmatchedClosedExcluded > 0
        ? `excludes ${totals.unmatchedClosedExcluded} from appointments not matched to an account — a filtered view shows only matched accounts`
        : undefined;
  const unmatchedRevenueNote =
    totals.unmatchedClosed > 0
      ? `includes ${formatCurrency(totals.unmatchedRevenue)} from appointments not matched to an account`
      : totals.unmatchedClosedExcluded > 0
        ? `excludes ${formatCurrency(totals.unmatchedRevenueExcluded)} from appointments not matched to an account — a filtered view shows only matched accounts`
        : undefined;

  const selectedAccount = useMemo(
    () => selectedAccountName ? dateFilteredAccounts.find(a => a.accountName === selectedAccountName) ?? null : null,
    [selectedAccountName, dateFilteredAccounts],
  );

  const handleToggleExclude = useCallback(async (campaignId: string) => {
    const current = settings.excludedCampaigns || [];
    const updated = current.includes(campaignId)
      ? current.filter(id => id !== campaignId)
      : [...current, campaignId];
    const updatedSettings = { ...settings, excludedCampaigns: updated };
    setSettings(updatedSettings);
    await saveSettings(updatedSettings);
    await refresh(updatedSettings);
  }, [settings, setSettings, refresh]);

  const accountGroups = useMemo((): AccountGroup[] => {
    const dfy: AccountSummary[] = [];
    const dwy: AccountSummary[] = [];
    const internal: AccountSummary[] = [];
    const unset: AccountSummary[] = [];
    const paused: AccountSummary[] = [];
    const churned: AccountSummary[] = [];
    for (const a of filteredAccounts) {
      if (a.status === 'Paused') { paused.push(a); continue; }
      if (a.status === 'Churned') { churned.push(a); continue; }
      if (a.program === 'Done With You') { dwy.push(a); continue; }
      if (a.program === 'Internal') { internal.push(a); continue; }
      /**
       * 🔴 AN ACCOUNT WITH NO PROGRAM USED TO BE FILED UNDER "Done For You — Active".
       * `getAccountMapping` defaulted a missing program to that string, so five live
       * accounts (Co-Lights, No Streaks, Quality Painting, STR, Trimlight Phoenix —
       * $18,547 all-time, $7,008 of it in 2026) were asserted into a program nobody had
       * chosen for them, under a heading that named it. A refusal must be a VALUE: they
       * get their own group, so the gap is visible and one click from being closed.
       */
      if (!a.program || a.program === 'Unknown') { unset.push(a); continue; }
      dfy.push(a);
    }
    return [
      { label: 'Done For You — Active', accounts: dfy, defaultOpen: true },
      { label: 'Done With You — Active', accounts: dwy, defaultOpen: true },
      { label: 'No program set', accounts: unset, defaultOpen: true },
      { label: 'Internal', accounts: internal, defaultOpen: false },
      { label: 'Paused', accounts: paused, defaultOpen: false },
      { label: 'Churned', accounts: churned, defaultOpen: false },
    ];
  }, [filteredAccounts]);

  // Whether a KPI may print a number at all. `hasUsableData` is true for valid and for
  // stale (real data, just older) — it is false for failed and not-configured, where the
  // only honest render is an em dash.
  const spendOk = hasUsableData(sources.meta.state);
  const apptsOk = hasUsableData(sources.airtable.state);
  // There is no `callsOk`: the call-centre source was removed entirely on 2026-08-11.
  // Its sheet was never connected in production, so every dial figure the app rendered
  // was a confident zero standing in for data that never existed.

  // "Not configured" is a claim about the user's setup. Until the settings have come back
  // from the database we have not looked, and on a cold browser (new device, cleared
  // storage, private window) the local cache is empty, so this used to assert a definite
  // negative for the length of a network round trip.
  if (!settingsLoaded) {
    return (
      <div className="space-y-6 w-full">
        <h1 className="text-xl font-bold">Dashboard</h1>
        <KPISkeleton />
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="max-w-2xl mx-auto mt-20">
        <ConfigBanner origin={settingsOrigin} detail={settingsDetail} />
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full">
      <h1 className="text-xl font-bold">Dashboard</h1>

      {/* Above every number it describes. The exclusion loss inflates every CPL and
          cost-per-appointment on this page, and until this rendered, nothing said so. */}
      {/*
        ⭐ SCOPED TO WHAT THIS PAGE SHOWS. @andrew: «annoying just remove these popups».
        He is right that they were noise, and the reason is precise rather than aesthetic:
        TWO OF THE THREE WARNED HIM ABOUT NUMBERS THAT ARE NOT ON THIS PAGE.

          setter bonus rates   payouts render on /agents. The dashboard has no payout
                               figure, so the $5 default cannot mislead anyone HERE.
          exclusions inert     kept — cost-per-lead and cost-per-appointment ARE on this
                               page and ARE computed on unfiltered spend. That one changes
                               a number he is looking at.

        ⛔ NOT DELETED, MOVED. The setter warning is the ONLY thing standing between a
        fabricated $5 rate and a payout sheet he might send someone — it belongs on
        /agents, loudly, and Agents.tsx already renders its own. Silencing it everywhere
        would re-create the exact defect this branch exists to remove.

        ⭐ THE GENERAL RULE, now applied three times (call-centre source, this, and the
        route-scoped SourceStatusBanner): A WARNING BELONGS WHERE THE NUMBER IT IS ABOUT
        IS RENDERED. Everywhere else it is noise, and noise is how the warnings that DO
        matter stop being read.
      */}
      <HonestNumbersBanner
        messages={honestNumbers.messages.filter(m => !m.startsWith('No setter bonus rates') && !m.startsWith('Some setters have no configured bonus rate'))}
      />

      {/* WRAPPED, not onRetry={refresh}: React hands a bare handler reference its click
          event as the first argument, which refresh read as an override settings object —
          it then failed its own isConfigured guard and returned without starting anything.
          The Retry button did nothing at all. */}
      {error && <ErrorBanner message={error} onRetry={() => refresh()} />}

      {/* KPIs — a number is only printed when the source behind it actually delivered.
          A dead source reads "—", never "$0.00". Andrew's question is "is this zero real,
          or did something fail", and on this row it used to be unanswerable for 8 of 9. */}
      {loading ? (
        <KPISkeleton />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* ⚠️ EVERY GUARD HERE NAMES `spendOk`, INCLUDING THE TILES WHOSE VALUE IS NOT
              WINDSOR DATA. @bird drove it and @raccoon censused it: all nine totals reduce
              over `activeAccounts`, and activeAccounts is WINDSOR-DERIVED — no sheet rows,
              no accounts. So Windsor dying yields an EMPTY ARRAY, every reduce(…, 0)
              returns a hard 0, and any guard that does not name Windsor renders it.
              Measured: Windsor dead ⇒ TOTAL APPTS 0 while Airtable was HEALTHY AND
              HOLDING THE APPOINTMENT.

              ⭐ THE RULE, and it is sharper than "and the flags": A GUARD MUST NAME EVERY
              SOURCE THE DERIVATION TRAVERSES, NOT THE SOURCE THE VALUE SEMANTICALLY
              BELONGS TO. Total appts is AIRTABLE data, so `apptsOk` alone looked right,
              but it is summed over a Windsor-derived list, so the derivation traverses
              Windsor too. Spend/leads/cpl were only ever safe by coincidence: their guard
              happened to name the same source their value came from. */}
          <KPICard label="Total Spend" value={spendOk ? formatCurrency(totals.spend) : '—'} />
          <KPICard label="Total Leads" value={spendOk ? formatNumber(totals.leads) : '—'} />
          <KPICard label="Avg CPL" value={spendOk && totals.cpl > 0 ? formatCurrency(totals.cpl) : '—'} />
          {/* ⑥ The tile counts UNMATCHED appointments, so it must say when it is doing so —
              a number that silently changes composition is the defect one level up. */}
          <KPICard
            label="Total Appts"
            value={spendOk && apptsOk ? formatNumber(totals.appts) : '—'}
            note={
              totals.unmatchedAppts > 0
                ? `includes ${totals.unmatchedAppts} not matched to an account`
                : totals.unmatchedExcluded > 0
                  ? `excludes ${totals.unmatchedExcluded} not matched to an account — a filtered view shows only matched accounts`
                  : undefined
            }
          />
          <KPICard label="Lead → Appt %" value={spendOk && apptsOk && totals.leadToApptPct > 0 ? formatPercent(totals.leadToApptPct) : '—'} mono={false} note={apptPopulationNote} />
          <KPICard label="Avg Cost/Appt" value={spendOk && apptsOk && totals.costPerAppt > 0 ? formatCurrency(totals.costPerAppt) : '—'} note={apptPopulationNote} />
          {/* Both tiles now count the wins that belong to no account, and say when they do —
              see the `unmatchedWins` block in `totals`. */}
          <KPICard label="Closed Deals" value={spendOk && apptsOk ? formatNumber(totals.closed) : '—'} note={unmatchedDealsNote} />
          <KPICard label="Total Revenue" value={spendOk && apptsOk ? formatCurrency(totals.revenue) : '—'} note={unmatchedRevenueNote} />
        </div>
      )}

      {/* ⭐ ONE LINE FOR THE WHOLE ROW, because the narrowing applies to the whole row.
          Nine tiles all reduce over `activeAccounts`; nine copies of the same sentence would
          be noise, and putting it on only the money tile would leave the other eight
          unexplained. See `statusExclusionNote` for why it names the accounts and why it is
          silent when nothing left. */}
      {!loading && statusExclusionNote && (
        <p className="text-[11px] text-muted-foreground -mt-2" data-testid="status-exclusion-note">
          {statusExclusionNote}
        </p>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search accounts..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 pr-4 h-9 text-sm rounded-md border border-input bg-background transition-colors hover:border-border focus:outline-none focus-visible:border-ring w-56 min-w-0"
          />
        </div>
        {/* Both were native <select> with `focus:outline-none` and nothing put back, so
            keyboard focus was invisible on them as well as looking like 2011. */}
        <Combobox
          aria-label="Filter accounts"
          value={accountFilter}
          onChange={v => setAccountFilter(v ?? 'all')}
          // value = the match key (Meta's name), label = what the user calls the client.
          options={[
            { value: 'all', label: 'All accounts' },
            ...accounts.map(a => ({ value: a.accountName, label: accountTitle(a).label })),
          ]}
          searchPlaceholder="Search accounts"
          emptyLabel="No matching account."
          className="w-48"
        />
        <Combobox
          aria-label="Filter by performance"
          value={perfFilter}
          onChange={v => setPerfFilter((v ?? 'all') as 'all' | 'good' | 'fair' | 'poor')}
          options={[
            { value: 'all', label: 'All performance' },
            { value: 'good', label: 'Good' },
            { value: 'fair', label: 'Fair' },
            { value: 'poor', label: 'Poor' },
          ]}
          className="w-44"
        />
        <DateRangePicker value={dateRange} onChange={setDateRange} includeAllTime />
      </div>

      {/* Unmatched Appointments */}
      {unmatchedAppointments.length > 0 && (
        <UnmatchedSection
          appointments={unmatchedAppointments}
          accounts={accounts}
          settings={settings}
          setSettings={setSettings}
          refresh={refresh}
          assignedClients={assignedClients}
          setAssignedClients={setAssignedClients}
          recentlyAssigned={recentlyAssigned}
          setRecentlyAssigned={setRecentlyAssigned}
        />
      )}

      {/* Account Table */}
      {loading ? (
        <TableSkeleton rows={5} />
      ) : filteredAccounts.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-y-auto max-h-[70vh]">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-20 bg-background shadow-sm">
                <tr className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wide border-b border-border" style={{ height: '40px' }}>
                  <th className="text-left px-3 align-middle">Account</th>
                  <th className="text-right px-3 align-middle">Spend</th>
                  <th className="text-right px-3 align-middle hidden md:table-cell">Leads</th>
                  <th className="text-right px-3 align-middle hidden md:table-cell">CPL</th>
                  <th className="text-right px-3 align-middle">Appts</th>
                  <th className="text-right px-3 align-middle hidden md:table-cell">L→A %</th>
                  <th className="text-right px-3 align-middle">Cost/Appt</th>
                  <th className="text-right px-3 align-middle hidden md:table-cell">Closed</th>
                  <th className="text-right px-3 align-middle hidden md:table-cell">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {accountGroups.map(g => (
                  <AccountSection key={g.label} group={g} onSelect={a => setSelectedAccountName(a.accountName)} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Account Detail Panel */}
      {selectedAccount && (
        <AccountDetailPanel
          account={selectedAccount}
          settings={settings}
          onClose={() => setSelectedAccountName(null)}
          onToggleExclude={handleToggleExclude}
        />
      )}
    </div>
  );
}
