/**
 * G-G: file organizing with the built-in `organize` workflow (docs/design/general-tasks.md 5.3
 * and 6, src/contracts/plan.ts, DR-5, DR-9, DR-12, DR-17, DR-24, N-22). A plan run proposes, a
 * person approves by digest, an apply run moves and discards, and revert undoes it. Real CLI
 * processes, scripted model, no key, every command behind the network guard. The expected file
 * layout is worked out by `afterActions` (fixtures), never by product code.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { CLI_ERROR_EXIT_CODES, PLAN_APPLIED_FILE_NAME, PLAN_FILE_NAME } from "../../src/contracts/index.js";
import type { CliErrorCode, EngineResult } from "../../src/contracts/index.js";
import { createSandbox } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import {
  ORGANIZE_ACTIONS,
  ORGANIZE_FILES,
  REFUSED_PLAN_CASES,
  afterActions,
  organizeScript,
  organizeWriteAttemptScript,
  refusedThenValidPlanScript,
  sha256Of,
  writeOrganizeTask,
  writeOrganizeWorkspace,
} from "../fixtures/general-tasks.js";
import { FAKE_SECRET_A, FAKE_SECRET_ENV_A } from "../fixtures/secrets.js";
import { cliEnv, expectCliError, expectRunResult, readRunFiles, startCli } from "../support/cli.js";
import type { CliRun } from "../support/cli.js";
import { runGuarded } from "../support/fake-anthropic.js";
import {
  applyArgs,
  discardedDirOf,
  expectApplyResult,
  expectPlanOutput,
  planArgs,
  planDigestOf,
  readApplyJournal,
  recordsOf,
  runDirPath,
  shortDigest,
} from "../support/general.js";
import { decodedSource, findLeaks } from "../support/leak.js";
import { expectRevertOutput, treeBytes, workspaceBytes } from "../support/repair-check.js";
import { expectRunsOutput } from "../support/usability.js";

interface Proposed {
  readonly sb: Sandbox;
  readonly task: string;
  readonly original: Map<string, Buffer>;
  readonly plan: EngineResult;
  readonly digest: string;
  readonly cli: (args: readonly string[]) => Promise<CliRun>;
}

/** The organize workspace and one plan run that stored ORGANIZE_ACTIONS (plan_pending). */
async function proposed(t: TestContext, env: NodeJS.ProcessEnv = cliEnv()): Promise<Proposed> {
  const sb = createSandbox(t);
  const original = writeOrganizeWorkspace(sb);
  const task = writeOrganizeTask(sb, "gg-organize", organizeScript());
  const cli = (args: readonly string[]): Promise<CliRun> => runGuarded(sb, args, env);
  const run = await cli(["run", "--task", task]);
  const plan = expectRunResult(run);
  assert.equal(run.exitCode, 3);
  return { sb, task, original, plan, digest: planDigestOf(plan), cli };
}

function assertRefused(run: CliRun, code: CliErrorCode): void {
  expectCliError(run, code);
  assert.equal(run.exitCode, CLI_ERROR_EXIT_CODES[code]);
}

const DISCARDED = ORGANIZE_ACTIONS.flatMap((action, index) => (action.kind === "discard" ? [{ index, path: action.path }] : []));

