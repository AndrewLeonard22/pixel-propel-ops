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
import { readFileSync, writeFileSync } from 'node:fs';

const POISON_FILE = 'src/lib/dataService.ts';
const POISON = '\nconst __GATE_CONTROL_POISON: number = "not a number";\n';

let failed = 0;
const log = (ok, name, detail) => {
  console.log(`  ${ok ? '✅' : '🔴'} ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failed++;
};

/** Run a command; return its exit code without throwing. */
function exit(cmd, args) {
  try {
    execFileSync(cmd, args, { stdio: 'pipe' });
    return 0;
  } catch (e) {
    return typeof e.status === 'number' ? e.status : 1;
  }
}

console.log('\nGATES');
const tscB = exit('npx', ['tsc', '-b', '--noEmit']);
log(tscB === 0, 'tsc -b --noEmit', `exit=${tscB}`);
const tscApp = exit('npx', ['tsc', '-p', 'tsconfig.app.json', '--noEmit']);
log(tscApp === 0, 'tsc -p tsconfig.app.json', `exit=${tscApp}`);

// ⚡ THE BUILD IS A GATE AND WAS MISSING — @raccoon measured that this file mentioned
// "build" ZERO times while Lovable rebuilds main with `vite build`. TYPECHECK IS NOT A
// BUNDLE: tsc never resolves a path alias the way rollup does, never tree-shakes, and
// never fails on an unresolvable runtime import. A branch can be 275/275 with every gate
// green and still not produce a site. A gate ladder that omits the step production runs
// is a green that means less than it appears — which is the defect this whole file exists
// to prevent, sitting inside the file.
const build = exit('npx', ['vite', 'build', '--logLevel', 'error']);
log(build === 0, 'vite build', `exit=${build}`);

// vitest: the COUNT is the population control. "no tests" exits 0 and reads as a pass.
let suite = '';
try {
  suite = execFileSync('npx', ['vitest', 'run'], { encoding: 'utf8', stdio: 'pipe' });
} catch (e) {
  suite = `${e.stdout ?? ''}${e.stderr ?? ''}`;
}
const m = suite.match(/Tests\s+(\d+)\s+passed/);
const passed = m ? Number(m[1]) : 0;
log(/\d+ failed/.test(suite) === false && passed > 0, 'vitest', `${passed} passed`);

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

  const cB = exit('npx', ['tsc', '-b', '--noEmit']);
  log(cB !== 0, 'tsc -b rejects a planted type error', `exit=${cB}`);

  const cApp = exit('npx', ['tsc', '-p', 'tsconfig.app.json', '--noEmit']);
  log(cApp !== 0, 'tsc -p app rejects a planted type error', `exit=${cApp}`);

  // Documented, not run as a gate: proof the bare form is vacuous on this repo.
  // A control the TYPECHECKS CANNOT PROVIDE: an unresolvable runtime import is invisible
  // to tsc (it type-errors only if typed) but must break the bundle. This proves the build
  // gate is measuring resolution, not just re-running what tsc already did.
  const importPoisonFile = 'src/main.tsx';
  const importOriginal = readFileSync(importPoisonFile);
  try {
    writeFileSync(
      importPoisonFile,
      Buffer.concat([Buffer.from("import '@/__gate_control_missing_module__';\n", 'utf8'), importOriginal]),
    );
    const cBuild = exit('npx', ['vite', 'build', '--logLevel', 'error']);
    log(cBuild !== 0, 'vite build rejects an unresolvable import', `exit=${cBuild}`);
  } finally {
    writeFileSync(importPoisonFile, importOriginal);
  }

  const cBare = exit('npx', ['tsc', '--noEmit']);
  console.log(
    `  ${cBare === 0 ? 'ℹ️ ' : '❓'} bare \`tsc --noEmit\` exit=${cBare}` +
      (cBare === 0
        ? '  ← VACUOUS by design (root tsconfig is files:[]). Never use it as a gate.'
        : '  ← no longer vacuous; the root tsconfig changed, re-read this script.'),
  );
} finally {
  writeFileSync(POISON_FILE, original);
}

const restored = readFileSync(POISON_FILE).equals(original);
log(restored, 'poison removed, file byte-identical', `${original.length} octets`);

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
