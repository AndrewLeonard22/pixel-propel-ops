#!/usr/bin/env node
/**
 * THE GATES, WITH THEIR OWN CONTROLS. `npm run gates`
 *
 * WHY THIS IS A SCRIPT AND NOT A PARAGRAPH IN A README:
 *   Six probes broke on this branch in one night. Six were caught. NONE was caught by
 *   diligence — every one was caught by a control whose answer was predictable in advance,
 *   or by a contradiction with something already known. Three seats hit the SAME trap
 *   within one hour, and at least two of us had read a warning naming it minutes before.
 *
 *   ⭐ READING A WARNING DOES NOT INSTALL IT. If a trap has bitten twice, the fix is a
 *   MECHANISM, not another sentence. This is the mechanism.
 *
 * THE FOUR WAYS A CHECK LIES, each earned on this branch:
 *   PATTERN      the pattern would not match even where the thing exists      → fakes a ZERO
 *   READ         the read failed; grep -c over nothing returns 0              → fakes a ZERO
 *   INVOCATION   the command never received the args you think it did         → fakes a ZERO
 *   POPULATION   everything works and there was NOTHING TO MEASURE            → fakes a PASS
 *
 *   The first three produce a suspicious number. POPULATION produces a CLEAN GREEN, which
 *   is why it survived longest every time. Concretely, on this repo:
 *     - `tsc --noEmit` (bare) compiles ZERO files and exits 0 over a real type error,
 *       because the root tsconfig is `files: []` + project references. It was published
 *       as passing-gate evidence.
 *     - a `}` where `});` belonged orphaned two tests; vitest reported "no tests" and
 *       exited 0.
 *     - a numeric `$0.00` sweep passed clean while the defect sat beside it in PROSE.
 *
 * SO EVERY GATE HERE CARRIES A POSITIVE CONTROL: a planted fault it MUST reject. If a
 * control ever passes, the gate is not measuring anything and this script fails loudly
 * rather than reporting green.
 *
 * 🔴 AND THE SCRIPT WAS VULNERABLE TO ITS OWN THIRD CATEGORY — @fable measured it, and it
 * is the reason `RUN` and `VERDICT` below exist:
 *
 *   The controls used to RE-TYPE each command. `exit('npx', ['tsc','-b','--noEmit'])` in
 *   the gate, and a second, separately-typed `exit('npx', ['tsc','-b','--noEmit'])` in the
 *   control. Two strings that only LOOK like one command. Swap the GATE's copy for the
 *   vacuous bare form and the control still ran the real one, still rejected the poison,
 *   still printed a satisfied ✅ — and the ladder printed ALL GATES GREEN over a gate that
 *   had stopped compiling anything. Measured: 3 of the 4 gate assertions could be neutered
 *   that way. A control that re-states its subject is not a control ON that subject; it is
 *   a control on a copy, and INVOCATION is precisely the failure it cannot see.
 *
 *   ⇒ EVERY GATE IS NOW ONE OBJECT, run through ONE function, judged by ONE verdict, by
 *     both sections. Neutering the gate now neuters the control, the control PASSES where
 *     it must fail, and this script goes red. The control and the gate cannot drift apart
 *     because there is only one of them.
 *
 * ⛔ WHAT THIS SCRIPT CANNOT DO, AND IT IS A FIFTH CATEGORY — @bird found it, @raccoon
 * sharpened it, and stating it here is the point:
 *
 *   DIMENSION    the tool WORKED PERFECTLY and returned a TRUE answer to a question
 *                that cannot express the defect.
 *
 * The four above are instrument FAILURES — the tool broke, and a control detects it
 * because a control tests the tool. DIMENSION is an instrument LIMIT. NO CONTROL ON THAT
 * INSTRUMENT CAN SEE IT; only a SECOND INSTRUMENT can. Measured instances on this branch,
 * every one sound and every one TRUE:
 *   a numeric $0.00 sweep passed clean while the defect sat beside it IN PROSE
 *   a badge check passed while the identical defect was in the TILES
 *   a one-page census passed while two other pages bled
 *
 * ⇒ A CONTROL PROVES THE INSTRUMENT WORKS. IT CANNOT PROVE THE INSTRUMENT IS ASKING THE
 *   RIGHT QUESTION. Those are different properties, and everything below tests the first.
 *   Green here means the gates ran and could have failed. It does not mean they asked
 *   about the thing that is broken.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, openSync, closeSync, unlinkSync, rmSync, existsSync } from 'node:fs';

const POISON_FILE = 'src/lib/dataService.ts';
const POISON = '\nconst __GATE_CONTROL_POISON: number = "not a number";\n';
const IMPORT_POISON_FILE = 'src/main.tsx';
const IMPORT_POISON = "import '@/__gate_control_missing_module__';\n";
/**
 * The vitest control needs a fault vitest can SEE, and the type poison is not one — esbuild
 * strips types, so `const x: number = "s"` runs perfectly. A failing test file is the
 * smallest fault that is real to this instrument.
 */
