/**
 * Snapshots and `codaryn revert --workspace <dir> --run <runId>` (R-6, R-7, WS-06).
 * A file goes back to its original bytes only when it is still what the run left; a file the run
 * created is deleted; anything changed after the run is left alone and reported as skipped.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { REVERT_EXIT_CODES } from "../../src/contracts/index.js";
import type { CliErrorCode } from "../../src/contracts/index.js";
import { createSandbox, writeTask, writeWorkspaceFile } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import {
  EDIT_WRONG_FIX,
  PRICE_BUG,
  PRICE_FIXED,
  PRICE_PATH,
  SETTINGS_PATH,
  fileEdit,
  writeRepairProject,
} from "../fixtures/repair-project.js";
import { FAKE_SECRET_ENV_A, FRAGMENT_SECRET } from "../fixtures/secrets.js";
import {
  cliEnv,
  expectCliError,
  expectRunResult,
  lockPath,
  readRunFiles,
  runTask,
  startTask,
  waitFor,
} from "../support/cli.js";
import { findFragments, findLeaks } from "../support/leak.js";
import {
  expectRevertOutput,
  parseCommandOutput,
  revertSummary,
  runRevert,
  workspaceBytes,
} from "../support/repair-check.js";
import { editStep, finalStep, readStep, replaceAllStep } from "../support/repair-script.js";

/** BOM, CRLF and Korean, in a Korean path: the original bytes must come back exactly. */
const MEMO_PATH = "docs/메모.md";
const MEMO_ORIGINAL = "﻿제목\r\n첫 줄\r\n둘째 줄\r\n";
const MEMO_EDIT_1 = fileEdit(MEMO_PATH, MEMO_ORIGINAL, "첫 줄", "첫 줄 수정");
const MEMO_EDIT_2 = fileEdit(MEMO_PATH, MEMO_EDIT_1.after, "둘째 줄", "둘째 줄 수정");

/** Holds a registered fake secret; the snapshot is raw (R-8), so revert restores it exactly. */
const SETTINGS_ORIGINAL = `name=demo\ntoken=${FRAGMENT_SECRET}\n`;
const SETTINGS_EDIT = fileEdit(SETTINGS_PATH, SETTINGS_ORIGINAL, "name=demo", "name=prod");

const REMOVED_PATH = "docs/removed.md";
const REMOVED_EDIT = fileEdit(REMOVED_PATH, "지울 문서\n", "지울 문서", "고친 문서");
const NEW_PATH = "notes/new.md";
const EDITED_PATH = "notes/created-then-edited.md";
const README_ORIGINAL = "# 연습\n";

const USER_PRICE = `// rewritten by the user after the run\n${PRICE_FIXED}`;
const USER_EDITED = "사용자 수정\n";
const USER_README = "사용자 README\n";

const SECRET_ENV = { [FAKE_SECRET_ENV_A]: FRAGMENT_SECRET };
const EXISTS_NEW = { id: "created", kind: "file_rules", rules: [{ type: "exists", path: NEW_PATH }] } as const;

function bytesOf(sb: Sandbox, path: string): Buffer {
  return readFileSync(join(sb.workspace, ...path.split("/")));
}

function absent(sb: Sandbox, path: string): boolean {
  return !existsSync(join(sb.workspace, ...path.split("/")));
}

/** Runs a small task that changes src/price.js and creates notes/new.md. Returns the run id. */
async function changingRun(sb: Sandbox, id: string): Promise<string> {
  const taskPath = writeTask(sb, { id, workflow: "code", verifiers: [EXISTS_NEW] }, [
    editStep("w-price", EDIT_WRONG_FIX),
    replaceAllStep("c-new", NEW_PATH, null, "새 메모\n"),
    finalStep("바꿨다"),
  ]);
  const run = await runTask(taskPath, { cwd: sb.base });
  const result = expectRunResult(run);
  readRunFiles(sb.workspace, result);
  assert.equal(result.status, "done", "setup run must finish");
  return result.runId;
}