test("G-G GI-02 파일 정리: 계획 실행 → plan → apply --digest → revert(바이너리·한글·빈 파일 포함)", { timeout: 180_000 }, async (t) => {
  const p = await proposed(t);
  let applyRunId = "";

  await t.test("계획 실행: plan_pending, 작업 공간 그대로, plan.json만 생김, 여분 단계는 요청되지 않음", () => {
    const files = readRunFiles(p.sb.workspace, p.plan);
    assert.equal(p.plan.plan?.actions, ORGANIZE_ACTIONS.length);
    assert.deepEqual(workspaceBytes(p.sb.workspace), p.original, "no workspace file changed");
    assert.ok(existsSync(join(runDirPath(p.sb.workspace, p.plan.runId), PLAN_FILE_NAME)));
    assert.equal(files.records.filter((record) => record.type === "file_changed").length, 0);
    assert.equal(p.plan.usage.modelTurns, 2, "the run ends at propose_plan");
    const inspected = files.records.find((record) => record.type === "tool_result" && record.result.tool === "inspect_files");
    assert.ok(inspected?.type === "tool_result" && inspected.result.ok);
    const payload = JSON.parse(inspected.result.content) as { entries: { path: string; sha256?: string }[] };
    assert.ok(payload.entries.every((entry) => !entry.path.startsWith(".codaryn")), "the state directory is never listed");
    const hashOf = (path: string): string | undefined => payload.entries.find((entry) => entry.path === path)?.sha256;
    assert.equal(hashOf("inbox/photo.png"), hashOf("inbox/photo copy.png"), "duplicates show the same SHA-256");
  });

  await t.test("plan: pending, 다이제스트와 행동·원본 해시, 글 출력에도 다이제스트", async () => {
    const output = expectPlanOutput(await p.cli(planArgs(p.task, p.plan.runId)), p.plan.runId);
    assert.equal(output.status, "pending");
    assert.equal(output.digest, p.digest);
    assert.equal(output.inventoryLimitReached, false);
    assert.equal(output.appliedBy, null);
    assert.deepEqual(
      output.actions.map((action) => (action.kind === "move" ? { kind: "move", from: action.from, to: action.to } : { kind: "discard", path: action.path })),
      ORGANIZE_ACTIONS.map((action) => ({ ...action })),
    );
    for (const action of output.actions) {
      assert.equal(action.sha256, sha256Of(ORGANIZE_FILES.get(action.kind === "move" ? action.from : action.path) ?? Buffer.alloc(1)));
    }
    const text = await p.cli(planArgs(p.task, p.plan.runId, false));
    assert.equal(text.exitCode, 0);
    assert.ok(text.stdout.includes(p.digest), "the text shows the digest a person approves");
  });

  await t.test("apply --digest(앞 12자): done, inventory 통과, 배치가 판정 기준과 같음, 보관함 이름은 순번", async () => {
    const run = await p.cli(applyArgs(p.task, p.plan.runId, shortDigest(p.digest)));
    const result = expectApplyResult(run, p.plan.runId);
    applyRunId = result.runId;
    assert.equal(result.status, "done");
    assert.equal(result.reason, "verified");
    assert.equal(run.exitCode, 0);
    assert.equal(result.digest, p.digest);
    assert.deepEqual(result.applied.map((item) => item.index), [0, 1, 2, 3, 4, 5, 6]);
    assert.deepEqual([result.verifiers[0]?.id, result.verifiers[0]?.kind, result.verifiers[0]?.outcome], ["inventory", "inventory", "pass"]);
    assert.equal(result.usage.modelTurns, 0, "no model takes part in an apply");
    assert.deepEqual(workspaceBytes(p.sb.workspace), afterActions(p.original, ORGANIZE_ACTIONS));
    assert.deepEqual(readdirSync(join(p.sb.workspace, "inbox")), [], "the emptied folder stays (GT-D14)");

    const discarded = discardedDirOf(p.sb.workspace, applyRunId);
    assert.deepEqual(readdirSync(discarded).sort(), DISCARDED.map((item) => String(item.index)).sort(), "names from the action index only");
    for (const item of DISCARDED) assert.deepEqual(readFileSync(join(discarded, String(item.index))), ORGANIZE_FILES.get(item.path));
    const applied = JSON.parse(readFileSync(join(runDirPath(p.sb.workspace, p.plan.runId), PLAN_APPLIED_FILE_NAME), "utf8")) as { applyRunId: string };
    assert.equal(applied.applyRunId, applyRunId);

    const records = readApplyJournal(p.sb.workspace, applyRunId);
    const started = records[0];
    assert.ok(started?.type === "apply_started");
    assert.deepEqual([started.approval, started.actions, started.digest, started.planRunId], ["cli-flag", 7, p.digest, p.plan.runId]);
    assert.deepEqual(recordsOf(records, "plan_checked")[0]?.problems, []);
    assert.equal(recordsOf(records, "file_moved").length, 5);
    assert.equal(recordsOf(records, "file_discarded").length, 2);
  });

  await t.test("plan은 applied, 같은 다이제스트로 다시 apply는 plan_already_applied, runs에 두 실행", async () => {
    assert.notEqual(applyRunId, "");
    const output = expectPlanOutput(await p.cli(planArgs(p.task, p.plan.runId)), p.plan.runId);
    assert.equal(output.status, "applied");
    assert.equal(output.appliedBy?.runId, applyRunId);
    const before = treeBytes(p.sb.workspace);
    assertRefused(await p.cli(applyArgs(p.task, p.plan.runId, p.digest)), "plan_already_applied");
    assert.deepEqual(treeBytes(p.sb.workspace), before);
    const runs = expectRunsOutput(await p.cli(["runs", "--workspace", p.sb.workspace, "--json"]));
    assert.deepEqual(runs.runs.map((entry) => entry.runId).sort(), [applyRunId, p.plan.runId].sort());
  });

  await t.test("revert --run <적용 id>: 역순으로 되살리고 원래 바이트, 다시 하면 already_reverted", async () => {
    assert.notEqual(applyRunId, "");
    const run = await p.cli(["revert", "--workspace", p.sb.workspace, "--run", applyRunId]);
    const output = expectRevertOutput(run, applyRunId);
    assert.equal(output.status, "complete");
    assert.deepEqual(output.reverted.map((item) => item.action), [
      "restored_from_discard",
      "restored_from_discard",
      "moved_back",
      "moved_back",
      "moved_back",
      "moved_back",
      "moved_back",
    ]);
    assert.deepEqual(workspaceBytes(p.sb.workspace), p.original, "back to the first layout, byte for byte");
    const again = expectRevertOutput(await p.cli(["revert", "--workspace", p.sb.workspace, "--run", applyRunId]), applyRunId);
    assert.equal(again.status, "complete");
    assert.ok(again.skipped.every((item) => item.reason === "already_reverted") && again.skipped.length === 7);
    assert.deepEqual(workspaceBytes(p.sb.workspace), p.original);
  });
});

