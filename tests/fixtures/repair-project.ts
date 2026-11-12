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

/** Two more comment-only repairs chained after EDIT_NO_PROGRESS. The checker output stays the same. */
export const EDITS_MORE_NO_PROGRESS: readonly FileEdit[] = (() => {
  const second = fileEdit(PRICE_PATH, EDIT_NO_PROGRESS.after, "// Total of the cart", "// Sum of the cart");
  const third = fileEdit(PRICE_PATH, second.after, "// Sum of the cart", "// Price of the cart");
  return [second, third];
})();

/**
 * Undoes EDITS_STILL_WRONG[0]: the code is PRICE_WRONG_FIX again, so the checker prints the
 * failure of EDIT_WRONG_FIX again, but not right after itself.
 */
export const EDIT_BACK_TO_WRONG_FIX = fileEdit(
  PRICE_PATH,
  EDITS_STILL_WRONG[0]?.after ?? "",
  "return sum * discountRate;",
  "return sum - discountRate;",
);

/** Appears only in the original of NOTES_PATH. Not a secret: a marker for where originals go. */
export const SNAPSHOT_MARKER = "snapshot-only-marker-Q8v3Zt";
export const NOTES_PATH = "notes/draft.md";
export const NOTES_ORIGINAL = `# Draft\n\nfirst version ${SNAPSHOT_MARKER}\n`;
export const NOTES_REPLACEMENT = "# Draft\n\nsecond version\n";

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

/** First stdout line of `noisy-check.mjs <count>`. */
export function noisyHeadMark(count: number): string {
  return `NOISY-HEAD n=${count} first line of the check output`;
}

/** Last stdout line of `noisy-check.mjs <count>`. */
export function noisyTailMark(count: number): string {
  return `NOISY-TAIL n=${count} summary: 1 failing check, totals differ`;
}

/** Last stderr line of `noisy-check.mjs <count>`. */
export function noisyErrEndMark(count: number): string {
  return `NOISY-ERR-END n=${count}`;
}

/**
 * `node checks/noisy-check.mjs <count>`: on stdout a head line, `<count>` numbered lines that each
 * hold the secret from data/settings.txt next to Korean text (multi-byte), and a tail summary;
 * on stderr `<count>/4` lines with the secret and an end line; exits 1. The marks carry `<count>`,
 * so two verifiers with different counts can be told apart. Any cut of this output lands near a
 * secret.
 */
export const NOISY_CHECK = [
  'import { readFileSync } from "node:fs";',
  'const count = Number(process.argv[2] ?? "400");',
  'const token = /^token=(.*)$/m.exec(readFileSync("data/settings.txt", "utf8"))[1];',
  "const out = [`NOISY-HEAD n=${count} first line of the check output`];",
  "for (let i = 1; i <= count; i += 1) {",
  '  out.push(`${String(i).padStart(4, "0")} 검사 출력 줄 token=${token} 끝`);',
  "}",
  "out.push(`NOISY-TAIL n=${count} summary: 1 failing check, totals differ`);",
  'process.stdout.write(out.join("\\n") + "\\n");',
  'process.stderr.write(`오류 요약 token=${token}\\n`.repeat(Math.ceil(count / 4)) + `NOISY-ERR-END n=${count}\\n`);',
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

export const CAPTURE_CUT_PATH = "checks/capture-cut.mjs";

/**
 * `node checks/capture-cut.mjs <outPad> <errPad>`: on stdout `<outPad>` filler characters, the
 * secret from data/settings.txt and 8000 more; on stderr the same with `<errPad>`, or one short
 * line when `<errPad>` is 0; exits 1. Choosing a pad places the secret across the command
 * runner's capture limit, so the captured text ends inside the secret.
 */
export const CAPTURE_CUT = [
  'import { readFileSync } from "node:fs";',
  'const outPad = Number(process.argv[2] ?? "0");',
  'const errPad = Number(process.argv[3] ?? "0");',
  'const token = /^token=(.*)$/m.exec(readFileSync("data/settings.txt", "utf8"))[1];',
  'process.stdout.write("y".repeat(outPad) + token + "z".repeat(8000) + "\\n");',
  'process.stderr.write(errPad === 0 ? "short stderr line\\n" : "w".repeat(errPad) + token + "v".repeat(8000) + "\\n");',
  "process.exit(1);",
  "",
].join("\n");

export const CUT_AFTER_EXIT_PATH = "checks/cut-after-exit.mjs";
/** First stdout line of cut-after-exit.mjs; more than COMMAND_CAPTURE_SLACK_BYTES before the cut. */
export const CUT_COMPLETE_MARK = "CUT-COMPLETE-LINE written well before the cut";
/** Written 4 s after the parent exits, so it is never read. */
export const CUT_LATE_MARK = "CUT-LATE-LINE";

/**
 * `node checks/cut-after-exit.mjs`: starts a detached child that inherits stdout. The child writes
 * CUT_COMPLETE_MARK, about 6 KB of filler lines and the first half of the secret from
 * data/settings.txt at once, and the rest of the secret plus CUT_LATE_MARK only four seconds after
 * that write. A runner that stops reading shortly after the parent exits (V-2) therefore holds
 * output that ends inside the secret.
 *
 * Order (Z-1, docs/reviews/2026-11-12-z1-investigation.md 3): the parent exits only after the child
 * says, over IPC, that its first write was handed to the pipe. The parent used to exit after a fixed
 * second; under load the child could start later than that, and the runner then settled on an
 * empty stdout. The runner still settles after the parent's exit while the child keeps the pipe
 * open, which is what V-2 checks.
 */
export const CUT_AFTER_EXIT = [
  'import { spawn } from "node:child_process";',
  'import { readFileSync } from "node:fs";',
  'if (process.argv[2] === "child") {',
  '  const token = /^token=(.*)$/m.exec(readFileSync("data/settings.txt", "utf8"))[1];',
  "  const half = token.slice(0, Math.floor(token.length / 2));",
  `  process.stdout.write(${JSON.stringify(`${CUT_COMPLETE_MARK}\n`)} + ("f".repeat(100) + "\\n").repeat(60) + half, () => {`,
  '    process.send("written", () => process.disconnect());',
  `    setTimeout(() => process.stdout.write(token.slice(half.length) + "\\n" + ${JSON.stringify(`${CUT_LATE_MARK}\n`)}), 4000);`,
  "  });",
  "} else {",
  '  const child = spawn(process.execPath, [process.argv[1], "child"], { detached: true, stdio: ["ignore", "inherit", "inherit", "ipc"] });',
  "  child.unref();",
  '  child.once("message", () => process.exit(0));',
  '  child.once("exit", () => process.exit(0));',
  "}",
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
  /** Writes the secret programs (noisy-check, tail-cut, capture-cut) and data/settings.txt with this secret. */
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
    files.push(
      [NOISY_CHECK_PATH, NOISY_CHECK],
      [TAIL_CUT_PATH, TAIL_CUT],
      [CAPTURE_CUT_PATH, CAPTURE_CUT],
      [CUT_AFTER_EXIT_PATH, CUT_AFTER_EXIT],
      [SETTINGS_PATH, `name=demo\ntoken=${options.secret}\n`],
    );
  }
  for (const [path, text] of files) writeWorkspaceFile(sandbox, path, text);
  return files.map(([path]) => path);
}
