import type { AppSettings, AdSpendRow, AppointmentRow, AccountSummary, CampaignSummary, AdSetSummary, TeamMember, PerformanceLevel } from './types';
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

function resolveAccountName(sheetAccountName: string): string {
  const aliases = JSON.parse(localStorage.getItem('accountAliases') || '[]');
  const match = aliases.find(
    (a: { sheetName: string; airtableName: string }) =>
      a.sheetName.trim().toLowerCase() === sheetAccountName.trim().toLowerCase()
  );
  if (match) {
    console.log(`Alias resolved: "${sheetAccountName}" → "${match.airtableName}"`);
    return match.airtableName;
  }
  return sheetAccountName;
}

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

export function getPerformance(cpl: number, leadPercent: number): PerformanceLevel {
  if (cpl < 25 && leadPercent > 5) return 'good';
  if (cpl > 50 || leadPercent < 2) return 'poor';
  return 'fair';
}

export function buildAccountSummaries(
  adSpend: AdSpendRow[],
  appointments: AppointmentRow[],
  settings?: AppSettings,
): AccountSummary[] {
  const accountMap = new Map<string, { spendRows: AdSpendRow[], appts: AppointmentRow[], originalName: string }>();
  const resolvedNameToSheetAccounts = new Map<string, Set<string>>();
  
  for (const row of adSpend) {
    const name = row.accountName || 'Unknown';
    const normalizedName = name.trim().toLowerCase();
    if (!accountMap.has(normalizedName)) accountMap.set(normalizedName, { spendRows: [], appts: [], originalName: name });
    accountMap.get(normalizedName)!.spendRows.push(row);

    const resolvedName = resolveAccountName(name).trim().toLowerCase();
    if (!resolvedNameToSheetAccounts.has(resolvedName)) {
      resolvedNameToSheetAccounts.set(resolvedName, new Set());
    }
    resolvedNameToSheetAccounts.get(resolvedName)!.add(normalizedName);
  }
  
  // Match appointments: campaign ID → campaign name → alias/normalized client name
  for (const appt of appointments) {
    let matched = false;
    // 1. Try by campaign ID
    for (const [, data] of accountMap) {
      if (data.spendRows.some(r => r.campaignId && appt.campaignId && r.campaignId === appt.campaignId)) {
        data.appts.push(appt);
        matched = true;
        break;
      }
    }
    if (!matched) {
      // 2. Try by campaign name
      for (const [, data] of accountMap) {
        if (data.spendRows.some(r => r.campaign && appt.campaignName && r.campaign === appt.campaignName)) {
          data.appts.push(appt);
          matched = true;
          break;
        }
      }
    }
    if (!matched) {
      // 3. Check aliases first: resolve Sheet Account Name -> Airtable Client Name
      const normalizedClient = appt.client.trim().toLowerCase();
      const aliasedAccounts = resolvedNameToSheetAccounts.get(normalizedClient);
      if (aliasedAccounts) {
        for (const accountKey of aliasedAccounts) {
          const data = accountMap.get(accountKey);
          if (data) {
            data.appts.push(appt);
            matched = true;
            break;
          }
        }
      }
    }
    if (!matched) {
      // 4. Fallback: normalized name match (lowercase + trim)
      const normalizedClient = appt.client.trim().toLowerCase();
      if (accountMap.has(normalizedClient)) {
        accountMap.get(normalizedClient)!.appts.push(appt);
      }
    }
  }
  
  // Final pass: for accounts with no matched appointments, try direct client name match using aliases
  for (const [normalizedName, data] of accountMap) {
    if (data.appts.length === 0) {
      const resolvedName = resolveAccountName(data.originalName).trim().toLowerCase();
      if (resolvedName !== normalizedName) {
        const matched = appointments.filter(
          appt => appt.client.trim().toLowerCase() === resolvedName
        );
        if (matched.length > 0) {
          console.log(`Alias final pass: "${data.originalName}" matched ${matched.length} appointments via "${resolvedName}"`);
          data.appts.push(...matched);
        }
      }
    }
  }

  const summaries: AccountSummary[] = [];
  
  for (const [normalizedKey, data] of accountMap) {
    const accountName = data.originalName;
    const totalSpend = data.spendRows.reduce((s, r) => s + r.spent, 0);
    const totalLeads = data.spendRows.reduce((s, r) => s + r.leads, 0);
    const totalAppts = data.appts.length;
    const closed = data.appts.filter(a => a.leadStatus?.toLowerCase().includes('closed') || a.closedRevenue > 0).length;
    const revenue = data.appts.reduce((s, a) => s + a.closedRevenue, 0);
    const billed = data.appts.reduce((s, a) => s + a.amountCharged, 0);
    const qualified = data.appts.filter(a => a.leadValid?.toLowerCase() === 'yes' || a.leadValid?.toLowerCase() === 'true').length;
    
    // Build campaigns
    const campaignMap = new Map<string, { spendRows: AdSpendRow[], appts: AppointmentRow[] }>();
    for (const r of data.spendRows) {
      const key = r.campaignId || r.campaign;
      if (!campaignMap.has(key)) campaignMap.set(key, { spendRows: [], appts: [] });
      campaignMap.get(key)!.spendRows.push(r);
    }
    for (const a of data.appts) {
      const key = a.campaignId || a.campaignName;
      if (campaignMap.has(key)) {
        campaignMap.get(key)!.appts.push(a);
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
      for (const a of cData.appts) {
        const key = a.adSetId || a.adSetName;
        if (adSetMap.has(key)) adSetMap.get(key)!.appts.push(a);
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
          performance: getPerformance(asCpl, asLeadPct),
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
        performance: getPerformance(cCpl, cLeadPct),
        adSets,
      });
    }
    
    const cpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
    const leadPct = totalLeads > 0 ? (totalAppts / totalLeads) * 100 : 0;
    
    // Media buyer: no longer derived from setter field
    const mediaBuyer = '';
    
    summaries.push({
      accountName,
      program: 'Done For You', // Default, can be enriched
      mediaBuyer,
      status: 'Active',
      spend: totalSpend,
      leads: totalLeads,
      cpl,
      appointments: totalAppts,
      leadPercent: leadPct,
      costPerAppt: totalAppts > 0 ? totalSpend / totalAppts : 0,
      qualified,
      qualPercent: totalAppts > 0 ? (qualified / totalAppts) * 100 : 0,
      closed,
      revenue,
      billed,
      campaigns,
      appointmentList: data.appts,
    });
  }
  
  return summaries.sort((a, b) => b.spend - a.spend);
}

