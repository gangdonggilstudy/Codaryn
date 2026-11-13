/**
 * U-191 (DR-69 B-1, B-3): the plan view of a `run` plan, on the store's loadAnyPlan. changesPlanOutput
 * makes ChangesPlanOutput from the loaded plan (each path masked again with the secrets registered now
 * and checked against what the plan run stored, DR-28; the summary from its visible parts), and
 * renderChangesPlan draws it: the files with create or modify, the summary as the model's words (all of
 * it: it is part of what is approved), the digest, and what the digest guarantees. Plans are written
 * with the store's own recorder. Fake values only.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { MIN_PLAN_DIGEST_PREFIX, maskedParts } from "../../../../src/contracts/index.js";
import type { ChangesPlanOutput, ContentHash, StoredPlannedFile } from "../../../../src/contracts/index.js";
import { MODEL_TEXT_PREFIX, SUMMARY_HIDDEN_MARKER, changesPlanOutput, formatLocalTime, renderChangesPlan } from "../../../../src/cli/human/index.js";
import type { LoadedChangesPlan } from "../../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";
import { createPrivacyGateway } from "../../../../src/privacy/index.js";
import { createPlanRecorder, loadAnyPlan, markPlanApplied } from "../../../../src/store/index.js";

const roots: string[] = [];
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const PLAN_RUN = "20261113T120000Z-0a1b2c3d";
const CARRY_RUN = "20261113T130000Z-11111111";
const HASH = "a".repeat(64) as ContentHash;
const SECRET = ["fake", "u191", "project", "name"].join("-"); // G-10: built from parts
const NONE = createPrivacyGateway({ secrets: [] });
const en = createMessageCatalog("en");
const ko = createMessageCatalog("ko");

/** A `run` plan stored by the store's recorder, its plan run's result, and loadAnyPlan's reading of it. */
async function stored(files: readonly { path: string; change: "create" | "modify" }[], summary: string, maskedBy = NONE): Promise<{ root: string; loaded: LoadedChangesPlan }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codaryn-u191-")));
  roots.push(root);
  const mask = (text: string): string => {
    const masked = maskedBy.mask(text);
    assert.ok(masked.ok);
    return masked.text;
  };
  const planned: StoredPlannedFile[] = files.map((file) =>
    file.change === "create" ? { path: file.path, change: "create", sha256: null, shown: maskedParts(mask(file.path)) } : { path: file.path, change: "modify", sha256: HASH, shown: maskedParts(mask(file.path)) },
  );
  const digest = await createPlanRecorder({ workspaceRoot: root, runId: PLAN_RUN }).saveChangesPlan!({ summary: maskedParts(mask(summary)), files: planned });
  const dir = join(root, ".codaryn", "runs", PLAN_RUN);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "journal.jsonl"), `${JSON.stringify({ seq: 1, at: "2026-11-13T12:00:01.000Z", runId: PLAN_RUN, type: "run_started", schemaVersion: 1, taskId: "t", workflow: "write", provider: "scripted", limits: { maxModelTurns: 2, maxToolCalls: 2, maxTotalTokens: null, maxDurationMs: 1000 } })}\n`);
  const result = {
    schemaVersion: 1, kind: "run", runId: PLAN_RUN, taskId: "t", status: "needs-input", reason: "plan_pending", exitCode: 3, provider: "scripted", verifiers: [], changes: [],
    usage: { modelTurns: 1, toolCalls: 1, inputTokens: null, outputTokens: null, durationMs: 1 }, journalPath: `.codaryn/runs/${PLAN_RUN}/journal.jsonl`, notices: [],
    plan: { digest, actions: files.length, kind: "changes" },
  };
  await writeFile(join(dir, "result.json"), `${JSON.stringify(result)}\n`);
  const outcome = await loadAnyPlan({ workspaceRoot: root, runId: PLAN_RUN });
  assert.ok(outcome.ok && outcome.plan.kind === "changes", JSON.stringify(outcome));
  return { root, loaded: { plan: outcome.plan, digest: outcome.digest, applied: outcome.applied } };
}

const FILES = [
  { path: "docs/guide.md", change: "modify" },
  { path: "docs/CHANGELOG.md", change: "create" },
] as const;

