/**
 * Unit U-90 (gap survey, GUI 3.7 "records" tab; PM: implement the draft): the app layer lists one
 * run's stored records for an adapter, `listRunEvents`.
 * - The settings are a task form: the workspace and the values registered now, which mask the
 *   records again (as `changes`, U-17). The run is judged first as the run list judges it.
 * - The journal is read after the run, and commands allowed during a run can append lines to it
 *   (R-4 H-1): a line is given only when it is a JSON object of this run, with the next `seq`, a
 *   real `at` and a record type of the run's kind; anything else is counted in `skipped`. Every
 *   record is masked again (tool names limited, every string through the current gateway and the
 *   key values set now); a record that cannot be masked, or that holds a field name the masking
 *   would change, is skipped too.
 * - Pages of at most 1,000 records (200 by default), cut before 2 MiB of JSON (a larger record
 *   comes alone); a type filter.
 * - Reads only: no lock, no records.
 * Reproduced first (11dcbbf, todo until the app layer gave it). Scripted model, temporary folders,
 * fake values only.
 */

import assert from "node:assert/strict";
import { appendFile, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { RECORDS_CHANGED_FILE_NAME } from "../../../src/contracts/index.js";
import { MAX_RUN_EVENTS_PAGE_BYTES, createCodarynApp, listRunEventsIn } from "../../../src/app/index.js";
import type { AppCallOutcome, ApplyEvent, CodarynApp, ListRunEventsRequest, RunEvent, RunEventsPage, TaskForm } from "../../../src/app/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";
import { isRunTimestamp } from "../../../src/store/index.js";
import { FAKE_SECRET, SECRET_ENV, WRITE_NOTES, appEnvironment, exists, plannedRun, readJournal, runDir, setupRun, taskForm, taskRequest } from "./support.js";

type Page = RunEventsPage;
type Request = { readonly settings: TaskForm; readonly runId: string; readonly offset: number; readonly limit?: number; readonly types?: readonly string[] };

/** Not registered by the run; registered by a later reading in one test. */
const OTHER_SECRET = "other-fake-APP-VALUE-0099";
const NO_RUN = "20200101T000000Z-00000000";
/** A key-shaped text, built here so no source holds one (G-10). */
const KEY_SHAPED = ["sk", "ant", "api03", "FAKE".repeat(20)].join("-");

/** The app's listRunEvents, called as an adapter calls it; a test may hand it what an adapter must not. */
const list = (app: CodarynApp) => (request: Request) => app.listRunEvents(request as ListRunEventsRequest);

function ok(outcome: AppCallOutcome<Page>): Page {
  assert.equal(outcome.ok, true, JSON.stringify(outcome).slice(0, 2000));
  return (outcome as { output: Page }).output;
}

function code(outcome: AppCallOutcome<Page>): string {
  return outcome.ok ? "ok" : outcome.error.code;
}

/** A record as JSON gives it, without `at` (the stored line and the event read the clock apart). */
function withoutAt(record: object): Record<string, unknown> {
  const { at: _at, ...rest } = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
  return rest;
}

/** A finished run through the app (scripted model), with the records its events delivered. */
async function finishedRun(steps: readonly unknown[] = [WRITE_NOTES, { text: "done" }]): Promise<{ base: string; app: CodarynApp; runId: string; events: object[] }> {
  const base = await setupRun({}, {}, steps);
  const app = createCodarynApp(await appEnvironment(base));
  const events: RunEvent[] = [];
  const started = await app.startRun(taskRequest(base), { onEvent: (event) => events.push(event) });
  assert.ok(started.ok, JSON.stringify(started));
  const ended = await started.handle.done;
  assert.ok(ended.ok, JSON.stringify(ended));
  return { base, app, runId: started.handle.runId, events: events.flatMap((event) => (event.kind === "record" ? [event.record] : [])) };
}

function journalFile(base: string, runId: string): string {
  return path.join(runDir(base, runId), "journal.jsonl");
}

async function append(base: string, runId: string, lines: readonly unknown[], tail = ""): Promise<void> {
  const text = lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n");
  await appendFile(journalFile(base, runId), `${text}\n${tail}`, "utf8");
}

function modelError(runId: string, seq: number, message: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { seq, at: new Date().toISOString(), runId, type: "model_error", turn: 9, kind: "server", message, ...extra };
}

describe("U-90: listRunEvents gives a run's stored records, checked line by line and masked again", () => {
  test("a finished run: its records are the events it delivered (but `at`), under their numbers", async () => {
    const run = await finishedRun();
    const page = ok(await list(run.app)({ settings: taskForm(run.base), runId: run.runId, offset: 0 }));
    assert.deepEqual(
      [page.kind, page.runId, page.runKind, page.status, page.masking, page.skipped, page.offset, page.nextOffset, page.recordsChanged],
      ["run_events", run.runId, "run", "complete", "current_secrets", 0, 0, null, undefined],
    );
    assert.ok(run.events.length >= 4, "the run delivered its records");
    assert.deepEqual(page.records.map(withoutAt), run.events.map(withoutAt));
    assert.equal(page.total, page.records.length);
    assert.ok(page.records.every((record) => isRunTimestamp(record.at)), "every record has its stored time");
  });

  test("lines that are not this run's are left out and the journal is damaged; a line at its place counts, given or not", async () => {
    const run = await finishedRun();
    const last = (await readJournal(run.base, run.runId)).length;
    const next = last + 1;
    await append(
      run.base,
      run.runId,
      [
        // Not lines of this run (R-80 M-1: each damages the journal).
        "not json",
        [1, 2],
        modelError(NO_RUN, next, "another run"),
        modelError(run.runId, 0, "no number from 1"),
        // Lines at their places that are not given: their numbers count, so the lines after follow.
        { ...modelError(run.runId, next, "no real time"), at: "yesterday" },
        { ...modelError(run.runId, next + 1, "unknown type"), type: "made_up" },
        { ...modelError(run.runId, next + 2, "an apply record in a run"), type: "plan_item_failed", index: 0, problem: "source_missing" },
        modelError(run.runId, next + 3, "a field named after the secret", { [FAKE_SECRET]: 1 }),
        // Given, masked.
        modelError(run.runId, next + 4, `leak ${FAKE_SECRET}`),
        modelError(run.runId, next + 5, `key ${KEY_SHAPED}`),
      ],
      "{\"seq\":",
    );
    const page = ok(await list(run.app)({ settings: taskForm(run.base), runId: run.runId, offset: 0 }));
    assert.deepEqual([page.status, page.missing], ["damaged", 0]);
    assert.equal(page.skipped, 9, "four lines not this run's, four at their places not given, the unfinished tail of a finished run");
    assert.equal(page.total, last + 2);
    const given = page.records.at(-2);
    assert.deepEqual([given?.seq, given?.type], [next + 4, "model_error"]);
    assert.match(String(given?.["message"]), /^leak /);
    assert.equal(JSON.stringify(page).includes(FAKE_SECRET), false, "the registered value is masked, in values and field names");
    assert.deepEqual([page.records.at(-1)?.seq, JSON.stringify(page).includes(KEY_SHAPED)], [next + 5, false], "a key shape is hidden");
  });

  test("the values registered now mask the records, whatever the run registered", async () => {
    const run = await finishedRun([WRITE_NOTES, { text: `done ${OTHER_SECRET}` }]);
    const before = ok(await list(run.app)({ settings: taskForm(run.base), runId: run.runId, offset: 0 }));
    assert.equal(JSON.stringify(before).includes(OTHER_SECRET), true, "the run did not register it");
    const later = createCodarynApp(await appEnvironment(run.base, { env: { [SECRET_ENV]: OTHER_SECRET } }));
    const now = ok(await list(later)({ settings: taskForm(run.base), runId: run.runId, offset: 0 }));
    assert.equal(JSON.stringify(now).includes(OTHER_SECRET), false);
    assert.equal(now.total, before.total);
  });

  test("an apply run: its records as its events gave them, start records left out, numbers kept", async () => {
    const { base, app, plan, digest } = await plannedRun();
    const events: ApplyEvent[] = [];
    const started = await app.applyPlan(
      { settings: taskForm(base), planRunId: plan.runId, digest: digest.slice(0, 12), cancelFile: null, unsafeMoveConsent: null },
      { onEvent: (event) => events.push(event) },
    );
    assert.ok(started.ok, JSON.stringify(started));
    await started.handle.done;
    const page = ok(await list(app)({ settings: taskForm(base), runId: started.handle.runId, offset: 0 }));
    assert.deepEqual([page.runKind, page.status, page.skipped], ["apply", "complete", 0]);
    const delivered = events.flatMap((event) => (event.kind === "record" ? [event.record] : []));
    assert.deepEqual(page.records.map(withoutAt), delivered.map(withoutAt));
    assert.equal(page.records.some((record) => (record.type as string) === "plan_item_started"), false);
    assert.ok((await readFile(journalFile(base, started.handle.runId), "utf8")).includes("plan_item_started"), "it is stored");
  });

  test("a records-changed mark: recordsChanged, and the records are still given", async () => {
    const run = await finishedRun();
    await writeFile(path.join(runDir(run.base, run.runId), RECORDS_CHANGED_FILE_NAME), "{}", "utf8");
    const page = ok(await list(run.app)({ settings: taskForm(run.base), runId: run.runId, offset: 0 }));
    assert.equal(page.recordsChanged, true);
    assert.equal(page.total, run.events.length);
  });

  test("a run that is still going (no result.json): incomplete, its unfinished last line left out uncounted", async () => {
    const run = await finishedRun();
    await rm(path.join(runDir(run.base, run.runId), "result.json"));
    await appendFile(journalFile(run.base, run.runId), "{\"seq\":", "utf8");
    const page = ok(await list(run.app)({ settings: taskForm(run.base), runId: run.runId, offset: 0 }));
    assert.deepEqual([page.status, page.skipped, page.total], ["incomplete", 0, run.events.length]);
  });

  test("no such run, a damaged run, and arguments that do not fit", async () => {
    const run = await finishedRun();
    const form = taskForm(run.base);
    assert.equal(code(await list(run.app)({ settings: form, runId: NO_RUN, offset: 0 })), "run_not_found");
    for (const request of [
      { runId: "latest", offset: 0 },
      { runId: "../x", offset: 0 },
      { runId: "a/b", offset: 0 },
      { runId: run.runId, offset: -1 },
      { runId: run.runId, offset: 0.5 },
      { runId: run.runId, offset: 0, limit: 0 },
      { runId: run.runId, offset: 0, limit: 1001 },
      { runId: run.runId, offset: 0, types: [] },
      { runId: run.runId, offset: 0, types: ["made_up"] },
      { runId: run.runId, offset: 0, types: "model_request" },
    ]) {
      assert.equal(code(await list(run.app)({ settings: form, ...(request as Omit<Request, "settings">) })), "invalid_arguments", JSON.stringify(request));
    }
    await writeFile(journalFile(run.base, run.runId), "damaged\n", "utf8");
    assert.equal(code(await list(run.app)({ settings: form, runId: run.runId, offset: 0 })), "invalid_run_record");
  });

  test("a type filter and pages; an offset past the end is an empty page", async () => {
    const run = await finishedRun();
    const form = taskForm(run.base);
    const stored = await readJournal(run.base, run.runId);
    const requests = stored.filter((record) => record.type === "model_request").length;
    assert.ok(requests >= 2);
    const filtered = ok(await list(run.app)({ settings: form, runId: run.runId, offset: 0, types: ["model_request"] }));
    assert.deepEqual([filtered.total, filtered.records.every((record) => record.type === "model_request")], [requests, true]);
    const pages: Page[] = [];
    for (let offset: number | null = 0; offset !== null; offset = pages.at(-1)?.nextOffset ?? null) {
      pages.push(ok(await list(run.app)({ settings: form, runId: run.runId, offset, limit: 2 })));
    }
    assert.deepEqual(pages.flatMap((page) => page.records.map((record) => record.seq)), stored.map((record) => record.seq));
    assert.ok(pages.every((page) => page.records.length <= 2));
    const past = ok(await list(run.app)({ settings: form, runId: run.runId, offset: 10_000 }));
    assert.deepEqual([past.records.length, past.nextOffset, past.total], [0, null, stored.length]);
  });

  test("a page is cut before 2 MiB of JSON", async () => {
    const run = await finishedRun();
    const last = (await readJournal(run.base, run.runId)).length;
    // Two records of 1.1 MiB: either fits a page alone, both do not.
    const big = "x".repeat(1126 * 1024);
    await append(run.base, run.runId, [modelError(run.runId, last + 1, big), modelError(run.runId, last + 2, big)]);
    const form = taskForm(run.base);
    const first = ok(await list(run.app)({ settings: form, runId: run.runId, offset: 0, limit: 1000, types: ["model_error"] }));
    assert.deepEqual([MAX_RUN_EVENTS_PAGE_BYTES, first.records.length, first.nextOffset, first.total], [2 * 1024 * 1024, 1, 1, 2]);
    const second = ok(await list(run.app)({ settings: form, runId: run.runId, offset: 1, limit: 1000, types: ["model_error"] }));
    assert.deepEqual([second.records.length, second.nextOffset], [1, null]);
  });

  test("the cut, at a smaller size: records up to the size, and a larger record alone", async () => {
    const run = await finishedRun();
    const last = (await readJournal(run.base, run.runId)).length;
    const small = "x".repeat(1000);
    await append(run.base, run.runId, [
      modelError(run.runId, last + 1, small),
      modelError(run.runId, last + 2, small),
      modelError(run.runId, last + 3, small),
      modelError(run.runId, last + 4, "y".repeat(5000)),
    ]);
    const source = { workspaceRoot: path.join(run.base, "work"), privacy: createPrivacyGateway({ secrets: [FAKE_SECRET] }), keys: [] };
    const sizes: number[] = [];
    for (let offset: number | null = 0; offset !== null; ) {
      const page = ok(await listRunEventsIn(source, run.runId, offset, 1000, new Set(["model_error"]), { maxPageBytes: 2500 }));
      sizes.push(page.records.length);
      offset = page.nextOffset;
    }
    assert.deepEqual(sizes, [2, 1, 1]);
  });

  test("reads only: no lock, and the journal is as it was", async () => {
    const run = await finishedRun();
    const before = await readFile(journalFile(run.base, run.runId), "utf8");
    ok(await list(run.app)({ settings: taskForm(run.base), runId: run.runId, offset: 0 }));
    assert.equal(await readFile(journalFile(run.base, run.runId), "utf8"), before);
    assert.equal(await exists(path.join(run.base, "work", ".codaryn", "lock.json")), false);
  });

  test("settings that do not resolve give their error and nothing is read", async () => {
    const run = await finishedRun();
    const app = createCodarynApp(await appEnvironment(run.base, { env: {} }));
    assert.equal(code(await list(app)({ settings: taskForm(run.base), runId: run.runId, offset: 0 })), "secret_env_missing");
  });
});
