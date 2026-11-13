/**
 * U-128 (U-122's examples, docs/usage.md 18.9 and 18.10): the two keyless examples followed from a
 * copy outside the repository, in the order the sections give, as N-E does for examples/demo:
 * - 18.9 `examples/analyze-demo`: doctor → run → report --run latest → review --accept → runs (the
 *   analyze task type, data_checks, one repair, the person's review);
 * - 18.10 `examples/workflow-demo`: the config file's release-notes definition chosen by the task's
 *   workflowRef (doctor → run → report), the run without --config, and a task that would widen the
 *   definition's tools.
 * Every claim the sections make about the output is checked twice: the section still says it, and
 * the CLI still does it. The quoted blocks are compared line by line; only what the sections say
 * differs per run is normalized (run id, local and ISO times, the seconds of the usage line).
 *
 * The models are the examples' scripts: no key, and every command runs behind the network guard.
 * Nothing here touches the repository's copies of the examples.
 */

import assert from "node:assert/strict";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import type { EngineResult, JournalRecord } from "../../src/contracts/index.js";
import { createSandbox } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import { REPO_ROOT, cliEnv, expectRunResult, parseCliOutput, readRunFiles } from "../support/cli.js";
import type { CliRun } from "../support/cli.js";
import { doctorArgs, expectDoctorOutput } from "../support/commands.js";
import { runGuarded } from "../support/fake-anthropic.js";
import { progressLines } from "../support/progress.js";
import { workspaceBytes } from "../support/repair-check.js";

const USAGE = join(REPO_ROOT, "docs", "usage.md");
const ANALYZE_SOURCE = join(REPO_ROOT, "examples", "analyze-demo");
const WORKFLOW_SOURCE = join(REPO_ROOT, "examples", "workflow-demo");
const ANALYZE = "### 18.9 키 없이 체험하기: 자료 분석";
const WORKFLOW = "### 18.10 사용자 정의 작업 종류 체험";

/**
 * A `### ` section of docs/usage.md, from its heading to the next `### ` or `## ` heading outside a
 * fenced block (18.9 quotes a report, whose `## Verification` is not a heading of this file).
 */
