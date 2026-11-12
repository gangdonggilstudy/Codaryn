/**
 * R-11 (guess for `changes`, PM order): a run registers a secret; `changes` is then called with a
 * task form that registers other secrets. The run's original and the current file hold the
 * secret's value, so masking them only with the secrets registered now would show it in plain text.
 * Fix by the DR-28 principle: the text is shown only when the secrets now mask it as the run did;
 * otherwise only the paths and states are given (AC-D13). Since DR-29 the writing tool records how
 * the run masked each file's text, so the run's own task form shows the masked texts and other
 * secrets show none for a file whose visible text would differ (dr29-changes.test.ts has the other
 * cases). Fake values only.
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
  test("reproduction: a task form without the run's secret shows no text for the file that holds it", async () => {
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
        // NOTES.md holds no secret: either set of secrets leaves the same text visible.
        ["NOTES.md", true, "as_run_left", null, "# Notes\n", null],
      ],
    );
  });

  test("with the run's own task form the masked texts are shown (the run recorded its masking, DR-29)", async () => {
    const { base, runId } = await changedRun();
    const app = createCodarynApp(await appEnvironment(base));
    const view = ok(await app.changes({ settings: taskForm(base), runId }));
    assert.equal(JSON.stringify(view).includes(FAKE_SECRET), false, "only masked text leaves the app layer");
    const [readme, notes] = view.files;
    assert.deepEqual([readme?.path, readme?.unavailable, notes?.path, notes?.before, notes?.after, notes?.unavailable], ["README.md", null, "NOTES.md", null, "# Notes\n", null]);
    assert.match(readme?.before ?? "", /^# Title\nkey \[\[CODARYN_SECRET:[0-9a-f]+\]\]\n$/);
    assert.match(readme?.after ?? "", /^# Title\n\nadded line\nkey \[\[CODARYN_SECRET:[0-9a-f]+\]\]\n$/);
  });
});