test("F5-p 되돌리기: 원문 바이트 복원, 새 파일 삭제, 실행 뒤 사용자 변경 보존", { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  writeRepairProject(sb, { secret: FRAGMENT_SECRET });
  writeWorkspaceFile(sb, MEMO_PATH, MEMO_ORIGINAL);
  writeWorkspaceFile(sb, REMOVED_PATH, REMOVED_EDIT.before);
  writeWorkspaceFile(sb, "README.md", README_ORIGINAL);
  const memoBytes = bytesOf(sb, MEMO_PATH);
  const settingsBytes = bytesOf(sb, SETTINGS_PATH);
  assert.deepEqual(settingsBytes, Buffer.from(SETTINGS_ORIGINAL, "utf8"), "test assumption: fixture settings text");

  const taskPath = writeTask(sb, { id: "f5-p", secretEnv: [FAKE_SECRET_ENV_A], verifiers: [EXISTS_NEW] }, [
    editStep("w-memo-1", MEMO_EDIT_1),
    editStep("w-memo-2", MEMO_EDIT_2),
    editStep("w-price", EDIT_WRONG_FIX),
    editStep("w-settings", SETTINGS_EDIT),
    editStep("w-removed", REMOVED_EDIT),
    replaceAllStep("c-new", NEW_PATH, null, "새 메모\n"),
    replaceAllStep("c-edited", EDITED_PATH, null, "만든 메모\n"),
    finalStep("고쳤다"),
  ]);
  const run = await runTask(taskPath, { cwd: sb.base, env: cliEnv({ extra: SECRET_ENV }) });
  const result = expectRunResult(run);
  const files = readRunFiles(sb.workspace, result);
  assert.equal(result.status, "done", "setup run must finish");
  assert.equal(result.changes.length, 7, "setup: every scripted write applied");

  // The user keeps working after the run.
  writeWorkspaceFile(sb, PRICE_PATH, USER_PRICE);
  writeWorkspaceFile(sb, EDITED_PATH, USER_EDITED);
  rmSync(join(sb.workspace, ...REMOVED_PATH.split("/")));
  writeWorkspaceFile(sb, "README.md", USER_README);

  const journalFile = join(files.runDir, "journal.jsonl");
  const journalBefore = readFileSync(journalFile);
  // No secret in the environment: revert works from the journal and the snapshots alone.
  const revert = await runRevert(sb.workspace, result.runId, { cwd: sb.base, env: cliEnv() });
  const output = expectRevertOutput(revert, result.runId);

  await t.test("상태와 목록", () => {
    assert.equal(output.status, "partial");
    assert.equal(revert.exitCode, REVERT_EXIT_CODES.partial);
    assert.deepEqual(revertSummary(output), {
      reverted: [`${MEMO_PATH}:restored`, `${NEW_PATH}:deleted`, `${SETTINGS_PATH}:restored`].sort(),
      skipped: [
        `${EDITED_PATH}:changed_since_run`,
        `${PRICE_PATH}:changed_since_run`,
        `${REMOVED_PATH}:changed_since_run`,
      ].sort(),
    });
  });
  await t.test("되돌린 파일은 첫 원문 바이트(BOM, CRLF, 한글, 비밀 원문 포함)", () => {
    assert.deepEqual(bytesOf(sb, MEMO_PATH), memoBytes, "two edits in one run go back to the first original");
    assert.deepEqual(bytesOf(sb, SETTINGS_PATH), settingsBytes);
    assert.equal(absent(sb, NEW_PATH), true, "a file the run created is deleted");
  });
  await t.test("실행 뒤 사용자 변경은 그대로", () => {
    assert.equal(bytesOf(sb, PRICE_PATH).toString("utf8"), USER_PRICE);
    assert.equal(bytesOf(sb, EDITED_PATH).toString("utf8"), USER_EDITED, "a created file the user changed is kept");
    assert.equal(absent(sb, REMOVED_PATH), true, "a file the user deleted is not brought back");
    assert.equal(bytesOf(sb, "README.md").toString("utf8"), USER_README, "files the run never touched are not listed");
  });
  await t.test("journal 불변, 잠금 해제, 출력에 비밀 없음", () => {
    assert.deepEqual(readFileSync(journalFile), journalBefore, "revert writes nothing to the run's journal");
    assert.equal(existsSync(lockPath(sb.workspace)), false);
    const sources = [
      { label: "revert stdout", text: revert.stdout },
      { label: "revert stderr", text: revert.stderr },
    ];
    assert.deepEqual(findLeaks(sources, [FRAGMENT_SECRET], { extended: true }), []);
    assert.deepEqual(findFragments(sources, FRAGMENT_SECRET, 4), []);
  });
});

