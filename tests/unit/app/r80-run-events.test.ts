/**
 * Review R-80 of U-90 (`listRunEvents`), PM's decisions:
 * - M-1: one record left out (a broken line, a deleted line, a line filtered for a field name the
 *   registered values mask) dropped every real record after it while `status` said "complete", and
 *   a well-formed forged line pushed the real one of its number out.
 *   (a) a real line at its place (the expected `seq`) that is filtered still counts, so the records
 *       after it follow; (b) a larger `seq` than expected: taken up from there, the numbers between
 *       counted as missing; (c) a broken line, a missing number or a number given twice is never
 *       "complete" but "damaged", with the records taken and the count missing; a number given twice
 *       gives neither line and counts as missing. A journal `report` refuses (invalid_run_record) is
 *       never "complete" here.
 * - L-1: every string is cleaned in the app layer (control, bidirectional and invisible characters
 *   shown as "?", line feeds and tabs kept, CR LF as LF), the values of unknown fields too.
 * Reproduced first (200f4ba, todo until fixed). Scripted model, temporary folders, fake values only.
 */

import assert from "node:assert/strict";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome, CodarynApp, RunEventsPage } from "../../../src/app/index.js";
import { SECRET_ENV, WRITE_NOTES, appEnvironment, runDir, setupRun, taskForm, taskRequest } from "./support.js";

type Page = RunEventsPage;

function ok(outcome: AppCallOutcome<RunEventsPage>): Page {
  assert.equal(outcome.ok, true, JSON.stringify(outcome).slice(0, 2000));
  return (outcome as { output: RunEventsPage }).output as Page;
}

/** A finished run through the app (scripted model). */
async function finishedRun(steps: readonly unknown[] = [WRITE_NOTES, { text: "done" }]): Promise<{ base: string; app: CodarynApp; runId: string; journal: string }> {
  const base = await setupRun({}, {}, steps);
  const app = createCodarynApp(await appEnvironment(base));
  const started = await app.startRun(taskRequest(base));
  assert.ok(started.ok, JSON.stringify(started));
  await started.handle.done;
  return { base, app, runId: started.handle.runId, journal: path.join(runDir(base, started.handle.runId), "journal.jsonl") };
}

async function lines(file: string): Promise<string[]> {
  return (await readFile(file, "utf8")).split("\n").filter((line) => line.length > 0);
}

async function rewrite(file: string, all: readonly string[]): Promise<void> {
  await writeFile(file, all.map((line) => `${line}\n`).join(""), "utf8");
}

const seqs = (page: Page): number[] => page.records.map((record) => record.seq);
const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, index) => from + index);

async function list(run: { base: string; app: CodarynApp; runId: string }, app: CodarynApp = run.app): Promise<Page> {
  return ok(await app.listRunEvents({ settings: taskForm(run.base), runId: run.runId, offset: 0, limit: 1000 }));
}

async function reportCode(run: { base: string; app: CodarynApp; runId: string }): Promise<string> {
  const outcome = await run.app.report({ workspace: path.join(run.base, "work"), runId: run.runId });
  return outcome.ok ? "ok" : outcome.error.code;
}

