/**
 * A2: a document task in a folder without Git or a test runner runs to the end.
 * The CLI gets no PATH, so it cannot reach git, npm or any other tool.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { createSandbox, writeTask, writeWorkspaceFile } from "../fixtures/builders.js";
import { cliEnv, expectRunResult, readRunFiles, runTask, sha256Hex } from "../support/cli.js";

const README = "# 프로젝트\n\n소개 문단.\n";
const README_NEXT = "# 프로젝트\n\n## 설치\n\nnpm ci\n\n소개 문단.\n";
const GUIDE = "# 안내\n\n문서 작업 결과.\n";

test("A2 document task without Git, test runner or PATH -> done", { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "README.md", README);

  assert.equal(existsSync(join(sb.workspace, ".git")), false);
  assert.equal(existsSync(join(sb.base, ".git")), false);
  assert.equal(existsSync(join(sb.workspace, "package.json")), false);
  for (let dir = dirname(sb.base); dir !== dirname(dir); dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) t.diagnostic(`an ancestor of the sandbox has .git: ${dir}`);
  }

  const taskPath = writeTask(
    sb,
    {
      id: "a02-document",
      goal: "README에 설치 절을 추가하고 안내 문서를 만든다",
      workflow: "document",
      commands: [],
      verifiers: [
        {
          id: "doc",
          kind: "file_rules",
          rules: [
            { type: "contains", path: "README.md", text: "## 설치" },
            { type: "exists", path: "GUIDE.md" },
            { type: "contains", path: "GUIDE.md", text: "# 안내" },
          ],
        },
      ],
    },
    [
      { toolCalls: [{ id: "r1", name: "read_file", args: { path: "README.md" } }] },
      {
        toolCalls: [
          {
            id: "w1",
            name: "write_file",
            args: {
              path: "README.md",
              expectedHash: sha256Hex(README),
              change: { kind: "replace_text", oldText: "# 프로젝트\n\n", newText: "# 프로젝트\n\n## 설치\n\nnpm ci\n\n" },
            },
          },
          {
            id: "w2",
            name: "write_file",
            args: { path: "GUIDE.md", expectedHash: null, change: { kind: "replace_all", content: GUIDE } },
          },
        ],
      },
      { text: "문서를 고쳤다" },
    ],
  );

  const run = await runTask(taskPath, { cwd: sb.base, env: cliEnv({ omitPath: true }) });
  const result = expectRunResult(run);
  readRunFiles(sb.workspace, result);

  assert.equal(result.status, "done", `stderr: ${run.stderr.slice(0, 2000)}`);
  assert.equal(result.reason, "verified");
  assert.equal(readFileSync(join(sb.workspace, "README.md"), "utf8"), README_NEXT);
  assert.equal(readFileSync(join(sb.workspace, "GUIDE.md"), "utf8"), GUIDE);
  assert.equal(result.changes.length, 2);
  assert.equal(result.changes[1]?.created, true);
  assert.equal(result.changes[1]?.previousHash, null);
  assert.equal(existsSync(join(sb.workspace, ".git")), false, "the run must not create a Git repository");
});
