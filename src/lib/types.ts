export interface AppSettings {
  googleSheetUrl: string;
  googleSheetTab: string;
  callCenterSheetUrl: string;
  callCenterSheetTab: string;
  airtableBaseId: string;
  airtableTableName: string;
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
  date: string;
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
  appointmentList: AppointmentRow[];
  pausedDays?: number;
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
