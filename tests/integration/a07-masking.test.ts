/**
 * A7: tool results are masked before they are recorded or sent. Fake canaries are placed in
 * file content, a file name, command stdout and stderr, an error message, the goal and raw
 * model output. The raw value and listed variants must appear 0 times in stdout, stderr,
 * result.json and every file under the state directory. Child processes must not receive
 * registered secrets or variables outside the allow list.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PRIVACY_TOKEN_PREFIX, STATE_DIR_NAME } from "../../src/contracts/index.js";
import { createSandbox, nodeCommand, writeTask, writeWorkspaceFile } from "../fixtures/builders.js";
import { writeProgram } from "../fixtures/programs.js";
import {
  FAKE_SECRET_A,
  FAKE_SECRET_B,
  FAKE_SECRET_ENV_A,
  FAKE_SECRET_ENV_B,
  PROBE_ENV,
  PROBE_VALUE,
} from "../fixtures/secrets.js";
import { NODE, cliEnv, expectRunResult, readRunFiles, runTask, toolResultFor } from "../support/cli.js";
import { findLeaks, readTreeTexts } from "../support/leak.js";

test("A7 masked before record: no canary in any output, child env filtered", { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "data/secret-source.txt", `A=${FAKE_SECRET_A}\nB=${FAKE_SECRET_B}\n`);
  writeWorkspaceFile(sb, `notes-${FAKE_SECRET_A}.txt`, "file name holds the canary\n");
  writeProgram(sb, "print-secret.mjs");
  writeProgram(sb, "env-report.mjs");

  const taskPath = writeTask(
    sb,
    {
      id: "a07-masking",
      goal: `카나리 확인 ${FAKE_SECRET_A}`,
      secretEnv: [FAKE_SECRET_ENV_A, FAKE_SECRET_ENV_B],
      commands: [nodeCommand("print-secret.mjs"), nodeCommand("env-report.mjs")],
      verifiers: [{ id: "source", kind: "file_rules", rules: [{ type: "exists", path: "data/secret-source.txt" }] }],
    },
    [
      { toolCalls: [{ id: "r-content", name: "read_file", args: { path: "data/secret-source.txt" } }] },
      { toolCalls: [{ id: "s-names", name: "search_files", args: { path: ".", nameContains: "notes-" } }] },
      { toolCalls: [{ id: "c-print", name: "run_command", args: { executable: NODE, args: ["print-secret.mjs"] } }] },
      { toolCalls: [{ id: "r-missing", name: "read_file", args: { path: `missing-${FAKE_SECRET_A}.txt` } }] },
      { toolCalls: [{ id: "c-env", name: "run_command", args: { executable: NODE, args: ["env-report.mjs"] } }] },
      { text: `완료 ${FAKE_SECRET_A} ${FAKE_SECRET_B}` },
    ],
  );

  const run = await runTask(taskPath, {
    cwd: sb.base,
    env: cliEnv({
      extra: { [FAKE_SECRET_ENV_A]: FAKE_SECRET_A, [FAKE_SECRET_ENV_B]: FAKE_SECRET_B, [PROBE_ENV]: PROBE_VALUE },
    }),
  });
  const result = expectRunResult(run);
  const files = readRunFiles(sb.workspace, result);
  const { records } = files;

  await t.test("canaries were masked, not dropped", () => {
    for (const id of ["r-content", "s-names", "c-print"]) {
      const content = toolResultFor(records, id).content;
      assert.ok(content.includes(PRIVACY_TOKEN_PREFIX), `${id} must carry a token where the canary was`);
    }
    assert.equal(toolResultFor(records, "r-missing").ok, false);
  });

  await t.test("no raw value or listed variant in any output", () => {
    const sources = [
      { label: "stdout", text: run.stdout },
      { label: "stderr", text: run.stderr },
      { label: "result.json", text: files.resultText },
      ...readTreeTexts(join(sb.workspace, STATE_DIR_NAME), sb.workspace),
    ];
    assert.deepEqual(findLeaks(sources, [FAKE_SECRET_A, FAKE_SECRET_B]), []);
  });

  await t.test("child process environment excludes secrets, keys and unlisted variables", () => {
    const report = JSON.parse(readFileSync(join(sb.workspace, "env-report.json"), "utf8")) as Record<string, boolean>;
    assert.deepEqual(report, { secretA: false, secretB: false, probe: false, apiKey: false, model: false });
  });

  await t.test("run ends verified", () => {
    assert.equal(result.status, "done");
  });
});
