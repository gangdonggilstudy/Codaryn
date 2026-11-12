/**
 * N-E (docs/work-orders/phase-4-usability.md, completion criterion 2): a first-time user goes
 * `init` → `doctor` → the keyless demo → `runs` → `report --run latest` → `revert --dry-run` →
 * `revert`, with the commands of docs/cli-contract.md section 17. The default config location is
 * the sandbox's (support/usability.ts). No key, no network (every command behind the guard).
 */

import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  CLI_ERROR_EXIT_CODES,
  CODARYN_CONFIG_ENV,
  DENY_ALL_POLICY,
  INIT_DEFAULT_LIMITS,
  INIT_DEFAULT_MAX_OUTPUT_TOKENS,
  LOCK_FILE_NAME,
  MODEL_PLACEHOLDER,
  REVERT_RECORD_FILE_NAME,
  RUNS_DIR_NAME,
  STATE_DIR_NAME,
} from "../../src/contracts/index.js";
import { createSandbox } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import { FAKE_API_KEY } from "../fixtures/secrets.js";
import { REPO_ROOT, cliEnv, expectCliError, expectRunResult, readRunFiles } from "../support/cli.js";
import type { CliRun } from "../support/cli.js";
import { checkOf, expectDoctorOutput, expectReportOutput } from "../support/commands.js";
import { runGuarded } from "../support/fake-anthropic.js";
import { assertHumanError, assertQuiet } from "../support/progress.js";
import { expectRevertOutput, treeBytes, workspaceBytes } from "../support/repair-check.js";
import { assertNotPrinted, expectInitOutput, expectRunsOutput, userConfigLocation } from "../support/usability.js";
import type { UserConfigLocation } from "../support/usability.js";

interface FirstUse {
  readonly sb: Sandbox;
  readonly user: UserConfigLocation;
  readonly cli: (args: readonly string[], extra?: Readonly<Record<string, string>>) => Promise<CliRun>;
}

function firstUse(sb: Sandbox): FirstUse {
  const user = userConfigLocation(sb);
  return { sb, user, cli: (args, extra = {}) => runGuarded(sb, args, cliEnv({ extra: { ...user.env, ...extra } })) };
}

const INIT_FILE = {
  schemaVersion: 1,
  model: MODEL_PLACEHOLDER,
  maxOutputTokens: INIT_DEFAULT_MAX_OUTPUT_TOKENS,
  limits: INIT_DEFAULT_LIMITS,
  policy: DENY_ALL_POLICY,
};