test("G-G GI-03 승인 없는 적용은 아무것도 옮기지 않는다", { timeout: 120_000 }, async (t) => {
  const p = await proposed(t);
  const before = treeBytes(p.sb.workspace);
  for (const [label, args] of [
    ["--digest 없음", ["apply", "--task", p.task, "--run", p.plan.runId]],
    ["11자", applyArgs(p.task, p.plan.runId, p.digest.slice(0, 11))],
    ["다른 다이제스트", applyArgs(p.task, p.plan.runId, "0".repeat(12))],
    ["대문자", applyArgs(p.task, p.plan.runId, p.digest.toUpperCase())],
  ] as const) {
    const run = await p.cli(args);
    assert.equal(run.exitCode, 2, label);
    assert.deepEqual(treeBytes(p.sb.workspace), before, `${label}: nothing changed`);
  }
  expectApplyResult(await p.cli(applyArgs(p.task, p.plan.runId, shortDigest(p.digest))), p.plan.runId);
  assert.deepEqual(workspaceBytes(p.sb.workspace), afterActions(p.original, ORGANIZE_ACTIONS), "a refused approval does not use up the plan");
});

test("G-G GI-04 오래된 계획: 사전 점검에서 멈추고 아무것도 옮기지 않는다(plan_stale)", { timeout: 180_000 }, async (t) => {
  const stale = async (
    st: TestContext,
    change: (p: Proposed) => void,
    expected: readonly { index: number; problem: string }[],
    policy: Record<string, unknown> = {},
  ): Promise<void> => {
    const p = await proposed(st);
    change(p);
    const task = Object.keys(policy).length === 0 ? p.task : writeOrganizeTask(p.sb, "gg-organize", organizeScript(), policy as never);
    const before = treeBytes(p.sb.workspace);
    const result = expectApplyResult(await p.cli(applyArgs(task, p.plan.runId, p.digest)), p.plan.runId);
    assert.deepEqual([result.status, result.reason, result.exitCode], ["failed", "plan_stale", 1]);
    assert.deepEqual(result.applied, []);
    const checked = recordsOf(readApplyJournal(p.sb.workspace, result.runId), "plan_checked")[0];
    assert.deepEqual(checked?.problems.map((item) => ({ index: item.index, problem: item.problem })), expected);
    const after = treeBytes(p.sb.workspace);
    assert.deepEqual(new Map([...after].filter(([path]) => !path.startsWith(".codaryn/"))), new Map([...before].filter(([path]) => !path.startsWith(".codaryn/"))), "nothing moved");
    assert.equal(existsSync(join(runDirPath(p.sb.workspace, p.plan.runId), PLAN_APPLIED_FILE_NAME)), false, "the plan is not used up");
  };
  const ws = (p: Proposed, path: string): string => join(p.sb.workspace, ...path.split("/"));

  await t.test("원본이 바뀜 → source_changed", (st) => stale(st, (p) => writeFileSync(ws(p, "inbox/budget.csv"), "item,amount\nchanged,1\n"), [{ index: 1, problem: "source_changed" }]));
  await t.test("대상이 생김 → destination_exists", (st) =>
    stale(
      st,
      (p) => {
        mkdirSync(ws(p, "docs"), { recursive: true });
        writeFileSync(ws(p, "docs/scan.pdf"), "새 파일");
      },
      [{ index: 3, problem: "destination_exists" }],
    ),
  );
  await t.test("원본이 없어짐 → source_missing", (st) => stale(st, (p) => rmSync(ws(p, "inbox/old.tmp")), [{ index: 6, problem: "source_missing" }]));
  await t.test("적용 때 정책이 폐기를 허용하지 않음 → denied(DR-5)", (st) =>
    stale(st, () => undefined, DISCARDED.map((item) => ({ index: item.index, problem: "denied" })), { planActions: ["move"] }),
  );
  await t.test("적용 때 보호 경로가 원본을 덮음 → denied", (st) => stale(st, () => undefined, [{ index: 1, problem: "denied" }], { protectedPaths: ["inbox/budget.csv"] }));
});

