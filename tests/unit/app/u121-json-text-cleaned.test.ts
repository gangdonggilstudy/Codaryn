/**
 * Unit U-121 (review R-80b L-1): a tool result's `content` (JSON text of the payload) and a tool
 * call's `argsJson` (JSON text of its arguments) are strings that hold JSON. listRunEvents cleaned
 * the string itself, where control characters are JSON escapes, but an adapter that parses it to
 * show a file's text got the inner strings uncleaned (BEL, ESC, SOH, CR, bidirectional and invisible
 * characters). And a JSON escape can spell a registered value the masking does not see in the
 * escaped text. Now such a string is parsed, every inner string masked with the values registered
 * now, key shapes hidden and cleaned as every other string, and written as JSON again; one that is
 * not JSON stays a cleaned string. A record whose inner strings cannot be masked is left out.
 * Reproduced first (4db1cde, todo until fixed). Scripted model, temporary folders, fake values only.
 */

import assert from "node:assert/strict";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome, RunEventsPage, StoredRunRecord } from "../../../src/app/index.js";
import { FAKE_SECRET, WRITE_NOTES, appEnvironment, readJournal, runDir, setupRun, taskForm, taskRequest } from "./support.js";

const BEL = String.fromCodePoint(0x07);
const ESC = String.fromCodePoint(0x1b);
const SOH = String.fromCodePoint(0x01);
const CR = String.fromCodePoint(0x0d);
const RLO = String.fromCodePoint(0x202e);
const ZWSP = String.fromCodePoint(0x200b);
const BAD = [BEL, ESC, SOH, CR, RLO, ZWSP];
const BACKSLASH = String.fromCharCode(92);

function ok(outcome: AppCallOutcome<RunEventsPage>): RunEventsPage {
  assert.equal(outcome.ok, true, JSON.stringify(outcome).slice(0, 2000));
  return (outcome as { output: RunEventsPage }).output;
}

/** Every string in `value`. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(strings);
  return [];
}

/** The JSON texts of a record: tool results' `content` and tool calls' `argsJson`, at any depth. */
function jsonTexts(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(jsonTexts);
  if (typeof value !== "object" || value === null) return [];
  const own: string[] = [];
  const item = value as Record<string, unknown>;
  if (typeof item["argsJson"] === "string") own.push(item["argsJson"]);
  if (typeof item["callId"] === "string" && typeof item["ok"] === "boolean" && typeof item["content"] === "string") own.push(item["content"]);
  return [...own, ...Object.values(item).flatMap(jsonTexts)];
}

/** The strings inside every JSON text of the records that parses. */
function innerStrings(records: readonly StoredRunRecord[]): string[] {
  return jsonTexts(records).flatMap((text) => {
    try {
      return strings(JSON.parse(text) as unknown);
    } catch {
      return [];
    }
  });
}

describe("U-121 (R-80b L-1): the strings inside a tool result's content and a tool call's argsJson are masked and cleaned", () => {
  test("a file read with control, bidirectional and invisible characters: none inside the JSON texts; LF and TAB stay", async () => {
    const text = `a${BEL}b ${ESC}[31mred ${SOH} ${RLO}rlo ${ZWSP}zw crlf${CR}\nline2\tend\n`;
    const base = await setupRun({ "data.txt": text }, {}, [{ toolCalls: [{ name: "read_file", args: { path: "data.txt" } }] }, WRITE_NOTES, { text: "done" }]);
    const app = createCodarynApp(await appEnvironment(base));
    const started = await app.startRun(taskRequest(base));
    assert.ok(started.ok, JSON.stringify(started));
    await started.handle.done;
    const page = ok(await app.listRunEvents({ settings: taskForm(base), runId: started.handle.runId, offset: 0, limit: 1000 }));
    const inner = innerStrings(page.records);
    assert.ok(inner.some((value) => value.includes("line2\tend")), "the file's text is inside a tool result");
    for (const char of BAD) assert.equal(inner.join("").includes(char), false, `U+${char.codePointAt(0)?.toString(16)} inside a JSON text`);
    assert.ok(inner.some((value) => value.includes("crlf\nline2")), "CR LF is LF inside too");
    assert.equal(page.status, "complete");
  });

  test("a JSON escape that spells a registered value: masked inside, and never in the response", async () => {
    const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
    const app = createCodarynApp(await appEnvironment(base));
    const started = await app.startRun(taskRequest(base));
    assert.ok(started.ok, JSON.stringify(started));
    await started.handle.done;
    const runId = started.handle.runId;
    const next = (await readJournal(base, runId)).length + 1;
    // `"fake-secret-..."` in JSON text is FAKE_SECRET once parsed; the escaped text does not hold it.
    const spelled = `${BACKSLASH}u00${FAKE_SECRET.codePointAt(0)?.toString(16)}${FAKE_SECRET.slice(1)}`;
    const content = `{"text":"${spelled} ${BACKSLASH}u202e x","list":["${BACKSLASH}u0007"]}`;
    assert.equal(content.includes(FAKE_SECRET), false);
    assert.equal((JSON.parse(content) as { text: string }).text.includes(FAKE_SECRET), true, "the JSON text spells it");
    const line = { seq: next, at: new Date().toISOString(), runId, type: "tool_result", result: { callId: "c9", tool: "read_file", ok: true, content, errorCode: null } };
    await appendFile(path.join(runDir(base, runId), "journal.jsonl"), `${JSON.stringify(line)}\n`, "utf8");
    const page = ok(await app.listRunEvents({ settings: taskForm(base), runId, offset: 0, limit: 1000, types: ["tool_result"] }));
    const given = page.records.find((record) => record.seq === next);
    assert.ok(given !== undefined, "the record is given");
    const parsed = JSON.parse(String((given["result"] as { content?: unknown }).content)) as { text: string; list: string[] };
    assert.equal(parsed.text.includes(FAKE_SECRET), false, "masked inside");
    assert.equal(JSON.stringify(page).includes(FAKE_SECRET.slice(1)), false, "nor spelled in the response");
    assert.deepEqual([parsed.text.includes(RLO), parsed.list], [false, ["?"]]);
  });

  test("a content that is no JSON stays a cleaned string", async () => {
    const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
    const app = createCodarynApp(await appEnvironment(base));
    const started = await app.startRun(taskRequest(base));
    assert.ok(started.ok);
    await started.handle.done;
    const runId = started.handle.runId;
    const next = (await readJournal(base, runId)).length + 1;
    const content = `error (not_found): no such file ${RLO}x`;
    const line = { seq: next, at: new Date().toISOString(), runId, type: "tool_result", result: { callId: "c9", tool: "read_file", ok: false, content, errorCode: "not_found" } };
    await appendFile(path.join(runDir(base, runId), "journal.jsonl"), `${JSON.stringify(line)}\n`, "utf8");
    const page = ok(await app.listRunEvents({ settings: taskForm(base), runId, offset: 0, limit: 1000, types: ["tool_result"] }));
    const given = page.records.find((record) => record.seq === next);
    assert.equal((given?.["result"] as { content?: unknown } | undefined)?.content, "error (not_found): no such file ?x");
  });
});