test("N-E E-1 처음 쓰는 흐름: init → doctor → 체험 예시 → runs → report latest → revert --dry-run → revert", { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  const u = firstUse(sb);
  const demo = join(sb.base, "demo");
  const workspace = join(demo, "workspace");
  const task = join(demo, "task.json");
  let runId = "";
  let original = new Map<string, Buffer>();

  await t.test("init: 기본 위치에 기본값으로 만든다(터미널이 아니면 묻지 않음, 키 없음)", async () => {
    const run = await u.cli(["init", "--json"]);
    const output = expectInitOutput(run);
    assert.equal(output.status, "created");
    assert.equal(run.exitCode, 0);
    assert.deepEqual(output.config, { source: "default", display: u.user.display });
    assert.equal(output.interactive, false);
    assert.equal(output.model, "placeholder");
    assert.equal(output.language, null);
    assert.equal(output.commands, 0);
    assert.equal(output.protectedPaths, 0);
    assert.equal(output.keySet, false);
    assert.equal(output.overriddenBy, null);
    assert.deepEqual(JSON.parse(readFileSync(u.user.path, "utf8")), INIT_FILE);
    assertNotPrinted(run, [u.user.root], "the expanded config location");
  });

  await t.test("init 다시: config_exists, 파일은 그대로", async () => {
    const before = readFileSync(u.user.path);
    const run = await u.cli(["init", "--json"]);
    expectCliError(run, "config_exists");
    assert.equal(run.exitCode, CLI_ERROR_EXIT_CODES.config_exists);
    assert.deepEqual(readFileSync(u.user.path), before);
    assertHumanError(run, "config_exists", [u.user.root]);
  });

  await t.test("doctor: 기본 위치의 설정을 읽고, 모델 자리표시자와 키 없음을 알린다", async () => {
    const before = treeBytes(sb.base);
    const run = await u.cli(["doctor", "--json"]);
    const output = expectDoctorOutput(run);
    assert.equal(output.exitCode, 1);
    assert.equal(checkOf(output, "config_file").status, "ok");
    assert.ok(checkOf(output, "config_file").message.includes(u.user.display), "names the default location by its symbol");
    assert.equal(checkOf(output, "model").status, "fail");
    assert.ok(checkOf(output, "model").message.includes("codaryn models"), "points to codaryn models (Y-4, N-3)");
    assert.equal(checkOf(output, "api_key").status, "fail");
    assert.ok(checkOf(output, "api_key").message.includes("ANTHROPIC_API_KEY"));
    assertNotPrinted(run, [u.user.root], "the expanded config location");
    assert.deepEqual(treeBytes(sb.base), before, "doctor writes nothing");
  });

  await t.test("체험 예시: 사본의 doctor는 종료 0, 실행은 done이고 기본 설정을 썼다고 알린다", async () => {
    cpSync(join(REPO_ROOT, "examples", "demo"), demo, { recursive: true });
    original = workspaceBytes(workspace);
    assert.equal(expectDoctorOutput(await u.cli(["doctor", "--task", task, "--json"])).exitCode, 0);
    const run = await u.cli(["run", "--task", task]);
    const result = expectRunResult(run, "scripted");
    readRunFiles(workspace, result);
    runId = result.runId;
    assert.equal(result.status, "done");
    assert.ok(result.notices.some((notice) => notice.includes(u.user.display)), `a notice names the default location: ${JSON.stringify(result.notices)}`);
    assert.ok(run.stderr.includes(u.user.display), "a progress line says the default config was used (17.1)");
    assertNotPrinted(run, [u.user.root], "the expanded config location");
  });

  await t.test("runs: 실행 하나, 최신순, 되돌린 적 없음", async () => {
    assert.notEqual(runId, "", "the demo run must pass first");
    const output = expectRunsOutput(await u.cli(["runs", "--workspace", workspace, "--json"]));
    assert.equal(output.runs.length, 1);
    assert.equal(output.omitted, 0);
    const [entry] = output.runs;
    assert.equal(entry?.state, "checked");
    if (entry?.state !== "checked") return;
    assert.equal(entry.runId, runId);
    assert.equal(entry.status, "done");
    // N-D 5: the list counts distinct changed paths, as the end summary does (summary.md written twice is 1).
    assert.equal(entry.changes, 1);
    assert.equal(entry.reverted, null);
    const text = await u.cli(["runs", "--workspace", workspace]);
    assert.equal(text.exitCode, 0);
    assert.ok(text.stdout.includes(runId), "the table names the run");
  });

  await t.test("report --run latest: 그 실행을 고른다", async () => {
    assert.notEqual(runId, "");
    const output = expectReportOutput(await u.cli(["report", "--workspace", workspace, "--run", "latest", "--json"]), runId);
    assert.equal(output.status, "complete");
  });

  await t.test("--run latest를 풀면 고른 실행 id를 무엇을 하기 전에 stderr에 보인다(N-23 (b)), --quiet면 생략", async () => {
    assert.notEqual(runId, "");
    const report = await u.cli(["report", "--workspace", workspace, "--run", "latest"]);
    assert.equal(report.exitCode, 0);
    assert.ok(report.stderr.includes(runId), `report names the chosen run on stderr: ${JSON.stringify(report.stderr.slice(0, 300))}`);
    const dry = await u.cli(["revert", "--workspace", workspace, "--run", "latest", "--dry-run"]);
    const lines = dry.stderr.split(/\r?\n/).filter((line) => line.trim() !== "");
    assert.ok((lines[0] ?? "").includes(runId), `the first stderr line of revert names the chosen run: ${JSON.stringify(lines.slice(0, 2))}`);
    assertQuiet(await u.cli(["revert", "--workspace", workspace, "--run", "latest", "--dry-run", "--quiet"]));
  });

  await t.test("revert --dry-run: 같은 판정, 아무것도 바꾸지 않음(파일, 기록, 잠금)", async () => {
    assert.notEqual(runId, "");
    const before = treeBytes(workspace);
    const run = await u.cli(["revert", "--workspace", workspace, "--run", "latest", "--dry-run"]);
    const output = expectRevertOutput(run, runId);
    assert.equal(output.dryRun, true);
    assert.equal(output.status, "complete");
    assert.equal(run.exitCode, 0);
    assert.deepEqual(output.reverted, [{ path: "summary.md", action: "deleted" }]);
    assert.deepEqual(treeBytes(workspace), before, "files and the state directory are as they were");
    assert.equal(existsSync(join(workspace, STATE_DIR_NAME, RUNS_DIR_NAME, runId, REVERT_RECORD_FILE_NAME)), false);
    assert.equal(existsSync(join(workspace, STATE_DIR_NAME, LOCK_FILE_NAME)), false);
  });

  await t.test("revert --run latest: 원래 바이트, 되돌리기 기록, runs에 표시", async () => {
    assert.notEqual(runId, "");
    const run = await u.cli(["revert", "--workspace", workspace, "--run", "latest"]);
    const output = expectRevertOutput(run, runId);
    assert.equal(output.status, "complete");
    assert.equal(output.dryRun ?? false, false);
    assert.deepEqual(workspaceBytes(workspace), original, "the workspace is back to the copied demo");
    assert.ok(existsSync(join(workspace, STATE_DIR_NAME, RUNS_DIR_NAME, runId, REVERT_RECORD_FILE_NAME)));
    const listed = expectRunsOutput(await u.cli(["runs", "--workspace", workspace, "--json"])).runs[0];
    assert.equal(listed?.state === "checked" ? listed.reverted?.status : undefined, "complete");
  });

  await t.test("다시 revert: already_reverted라 complete·종료 0(N-22), revertedBefore로 알린다, 무변경", async () => {
    assert.notEqual(runId, "");
    const before = workspaceBytes(workspace);
    const run = await u.cli(["revert", "--workspace", workspace, "--run", "latest"]);
    const output = expectRevertOutput(run, runId);
    assert.equal(output.status, "complete");
    assert.equal(run.exitCode, 0);
    assert.deepEqual(output.reverted, []);
    assert.deepEqual(output.skipped, [{ path: "summary.md", reason: "already_reverted" }]);
    assert.equal(output.revertedBefore?.status, "complete");
    assert.deepEqual(workspaceBytes(workspace), before);
  });
});