test("G-G GI-05 계획 단계의 쓰기·명령 호출은 묶음 밖이라 거부되고 파일은 그대로", { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  const original = writeOrganizeWorkspace(sb);
  const task = writeOrganizeTask(sb, "gg-attempts", organizeWriteAttemptScript());
  const result = expectRunResult(await runGuarded(sb, ["run", "--task", task], cliEnv()));
  assert.equal(result.reason, "plan_pending");
  const records = readRunFiles(sb.workspace, result).records;
  for (const tool of ["write_file", "run_command"]) {
    const outcome = records.find((record) => record.type === "tool_result" && record.result.tool === tool);
    assert.ok(outcome?.type === "tool_result" && !outcome.result.ok && outcome.result.errorCode === "unknown_tool", `${tool} is not in the organize tools`);
  }
  assert.deepEqual(workspaceBytes(sb.workspace), original);
});

test("G-G GG-C05 거부되는 계획: 도구·정책이 거부하고 계획을 저장하지 않으며, 다음 제안은 저장된다", { timeout: 300_000 }, async (t) => {
  for (const refused of REFUSED_PLAN_CASES) {
    await t.test(refused.name, async (st) => {
      const sb = createSandbox(st);
      writeOrganizeWorkspace(sb);
      const task = writeOrganizeTask(sb, `gg-${refused.name}`, refusedThenValidPlanScript(refused.args, refused.validAfter), (refused.policy ?? {}) as never);
      const result = expectRunResult(await runGuarded(sb, ["run", "--task", task], cliEnv()));
      const records = readRunFiles(sb.workspace, result).records;
      const first = records.find((record) => record.type === "tool_result" && record.result.tool === "propose_plan");
      assert.ok(first?.type === "tool_result" && !first.result.ok, "the first plan is refused");
      if ("denial" in refused.expect) {
        assert.equal(first.result.errorCode, "policy_denied");
        assert.ok(first.result.content.includes(`/${refused.expect.denial}`), first.result.content);
      } else if (refused.expect.toolError === "invalid_args") {
        assert.equal(first.result.errorCode, "invalid_args");
      } else {
        assert.equal(first.result.errorCode, "invalid_plan");
        assert.ok(first.result.content.endsWith(`: ${refused.expect.problem}`), first.result.content);
        assert.ok(!/inbox|keep|docs|data/.test(first.result.content), "the message names the index and the code, never a path");
      }
      assert.equal(result.reason, "plan_pending", "the plan proposed after the refused one is stored");
    });
  }
});

test("G-G GG-C07 같은 계획을 동시에 두 번 적용해도 한 번만 옮긴다", { timeout: 120_000 }, async (t) => {
  const p = await proposed(t);
  const both = await Promise.all([0, 1].map(() => startCli(applyArgs(p.task, p.plan.runId, p.digest), { cwd: p.sb.base, env: cliEnv(), timeoutMs: 60_000 }).done));
  const outcomes = both.map((run) => {
    const output = JSON.parse(run.stdout.trim()) as { kind: string; status?: string; reason?: string; code?: string };
    return output.kind === "apply" ? `${String(output.status)}/${String(output.reason)}` : String(output.code);
  });
  t.diagnostic(`outcomes: ${outcomes.join(", ")}`);
  assert.equal(outcomes.filter((outcome) => outcome === "done/verified").length, 1, "exactly one apply moves");
  const other = outcomes.find((outcome) => outcome !== "done/verified") ?? "";
  assert.ok(["plan_already_applied", "workspace_locked", "failed/plan_stale"].includes(other), other);
  assert.deepEqual(workspaceBytes(p.sb.workspace), afterActions(p.original, ORGANIZE_ACTIONS));
});

