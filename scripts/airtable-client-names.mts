/**
 * DOES AIRTABLE ACTUALLY HOLD A CLIENT RECORD FOR THE FIVE RENAMED ACCOUNTS?
 *
 * `reconciliation-baseline.md` §6 states that each of the five renamed accounts "currently has
 * appointments arriving under TWO different Airtable client names", and warns that $84,885.66
 * of attribution would detach if the alias table stayed 1:1. That is a claim about a LIVE
 * THIRD SYSTEM, so it is checked against that system rather than against another document.
 */
import './_shim.mts';
import { loadSettingsWithSource } from '../src/lib/config';
import { fetchAirtableData } from '../src/lib/dataService';

const { settings } = await loadSettingsWithSource();
const { records } = await fetchAirtableData(settings);

const byName = new Map<string, number>();
for (const r of records) {
  const n = String((r as Record<string, unknown>).client ?? '').trim();
  byName.set(n, (byName.get(n) ?? 0) + 1);
}
console.log(`Airtable records: ${records.length}, distinct client names: ${byName.size}\n`);
console.log([...byName.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${String(c).padStart(4)}  ${n}`).join('\n'));

const RENAMED = [
  'Publicity 1', 'Washbroz X SocialWorks', 'Washbroz',
  '10170221, USD', 'Columbia Outdoor Restoration X SocialWorks', 'Columbia Outdoor Restoration',
  '222178771, USD', 'Pro Clean Mobile Wash X SocialWorks', 'Pro Clean Mobile Wash',
  '103578393327348, USD', 'TrueClean X SocialWorks', 'TrueClean',
  'Christmas Light Pros', 'Hydro Pro Wash X SocialWorks', 'Hydro Pro Wash',
];
console.log('\n=== the five renamed accounts, every name they have ever been known by ===');
const names = [...byName.keys()].map(n => n.toLowerCase());
for (const r of RENAMED) {
  const exact = byName.get(r) ?? 0;
  const loose = names.filter(n => n.includes(r.toLowerCase().split(' x ')[0].toLowerCase()));
  console.log(`${exact ? '🔴' : '  '} ${r.padEnd(46)} exact=${exact}  loose matches=${JSON.stringify(loose)}`);
}
