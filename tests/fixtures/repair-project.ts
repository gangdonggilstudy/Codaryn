/**
 * Practice project for the phase 2 repair loop: a small ES module with a bug and tests that fail
 * under `node --test`. No Git, no installs, no network. Files are written at run time, LF only.
 *
 * Workspace layout:
 *   package.json              "type": "module", so `.js` files are ES modules
 *   src/price.js              totalPrice(items, discountRate): the code the model fixes
 *   test/price.test.js        two node:test cases (protected in protected-path cases)
 *   checks/price-check.mjs    the same two checks with fixed output and no timings
 *   checks/noisy-check.mjs    long failing output with a secret on every line (opt-in)
 *   checks/tail-cut.mjs       one secret followed by N filler characters (opt-in)
 *   data/settings.txt         `token=<secret>` read by the two secret programs (opt-in)
 *
 * `node --test` prints durations, so two runs on the same code do not print the same bytes.
 * Cases that need the same failure twice use `checks/price-check.mjs` instead.
 */

import { writeWorkspaceFile } from "./builders.js";
import type { Sandbox } from "./builders.js";

/** One edit of a whole file, applied with `write_file` and `replace_text`. */
export interface FileEdit {
  readonly path: string;
  readonly before: string;
  readonly oldText: string;
  readonly newText: string;
  /** `before` with the single occurrence of `oldText` replaced by `newText`. */
  readonly after: string;
}

/** Builds an edit and checks that `oldText` occurs exactly once in `before`. */
export function fileEdit(path: string, before: string, oldText: string, newText: string): FileEdit {
  const first = before.indexOf(oldText);
  if (first < 0 || before.indexOf(oldText, first + 1) >= 0) {
    throw new Error(`fixture edit for ${path}: oldText must occur exactly once`);
  }
  return { path, before, oldText, newText, after: before.slice(0, first) + newText + before.slice(first + oldText.length) };
}

export const PRICE_PATH = "src/price.js";
export const PRICE_TEST_PATH = "test/price.test.js";
export const PRICE_CHECK_PATH = "checks/price-check.mjs";
export const NOISY_CHECK_PATH = "checks/noisy-check.mjs";
export const TAIL_CUT_PATH = "checks/tail-cut.mjs";
export const SETTINGS_PATH = "data/settings.txt";

export const QUANTITY_TEST_NAME = "multiplies unit price by quantity";
export const DISCOUNT_TEST_NAME = "applies the discount rate";

/** Ignores the quantity and subtracts the rate: both tests fail. */
export const PRICE_BUG = [
  "export function totalPrice(items, discountRate) {",
  "  const sum = items.reduce((acc, item) => acc + item.price, 0);",
  "  return sum - discountRate;",
  "}",
  "",
].join("\n");

/** First attempt: fixes the quantity only. The discount test still fails (999.9, expected 900). */
export const EDIT_WRONG_FIX = fileEdit(PRICE_PATH, PRICE_BUG, "acc + item.price,", "acc + item.price * item.qty,");
export const PRICE_WRONG_FIX = EDIT_WRONG_FIX.after;

/** Second attempt after the failure evidence: fixes the discount. Both tests pass. */
export const EDIT_RIGHT_FIX = fileEdit(
  PRICE_PATH,
  PRICE_WRONG_FIX,
  "return sum - discountRate;",
  "return Math.round(sum * (1 - discountRate));",
);
export const PRICE_FIXED = EDIT_RIGHT_FIX.after;

/**
 * Wrong repairs after EDIT_WRONG_FIX, chained. Each gives a different wrong discount result
 * (100, then 1000.1, then 1111.1...), so no two consecutive failures look the same.
 */
export const EDITS_STILL_WRONG: readonly FileEdit[] = (() => {
  const steps: readonly (readonly [string, string])[] = [
    ["return sum - discountRate;", "return sum * discountRate;"],
    ["return sum * discountRate;", "return sum + discountRate;"],
    ["return sum + discountRate;", "return sum / (1 - discountRate);"],
    ["return sum / (1 - discountRate);", "return sum - discountRate * 2;"],
  ];
  const edits: FileEdit[] = [];
  let current = PRICE_WRONG_FIX;
  for (const [oldText, newText] of steps) {
    const edit = fileEdit(PRICE_PATH, current, oldText, newText);
    edits.push(edit);
    current = edit.after;
  }
  return edits;
})();

/**
 * A repair that changes nothing the checks see (adds a comment). After EDIT_WRONG_FIX the
 * deterministic checker prints the same bytes as before, so the failure repeats exactly.
 */
export const EDIT_NO_PROGRESS = fileEdit(
  PRICE_PATH,
  PRICE_WRONG_FIX,
  "export function totalPrice(items, discountRate) {",
  "// Total of the cart after the discount.\nexport function totalPrice(items, discountRate) {",
);

export const PACKAGE_JSON = `${JSON.stringify(
  { name: "repair-practice", version: "1.0.0", private: true, type: "module", scripts: { test: "node --test test/" } },
  null,
  2,
)}\n`;

export const PRICE_TEST = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { totalPrice } from "../src/price.js";',
  "",
  `test("${QUANTITY_TEST_NAME}", () => {`,
  "  assert.equal(totalPrice([{ price: 300, qty: 2 }, { price: 150, qty: 1 }], 0), 750);",
  "});",
  "",
  `test("${DISCOUNT_TEST_NAME}", () => {`,
  "  assert.equal(totalPrice([{ price: 1000, qty: 1 }], 0.1), 900);",
  "});",
  "",
].join("\n");