test("G-G GG-C08 적용 뒤 사용자가 바꾼 파일은 되돌리지 않고 남긴다", { timeout: 120_000 }, async (t) => {
  const p = await proposed(t);
  const applyRunId = expectApplyResult(await p.cli(applyArgs(p.task, p.plan.runId, p.digest)), p.plan.runId).runId;
  writeFileSync(join(p.sb.workspace, "data", "budget.csv"), "사용자가 고침\n");
  writeFileSync(join(p.sb.workspace, "inbox", "old.tmp"), "사용자가 새로 만듦\n");
  const userBytes = workspaceBytes(p.sb.workspace);
  const output = expectRevertOutput(await p.cli(["revert", "--workspace", p.sb.workspace, "--run", applyRunId]), applyRunId);
  assert.equal(output.status, "partial");
  const reasons = Object.fromEntries(output.skipped.map((item) => [item.path, item.reason]));
  assert.equal(reasons["inbox/budget.csv"] ?? reasons["data/budget.csv"], "changed_since_run");
  assert.equal(reasons["inbox/old.tmp"], "original_path_taken");
  assert.equal(readFileSync(join(p.sb.workspace, "data", "budget.csv"), "utf8"), userBytes.get("data/budget.csv")?.toString("utf8"));
  assert.equal(readFileSync(join(p.sb.workspace, "inbox", "old.tmp"), "utf8"), "사용자가 새로 만듦\n");
});

test("G-G GG-C09 계획이 아닌 실행, 없는 실행, plan.json 변조는 거부하고 아무것도 옮기지 않는다", { timeout: 120_000 }, async (t) => {
  const p = await proposed(t);
  const before = treeBytes(p.sb.workspace);
  const documentTask = join(p.sb.base, "document-task.json");
  writeFileSync(documentTask, JSON.stringify({ ...(JSON.parse(readFileSync(p.task, "utf8")) as object), id: "gg-document", workflowRef: "document", policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false } }));
  const documentRun = expectRunResult(await p.cli(["run", "--task", documentTask])).runId;
  const afterDocument = treeBytes(p.sb.workspace);
  assertRefused(await p.cli(planArgs(p.task, documentRun)), "run_not_plan");
  assertRefused(await p.cli(applyArgs(p.task, documentRun, p.digest)), "run_not_plan");
  assertRefused(await p.cli(applyArgs(documentTask, p.plan.runId, p.digest)), "run_not_plan");
  assertRefused(await p.cli(planArgs(p.task, "20200101T000000Z-00000000")), "run_not_found");
  assert.deepEqual(treeBytes(p.sb.workspace), afterDocument, "the refusals changed nothing");
  assert.deepEqual(workspaceBytes(p.sb.workspace), new Map([...before].filter(([path]) => !path.startsWith(".codaryn/"))), "no workspace file moved");

  const planFile = join(runDirPath(p.sb.workspace, p.plan.runId), PLAN_FILE_NAME);
  writeFileSync(planFile, readFileSync(planFile, "utf8").replace("docs/scan.pdf", "docs/scam.pdf"));
  const tampered = treeBytes(p.sb.workspace);
  assertRefused(await p.cli(planArgs(p.task, p.plan.runId)), "invalid_run_record");
  assertRefused(await p.cli(applyArgs(p.task, p.plan.runId, p.digest)), "invalid_run_record");
  assert.deepEqual(treeBytes(p.sb.workspace), tampered, "nothing moved");
});

