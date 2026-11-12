/**
 * A-1: the app layer's run contract (adapter-contract 5.1 to 5.5, 5.8) on the real modules with a
 * scripted model. Fake values only; no network and no real API (the Anthropic provider is replaced
 * where a test needs one).
 */

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { ANTHROPIC_API_KEY_ENV, CLI_ERROR_EXIT_CODES } from "../../../src/contracts/index.js";
import type { CliErrorCode, EngineResult, ModelProvider } from "../../../src/contracts/index.js";
import { MODEL_NOT_FOUND_HINT } from "../../../src/cli/run.js";
import { RUN_ID_PATTERN } from "../../../src/cli/run-id.js";
import { runTask as engineRunTask } from "../../../src/engine/index.js";
import { appError, appErrorExitCode, createCodarynApp, fromCliError, runArguments, toCliError } from "../../../src/app/index.js";
import type { RunEvent, RunHandle, RunOutcome } from "../../../src/app/index.js";
import {
  FAKE_SECRET,
  WRITE_NOTES,
  appEnvironment,
  exists,
  readJournal,
  runDir,
  setupRun,
  taskRequest,
} from "./support.js";

const FAKE_KEY = "fake-app-key-value-0077";
const WAIT = { text: "waiting", delayMs: 30_000 };

function finished(outcome: RunOutcome): EngineResult {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { result: EngineResult }).result;
}

function records(events: readonly RunEvent[]) {
  return events.flatMap((event) => (event.kind === "record" ? [event.record] : []));
}

