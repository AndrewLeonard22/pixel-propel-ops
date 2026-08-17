export interface AppSettings {
  /**
   * ⛔ `googleSheetUrl`, `googleSheetTab` and `adsRawTabName` ARE GONE, 2026-08-11.
   *
   * Ad spend now comes from `ad_insights` via Supabase (src/lib/metaAdSpend.ts), which needs
   * no user-supplied connection details at all — the Edge Function already holds the Meta
   * credentials. There is nothing for a user to type, so there is no setting.
   *
   * ⚠️ RETIRED, NOT MERELY DELETED. The three keys are listed in `DELETED_FEATURE_KEYS` in
   * config.ts so the allowlist drift-lock can tell "deliberately retired" from "silently
   * dropped", and they must stay out of `DEFAULT_SETTINGS` for the same reason. Removing a
   * key from the type while leaving it in the allowlist makes every settings autosave refuse
   * itself — the write guard reads the resulting shape as a blanking. That took production
   * down once; the three edits belong in ONE commit.
   */
  /**
   * Which Lead Status values count as a WON deal. @andrew: "yeah make it mappable".
   *
   * ⚠️ ABSENT (undefined) and EMPTY ([]) BOTH MEAN "use the built-in fallback" — they are NOT
   * "nothing counts". An empty array reaching the classifier as a literal answer would take
   * every closed-deal count to zero, which is the failure mode a settings field must never
   * have. See isClosedWonStatus.
   */
  closedWonStatuses?: string[];
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
  /**
   * ⚠️ A LABEL, NOT THE IDENTITY — since the Supabase cutover. This is Meta's CURRENT
   * display name for `accountId`, and Meta rewrites it: five confirmed renames, including
   * `Publicity 1` -> `Washbroz X SocialWorks`. Grouping on it is what split one client into
   * two accounts on the old sheet feed. Group on `accountId`; render this.
   */
  accountName: string;
  /**
   * ⭐ META'S IMMUTABLE ACCOUNT ID, and the account's real identity.
   *
   * ADDITIVE, exactly as `dateISO` was: the Supabase source always populates it, hand-built
   * fixtures do not, and every reader falls back to the normalised `accountName` when it is
   * absent. That fallback is what let ~600 tests written against the old row shape survive
   * the source swap unchanged.
   */
  accountId?: string;
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


export interface AccountSummary {
  /**
   * ⚠️ THE MATCH KEY, NOT THE LABEL. This is the Meta account name exactly as the ad-spend
   * feed rendered it, and it stays that way because appointment attribution, campaign
   * grouping, the account filter and every React key are built on it. Rendering it is what
   * put " X SocialWorks" on five screens.
   */
  accountName: string;
  /**
   * ⭐ WHAT THE USER SHOULD SEE — the curated client name from `ad_accounts.company_name`,
   * resolved through src/lib/accountRegistry.ts. `null` when this account has no trustworthy
   * company name, which is a state the UI must SAY rather than paper over: a null here is
   * never to be replaced with the account id or with a number.
   */
  companyName?: string | null;
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
  /**
   * 🔴 WHICH SOURCES ACTUALLY ANSWERED — the same fact `AccountSummary` carries, and its
   * absence here is how it got thrown away one line after being computed correctly.
   *
   * `buildAccountSummaries` stamps `spendKnown`/`apptsKnown` on every row. `buildTeamPerformance`
   * then reduced those rows into `totalAppointments`, `closedDeals` and `revenueGenerated`
   * and returned a shape with nowhere to put the flags, so a dead Airtable arrived at
   * Media Buying as a confident zero. Measured during a real Airtable proxy outage, with
   * the spend feed perfectly healthy:
   *
   *     Jez   Spend $217,441.02   Leads 9,908   Appts 0   Avg Lead % 0.0%   Revenue $0.00
   *
   * That is not a dashboard reading wrong. It is a per-person scorecard reading wrong ABOUT
   * SOMEBODY, and every figure in it is a judgement someone gets paid on.
   *
   * ⚠️ REQUIRED, not optional like the `AccountSummary` pair. That pair is optional because
   * `buildAccountSummaries` has many callers that predate the flags; this type has exactly
   * ONE producer and ONE consumer, so `?` would buy nothing and would let the next consumer
   * silently default a refusal back to "known" — the shape this whole file exists to kill.
   *
   * AGGREGATE SEMANTICS: unknown if ANY constituent account is unknown. A sum missing one
   * contributor is not a smaller sum, it is an unknown sum.
   */
  spendKnown: boolean;
  apptsKnown: boolean;
}

export type PerformanceLevel = 'good' | 'fair' | 'poor';

export interface DateRange {
  from: Date | undefined;
  to: Date | undefined;
}

export interface AccountMapping {
  sheetName: string;
  airtableName: string;
  /**
   * ⚠️ `Internal` IS IN HERE NOW, AND ITS ABSENCE WAS A LIE ON SCREEN. The accounts table
   * offers Done For You / Done With You / Internal and its footnote described what Internal
   * does; this union had no `Internal` member, so the literal string could not reach any
   * consumer through any code path and the promise could not be kept by construction.
   * `Other` stays for the legacy rows that already hold it.
   */
  program: 'Done For You' | 'Done With You' | 'Internal' | 'Other';
  mediaBuyer: string;
  status: 'Active' | 'Paused' | 'Churned';
}