function mode(arr: string[]): string {
  const freq = new Map<string, number>();
  for (const v of arr) freq.set(v, (freq.get(v) || 0) + 1);
  let max = 0, result = '';
  for (const [k, v] of freq) {
    if (v > max) { max = v; result = k; }
  }
  return result;
}

export function buildTeamPerformance(accounts: AccountSummary[]): TeamMember[] {
  const teamMap = new Map<string, TeamMember>();
  
  for (const account of accounts) {
    const buyer = account.mediaBuyer || 'Unassigned';
    if (!teamMap.has(buyer)) {
      teamMap.set(buyer, {
        name: buyer,
        accountsManaged: 0,
        totalSpend: 0,
        totalLeads: 0,
        totalAppointments: 0,
        avgCPL: 0,
        avgLeadPercent: 0,
        closedDeals: 0,
        revenueGenerated: 0,
      });
    }
    const tm = teamMap.get(buyer)!;
    tm.accountsManaged++;
    tm.totalSpend += account.spend;
    tm.totalLeads += account.leads;
    tm.totalAppointments += account.appointments;
    tm.closedDeals += account.closed;
    tm.revenueGenerated += account.revenue;
  }
  
  const result: TeamMember[] = [];
  for (const tm of teamMap.values()) {
    tm.avgCPL = tm.totalLeads > 0 ? tm.totalSpend / tm.totalLeads : 0;
    tm.avgLeadPercent = tm.totalLeads > 0 ? (tm.totalAppointments / tm.totalLeads) * 100 : 0;
    result.push(tm);
  }
  
  return result.sort((a, b) => b.totalAppointments - a.totalAppointments);
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
