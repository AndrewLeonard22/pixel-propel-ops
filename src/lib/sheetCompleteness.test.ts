import { describe, it, expect, vi } from 'vitest';
import {
  parseGvizCount, judgeCompleteness, completenessMessage, buildCountUrl,
  spreadsheetIdOf, derivedGidOf, checkSheetCompleteness,
} from './sheetCompleteness';

/**
 * ① THE SHEET CLIFF DETECTOR — both arms, because a detector with only the firing arm
 * proven is half a detector, and this one guards the number @andrew makes spend decisions on.
 *
 * @fable's cliff: the derived tab's array formula is bounded at 'Ads - Raw'!A2:A39389.
 * 38,944 rows today, 444 headroom, ~58 rows/day. It freezes ~2026-08-13 with nobody acting,
 * and the dashboard keeps rendering a confident, permanently stale number.
 *
 * ══ 🔴 THE HAZARD THE COST CHECK TURNED UP, WHICH IS BIGGER THAN THE COST QUESTION ══
 * Measured against a live Google Sheet before any of this was written:
 *   gviz `select count(A)`     228 BYTES — a number, not a 10MB tab ✅
 *   sheet=NONEXISTENT_TAB_XYZ  HTTP 200, the DEFAULT tab, BYTE-IDENTICAL, same sig 🔴
 *   gid=99999999               HTTP 200, the DEFAULT tab, BYTE-IDENTICAL, same sig 🔴
 *
 * ⇒ ⛔ A MISADDRESSED TAB RETURNS THE OTHER TAB'S ANSWER. A naive two-count comparison
 *   therefore reports EQUAL — "complete" — EXACTLY WHEN IT IS BLIND. Fail-open, on the
 *   completeness of the spend data.
 *
 * ⭐ THE ASYMMETRY THAT MAKES IT SHIPPABLE IN TWO REQUESTS: a fallback can only ever produce
 * EQUALITY, so the TRUNCATED arm needs no fallback protection at all, while the COMPLETE arm
 * needs positive proof the tabs are distinct. Those arms are tested separately below because
 * they rest on different guarantees.
 */
const gviz = (count: number, sig: string, status = 'ok') =>
  `/*O_o*/\ngoogle.visualization.Query.setResponse({"version":"0.6","reqId":"0","status":"${status}",` +
  `"sig":"${sig}","table":{"cols":[{"id":"count-A","label":"count ","type":"number"}],` +
  `"rows":[{"c":[{"v":${count}.0}]}],"parsedNumHeaders":0}});`;

describe('parseGvizCount — the wire format, measured from a live response', () => {
  it('extracts the count and the signature', () => {
    expect(parseGvizCount(gviz(38944, '118378466'))).toEqual({ count: 38944, sig: '118378466' });
  });

  it('returns null for a non-ok status rather than inventing a zero', () => {
    expect(parseGvizCount(gviz(0, 'x', 'error'))).toBeNull();
  });

  it('returns null for HTML or garbage — an auth wall is not a row count', () => {
    expect(parseGvizCount('<html>Sign in</html>')).toBeNull();
    expect(parseGvizCount('')).toBeNull();
  });
});

describe('URL construction', () => {
  it('asks for a COUNT, not a payload — by gid or by name', () => {
    const byGid = buildCountUrl('SHEETID', { gid: '123' });
    expect(byGid).toContain('/gviz/tq');
    expect(byGid).toContain('gid=123');
    expect(byGid).toContain(encodeURIComponent('select count(A)'));

    const byName = buildCountUrl('SHEETID', { sheet: 'Ads - Raw' });
    expect(byName).toContain(`sheet=${encodeURIComponent('Ads - Raw')}`);
  });

  it('🔑 THE QUERY IS IDENTICAL FOR BOTH TABS — or the sig proof becomes a rubber stamp', () => {
    // `sig` is a function of (tab content, QUERY). If the two probes used different queries
    // their sigs would differ for a reason unrelated to which tab answered, and the
    // distinct-tabs proof would pass unconditionally.
    const q = (u: string) => u.split('&tq=')[1];
    expect(q(buildCountUrl('S', { gid: '1' }))).toBe(q(buildCountUrl('S', { sheet: 'X' })));
  });

  it('reads the ids out of a real sheet URL, and the derived gid defaults to 0', () => {
    const url = 'https://docs.google.com/spreadsheets/d/ABC_123-x/edit#gid=456';
    expect(spreadsheetIdOf(url)).toBe('ABC_123-x');
    expect(derivedGidOf(url)).toBe('456');
    expect(derivedGidOf('https://docs.google.com/spreadsheets/d/ABC/edit')).toBe('0');
    expect(spreadsheetIdOf('https://example.com/nope')).toBe('');
  });
});

describe('judgeCompleteness — the FIRING arm', () => {
  it('🔴 raw > derived is TRUNCATED and names the gap', () => {
    const r = judgeCompleteness({ count: 39500, sig: 'a' }, { count: 39388, sig: 'b' });
    expect(r.state).toBe('truncated');
    expect(r.droppedRows).toBe(112);
    expect(completenessMessage(r)).toMatch(/INCOMPLETE/);
    expect(completenessMessage(r)).toMatch(/112/);
  });

  it('⭐ fires even when the SIGS MATCH — inequality cannot be manufactured by a fallback', () => {
    // Load-bearing. Gating the firing arm behind a distinct-tabs proof would silence the
    // detector in the exact case it exists for. A fallback returns identical responses, so
    // it can only ever produce equality; an inequality is therefore trustworthy alone.
    const r = judgeCompleteness({ count: 39500, sig: 'same' }, { count: 39388, sig: 'same' });
    expect(r.state).toBe('truncated');
    expect(r.droppedRows).toBe(112);
  });

  it('names the real cliff numbers when the formula freezes', () => {
    // Capacity 39,388; raw keeps growing at ~58/day. One day past the cliff:
    const r = judgeCompleteness({ count: 39446, sig: 'a' }, { count: 39388, sig: 'b' });
    expect(r.state).toBe('truncated');
    expect(r.droppedRows).toBe(58);
  });
});

