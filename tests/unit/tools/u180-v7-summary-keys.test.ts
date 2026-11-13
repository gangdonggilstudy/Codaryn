/**
 * U-180, review V-7 M-1: a run plan's summary must reach plan.json made safe as the engine's last
 * message and plan summary are (safeModelText): control and invisible characters left out, the
 * registered values masked, and key shapes hidden (`[key]`) also when nobody registered them.
 * Before the fix only the registered values were masked, so an unregistered key shape stayed in the
 * summary handed to PlanRecorder.saveChangesPlan (V-7: 2 of 2 cases). The key shapes here are built
 * from parts and are not keys.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { HIDDEN_KEY_MARKER } from "../../../src/contracts/index.js";
import type { PlanRecorder, RawWorkflowToolOutcome, Workspace } from "../../../src/contracts/index.js";
import { createToolRunner } from "../../../src/tools/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { FAKE_SECRET_A, createFakePrivacy } from "./doubles.js";

const never = new AbortController().signal;
const ANTHROPIC_SHAPED = ["sk", "ant", "api03", "V7fakeVALUE".repeat(4)].join("-");
const OPENAI_SHAPED = ["sk", "proj", "V7fakeVALUE".repeat(4)].join("-");

async function withWorkspace(run: (workspace: Workspace) => Promise<void>): Promise<void> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-u180v7-"));
  try {
    await fs.writeFile(path.join(base, "a.md"), "a", "utf8");
    await run(await createWorkspace({ root: base }));
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
}

async function storedSummary(workspace: Workspace, summary: string): Promise<{ outcome: RawWorkflowToolOutcome; stored: readonly string[] | null }> {
  let stored: readonly string[] | null = null;
  const planRecorder: PlanRecorder = {
    savePlan: async () => "0".repeat(64),
    saveChangesPlan: async (plan) => {
      stored = [...plan.summary];
      return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
    },
  };
  const runner = createToolRunner({ workspace, privacy: createFakePrivacy(), planRecorder });
  assert.ok(runner.executeWorkflowTool !== undefined);
  const outcome = await runner.executeWorkflowTool({ id: "c1", name: "propose_changes", args: { summary, files: [{ path: "a.md", change: "modify" }] } }, never);
  return { outcome, stored };
}

test("V-7 M-1: unregistered key shapes in the summary are hidden before it is stored", async () => {
  await withWorkspace(async (workspace) => {
    const { outcome, stored } = await storedSummary(workspace, `rewrite with ${ANTHROPIC_SHAPED} and ${OPENAI_SHAPED}`);
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    assert.ok(stored !== null);
    const text = (stored as readonly string[]).join("|");
    assert.equal(text.includes(ANTHROPIC_SHAPED) || text.includes(OPENAI_SHAPED), false, "no key shape is stored");
    assert.deepEqual(stored, [`rewrite with ${HIDDEN_KEY_MARKER} and ${HIDDEN_KEY_MARKER}`]);
  });
});

test("V-7 M-1: a registered value and an unregistered key shape together: neither is stored", async () => {
  await withWorkspace(async (workspace) => {
    const { outcome, stored } = await storedSummary(workspace, `keep ${FAKE_SECRET_A} out, drop ${ANTHROPIC_SHAPED}`);
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    assert.deepEqual(stored, ["keep ", ` out, drop ${HIDDEN_KEY_MARKER}`], "the value's token left out, the key shape hidden");
  });
});

test("V-7 M-1: control and invisible characters are left out first, so they cannot hide a key shape", async () => {
  await withWorkspace(async (workspace) => {
    const split = `${ANTHROPIC_SHAPED.slice(0, 12)}​${ANTHROPIC_SHAPED.slice(12)}`;
    const { outcome, stored } = await storedSummary(workspace, `line one\r\nline two‮ ${split}`);
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    assert.deepEqual(stored, [`line one\nline two ${HIDDEN_KEY_MARKER}`]);
  });
});
