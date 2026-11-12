/**
 * A-1 after the R-1 cross-review: DR-4 (environment names without case, the commands' parent
 * environment), L-1 (model-given names and ids in events), DR-7 (changes masked again), and the
 * app layer's own assembly (integrity still wired). Scripted model, fake values only, no network.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import type { EngineResult } from "../../../src/contracts/index.js";
import { UNKNOWN_TOOL_NAME, createCodarynApp } from "../../../src/app/index.js";
import type { ChangesOutput, RunEvent, RunHandle, RunOutcome, StartOutcome } from "../../../src/app/index.js";
import { FAKE_SECRET, SECRET_ENV, WRITE_NOTES, appEnvironment, exists, readJournal, runDir, setupRun, taskForm, taskRequest } from "./support.js";

function handleOf(started: StartOutcome): RunHandle {
  assert.equal(started.ok, true, JSON.stringify(started));
  return (started as { handle: RunHandle }).handle;
}

function finished(outcome: RunOutcome): EngineResult {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { result: EngineResult }).result;
}

const sha256 = (text: string): string => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");

describe("DR-4: the run environment", () => {
  test("Windows: a secretEnv name in another case finds the variable, as process.env does (R-1 M-3)", async () => {
    const value = "fake-probe-VALUE-0061";
    const base = await setupRun({ "data.txt": `probe ${value}\n` }, { privacy: { secretEnv: ["codaryn_app_probe"] } }, [
      { toolCalls: [{ name: "read_file", args: { path: "data.txt" } }] },
      WRITE_NOTES,
      { text: "done" },
    ]);
    const env = { CODARYN_APP_PROBE: value };

    const windows = createCodarynApp(await appEnvironment(base, { env, platform: "win32" }));
    const handle = handleOf(await windows.startRun(taskRequest(base)));
    assert.equal(finished(await handle.done).status, "done");
    const journal = await readFile(path.join(runDir(base, handle.runId), "journal.jsonl"), "utf8");
    assert.equal(journal.includes(value), false, "the variable found without case is registered and masked");

    const posix = createCodarynApp(await appEnvironment(base, { env, platform: "linux" }));
    const refused = await posix.startRun(taskRequest(base));
    assert.deepEqual(refused.ok ? null : refused.error.code, "secret_env_missing", "elsewhere names keep their case");
  });

  test("the commands' parent environment is the run's copy with the variables file loaded", async () => {
    const base = await setupRun(
      {},
      {
        policy: {
          commands: [{ executable: process.execPath, argsPrefix: ["-e"], allowExtraArgs: true }],
          network: "deny",
          destructive: "deny",
          restorePathTokens: false,
        },
        verifiers: [],
      },
      [
        { toolCalls: [{ name: "run_command", args: { executable: process.execPath, args: ["-e", "process.stdout.write('lang=' + process.env.LANG)"] } }] },
        { text: "done" },
      ],
    );
    // LANG is on the child allowlist; a value shorter than 8 characters is not registered as a secret (S-4).
    const varsFile = path.join(base, "vars.env");
    await writeFile(varsFile, "LANG=xx_YY\n", "utf8");
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== "LANG"));
    const app = createCodarynApp(await appEnvironment(base, { env: { ...env, [SECRET_ENV]: FAKE_SECRET } }));
    const handle = handleOf(await app.startRun(taskRequest(base, { varsFile })));
    finished(await handle.done);

    const results = (await readJournal(base, handle.runId)).filter((record) => record.type === "tool_result");
    assert.equal(results.length, 1);
    assert.match(JSON.stringify(results[0]), /lang=xx_YY/, "the child saw the value the variables file set");
    assert.notEqual(process.env["LANG"], "xx_YY", "the test process itself was not changed");
  });
});

describe("events after R-1 L-1", () => {
  test("a model-given tool name or call id never shows a secret; unknown tools read (unknown tool)", async () => {
    const base = await setupRun({}, {}, [
      { toolCalls: [{ id: `call-${FAKE_SECRET}`, name: `tool_${FAKE_SECRET}`, args: {} }] },
      WRITE_NOTES,
      { text: "done" },
    ]);
    const app = createCodarynApp(await appEnvironment(base));
    const events: RunEvent[] = [];
    const handle = handleOf(await app.startRun(taskRequest(base), { onEvent: (event) => events.push(event) }));
    assert.equal(finished(await handle.done).status, "done");

    assert.equal(JSON.stringify(events).includes(FAKE_SECRET), false);
    const decision = events.find((event) => event.kind === "record" && event.record.type === "tool_decision");
    assert.ok(decision !== undefined && decision.kind === "record" && decision.record.type === "tool_decision");
    assert.equal(decision.record.tool, UNKNOWN_TOOL_NAME);
    assert.equal(decision.record.callId.startsWith("call-"), true, "the id is masked, not dropped");
    const records = events.flatMap((event) => (event.kind === "record" ? [event.record.seq] : []));
    const journal = await readJournal(base, handle.runId);
    assert.deepEqual(records, journal.map((record) => record.seq), "every stored record is still delivered");
  });
});

describe("DR-7: changes", () => {
  const ORIGINAL = `# Title\nkey ${FAKE_SECRET}\n`;

  async function changedRun(): Promise<{ base: string; runId: string; app: ReturnType<typeof createCodarynApp> }> {
    const base = await setupRun({ "README.md": ORIGINAL }, {}, [
      {
        toolCalls: [
          {
            name: "write_file",
            args: {
              path: "README.md",
              expectedHash: sha256(ORIGINAL),
              change: { kind: "replace_text", oldText: "# Title\n", newText: "# Title\n\nadded line\n" },
            },
          },
        ],
      },
      WRITE_NOTES,
      { text: "done" },
    ]);
    const app = createCodarynApp(await appEnvironment(base));
    const handle = handleOf(await app.startRun(taskRequest(base)));
    assert.equal(finished(await handle.done).status, "done");
    return { base, runId: handle.runId, app };
  }

  function output(outcome: Awaited<ReturnType<ReturnType<typeof createCodarynApp>["changes"]>>): ChangesOutput {
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    return (outcome as { output: ChangesOutput }).output;
  }

  test("gives the original and the current text of each changed file, masked with the current secrets", async () => {
    const { base, runId, app } = await changedRun();
    const view = output(await app.changes({ settings: taskForm(base), runId }));
    assert.deepEqual([view.kind, view.runId, view.masking], ["changes", runId, "current_secrets"]);
    assert.equal(JSON.stringify(view).includes(FAKE_SECRET), false, "only masked text leaves the app layer");

    const [readme, notes] = view.files;
    assert.equal(view.files.length, 2);
    assert.deepEqual([readme?.path, readme?.created, readme?.state, readme?.unavailable], ["README.md", false, "as_run_left", null]);
    assert.ok(readme?.before?.startsWith("# Title\nkey ") === true && readme.before.includes("CODARYN_SECRET"), readme?.before ?? "");
    assert.ok(readme?.after?.includes("added line") === true);
    assert.deepEqual(notes, { path: "NOTES.md", created: true, state: "as_run_left", before: null, after: "# Notes\n", unavailable: null });
  });

  test("reports later edits and removals, and reads only: no run, no lock", async () => {
    const { base, runId, app } = await changedRun();
    await writeFile(path.join(base, "work", "NOTES.md"), "# Notes\nedited later\n", "utf8");
    await rm(path.join(base, "work", "README.md"));
    const runs = await readdir(path.join(base, "work", ".codaryn", "runs"));

    const view = output(await app.changes({ settings: taskForm(base), runId }));
    const [readme, notes] = view.files;
    assert.deepEqual([readme?.state, readme?.after, readme?.before === null], ["missing", null, false]);
    assert.deepEqual([notes?.state, notes?.after], ["changed_since_run", "# Notes\nedited later\n"]);

    assert.deepEqual(await readdir(path.join(base, "work", ".codaryn", "runs")), runs, "the secrets probe made no run");
    assert.equal(await exists(path.join(base, "work", ".codaryn", "lock.json")), false);
  });

  test("needs the settings to resolve now; otherwise it is the run's error and nothing is shown", async () => {
    const { base, runId } = await changedRun();
    const unset = createCodarynApp(await appEnvironment(base, { env: {} }));
    const refused = await unset.changes({ settings: taskForm(base), runId });
    assert.deepEqual(refused.ok ? null : refused.error.code, "secret_env_missing");

    const { app } = await changedRun();
    const unknown = await app.changes({ settings: taskForm(base), runId: "20261112T000000Z-00000000" });
    assert.deepEqual(unknown.ok ? null : unknown.error.code, "run_not_found");
  });
});

describe("the app layer's own assembly", () => {
  test("protected paths are still checked: integrity records arrive and the run is done", async () => {
    const base = await setupRun({ "guard/rule.txt": "keep\n" }, { policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, protectedPaths: ["guard"] } }, [
      WRITE_NOTES,
      { text: "done" },
    ]);
    const app = createCodarynApp(await appEnvironment(base));
    const events: RunEvent[] = [];
    const handle = handleOf(await app.startRun(taskRequest(base), { onEvent: (event) => events.push(event) }));
    const result = finished(await handle.done);
    assert.equal(result.status, "done");
    assert.deepEqual(result.protectedChanged, []);
    const phases = events.flatMap((event) => (event.kind === "record" && event.record.type === "integrity_checked" ? [event.record.phase] : []));
    assert.deepEqual(phases, ["run_start", "before_verify", "after_verify"]);
  });
});
