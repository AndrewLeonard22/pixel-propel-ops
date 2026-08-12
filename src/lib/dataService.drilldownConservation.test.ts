import { describe, it, expect } from 'vitest';
import { buildAccountSummaries } from './dataService';
import { makeAdSpendRow, makeAppointmentRow, makeSettings } from '@/test/factories';

/**
 * 🔴 THE DRILL-DOWN CONSERVATION SWEEP — @andrew: *"make sure it actually works and is right"*.
 *
 * @fable found one instance from a screenshot: Archadeck X SocialWorks, spend and leads
 * reconcile between campaigns and account, **appointments do not**. One appointment is
 * attached to the ACCOUNT and to no CAMPAIGN.
 *
 * ⚠️ THE MAGNITUDE MOVED AND THE DEFECT DID NOT. His screenshot read 6 vs 7; @bird drove it
 * live afterwards and read **9 vs 10** — tonight's resolver deploy changed the grouping.
 * **Anyone reasoning from 6/7 is on a superseded number.** The fixtures below are SYNTHETIC
 * and their 6/7 is a constructed shape, not a claim about live Archadeck — they assert the
 * INVARIANT (parts + unattributed == whole), which is what survives a magnitude change.
 *
 * 📏 SIZED FROM THE SOURCE by @bird: **36 of 679 appointments carry no Campaign ID (5.3%),
 * across 13 of 22 accounts** — largest New Jersey l Backyard Paradiso at 11. So this is not
 * one unlucky account.
 * 🔻 AND MY OWN «SUBSET OF 36» WAS WRONG — corrected here, measured not reasoned.
 * @bird first published 36 (rows missing Campaign ID), then retracted to **27** (rows missing
 * ALL SIX fields) once he had the fallback chain. I told him the on-screen number would be a
 * SUBSET of 36. It is not: it is a **SUPERSET of 27**, because a THIRD category exists that
 * neither count includes —
 *
 *     DANGLING REFERENCES: a row carrying `adSetId: 'NOPE'` that matches no spend row.
 *     Its fields are PRESENT, so it is in neither the 36 nor the 27 — and it matches no
 *     campaign, so `unattributedAppointments` counts it. Locked by an arm below.
 *
 * ⇒ **EXPECT the on-screen total to be ≥ 27, and nobody has measured the dangling count.**
 * A number above 27 is CORRECT, not a bug — flagged because the obvious reading of a
 * mismatch is "the counter is broken".
 *
 * ⭐ THE CLASS IS ⑥ ONE LEVEL DEEPER. ⑥ was "TOTAL APPTS reduces over accounts, so an
 * appointment with no account is structurally invisible". Fixing the parent said nothing
 * about the child — and this file's finding is that **the same shape occurs at THREE levels**,
 * not one. Measured in `buildAccountSummaries`, all three identical:
 *
 *     campaign  if (matchedCampaignKey && campaignMap.has(…)) push   ← no else, no counter
 *     ad set    if (matchedAdSetKey    && adSetMap.has(…))    push   ← no else, no counter
 *     ad        if (matchedAdKey       && adMap.has(…))       push   ← no else, no counter
 *
 * ⇒ An appointment that fails to match is DROPPED SILENTLY at every level. There was no
 * `unattributed` counter anywhere in the hierarchy — grep returned 0.
 *
 * ⛔ THE FIX IS NOT TO FORCE THE PARTS TO EQUAL THE WHOLE. @fable: *"the 7 is right; the 6 is
 * incomplete."* Reassigning an unattributed appointment to an arbitrary campaign would make
 * the arithmetic tidy and the attribution false. The number stays; the GAP gets named.
 */

const SETTINGS = makeSettings();

/**
 * Archadeck-shaped: two campaigns, and one appointment that belongs to neither.
 *
 * 🔻 MY FIRST VERSION OF THIS FIXTURE COULD NOT EXPRESS THE DEFECT, and the reason is worth
 * more than the fixture. I cleared `campaignId` alone — but `makeAppointmentRow` defaults
 * `adSetId: '222'`, `adSetName`, `adId`, `adName` and `campaignName` to NON-EMPTY values, and
 * the campaign matcher has a six-step fallback chain: campaign id → ad-set id → ad-set name →
 * ad id → ad name → campaign name. The "orphan" still matched on its leftover ad-set id, the
 * parts summed to 7, and my census reported NO GAP on a product that has one.
 *
 * ⭐ SO AN UNATTRIBUTED APPOINTMENT REQUIRES CLEARING ALL SIX FIELDS, and that is part of why
 * no existing test caught this: the factory makes the defective state almost impossible to
 * construct by accident. A fixture whose defaults are all populated cannot model absence.
 */
