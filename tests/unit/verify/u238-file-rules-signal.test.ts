/**
 * U-238 (ne-verify's note O-1 in review R-107): the file rules verifier's text rules (`contains`,
 * `not_contains`) give the run's signal to `Workspace.readText`, as the read tools do since U-213.
 * - The signal the verifier runs with is the one the read gets.
 * - A read whose folder changes on every try ends when the run is cancelled during a wait between
 *   tries, not after the six tries and their waits; the rule's line says it was cancelled while it
 *   was checked (undecided, the outcome inconclusive, never a failure), and the next rule is not checked.
 * - Not cancelled, the same read is still io_error after six tries, and an ordinary read is as before.
 * Real files in a temp folder, the real workspace module with a file layer that changes the folder
 * after each open (as U-213's tests), synthetic values only.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import type { GuardedCallOptions, Workspace } from "../../../src/contracts/index.js";
import { createVerifierRunner } from "../../../src/verify/index.js";
import type { CommandRunner } from "../../../src/verify/index.js";
import { nodeFileLayer } from "../../../src/workspace/file-layer.js";
import type { FileLayer } from "../../../src/workspace/file-layer.js";
import { GUARD_ATTEMPTS } from "../../../src/workspace/guard.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { createWorkspaceWithFileLayer } from "../../../src/workspace/workspace.js";

let base = "";
let root = "";

before(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-u238-signal-")));
  root = path.join(base, "root");
  fs.mkdirSync(path.join(root, "parent"), { recursive: true });
  fs.writeFileSync(path.join(root, "parent", "a.txt"), "inside\n");
  fs.writeFileSync(path.join(root, "b.txt"), "other\n");
});

after(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

const noCommands: CommandRunner = {
  async run() {
    throw new Error("no command in these tests");
  },
};

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Makes and removes a file in `folder`, past the clock tick of the folder's last change (U-213's tests). */
async function touch(folder: string): Promise<void> {
  await sleep(20);
  const sibling = path.join(folder, `burst-${process.pid}.tmp`);
  fs.writeFileSync(sibling, "x");
  fs.unlinkSync(sibling);
}

/** A file layer whose open of a file in `folder` changes that folder after every open. */
function changingReads(folder: string): { layer: FileLayer; opens: () => number } {
  let opens = 0;
  return {
    opens: () => opens,
    layer: {
      ...nodeFileLayer,
      openRead: async (target) => {
        const handle = await nodeFileLayer.openRead(target);
        if (path.dirname(target) === folder) {
          opens += 1;
          await touch(folder);
        }
        return handle;
      },
    },
  };
}

const RULES = [
  { type: "contains" as const, path: "parent/a.txt", text: "inside" },
  { type: "not_contains" as const, path: "b.txt", text: "secret-ish" },
];

test("U-238: the text rules' reads get the signal the verifier runs with", async () => {
  const workspace = await createWorkspace({ root });
  const seen: (GuardedCallOptions | undefined)[] = [];
  const recording: Workspace = {
    ...workspace,
    readText: async (target, options) => {
      seen.push(options);
      return workspace.readText(target, options);
    },
  };
  const controller = new AbortController();
  const result = await createVerifierRunner({ workspace: recording, commandRunner: noCommands }).run(
    { id: "text", kind: "file_rules", rules: RULES },
    controller.signal,
  );
  assert.equal(result.outcome, "pass", result.evidence);
  assert.equal(seen.length, 2);
  for (const options of seen) assert.equal(options?.signal, controller.signal);
});

test("U-238: cancelled during a wait between tries, the read ends at once and its rule says it was cancelled", async () => {
  const cut = changingReads(path.join(root, "parent"));
  const workspace = await createWorkspaceWithFileLayer({ root }, cut.layer);
  // Three tries of about 20 ms each come at once; the abort at 100 ms falls in the waits that follow.
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  const started = performance.now();
  const result = await createVerifierRunner({ workspace, commandRunner: noCommands }).run(
    { id: "text", kind: "file_rules", rules: RULES },
    controller.signal,
  );
  const took = performance.now() - started;
  assert.ok(took < 500, `ended ${Math.round(took)} ms after the start, not after the waits (about 870 ms)`);
  assert.ok(cut.opens() < GUARD_ATTEMPTS, `${cut.opens()} tries`);
  assert.equal(result.outcome, "inconclusive");
  assert.equal(
    result.evidence,
    [
      'undecided: "parent/a.txt" contains the literal text "inside" (cancelled while this rule was checked)',
      'undecided: "b.txt" does not contain the literal text "secret-ish" (cancelled before this rule was checked)',
    ].join("\n"),
  );
});

test("U-238: not cancelled, a read whose folder changes on every try is still io_error after six; an ordinary read is as before", async () => {
  const every = changingReads(path.join(root, "parent"));
  const workspace = await createWorkspaceWithFileLayer({ root }, every.layer);
  const result = await createVerifierRunner({ workspace, commandRunner: noCommands }).run(
    { id: "text", kind: "file_rules", rules: RULES },
    new AbortController().signal,
  );
  assert.equal(every.opens(), GUARD_ATTEMPTS);
  assert.equal(result.outcome, "inconclusive");
  assert.equal(
    result.evidence,
    [
      'undecided: "parent/a.txt" contains the literal text "inside" (file could not be read (io_error))',
      'held: "b.txt" does not contain the literal text "secret-ish" (text not found)',
    ].join("\n"),
  );

  const plain = await createVerifierRunner({ workspace: await createWorkspace({ root }), commandRunner: noCommands }).run(
    { id: "text", kind: "file_rules", rules: [...RULES, { type: "contains", path: "missing.txt", text: "x" }] },
    new AbortController().signal,
  );
  assert.equal(plain.outcome, "fail");
  assert.equal(
    plain.evidence,
    [
      'held: "parent/a.txt" contains the literal text "inside" (text found)',
      'held: "b.txt" does not contain the literal text "secret-ish" (text not found)',
      'not held: "missing.txt" contains the literal text "x" (file not found)',
    ].join("\n"),
  );
});