test("F5-q 두 번째 되돌리기는 아무것도 바꾸지 않는다", { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  writeRepairProject(sb);
  const runId = await changingRun(sb, "f5-q");

  const first = await runRevert(sb.workspace, runId, { cwd: sb.base });
  const firstOut = expectRevertOutput(first, runId);
  assert.equal(firstOut.status, "complete");
  assert.equal(first.exitCode, REVERT_EXIT_CODES.complete);
  assert.deepEqual(revertSummary(firstOut), {
    reverted: [`${NEW_PATH}:deleted`, `${PRICE_PATH}:restored`].sort(),
    skipped: [],
  });
  assert.equal(bytesOf(sb, PRICE_PATH).toString("utf8"), PRICE_BUG);
  assert.equal(absent(sb, NEW_PATH), true);

  // N-22: files already as before the run are `already_reverted`, which is nothing left to do,
  // so the second revert is `complete` (exit 0) and says the run was reverted before.
  const before = workspaceBytes(sb.workspace);
  const second = await runRevert(sb.workspace, runId, { cwd: sb.base });
  const secondOut = expectRevertOutput(second, runId);
  assert.equal(secondOut.status, "complete");
  assert.equal(second.exitCode, REVERT_EXIT_CODES.complete);
  assert.deepEqual(revertSummary(secondOut), {
    reverted: [],
    skipped: [`${NEW_PATH}:already_reverted`, `${PRICE_PATH}:already_reverted`].sort(),
  });
  assert.equal(secondOut.revertedBefore?.status, "complete");
  assert.deepEqual(workspaceBytes(sb.workspace), before);

  // A file changed again after the revert is still `changed_since_run`, and that makes it partial.
  writeFileSync(join(sb.workspace, ...PRICE_PATH.split("/")), `${PRICE_BUG}// 사용자가 다시 고침\n`);
  const userBytes = workspaceBytes(sb.workspace);
  const third = await runRevert(sb.workspace, runId, { cwd: sb.base });
  const thirdOut = expectRevertOutput(third, runId);
  assert.equal(thirdOut.status, "partial");
  assert.equal(third.exitCode, REVERT_EXIT_CODES.partial);
  assert.deepEqual(revertSummary(thirdOut), {
    reverted: [],
    skipped: [`${NEW_PATH}:already_reverted`, `${PRICE_PATH}:changed_since_run`].sort(),
  });
  assert.deepEqual(workspaceBytes(sb.workspace), userBytes, "the user's change stays");
});

test("F5-q2 아무것도 바꾸지 않은 실행의 되돌리기는 complete", { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  writeRepairProject(sb);
  const taskPath = writeTask(
    sb,
    { id: "f5-q2", verifiers: [{ id: "exists", kind: "file_rules", rules: [{ type: "exists", path: PRICE_PATH }] }] },
    [readStep("r-price", PRICE_PATH), finalStep("읽기만 했다")],
  );
  const result = expectRunResult(await runTask(taskPath, { cwd: sb.base }));
  const before = workspaceBytes(sb.workspace);
  const revert = await runRevert(sb.workspace, result.runId, { cwd: sb.base });
  const output = expectRevertOutput(revert, result.runId);
  assert.equal(output.status, "complete");
  assert.equal(revert.exitCode, REVERT_EXIT_CODES.complete);
  assert.deepEqual(revertSummary(output), { reverted: [], skipped: [] });
  assert.deepEqual(workspaceBytes(sb.workspace), before);
});

