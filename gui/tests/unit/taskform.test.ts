/**
 * R21-M-1: the task form the engine host builds for plan, apply, review and changes must give the
 * app layer's `taskFormArguments` (the root build, dist/src/app) real values. Before the fix the
 * host left `workflowRef` out, the app layer added `--workflow undefined`, and the CLI refused every
 * such call (`invalid_arguments`) before anything ran.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { taskForm } from "../../src/engine-host/runs.js";

// This file runs as gui/build/tests/unit/taskform.test.js.
const GUI = fileURLToPath(new URL("../../../", import.meta.url));
const APP = path.join(GUI, "..", "dist", "src", "app", "index.js");
const WS = path.resolve("ws-for-task-form");

test("R21-M-1: every task form the engine host builds turns into arguments without a missing value", { skip: existsSync(APP) ? false : "the root build is missing (npm run build in the repository root)" }, async () => {
  const app = (await import(pathToFileURL(APP).href)) as { taskFormArguments(settings: unknown): unknown[] };
  const cases: [string | null, string | null, string[]][] = [
    [null, null, ["--workspace", WS]],
    ["doc", null, ["--workspace", WS, "--profile", "doc"]],
    [null, "organize", ["--workspace", WS, "--workflow", "organize"]],
    ["tidy", "organize", ["--workspace", WS, "--profile", "tidy", "--workflow", "organize"]],
  ];
  for (const [profile, workflow, expected] of cases) {
    const argv = app.taskFormArguments(taskForm(WS, profile, workflow));
    assert.ok(argv.every((arg) => typeof arg === "string" && arg !== "undefined"), JSON.stringify(argv));
    assert.deepEqual(argv, expected);
  }
});
