/**
 * A6: a protected span keeps its original bytes in place when other lines change, and a token
 * is never restored into a new position, a new file, command args or a path.
 * `{{secret_token:1}}` repeats only the token the model was shown.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PRIVACY_TOKEN_PREFIX } from "../../src/contracts/index.js";
import { createSandbox, nodeCommand, writeTask, writeWorkspaceFile } from "../fixtures/builders.js";
import { writeProgram } from "../fixtures/programs.js";
import { FAKE_SECRET_A, FAKE_SECRET_ENV_A } from "../fixtures/secrets.js";
import {
  NODE,
  assertRefused,
  cliEnv,
  expectRunResult,
  readRunFiles,
  runTask,
  sha256Hex,
  toolResultFor,
} from "../support/cli.js";
import { findLeaks } from "../support/leak.js";

const CONFIG = `line1\napiKey=${FAKE_SECRET_A}\nline3\n`;
const CONFIG_EDITED = `LINE1\napiKey=${FAKE_SECRET_A}\nline3\n`;

test("A6 protected span kept in place; restoration into new places refused", { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "config.txt", CONFIG);
  writeProgram(sb, "echo-args.mjs");

  const taskPath = writeTask(
    sb,
    {
      id: "a06-protected",
      secretEnv: [FAKE_SECRET_ENV_A],
      restorePathTokens: false,
      commands: [nodeCommand("echo-args.mjs", true)],
      verifiers: [
        {
          id: "config",
          kind: "file_rules",
          rules: [
            { type: "contains", path: "config.txt", text: "LINE1" },
            { type: "absent", path: "leak.txt" },
          ],
        },
      ],
    },
    [
      { toolCalls: [{ id: "r1", name: "read_file", args: { path: "config.txt" } }] },
      {
        toolCalls: [
          {
            id: "w-inplace",
            name: "write_file",
            args: {
              path: "config.txt",
              expectedHash: sha256Hex(CONFIG),
              change: { kind: "replace_text", oldText: "line1\n", newText: "LINE1\n" },
            },
          },
        ],
      },
      {
        toolCalls: [
          {
            id: "w-copy",
            name: "write_file",
            args: {
              path: "config.txt",
              expectedHash: sha256Hex(CONFIG_EDITED),
              change: { kind: "replace_text", oldText: "line3\n", newText: "line3\ncopy={{secret_token:1}}\n" },
            },
          },
        ],
      },
      {
        toolCalls: [
          {
            id: "w-newfile",
            name: "write_file",
            args: { path: "leak.txt", expectedHash: null, change: { kind: "replace_all", content: "{{secret_token:1}}\n" } },
          },
        ],
      },
      {
        toolCalls: [
          { id: "c-args", name: "run_command", args: { executable: NODE, args: ["echo-args.mjs", "{{secret_token:1}}"] } },
        ],
      },
      { toolCalls: [{ id: "r-path", name: "read_file", args: { path: "{{secret_token:1}}" } }] },
      { text: "끝" },
    ],
  );

  const run = await runTask(taskPath, {
    cwd: sb.base,
    env: cliEnv({ extra: { [FAKE_SECRET_ENV_A]: FAKE_SECRET_A } }),
  });
  const result = expectRunResult(run);
  const files = readRunFiles(sb.workspace, result);
  const { records } = files;

  await t.test("the model saw a token, not the secret", () => {
    const read = toolResultFor(records, "r1");
    assert.equal(read.ok, true);
    assert.ok(read.content.includes(PRIVACY_TOKEN_PREFIX));
    assert.equal(read.content.includes(FAKE_SECRET_A), false);
  });

  await t.test("editing another line keeps the secret bytes in place", () => {
    assert.equal(toolResultFor(records, "w-inplace").ok, true);
    assert.equal(result.changes.length, 1);
    assert.equal(result.changes[0]?.newHash, sha256Hex(CONFIG_EDITED));
  });

  await t.test("copying the token to a new position is refused", () => {
    assertRefused(records, "w-copy", ["protected_span_violation"]);
    assert.deepEqual(readFileSync(join(sb.workspace, "config.txt")), Buffer.from(CONFIG_EDITED, "utf8"));
  });

  await t.test("putting the token into a new file is refused", () => {
    assertRefused(records, "w-newfile", ["protected_span_violation", "invalid_token"]);
    assert.equal(existsSync(join(sb.workspace, "leak.txt")), false);
  });

  await t.test("a token in command args is not restored and the command does not run", () => {
    assertRefused(records, "c-args", ["unresolved_token"]);
    assert.equal(existsSync(join(sb.workspace, "echo-out.txt")), false);
  });

  await t.test("a token in a path is not restored when restorePathTokens is false", () => {
    assertRefused(records, "r-path", ["unresolved_token", "policy_denied"]);
  });

  await t.test("no raw secret in journal, result or stdout", () => {
    const leaks = findLeaks(
      [
        { label: "journal", text: files.journalText },
        { label: "result.json", text: files.resultText },
        { label: "stdout", text: run.stdout },
        { label: "stderr", text: run.stderr },
      ],
      [FAKE_SECRET_A],
    );
    assert.deepEqual(leaks, []);
  });

  await t.test("run ends verified", () => {
    assert.equal(result.status, "done");
  });
});