function archadeckLike() {
  const spend = [
    makeAdSpendRow({ accountName: 'Archadeck', campaignId: 'C1', campaign: 'Camp One', adsetId: 'AS1', adsetName: 'Set1', adId: 'AD1', adName: 'Ad1', spent: 4513.31, leads: 61 }),
    makeAdSpendRow({ accountName: 'Archadeck', campaignId: 'C2', campaign: 'Camp Two', adsetId: 'AS2', adsetName: 'Set2', adId: 'AD2', adName: 'Ad2', spent: 2018.03, leads: 31 }),
  ];
  const onCampaign = (id: string, n: number) =>
    Array.from({ length: n }, () =>
      makeAppointmentRow({
        client: 'Archadeck', campaignId: id,
        adSetId: id === 'C1' ? 'AS1' : 'AS2', adSetName: id === 'C1' ? 'Set1' : 'Set2',
        adId: id === 'C1' ? 'AD1' : 'AD2', adName: id === 'C1' ? 'Ad1' : 'Ad2',
        campaignName: id === 'C1' ? 'Camp One' : 'Camp Two',
      }),
    );
  const appts = [
    ...onCampaign('C1', 1),
    ...onCampaign('C2', 5),
    // 🔴 THE SEVENTH: matched to the ACCOUNT by client name, with EVERY piece of campaign
    // evidence absent. This is the row the per-campaign reduce cannot see.
    makeAppointmentRow({
      client: 'Archadeck',
      campaignId: '', campaignName: '', adSetId: '', adSetName: '', adId: '', adName: '',
    }),
  ];
  return buildAccountSummaries(spend, appts, SETTINGS);
}

describe('🔴 THE GAP IS REAL AND IT IS STRUCTURAL, not one account being unlucky', () => {
  it('reproduces @fable\'s screenshot: spend ✅ leads ✅ appointments ❌', () => {
    const { accounts } = archadeckLike();
    const acct = accounts.find(a => a.accountName === 'Archadeck')!;
    const camps = acct.campaigns ?? [];

    // Spend and leads reconcile exactly — which is why the appointment gap is easy to miss.
    expect(camps.reduce((s, c) => s + c.spend, 0)).toBeCloseTo(acct.spend, 2);
    expect(camps.reduce((s, c) => s + c.leads, 0)).toBe(acct.leads);

    // 🔴 APPOINTMENTS DO NOT. The account holds 7, the campaigns account for 6.
    const partsAppts = camps.reduce((s, c) => s + c.appointments, 0);
    expect(acct.appointments).toBe(7);
    expect(partsAppts).toBe(6);
    expect(acct.appointments - partsAppts).toBe(1);
  });

  it('🔑 THE SAME SHAPE AT AD-SET LEVEL — a campaign\'s appts exceed its ad sets\'', () => {
    const spend = [
      makeAdSpendRow({ accountName: 'Acme', campaignId: 'C1', adsetId: 'AS1', adsetName: 'Set One', adId: 'AD1', adName: 'Ad1', spent: 100, leads: 10 }),
    ];
    const appts = [
      makeAppointmentRow({ client: 'Acme', campaignId: 'C1', adSetId: 'AS1', adSetName: 'Set One', adId: 'AD1', adName: 'Ad1' }),
      // matches the CAMPAIGN by id, but carries NO ad-set or ad evidence at all
      makeAppointmentRow({ client: 'Acme', campaignId: 'C1', adSetId: '', adSetName: '', adId: '', adName: '' }),
    ];
    const { accounts } = buildAccountSummaries(spend, appts, SETTINGS);
    const camp = (accounts[0].campaigns ?? [])[0];
    const adSetAppts = (camp.adSets ?? []).reduce((s, a) => s + a.appointments, 0);

    expect(camp.appointments).toBe(2);
    expect(adSetAppts).toBe(1);          // 🔴 one appointment invisible one level down
  });

  it('⭐ CONSERVATION HOLDS when every appointment carries full attribution', () => {
    // The control. Without it, "parts < whole" could be a property of the fixture rather
    // than of unattributed rows — and every arm above would pass on a broken aggregator.
    const spend = [
      makeAdSpendRow({ accountName: 'Acme', campaignId: 'C1', adsetId: 'AS1', spent: 100, leads: 10 }),
      makeAdSpendRow({ accountName: 'Acme', campaignId: 'C2', adsetId: 'AS2', spent: 200, leads: 20 }),
    ];
    const appts = [
      // ⚠️ NOTE THE SPELLING: AdSpendRow uses `adsetId`, AppointmentRow uses `adSetId`.
      // My first version wrote `adsetId` here — not a field on AppointmentRow, so the row
      // silently kept the factory default and this CONTROL was not testing what it claimed.
      // tsc caught it; the arm had still passed.
      makeAppointmentRow({ client: 'Acme', campaignId: 'C1', adSetId: 'AS1' }),
      makeAppointmentRow({ client: 'Acme', campaignId: 'C2', adSetId: 'AS2' }),
    ];
    const { accounts } = buildAccountSummaries(spend, appts, SETTINGS);
    const acct = accounts[0];
    const parts = (acct.campaigns ?? []).reduce((s, c) => s + c.appointments, 0);

    expect(acct.appointments).toBe(2);
    expect(parts).toBe(2);               // ✅ no gap when attribution is complete
  });
});