test("G-G GG-C10 등록 비밀이 든 파일 이름은 plan·결과·기록·출력에서 가려지고, 적용은 실제 경로로 된다", { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  const original = writeOrganizeWorkspace(sb);
  const secretName = `inbox/${FAKE_SECRET_A}.txt`;
  mkdirSync(join(sb.workspace, "inbox"), { recursive: true });
  writeFileSync(join(sb.workspace, ...secretName.split("/")), "비밀 이름의 파일\n");
  original.set(secretName, Buffer.from("비밀 이름의 파일\n"));
  const actions = [{ kind: "move" as const, from: secretName, to: "private/kept.txt" }];
  const env = cliEnv({ extra: { [FAKE_SECRET_ENV_A]: FAKE_SECRET_A } });
  const task = writeOrganizeTask(sb, "gg-secret", organizeScript(actions), {});
  const taskJson = JSON.parse(readFileSync(task, "utf8")) as Record<string, unknown>;
  writeFileSync(task, JSON.stringify({ ...taskJson, privacy: { secretEnv: [FAKE_SECRET_ENV_A] } }));
  const cli = (args: readonly string[]): Promise<CliRun> => runGuarded(sb, args, env);
  const planRun = await cli(["run", "--task", task]);
  const plan = expectRunResult(planRun);
  const digest = planDigestOf(plan);
  const shown = await cli(planArgs(task, plan.runId));
  const applied = await cli(applyArgs(task, plan.runId, digest));
  const result = expectApplyResult(applied, plan.runId);
  assert.equal(result.status, "done");
  assert.deepEqual(workspaceBytes(sb.workspace), afterActions(original, actions), "the apply used the real path");
  const journals = [readFileSync(join(runDirPath(sb.workspace, plan.runId), "journal.jsonl"), "utf8"), readFileSync(join(runDirPath(sb.workspace, result.runId), "journal.jsonl"), "utf8")];
  const sources = [planRun, shown, applied].flatMap((run, index) => [
    { label: `stdout ${index}`, text: run.stdout },
    { label: `stderr ${index}`, text: run.stderr },
    decodedSource(`decoded ${index}`, run.stdout, true),
  ]);
  journals.forEach((text, index) => sources.push({ label: `journal ${index}`, text }, decodedSource(`journal decoded ${index}`, text, true)));
  assert.deepEqual(findLeaks(sources, [FAKE_SECRET_A], { extended: true }), [], "the name is masked everywhere but plan.json");
});

test("G-G R-9 M-1 보관함 안의 링크를 따라가 작업 공간 밖 파일을 옮기지 않는다(DR-24 (a))", { timeout: 120_000 }, async (t) => {
  const p = await proposed(t);
  const applyRunId = expectApplyResult(await p.cli(applyArgs(p.task, p.plan.runId, p.digest)), p.plan.runId).runId;
  const outside = join(p.sb.base, "outside");
  mkdirSync(outside);
  const precious = Buffer.from("작업 공간 밖의 소중한 파일\n");
  writeFileSync(join(outside, "precious.doc"), precious);
  try {
    symlinkSync(outside, join(discardedDirOf(p.sb.workspace, applyRunId), "sub"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`cannot create a directory link here: ${String(error)}`);
    return;
  }
  const journal = join(runDirPath(p.sb.workspace, applyRunId), "journal.jsonl");
  const lines = readFileSync(journal, "utf8").split("\n");
  const at = lines.findIndex((line) => line.includes('"type":"file_discarded"'));
  lines[at] = JSON.stringify({ ...(JSON.parse(lines[at] ?? "") as object), stored: "sub/precious.doc", sha256: sha256Of(precious) });
  writeFileSync(journal, lines.join("\n"));

  const run = await p.cli(["revert", "--workspace", p.sb.workspace, "--run", applyRunId]);
  t.diagnostic(`revert: exit ${String(run.exitCode)} ${run.stdout.slice(0, 300)}`);
  assert.deepEqual(readFileSync(join(outside, "precious.doc")), precious, "the file outside the workspace stays");
  assert.ok(!Object.values(Object.fromEntries(workspaceBytes(p.sb.workspace))).some((bytes) => bytes.equals(precious)), "its content was not brought into the workspace");
});

test("G-G R-9 L-3 적용 뒤 바뀐 plan.json의 경로는 되돌리기에 쓰지 않는다(DR-24 (f))", { timeout: 120_000 }, async (t) => {
  const p = await proposed(t);
  const applyRunId = expectApplyResult(await p.cli(applyArgs(p.task, p.plan.runId, p.digest)), p.plan.runId).runId;
  const afterApply = workspaceBytes(p.sb.workspace);
  const planFile = join(runDirPath(p.sb.workspace, p.plan.runId), PLAN_FILE_NAME);
  writeFileSync(planFile, readFileSync(planFile, "utf8").replace('"from":"inbox/budget.csv"', '"from":"elsewhere/budget.csv"'));
  const run = await p.cli(["revert", "--workspace", p.sb.workspace, "--run", applyRunId]);
  t.diagnostic(`revert: exit ${String(run.exitCode)} ${run.stdout.slice(0, 300)}`);
  assert.equal(existsSync(join(p.sb.workspace, "elsewhere")), false, "no file goes to the path written into plan.json afterwards");
  const now = workspaceBytes(p.sb.workspace);
  assert.ok(now.has("data/budget.csv") || now.has("inbox/budget.csv"), "budget.csv stays inside, at its applied or original place");
  assert.ok(afterApply.size === now.size, "no file was lost or added");
});
