/**
 * R-11 (guess for `changes`, PM order): a run registers a secret; `changes` is then called with a
 * task form that registers other secrets. The run's original and the current file hold the
 * secret's value, so masking them only with the secrets registered now shows it in plain text.
 * Fix by the DR-28 principle: the text is shown only when the secrets now mask it as the run did;
 * otherwise only the paths and states are given (AC-D13). The run keeps no record of how it masked
 * a file's text yet, so no text can be shown until it does. Fake values only.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome, ChangesOutput } from "../../../src/app/index.js";
import { FAKE_SECRET, WRITE_NOTES, appEnvironment, setupRun, taskForm, taskRequest } from "./support.js";

const ORIGINAL = `# Title\nkey ${FAKE_SECRET}\n`;
const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

function ok(outcome: AppCallOutcome<ChangesOutput>): ChangesOutput {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: ChangesOutput }).output;
}

/** A run that registered the secret and changed README.md (which holds it) and created NOTES.md. */
async function changedRun(): Promise<{ base: string; runId: string }> {
  const base = await setupRun({ "README.md": ORIGINAL }, {}, [
    {
      toolCalls: [
        { name: "write_file", args: { path: "README.md", expectedHash: sha256(ORIGINAL), change: { kind: "replace_text", oldText: "# Title\n", newText: "# Title\n\nadded line\n" } } },
      ],
    },
    WRITE_NOTES,
    { text: "done" },
  ]);
  const app = createCodarynApp(await appEnvironment(base));
  const started = await app.startRun(taskRequest(base));
  assert.ok(started.ok);
  const ended = await started.handle.done;
  assert.ok(ended.ok && ended.result.status === "done", JSON.stringify(ended));
  return { base, runId: started.handle.runId };
}

describe("R-11: changes with other secrets than the run", () => {
  test("reproduction: a task form without the run's secret shows no text, only the paths and states", async () => {
    const { base, runId } = await changedRun();
    const task = JSON.parse(await readFile(path.join(base, "task.json"), "utf8")) as Record<string, unknown>;
    await writeFile(path.join(base, "other.json"), JSON.stringify({ ...task, privacy: { secretEnv: [] } }), "utf8");
    const other = createCodarynApp(await appEnvironment(base, { env: {} }));
    const view = ok(await other.changes({ settings: taskForm(base, { input: { kind: "task", taskPath: path.join(base, "other.json") } }), runId }));

    assert.equal(JSON.stringify(view).includes(FAKE_SECRET), false, "no plain text of the run's secret");
    assert.deepEqual(
      view.files.map((file) => [file.path, file.created, file.state, file.before, file.after, file.unavailable]),
      [
        ["README.md", false, "as_run_left", null, null, "masking_unverified"],
        ["NOTES.md", true, "as_run_left", null, null, "masking_unverified"],
      ],
    );
  });

  test("with the run's own task form the text is not shown either while the run keeps no record of its masking", async () => {
    const { base, runId } = await changedRun();
    const app = createCodarynApp(await appEnvironment(base));
    const view = ok(await app.changes({ settings: taskForm(base), runId }));
    assert.deepEqual(
      view.files.map((file) => [file.path, file.before, file.after, file.unavailable]),
      [
        ["README.md", null, null, "masking_unverified"],
        ["NOTES.md", null, null, "masking_unverified"],
      ],
    );
  });
});
