/**
 * PROOF: does narrowing the ad-spend WINDOW starve APPOINTMENT ATTRIBUTION?
 *
 * `buildAccountSummaries` builds `accountMap` and `campaignIdToAccount` from the adSpend
 * rows it is handed (dataService.ts:1034-1052), and drops any appointment whose account is
 * absent from that map (:1167). Appointments are all-time. So if the spend fetch is narrowed
 * to one day, every appointment belonging to an account that did not spend TODAY should fall
 * out as unmatched.
 *
 * Runs the app's own path through the same anon key the browser compiles.
 */
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0,
};

const { fetchMetaAdSpend, ALL_DATES } = await import('../src/lib/metaAdSpend');
const { fetchAccountRegistry } = await import('../src/lib/accountRegistry');
const { buildAccountSummaries, fetchAirtableData } = await import('../src/lib/dataService');
const { loadSettingsWithSource } = await import('../src/lib/config');

const TODAY = '2026-08-17';

const { settings } = await loadSettingsWithSource();
const registry = await fetchAccountRegistry();
const appointments = (await fetchAirtableData(settings)).records;

const run = async (label: string, window: { from?: string; to?: string }) => {
  const rows = await fetchMetaAdSpend(settings, window);
  const r = buildAccountSummaries(rows, appointments, settings, undefined, registry);
  const clients = new Set(
    r.unmatchedAppointments.map(a => (a.client || '(none)').trim()).filter(Boolean),
  );
  console.log(
    `${label.padEnd(28)} spendRows=${String(rows.length).padStart(6)}  ` +
    `accounts=${String(r.accounts.length).padStart(3)}  ` +
    `UNMATCHED=${String(r.unmatchedAppointments.length).padStart(4)}  ` +
    `uniqueClients=${clients.size}`,
  );
  return r;
};

console.log(`appointments loaded: ${appointments.length}\n`);
await run('ALL_DATES (before my fix)', ALL_DATES);
await run(`window ${TODAY} (after)`, { from: TODAY, to: TODAY });
