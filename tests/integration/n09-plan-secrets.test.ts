/**
 * Review R-11 M-1, decision DR-28: `plan` and `apply` with other secrets than the plan run's. The
 * plan run masked a registered secret that sits in a path; showing or applying that plan with a
 * task that does not register the secret must neither show the value nor move anything, and end
 * as `plan_secrets_differ` (src/contracts/engine.ts). The rule is that the secrets registered now
 * leave exactly the text visible that the plan run left visible, so the other direction (a plan run
 * without the secret, shown or applied with it) is refused too. With the same secrets (control)
 * both work and stay masked. Real CLI processes, scripted model, no key, every command behind the
 * network guard.
 */

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { CLI_ERROR_EXIT_CODES } from "../../src/contracts/index.js";
import { createSandbox } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import { organizeScript, writeOrganizeTask, writeOrganizeWorkspace } from "../fixtures/general-tasks.js";
import type { OrganizeAction } from "../fixtures/general-tasks.js";
import { FAKE_SECRET_A, FAKE_SECRET_ENV_A } from "../fixtures/secrets.js";
import { cliEnv, expectCliError, expectRunResult } from "../support/cli.js";
import type { CliRun } from "../support/cli.js";
import { runGuarded } from "../support/fake-anthropic.js";
import { applyArgs, expectApplyResult, expectPlanOutput, planArgs, planDigestOf } from "../support/general.js";
import { decodedSource, findLeaks, stateRecordTexts } from "../support/leak.js";
import { assertHumanError } from "../support/progress.js";
import { treeBytes, workspaceBytes } from "../support/repair-check.js";

/** A customer folder whose name is the registered secret (R-11: "거래처 이름 폴더"). */
const SECRET_DIR = `inbox/${FAKE_SECRET_A}`;
const ACTIONS: readonly OrganizeAction[] = [{ kind: "move", from: `${SECRET_DIR}/a.jpg`, to: `sorted/${FAKE_SECRET_A}/a.jpg` }];

interface Planned {
  readonly sb: Sandbox;
  /** The plan run's task: registers the secret. */
  readonly withSecret: string;
  /** Another task file for the same workspace that registers no secret. */
  readonly without: string;
  readonly runId: string;
  readonly digest: string;
  readonly secretEnv: NodeJS.ProcessEnv;
}

/** The workspace with the secret folder, both task files, and a plan run with (default) or without the secret. */
async function planned(t: TestContext, planRunSecret = true): Promise<Planned> {
  const sb = createSandbox(t);
  writeOrganizeWorkspace(sb);
  mkdirSync(join(sb.workspace, ...SECRET_DIR.split("/")), { recursive: true });
  writeFileSync(join(sb.workspace, ...SECRET_DIR.split("/"), "a.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
  const withSecret = writeOrganizeTask(sb, "gg-r11", organizeScript(ACTIONS));
  const task = JSON.parse(readFileSync(withSecret, "utf8")) as Record<string, unknown>;
  writeFileSync(withSecret, JSON.stringify({ ...task, privacy: { secretEnv: [FAKE_SECRET_ENV_A] } }));
  const without = join(sb.base, "task-without-secret.json");
  writeFileSync(without, JSON.stringify({ ...task, privacy: { secretEnv: [] } }));
  const secretEnv = cliEnv({ extra: { [FAKE_SECRET_ENV_A]: FAKE_SECRET_A } });
  const plan = expectRunResult(await runGuarded(sb, ["run", "--task", planRunSecret ? withSecret : without], planRunSecret ? secretEnv : cliEnv()));
  return { sb, withSecret, without, runId: plan.runId, digest: planDigestOf(plan), secretEnv };
}

function leaks(sb: Sandbox, runs: readonly CliRun[]): string[] {
  const sources = runs.flatMap((run, index) => [
    { label: `stdout ${index}`, text: run.stdout },
    { label: `stderr ${index}`, text: run.stderr },
    decodedSource(`decoded ${index}`, run.stdout, true),
  ]);
  // The state directory's records, plan.json and snapshots excepted (local raw text by contract).
  sources.push(...stateRecordTexts(sb.workspace).filter((source) => !source.label.endsWith("plan.json")));
  return findLeaks(sources, [FAKE_SECRET_A], { extended: true });
}

test("R-11 대조군: 계획 실행과 같은 비밀로 plan·apply는 동작하고 값은 가려진다", { timeout: 120_000 }, async (t) => {
  const p = await planned(t);
  const shown = await runGuarded(p.sb, planArgs(p.withSecret, p.runId), p.secretEnv);
  expectPlanOutput(shown, p.runId);
  const applied = await runGuarded(p.sb, applyArgs(p.withSecret, p.runId, p.digest), p.secretEnv);
  assert.equal(expectApplyResult(applied, p.runId).status, "done");
  assert.deepEqual(leaks(p.sb, [shown, applied]), []);
});

test("R-11 M-1 계획 실행과 다른 비밀로 plan·apply: 전용 오류, 값을 보이지도 옮기지도 않는다(DR-28)", { timeout: 120_000 }, async (t) => {
  const p = await planned(t);
  for (const env of [p.secretEnv, cliEnv()]) {
    const before = treeBytes(p.sb.workspace);
    const files = workspaceBytes(p.sb.workspace);
    const shown = await runGuarded(p.sb, planArgs(p.without, p.runId), env);
    const applied = await runGuarded(p.sb, applyArgs(p.without, p.runId, p.digest), env);
    for (const run of [shown, applied]) assertSecretsDiffer(run);
    assert.deepEqual(workspaceBytes(p.sb.workspace), files, "nothing moved");
    assert.deepEqual(treeBytes(p.sb.workspace), before, "no apply run, no record");
    assert.deepEqual(leaks(p.sb, [shown, applied]), [], "the secret the plan run masked is not shown or recorded");
  }
});

test("R-11 반대 방향: 비밀 없이 만든 계획을 비밀을 등록하고 plan·apply해도 plan_secrets_differ, 아무것도 옮기지 않는다", { timeout: 120_000 }, async (t) => {
  const p = await planned(t, false);
  const before = treeBytes(p.sb.workspace);
  const files = workspaceBytes(p.sb.workspace);
  assertSecretsDiffer(await runGuarded(p.sb, planArgs(p.withSecret, p.runId), p.secretEnv));
  assertSecretsDiffer(await runGuarded(p.sb, applyArgs(p.withSecret, p.runId, p.digest), p.secretEnv));
  assert.deepEqual(workspaceBytes(p.sb.workspace), files, "nothing moved");
  assert.deepEqual(treeBytes(p.sb.workspace), before, "no apply run, no record");
});

/** DR-28: stopped as plan_secrets_differ right after the plan was loaded, explained on stderr. */
function assertSecretsDiffer(run: CliRun): void {
  expectCliError(run, "plan_secrets_differ");
  assert.equal(run.exitCode, CLI_ERROR_EXIT_CODES.plan_secrets_differ);
  assertHumanError(run, "plan_secrets_differ", [FAKE_SECRET_A]);
}
