export interface AppSettings {
  googleSheetUrl: string;
  googleSheetTab: string;
  /**
   * The RAW tab the derived ad-spend tab is generated from, BY NAME.
   *
   * Used only by the completeness detector: it compares this tab's row count to the derived
   * tab's, and any divergence means the derived tab's array formula has run out of range.
   * ⚠️ NAME, not gid, deliberately — @fable's live probe addressed both tabs by name, and a
   * name is something a user can read off the sheet's tab bar. gid requires digging in a URL.
   * The silent-fallback hazard is identical for both forms and is defeated by the sig proof,
   * so the discoverable one wins.
   */
  adsRawTabName?: string;
  /**
   * Which Lead Status values count as a WON deal. @andrew: "yeah make it mappable".
   *
   * ⚠️ ABSENT (undefined) and EMPTY ([]) BOTH MEAN "use the built-in fallback" — they are NOT
   * "nothing counts". An empty array reaching the classifier as a literal answer would take
   * every closed-deal count to zero, which is the failure mode a settings field must never
   * have. See isClosedWonStatus.
   */
  closedWonStatuses?: string[];
  callCenterSheetUrl: string;
  callCenterSheetTab: string;
  airtableBaseId: string;
  airtableTableName: string;
  // ⛔ OWNER-ORDERED EXCEPTION 2026-08-05 — see ALLOWED_CONFIG_KEYS in config.ts for the full
  // reasoning. Optional because the SECURE path (airtable-proxy) needs no token client-side;
  // this is only read by the direct fallback when the proxy is not deployed.
  airtableToken?: string;
  // ⛔ NO CREDENTIAL FIELDS IN AppSettings. This object is persisted to the
  // `app_settings` table, which is readable by the anon role — i.e. by anyone,
  // because this app has no authentication and its publishable key ships in the
  // browser bundle. `airtableToken` and `anthropicApiKey` lived here and were
  // retrievable from the open internet. They now live in server-side secrets.
  // The DB trigger `app_settings_reject_unsafe` rejects them if re-added.
  columnMappings: Record<string, string>;
  showPausedAccounts: boolean;
  showChurnedAccounts: boolean;
  pausedThresholdDays: number;
  accountAliases: {
    sheetName: string;
    airtableName: string;
    program: string;
    mediaBuyer: string;
    status: string;
  }[];
  perfThresholds: {
    goodCpl: number;
    goodLeadPercent: number;
    poorCpl: number;
    poorLeadPercent: number;
  };
  excludedCampaigns: string[];
  setterBonusRates: { setterName: string; rate: number }[];
  inactiveSetters: string[];
}

export interface AdSpendRow {
  month: string;
  /** The source string exactly as the sheet rendered it. Format is NOT guaranteed. */
  date: string;
  /**
   * `date` normalised to ISO `YYYY-MM-DD`, or '' when it could not be interpreted.
   * ADDITIVE: `date` is unchanged, because six page-level parsers still read it and four
   * of them shift an ISO string by one day. Migrate readers to this field deliberately.
   */
  dateISO: string;
  campaign: string;
  campaignId: string;
  adsetName: string;
  adsetId: string;
  adName: string;
  adId: string;
  spent: number;
  leads: number;
  accountName: string;
}

export interface AppointmentRow {
  campaignName: string;
  campaignId: string;
  adSetName: string;
  adSetId: string;
  adName: string;
  adId: string;
  client: string;
  /**
   * A — the Airtable `Client Name` field is a LINKED RECORD and returned a record id, so
   * WHICH ACCOUNT is unknown. THE APPOINTMENT STILL EXISTS: this flag separates "we cannot
   * attribute it" from "it is not there", and conflating those emptied the appointments
   * page once already.
   */
  clientUnresolved?: boolean;
  appointmentDate: string;
  dateAdded: string;
  showStatus: string;
  leadValid: string;
  leadQuality: string;
  dqReason: string;
  projectValue: number;
  closedRevenue: number;
  leadStatus: string;
  amountCharged: number;
  billed: string;
  clientPPARate: number;
  setter: string;
  clientBillingModel: string;
}