describe("R-80 M-1: a record left out does not take the records after it, and damage is told", () => {
  test("seq 2 broken: the records after it are given; damaged, one missing (report refuses it too)", async () => {
    const run = await finishedRun();
    const all = await lines(run.journal);
    await rewrite(run.journal, [all[0] as string, "{ broken", ...all.slice(2)]);
    const page = await list(run);
    assert.deepEqual([page.status, page.missing, seqs(page)], ["damaged", 1, [1, ...range(3, all.length)]]);
    assert.equal(await reportCode(run), "invalid_run_record");
  });

  test("seq 2 deleted: the records after it are given; damaged, one missing", async () => {
    const run = await finishedRun();
    const all = await lines(run.journal);
    await rewrite(run.journal, [all[0] as string, ...all.slice(2)]);
    const page = await list(run);
    assert.deepEqual([page.status, page.missing, page.skipped, seqs(page)], ["damaged", 1, 0, [1, ...range(3, all.length)]]);
    assert.equal(await reportCode(run), "invalid_run_record");
  });

  test("a forged line with the number of a real one: neither is given, the number is missing; damaged", async () => {
    const run = await finishedRun();
    const all = await lines(run.journal);
    const real = JSON.parse(all[2] as string) as { seq: number; at: string };
    const forged = JSON.stringify({ seq: real.seq, at: real.at, runId: run.runId, type: "model_error", turn: 1, kind: "server", message: "forged-record-text" });
    await rewrite(run.journal, [...all.slice(0, 2), forged, ...all.slice(2)]);
    const page = await list(run);
    assert.deepEqual([page.status, page.missing, seqs(page)], ["damaged", 1, [1, 2, ...range(4, all.length)]]);
    assert.equal(JSON.stringify(page).includes("forged-record-text"), false, "neither line of number 3 is chosen");
    assert.equal(await reportCode(run), "invalid_run_record");
  });

  test("a line at its place whose fields report refuses: damaged, as report refuses the journal", async () => {
    const run = await finishedRun();
    const all = await lines(run.journal);
    const usage = { modelTurns: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, durationMs: 0 };
    await appendFile(run.journal, `${JSON.stringify({ seq: all.length + 1, at: new Date().toISOString(), runId: run.runId, type: "run_finished", status: "nonsense", reason: "nonsense", usage })}
`, "utf8");
    const page = await list(run);
    assert.deepEqual([page.status, page.missing], ["damaged", 0]);
    assert.equal(await reportCode(run), "invalid_run_record");
  });

  test("a real line filtered for a field name (bad key) still counts: the records after it follow; complete", async () => {
    const run = await finishedRun();
    const all = await lines(run.journal);
    const fifth = { ...(JSON.parse(all[4] as string) as Record<string, unknown>), "bad key": 1 };
    await rewrite(run.journal, [...all.slice(0, 4), JSON.stringify(fifth), ...all.slice(5)]);
    const page = await list(run);
    assert.deepEqual([page.status, page.missing, page.skipped, seqs(page)], ["complete", 0, 1, [...range(1, 4), ...range(6, all.length)]]);
    assert.equal(await reportCode(run), "ok", "report takes this journal");
  });

  test("registered values equal to field names (text, turn): those records are left out, the rest follow", async () => {
    const run = await finishedRun();
    const all = await lines(run.journal);
    for (const value of ["text", "turn"]) {
      const app = createCodarynApp(await appEnvironment(run.base, { env: { [SECRET_ENV]: value } }));
      const page = await list(run, app);
      const holding = all.map((line) => JSON.parse(line) as unknown).filter((record) => hasFieldNamed(record, value));
      assert.ok(holding.length > 0, `some records have a field named ${value}`);
      assert.deepEqual([page.status, page.missing, page.skipped, page.total], ["complete", 0, holding.length, all.length - holding.length], value);
      assert.equal(page.records.at(-1)?.type, "run_finished", `${value}: the last record is still given`);
    }
  });
});

/** Whether `value` holds, at any level, a field whose name holds `name` (the masking finds it there). */
function hasFieldNamed(value: unknown, name: string): boolean {
  if (Array.isArray(value)) return value.some((item) => hasFieldNamed(item, name));
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(([key, child]) => key.includes(name) || hasFieldNamed(child, name));
}

const BEL = String.fromCodePoint(0x07);
const ESC = String.fromCodePoint(0x1b);
const SOH = String.fromCodePoint(0x01);
const RLO = String.fromCodePoint(0x202e);
const ZWSP = String.fromCodePoint(0x200b);
const CR = String.fromCodePoint(0x0d);

/** Every string in `value`. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(strings);
  return [];
}

describe("R-80 L-1: strings are cleaned in the app layer, unknown fields too", () => {
  test("control, bidirectional and invisible characters show as ?; line feeds and tabs stay; CR LF is LF", async () => {
    const text = `done ${BEL} ${ESC}[31mred ${SOH} ${RLO}abc ${ZWSP}x${CR}\nline2\tz`;
    const run = await finishedRun([WRITE_NOTES, { text }]);
    const all = await lines(run.journal);
    const next = all.length + 1;
    await appendFile(run.journal, `${JSON.stringify({ seq: next, at: new Date().toISOString(), runId: run.runId, type: "model_error", turn: 9, kind: "server", message: "m", call: { name: `x${RLO}y` } })}\n`, "utf8");
    const page = await list(run);
    const found = strings(page.records).join("");
    for (const char of [BEL, ESC, SOH, RLO, ZWSP, CR]) assert.equal(found.includes(char), false, `U+${char.codePointAt(0)?.toString(16)}`);
    const response = page.records.find((record) => record.type === "model_response" && String(record["text"]).startsWith("done"));
    assert.equal(response?.["text"], "done ? ?[31mred ? ?abc ?x\nline2\tz");
    assert.deepEqual((page.records.at(-1)?.["call"] as { name?: unknown } | undefined)?.name, "x?y");
  });
});