describe("startRun", () => {
  test("returns the handle with the run id before any event, then delivers the journal's records", async () => {
    const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
    const app = createCodarynApp(await appEnvironment(base));
    const events: RunEvent[] = [];
    const started = await app.startRun(taskRequest(base), { onEvent: (event) => events.push(event) });
    assert.equal(started.ok, true, JSON.stringify(started));
    const handle = (started as { handle: RunHandle }).handle;
    assert.equal(events.length, 0, "no event before the caller has the handle");
    assert.match(handle.runId, RUN_ID_PATTERN);
    assert.equal(handle.workspaceRoot.toLowerCase().endsWith(path.join(path.basename(base), "work").toLowerCase()), true);

    const result = finished(await handle.done);
    assert.deepEqual([result.status, result.reason, result.exitCode], ["done", "verified", 0]);
    assert.equal(result.runId, handle.runId);

    const journal = await readJournal(base, handle.runId);
    assert.deepEqual(records(events), journal, "the events are the journal's lines, in order, as stored");
    assert.deepEqual(
      journal.map((record) => record.seq),
      journal.map((_record, index) => index + 1),
    );
    assert.equal(journal[0]?.type, "run_started");
    assert.equal(journal.at(-1)?.type, "run_finished");
  });

  test("the engine starts only after the caller has received the handle", async () => {
    const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
    let engineStarted = false;
    const app = createCodarynApp(await appEnvironment(base), {
      runTask: (deps) => {
        engineStarted = true;
        return engineRunTask(deps);
      },
    });
    const started = await app.startRun(taskRequest(base));
    assert.equal(started.ok, true);
    assert.equal(engineStarted, false, "not even the first engine step ran before startRun resolved");
    assert.equal(finished(await (started as { handle: RunHandle }).handle.done).status, "done");
    assert.equal(engineStarted, true);
  });

  test("done resolves after result.json is written and the lock is released", async () => {
    const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
    const app = createCodarynApp(await appEnvironment(base));
    const started = await app.startRun(taskRequest(base));
    assert.equal(started.ok, true);
    const handle = (started as { handle: RunHandle }).handle;
    assert.equal(await exists(path.join(base, "work", ".codaryn", "lock.json")), true, "the lock is held once started");
    const result = finished(await handle.done);
    const stored = JSON.parse(await readFile(path.join(runDir(base, handle.runId), "result.json"), "utf8")) as EngineResult;
    assert.deepEqual(stored, result);
    assert.equal(await exists(path.join(base, "work", ".codaryn", "lock.json")), false);
  });

  test("an observer that throws does not change the run", async () => {
    const plain = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
    const noisy = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
    const quiet = await createCodarynApp(await appEnvironment(plain)).startRun(taskRequest(plain));
    const thrown = await createCodarynApp(await appEnvironment(noisy)).startRun(taskRequest(noisy), {
      onEvent: () => {
        throw new Error("observer failure");
      },
    });
    assert.equal(quiet.ok && thrown.ok, true);
    const a = finished(await (quiet as { handle: RunHandle }).handle.done);
    const b = finished(await (thrown as { handle: RunHandle }).handle.done);
    assert.deepEqual([b.status, b.reason, b.exitCode, b.changes, b.notices], [a.status, a.reason, a.exitCode, a.changes, a.notices]);
  });

  test("cancel() ends the run as cancelled and keeps the applied change", async () => {
    const base = await setupRun({}, {}, [WRITE_NOTES, WAIT]);
    const app = createCodarynApp(await appEnvironment(base));
    let handle: RunHandle | undefined;
    let cancelledWithHandle = false;
    const started = await app.startRun(taskRequest(base), {
      onEvent: (event) => {
        if (event.kind === "record" && event.record.type === "file_changed") {
          cancelledWithHandle = handle !== undefined;
          handle?.cancel();
        }
      },
    });
    assert.equal(started.ok, true);
    handle = (started as { handle: RunHandle }).handle;
    const result = finished(await handle.done);
    assert.equal(cancelledWithHandle, true, "the handle existed when the first events arrived");
    assert.deepEqual([result.status, result.reason, result.exitCode], ["cancelled", "cancelled", 5]);
    assert.equal(result.changes.length, 1);
    assert.equal(await readFile(path.join(base, "work", "NOTES.md"), "utf8"), "# Notes\n", "M-11: the change stays");

    const before = await readFile(path.join(runDir(base, handle.runId), "result.json"), "utf8");
    handle.cancel();
    handle.cancel();
    assert.equal(await readFile(path.join(runDir(base, handle.runId), "result.json"), "utf8"), before, "cancel after the end does nothing");
  });

  test("a cancel file named in the request cancels the run (P-2)", async () => {
    const base = await setupRun({}, {}, [WRITE_NOTES, WAIT]);
    const cancelFile = path.join(base, "cancel.flag");
    const app = createCodarynApp(await appEnvironment(base));
    const started = await app.startRun(taskRequest(base, { cancelFile }), {
      onEvent: (event) => {
        if (event.kind === "record" && event.record.type === "file_changed") writeFileSync(cancelFile, "");
      },
    });
    assert.equal(started.ok, true);
    const result = finished(await (started as { handle: RunHandle }).handle.done);
    assert.deepEqual([result.status, result.reason], ["cancelled", "cancelled"]);
  });

  test("a second run on a locked workspace is refused; a run in another workspace goes on", async () => {
    const first = await setupRun({}, {}, [WAIT]);
    const other = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
    const environment = await appEnvironment(first);
    const app = createCodarynApp(environment);

    const running = await app.startRun(taskRequest(first));
    assert.equal(running.ok, true);
    const handle = (running as { handle: RunHandle }).handle;

    const refused = await app.startRun(taskRequest(first));
    assert.deepEqual(refused.ok ? null : refused.error.code, "workspace_locked");

    const elsewhere = await app.startRun(taskRequest(other));
    assert.equal(elsewhere.ok, true, JSON.stringify(elsewhere));
    assert.equal(finished(await (elsewhere as { handle: RunHandle }).handle.done).status, "done");

    handle.cancel();
    assert.equal(finished(await handle.done).status, "cancelled");
  });

  test("an error before the start returns the CLI's code and creates nothing", async () => {
    const missing = await setupRun({}, { workspaceRoot: "./missing" }, []);
    const app = createCodarynApp(await appEnvironment(missing));
    const notFound = await app.startRun(taskRequest(missing));
    assert.deepEqual(notFound.ok ? null : notFound.error.code, "workspace_not_found");
    assert.equal(await exists(path.join(missing, "missing")), false);

    const noScript = await setupRun({}, { model: { provider: "scripted", scriptPath: "./absent.json" } }, []);
    const invalid = await createCodarynApp(await appEnvironment(noScript)).startRun(taskRequest(noScript));
    assert.deepEqual(invalid.ok ? null : invalid.error.code, "invalid_script");
    assert.equal(await exists(path.join(noScript, "work", ".codaryn")), false, "no state directory, no journal");

    // The CLI's own rule: a value cannot start with "--".
    const quick = await createCodarynApp(await appEnvironment(noScript)).startRun({
      ...taskRequest(noScript),
      input: { kind: "quick", workspace: path.join(noScript, "work"), goal: "--goal-like text" },
    });
    assert.deepEqual(quick.ok ? null : quick.error.code, "invalid_arguments");
  });

  test("an internal error after the start resolves done with internal_error and releases the lock", async () => {
    const base = await setupRun({}, {}, [{ text: "done" }]);
    const app = createCodarynApp(await appEnvironment(base), {
      runTask: async () => {
        throw new Error("engine failure");
      },
    });
    const started = await app.startRun(taskRequest(base));
    assert.equal(started.ok, true);
    const handle = (started as { handle: RunHandle }).handle;
    const outcome = await handle.done;
    assert.deepEqual(outcome.ok ? null : outcome.error.code, "internal_error");
    assert.equal(JSON.stringify(outcome).includes("engine failure"), false, "S-6: the exception text is dropped");
    assert.equal(await exists(path.join(base, "work", ".codaryn", "lock.json")), false);
  });

  test("the variables file is loaded into a copy: the caller's env and process.env stay as they were", async () => {
    const value = "fake-vars-VALUE-0042";
    const base = await setupRun({ "data.txt": `value ${value}\n` }, {}, [
      { toolCalls: [{ name: "read_file", args: { path: "data.txt" } }] },
      WRITE_NOTES,
      { text: "done" },
    ]);
    const varsFile = path.join(base, "vars.env");
    await writeFile(varsFile, `APP_TEST_VARS_VALUE=${value}\n`, "utf8");
    const environment = await appEnvironment(base);
    const snapshot = { ...environment.env };
    const app = createCodarynApp(environment);
    const started = await app.startRun(taskRequest(base, { varsFile }));
    assert.equal(started.ok, true, JSON.stringify(started));
    const handle = (started as { handle: RunHandle }).handle;
    assert.equal(finished(await handle.done).status, "done");

    assert.deepEqual({ ...environment.env }, snapshot);
    assert.equal(process.env["APP_TEST_VARS_VALUE"], undefined);
    const journal = await readFile(path.join(runDir(base, handle.runId), "journal.jsonl"), "utf8");
    assert.equal(journal.includes(value), false, "S-4: a value the file set is masked");
    assert.equal(journal.includes(FAKE_SECRET), false);
  });

  test("the Y-4 hint arrives as a notice event before done resolves", async () => {
    const base = await setupRun(
      {},
      {
        model: { provider: "anthropic", model: "fake-model-gone", maxOutputTokens: 100 },
        limits: { maxModelTurns: 2, maxToolCalls: 2, maxTotalTokens: 1000, maxDurationMs: 60_000 },
      },
      [],
    );
    const provider: ModelProvider = {
      name: "anthropic",
      complete: async () => ({ ok: false, kind: "api_error", message: "HTTP 404 not_found_error: model: fake-model-gone" }),
    };
    const environment = await appEnvironment(base);
    const app = createCodarynApp(
      { ...environment, env: { ...environment.env, [ANTHROPIC_API_KEY_ENV]: FAKE_KEY } },
      { createAnthropicProvider: () => provider },
    );
    const events: RunEvent[] = [];
    const started = await app.startRun(taskRequest(base), { onEvent: (event) => events.push(event) });
    assert.equal(started.ok, true, JSON.stringify(started));
    const result = finished(await (started as { handle: RunHandle }).handle.done);
    assert.deepEqual([result.status, result.reason], ["failed", "model_error"]);
    const notices = events.flatMap((event) => (event.kind === "notice" ? [event.text] : []));
    assert.deepEqual(notices, [MODEL_NOT_FOUND_HINT]);
    assert.equal(result.notices.at(-1), MODEL_NOT_FOUND_HINT);
    assert.equal(events.at(-1)?.kind, "notice", "after the last record");
    assert.equal(JSON.stringify(events).includes(FAKE_KEY), false);
  });
});