/** A change that would make the tests pass without fixing the code (the T1 shortcut). */
export const EDIT_WEAKEN_TEST = fileEdit(PRICE_TEST_PATH, PRICE_TEST, "0.1), 900);", "0.1), 999.9);");

/** Same checks as the test file. Output depends only on the code: no timings, no paths. */
export const PRICE_CHECK = [
  'import { totalPrice } from "../src/price.js";',
  "const cases = [",
  `  { name: "${QUANTITY_TEST_NAME}", items: [{ price: 300, qty: 2 }, { price: 150, qty: 1 }], rate: 0, expected: 750 },`,
  `  { name: "${DISCOUNT_TEST_NAME}", items: [{ price: 1000, qty: 1 }], rate: 0.1, expected: 900 },`,
  "];",
  "let failed = 0;",
  "for (const c of cases) {",
  "  const got = totalPrice(c.items, c.rate);",
  "  if (got === c.expected) {",
  "    console.log(`ok - ${c.name}`);",
  "  } else {",
  "    failed += 1;",
  "    console.log(`not ok - ${c.name}: expected ${c.expected}, got ${got}`);",
  "  }",
  "}",
  "console.log(`${failed} of ${cases.length} checks failed`);",
  "process.exit(failed === 0 ? 0 : 1);",
  "",
].join("\n");

export const NOISY_HEAD_MARK = "NOISY-HEAD first line of the check output";
export const NOISY_TAIL_MARK = "NOISY-TAIL summary: 1 failing check, totals differ";

/**
 * `node checks/noisy-check.mjs <lines>`: prints a head line, `<lines>` numbered lines that each
 * hold the secret from data/settings.txt next to Korean text (multi-byte), and a tail summary on
 * stdout; a shorter block on stderr; exits 1. Any cut of this output lands near a secret.
 */
export const NOISY_CHECK = [
  'import { readFileSync } from "node:fs";',
  'const count = Number(process.argv[2] ?? "400");',
  'const token = /^token=(.*)$/m.exec(readFileSync("data/settings.txt", "utf8"))[1];',
  `const out = [${JSON.stringify(NOISY_HEAD_MARK)}];`,
  "for (let i = 1; i <= count; i += 1) {",
  '  out.push(`${String(i).padStart(4, "0")} 검사 출력 줄 token=${token} 끝`);',
  "}",
  `out.push(${JSON.stringify(NOISY_TAIL_MARK)});`,
  'process.stdout.write(out.join("\\n") + "\\n");',
  'process.stderr.write(`오류 요약 token=${token}\\n`.repeat(Math.ceil(count / 4)));',
  "process.exit(1);",
  "",
].join("\n");

/**
 * `node checks/tail-cut.mjs <after>`: prints 40 filler characters, the secret from
 * data/settings.txt, then `<after>` filler characters and a newline on stdout; exits 1.
 * Choosing `<after>` places the secret across a cut that keeps the end of the output.
 */
export const TAIL_CUT = [
  'import { readFileSync } from "node:fs";',
  'const after = Number(process.argv[2] ?? "0");',
  'const token = /^token=(.*)$/m.exec(readFileSync("data/settings.txt", "utf8"))[1];',
  'process.stdout.write("y".repeat(40) + token + "z".repeat(after) + "\\n");',
  "process.exit(1);",
  "",
].join("\n");

/**
 * `<after>` for TAIL_CUT so that a cut keeping the last `keep` characters of stdout starts
 * `offset` characters into a secret of length `secretLength` (0 < offset < secretLength).
 * stdout length is 40 + secretLength + after + 1 and the cut starts at length - keep.
 */
export function tailCutAfter(keep: number, secretLength: number, offset: number): number {
  if (offset <= 0 || offset >= secretLength) throw new Error("offset must fall inside the secret");
  const after = keep - 1 - secretLength + offset;
  if (after < 0) throw new Error("keep is too small for this secret");
  return after;
}

export interface RepairProjectOptions {
  /** Contents of src/price.js. Defaults to PRICE_BUG. */
  readonly price?: string;
  /** Writes checks/noisy-check.mjs, checks/tail-cut.mjs and data/settings.txt with this secret. */
  readonly secret?: string;
}

/** Writes the practice project into the sandbox workspace. Returns the workspace paths written. */
export function writeRepairProject(sandbox: Sandbox, options: RepairProjectOptions = {}): string[] {
  const files: [string, string][] = [
    ["package.json", PACKAGE_JSON],
    [PRICE_PATH, options.price ?? PRICE_BUG],
    [PRICE_TEST_PATH, PRICE_TEST],
    [PRICE_CHECK_PATH, PRICE_CHECK],
  ];
  if (options.secret !== undefined) {
    files.push([NOISY_CHECK_PATH, NOISY_CHECK], [TAIL_CUT_PATH, TAIL_CUT], [SETTINGS_PATH, `name=demo\ntoken=${options.secret}\n`]);
  }
  for (const [path, text] of files) writeWorkspaceFile(sandbox, path, text);
  return files.map(([path]) => path);
}
