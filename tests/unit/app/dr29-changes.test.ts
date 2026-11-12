/**
 * DR-29, DR-32 (c): the changes view shows a changed file's masked texts only when the secrets
 * registered now mask them as the run did (changeShownMatches with digests computed the same way:
 * SHA-256 of maskedPartsEncoding(maskedParts(text masked now))). Otherwise, and for runs without a
 * record, only paths and states. Reproductions first:
 * - the run's own secrets → the masked texts
 * - other secrets than the run's → no text
 * - the file changed after the run → no text
 * The writing tool does not record the digests yet (tool owner), so these tests write the record as
 * the tool will: the store's `shown-<n>.json` next to the snapshot, digests made with the run's
 * gateway. Fake values only.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { maskedParts, maskedPartsEncoding } from "../../../src/contracts/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome, ChangesOutput } from "../../../src/app/index.js";
import { FAKE_SECRET, WRITE_NOTES, appEnvironment, runDir, setupRun, taskForm, taskRequest } from "./support.js";

const ORIGINAL = `# Title\nkey ${FAKE_SECRET}\n`;
const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

function ok(outcome: AppCallOutcome<ChangesOutput>): ChangesOutput {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: ChangesOutput }).output;
}

/** A run that registered FAKE_SECRET, changed README.md (which holds it) and created NOTES.md. */
async function changedRun(): Promise<{ base: string; runId: string }> {
  const base = await setupRun({ "README.md": ORIGINAL }, {}, [
    { toolCalls: [{ name: "write_file", args: { path: "README.md", expectedHash: sha256(ORIGINAL), change: { kind: "replace_text", oldText: "# Title\n", newText: "# Title\n\nadded line\n" } } }] },
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

/**
 * Writes the record the writing tool will write (DR-29): for each snapshot index entry, the digest
 * of the original and of the text the run left, both masked with the run's secrets.
 */
async function recordShown(base: string, runId: string, runSecrets: readonly string[]): Promise<void> {
  const gateway = createPrivacyGateway({ secrets: runSecrets });
  const digest = (text: string): string => {
    const masked = gateway.mask(text);
    assert.ok(masked.ok);
    return sha256(maskedPartsEncoding(maskedParts(masked.text)));
  };
  const snapshots = path.join(runDir(base, runId), "snapshots");
  const index = JSON.parse(await readFile(path.join(snapshots, "index.json"), "utf8")) as { entries: { path: string; existed: boolean; file?: string }[] };
  for (const [position, entry] of index.entries.entries()) {
    const original = entry.existed && entry.file !== undefined ? await readFile(path.join(snapshots, entry.file), "utf8") : null;
    const left = await readFile(path.join(base, "work", entry.path), "utf8");
    const record = {
      schemaVersion: 2,
      path: entry.path,
      original: original === null ? null : digest(original),
      next: { sha256: sha256(left), partsDigest: digest(left) },
    };
    await writeFile(path.join(snapshots, `shown-${position}.json`), `${JSON.stringify(record)}\n`, "utf8");
  }
}

const view = (output: ChangesOutput) => output.files.map((file) => [file.path, file.state, file.before, file.after, file.unavailable]);

describe("DR-29: the changes view with the run's record", () => {
  test("the run's own secrets: the texts masked now are shown", async () => {
    const { base, runId } = await changedRun();
    await recordShown(base, runId, [FAKE_SECRET]);
    const app = createCodarynApp(await appEnvironment(base));
    const output = ok(await app.changes({ settings: taskForm(base), runId }));
    assert.equal(JSON.stringify(output).includes(FAKE_SECRET), false, "only masked text leaves the app layer");
    const [readme, notes] = output.files;
    assert.deepEqual([readme?.path, readme?.state, readme?.unavailable], ["README.md", "as_run_left", null]);
    assert.ok(readme?.before?.startsWith("# Title\nkey ") === true && readme.before.includes("CODARYN_SECRET"), readme?.before ?? "");
    assert.ok(readme?.after?.includes("added line") === true);
    assert.deepEqual([notes?.path, notes?.created, notes?.before, notes?.after, notes?.unavailable], ["NOTES.md", true, null, "# Notes\n", null]);
  });

  test("other secrets than the run's: no text, only paths and states", async () => {
    const { base, runId } = await changedRun();
    await recordShown(base, runId, [FAKE_SECRET]);
    const task = JSON.parse(await readFile(path.join(base, "task.json"), "utf8")) as Record<string, unknown>;
    await writeFile(path.join(base, "other.json"), JSON.stringify({ ...task, privacy: { secretEnv: [] } }), "utf8");
    const other = createCodarynApp(await appEnvironment(base, { env: {} }));
    const output = ok(await other.changes({ settings: taskForm(base, { input: { kind: "task", taskPath: path.join(base, "other.json") } }), runId }));
    assert.equal(JSON.stringify(output).includes(FAKE_SECRET), false);
    const [readme, notes] = view(output);
    assert.deepEqual(readme, ["README.md", "as_run_left", null, null, "masking_unverified"]);
    // NOTES.md holds no secret, so its visible text is the same with either set of secrets.
    assert.deepEqual(notes, ["NOTES.md", "as_run_left", null, "# Notes\n", null]);
  });

  test("the file changed after the run: no text for it", async () => {
    const { base, runId } = await changedRun();
    await recordShown(base, runId, [FAKE_SECRET]);
    await writeFile(path.join(base, "work", "README.md"), `# Title\nkey ${FAKE_SECRET}\nedited later\n`, "utf8");
    const app = createCodarynApp(await appEnvironment(base));
    const [readme] = view(ok(await app.changes({ settings: taskForm(base), runId })));
    assert.deepEqual(readme, ["README.md", "changed_since_run", null, null, "masking_unverified"]);
  });

  test("a run without the record (from before DR-29) and a record that does not match give no text", async () => {
    const { base, runId } = await changedRun();
    const app = createCodarynApp(await appEnvironment(base));
    assert.deepEqual(
      view(ok(await app.changes({ settings: taskForm(base), runId }))).map((row) => row[4]),
      ["masking_unverified", "masking_unverified"],
      "no record",
    );
    await recordShown(base, runId, [FAKE_SECRET, "fake-other-secret-0099"]);
    const shown = path.join(runDir(base, runId), "snapshots", "shown-0.json");
    const record = JSON.parse(await readFile(shown, "utf8")) as { original: string };
    await writeFile(shown, JSON.stringify({ ...record, original: "0".repeat(64) }), "utf8");
    const [readme] = view(ok(await app.changes({ settings: taskForm(base), runId })));
    assert.deepEqual(readme, ["README.md", "as_run_left", null, null, "masking_unverified"], "a wrong digest");
  });
});
