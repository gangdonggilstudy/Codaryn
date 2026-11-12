/**
 * N-E (docs/work-orders/phase-4-usability.md, completion criterion 2), first part: the keyless
 * demo `examples/demo/` followed exactly as docs/usage.md section 3 tells a first-time user, with
 * the commands that exist today (doctor → run → report → revert). Every claim the section makes
 * about the output is checked twice: the section still says it, and the CLI still does it. So a
 * change to either side that leaves the other behind fails here.
 *
 * init, runs, `--run latest` and `revert --dry-run` (N-2, N-7) come after the N-A connection.
 * The model is the demo's scripted script: no key, and every command runs behind the network
 * guard. Nothing here touches the repository's copy of the demo.
 */

import assert from "node:assert/strict";
import { cpSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { STATE_DIR_NAME } from "../../src/contracts/index.js";
import { createSandbox } from "../fixtures/builders.js";
import { REPO_ROOT, cliEnv, expectRunResult, readRunFiles } from "../support/cli.js";
import type { CliRun } from "../support/cli.js";
import { checkOf, doctorArgs, expectDoctorOutput, expectReportOutput } from "../support/commands.js";
import { runGuarded } from "../support/fake-anthropic.js";
import { progressLines } from "../support/progress.js";
import { expectRevertOutput, workspaceBytes } from "../support/repair-check.js";

const DEMO_SOURCE = join(REPO_ROOT, "examples", "demo");
const USAGE = join(REPO_ROOT, "docs", "usage.md");
const SECTION_HEADING = "## 3. 키 없이 체험하기";

/** docs/usage.md section 3, from its heading to the next `## ` heading. */
function demoSection(): string {
  const text = readFileSync(USAGE, "utf8").replace(/\r\n/g, "\n");
  const start = text.indexOf(`${SECTION_HEADING}\n`);
  assert.ok(start >= 0, `docs/usage.md has no "${SECTION_HEADING}" section`);
  const end = text.indexOf("\n## ", start + SECTION_HEADING.length);
  return text.slice(start, end < 0 ? undefined : end);
}

/** The section still states `text`; returns it so the same words are then checked in the output. */
function documented(text: string): string {
  assert.ok(demoSection().includes(text), `docs/usage.md section 3 no longer says ${JSON.stringify(text)}`);
  return text;
}

/** Fenced blocks of the section, in order, without their fences. */
function fencedBlocks(): string[] {
  return [...demoSection().matchAll(/^```[^\n]*\n([\s\S]*?)^```$/gm)].map((match) => match[1] ?? "");
}

/** The documented command lines as `[command, ...option names]`, in order. */
function documentedCommands(): string[][] {
  const block = fencedBlocks().find((text) => text.includes("dist/src/cli/main.js"));
  if (block === undefined) assert.fail("section 3 has no block with CLI commands");
  return block
    .split("\n")
    .filter((line) => line.includes("dist/src/cli/main.js"))
    .map((line) => {
      const words = (line.split("dist/src/cli/main.js")[1] ?? "").split("|")[0]?.trim().split(/\s+/) ?? [];
      return [words[0] ?? "", ...words.filter((word) => word.startsWith("--"))];
    });
}

/** The progress lines the section shows as the run's actual stderr. */
function documentedProgress(): string[] {
  const block = fencedBlocks().find((text) => text.startsWith("codaryn: run started"));
  if (block === undefined) assert.fail("section 3 has no block with the run's progress lines");
  return block.split("\n").filter((line) => line.trim() !== "");
}

interface Demo {
  readonly dir: string;
  readonly task: string;
  readonly workspace: string;
  /** Workspace bytes right after the copy. */
  readonly original: Map<string, Buffer>;
  readonly cli: (args: readonly string[]) => Promise<CliRun>;
}

/** Copies examples/demo out of the repository, as the section says (`Copy-Item -Recurse`). */
function copyDemo(t: TestContext): Demo {
  const sb = createSandbox(t);
  const dir = join(sb.base, "codaryn-demo");
  cpSync(DEMO_SOURCE, dir, { recursive: true });
  const workspace = join(dir, "workspace");
  const env = cliEnv();
  return {
    dir,
    task: join(dir, "task.json"),
    workspace,
    original: workspaceBytes(workspace),
    cli: (args) => runGuarded(sb, args, env),
  };
}

test("N-E 체험 예시: 사용 안내 3절의 명령이 이 사례가 실행하는 명령과 같다", () => {
  assert.deepEqual(documentedCommands(), [
    ["doctor", "--task"],
    ["run", "--task"],
    ["report", "--workspace", "--run"],
    ["revert", "--workspace", "--run"],
  ]);
  assert.ok(existsSync(join(DEMO_SOURCE, "task.json")) && existsSync(join(DEMO_SOURCE, "script.json")));
});

test("N-E 체험 예시: 사본에서 doctor → run → report → revert가 문서대로 된다(키·네트워크 없음)", { timeout: 120_000 }, async (t) => {
  const demo = copyDemo(t);
  const summaryPath = join(demo.workspace, "summary.md");
  let runId = "";

  await t.test("doctor: 모든 항목이 ok 또는 skipped, 종료 0, api_key는 건너뜀", async () => {
    documented("모든 항목이 `ok`이거나 `skipped`이고 종료 0이다");
    const text = await demo.cli(doctorArgs({ task: demo.task, json: false }));
    assert.equal(text.exitCode, 0, `doctor text exit; stdout ${text.stdout.slice(0, 1000)}`);
    const output = expectDoctorOutput(await demo.cli(doctorArgs({ task: demo.task })));
    assert.equal(output.exitCode, 0);
    for (const check of output.checks) assert.ok(["ok", "skipped"].includes(check.status), `${check.id}: ${check.status} ${check.message}`);
    const apiKey = checkOf(output, "api_key");
    assert.equal(apiKey.status, "skipped");
    assert.equal(apiKey.message, documented("the task uses the scripted model; no key is needed"));
  });

  await t.test("run: 진행 줄이 문서에 적힌 실제 출력과 같고 결과는 done/verified", async () => {
    const run = await demo.cli(["run", "--task", demo.task]);
    const result = expectRunResult(run, "scripted");
    runId = result.runId;
    readRunFiles(demo.workspace, result);
    assert.deepEqual(progressLines(run), documentedProgress(), "stderr is the progress shown in section 3");

    documented("stdout의 JSON(`$r`)은 `status` `done`, `reason` `verified`, `exitCode` 0이다");
    assert.equal(result.status, "done");
    assert.equal(result.reason, "verified");
    assert.equal(run.exitCode, 0);
    documented("`changes`에는 `summary.md`의 생성과 변경 두 건, `usage.repairAttempts`는 1이다");
    assert.deepEqual(
      result.changes.map((change) => [change.path, change.created]),
      [
        ["summary.md", true],
        ["summary.md", false],
      ],
    );
    assert.equal(result.usage.repairAttempts, 1);

    const summary = readFileSync(summaryPath, "utf8");
    assert.ok(summary.includes("## 결정 사항") && summary.includes("## 할 일"));
    assert.deepEqual(readFileSync(join(demo.workspace, "notes.md")), demo.original.get("notes.md"), "notes.md is protected and unchanged");
  });

  await t.test("report: 문서가 인용한 줄이 Markdown 보고서에 있다", async () => {
    assert.notEqual(runId, "", "the run step must pass first");
    const markdown = await demo.cli(["report", "--workspace", demo.workspace, "--run", runId]);
    assert.equal(markdown.exitCode, 0);
    // The section quotes the report as Markdown renders it: inline code marks are not part of the
    // quote (the report prints "Provider: `scripted` (...)", the section "Provider: scripted (...)").
    const rendered = markdown.stdout.replace(/`/g, "");
    for (const quoted of ["Provider: scripted (scripted model; no API was called)", "Repairs started: 1", "Tool calls: 3 of 8 (denied: 1)"]) {
      assert.ok(rendered.includes(documented(quoted)), `the report lacks ${JSON.stringify(quoted)}`);
    }
    const output = expectReportOutput(await demo.cli(["report", "--workspace", demo.workspace, "--run", runId, "--json"]), runId);
    documented("검증기 `summary` **pass**");
    assert.deepEqual(
      output.journal.lastRound.map((verifier) => [verifier.id, verifier.outcome]),
      [["summary", "pass"]],
    );
    documented("보호 대상 확인 5회와 변경 없음");
    assert.equal(output.journal.integrityChecks.length, 5);
    assert.ok(output.journal.integrityChecks.every((check) => check.changed.length === 0));
    documented("변경 두 건");
    assert.equal(output.journal.changes.length, 2);
  });

  await t.test("revert: summary.md를 지우고 complete, 종료 0, .codaryn은 남는다", async () => {
    assert.notEqual(runId, "", "the run step must pass first");
    documented('`"status":"complete"`, `"reverted":[{"path":"summary.md","action":"deleted"}]`, 종료 0');
    const run = await demo.cli(["revert", "--workspace", demo.workspace, "--run", runId]);
    const output = expectRevertOutput(run, runId);
    assert.equal(output.status, "complete");
    assert.equal(run.exitCode, 0);
    assert.deepEqual(output.reverted, [{ path: "summary.md", action: "deleted" }]);
    assert.deepEqual(workspaceBytes(demo.workspace), demo.original, "the workspace is back to the copied bytes");
    documented("`.codaryn/`의 기록은 남는다");
    assert.ok(existsSync(join(demo.workspace, STATE_DIR_NAME)));
  });

  await t.test("같은 실행을 다시 되돌리면 partial, changed_since_run, 종료 3, 무변경", async () => {
    assert.notEqual(runId, "", "the run step must pass first");
    documented("같은 실행을 한 번 더 되돌리면 `partial`, `skipped[].reason` `changed_since_run`, 종료 3이다");
    const run = await demo.cli(["revert", "--workspace", demo.workspace, "--run", runId]);
    const output = expectRevertOutput(run, runId);
    assert.equal(output.status, "partial");
    assert.equal(run.exitCode, 3);
    assert.deepEqual(output.reverted, []);
    assert.ok(output.skipped.length > 0 && output.skipped.every((file) => file.reason === "changed_since_run"), JSON.stringify(output.skipped));
    assert.deepEqual(workspaceBytes(demo.workspace), demo.original);
  });
});

test("N-E 체험 예시: 되돌리지 않고 다시 실행하면 첫 write_file이 conflict, changes가 빈 done", { timeout: 120_000 }, async (t) => {
  const demo = copyDemo(t);
  expectRunResult(await demo.cli(["run", "--task", demo.task]), "scripted");
  const afterFirst = workspaceBytes(demo.workspace);

  documented("첫 `write_file`이 `conflict`로 거부되고, 이전 실행이 만든 파일로 검증이 통과해 `changes`가 빈 `done`이 된다");
  const run = await demo.cli(["run", "--task", demo.task]);
  const result = expectRunResult(run, "scripted");
  const { records } = readRunFiles(demo.workspace, result);
  assert.equal(result.status, "done");
  assert.deepEqual(result.changes, []);
  const writes = records.flatMap((record) => (record.type === "tool_result" && record.result.tool === "write_file" ? [record.result] : []));
  assert.ok(writes.length > 0, "the script calls write_file");
  assert.equal(writes[0]?.ok, false);
  assert.equal(writes[0]?.errorCode, "conflict");
  assert.deepEqual(workspaceBytes(demo.workspace), afterFirst, "the second run changed nothing");
});
