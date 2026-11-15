/**
 * Unit U-308 (C-7a's app side): the app's review calls the moved review rules (recordReview,
 * src/app/plan-view.ts) itself, building their request from the CLI parser's arguments, instead of
 * the CLI's runReview. What the person wrote must reach review.json, masked: before, plan-review only
 * held that the registered secret was not there, which a note left out on the way would also pass.
 * Temporary folders, scripted model, fake values only.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { createCodarynApp } from "../../../src/app/index.js";
import { PRIVACY_TOKEN_PATTERN_SOURCE } from "../../../src/contracts/index.js";
import { FAKE_SECRET, WRITE_NOTES, appEnvironment, runDir, setupRun, taskForm, taskRequest } from "./support.js";

test("U-308: a review's note reaches review.json as written, the registered secret in it masked", async () => {
  // A run on the built-in analyze workflow: verified, then awaiting the person's review (GT-D7).
  const base = await setupRun({}, { workflowRef: "analyze" }, [WRITE_NOTES, { text: "done" }]);
  const app = createCodarynApp(await appEnvironment(base));
  const started = await app.startRun(taskRequest(base));
  assert.ok(started.ok);
  const ended = await started.handle.done;
  assert.ok(ended.ok && ended.result.reason === "awaiting_review", JSON.stringify(ended));
  const reviewed = await app.review({ settings: taskForm(base), runId: started.handle.runId, decision: "accept", note: `checked the totals, ${FAKE_SECRET}` });
  assert.ok(reviewed.ok, JSON.stringify(reviewed));
  const stored = JSON.parse(await readFile(path.join(runDir(base, started.handle.runId), "review.json"), "utf8")) as { readonly verdict?: string; readonly note?: string | null };
  assert.equal(stored.verdict, "accepted");
  assert.equal(typeof stored.note, "string", JSON.stringify(stored));
  assert.ok(stored.note!.startsWith("checked the totals, "), stored.note!);
  assert.match(stored.note!, new RegExp(PRIVACY_TOKEN_PATTERN_SOURCE), "the secret masked");
  assert.equal(stored.note!.includes(FAKE_SECRET), false);
});