const TEST_POISON_FILE = 'src/__gate_control_poison__.test.ts';
const TEST_POISON = `import { it, expect } from 'vitest';
// Planted by scripts/gates.mjs and deleted by it. If you are reading this in a diff, a
// gates run died between planting and cleanup — delete the file.
it('__GATE_CONTROL_POISON — a deliberately failing test', () => { expect(1).toBe(2); });
`;

/**
 * ⭐ THE ONE EXEMPTION FROM THE VITEST REFUSAL, STAMPED HERE AND INHERITED BY EVERY CHILD.
 *
 * `vitest.config.ts` now aborts any run that starts while `.gates.lock` is held by a live
 * pid — because this script deliberately breaks the tree and a suite landing in that window
 * reports a red belonging to no tree at all (@raccoon watched it happen, 2026-08-12). This
 * script's OWN vitest invocations are the legitimate exception, and `execFileSync` inherits
 * `process.env`, so setting it once here covers the gate and its control both.
 *
 * ⛔ IT IS SET AFTER THE LOCK IS TAKEN — see below — so a refused second run never gets to
 * exempt itself.
 */
const exemptChildrenFromLockRefusal = () => { process.env.GATES_RUN = '1'; };

let failed = 0;
const log = (ok, name, detail) => {
  console.log(`  ${ok ? '✅' : '🔴'} ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failed++;
};

/* ------------------------------------------------------------------------- *
 * ⛔ ONE RUN AT A TIME — @fable, measured 2026-08-12.
 *
 * This script WRITES A TYPE ERROR INTO `src/lib/dataService.ts` and restores it from a
 * buffer read at plant time. Two runs overlapping is not a flaky-test problem, it is data
 * loss with a green face:
 *
 *   run A plants poison            dataService.ts = work + poisonA
 *   run B reads its "original"     original_B    = work + poisonA        ← already wrong
 *   run A restores                 dataService.ts = work
 *   run B restores                 dataService.ts = work + poisonA       ← poison, forever
 *
 * And the verdicts either side are worthless while it happens: measured, `gates.mjs` failed
 * a DIFFERENT gate on each of three runs — vitest, then `tsc -b`, then `tsc -p app` — while
 * every one of those tools passed in isolation. Nobody could tell that from the output,
 * which is the part that matters. A wrong red teaches people to re-run until green.
 *
 * A lock is the fix, and REFUSING is the right behaviour rather than waiting: the second
 * caller wants a verdict on the tree AS IT IS, and the tree currently has a type error
 * written into it on purpose.
 * ------------------------------------------------------------------------- */
const LOCK = '.gates.lock';

function takeLock() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(LOCK, 'wx');
      writeFileSync(LOCK, `${process.pid}\n${new Date().toISOString()}\n`);
      closeSync(fd);
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // A crashed run leaves its lock behind. A lock nobody holds is litter, not a lock —
      // but "is that pid alive" is the only honest way to tell, so ASK rather than assume
      // by age. `kill(pid, 0)` signals nothing and throws ESRCH when the process is gone.
      const held = Number(String(readFileSync(LOCK, 'utf8')).split('\n')[0]);
      let alive = true;
      try { process.kill(held, 0); } catch (err) { alive = err.code !== 'ESRCH'; }
      if (alive) {
        console.log(
          `\n🔴 ANOTHER GATES RUN IS IN PROGRESS (pid ${held}).\n` +
          `   This script writes a type error into ${POISON_FILE} and restores it afterwards.\n` +
          `   Two runs overlapping restore each other's poison INTO the file and produce\n` +
          `   verdicts that belong to neither tree. Refusing rather than reporting a colour.\n` +
          `   Wait for it, or remove ${LOCK} if you are certain that pid is gone.\n`,
        );
        process.exit(2);
      }
      console.log(`  ℹ️  clearing a stale lock from pid ${held} (no such process)`);
      try { unlinkSync(LOCK); } catch { /* raced with another cleaner; retry decides */ }
    }
  }
  console.log(`\n🔴 could not take ${LOCK}. Refusing to run.\n`);
  process.exit(2);
}

