export interface AppSettings {
  googleSheetUrl: string;
  googleSheetTab: string;
  airtableBaseId: string;
  airtableTableName: string;
  airtableToken: string;
  columnMappings: Record<string, string>;
  showPausedAccounts: boolean;
  showChurnedAccounts: boolean;
  pausedThresholdDays: number;
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

export interface AccountSummary {
  accountName: string;
  program: string;
  mediaBuyer: string;
  status: string;
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
  billed: number;
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