describe('⚠️ THE ZERO CASE — where a divide-by-zero or a false em dash hides', () => {
  it('an account with ZERO appointments produces 0, never NaN and never a false —', () => {
    // @fable named this explicitly. A rate over zero appointments is the classic NaN source,
    // and NaN formats as "—", which reads on screen as "this source is dead" rather than
    // "there were none". Those are different facts and the panel must not conflate them.
    const { accounts } = buildAccountSummaries(
      [makeAdSpendRow({ accountName: 'Quiet', campaignId: 'C1', spent: 500, leads: 20 })],
      [],
      SETTINGS,
    );
    const acct = accounts[0];

    expect(acct.appointments).toBe(0);
    for (const [label, v] of Object.entries({
      costPerAppt: acct.costPerAppt,
      leadPercent: acct.leadPercent,
      closed: acct.closed,
      revenue: acct.revenue,
    })) {
      expect(Number.isNaN(v), `${label} is NaN`).toBe(false);
      expect(Number.isFinite(v), `${label} is not finite`).toBe(true);
    }
  });

  it('a campaign with spend but no appointments does not poison its rates', () => {
    const { accounts } = buildAccountSummaries(
      [makeAdSpendRow({ accountName: 'Quiet', campaignId: 'C1', spent: 500, leads: 0 })],
      [],
      SETTINGS,
    );
    for (const c of accounts[0].campaigns ?? []) {
      expect(Number.isFinite(c.cpl)).toBe(true);
      expect(Number.isFinite(c.costPerAppt)).toBe(true);
      expect(Number.isFinite(c.leadPercent)).toBe(true);
    }
  });
});

describe('revenue and closed reconcile after D1', () => {
  it('campaign closed/revenue sum to the account, when attribution is complete', () => {
    const spend = [
      makeAdSpendRow({ accountName: 'Acme', campaignId: 'C1', spent: 100, leads: 10 }),
      makeAdSpendRow({ accountName: 'Acme', campaignId: 'C2', spent: 200, leads: 20 }),
    ];
    const appts = [
      makeAppointmentRow({ client: 'Acme', campaignId: 'C1', leadStatus: 'Closed Won', closedRevenue: 1000 }),
      makeAppointmentRow({ client: 'Acme', campaignId: 'C2', leadStatus: 'Closed Lost', closedRevenue: 0 }),
      makeAppointmentRow({ client: 'Acme', campaignId: 'C2', leadStatus: 'Closed Won', closedRevenue: 500 }),
    ];
    const { accounts } = buildAccountSummaries(spend, appts, SETTINGS);
    const acct = accounts[0];
    const camps = acct.campaigns ?? [];

    // D1: only the two WON rows count, at every level of the hierarchy.
    expect(acct.closed).toBe(2);
    expect(camps.reduce((s, c) => s + c.closed, 0)).toBe(2);
    expect(acct.revenue).toBe(1500);
    expect(camps.reduce((s, c) => s + c.revenue, 0)).toBe(1500);
  });
});

describe('✅ THE GAP IS NOW NAMED — the count the panel renders', () => {
  it('unattributedAppointments equals the shortfall exactly', () => {
    const { accounts } = archadeckLike();
    const acct = accounts.find(a => a.accountName === 'Archadeck')!;
    const parts = (acct.campaigns ?? []).reduce((s, c) => s + c.appointments, 0);

    expect(acct.unattributedAppointments).toBe(1);
    // The identity the on-screen sentence asserts: rows + unattributed = header.
    expect(parts + acct.unattributedAppointments).toBe(acct.appointments);
  });

  it('🔴 ANTI-VACUITY: it is ZERO when attribution is complete — not always-on', () => {
    // Without this, a field hardcoded to 1 (or to `appointments`) would pass the arm above.
    const spend = [makeAdSpendRow({ accountName: 'Acme', campaignId: 'C1', adsetId: 'AS1', spent: 100, leads: 10 })];
    const appts = [makeAppointmentRow({ client: 'Acme', campaignId: 'C1', adSetId: 'AS1' })];
    const { accounts } = buildAccountSummaries(spend, appts, SETTINGS);

    expect(accounts[0].appointments).toBe(1);
    expect(accounts[0].unattributedAppointments).toBe(0);
  });

  it('never negative — a campaign cannot out-count its account', () => {
    const { accounts } = buildAccountSummaries(
      [makeAdSpendRow({ accountName: 'Quiet', campaignId: 'C1', spent: 500, leads: 20 })], [], SETTINGS,
    );
    expect(accounts[0].unattributedAppointments).toBe(0);
    expect(accounts[0].unattributedAppointments).toBeGreaterThanOrEqual(0);
  });
});

