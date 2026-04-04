import type { AppSettings, AdSpendRow, AppointmentRow, AccountSummary, CampaignSummary, AdSetSummary, TeamMember, PerformanceLevel, CallRow } from './types';
import { convertSheetUrlToCsv } from './config';

// Parse CSV text into rows
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  
  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = (values[idx] || '').trim();
    });
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function parseNumber(val: string | undefined): number {
  if (!val) return 0;
  const cleaned = val.replace(/[$,\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

// resolveAccountName removed — matching now uses settings.accountAliases directly

export async function fetchGoogleSheetData(settings: AppSettings): Promise<AdSpendRow[]> {
  const csvUrl = convertSheetUrlToCsv(settings.googleSheetUrl, settings.googleSheetTab);
  if (!csvUrl) throw new Error('Invalid Google Sheet URL');
  
  const response = await fetch(csvUrl);
  if (!response.ok) throw new Error(`Failed to fetch Google Sheet: ${response.status}`);
  
  const text = await response.text();
  const rows = parseCsv(text);
  
  return rows.map(r => ({
    month: r['Month'] || '',
    date: r['Date'] || '',
    campaign: r['Campaign'] || '',
    campaignId: r['Campaign Id'] || r['Campaign ID'] || '',
    adsetName: r['Adset Name'] || r['Ad Set Name'] || '',
    adsetId: r['Adset Id'] || r['Ad Set ID'] || '',
    adName: r['Ad Name'] || '',
    adId: r['Ad Id'] || r['Ad ID'] || '',
    spent: parseNumber(r['Spent'] || r['Spend']),
    leads: parseNumber(r['Leads']),
    accountName: r['Account Name'] || '',
  }));
}

export async function fetchAirtableData(settings: AppSettings): Promise<{ records: AppointmentRow[], fields: string[] }> {
  const { airtableBaseId, airtableTableName, airtableToken, columnMappings } = settings;
  
  if (!airtableBaseId || !airtableToken) throw new Error('Airtable not configured');
  
  const allRecords: AppointmentRow[] = [];
  let offset: string | undefined;
  let fields: string[] = [];
  
  do {
    const url = new URL(`https://api.airtable.com/v0/${airtableBaseId}/${encodeURIComponent(airtableTableName)}`);
    url.searchParams.set('pageSize', '100');
    url.searchParams.set('cellFormat', 'string');
    url.searchParams.set('timeZone', 'America/New_York');
    url.searchParams.set('userLocale', 'en-us');
    if (offset) url.searchParams.set('offset', offset);
    
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${airtableToken}` },
    });
    
    if (!response.ok) throw new Error(`Airtable error: ${response.status}`);
    
    const data = await response.json();
    
    if (data.records && data.records.length > 0 && fields.length === 0) {
      fields = Object.keys(data.records[0].fields);
    }
    
    for (const rec of data.records || []) {
      const f = rec.fields;
      const getField = (key: string) => {
        const mapped = columnMappings[key] || key;
        const val = f[mapped];
        if (Array.isArray(val)) return val[0] || '';
        return val || '';
      };
      
      allRecords.push({
        campaignName: String(getField('Campaign Name')),
        campaignId: String(getField('Campaign ID')),
        adSetName: String(getField('Ad Set Name')),
        adSetId: String(getField('Ad Set ID')),
        adName: String(getField('Ad Name')),
        adId: String(getField('Ad ID')),
        client: String(getField('Client Name')),
        appointmentDate: String(getField('Appointment Date')),
        dateAdded: String(getField('Date Added')),
        showStatus: String(getField('Show Status')),
        leadValid: String(getField('Lead Valid')),
        leadQuality: String(getField('Lead Quality')),
        dqReason: String(getField('DQ Reason')),
        projectValue: parseNumber(String(getField('Project Value'))),
        closedRevenue: parseNumber(String(getField('Closed Revenue'))),
        leadStatus: String(getField('Lead Status')),
        amountCharged: parseNumber(String(getField('Amount Charged'))),
        billed: String(getField('Billed')),
        clientPPARate: parseNumber(String(getField('Client PPA Rate'))),
        setter: String(getField('Setter')),
        clientBillingModel: String(getField('Client Billing Model')),
      });
    }
    
    offset = data.offset;
  } while (offset);
  
  return { records: allRecords, fields };
}

function isBlank(val: string | null | undefined): boolean {
  return val == null || val.trim() === '';
}

export function getPerformance(
  cpl: number, 
  leadPercent: number, 
  thresholds?: AppSettings["perfThresholds"]
): PerformanceLevel {
  const t = thresholds || { goodCpl: 25, goodLeadPercent: 5, poorCpl: 50, poorLeadPercent: 2 };
  if (cpl < t.goodCpl && leadPercent > t.goodLeadPercent) return 'good';
  if (cpl > t.poorCpl || leadPercent < t.poorLeadPercent) return 'poor';
  return 'fair';
}

// Levenshtein distance for fuzzy matching (Tier 4)
function levenshteinDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function levenshteinSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

function normalizeName(s: string): string {
  return s.toLowerCase().trim().replace(/\b(llc|inc|corp)\b/gi, '').replace(/\s+/g, ' ').trim();
}

export function buildAccountSummaries(
  adSpend: AdSpendRow[],
  appointments: AppointmentRow[],
  settings?: AppSettings,
  callData?: CallRow[],
): { accounts: AccountSummary[], unmatchedAppointments: AppointmentRow[] } {
  const accountMap = new Map<string, { spendRows: AdSpendRow[]; appts: AppointmentRow[]; originalName: string }>();

  // 1. Group ad spend by normalized account name
  for (const row of adSpend) {
    const name = row.accountName || 'Unknown';
    const normalizedName = name.trim().toLowerCase();
    if (!accountMap.has(normalizedName)) {
      accountMap.set(normalizedName, { spendRows: [], appts: [], originalName: name });
    }
    accountMap.get(normalizedName)!.spendRows.push(row);
  }

  // 2. Build lookup maps — Campaign ID only (globally unique, zero false-match risk)
  const campaignIdToAccount = new Map<string, string>();
  for (const [normalizedName, data] of accountMap.entries()) {
    for (const row of data.spendRows) {
      if (row.campaignId) campaignIdToAccount.set(row.campaignId, normalizedName);
    }
  }

  // Build manual alias map from user-configured account aliases in Settings
  const manualMappingToAccount = new Map<string, string>();
  for (const mapping of settings?.accountAliases || []) {
    const airtableName = (mapping.airtableName || mapping.sheetName || '').trim();
    if (airtableName) {
      manualMappingToAccount.set(
        airtableName.toLowerCase(),
        mapping.sheetName.trim().toLowerCase()
      );
    }
  }

  // 3. Match appointments — 4-tier matching system
  const unmatchedAfterTier2: AppointmentRow[] = [];
  const clientNameToAccount = new Map<string, string>(); // for Tier 3 inference

  // First pass: Tier 1 & Tier 2
  for (const appt of appointments) {
    let matchedAccountKey: string | undefined;

    // Tier 1 — ID Matching
    if (!isBlank(appt.campaignId)) {
      matchedAccountKey = campaignIdToAccount.get(appt.campaignId);
    }

    // Tier 2 — Manual Alias
    if (!matchedAccountKey && appt.client) {
      matchedAccountKey = manualMappingToAccount.get(appt.client.trim().toLowerCase());
    }

    if (matchedAccountKey && accountMap.has(matchedAccountKey)) {
      accountMap.get(matchedAccountKey)!.appts.push(appt);
      // Record this client name → account mapping for Tier 3
      if (appt.client) {
        clientNameToAccount.set(appt.client.trim().toLowerCase(), matchedAccountKey);
      }
    } else {
      unmatchedAfterTier2.push(appt);
    }
  }

  // Second pass: Tier 3 — Client Name Inference
  const unmatchedAfterTier3: AppointmentRow[] = [];
  for (const appt of unmatchedAfterTier2) {
    let matchedAccountKey: string | undefined;

    if (appt.client) {
      matchedAccountKey = clientNameToAccount.get(appt.client.trim().toLowerCase());
    }

    if (matchedAccountKey && accountMap.has(matchedAccountKey)) {
      accountMap.get(matchedAccountKey)!.appts.push(appt);
    } else {
      unmatchedAfterTier3.push(appt);
    }
  }

  // Third pass: Tier 4 — Fuzzy Name Matching
  const unmatchedAppointments: AppointmentRow[] = [];
  const accountKeys = Array.from(accountMap.keys());
  const normalizedAccountKeys = accountKeys.map(k => ({ key: k, normalized: normalizeName(accountMap.get(k)!.originalName) }));

  for (const appt of unmatchedAfterTier3) {
    let matchedAccountKey: string | undefined;

    if (appt.client) {
      const normalizedClient = normalizeName(appt.client);
      const scores = normalizedAccountKeys.map(ak => ({
        key: ak.key,
        score: levenshteinSimilarity(normalizedClient, ak.normalized),
      })).sort((a, b) => b.score - a.score);

      if (scores.length > 0 && scores[0].score >= 0.85) {
        const secondScore = scores.length > 1 ? scores[1].score : 0;
        // Only match if exactly one account above threshold with sufficient gap
        if (scores[0].score - secondScore >= 0.15) {
          matchedAccountKey = scores[0].key;
        }
      }
    }

    if (matchedAccountKey && accountMap.has(matchedAccountKey)) {
      accountMap.get(matchedAccountKey)!.appts.push(appt);
    } else {
      unmatchedAppointments.push(appt);
    }
  }


  // 4. Build final summaries
  const summaries: AccountSummary[] = [];
  const aliasMap = new Map((settings?.accountAliases || []).map(a => [a.sheetName.trim().toLowerCase(), a]));
  const thresholds = settings?.perfThresholds;

  for (const [normalizedKey, data] of accountMap) {
    const accountName = data.originalName;
    const totalSpend = data.spendRows.reduce((s, r) => s + r.spent, 0);
    const totalLeads = data.spendRows.reduce((s, r) => s + r.leads, 0);
    const totalAppts = data.appts.length;
    const closed = data.appts.filter(a => a.leadStatus?.toLowerCase().includes('closed') || a.closedRevenue > 0).length;
    const revenue = data.appts.reduce((s, a) => s + a.closedRevenue, 0);
    const billed = data.appts.reduce((s, a) => s + a.amountCharged, 0);
    const qualified = data.appts.filter(a => a.leadValid?.toLowerCase() === 'yes' || a.leadValid?.toLowerCase() === 'true').length;

    const cpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
    const leadPct = totalLeads > 0 ? (totalAppts / totalLeads) * 100 : 0;
    const costPerAppt = totalAppts > 0 ? totalSpend / totalAppts : 0;
    const qualPercent = totalAppts > 0 ? (qualified / totalAppts) * 100 : 0;

    const alias = aliasMap.get(normalizedKey);

    // Build campaigns within this account
    const campaignMap = new Map<string, { spendRows: AdSpendRow[], appts: AppointmentRow[] }>();
    for (const r of data.spendRows) {
      const key = r.campaignId || r.campaign;
      if (!campaignMap.has(key)) campaignMap.set(key, { spendRows: [], appts: [] });
      campaignMap.get(key)!.spendRows.push(r);
    }

    // Match appointments to campaigns using lookup maps
    const campIdMap = new Map<string, string>();
    const campNameMap = new Map<string, string>();
    const campAdSetNameMap = new Map<string, string>();
    const campAdNameMap = new Map<string, string>();
    const campAdIdMap = new Map<string, string>();
    for (const [cKey, cData] of campaignMap) {
      for (const r of cData.spendRows) {
        if (r.campaignId) campIdMap.set(r.campaignId, cKey);
        if (r.campaign) campNameMap.set(r.campaign.trim().toLowerCase(), cKey);
        if (r.adsetName) campAdSetNameMap.set(r.adsetName.trim().toLowerCase(), cKey);
        if (r.adName) campAdNameMap.set(r.adName.trim().toLowerCase(), cKey);
        if (r.adId) campAdIdMap.set(r.adId, cKey);
      }
    }

    for (const a of data.appts) {
      let matchedCampaignKey: string | undefined;
      if (!isBlank(a.adId)) matchedCampaignKey = campAdIdMap.get(a.adId);
      if (!matchedCampaignKey && !isBlank(a.adName)) matchedCampaignKey = campAdNameMap.get(a.adName.trim().toLowerCase());
      if (!matchedCampaignKey && !isBlank(a.adSetId)) {
        for (const [cKey, cData] of campaignMap) {
          if (cData.spendRows.some(r => r.adsetId && r.adsetId === a.adSetId)) { matchedCampaignKey = cKey; break; }
        }
      }
      if (!matchedCampaignKey && !isBlank(a.adSetName)) matchedCampaignKey = campAdSetNameMap.get(a.adSetName.trim().toLowerCase());
      if (!matchedCampaignKey && !isBlank(a.campaignId)) matchedCampaignKey = campIdMap.get(a.campaignId);
      if (!matchedCampaignKey && !isBlank(a.campaignName)) matchedCampaignKey = campNameMap.get(a.campaignName.trim().toLowerCase());

      if (matchedCampaignKey && campaignMap.has(matchedCampaignKey)) {
        campaignMap.get(matchedCampaignKey)!.appts.push(a);
      }
    }

    const campaigns: CampaignSummary[] = [];
    for (const [cKey, cData] of campaignMap) {
      const cSpend = cData.spendRows.reduce((s, r) => s + r.spent, 0);
      const cLeads = cData.spendRows.reduce((s, r) => s + r.leads, 0);
      const cAppts = cData.appts.length;
      const cClosed = cData.appts.filter(a => a.leadStatus?.toLowerCase().includes('closed') || a.closedRevenue > 0).length;
      const cRevenue = cData.appts.reduce((s, a) => s + a.closedRevenue, 0);
      const cQualified = cData.appts.filter(a => a.leadValid?.toLowerCase() === 'yes' || a.leadValid?.toLowerCase() === 'true').length;
      const cCpl = cLeads > 0 ? cSpend / cLeads : 0;
      const cLeadPct = cLeads > 0 ? (cAppts / cLeads) * 100 : 0;

      // Build ad sets
      const adSetMap = new Map<string, { spendRows: AdSpendRow[], appts: AppointmentRow[] }>();
      for (const r of cData.spendRows) {
        const key = r.adsetId || r.adsetName;
        if (!adSetMap.has(key)) adSetMap.set(key, { spendRows: [], appts: [] });
        adSetMap.get(key)!.spendRows.push(r);
      }

      // Match campaign appointments to ad sets
      const asAdIdMap = new Map<string, string>();
      const asAdNameMap = new Map<string, string>();
      const asIdMap = new Map<string, string>();
      const asNameMap = new Map<string, string>();
      for (const [asKey, asData] of adSetMap) {
        for (const r of asData.spendRows) {
          if (r.adId) asAdIdMap.set(r.adId, asKey);
          if (r.adName) asAdNameMap.set(r.adName.trim().toLowerCase(), asKey);
          if (r.adsetId) asIdMap.set(r.adsetId, asKey);
          if (r.adsetName) asNameMap.set(r.adsetName.trim().toLowerCase(), asKey);
        }
      }

      for (const a of cData.appts) {
        let matchedAdSetKey: string | undefined;
        if (!isBlank(a.adId)) matchedAdSetKey = asAdIdMap.get(a.adId);
        if (!matchedAdSetKey && !isBlank(a.adName)) matchedAdSetKey = asAdNameMap.get(a.adName.trim().toLowerCase());
        if (!matchedAdSetKey && !isBlank(a.adSetId)) matchedAdSetKey = asIdMap.get(a.adSetId);
        if (!matchedAdSetKey && !isBlank(a.adSetName)) matchedAdSetKey = asNameMap.get(a.adSetName.trim().toLowerCase());

        if (matchedAdSetKey && adSetMap.has(matchedAdSetKey)) {
          adSetMap.get(matchedAdSetKey)!.appts.push(a);
        }
      }

      const adSets: AdSetSummary[] = [];
      for (const [asKey, asData] of adSetMap) {
        const asSpend = asData.spendRows.reduce((s, r) => s + r.spent, 0);
        const asLeads = asData.spendRows.reduce((s, r) => s + r.leads, 0);
        const asAppts = asData.appts.length;
        const asClosed = asData.appts.filter(a => a.leadStatus?.toLowerCase().includes('closed') || a.closedRevenue > 0).length;
        const asRevenue = asData.appts.reduce((s, a) => s + a.closedRevenue, 0);
        const asCpl = asLeads > 0 ? asSpend / asLeads : 0;
        const asLeadPct = asLeads > 0 ? (asAppts / asLeads) * 100 : 0;
        const adNames = new Set(asData.spendRows.map(r => r.adName || r.adId));

        adSets.push({
          adSetName: asData.spendRows[0]?.adsetName || asKey,
          adSetId: asData.spendRows[0]?.adsetId || asKey,
          spend: asSpend,
          leads: asLeads,
          cpl: asCpl,
          appointments: asAppts,
          leadPercent: asLeadPct,
          costPerAppt: asAppts > 0 ? asSpend / asAppts : 0,
          closed: asClosed,
          revenue: asRevenue,
          performance: getPerformance(asCpl, asLeadPct, thresholds),
          adCount: adNames.size,
        });
      }

      campaigns.push({
        campaignName: cData.spendRows[0]?.campaign || cKey,
        campaignId: cData.spendRows[0]?.campaignId || cKey,
        accountName,
        spend: cSpend,
        leads: cLeads,
        cpl: cCpl,
        appointments: cAppts,
        leadPercent: cLeadPct,
        costPerAppt: cAppts > 0 ? cSpend / cAppts : 0,
        qualified: cQualified,
        qualPercent: cAppts > 0 ? (cQualified / cAppts) * 100 : 0,
        closed: cClosed,
        revenue: cRevenue,
        performance: getPerformance(cCpl, cLeadPct, thresholds),
        adSets,
      });
    }

    summaries.push({
      accountName,
      program: alias?.program || 'Unknown',
      mediaBuyer: alias?.mediaBuyer || 'Unassigned',
      status: alias?.status || 'Active',
      spend: totalSpend,
      leads: totalLeads,
      cpl,
      appointments: totalAppts,
      leadPercent: leadPct,
      costPerAppt,
      qualified,
      qualPercent,
      closed,
      revenue,
      billed,
      campaigns,
      appointmentList: data.appts,
    });
  }

  return { accounts: summaries.sort((a, b) => b.spend - a.spend), unmatchedAppointments };
}

export function buildTeamPerformance(accounts: AccountSummary[]): TeamMember[] {
  const teamMap = new Map<string, { name: string; accounts: AccountSummary[] }>();

  for (const account of accounts) {
    const buyer = account.mediaBuyer || 'Unassigned';
    if (!teamMap.has(buyer)) {
      teamMap.set(buyer, { name: buyer, accounts: [] });
    }
    teamMap.get(buyer)!.accounts.push(account);
  }

  return Array.from(teamMap.values()).map(tm => {
    const totalSpend = tm.accounts.reduce((s, a) => s + a.spend, 0);
    const totalLeads = tm.accounts.reduce((s, a) => s + a.leads, 0);
    const totalAppointments = tm.accounts.reduce((s, a) => s + a.appointments, 0);
    const closedDeals = tm.accounts.reduce((s, a) => s + a.closed, 0);
    const revenueGenerated = tm.accounts.reduce((s, a) => s + a.revenue, 0);

    return {
      name: tm.name,
      accountsManaged: tm.accounts.length,
      totalSpend,
      totalLeads,
      totalAppointments,
      closedDeals,
      revenueGenerated,
      avgCPL: totalLeads > 0 ? totalSpend / totalLeads : 0,
      avgLeadPercent: totalLeads > 0 ? (totalAppointments / totalLeads) * 100 : 0,
    };
  }).sort((a, b) => b.totalAppointments - a.totalAppointments);
}

export function formatCurrency(val: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
}

export function formatNumber(val: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(val));
}

export function formatPercent(val: number): string {
  return `${val.toFixed(1)}%`;
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