describe("report, revert, doctor", () => {
  test("report returns the ReportOutput; an unknown run is run_not_found", async () => {
    const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
    const app = createCodarynApp(await appEnvironment(base));
    const started = await app.startRun(taskRequest(base));
    assert.equal(started.ok, true);
    const handle = (started as { handle: RunHandle }).handle;
    const result = finished(await handle.done);

    const report = await app.report({ workspace: path.join(base, "work"), runId: handle.runId });
    assert.equal(report.ok, true, JSON.stringify(report));
    const output = (report as { output: { kind: string; status: string; result: EngineResult | null } }).output;
    assert.deepEqual([output.kind, output.status], ["report", "complete"]);
    assert.deepEqual(output.result, result);

    const unknown = await app.report({ workspace: path.join(base, "work"), runId: "20261112T000000Z-00000000" });
    assert.deepEqual(unknown.ok ? null : unknown.error.code, "run_not_found");
  });

  test("revert puts the run's files back", async () => {
    const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
    const app = createCodarynApp(await appEnvironment(base));
    const started = await app.startRun(taskRequest(base));
    assert.equal(started.ok, true);
    const handle = (started as { handle: RunHandle }).handle;
    finished(await handle.done);

    const reverted = await app.revert({ workspace: path.join(base, "work"), runId: handle.runId });
    assert.equal(reverted.ok, true, JSON.stringify(reverted));
    const output = (reverted as { output: { status: string; exitCode: number; reverted: unknown } }).output;
    assert.deepEqual([output.status, output.exitCode, output.reverted], ["complete", 0, [{ path: "NOTES.md", action: "deleted" }]]);
    assert.equal(await exists(path.join(base, "work", "NOTES.md")), false);

    const missing = await app.revert({ workspace: path.join(base, "absent"), runId: handle.runId });
    assert.deepEqual(missing.ok ? null : missing.error.code, "workspace_not_found");
  });

  test("doctor returns one check per id; --task and --workspace together are refused", async () => {
    const base = await setupRun({}, {}, [{ text: "done" }]);
    const app = createCodarynApp(await appEnvironment(base));
    const checked = await app.doctor({ configPath: null, varsFile: null, taskPath: path.join(base, "task.json"), workspace: null });
    assert.equal(checked.ok, true, JSON.stringify(checked));
    const output = (checked as { output: { kind: string; checks: readonly { id: string }[] } }).output;
    assert.equal(output.kind, "doctor");
    assert.equal(output.checks.length, 12);

    const both = await app.doctor({
      configPath: null,
      varsFile: null,
      taskPath: path.join(base, "task.json"),
      workspace: path.join(base, "work"),
    });
    assert.deepEqual(both.ok ? null : both.error.code, "invalid_arguments");
  });
});

