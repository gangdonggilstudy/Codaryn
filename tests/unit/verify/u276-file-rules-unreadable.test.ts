/**
 * U-276 (Codex V-28 H1, PM decision): a file_rules rule that looks at a file under the run's unreadable
 * paths is not compared, as data_checks does for its tables (U-258): exists, absent, contains,
 * not_contains, markdown_headings and markdown_links alike, and a markdown_links rule whose document
 * links to such a file. Before, the evidence "held … (text found)" or "not held … (text not found)" went
 * to the model in a repair and told it whether a guess at a hidden row was right (V-28's file-rule-true
 * and file-rule-false). Now such a rule is undecided with one fixed note, whatever the file holds and
 * whether it is there; the verifier's limits count the rules not compared; the judgment is on the real
 * path, a junction into the folder included. Without unreadable paths every rule is as before.
 * Temporary folders, synthetic values only.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import type { FileRule, RawVerifierResult } from "../../../src/contracts/index.js";
import { createVerifierRunner } from "../../../src/verify/index.js";
import type { CommandRunner } from "../../../src/verify/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";

const NOTE = "not compared: a verdict on a file under unreadable paths would tell the model about it";
const limit = (count: number, rules: number): string =>
  `${count} of ${rules} rules were not compared: a file they check is under unreadable paths, and a verdict would tell the model about it`;

let base = "";
/** Two workspaces alike but for the hidden row's value (V-28: 73, and 74 as the control). */
const roots: Record<"73" | "74", string> = { "73": "", "74": "" };

before(async () => {
  base = await mkdtemp(join(tmpdir(), "codaryn-u276-"));
  for (const value of ["73", "74"] as const) {
    const root = join(base, value);
    roots[value] = root;
    for (const dir of ["private", "docs"]) await mkdir(join(root, dir), { recursive: true });
    const files: Record<string, string> = {
      "private/data.csv": `g,v\nHIDDEN,${value}\n`,
      "private/notes.md": "# Private\n\nsee [the data](data.csv)\n",
      "docs/guide.md": "# Guide\n",
      "docs/clean.md": "# Clean\n\n[the guide](guide.md)\n",
      "docs/to-private.md": "# Public\n\n[the guide](guide.md) and [the data](../private/data.csv)\n",
      "docs/to-private-missing.md": "# Public\n\n[the guide](guide.md) and [nothing](../private/missing.csv)\n",
    };
    for (const [name, text] of Object.entries(files)) await writeFile(join(root, name), text, "utf8");
    // A link into the unreadable folder (a junction on Windows: no rights needed).
    await symlink(join(root, "private"), join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
  }
});

after(async () => {
  await rm(base, { recursive: true, force: true });
});

const noCommands: CommandRunner = {
  async run() {
    throw new Error("no command in these tests");
  },
};

async function run(root: string, rules: readonly FileRule[], unreadablePaths?: readonly string[]): Promise<RawVerifierResult> {
  const runner = createVerifierRunner({ workspace: await createWorkspace({ root }), commandRunner: noCommands, ...(unreadablePaths === undefined ? {} : { unreadablePaths }) });
  return runner.run({ id: "files", kind: "file_rules", rules: [...rules] }, new AbortController().signal);
}

const V28: readonly FileRule[] = [
  { type: "contains", path: "private/data.csv", text: "HIDDEN,73" },
  { type: "exists", path: "force-repair.txt" },
];

test("U-276 (V-28 H1): a text rule on an unreadable file says the same whatever the hidden row holds", async () => {
  const hidden73 = await run(roots["73"], V28, ["private"]);
  const hidden74 = await run(roots["74"], V28, ["private"]);
  assert.deepEqual(hidden74, hidden73, "the guess and the control give the same result");
  assert.deepEqual(hidden73.evidence.split("\n"), [
    `undecided: "private/data.csv" contains the literal text "HIDDEN,73" (${NOTE})`,
    'not held: "force-repair.txt" exists (not present)',
  ]);
  assert.equal(hidden73.outcome, "fail");
  assert.ok(hidden73.limits.includes(limit(1, 2)), JSON.stringify(hidden73.limits));
  // Without the list the leak V-28 found: the verdict tells the guess from the control.
  const plain73 = await run(roots["73"], V28);
  const plain74 = await run(roots["74"], V28);
  assert.equal(plain73.evidence.split("\n")[0], 'held: "private/data.csv" contains the literal text "HIDDEN,73" (text found)');
  assert.equal(plain74.evidence.split("\n")[0], 'not held: "private/data.csv" contains the literal text "HIDDEN,73" (text not found)');
});

test("U-276: every kind of file rule on a file under unreadable paths is not compared, there or not", async () => {
  const rules: FileRule[] = [
    { type: "exists", path: "private/data.csv" },
    { type: "exists", path: "private/missing.csv" },
    { type: "absent", path: "private/data.csv" },
    { type: "absent", path: "private/missing.csv" },
    { type: "contains", path: "private/missing.csv", text: "x" },
    { type: "not_contains", path: "private/data.csv", text: "HIDDEN" },
    { type: "markdown_headings", path: "private/notes.md", headings: [{ text: "Private" }] },
    { type: "markdown_links", path: "private/notes.md" },
    // Through a junction into the folder: judged on the real path, as at the gate.
    { type: "contains", path: "linked/data.csv", text: "HIDDEN" },
  ];
  const hidden = await run(roots["73"], rules, ["private"]);
  for (const line of hidden.evidence.split("\n")) assert.ok(line.startsWith("undecided: ") && line.endsWith(`(${NOTE})`), line);
  assert.equal(hidden.outcome, "inconclusive");
  assert.ok(hidden.limits.includes(limit(rules.length, rules.length)), JSON.stringify(hidden.limits));
  // Without the list they are checked as before.
  const plain = (await run(roots["73"], rules)).evidence.split("\n").map((line) => line.slice(0, line.indexOf(":")));
  assert.deepEqual(plain, ["held", "not held", "not held", "held", "not held", "not held", "held", "held", "held"]);
});

test("U-276: a markdown_links rule whose document links into unreadable paths is not compared", async () => {
  const rules: FileRule[] = [
    { type: "markdown_links", path: "docs/to-private.md" },
    { type: "markdown_links", path: "docs/to-private-missing.md" },
    { type: "markdown_links", path: "docs/clean.md" },
  ];
  const hidden = (await run(roots["73"], rules, ["private"])).evidence.split("\n");
  // Whether the linked file is there or not, the same words.
  assert.equal(hidden[0], `undecided: "docs/to-private.md" has relative links whose targets exist (${NOTE})`);
  assert.equal(hidden[1], `undecided: "docs/to-private-missing.md" has relative links whose targets exist (${NOTE})`);
  // A document whose links stay outside the folder is checked as before.
  assert.ok(hidden[2]?.startsWith('held: "docs/clean.md"'), hidden.join(" | "));
  const plain = (await run(roots["73"], rules)).evidence.split("\n").map((line) => line.slice(0, line.indexOf(":")));
  assert.deepEqual(plain, ["held", "not held", "held"]);
});

test("U-276: a check whose rules are all on readable files has the limits of before", async () => {
  const rules: FileRule[] = [{ type: "exists", path: "docs/guide.md" }, { type: "contains", path: "docs/guide.md", text: "Guide" }];
  const hidden = await run(roots["73"], rules, ["private"]);
  assert.deepEqual(hidden, await run(roots["73"], rules));
});
