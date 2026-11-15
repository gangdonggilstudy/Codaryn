/**
 * N-E (docs/work-orders/phase-4-usability.md, completion criterion 2): the keyless demo
 * `examples/demo/` followed exactly as docs/usage.md section 3 tells a first-time user:
 * doctor → run → runs → report --run latest → revert --dry-run → revert → revert again.
 * Every claim the section makes about the output is checked twice: the section still says it, and
 * the CLI still does it. The output blocks the section shows are compared line by line; only what
 * the section says differs per run is normalized (run id, local time, whole seconds of usage).
 *
 * The model is the demo's scripted script: no key, and every command runs behind the network
 * guard. Nothing here touches the repository's copy of the demo.
 */

import assert from "node:assert/strict";
import { cpSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { DEFAULT_CONFIG_DISPLAY, REVERT_RECORD_FILE_NAME, RUNS_DIR_NAME, STATE_DIR_NAME } from "../../src/contracts/index.js";
import { createSandbox } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import { REPO_ROOT, cliEnv, expectRunResult, readRunFiles } from "../support/cli.js";
import type { CliRun } from "../support/cli.js";
import { checkOf, doctorArgs, expectDoctorOutput, expectReportOutput } from "../support/commands.js";
import { runGuarded } from "../support/fake-anthropic.js";
import { progressLines } from "../support/progress.js";
import { expectRevertOutput, workspaceBytes } from "../support/repair-check.js";
import { userConfigLocation } from "../support/usability.js";

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

/** The one output block of the section that `pick` selects, as non-empty lines. */
function documentedBlock(label: string, pick: (block: string) => boolean): string[] {
  const found = fencedBlocks().filter(pick);
  assert.equal(found.length, 1, `section 3 must have exactly one ${label} block`);
  return (found[0] ?? "").split("\n").filter((line) => line.trim() !== "");
}

/**
 * What the section says changes from run to run: "실행 id와 시간은 실행마다 다르다". The run id,
 * the local start time and the seconds of the usage line ("0 s", "0.1 s" under load); nothing
 * else is loosened.
 */
function normalize(lines: readonly string[]): string[] {
  return lines.map((line) =>
    line
      .replace(/\d{8}T\d{6}Z-[0-9a-f]{8}/g, "<run id>")
      .replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g, "<local time>")
      .replace(/ · \d+(?:\.\d+)? s$/, " · <seconds> s"),
  );
}

function assertSameLines(actual: readonly string[], documentedLines: readonly string[], what: string): void {
  assert.deepEqual(normalize(actual), normalize(documentedLines), `${what} is what section 3 shows`);
}

/** The documented command lines as `[command, ...options]`, `--run` with its value, in order. */
function documentedCommands(): string[][] {
  const block = fencedBlocks().find((text) => text.includes("dist/src/cli/main.js"));
  if (block === undefined) assert.fail("section 3 has no block with CLI commands");
  return block
    .split("\n")
    .filter((line) => line.includes("dist/src/cli/main.js"))
    .map((line) => {
      const words = (line.split("dist/src/cli/main.js")[1] ?? "").split("|")[0]?.trim().split(/\s+/) ?? [];
      const options = words.flatMap((word, index) => (word === "--run" ? [`--run ${words[index + 1] ?? ""}`] : word.startsWith("--") ? [word] : []));
      return [words[0] ?? "", ...options];
    });
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
function copyDemo(t: TestContext, extraEnv: Readonly<Record<string, string>> = {}): Demo {
  return copyDemoInto(createSandbox(t), extraEnv);
}

function copyDemoInto(sb: Sandbox, extraEnv: Readonly<Record<string, string>> = {}): Demo {
  const dir = join(sb.base, "codaryn-demo");
  cpSync(DEMO_SOURCE, dir, { recursive: true });
  const workspace = join(dir, "workspace");
  const env = cliEnv({ extra: extraEnv });
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
    ["runs", "--workspace"],
    ["report", "--workspace", "--run latest"],
    ["revert", "--workspace", "--run latest", "--dry-run"],
    ["revert", "--workspace", "--run latest"],
  ]);
  assert.ok(existsSync(join(DEMO_SOURCE, "task.json")) && existsSync(join(DEMO_SOURCE, "script.json")));
});

