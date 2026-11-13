/**
 * Unit U-250 (the CLI migration plan's P-2, R-80 I-1): the app's run events name the task-type tools.
 * A run event repeats model-given tool names (a decision, a permission question, a tool result, the
 * calls of a model response, the messages of a model request); limitToolNames (src/app/events.ts)
 * kept only the four built-in names (TOOL_NAMES), so inspect_files, propose_plan, propose_changes and
 * query_table read "(unknown tool)" in the GUI although the run offered and called them (the CLI's
 * progress lines name them, through ALL_TOOL_NAMES). Now the limit is every tool a run can be offered
 * (ALL_TOOL_NAMES). A name in no tool list still reads "(unknown tool)" and nothing else changes: the
 * strings are masked as before, so a name that carries a secret shows neither the secret nor itself.
 * The same function shapes the run events page of a past run (listRunEvents).
 * Reproduced first (todo until the limit knew the task-type tools). Scripted model, temporary folders,
 * fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { UNKNOWN_TOOL_NAME, createCodarynApp, sanitizeRecord } from "../../../src/app/index.js";
import type { AppCallOutcome, RunEvent, RunHandle } from "../../../src/app/index.js";
import { WORKFLOW_TOOL_NAMES } from "../../../src/contracts/index.js";
import type { JournalRecord } from "../../../src/contracts/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";
import { PLAN_TASK, appEnvironment, setupRun, taskForm, taskRequest } from "./support.js";

const TODO = { todo: "U-250 (P-2): the events' tool name limit is every tool a run can be offered" };
const FAKE_SECRET = "fake-u250-SECRET-value";
const at = new Date().toISOString();

/** Every record kind that repeats a tool name, each naming `name`. */
function recordsNaming(name: string): JournalRecord[] {
  const call = { id: "c1", name, args: {} };
  const result = { callId: "c1", tool: name, ok: true, content: "fine" };
  const records = [
    { seq: 1, at, runId: "r1", type: "tool_decision", callId: "c1", tool: name, allowed: true },
    { seq: 2, at, runId: "r1", type: "confirmation_requested", id: "q1", kind: "permission", callId: "c1", tool: name, permission: "command", subject: "node", argumentCount: 0 },
    { seq: 3, at, runId: "r1", type: "tool_result", result },
    { seq: 4, at, runId: "r1", type: "model_response", toolCalls: [call] },
    { seq: 5, at, runId: "r1", type: "model_request", newMessages: [{ role: "assistant", text: "", toolCalls: [call] }, { role: "tool", results: [result] }] },
  ];
  return records as unknown as JournalRecord[];
}

/** Every tool name a shown record repeats, in record order. */
function namesIn(record: JournalRecord | null): string[] {
  const shown = record as unknown as Record<string, unknown> | null;
  if (shown === null) return ["(not shown)"];
  switch (shown["type"]) {
    case "tool_decision":
    case "confirmation_requested":
      return [String(shown["tool"])];
    case "tool_result":
      return [String((shown["result"] as { tool: string }).tool)];
    case "model_response":
      return (shown["toolCalls"] as { name: string }[]).map((item) => item.name);
    case "model_request":
      return (shown["newMessages"] as { role: string; toolCalls?: { name: string }[]; results?: { tool: string }[] }[]).flatMap((item) =>
        item.role === "assistant" ? (item.toolCalls ?? []).map((call) => call.name) : (item.results ?? []).map((one) => one.tool),
      );
    default:
      return [];
  }
}

const privacy = createPrivacyGateway({ secrets: [FAKE_SECRET] });

describe("U-250 (P-2): the tool names a run event repeats", () => {
  for (const name of WORKFLOW_TOOL_NAMES) {
    test(`${name} is named in every record kind that repeats a tool name`, TODO, () => {
      for (const record of recordsNaming(name)) {
        const shown = sanitizeRecord(record, privacy);
        assert.ok(namesIn(shown).length > 0, record.type);
        assert.ok(namesIn(shown).every((shownName) => shownName === name), `${record.type}: ${JSON.stringify(namesIn(shown))}`);
      }
    });
  }

  test("a built-in name as before; a name in no tool list, or one that carries a secret, reads (unknown tool) and shows no secret", () => {
    for (const record of recordsNaming("read_file")) assert.deepEqual(new Set(namesIn(sanitizeRecord(record, privacy))), new Set(["read_file"]), record.type);
    for (const name of ["made_up", `tool_${FAKE_SECRET}`, "Inspect_Files", "inspect_files "]) {
      for (const record of recordsNaming(name)) {
        const shown = sanitizeRecord(record, privacy);
        assert.deepEqual(new Set(namesIn(shown)), new Set([UNKNOWN_TOOL_NAME]), `${name} in ${record.type}`);
        assert.equal(JSON.stringify(shown).includes(FAKE_SECRET), false, `${name} in ${record.type}`);
      }
    }
  });
});

describe("U-250 (P-2): through the app", () => {
  async function organizeRun(): Promise<{ base: string; runId: string; events: RunEvent[] }> {
    const steps = [
      { toolCalls: [{ name: "inspect_files", args: { path: "." } }] },
      { toolCalls: [{ name: "propose_plan", args: { summary: "sort", actions: [{ kind: "move", from: "a.txt", to: "sorted/a.txt" }] } }] },
    ];
    const base = await setupRun({ "a.txt": "alpha\n" }, PLAN_TASK, steps);
    const events: RunEvent[] = [];
    const app = createCodarynApp(await appEnvironment(base));
    const started = await app.startRun(taskRequest(base), { onEvent: (event) => events.push(event) });
    assert.ok(started.ok, JSON.stringify(started));
    const handle = (started as { handle: RunHandle }).handle;
    assert.ok((await handle.done).ok);
    return { base, runId: handle.runId, events };
  }
  const decisionTools = (records: readonly Record<string, unknown>[]): unknown[] => records.filter((record) => record["type"] === "tool_decision").map((record) => record["tool"]);

  test("an organize run's events name inspect_files and propose_plan", TODO, async () => {
    const run = await organizeRun();
    const records = run.events.flatMap((event) => (event.kind === "record" ? [event.record as unknown as Record<string, unknown>] : []));
    assert.deepEqual(decisionTools(records), ["inspect_files", "propose_plan"]);
    const responses = records.filter((record) => record["type"] === "model_response").flatMap((record) => (record["toolCalls"] as { name: string }[]).map((call) => call.name));
    assert.deepEqual(responses, ["inspect_files", "propose_plan"]);
  });

  test("the run events page of that run names them too", TODO, async () => {
    const run = await organizeRun();
    const app = createCodarynApp(await appEnvironment(run.base));
    const page = (await app.listRunEvents({ settings: taskForm(run.base), runId: run.runId, offset: 0, types: ["tool_decision"] })) as AppCallOutcome<{ records: Record<string, unknown>[] }>;
    assert.ok(page.ok, JSON.stringify(page));
    assert.deepEqual(decisionTools((page as { output: { records: Record<string, unknown>[] } }).output.records), ["inspect_files", "propose_plan"]);
  });
});
