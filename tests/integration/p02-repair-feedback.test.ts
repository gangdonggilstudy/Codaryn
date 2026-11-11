/**
 * What the repair message carries (R-4) and what it must never carry (R-6): failure evidence is
 * masked, then cut to its share of MAX_FEEDBACK_BYTES with head and tail kept; no secret, no piece
 * of a secret, no cut token; file originals kept for revert never reach the journal or a model.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_FEEDBACK_BYTES } from "../../src/contracts/index.js";
import type { CommandVerifierConfig, JournalRecord, SearchFilesPayload } from "../../src/contracts/index.js";
import { createSandbox, writeTask, writeWorkspaceFile } from "../fixtures/builders.js";
import {
  NOISY_CHECK_PATH,
  NOTES_ORIGINAL,
  NOTES_PATH,
  NOTES_REPLACEMENT,
  SNAPSHOT_MARKER,
  TAIL_CUT_PATH,
  noisyErrEndMark,
  tailCutAfter,
  writeRepairProject,
} from "../fixtures/repair-project.js";
import { FAKE_SECRET_ENV_A, FRAGMENT_SECRET } from "../fixtures/secrets.js";
import {
  NODE,
  cliEnv,
  expectRunResult,
  payloadOf,
  readRunFiles,
  runTask,
  toolResultFor,
} from "../support/cli.js";
import type { CliRun, RunFiles } from "../support/cli.js";
import { decodedSource, findFragments, findLeaks } from "../support/leak.js";
import type { TextSource } from "../support/leak.js";
import {
  allRequestText,
  assertWholeTokens,
  countTokens,
  repairMessages,
  repairStarts,
  snapshotsDirOf,
  treeBytes,
  verifierResults,
} from "../support/repair-check.js";
import { attemptSteps, callStep, finalStep, replaceAllStep, spareSteps } from "../support/repair-script.js";

/**
 * Room for the text the engine puts around the evidence (verifier ids, instructions).
 * Assumption: the contract caps the evidence only, so the whole message may be somewhat larger.
 */
const FRAME_ALLOWANCE_BYTES = 4096;
/** Characters compared at each end of a masked evidence text. */
const EDGE_CHARS = 80;
/**
 * src/verify keeps this many characters at the end of each output stream before the evidence is
 * masked (EVIDENCE_OUTPUT_TAIL_CHARS, an implementation constant). F5-j places secrets across it.
 */
const VERIFY_TAIL_CHARS = 2000;

const MARKER_QUERY = SNAPSHOT_MARKER.slice(SNAPSHOT_MARKER.indexOf("-") + 1);

/** Two failing attempts that only claim success, so the run sends exactly one repair message. */
const CLAIM_ONLY = attemptSteps([
  { edits: [], claim: "끝났다" },
  { edits: [], claim: "다시 확인했다" },
]);

function runSources(run: CliRun, files: RunFiles, message: string): TextSource[] {
  return [
    { label: "stdout", text: run.stdout },
    { label: "stderr", text: run.stderr },
    { label: "journal", text: files.journalText },
    decodedSource("journal", files.journalText, true),
    { label: "result.json", text: files.resultText },
    decodedSource("result.json", files.resultText, false),
    { label: "repair message", text: message },
  ];
}

function onlyRepairMessage(records: readonly JournalRecord[]): string {
  const messages = repairMessages(records);
  assert.equal(messages.length, 1, "exactly one repair message was expected");
  return messages[0] ?? "";
}

test("F5-i 실패 근거: 가린 뒤 자르고 앞뒤를 남기며 토큰과 UTF-8 경계를 자르지 않는다", { timeout: 180_000 }, async (t) => {
  const sb = createSandbox(t);
  writeRepairProject(sb, { secret: FRAGMENT_SECRET });
  const counts = [400, 300];
  const verifiers: CommandVerifierConfig[] = counts.map((count) => ({
    id: `noisy-${count}`,
    kind: "command",
    executable: NODE,
    args: [NOISY_CHECK_PATH, String(count)],
    timeoutMs: 30_000,
  }));
  const taskPath = writeTask(
    sb,
    { id: "f5-i", secretEnv: [FAKE_SECRET_ENV_A], limits: { maxRepairAttempts: 1 }, verifiers },
    [...CLAIM_ONLY, ...spareSteps(1)],
  );
  const run = await runTask(taskPath, {
    cwd: sb.base,
    env: cliEnv({ extra: { [FAKE_SECRET_ENV_A]: FRAGMENT_SECRET } }),
    timeoutMs: 170_000,
  });
  const result = expectRunResult(run);
  const files = readRunFiles(sb.workspace, result);
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "verifier_failed");

  const repairs = repairStarts(files.records);
  assert.equal(repairs.length, 1);
  assert.deepEqual(repairs[0]?.failedVerifiers, verifiers.map((verifier) => verifier.id));
  const message = onlyRepairMessage(files.records);
  const firstRound = verifierResults(files.records).slice(0, verifiers.length);
  const share = MAX_FEEDBACK_BYTES / verifiers.length;
  for (const evidence of firstRound) {
    assert.ok(
      Buffer.byteLength(evidence.evidence) > share,
      `test assumption: ${evidence.id} evidence (${Buffer.byteLength(evidence.evidence)} bytes) must exceed its share (${share})`,
    );
  }

  await t.test("잘림 표시와 상한", () => {
    assert.equal(repairs[0]?.feedbackTruncated, true);
    for (const evidence of firstRound) {
      assert.equal(message.includes(evidence.evidence), false, `${evidence.id}: the middle must be left out`);
    }
    assert.ok(
      Buffer.byteLength(message) <= MAX_FEEDBACK_BYTES + FRAME_ALLOWANCE_BYTES,
      `repair message is ${Buffer.byteLength(message)} bytes`,
    );
  });

  await t.test("가린 근거의 앞부분과 뒷부분이 남는다", () => {
    for (const evidence of firstRound) {
      const text = evidence.evidence.trimEnd();
      assert.ok(message.includes(text.slice(0, EDGE_CHARS)), `${evidence.id}: head of the masked evidence is kept`);
      assert.ok(message.includes(text.slice(-EDGE_CHARS)), `${evidence.id}: tail of the masked evidence is kept`);
    }
    for (const count of counts) assert.ok(message.includes(noisyErrEndMark(count)), `end of noisy-${count} is kept`);
  });

  await t.test("가린 뒤 자른다: 원문과 정해진 변형 0건, 토큰은 있다", () => {
    assert.deepEqual(findLeaks(runSources(run, files, message), [FRAGMENT_SECRET], { extended: true }), []);
    assert.ok(countTokens(message) > 0, "the masked secret reaches the model as tokens");
  });

  await t.test("토큰과 UTF-8 문자 가운데서 자르지 않는다", () => {
    assertWholeTokens(message, "repair message");
    assert.equal(message.includes("�"), false, "no replacement character from a cut multi-byte sequence");
  });

  await t.test("비밀의 4자 조각도 없다", () => {
    assert.deepEqual(findFragments(runSources(run, files, message), FRAGMENT_SECRET, 4), []);
  });
});