let holdsLock = false;
const dropLock = () => { if (holdsLock) { try { unlinkSync(LOCK); } catch { /* already gone */ } holdsLock = false; } };
takeLock();
holdsLock = true;
exemptChildrenFromLockRefusal();
process.on('exit', dropLock);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { dropLock(); process.exit(130); });
}

/**
 * ⛔ POISON LEFT BY A DEAD RUN IS CHECKED **BEFORE** ANYTHING IS READ, not only at the end.
 *
 * The end-of-run marker check catches it — one run too late. By then this script has already
 * read the poisoned file as its `original` and will faithfully restore the poison. Refusing
 * up front is the difference between "someone's run died" and "someone's run died and this
 * one wrote it back in".
 */
for (const [file, marker] of [[POISON_FILE, '__GATE_CONTROL_POISON'], [IMPORT_POISON_FILE, '__gate_control_missing_module__']]) {
  if (readFileSync(file, 'utf8').includes(marker)) {
    console.log(
      `\n🔴 ${file} ALREADY CONTAINS THE CONTROL POISON (${marker}).\n` +
      `   A previous gates run died between planting and cleanup. Remove that line by hand;\n` +
      `   running now would take the poisoned file as the baseline and restore it forever.\n`,
    );
    process.exit(2);
  }
}
if (existsSync(TEST_POISON_FILE)) {
  console.log(`\n🔴 ${TEST_POISON_FILE} is left over from a dead gates run. Delete it and re-run.\n`);
  process.exit(2);
}

/* ------------------------------------------------------------------------- *
 * ⭐ ONE DEFINITION PER GATE. The gate section and the control section both run THESE —
 * `RUN` is the only place a command is spelled out, and `VERDICT` the only place a result
 * is judged. That is what makes the controls controls: change a gate's argv and the control
 * changes with it, so a neutered gate produces a control that PASSES, and a control that
 * passes fails this script.
 * ------------------------------------------------------------------------- */

