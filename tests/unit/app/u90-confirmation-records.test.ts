/**
 * U-90 after U-74 (DR-3): the run journal has two more record types, `confirmation_requested` and
 * `confirmation_answered`, the in-run permission question and its answer. listRunEvents gives them
 * like every other record: checked by number, masked with the values registered now, key shapes
 * hidden, strings cleaned (the question's `subject` is made safe by the engine already, U-106, and
 * goes through the same steps), and a tool name outside the built-in set reads "(unknown tool)" as
 * in tool_decision, for run events too.
 * No file can set an asking rule yet, so the records are written at the next numbers of a finished
 * run's journal. Scripted model, temporary folders, fake values only.
 */

import assert from "node:assert/strict";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { UNKNOWN_TOOL_NAME, createCodarynApp, sanitizeRecord } from "../../../src/app/index.js";
import type { AppCallOutcome, RunEventsPage } from "../../../src/app/index.js";
import type { JournalRecord } from "../../../src/contracts/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";
import { FAKE_SECRET, WRITE_NOTES, appEnvironment, readJournal, runDir, setupRun, taskForm, taskRequest } from "./support.js";

const RLO = String.fromCodePoint(0x202e);
/** Built here so no source holds a key shape (G-10). */
const KEY_SHAPED = ["sk", "ant", "api03", "FAKE".repeat(20)].join("-");

function ok(outcome: AppCallOutcome<RunEventsPage>): RunEventsPage {
  assert.equal(outcome.ok, true, JSON.stringify(outcome).slice(0, 2000));
  return (outcome as { output: RunEventsPage }).output;
}

describe("U-90 after U-74: the permission question and its answer are listed, masked and cleaned", () => {
  test("both records are given; the subject is masked, key shapes hidden, characters cleaned; an unknown tool is named so", async () => {
    const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
    const app = createCodarynApp(await appEnvironment(base));
    const started = await app.startRun(taskRequest(base));
    assert.ok(started.ok, JSON.stringify(started));
    await started.handle.done;
    const runId = started.handle.runId;
    const next = (await readJournal(base, runId)).length + 1;
    const at = new Date().toISOString();
    const question = (seq: number, id: string, tool: string, subject: string) => ({ seq, at, runId, type: "confirmation_requested", id, kind: "permission", callId: "c1", tool, permission: "command", subject, argumentCount: 2 });
    const lines = [
      question(next, "q1", "run_command", `node${RLO} ${FAKE_SECRET} ${KEY_SHAPED}`),
      { seq: next + 1, at, runId, type: "confirmation_answered", id: "q1", decision: "deny", by: "default" },
      question(next + 2, "q2", `made-up${RLO}`, "node"),
    ];
    await appendFile(path.join(runDir(base, runId), "journal.jsonl"), lines.map((line) => `${JSON.stringify(line)}\n`).join(""), "utf8");

    const page = ok(await app.listRunEvents({ settings: taskForm(base), runId, offset: 0, types: ["confirmation_requested", "confirmation_answered"] }));
    assert.deepEqual([page.status, page.missing, page.skipped, page.total], ["complete", 0, 0, 3]);
    assert.deepEqual(page.records.map((record) => [record.seq, record.type]), [
      [next, "confirmation_requested"],
      [next + 1, "confirmation_answered"],
      [next + 2, "confirmation_requested"],
    ]);
    const subject = String(page.records[0]?.["subject"]);
    assert.match(subject, /^node\? /, "the bidirectional character shows as ?");
    for (const hidden of [FAKE_SECRET, KEY_SHAPED, RLO]) assert.equal(JSON.stringify(page).includes(hidden), false);
    assert.deepEqual([page.records[1]?.["decision"], page.records[1]?.["by"]], ["deny", "default"]);
    assert.equal(page.records[2]?.["tool"], UNKNOWN_TOOL_NAME);
  });

  test("a run event of a question names a tool outside the built-in set as (unknown tool) too", () => {
    const record = { seq: 3, at: new Date().toISOString(), runId: "r1", type: "confirmation_requested", id: "q1", kind: "permission", callId: "c1", tool: "made_up", permission: "command", subject: "node", argumentCount: 0 };
    const shown = sanitizeRecord(record as unknown as JournalRecord, createPrivacyGateway({ secrets: [] }));
    assert.equal((shown as unknown as { tool?: unknown } | null)?.tool, UNKNOWN_TOOL_NAME);
  });
});