describe('judgeCompleteness — the SILENT arm, which is the one that can lie', () => {
  it('🔑 equal counts with DISTINCT sigs is COMPLETE and says nothing', () => {
    const r = judgeCompleteness({ count: 38944, sig: 'a' }, { count: 38944, sig: 'b' });
    expect(r.state).toBe('complete');
    expect(completenessMessage(r)).toBeNull();
  });

  it('🔴 equal counts with IDENTICAL sigs is UNVERIFIABLE, not complete', () => {
    // THE MEASURED HAZARD. This is what a silent tab fallback looks like from here, and
    // calling it "complete" is telling @andrew his spend data is whole when we cannot see.
    const r = judgeCompleteness({ count: 38944, sig: 'same' }, { count: 38944, sig: 'same' });
    expect(r.state).toBe('unverifiable');
    expect(completenessMessage(r)).toMatch(/could not be verified/i);
    expect(completenessMessage(r)).toMatch(/same tab/);
  });

  it('a missing probe is UNVERIFIABLE and never a clean bill of health', () => {
    expect(judgeCompleteness(null, { count: 100, sig: 'b' }).state).toBe('unverifiable');
    expect(judgeCompleteness({ count: 100, sig: 'a' }, null).state).toBe('unverifiable');
    expect(judgeCompleteness(null, null).state).toBe('unverifiable');
  });

  it('derived > raw is UNVERIFIABLE — impossible, so distrust the pair', () => {
    const r = judgeCompleteness({ count: 100, sig: 'a' }, { count: 200, sig: 'b' });
    expect(r.state).toBe('unverifiable');
    expect(r.reason).toMatch(/MORE rows/);
  });

  it('reports counts even when it cannot judge — an unknown is not a blank', () => {
    const r = judgeCompleteness({ count: 5, sig: 's' }, { count: 5, sig: 's' });
    expect(r.rawRows).toBe(5);
    expect(r.derivedRows).toBe(5);
  });
});

describe('checkSheetCompleteness — never throws, never blocks a render', () => {
  const URL_OK = 'https://docs.google.com/spreadsheets/d/SHEET/edit#gid=100';

  it('ANTI-VACUITY CONTROL: two healthy distinct probes resolve to complete', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: async () => gviz(38944, 'RAW') })
      .mockResolvedValueOnce({ ok: true, text: async () => gviz(38944, 'DERIVED') });

    const r = await checkSheetCompleteness(URL_OK, 'Ads - Raw', f as unknown as typeof fetch);
    expect(r.state).toBe('complete');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('🔴 a truncating sheet is detected end to end', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: async () => gviz(39446, 'RAW') })
      .mockResolvedValueOnce({ ok: true, text: async () => gviz(39388, 'DERIVED') });

    const r = await checkSheetCompleteness(URL_OK, 'Ads - Raw', f as unknown as typeof fetch);
    expect(r.state).toBe('truncated');
    expect(r.droppedRows).toBe(58);
  });

  it('a THROWN fetch resolves to unverifiable rather than propagating', async () => {
    // @fable: "it must NOT block rendering. Incomplete data with an honest banner beats a
    // blank page." A detector that can throw is a detector that can white-screen the app.
    const f = vi.fn().mockRejectedValue(new Error('network down'));
    await expect(checkSheetCompleteness(URL_OK, 'Ads - Raw', f as unknown as typeof fetch)).resolves.toMatchObject({
      state: 'unverifiable',
    });
  });

  it('a non-ok response is unverifiable, not zero rows', async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => '' });
    expect((await checkSheetCompleteness(URL_OK, 'Ads - Raw', f as unknown as typeof fetch)).state).toBe('unverifiable');
  });

  it('🔑 REFUSES TO PROBE when the raw tab is unidentified — and does NOT call fetch', async () => {
    const f = vi.fn();
    const r = await checkSheetCompleteness(URL_OK, undefined, f as unknown as typeof fetch);
    expect(r.state).toBe('unverifiable');
    expect(r.reason).toMatch(/not been named/);
    expect(f).not.toHaveBeenCalled();   // no cost paid for a question we cannot answer
  });

  it('🔴 REFUSES on a BLANK raw tab name without spending a request', async () => {
    const f = vi.fn();
    for (const bad of ['', '   ', undefined]) {
      const r = await checkSheetCompleteness(URL_OK, bad, f as unknown as typeof fetch);
      expect(r.state).toBe('unverifiable');
      expect(r.reason).toMatch(/not been named/);
    }
    expect(f).not.toHaveBeenCalled();
  });

  it('a non-Sheets URL is unverifiable without a request', async () => {
    const f = vi.fn();
    expect((await checkSheetCompleteness('https://example.com/x', 'Ads - Raw', f as unknown as typeof fetch)).state)
      .toBe('unverifiable');
    expect(f).not.toHaveBeenCalled();
  });
});
