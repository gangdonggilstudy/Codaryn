/**
 * DR-7, DR-14: `codaryn changes` (src/cli/changes.ts): arguments, the text and JSON forms, errors,
 * and one run through the real app layer with a scripted model. Fake values only, no network.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { ANTHROPIC_API_KEY_ENV } from "../../../src/contracts/index.js";
import type { CliErrorOutput, EngineResult } from "../../../src/contracts/index.js";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome, ChangesOutput, ChangesRequest, RunHandle } from "../../../src/app/index.js";
import { CHANGES_USAGE, MAX_SHOWN_LINES, changedRegion, parseChangesArgs, renderChanges, runChanges } from "../../../src/cli/changes.js";
import type { CommandOutcome } from "../../../src/cli/guard.js";
import { FAKE_SECRET, WRITE_NOTES, appEnvironment, setupRun, taskRequest } from "../app/support.js";

const FAKE_KEY = "fake-changes-key-value-0083";

function text(outcome: CommandOutcome): string {
  assert.ok("text" in outcome, JSON.stringify(outcome));
  return outcome.text;
}

function errorOf(outcome: CommandOutcome): CliErrorOutput {
  assert.ok("output" in outcome && outcome.output.kind === "error", JSON.stringify(outcome));
  return outcome.output as CliErrorOutput;
}

const VIEW: ChangesOutput = {
  schemaVersion: 1,
  kind: "changes",
  runId: "20261112T010203Z-0a1b2c3d",
  exitCode: 0,
  masking: "current_secrets",
  files: [
    { path: "README.md" as never, created: false, state: "as_run_left", before: "a\nb\nc\n" as never, after: "a\nB\nb2\nc\n" as never, unavailable: null },
    { path: "NOTES.md" as never, created: true, state: "changed_since_run", before: null, after: "# Notes\n" as never, unavailable: null },
    { path: "gone.md" as never, created: false, state: "missing", before: "x\n" as never, after: null, unavailable: null },
    { path: "bin.dat" as never, created: false, state: "as_run_left", before: null, after: null, unavailable: "not_text" },
  ],
};

function fakeApp(outcome: AppCallOutcome<ChangesOutput>): { app: { changes(request: ChangesRequest): Promise<AppCallOutcome<ChangesOutput>> }; seen: ChangesRequest[] } {
  const seen: ChangesRequest[] = [];
  return {
    seen,
    app: {
      async changes(request) {
        seen.push(request);
        return outcome;
      },
    },
  };
}

describe("parseChangesArgs", () => {
  test("takes the task form and a run id or latest", () => {
    const task = parseChangesArgs(["changes", "--task", "t.json", "--config", "c.json", "--vars-file", "v.env", "--run", "latest", "--json"]);
    assert.deepEqual(task, {
      ok: true,
      args: {
        command: "changes",
        settings: { input: { kind: "task", taskPath: "t.json" }, configPath: "c.json", varsFile: "v.env", profile: null, workflowRef: null },
        runId: "latest",
        json: true,
      },
    });
    const quick = parseChangesArgs(["changes", "--workspace", "w", "--profile", "doc", "--run", "20261112T010203Z-0a1b2c3d"]);
    assert.ok(quick.ok);
    assert.deepEqual(quick.args.settings.input, { kind: "workspace", workspace: "w" });
    assert.deepEqual([quick.args.settings.profile, quick.args.json], ["doc", false]);
  });

  test("refuses missing, combined, repeated, unknown and flag-like values, and Node's env-file names", () => {
    const refused = (argv: readonly string[]) => {
      const outcome = parseChangesArgs(argv);
      assert.equal(outcome.ok, false, argv.join(" "));
      return (outcome as { message: string }).message;
    };
    assert.match(refused(["changes", "--run", "latest"]), /either --task or --workspace/);
    assert.match(refused(["changes", "--task", "t", "--workspace", "w", "--run", "latest"]), /either --task or --workspace/);
    assert.match(refused(["changes", "--task", "t", "--profile", "p", "--run", "latest"]), /--profile goes with --workspace/);
    assert.match(refused(["changes", "--task", "t"]), /--run is required/);
    assert.match(refused(["changes", "--task", "t", "--run", "../x"]), /--run must be a run id/);
    assert.match(refused(["changes", "--task", "t", "--run", "latest", "--run", "latest"]), /unknown or repeated/);
    assert.match(refused(["changes", "--task", "--json", "--run", "latest"]), /--task needs a value/);
    assert.match(refused(["changes", "--task", "t", "--run", "latest", "--quiet"]), /unknown or repeated/);
    assert.match(refused(["changes", "--task", "t", "--run", "latest", "--env-file=x"]), /--vars-file/);
    assert.equal(refused(["report", "--task", "t"]), CHANGES_USAGE);
  });
});

describe("changedRegion and renderChanges", () => {
  test("show the lines between the common first and last lines, as - and +", () => {
    assert.deepEqual(changedRegion("a\nb\nc\n", "a\nB\nb2\nc\n"), ["@@ -2,1 +2,2 @@", "- b", "+ B", "+ b2"]);
    assert.deepEqual(changedRegion(null, "x\n"), ["@@ -1,0 +1,1 @@", "+ x"]);
    assert.deepEqual(changedRegion("x\r\n", "x\n"), [], "a line ending change alone is not shown");
    const long = Array.from({ length: MAX_SHOWN_LINES + 5 }, (_value, index) => `l${index}`).join("\n");
    const region = changedRegion(null, long);
    assert.equal(region.at(-1), "+ ... 5 more lines");
  });

  test("the text form names each file's state and replaces control characters", () => {
    const shown = renderChanges({ ...VIEW, files: [...VIEW.files, { ...VIEW.files[0]!, path: "evil\u001b[2J.md" as never, after: "a\nb\u0007\nc\n" as never }] });
    assert.match(shown, /^changes of run 20261112T010203Z-0a1b2c3d, masked with the secrets registered now/);
    assert.match(shown, /== README\.md: changed by the run; as the run left it\n@@ -2,1 \+2,2 @@\n- b\n\+ B\n\+ b2/);
    assert.match(shown, /== NOTES\.md: created by the run; changed again since the run\n@@ -1,0 \+1,1 @@\n\+ # Notes/);
    assert.match(shown, /== gone\.md: changed by the run; no longer exists\n@@ -1,1 \+1,0 @@\n- x/);
    assert.match(shown, /== bin\.dat: changed by the run; as the run left it\n {3}the text is not shown \(not_text\)/);
    assert.equal(/[\u0000-\u0008\u000b-\u001f\u007f]/.test(shown), false, "no control character but line feeds");
    assert.match(renderChanges({ ...VIEW, files: [] }), /the run changed no file/);
  });
});

describe("runChanges", () => {
  test("passes the parsed request to the app layer and prints JSON or text, hiding the current key", async () => {
    const withKey: ChangesOutput = { ...VIEW, files: [{ ...VIEW.files[0]!, after: `a\nkey ${FAKE_KEY}\nc\n` as never }] };
    const fake = fakeApp({ ok: true, output: withKey });
    const env = { [ANTHROPIC_API_KEY_ENV]: FAKE_KEY };
    const json = await runChanges({ argv: ["changes", "--task", "t.json", "--run", "latest", "--json"], env, app: fake.app });
    assert.equal(json.exitCode, 0);
    const printed = text(json);
    assert.equal(printed.endsWith("\n") && printed.split("\n").length, 2, "one JSON line");
    assert.equal(printed.includes(FAKE_KEY), false);
    assert.equal((JSON.parse(printed) as ChangesOutput).kind, "changes");
    assert.deepEqual(fake.seen[0], { settings: { input: { kind: "task", taskPath: "t.json" }, configPath: null, varsFile: null, profile: null, workflowRef: null }, runId: "latest" });

    const human = text(await runChanges({ argv: ["changes", "--task", "t.json", "--run", "latest"], env, app: fake.app }));
    assert.equal(human.includes(FAKE_KEY), false);
  });

  test("errors are the CLI's error line with the app's code and exit code", async () => {
    const fake = fakeApp({ ok: false, error: { code: "secret_env_missing", message: "privacy.secretEnv[0] is not set" } });
    const error = errorOf(await runChanges({ argv: ["changes", "--task", "t.json", "--run", "latest"], env: {}, app: fake.app }));
    assert.deepEqual([error.kind, error.code, error.exitCode], ["error", "secret_env_missing", 2]);
    const bad = errorOf(await runChanges({ argv: ["changes", "--run", "latest"], env: {}, app: fake.app }));
    assert.deepEqual([bad.code, fake.seen.length], ["invalid_arguments", 1]);
  });

  /** A scripted run through the real app layer that registered FAKE_SECRET, changed README.md (which holds it) and created NOTES.md. */
  async function realRun(): Promise<string> {
    const original = `# Title\nkey ${FAKE_SECRET}\n`;
    const hash = createHash("sha256").update(Buffer.from(original, "utf8")).digest("hex");
    const base = await setupRun({ "README.md": original }, {}, [
      { toolCalls: [{ name: "write_file", args: { path: "README.md", expectedHash: hash, change: { kind: "replace_text", oldText: "# Title\n", newText: "# Title\n\nadded\n" } } }] },
      WRITE_NOTES,
      { text: "done" },
    ]);
    const app = createCodarynApp(await appEnvironment(base));
    const started = await app.startRun(taskRequest(base));
    assert.equal(started.ok, true);
    const outcome = await (started as { handle: RunHandle }).handle.done;
    assert.equal((outcome as { result: EngineResult }).result.status, "done");
    return base;
  }

  test("with the real app layer and the run's own secrets: each file's changed region, masked, with no secret printed (DR-29)", async () => {
    const base = await realRun();
    const app = createCodarynApp(await appEnvironment(base));
    const shown = text(await runChanges({ argv: ["changes", "--task", path.join(base, "task.json"), "--run", "latest"], env: {}, app }));
    assert.match(shown, /== README\.md: changed by the run; as the run left it\n@@ -2,0 \+2,2 @@\n\+ \n\+ added\n/);
    assert.match(shown, /== NOTES\.md: created by the run; as the run left it\n@@ -1,0 \+1,1 @@\n\+ # Notes\n/);
    assert.equal(shown.includes("masking_unverified"), false);
    assert.equal(shown.includes(FAKE_SECRET), false);
  });

  test("with the real app layer and other secrets than the run's: no text for the file that holds the secret (R-11, DR-29)", async () => {
    const base = await realRun();
    const task = JSON.parse(await readFile(path.join(base, "task.json"), "utf8")) as Record<string, unknown>;
    await writeFile(path.join(base, "other.json"), JSON.stringify({ ...task, privacy: { secretEnv: [] } }), "utf8");
    const app = createCodarynApp(await appEnvironment(base, { env: {} }));
    const shown = text(await runChanges({ argv: ["changes", "--task", path.join(base, "other.json"), "--run", "latest"], env: {}, app }));
    // The reason is given once; the file without text has its path, its state and its own mark
    // (the app layer's finding: one result can hold files with and without text).
    assert.equal(shown.split("(DR-29)\n").length, 2, shown);
    assert.match(shown, /== README\.md: changed by the run; as the run left it\n {3}the text is not shown \(masking_unverified\)\n== NOTES\.md/);
    // NOTES.md holds no secret: either set of secrets leaves the same text visible.
    assert.match(shown, /== NOTES\.md: created by the run; as the run left it\n@@ -1,0 \+1,1 @@\n\+ # Notes\n/);
    assert.equal(shown.includes(FAKE_SECRET), false);
  });
});