test("F5-r 되돌리기 오류: 없는 실행, 경로 탈출 id, 잠금, 깨진 journal", { timeout: 180_000 }, async (t) => {
  const sb = createSandbox(t);
  writeRepairProject(sb);
  const runId = await changingRun(sb, "f5-r");
  const runDir = join(sb.workspace, ".codaryn", "runs", runId);

  const assertNothingChanged = (before: Map<string, Buffer>): void => {
    assert.deepEqual(workspaceBytes(sb.workspace), before, "the workspace must be unchanged");
  };

  await t.test("없는 실행 id → run_not_found", async () => {
    const before = workspaceBytes(sb.workspace);
    const revert = await runRevert(sb.workspace, "no-such-run", { cwd: sb.base });
    expectCliError(revert, "run_not_found");
    assert.equal(revert.exitCode, 2);
    assertNothingChanged(before);
  });

  await t.test("runs 밖을 가리키는 id는 따라가지 않는다", async () => {
    // A copy of the real journal where `.codaryn/runs/../../evil` would lead. The model can write
    // here, so following it would let workspace files steer a revert.
    writeWorkspaceFile(sb, "evil/journal.jsonl", readFileSync(join(runDir, "journal.jsonl")));
    const before = workspaceBytes(sb.workspace);
    const allowed: CliErrorCode[] = ["invalid_arguments", "run_not_found"];
    for (const id of ["../../evil", "..\\..\\evil", join(sb.workspace, "evil")]) {
      const revert = await runRevert(sb.workspace, id, { cwd: sb.base });
      const output = parseCommandOutput(revert);
      assert.equal(output.kind, "error", `run id ${JSON.stringify(id)} must be refused`);
      if (output.kind === "error") assert.ok(allowed.includes(output.code), `code ${output.code}`);
      assertNothingChanged(before);
    }
  });

  await t.test("다른 실행이 잠금을 쥐고 있으면 workspace_locked", async () => {
    const before = workspaceBytes(sb.workspace);
    const longTask = writeTask(sb, { id: "f5-r-long", verifiers: [EXISTS_NEW] }, [
      { text: "생각 중", delayMs: 60_000 },
      finalStep("끝"),
    ]);
    const long = startTask(longTask, { cwd: sb.base, cancelFile: sb.cancelFile, timeoutMs: 90_000 });
    try {
      await waitFor(() => existsSync(lockPath(sb.workspace)), 30_000, "lock of the long run");
      const revert = await runRevert(sb.workspace, runId, { cwd: sb.base });
      expectCliError(revert, "workspace_locked");
      assert.equal(revert.exitCode, 6);
      assertNothingChanged(before);
    } finally {
      writeFileSync(sb.cancelFile, "cancel");
      await long.done;
      rmSync(sb.cancelFile, { force: true });
    }
  });

  await t.test("읽을 수 없는 journal → invalid_run_record, 아무것도 바꾸지 않음", async () => {
    const journalFile = join(runDir, "journal.jsonl");
    const lines = readFileSync(journalFile, "utf8").split("\n");
    lines.splice(1, 0, "{not json");
    writeFileSync(journalFile, lines.join("\n"));
    const before = workspaceBytes(sb.workspace);
    const revert = await runRevert(sb.workspace, runId, { cwd: sb.base });
    expectCliError(revert, "invalid_run_record");
    assert.equal(revert.exitCode, 2);
    assertNothingChanged(before);
    assert.equal(bytesOf(sb, PRICE_PATH).toString("utf8"), EDIT_WRONG_FIX.after);
  });
});