test("F5-j 검증기 출력 끝 절단 경계에 걸친 비밀: 근거·기록·재수정 메시지에 조각 0건", { timeout: 180_000 }, async (t) => {
  const sb = createSandbox(t);
  writeRepairProject(sb, { secret: FRAGMENT_SECRET });
  const offsets = [1, 4, 10, 17, 20];
  const verifiers: CommandVerifierConfig[] = offsets.map((offset) => ({
    id: `tail-${offset}`,
    kind: "command",
    executable: NODE,
    args: [TAIL_CUT_PATH, String(tailCutAfter(VERIFY_TAIL_CHARS, FRAGMENT_SECRET.length, offset))],
    timeoutMs: 30_000,
  }));
  const taskPath = writeTask(
    sb,
    { id: "f5-j", secretEnv: [FAKE_SECRET_ENV_A], limits: { maxRepairAttempts: 1 }, verifiers },
    [...CLAIM_ONLY, ...spareSteps(1)],
  );
  const run = await runTask(taskPath, {
    cwd: sb.base,
    env: cliEnv({ extra: { [FAKE_SECRET_ENV_A]: FRAGMENT_SECRET } }),
    timeoutMs: 170_000,
  });
  const result = expectRunResult(run);
  const files = readRunFiles(sb.workspace, result);
  const message = onlyRepairMessage(files.records);

  for (const evidence of verifierResults(files.records).slice(0, verifiers.length)) {
    assert.equal(evidence.outcome, "fail");
    assert.ok(evidence.evidence.includes("zzzz"), `test assumption: ${evidence.id} output reached the evidence`);
  }
  assert.deepEqual(findLeaks(runSources(run, files, message), [FRAGMENT_SECRET], { extended: true }), []);
  assert.deepEqual(findFragments(runSources(run, files, message), FRAGMENT_SECRET, 4), []);
});

test("F5-k 스냅샷 원문은 journal, 결과, 모델 요청, 검색 결과에 없다", { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  writeRepairProject(sb);
  writeWorkspaceFile(sb, NOTES_PATH, NOTES_ORIGINAL);
  const taskPath = writeTask(
    sb,
    {
      id: "f5-k",
      workflow: "document",
      verifiers: [
        { id: "notes", kind: "file_rules", rules: [{ type: "contains", path: NOTES_PATH, text: "second version" }] },
      ],
    },
    [
      // Replaced without reading: the model never sees the original text.
      replaceAllStep("w-notes", NOTES_PATH, NOTES_ORIGINAL, NOTES_REPLACEMENT),
      // The query is a strict part of the marker: the call itself is recorded, so the full marker
      // in the journal can only come from a search hit (or another leak), never from the query.
      callStep("s-text", "search_files", { path: ".", text: MARKER_QUERY }),
      callStep("s-name", "search_files", { path: ".", nameContains: "draft" }),
      finalStep("메모를 바꿨다"),
    ],
  );
  const run = await runTask(taskPath, { cwd: sb.base });
  const result = expectRunResult(run);
  const files = readRunFiles(sb.workspace, result);
  assert.equal(result.status, "done");

  const snapshots = treeBytes(snapshotsDirOf(sb.workspace, result.runId));
  assert.ok(
    [...snapshots.values()].some((bytes) => bytes.toString("utf8").includes(SNAPSHOT_MARKER)),
    "the original must be kept under runs/<runId>/snapshots/ (R-6)",
  );

  const sources: TextSource[] = [
    { label: "stdout", text: run.stdout },
    { label: "stderr", text: run.stderr },
    { label: "journal", text: files.journalText },
    decodedSource("journal", files.journalText, true),
    { label: "result.json", text: files.resultText },
    { label: "model requests", text: allRequestText(files.records) },
  ];
  for (const source of sources) {
    assert.equal(source.text.includes(SNAPSHOT_MARKER), false, `the original reached ${source.label}`);
  }

  const byText = payloadOf<SearchFilesPayload>(toolResultFor(files.records, "s-text"));
  assert.deepEqual(byText.entries, [], "search must not find the original inside the state directory");
  const byName = payloadOf<SearchFilesPayload>(toolResultFor(files.records, "s-name"));
  assert.deepEqual(
    byName.entries.map((entry) => entry.path),
    [NOTES_PATH],
    "search must not list snapshot files",
  );
});