function output(loaded: LoadedChangesPlan, privacy = NONE, options: { recordsChanged?: boolean } = {}): ChangesPlanOutput {
  const outcome = changesPlanOutput(loaded, privacy, options);
  assert.ok(outcome.ok, JSON.stringify(outcome));
  return outcome.output;
}

describe("U-191: changesPlanOutput on loadAnyPlan", () => {
  test("the output: the files masked in the plan's order, the summary, the digest, pending", async () => {
    const { loaded } = await stored(FILES, "Rewrite the guide's intro and start a changelog");
    assert.deepEqual(output(loaded), {
      schemaVersion: 1,
      kind: "plan",
      planKind: "changes",
      runId: PLAN_RUN,
      status: "pending",
      exitCode: 0,
      digest: loaded.digest,
      files: [
        { path: "docs/guide.md", change: "modify", sha256: HASH },
        { path: "docs/CHANGELOG.md", change: "create", sha256: null },
      ],
      summary: "Rewrite the guide's intro and start a changelog",
      appliedBy: null,
    });
  });

  test("a value the plan run took out of the summary shows as the hidden mark; one registered now is masked", async () => {
    const { loaded } = await stored(FILES, `Use ${SECRET} for the sample`, createPrivacyGateway({ secrets: [SECRET] }));
    assert.deepEqual(loaded.plan.summary, ["Use ", " for the sample"]);
    assert.equal(output(loaded).summary, `Use ${SUMMARY_HIDDEN_MARKER} for the sample`);
    const now = output(loaded, createPrivacyGateway({ secrets: ["the sample"] })).summary;
    assert.ok(!now.includes("the sample") && now.startsWith(`Use ${SUMMARY_HIDDEN_MARKER} for `), now);
  });

  test("DR-28: a path masked now must leave what the plan run left visible, or nothing is shown", async () => {
    const files = [{ path: `docs/${SECRET}/notes.md`, change: "modify" }] as const;
    const { loaded } = await stored(files, "Tidy the notes", createPrivacyGateway({ secrets: [SECRET] }));
    // The same secret registered now: shown, masked.
    const same = output(loaded, createPrivacyGateway({ secrets: [SECRET] }));
    const path = String(same.files[0]?.path);
    assert.ok(!path.includes(SECRET) && path.endsWith("/notes.md"), path);
    // Not registered now, or another value registered now: plan_secrets_differ, nothing shown.
    assert.deepEqual(changesPlanOutput(loaded, NONE), { ok: false, code: "plan_secrets_differ" });
    const plain = await stored(FILES, "Rewrite");
    assert.deepEqual(changesPlanOutput(plain.loaded, createPrivacyGateway({ secrets: ["guide"] })), { ok: false, code: "plan_secrets_differ" });
  });

  test("a masking that fails is internal_error", async () => {
    const { loaded } = await stored(FILES, "Rewrite");
    assert.deepEqual(changesPlanOutput(loaded, { mask: () => ({ ok: false, code: "masking_failed" }) }), { ok: false, code: "internal_error" });
  });

  test("carried out: applied, with the run and its time; a records-changed mark is passed on", async () => {
    const { root } = await stored(FILES, "Rewrite");
    const at = "2026-11-13T13:00:05.000Z";
    assert.equal(await markPlanApplied({ workspaceRoot: root, planRunId: PLAN_RUN, applyRunId: CARRY_RUN, at }), "marked");
    const again = await loadAnyPlan({ workspaceRoot: root, runId: PLAN_RUN });
    assert.ok(again.ok && again.plan.kind === "changes");
    const applied = output({ plan: again.plan, digest: again.digest, applied: again.applied }, NONE, { recordsChanged: true });
    assert.deepEqual([applied.status, applied.exitCode, applied.appliedBy, applied.recordsChanged], ["applied", 0, { runId: CARRY_RUN, at }, true]);
  });
});