describe('🔑 THE THIRD CATEGORY — a DANGLING reference is unattributed too', () => {
  it('a row whose ids are PRESENT but match nothing still counts as unattributed', () => {
    /**
     * Neither @bird's 36 (missing Campaign ID) nor his corrected 27 (missing all six) counts
     * this row: every field is populated. But every field points at nothing, so the six-step
     * chain fails and the campaign reduce cannot see it — which is the property that matters.
     * ⇒ This is why the on-screen total is a SUPERSET of 27 rather than a subset of 36.
     */
    const spend = [makeAdSpendRow({ accountName: 'Acme', campaignId: 'C1', adsetId: 'AS1', adsetName: 'S1', adId: 'AD1', adName: 'A1', spent: 100, leads: 10 })];
    const appts = [
      makeAppointmentRow({ client: 'Acme', campaignId: 'C1', adSetId: 'AS1', adSetName: 'S1', adId: 'AD1', adName: 'A1' }),
      // all six empty — @bird's "true orphan"
      makeAppointmentRow({ client: 'Acme', campaignId: '', adSetId: '', adSetName: '', adId: '', adName: '', campaignName: '' }),
      // all six PRESENT but dangling — in neither of his counts
      makeAppointmentRow({ client: 'Acme', campaignId: 'GHOST', adSetId: 'NOPE', adSetName: 'nope', adId: 'X', adName: 'x', campaignName: 'ghost' }),
    ];
    const { accounts } = buildAccountSummaries(spend, appts, SETTINGS);
    const acct = accounts[0];

    expect(acct.appointments).toBe(3);
    expect((acct.campaigns ?? []).reduce((s, c) => s + c.appointments, 0)).toBe(1);
    expect(acct.unattributedAppointments).toBe(2);   // the orphan AND the dangling row
  });
});

describe('🔴 THE ⑥ POPULATION AND THIS ONE ARE NOT THE SAME ROWS — equal sums are not identity', () => {
  it('a row can be ACCOUNT-ATTACHED and CAMPAIGN-UNATTRIBUTED at the same time', () => {
    /**
     * @bird measured a striking coincidence on live data: his four states partition 679 as
     * 636 resolve + 27 all-six-empty + 7 dangling + 9 name-only, and 27+7+9 = 43 — the same
     * 43 that ⑥ discloses as "not matched to an account". He inferred the two disclosures are
     * two views of ONE defect.
     *
     * 🔴 THEY ARE NOT, AS A MATTER OF MECHANISM. Account attachment has a route that campaign
     * attachment does not: the CLIENT NAME. An appointment whose client matches an account
     * exactly, carrying no campaign evidence at all, is ATTACHED to the account (so it is not
     * one of the 43) and INVISIBLE to every campaign reduce (so it is in this count).
     *
     * ⭐ EQUAL CARDINALITY IS NOT SET IDENTITY. The sums may coincide on today's data — that
     * is a fact about the data, not about the code — and the risk of merging them is
     * concrete: fix one and believe you fixed both.
     */
    const spend = [makeAdSpendRow({ accountName: 'Archadeck', campaignId: 'C1', adsetId: 'AS1', adsetName: 'S1', adId: 'AD1', adName: 'A1', spent: 100, leads: 10 })];
    const appts = [
      makeAppointmentRow({ client: 'Archadeck', campaignId: 'C1', adSetId: 'AS1', adSetName: 'S1', adId: 'AD1', adName: 'A1' }),
      makeAppointmentRow({ client: 'Archadeck', campaignId: '', adSetId: '', adSetName: '', adId: '', adName: '', campaignName: '' }),
    ];
    const { accounts, unmatchedAppointments } = buildAccountSummaries(spend, appts, SETTINGS);

    expect(accounts[0].appointments).toBe(2);            // BOTH attached to the account
    expect(unmatchedAppointments).toHaveLength(0);       // ⇒ neither is one of ⑥'s 43
    expect(accounts[0].unattributedAppointments).toBe(1); // yet one IS campaign-unattributed
  });
});