export interface CallRow {
  timestamp: string;
  ghlLocationName: string;
  agentName: string;
  callDuration: number;
  callDisposition: string;
}

export interface AccountSummary {
  accountName: string;
  program: string;
  mediaBuyer: string;
  status: string;
  spend: number;
  leads: number;
  performanceSpend: number;
  performanceLeads: number;
  cpl: number;
  appointments: number;
  leadPercent: number;
  costPerAppt: number;
  qualified: number;
  qualPercent: number;
  closed: number;
  revenue: number;
  billed: number;
  totalDials: number;
  dialToApptPercent: number;
  avgCallDuration: number;
  campaigns: CampaignSummary[];
  /**
   * Account appointments attached to NO campaign. The campaign rows sum to
   * `appointments - unattributedAppointments`, never to `appointments`, whenever this is
   * non-zero — so the panel must name it rather than let the reader assume a subtraction
   * error. See the docblock at its assignment in dataService.ts.
   */
  unattributedAppointments: number;
  appointmentList: AppointmentRow[];
  pausedDays?: number;
  /**
   * WHICH SOURCES ACTUALLY ANSWERED. Not decoration — without these the row cannot tell a
   * dead source from a real zero.
   *
   * Every money and count field above is a `number`, and a failed source contributes `[]`,
   * so `costPerAppt = totalAppts > 0 ? spend/totalAppts : 0` yields a confident `$0.00`
   * whether the appointments source returned nothing or never answered at all. @bird
   * measured the consequence: the KPI tiles read "—" while the per-account table on the
   * SAME SCREEN read COST/APPT $0.00, CLOSED 0, REVENUE $0.00 — and the table is what a
   * buyer actually reads.
   *
   * The tiles were honest only because the per-source state is consulted at the RENDER
   * layer (Dashboard.tsx:751-753), which the rows never reach. Carrying it in the DATA
   * fixes every consumer at once instead of prop-drilling it through five component
   * levels — the nested campaign/adset/ad rows derive from the same appointments, so one
   * flag per source covers all of them.
   *
   * OPTIONAL, and absent means "known": Targets.tsx and TeamPerformance.tsx call the
   * aggregator without source outcomes and must keep behaving exactly as they do today.
   */
  spendKnown?: boolean;
  apptsKnown?: boolean;
  callsKnown?: boolean;
}

export interface CampaignSummary {
  campaignName: string;
  campaignId: string;
  accountName: string;
  spend: number;
  leads: number;
  cpl: number;
  appointments: number;
  leadPercent: number;
  costPerAppt: number;
  qualified: number;
  qualPercent: number;
  closed: number;
  revenue: number;
  performance: 'good' | 'fair' | 'poor';
  adSets: AdSetSummary[];
}

export interface AdSummary {
  adName: string;
  adId: string;
  spend: number;
  leads: number;
  cpl: number;
  appointments: number;
  costPerAppt: number;
  closed: number;
  revenue: number;
}

export interface AdSetSummary {
  adSetName: string;
  adSetId: string;
  spend: number;
  leads: number;
  cpl: number;
  appointments: number;
  leadPercent: number;
  costPerAppt: number;
  closed: number;
  revenue: number;
  performance: 'good' | 'fair' | 'poor';
  adCount: number;
  ads: AdSummary[];
}

export interface TeamMember {
  name: string;
  accountsManaged: number;
  totalSpend: number;
  totalLeads: number;
  totalAppointments: number;
  avgCPL: number;
  avgLeadPercent: number;
  closedDeals: number;
  revenueGenerated: number;
}

export type PerformanceLevel = 'good' | 'fair' | 'poor';

export interface DateRange {
  from: Date | undefined;
  to: Date | undefined;
}

export interface AccountMapping {
  sheetName: string;
  airtableName: string;
  program: 'Done For You' | 'Done With You' | 'Other';
  mediaBuyer: string;
  status: 'Active' | 'Paused' | 'Churned';
}
