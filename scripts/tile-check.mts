import './_shim.mts';
import { buildAccountSummaries, fetchAirtableData } from '../src/lib/dataService';
import { fetchMetaAdSpend, ALL_DATES } from '../src/lib/metaAdSpend';
import { fetchAccountRegistry } from '../src/lib/accountRegistry';
import { loadSettingsWithSource } from '../src/lib/config';
import type { AdSpendRow } from '../src/lib/types';
const SHEET='https://docs.google.com/spreadsheets/d/1g6hqd1-8A_XNUVfcd13g36jVDdHnqR4o6gX2-eCuSBE/export?format=csv&gid=0';
function parseCsv(t:string){const rows:string[][]=[];let row:string[]=[],cell='',q=false;for(let i=0;i<t.length;i++){const c=t[i];if(q){if(c==='"'){if(t[i+1]==='"'){cell+='"';i++}else q=false}else cell+=c}else if(c==='"')q=true;else if(c===','){row.push(cell);cell=''}else if(c==='\n'){row.push(cell);rows.push(row);row=[];cell=''}else if(c!=='\r')cell+=c}if(cell||row.length){row.push(cell);rows.push(row)}const h=rows.shift()!.map(x=>x.trim());return rows.filter(r=>r.some(v=>v.trim()!=='')).map(r=>Object.fromEntries(h.map((x,i)=>[x,(r[i]??'').trim()])))}
const num=(v?:string)=>{const n=Number(String(v??'').replace(/[^0-9.\-]/g,''));return Number.isFinite(n)?n:0};
const iso=(v?:string)=>{const s=String(v??'').trim();let m=/^(\d{4})-(\d{2})-(\d{2})/.exec(s);if(m)return s.slice(0,10);m=/^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);return m?`${m[3]}-${String(+m[1]).padStart(2,'0')}-${String(+m[2]).padStart(2,'0')}`:''};
async function sheetFeed():Promise<AdSpendRow[]>{const r=await fetch(SHEET);return parseCsv(await r.text()).map(x=>({month:x['Month']??'',date:x['Date']??'',dateISO:iso(x['Date']),campaign:x['Campaign']??'',campaignId:x['Campaign Id']??'',adsetName:x['Adset Name']??'',adsetId:x['Adset Id']??'',adName:x['Ad Name']??'',adId:x['Ad Id']??'',spent:num(x['Spent']),leads:num(x['Leads']),accountName:x['Account Name']??''})) as AdSpendRow[]}
const M=(n:number)=>'$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
(async()=>{
const {settings}=await loadSettingsWithSource();
const [sheet,meta,air,reg]=await Promise.all([sheetFeed(),fetchMetaAdSpend(settings,ALL_DATES),fetchAirtableData(settings),fetchAccountRegistry()]);
const appts=air.records;
for(const [label,feed] of [['SHEET',sheet],['SUPABASE',meta]] as const){
  const r=buildAccountSummaries(feed,appts,settings,undefined,reg);
  const active=r.accounts.filter(a=>a.status!=='Churned');
  const all=r.accounts;
  console.log(`${label.padEnd(9)} accounts=${all.length} active=${active.length}`);
  console.log(`   TOTAL SPEND tile (active only) ${M(active.reduce((s,a)=>s+a.spend,0))}   | all accounts ${M(all.reduce((s,a)=>s+a.spend,0))}`);
  console.log(`   TOTAL APPTS tile = activeAppts ${active.reduce((s,a)=>s+a.appointments,0)} + unmatched ${r.unmatchedAppointments.length} = ${active.reduce((s,a)=>s+a.appointments,0)+r.unmatchedAppointments.length}`);
  console.log(`   statuses: ${[...new Set(all.map(a=>a.status))].join(', ')}`);
  const churned=all.filter(a=>a.status==='Churned');
  if(churned.length) console.log(`   EXCLUDED (Churned): ${churned.map(a=>`${a.companyName||a.accountName} ${M(a.spend)} appts=${a.appointments}`).join(' | ')}`);
}
})().catch(e=>{console.error(e);process.exit(1)});