test("N-E E-9 init 세부: --config, CODARYN_CONFIG, 작업 공간 안 거부, 제안 미적용, 키는 읽지도 쓰지도 않음", { timeout: 120_000 }, async (t) => {
  await t.test("--config 위치에 만든다", async (st) => {
    const sb = createSandbox(st);
    const u = firstUse(sb);
    const target = join(sb.base, "cfg", "mine.json");
    const output = expectInitOutput(await u.cli(["init", "--config", target, "--json"]));
    assert.deepEqual(output.config, { source: "argument", display: "--config" });
    assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), INIT_FILE);
    assert.equal(existsSync(u.user.path), false, "the default location is untouched");
  });

  await t.test("CODARYN_CONFIG가 있으면 overriddenBy로 알린다", async (st) => {
    const sb = createSandbox(st);
    const u = firstUse(sb);
    const other = join(sb.base, "other.json");
    writeFileSync(other, JSON.stringify({ schemaVersion: 1 }));
    const output = expectInitOutput(await u.cli(["init", "--json"], { [CODARYN_CONFIG_ENV]: other }));
    assert.equal(output.status, "created");
    assert.equal(output.overriddenBy, "CODARYN_CONFIG");
    assert.ok(existsSync(u.user.path));
  });

  await t.test("--workspace 안의 대상은 invalid_config, 아무것도 쓰지 않음", async (st) => {
    const sb = createSandbox(st);
    const u = firstUse(sb);
    const inside = join(sb.workspace, "cfg.json");
    const run = await u.cli(["init", "--workspace", sb.workspace, "--config", inside, "--json"]);
    expectCliError(run, "invalid_config");
    assert.equal(existsSync(inside), false);
  });

  await t.test("비대화형에서는 --workspace의 제안을 적용하지 않고 내용도 출력하지 않는다", async (st) => {
    const sb = createSandbox(st);
    const u = firstUse(sb);
    const marker = "cdy-script-body-marker";
    writeFileSync(join(sb.workspace, "package.json"), JSON.stringify({ name: "x", scripts: { test: `node ${marker}.js`, build: "tsc" } }));
    mkdirSync(join(sb.workspace, "tests"));
    const run = await u.cli(["init", "--workspace", sb.workspace, "--json"]);
    const output = expectInitOutput(run);
    assert.equal(output.interactive, false);
    assert.equal(output.commands, 0);
    assert.equal(output.protectedPaths, 0);
    assertNotPrinted(run, [marker], "a script body");
    assert.deepEqual(JSON.parse(readFileSync(u.user.path, "utf8")), INIT_FILE);
  });

  await t.test("가짜 키가 있어도 keySet만 알리고, 키는 파일·출력에 없으며 요청도 없다", async (st) => {
    const sb = createSandbox(st);
    const user = userConfigLocation(sb);
    const run = await runGuarded(sb, ["init", "--json"], cliEnv({ extra: user.env, fakeApiKey: FAKE_API_KEY }));
    const output = expectInitOutput(run);
    assert.equal(output.keySet, true);
    assert.equal(output.model, "placeholder", "no list is requested without questions");
    assert.ok(!readFileSync(user.path, "utf8").includes(FAKE_API_KEY));
    assertNotPrinted(run, [FAKE_API_KEY], "the key");
  });

  await t.test("기본 위치가 없으면(APPDATA·XDG_CONFIG_HOME 상대 경로) invalid_config", async (st) => {
    const sb = createSandbox(st);
    const run = await runGuarded(sb, ["init", "--json"], cliEnv({ extra: process.platform === "win32" ? { APPDATA: "relative\\dir" } : { XDG_CONFIG_HOME: "relative/dir", HOME: "" } }));
    expectCliError(run, "invalid_config");
    assert.equal(existsSync(join(sb.base, "relative")), false);
  });
});