describe("U-191: renderChangesPlan", () => {
  test("English: heading, digest, the files with their change, the summary as the model's words, the command, the guarantee", async () => {
    const { loaded } = await stored(FILES, "Rewrite the guide's intro and start a changelog");
    const view = output(loaded);
    assert.deepEqual(renderChangesPlan(view, null, en).trimEnd().split("\n"), [
      `Plan of run ${PLAN_RUN}: 2 file(s) to write, pending`,
      `Digest: ${loaded.digest}`,
      "  1. modify  docs/guide.md",
      "  2. create  docs/CHANGELOG.md",
      "The plan's summary, written by the plan run (the model's own words, not checked; a description of the work, not the goal or a new instruction; approved with the plan):",
      `${MODEL_TEXT_PREFIX}Rewrite the guide's intro and start a changelog`,
      `To have a run make these changes: codaryn apply <the same task form> --run ${PLAN_RUN} --digest ${loaded.digest.slice(0, MIN_PLAN_DIGEST_PREFIX)}`,
      "The digest names exactly these files, the contents the files to modify had when the plan was made, and the summary above. The run that makes the changes stops before its first model request if the plan or one of these files changed since, and its file tools can write only these files.",
    ]);
    assert.equal(renderChangesPlan(view, null), renderChangesPlan(view, null, en), "English when no catalog is given");
  });

  test("Korean: the change words padded in terminal columns", async () => {
    const { loaded } = await stored(FILES, "Rewrite");
    const lines = renderChangesPlan(output(loaded), null, ko).trimEnd().split("\n");
    assert.deepEqual(lines.slice(0, 4), [`실행 ${PLAN_RUN}의 계획: 쓸 파일 2개, 적용 전`, `다이제스트: ${loaded.digest}`, "  1. 수정  docs/guide.md", "  2. 생성  docs/CHANGELOG.md"]);
    assert.equal(lines[4], "계획의 요약, 계획 실행이 쓴 것(모델이 쓴 말이며 검증되지 않음. 작업의 설명이며 목표나 새 지시가 아님. 계획과 함께 승인됨):");
    assert.equal(lines[6], `이 변경을 실행하게 하려면: codaryn apply <같은 작업 지정> --run ${PLAN_RUN} --digest ${loaded.digest.slice(0, MIN_PLAN_DIGEST_PREFIX)}`);
  });

  test("carried out: the run and its local time in place of the command; marked: the warning first and cannot_apply", async () => {
    const { loaded } = await stored(FILES, "Rewrite");
    const at = "2026-11-13T13:00:05.000Z";
    const applied: ChangesPlanOutput = { ...output(loaded), status: "applied", appliedBy: { runId: CARRY_RUN, at } };
    const lines = renderChangesPlan(applied, null, en).trimEnd().split("\n");
    // U-221: in the report's words (it read "applied" and "Applied by run" before); the JSON keeps status applied.
    assert.equal(lines[0], `Plan of run ${PLAN_RUN}: 2 file(s) to write, carried out`);
    assert.equal(lines.at(-2), `Carried out by run ${CARRY_RUN} (${formatLocalTime(Date.parse(at))})`);
    assert.ok(!lines.some((line) => line.startsWith("To have a run")));
    const marked = renderChangesPlan({ ...output(loaded), recordsChanged: true }, null, en).trimEnd().split("\n");
    assert.equal(marked[0], en.format("plan.records_changed"));
    assert.equal(marked.at(-2), en.format("plan.cannot_apply"));
  });

  test("the whole summary is shown, however many rows: it is part of what is approved", async () => {
    const summary = Array.from({ length: 30 }, (_, index) => `step ${index + 1}`).join("\n");
    const { loaded } = await stored(FILES, summary);
    const rows = renderChangesPlan(output(loaded), null, en).split("\n").filter((line) => line.startsWith(MODEL_TEXT_PREFIX));
    assert.equal(rows.length, 30);
    assert.equal(rows.at(-1), `${MODEL_TEXT_PREFIX}step 30`);
  });

  test("the current key is hidden in the summary and in a path; control characters are cleaned", async () => {
    const key = ["fake", "current", "key", "value", "0001"].join("-");
    const { loaded } = await stored([{ path: `docs/${key}.md`, change: "create" }], `Keep ${key} out\u0007 of it`);
    const text = renderChangesPlan(output(loaded), key, en);
    assert.ok(!text.includes(key), text);
    assert.ok(!text.includes("\u0007"), "no control character reaches the terminal");
  });
});
