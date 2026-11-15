/**
 * A finished run of every model provider the contract names (MODEL_PROVIDER_NAMES) is a checked
 * run: listed with its status, the latest run, its originals readable, and revertible. Found by the
 * OpenAI integration case: the run list kept a hand-written provider list (scripted, anthropic), so
 * a successful openai run looked damaged and report, changes and revert refused it.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { MODEL_PROVIDER_NAMES, asRawText } from "../../../src/contracts/index.js";
import type { ContentHash, EngineResult, MaskedText, ModelProviderName } from "../../../src/contracts/index.js";
import {
  createChangeRecorder,
  createJournal,
  inspectRun,
  journalRelativePath,
  latestRunId,
  listRuns,
  readRunOriginals,
  revertRun,
  writeResult,
} from "../../../src/store/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";

const roots: string[] = [];
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const RUN_ID = "20260102T030405Z-0a1b2c3d";
const clock = { now: () => Date.UTC(2026, 0, 2, 3, 4, 5, 500) };
const sha = (text: string): ContentHash => createHash("sha256").update(text, "utf8").digest("hex") as ContentHash;
const BEFORE = "# Notes\n";
const AFTER = "# Notes\n\nadded by the run\n";

/** What a successful run with `provider` leaves: README.md changed, the original kept, done/verified. */
async function finishedRun(provider: ModelProviderName): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), `codaryn-provider-${provider}-`)));
  roots.push(root);
  await writeFile(join(root, "README.md"), BEFORE, "utf8");
  const journal = createJournal({ workspaceRoot: root, runId: RUN_ID, clock });
  await journal.append({
    type: "run_started",
    schemaVersion: 1,
    taskId: "doc-example",
    workflow: "document" as MaskedText,
    provider,
    limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60_000 },
  });
  const ws = await createWorkspace({ root });
  const resolved = await ws.resolve("README.md", "write");
  assert.ok(resolved.ok);
  await createChangeRecorder({ workspaceRoot: root, runId: RUN_ID }).saveOriginal(resolved.path, asRawText(BEFORE));
  await writeFile(join(root, "README.md"), AFTER, "utf8");
  await journal.append({ type: "file_changed", callId: "c1", path: "README.md" as MaskedText, previousHash: sha(BEFORE), newHash: sha(AFTER), created: false });
  const usage = { modelTurns: 2, toolCalls: 1, inputTokens: provider === "scripted" ? null : 10, outputTokens: provider === "scripted" ? null : 5, durationMs: 900 };
  await journal.append({ type: "run_finished", status: "done", reason: "verified", usage });
  await journal.close();
  const result: EngineResult = {
    schemaVersion: 1,
    kind: "run",
    runId: RUN_ID,
    taskId: "doc-example",
    status: "done",
    reason: "verified",
    exitCode: 0,
    provider,
    verifiers: [],
    changes: [{ path: "README.md" as MaskedText, previousHash: sha(BEFORE), newHash: sha(AFTER), created: false }],
    usage,
    journalPath: journalRelativePath(RUN_ID),
    notices: [],
  };
  await writeResult(root, result);
  return root;
}

describe("a finished run of every contract provider is a checked, revertible run", () => {
  for (const provider of MODEL_PROVIDER_NAMES) {
    test(`${provider}: listed as checked done/verified, the latest run, originals readable, revert puts the file back`, async () => {
      const root = await finishedRun(provider);
      const [entry] = (await listRuns({ workspaceRoot: root })).runs;
      assert.equal(entry?.state, "checked", `${provider} run is not damaged`);
      assert.deepEqual(entry?.state === "checked" ? [entry.status, entry.reason, entry.changes] : null, ["done", "verified", 1]);
      assert.equal(await inspectRun(root, RUN_ID), "checked");
      assert.equal(await latestRunId(root), RUN_ID);

      const originals = await readRunOriginals({ workspaceRoot: root, runId: RUN_ID });
      assert.deepEqual(originals.map((item) => item.original), [{ text: BEFORE }]);

      const preview = await revertRun({ workspaceRoot: root, runId: RUN_ID, dryRun: true });
      assert.deepEqual(preview.reverted, [{ path: "README.md", action: "restored" }]);
      const outcome = await revertRun({ workspaceRoot: root, runId: RUN_ID });
      assert.deepEqual([outcome.reverted.length, outcome.skipped.length], [1, 0]);
      assert.equal(await readFile(join(root, "README.md"), "utf8"), BEFORE);
    });
  }

  test("the providers are the contract's list, so a provider added there is not damaged here", () => {
    assert.ok((MODEL_PROVIDER_NAMES as readonly string[]).includes("openai"), "test assumption: the contract names openai");
  });
});