function sectionOf(heading: string): string {
  const lines = readFileSync(USAGE, "utf8").replace(/\r\n/g, "\n").split("\n");
  const start = lines.indexOf(heading);
  assert.ok(start >= 0, `docs/usage.md has no "${heading}" section`);
  let fenced = false;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/^ *```/.test(line)) fenced = !fenced;
    else if (!fenced && /^#{2,3} /.test(line)) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** The section still states `text`; returns it so the same words are then checked in the output. */
function documented(heading: string, text: string): string {
  assert.ok(sectionOf(heading).includes(text), `docs/usage.md "${heading}" no longer says ${JSON.stringify(text)}`);
  return text;
}

/** Fenced blocks of the section in order, without their fences; a block indented under a list item loses that indent. */
function fencedBlocks(heading: string): string[] {
  return [...sectionOf(heading).matchAll(/^( *)```[^\n]*\n([\s\S]*?)^\1```$/gm)].map((match) => {
    const indent = match[1] ?? "";
    return (match[2] ?? "")
      .split("\n")
      .map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line))
      .join("\n");
  });
}

/** The one block of the section that `pick` selects, as non-empty lines. */
function documentedBlock(heading: string, label: string, pick: (block: string) => boolean): string[] {
  const found = fencedBlocks(heading).filter(pick);
  assert.equal(found.length, 1, `"${heading}" must have exactly one ${label} block`);
  return (found[0] ?? "").split("\n").filter((line) => line.trim() !== "");
}

/**
 * What the sections say changes from run to run ("실행 id와 시간은 실행마다 다르다"): the run id, the
 * local start time, the verdict's ISO time and the seconds of the usage line; nothing else.
 */
function normalize(lines: readonly string[]): string[] {
  return lines.map((line) =>
    line
      .replace(/\d{8}T\d{6}Z-[0-9a-f]{8}/g, "<run id>")
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<iso time>")
      .replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g, "<local time>")
      .replace(/ · \d+(?:\.\d+)? s$/, " · <seconds> s"),
  );
}

function assertSameLines(actual: readonly string[], quoted: readonly string[], what: string): void {
  assert.deepEqual(normalize(actual), normalize(quoted), `${what} is what the section shows`);
}

/** `quoted` stands in `actual` as one run of consecutive lines (normalized). */
function assertContainsBlock(actual: readonly string[], quoted: readonly string[], what: string): void {
  const a = normalize(actual);
  const q = normalize(quoted);
  const at = a.indexOf(q[0] ?? "");
  assert.ok(at >= 0, `${what}: the output has no line ${JSON.stringify(q[0])}`);
  assert.deepEqual(a.slice(at, at + q.length), q, `${what} is what the section shows`);
}

function linesOf(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.trim() !== "");
}

/** The documented command lines as `[command, ...options]`, `--run` with its value, in order. */
function documentedCommands(heading: string): string[][] {
  const block = fencedBlocks(heading).find((text) => text.includes("dist/src/cli/main.js"));
  if (block === undefined) assert.fail(`"${heading}" has no block with CLI commands`);
  return block
    .split("\n")
    .filter((line) => line.includes("dist/src/cli/main.js"))
    .map((line) => {
      const words = (line.split("dist/src/cli/main.js")[1] ?? "").trim().split(/\s+/);
      const options = words.flatMap((word, index) => (word === "--run" ? [`--run ${words[index + 1] ?? ""}`] : word.startsWith("--") ? [word] : []));
      return [words[0] ?? "", ...options];
    });
}

interface Copy {
  readonly dir: string;
  readonly task: string;
  readonly config: string;
  readonly workspace: string;
  /** Workspace bytes right after the copy. */
  readonly original: Map<string, Buffer>;
  readonly cli: (args: readonly string[]) => Promise<CliRun>;
}

/** Copies an example out of the repository, as the sections say (`Copy-Item -Recurse`). */
function copyOf(t: TestContext, source: string, name: string, language: "en" | "ko" = "en"): Copy {
  const sb: Sandbox = createSandbox(t);
  const dir = join(sb.base, name);
  cpSync(source, dir, { recursive: true });
  const workspace = join(dir, "workspace");
  const env = cliEnv({ extra: { CODARYN_LANG: language } });
  return {
    dir,
    task: join(dir, "task.json"),
    config: join(dir, "config.json"),
    workspace,
    original: workspaceBytes(workspace),
    cli: (args) => runGuarded(sb, args, env),
  };
}

function recordsOf(copy: Copy, result: EngineResult): readonly JournalRecord[] {
  return readRunFiles(copy.workspace, result).records;
}

// ---------------------------------------------------------------------------------------------
// 18.9 examples/analyze-demo

test("U-128 18.9 자료 분석 예시: 문서의 명령이 이 사례가 실행하는 명령과 같다", () => {
  assert.deepEqual(documentedCommands(ANALYZE), [
    ["doctor", "--task"],
    ["run", "--task"],
    ["report", "--workspace", "--run latest"],
    ["review", "--task", "--run latest", "--accept", "--note"],
    ["runs", "--workspace"],
  ]);
});

test("U-128 18.9 자료 분석 예시: 사본에서 doctor → run → report → review → runs가 문서대로 된다(키·네트워크 없음)", { timeout: 180_000 }, async (t) => {
  const demo = copyOf(t, ANALYZE_SOURCE, "codaryn-analyze-demo");
  const latest = ["--workspace", demo.workspace, "--run", "latest"];
  let result: EngineResult | null = null;

  await t.test("doctor: 모든 항목이 ok나 skipped, 종료 0", async () => {
    documented(ANALYZE, "`doctor`는 모든 항목이 `ok`나 `skipped`이고 종료 0이다");
    const text = await demo.cli(doctorArgs({ task: demo.task, json: false }));
    assert.equal(text.exitCode, 0, `doctor text exit; stdout ${text.stdout.slice(0, 1000)}`);
    const output = expectDoctorOutput(await demo.cli(doctorArgs({ task: demo.task })));
    assert.equal(output.exitCode, 0);
    for (const check of output.checks) assert.ok(["ok", "skipped"].includes(check.status), `${check.id}: ${check.status} ${check.message}`);
  });

  await t.test("run: stderr가 문서의 블록과 같고, 종료 3, needs-input/awaiting_review, 재수정 1회", async () => {
    const run = await demo.cli(["run", "--task", demo.task]);
    const ran = expectRunResult(run, "scripted");
    result = ran;
    assertSameLines(progressLines(run), documentedBlock(ANALYZE, "run", (block) => block.startsWith("codaryn: run started")), "the run's stderr");
    documented(ANALYZE, "종료 코드는 3(`needs-input`)이다");
    assert.equal(run.exitCode, 3);
    assert.deepEqual([ran.status, ran.reason], ["needs-input", "awaiting_review"]);
    assert.equal(ran.usage.repairAttempts, 1);
    documented(ANALYZE, "재수정은 1회까지다(`maxRepairAttempts: 1`)");
  });

  await t.test("첫 회차 data_checks의 근거(journal의 첫 verifier_result)가 문서의 블록과 같다", () => {
    assert.ok(result !== null, "the run step must pass first");
    documented(ANALYZE, "기록(`journal.jsonl`의 첫 `verifier_result`)에 있다");
    const first = recordsOf(demo, result).find((record) => record.type === "verifier_result");
    if (first === undefined || first.type !== "verifier_result") assert.fail("the run recorded no verifier_result");
    assert.equal(first.result.kind, "data_checks");
    assert.equal(first.result.outcome, "fail");
    assertSameLines(linesOf(first.result.evidence), documentedBlock(ANALYZE, "evidence", (block) => block.startsWith("held: table")), "the first round's evidence");
  });

  await t.test("고친 summary.csv가 문서대로이고, 보호 경로 sales.csv는 그대로다", () => {
    assert.ok(result !== null, "the run step must pass first");
    documented(ANALYZE, "고친 뒤 `summary.csv`는 `region,total` / `north,150` / `south,125` / `east,85`다");
    assert.deepEqual(linesOf(readFileSync(join(demo.workspace, "summary.csv"), "utf8")), ["region,total", "north,150", "south,125", "east,85"]);
    documented(ANALYZE, "`sales.csv`는 보호 경로다(`protectedPaths`)");
    assert.deepEqual(readFileSync(join(demo.workspace, "sales.csv")), demo.original.get("sales.csv"), "sales.csv is protected and unchanged");
  });

  await t.test("report --run latest: 검증 절과 사람 확인 절이 문서의 블록과 같고, Not checked 절이 검증기마다 있다", async () => {
    assert.ok(result !== null, "the run step must pass first");
    const report = await demo.cli(["report", ...latest]);
    assert.equal(report.exitCode, 0);
    assert.ok(report.stderr.includes(result.runId), "--run latest chose this run");
    const lines = linesOf(report.stdout);
    assertContainsBlock(lines, documentedBlock(ANALYZE, "report", (block) => block.startsWith("## Verification")), "the report's verification and review sections");
    documented(ANALYZE, "보고서의 \"Not checked\" 절은 `data_checks`가 확인하지 않는 것");
    const notChecked = report.stdout.slice(report.stdout.indexOf("## Not checked"));
    assert.ok(report.stdout.includes("## Not checked"), "the report has a Not checked section");
    assert.match(notChecked, /^- verifier 1: `/m, "the data_checks verifier has its lines");
    assert.match(notChecked, /^- verifier 2: `/m, "the file_rules verifier has its lines");
  });

  await t.test("review --accept: stdout이 문서의 블록과 같고 종료 0", async () => {
    assert.ok(result !== null, "the run step must pass first");
    documented(ANALYZE, "stdout(종료 0)");
    const review = await demo.cli(["review", "--task", demo.task, "--run", "latest", "--accept", "--note", "checked-by-hand"]);
    assert.equal(review.exitCode, 0);
    assertSameLines(linesOf(review.stdout), documentedBlock(ANALYZE, "review", (block) => block.startsWith("Review of run")), "review's stdout");
    assert.ok(review.stdout.includes(result.runId));
  });

  await t.test("runs: 판정 뒤에도 needs-input/awaiting_review이고, 표가 문서의 블록과 같다", async () => {
    assert.ok(result !== null, "the run step must pass first");
    documented(ANALYZE, "실행의 상태는 그대로 `needs-input`/`awaiting_review`이고, `runs`도 그렇게 보인다");
    const runs = await demo.cli(["runs", "--workspace", demo.workspace]);
    assert.equal(runs.exitCode, 0);
    assertSameLines(linesOf(runs.stdout), documentedBlock(ANALYZE, "runs", (block) => block.startsWith("run id")), "the runs table");
    assert.ok(runs.stdout.includes(result.runId));
    const stored = JSON.parse(readFileSync(join(demo.workspace, ...result.journalPath.split("/").slice(0, -1), "result.json"), "utf8")) as EngineResult;
    assert.deepEqual(stored, result, "the verdict did not change result.json");
  });

  await t.test("판정 뒤 보고서의 사람 확인 절 끝이 문서대로다", async () => {
    assert.ok(result !== null, "the run step must pass first");
    const verdictLine = documented(ANALYZE, "Verdict: **accepted** (`2026-11-13T02:50:19.833Z`), note: `checked-by-hand`");
    const report = await demo.cli(["report", ...latest]);
    assert.equal(report.exitCode, 0);
    const lines = normalize(linesOf(report.stdout));
    assert.ok(lines.includes(normalize([verdictLine])[0] ?? ""), `the report after the verdict lacks ${JSON.stringify(verdictLine)}`);
    assert.equal(lines.includes("No verdict yet."), false, "No verdict yet. is gone after the verdict");
  });
});

test("U-128 18.9 자료 분석 예시: 한국어 끝 요약의 마지막 줄들과 review의 첫 줄이 문서대로다", { timeout: 120_000 }, async (t) => {
  const demo = copyOf(t, ANALYZE_SOURCE, "codaryn-analyze-demo", "ko");
  const run = await demo.cli(["run", "--task", demo.task]);
  const result = expectRunResult(run, "scripted");
  assert.equal(run.exitCode, 3);
  // The section writes the run id as <id> in these lines.
  const asDocumented = (line: string): string => line.split(result.runId).join("<id>");
  const lines = progressLines(run).map(asDocumented);
  for (const quoted of ["결과를 확인하고 codaryn review로 판정을 기록하세요.", "확인할 항목 2개:", "판정 기록: codaryn review --task <task.json> --run <id> --accept 또는 --reject"]) {
    assert.ok(lines.includes(documented(ANALYZE, quoted)), `the Korean summary lacks ${JSON.stringify(quoted)}`);
  }
  const review = await demo.cli(["review", "--task", demo.task, "--run", "latest", "--accept", "--note", "checked-by-hand"]);
  assert.equal(review.exitCode, 0);
  assert.equal(asDocumented(linesOf(review.stdout)[0] ?? ""), documented(ANALYZE, "실행 <id>의 검토: 받아들임."));
});

// ---------------------------------------------------------------------------------------------
// 18.10 examples/workflow-demo

test("U-128 18.10 사용자 정의 작업 종류 예시: 문서의 명령과 정의 블록이 예시와 같다", () => {
  assert.deepEqual(documentedCommands(WORKFLOW), [
    ["doctor", "--task", "--config"],
    ["run", "--task", "--config"],
    ["report", "--workspace", "--run latest"],
  ]);
  // The section quotes the one workflows entry; the file spreads it over lines.
  const quoted = fencedBlocks(WORKFLOW).find((block) => block.trimStart().startsWith('"release-notes"'));
  if (quoted === undefined) assert.fail("18.10 has no release-notes definition block");
  const definition = (JSON.parse(`{${quoted}}`) as Record<string, unknown>)["release-notes"];
  const config = JSON.parse(readFileSync(join(WORKFLOW_SOURCE, "config.json"), "utf8")) as { workflows?: Record<string, unknown> };
  assert.deepEqual(definition, config.workflows?.["release-notes"], "the quoted definition is the example's");
  documented(WORKFLOW, '`task.json`은 `"workflowRef": "release-notes"`로 이 정의를 고른다. task 자신의 `verifiers`는 비어 있다');
  const task = JSON.parse(readFileSync(join(WORKFLOW_SOURCE, "task.json"), "utf8")) as { workflowRef?: string; verifiers?: unknown[] };
  assert.equal(task.workflowRef, "release-notes");
  assert.deepEqual(task.verifiers, []);
});

test("U-128 18.10 사용자 정의 작업 종류 예시: 사본에서 doctor → run → report와 두 거부가 문서대로 된다(키·네트워크 없음)", { timeout: 180_000 }, async (t) => {
  const demo = copyOf(t, WORKFLOW_SOURCE, "codaryn-workflow-demo");
  let result: EngineResult | null = null;

  await t.test("doctor --config: 모든 항목이 ok나 skipped, 종료 0, 설정 파일 줄이 문서대로", async () => {
    const line = documented(WORKFLOW, "[ok]      config file               the config file given by --config is valid");
    documented(WORKFLOW, "모두 `ok`나 `skipped`이고 종료 0이다");
    const text = await demo.cli(doctorArgs({ task: demo.task, config: demo.config, json: false }));
    assert.equal(text.exitCode, 0, `doctor text exit; stdout ${text.stdout.slice(0, 1000)}`);
    assert.ok(linesOf(text.stdout).includes(line), `doctor's text lacks ${JSON.stringify(line)}`);
    const output = expectDoctorOutput(await demo.cli(doctorArgs({ task: demo.task, config: demo.config })));
    assert.equal(output.exitCode, 0);
    for (const check of output.checks) assert.ok(["ok", "skipped"].includes(check.status), `${check.id}: ${check.status} ${check.message}`);
  });

  await t.test("run --config: stderr가 문서의 블록과 같고, 종료 0, done/verified, 정의의 검증기가 돈다", async () => {
    const run = await demo.cli(["run", "--task", demo.task, "--config", demo.config]);
    const ran = expectRunResult(run, "scripted");
    result = ran;
    assertSameLines(progressLines(run), documentedBlock(WORKFLOW, "run", (block) => block.startsWith("codaryn: run started")), "the run's stderr");
    documented(WORKFLOW, "종료 0");
    assert.equal(run.exitCode, 0);
    assert.deepEqual([ran.status, ran.reason], ["done", "verified"]);
    documented(WORKFLOW, "task에는 검증기가 없지만 정의의 것이 돌았다");
    assert.deepEqual(
      ran.verifiers.map((verifier) => [verifier.id, verifier.outcome]),
      [["notes", "pass"]],
    );
    assert.deepEqual(
      ran.changes.map((change) => [change.path, change.created]),
      [["RELEASE-NOTES.md", true]],
    );
    assert.deepEqual(readFileSync(join(demo.workspace, "CHANGES.txt")), demo.original.get("CHANGES.txt"), "CHANGES.txt is protected and unchanged");
  });

  await t.test("정의 밖 도구(search_files)는 unknown_tool로 거부되고 실행은 이어지며, 지시문이 시스템 글에 붙는다", () => {
    assert.ok(result !== null, "the run step must pass first");
    const records = recordsOf(demo, result);
    documented(WORKFLOW, "다른 도구를 부르면 거부된다");
    const refused = records.find((record) => record.type === "tool_result" && record.result.tool === "search_files");
    if (refused === undefined || refused.type !== "tool_result") assert.fail("the search_files call has no tool_result");
    assert.equal(refused.result.ok, false);
    assert.equal(refused.result.errorCode, "unknown_tool");
    documented(WORKFLOW, "거부는 실행을 끝내지 않고 모델에 돌아간다");
    assert.ok(records.some((record) => record.type === "model_request" && record.turn === 2), "the run went on to turn 2");
    documented(WORKFLOW, "지시문(`instructions`)은 고정 시스템 글 뒤에 붙어(가린 뒤) 모델에 간다");
    const config = JSON.parse(readFileSync(demo.config, "utf8")) as { workflows: Record<string, { instructions: string }> };
    const first = records.find((record) => record.type === "model_request");
    if (first === undefined || first.type !== "model_request") assert.fail("the run recorded no model_request");
    assert.ok((first.system ?? "").includes(config.workflows["release-notes"]?.instructions ?? "<missing>"), "the first request's system text carries the definition's instructions");
  });

  await t.test("report: 머리에 task와 작업 종류가 문서대로 나온다", async () => {
    assert.ok(result !== null, "the run step must pass first");
    const report = await demo.cli(["report", "--workspace", demo.workspace, "--run", "latest"]);
    assert.equal(report.exitCode, 0);
    const header = documented(WORKFLOW, "- Task: `workflow-demo` (task type `release-notes`)");
    assert.ok(linesOf(report.stdout).includes(header), `the report lacks ${JSON.stringify(header)}`);
  });

  await t.test("설정 파일을 빼면 종료 2이고 stderr가 문서의 블록과 같다", async () => {
    documented(WORKFLOW, "(`--config` 없음)은 종료 2이고 stderr는 다음과 같다");
    const run = await demo.cli(["run", "--task", demo.task]);
    assert.equal(run.exitCode, 2);
    assertSameLines(progressLines(run), documentedBlock(WORKFLOW, "no config", (block) => block.startsWith("codaryn: error")), "the run's stderr without --config");
  });

  await t.test("task가 정의의 도구를 넓히면 실행 전에 invalid_task(종료 2)이고 message가 문서대로다", async () => {
    documented(WORKFLOW, '`"tools": ["read_file", "write_file", "run_command"]`를 더하면 실행 전에 `invalid_task`(종료 2)');
    const message = documented(WORKFLOW, "tools[2] names a tool the workflow definition does not offer (tools only narrow)");
    const widened = join(demo.dir, "task-widened.json");
    writeFileSync(widened, JSON.stringify({ ...(JSON.parse(readFileSync(demo.task, "utf8")) as object), tools: ["read_file", "write_file", "run_command"] }));
    const before = workspaceBytes(demo.workspace);
    const run = await demo.cli(["run", "--task", widened, "--config", demo.config]);
    assert.equal(run.exitCode, 2);
    const output = parseCliOutput(run);
    if (output.kind !== "error") assert.fail(`expected an error, got ${JSON.stringify(output).slice(0, 300)}`);
    assert.equal(output.code, "invalid_task");
    assert.equal(output.message, message);
    assert.deepEqual(workspaceBytes(demo.workspace), before, "nothing ran");
  });
});

test("U-128 18.10 사용자 정의 작업 종류 예시: 한국어의 거부 줄이 문서대로다", { timeout: 120_000 }, async (t) => {
  const demo = copyOf(t, WORKFLOW_SOURCE, "codaryn-workflow-demo", "ko");
  const run = await demo.cli(["run", "--task", demo.task, "--config", demo.config]);
  expectRunResult(run, "scripted");
  assert.equal(run.exitCode, 0);
  const line = documented(WORKFLOW, "파일 검색 — 호출 검사에서 거부 (unknown_tool)");
  assert.ok(progressLines(run).includes(`codaryn: ${line}`), `the Korean progress lacks ${JSON.stringify(line)}`);
});