test("N-E 체험 예시: 사본에서 doctor → run → runs → report → revert --dry-run → revert가 문서대로 된다(키·네트워크 없음)", { timeout: 120_000 }, async (t) => {
  const demo = copyDemo(t);
  const summaryPath = join(demo.workspace, "summary.md");
  const latest = ["--workspace", demo.workspace, "--run", "latest"];
  let runId = "";

  await t.test("doctor: 모든 항목이 ok 또는 skipped, 종료 0, API key와 기본 설정 없음은 건너뜀", async () => {
    documented("모든 항목이 `ok`이거나 `skipped`이고 종료 0이다");
    const text = await demo.cli(doctorArgs({ task: demo.task, json: false }));
    assert.equal(text.exitCode, 0, `doctor text exit; stdout ${text.stdout.slice(0, 1000)}`);
    const output = expectDoctorOutput(await demo.cli(doctorArgs({ task: demo.task })));
    assert.equal(output.exitCode, 0);
    for (const check of output.checks) assert.ok(["ok", "skipped"].includes(check.status), `${check.id}: ${check.status} ${check.message}`);
    const apiKey = checkOf(output, "api_key");
    assert.equal(apiKey.status, "skipped");
    assert.equal(apiKey.message, documented("the task uses the scripted model; no key is needed"));
    documented("기본 설정 파일이 없으면 `config file` 항목도 건너뛴다");
    assert.equal(checkOf(output, "config_file").status, "skipped");
  });

  await t.test("run: stderr가 문서의 블록(진행 줄과 끝 요약)과 같고, 결과는 done/verified, JSON은 ASCII", async () => {
    const run = await demo.cli(["run", "--task", demo.task]);
    const result = expectRunResult(run, "scripted");
    runId = result.runId;
    readRunFiles(demo.workspace, result);
    documented("stderr에는 진행 줄과 끝 요약이 나온다");
    assertSameLines(progressLines(run), documentedBlock("run", (block) => block.startsWith("codaryn: run started")), "the run's stderr");
    assert.ok(run.stderr.includes(`Run id: ${result.runId}`), "the summary names this run");
    // U-104: of the five protected-material checks that found nothing, only the first is a progress
    // line; the end summary counts all five.
    documented("바뀐 것이 없으면 진행 줄에는 첫 확인만 나오고");
    assert.equal(progressLines(run).filter((line) => line.startsWith("codaryn: protected material check")).length, 1);
    assert.ok(progressLines(run).includes(documented("Protected material checks that found no change: 5")), "the summary counts the checks");

    documented("stdout의 JSON은 `status` `done`, `reason` `verified`, `exitCode` 0이다");
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
    documented("JSON의 한글은 `\\uXXXX`로 나오므로");
    assert.ok([...run.stdout].every((char) => char.charCodeAt(0) < 0x80), "stdout is ASCII only (N-19)");

    const written = readFileSync(summaryPath, "utf8");
    assert.ok(written.includes("## 결정 사항") && written.includes("## 할 일"));
    assert.deepEqual(readFileSync(join(demo.workspace, "notes.md")), demo.original.get("notes.md"), "notes.md is protected and unchanged");
  });

  await t.test("runs: 실행 목록이 문서의 블록과 같다", async () => {
    assert.notEqual(runId, "", "the run step must pass first");
    const run = await demo.cli(["runs", "--workspace", demo.workspace]);
    assert.equal(run.exitCode, 0);
    assertSameLines(progressLines({ ...run, stderr: run.stdout }), documentedBlock("runs", (block) => block.startsWith("run id")), "the runs table");
    assert.ok(run.stdout.includes(runId));
  });

  await t.test("report --run latest: 고른 실행을 stderr에 먼저 보이고, 문서가 인용한 줄이 Markdown에 있다", async () => {
    assert.notEqual(runId, "", "the run step must pass first");
    const markdown = await demo.cli(["report", ...latest]);
    assert.equal(markdown.exitCode, 0);
    assertSameLines(
      progressLines(markdown),
      documentedBlock("report", (block) => block.trim().startsWith("codaryn: Chose the latest run:") && !block.includes("\n  ")),
      "report's stderr",
    );
    assert.ok(markdown.stderr.includes(runId), "the chosen run is this run");
    // The section quotes the report as Markdown renders it: inline code marks are not part of the
    // quote (the report prints "Provider: `scripted` (...)", the section "Provider: scripted (...)").
    const rendered = markdown.stdout.replace(/`/g, "");
    for (const quoted of ["Provider: scripted (scripted model; no API was called)", "Repairs started: 1", "Tool calls: 3 of 8 (denied: 1)"]) {
      assert.ok(rendered.includes(documented(quoted)), `the report lacks ${JSON.stringify(quoted)}`);
    }
    // N-24 (a): the Markdown names a verifier by its number, never by its id; `--json` keeps the id.
    documented("보고서도 검증기를 순번(`verifier 1`)으로 쓴다. id는 `--json`에만 있다");
    assert.match(rendered, /^- verifier 1 \(file_rules\): \*\*pass\*\*$/m);
    assert.ok(!/^- summary \(file_rules\)/m.test(rendered), "the report does not print the verifier id");
    const output = expectReportOutput(await demo.cli(["report", ...latest, "--json"]), runId);
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

  await t.test("revert --dry-run: 문서의 stderr, dryRun JSON, 종료 0, 아무것도 바꾸지 않음", async () => {
    assert.notEqual(runId, "", "the run step must pass first");
    const before = workspaceBytes(demo.workspace);
    const run = await demo.cli(["revert", ...latest, "--dry-run"]);
    const output = expectRevertOutput(run, runId);
    documented('`"dryRun":true`가 붙은 결과 JSON 한 줄이고 종료 코드는 실제 되돌리기와 같다(0)');
    assert.equal(output.dryRun, true);
    assert.equal(run.exitCode, 0);
    assertSameLines(progressLines(run), documentedBlock("dry run", (block) => block.includes("Files to revert")), "the dry run's stderr");
    assert.deepEqual(workspaceBytes(demo.workspace), before);
    assert.equal(existsSync(join(demo.workspace, STATE_DIR_NAME, RUNS_DIR_NAME, runId, REVERT_RECORD_FILE_NAME)), false);
  });

  await t.test("revert: summary.md를 지우고 complete, 종료 0, .codaryn은 남는다, 문서의 stderr", async () => {
    assert.notEqual(runId, "", "the run step must pass first");
    documented('`"status":"complete"`, `"reverted":[{"path":"summary.md","action":"deleted"}]`, 종료 0');
    const run = await demo.cli(["revert", ...latest]);
    const output = expectRevertOutput(run, runId);
    assert.equal(output.status, "complete");
    assert.equal(run.exitCode, 0);
    assert.deepEqual(output.reverted, [{ path: "summary.md", action: "deleted" }]);
    assertSameLines(progressLines(run), documentedBlock("revert", (block) => block.includes("Files reverted: 1")), "the revert's stderr");
    assert.deepEqual(workspaceBytes(demo.workspace), demo.original, "the workspace is back to the copied bytes");
    documented("`.codaryn/`의 기록은 남는다");
    assert.ok(existsSync(join(demo.workspace, STATE_DIR_NAME)));
  });

  await t.test("같은 실행을 다시 되돌리면 already_reverted, complete, 종료 0, revertedBefore, 목록에 표시(N-22)", async () => {
    assert.notEqual(runId, "", "the run step must pass first");
    documented("`complete`, 종료 0이고 `skipped[].reason`은 `already_reverted`, 결과에 이전 되돌리기의 시각과 상태(`revertedBefore`)가 붙는다");
    const run = await demo.cli(["revert", ...latest]);
    const output = expectRevertOutput(run, runId);
    assert.equal(output.status, "complete");
    assert.equal(run.exitCode, 0);
    assert.deepEqual(output.reverted, []);
    assert.deepEqual(output.skipped, [{ path: "summary.md", reason: "already_reverted" }]);
    assert.equal(output.revertedBefore?.status, "complete");
    assertSameLines(progressLines(run), documentedBlock("second revert", (block) => block.includes("already_reverted")), "the second revert's stderr");
    assert.deepEqual(workspaceBytes(demo.workspace), demo.original);
    const runs = await demo.cli(["runs", "--workspace", demo.workspace]);
    const row = runs.stdout.split(/\r?\n/).find((line) => line.startsWith(runId)) ?? "";
    assert.ok(row.endsWith(documented("· reverted (complete)")), `the runs row says it was reverted: ${JSON.stringify(row)}`);
  });
});

test("N-E 체험 예시: init으로 만든 기본 설정이 있으면 문서의 두 줄이 더 나오고 결과는 같다", { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  const user = userConfigLocation(sb);
  const demo = copyDemoInto(sb, user.env);
  const init = await runGuarded(sb, ["init", "--json"], cliEnv({ extra: user.env }));
  assert.equal(init.exitCode, 0, `init: ${init.stdout}`);
  // The section shows the Windows symbol; elsewhere the same line carries the XDG one.
  const symbol = (line: string): string => line.split(DEFAULT_CONFIG_DISPLAY.windows).join(user.display);
  const progressLine = symbol(documented(`codaryn: using the config file in the default location: ${DEFAULT_CONFIG_DISPLAY.windows}`));
  const summaryLine = symbol(documented(`Used the config file in the default location: ${DEFAULT_CONFIG_DISPLAY.windows}`));
  const run = await demo.cli(["run", "--task", demo.task]);
  const lines = progressLines(run);
  assert.ok(lines.includes(progressLine), `the progress line: ${JSON.stringify(lines.slice(0, 3))}`);
  assert.ok(lines.includes(summaryLine), "the summary line");
  documented("`init`의 기본 한도는 이 예시의 한도보다 크므로 실행 결과는 같다");
  assert.equal(expectRunResult(run, "scripted").status, "done");
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