describe("errors and arguments", () => {
  test("every AppError code keeps the CLI's exit code and output shape", () => {
    for (const code of Object.keys(CLI_ERROR_EXIT_CODES) as CliErrorCode[]) {
      const error = appError(code, "fixed text");
      assert.equal(appErrorExitCode(error), CLI_ERROR_EXIT_CODES[code]);
      assert.deepEqual(toCliError(error), { schemaVersion: 1, kind: "error", code, exitCode: CLI_ERROR_EXIT_CODES[code], message: "fixed text" });
      assert.deepEqual(fromCliError(toCliError(error)), error, "the CLI's error output and AppError convert both ways");
    }
    const withExtra = { schemaVersion: 1, kind: "error", code: "invalid_config", exitCode: 2, message: "m", diagnostic: { line: 3 } } as const;
    assert.deepEqual(fromCliError(withExtra as never), { code: "invalid_config", message: "m", diagnostic: { line: 3 } }, "fields beyond the envelope are kept");
  });

  test("runArguments builds the codaryn run arguments of a request", () => {
    assert.deepEqual(
      runArguments({ input: { kind: "task", taskPath: "t.json" }, configPath: null, varsFile: null, profile: null, cancelFile: null }),
      ["run", "--task", "t.json"],
    );
    assert.deepEqual(
      runArguments({
        input: { kind: "quick", workspace: "w", goal: "a goal; with $(shell) text" },
        configPath: "c.json",
        varsFile: "v.env",
        profile: "doc",
        cancelFile: "x.flag",
      }),
      ["run", "--workspace", "w", "--goal", "a goal; with $(shell) text", "--config", "c.json", "--vars-file", "v.env", "--profile", "doc", "--cancel-file", "x.flag"],
    );
  });
});