/** Run a command; return its exit code and combined output, without throwing. */
function capture(cmd, args) {
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, out };
  } catch (e) {
    return { code: typeof e.status === 'number' ? e.status : 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const stripAnsi = (s) => s.replace(/\[[0-9;]*m/g, '');

/**
 * ⚡ THE VITEST VERDICT IS PARSED, NOT TAKEN FROM THE EXIT CODE, because "no tests" exits 0
 * and reads as a pass. The COUNT is the population control.
 *
 * 🔴 AND THE PARSE WAS WRONG — measured. `/Tests\s+(\d+)\s+passed/` cannot match vitest's
 * failing summary, which reads `Tests  1 failed | 747 passed (748)`: the first number after
 * `Tests` is the FAILURE count. So a run with one real failure reported `0 passed`. The
 * VERDICT was right by luck (0 is not > 0, so it went red) and the DETAIL was a lie — and a
 * gate that misreports the population is a gate nobody can debug from its own output. Read
 * the summary line, then read each number out of it by name.
 */
function vitestVerdict(out) {
  const clean = stripAnsi(out);
  const line = clean.match(/^\s*Tests\s+\S.*$/m)?.[0] ?? '';
  const passed = Number(/(\d+)\s+passed/.exec(line)?.[1] ?? 0);
  const nFailed = Number(/(\d+)\s+failed/.exec(line)?.[1] ?? 0);
  const skipped = Number(/(\d+)\s+skipped/.exec(line)?.[1] ?? 0);
  return {
    ok: nFailed === 0 && passed > 0,
    detail: line.trim()
      ? `${passed} passed${nFailed ? `, ${nFailed} FAILED` : ''}${skipped ? `, ${skipped} skipped` : ''}`
      : 'NO "Tests" SUMMARY LINE — vitest collected nothing, which exits 0 and reads as a pass',
  };
}

const GATES = [
  { key: 'tscB', name: 'tsc -b --noEmit', cmd: 'npx', args: ['tsc', '-b', '--noEmit'] },
  { key: 'tscApp', name: 'tsc -p tsconfig.app.json', cmd: 'npx', args: ['tsc', '-p', 'tsconfig.app.json', '--noEmit'] },
  // ⚡ THE BUILD IS A GATE AND WAS MISSING — @raccoon measured that this file mentioned
  // "build" ZERO times while Lovable rebuilds main with `vite build`. TYPECHECK IS NOT A
  // BUNDLE: tsc never resolves a path alias the way rollup does, never tree-shakes, and
  // never fails on an unresolvable runtime import. A branch can be 275/275 with every gate
  // green and still not produce a site.
  { key: 'build', name: 'vite build', cmd: 'npx', args: ['vite', 'build', '--logLevel', 'error'] },
  { key: 'vitest', name: 'vitest', cmd: 'npx', args: ['vitest', 'run'], verdict: vitestVerdict },
];
const GATE = Object.fromEntries(GATES.map(g => [g.key, g]));

/** THE one way any gate is ever run or judged, in both sections below. */
function runGate(g) {
  const r = capture(g.cmd, g.args);
  if (g.verdict) return g.verdict(r.out);
  return { ok: r.code === 0, detail: `exit=${r.code}` };
}

// A CONTROL ON THE RUNNER: a gate with no command cannot be run, and an empty argv is how
// an "invocation" silently becomes a no-op.
for (const g of GATES) {
  if (!g.cmd || !Array.isArray(g.args) || g.args.length === 0) {
    console.log(`  🔴 gate ${g.key} has no command to run`);
    failed++;
  }
}

console.log('\nGATES');
for (const g of GATES) {
  const r = runGate(g);
  log(r.ok, g.name, r.detail);
}

console.log('\nCONTROLS — each gate must REJECT a planted fault, or it measures nothing');
// ⚡ BYTES, NOT A STRING — @bird's law: a control whose UNIT does not match the thing it
// guards is not a control. His fingerprint reported String.length (UTF-16 code units)
// labelled "bytes", and the character that broke it was the em-dash — 69 of them, the
// app's own symbol for "this is not a zero". This file previously read utf8 and compared
// STRINGS while printing "byte-identical": sound for valid UTF-8 by round-trip, and
// therefore right by LUCK rather than by construction. A BOM or invalid UTF-8 would make
// the decode lossy and the comparison could report identical while the bytes differed.
const original = readFileSync(POISON_FILE);
try {
  writeFileSync(POISON_FILE, Buffer.concat([original, Buffer.from(POISON, 'utf8')]));

  const cB = runGate(GATE.tscB);
  log(!cB.ok, `\`${GATE.tscB.name}\` rejects a planted type error`, cB.detail);

  const cApp = runGate(GATE.tscApp);
  log(!cApp.ok, `\`${GATE.tscApp.name}\` rejects a planted type error`, cApp.detail);

  // A control the TYPECHECKS CANNOT PROVIDE: an unresolvable runtime import is invisible
  // to tsc (it type-errors only if typed) but must break the bundle. This proves the build
  // gate is measuring resolution, not just re-running what tsc already did.
  const importOriginal = readFileSync(IMPORT_POISON_FILE);
  try {
    writeFileSync(
      IMPORT_POISON_FILE,
      Buffer.concat([Buffer.from(IMPORT_POISON, 'utf8'), importOriginal]),
    );
    const cBuild = runGate(GATE.build);
    log(!cBuild.ok, `\`${GATE.build.name}\` rejects an unresolvable import`, cBuild.detail);
  } finally {
    writeFileSync(IMPORT_POISON_FILE, importOriginal);
  }

  /**
   * 🔴 THE VITEST GATE HAD NO CONTROL AT ALL, and it is the gate the whole team quotes.
   * "748 passed" was accepted as evidence by four sessions on this branch while nothing
   * anywhere proved that the number came from a run that COULD have said otherwise.
   * A planted failing test is the smallest fault this instrument can see.
   */
  try {
    writeFileSync(TEST_POISON_FILE, TEST_POISON);
    const cTest = runGate(GATE.vitest);
    log(!cTest.ok, `\`${GATE.vitest.name}\` rejects a planted failing test`, cTest.detail);
  } finally {
    rmSync(TEST_POISON_FILE, { force: true });
  }

  // Documented, not run as a gate: proof the bare form is vacuous on this repo.
  const cBare = capture('npx', ['tsc', '--noEmit']).code;
  console.log(
    `  ${cBare === 0 ? 'ℹ️ ' : '❓'} bare \`tsc --noEmit\` exit=${cBare}` +
      (cBare === 0
        ? '  ← VACUOUS by design (root tsconfig is files:[]). Never use it as a gate.'
        : '  ← no longer vacuous; the root tsconfig changed, re-read this script.'),
  );
} finally {
  writeFileSync(POISON_FILE, original);
}

// ⚡ ASSERT THE POISON MARKER IS ABSENT — NOT THAT THE FILE IS UNCHANGED. @raccoon.
//
// Three designs, and this one does not trade between them:
//                            leftover poison   this run's poison   legit uncommitted
//                            from a PREV run   not removed         work in progress
//   same-run baseline (v1)   MISSED            caught              no false positive
//   git-compare       (v2)   caught            caught              FALSE POSITIVE
//   marker-absence    (v3)   caught            caught              no false positive
//
// v2 was mine and it cried wolf on the two worst files on this branch: dataService.ts is
// the hub five seats have findings in, and main.tsx is the entry point. Measured — the
// ladder went RED on ordinary work in progress. It failed CLOSED and preserved the work,
// so it was never a safety regression; it was a CRY-WOLF regression, and a gate that goes
// red during normal editing is a gate someone learns to skip.
//
// The MARKER is what this control is for. The file's other contents are none of its
// business — which is why v3 dominates rather than compromises.
const MARKER = {
  [POISON_FILE]: '__GATE_CONTROL_POISON',
  [IMPORT_POISON_FILE]: '__gate_control_missing_module__',
};

// A CONTROL ON THE CONTROL: each marker must actually occur in the poison that plants it.
// Restating a marker by hand is how a check silently drifts from the thing it checks.
for (const [file, marker] of Object.entries(MARKER)) {
  const plantedBy = file === POISON_FILE ? POISON : IMPORT_POISON;
  if (!plantedBy.includes(marker)) {
    console.log(`  🔴 marker ${marker} does not appear in the poison for ${file}`);
    failed++;
  }
}

for (const [file, marker] of Object.entries(MARKER)) {
  log(!readFileSync(file, 'utf8').includes(marker), `${file} carries no poison marker`, marker);
}
log(!existsSync(TEST_POISON_FILE), `${TEST_POISON_FILE} was cleaned up`, '');

if (failed === 0) {
  console.log('\nALL GATES GREEN, ALL CONTROLS RED');
  // ⛔ PRINTED ON SUCCESS, DELIBERATELY — @bird's rule, and it is the whole reason this
  // block exists: "a blind spot printed only on failure is a blind spot nobody reads.
  // The green verdict is exactly when someone stops looking, so that is where the limit
  // has to appear." A limit that lives only in a docblock is read once, by its author.
  console.log('\n⚠️  WHAT THIS DOES NOT SAY — read it BECAUSE the line above is green:');
  console.log('   These gates ran and COULD have failed. That is all a control proves.');
  console.log('   It does NOT prove they asked about the thing that is broken.');
  console.log('   DIMENSION failures — a TRUE answer to a question that cannot express');
  console.log('   the defect — are invisible here and need a SECOND INSTRUMENT.');
  console.log('   Measured on this branch: a numeric $0.00 sweep passed clean while the');
  console.log('   defect sat beside it in PROSE; a badge check passed while the identical');
  console.log('   defect was in the TILES; a one-page census passed while two pages bled.\n');
} else {
  console.log(`\n${failed} FAILED\n`);
}
process.exit(failed === 0 ? 0 : 1);
