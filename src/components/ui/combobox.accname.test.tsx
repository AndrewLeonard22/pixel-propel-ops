import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 NINE NAMELESS COMBOBOXES, AND THE ONE THAT WAS LABELLED WAS THE ACCIDENT.
 *
 * axe-core reported `button-name`, impact CRITICAL, on the account edit sheet. The mechanism
 * generalises to every call site, because it is a property of the ROLE and not of the page:
 * `role="combobox"` is not in the "name from content" set, so the accessible-name algorithm
 * never reaches step 2F, and the trigger's visible text — which is the SELECTED VALUE — names
 * nothing. Eight of the nine call sites passed no `id`, no `aria-label` and had no
 * `<label for>`; `#company-name` was the only labelled instance in the product.
 *
 * ⭐ WHY A SOURCE SCAN AND NOT NINE RENDER TESTS. Fixing nine call sites is necessary and
 * not sufficient: the tenth is written next week, it looks correct on screen because it
 * renders its value, and no render test exists for a page nobody has written yet. The class
 * of defect is "a `<Combobox>` with no naming prop", which is decidable from the source. This
 * is the same argument AccountsTable.test.tsx makes for asserting on class lists rather than
 * screenshots: prove the MECHANISM, not one instance of it.
 *
 * ⚠️ `id` alone does NOT satisfy this. An id is a hook, not a name — it only names the
 * control if some `<label for>` elsewhere points back at it, which is exactly what "Media
 * buyer" did not do while carrying `id="media-buyer"`. So the rule demands an explicit
 * `aria-label` or `aria-labelledby` on the element itself.
 */

/**
 * `process.cwd()` and not a URL relative to this file: vitest's jsdom environment rewrites
 * `import.meta.url` to a bare module path, so `new URL('../../', import.meta.url).pathname`
 * resolves to a literal `/src` — an absolute path that does not exist, which makes the walk
 * throw rather than return an empty set. Loud, but for the wrong reason.
 */
const SRC = join(process.cwd(), 'src') + '/';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(p) && !/\.test\.tsx$/.test(p)) out.push(p);
  }
  return out;
}

/**
 * Every `<Combobox …>` opening tag in the file, as raw text.
 *
 * ⚠️ NOT A REGEX. `/<Combobox\b[\s\S]*?>/` terminates on the FIRST `>`, and every one of
 * these call sites contains `onChange={v => …}` — so the "tag" it captures stops inside the
 * first arrow function, before any naming prop, and the scan reports offenders that are
 * fine while missing ones that are not. Brace-depth scanning is the only way to find the
 * `>` that actually closes the tag. (A checker that is wrong in both directions is worse
 * than no checker: it costs trust in the ones it gets right.)
 */
function comboboxTags(rawSource: string): string[] {
  // ⚠️ COMMENTS FIRST. This repo documents heavily, and the prose talks ABOUT the control:
  // `AccountEditPanel.tsx:68` contains the literal string "<Combobox>" inside a docblock.
  // Scanning it as a call site reports an offender that cannot be fixed, which is how a
  // green check gets disabled rather than earned.
  const source = rawSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const tags: string[] = [];
  const re = /<Combobox\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    let depth = 0;
    for (let i = m.index; i < source.length; i++) {
      const c = source[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) { tags.push(source.slice(m.index, i + 1)); break; }
    }
  }
  return tags;
}

const files = walk(SRC).filter(f => !f.endsWith('ui/combobox.tsx'));

describe('🔴 every <Combobox> in the product carries an accessible name', () => {
  it('🔑 ANTI-VACUITY: the scan actually finds call sites', () => {
    const found = files.flatMap(f => comboboxTags(readFileSync(f, 'utf8')));
    // A grep that matches nothing makes every assertion below vacuously true. Measured at
    // the time of writing: 9 call sites across 6 files.
    expect(found.length).toBeGreaterThanOrEqual(9);
  });

  it('none of them relies on its selected VALUE to name it', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const tag of comboboxTags(readFileSync(file, 'utf8'))) {
        if (!/\baria-label(ledby)?=/.test(tag)) {
          offenders.push(`${file.replace(SRC, 'src/')}: ${tag.split('\n')[0]}`);
        }
      }
    }
    expect(offenders, `Combobox with no aria-label / aria-labelledby:\n${offenders.join('\n')}`).toEqual([]);
  });
});
