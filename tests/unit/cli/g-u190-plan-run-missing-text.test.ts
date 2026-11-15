/**
 * U-190 (AXM-21, PM decision (a)): `plan_run_missing` comes from `plan` and `apply` (the plan run's
 * plan.json is gone) and from reverting an apply (the plan run it used is gone), but the human error
 * said only the revert's story ("the plan run this apply used…", "An apply can be reverted only
 * while…") to a person who was viewing a plan. The renderer picks the lines by the code alone, so
 * the two texts now fit every command: what happened without naming an apply, and how to fix it for
 * a plan (make it again with codaryn run) and for a revert (keep or restore the plan run). English and
 * Korean; the JSON is not touched. Scripted model, temporary folders.
 */

import assert from "node:assert/strict";
import { rmSync, unlinkSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import type { CliErrorOutput, MessageCatalog } from "../../../src/contracts/index.js";
import { createHumanOutput } from "../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { cliEnv } from "../../support/cli.js";
import { runGuarded } from "../../support/fake-anthropic.js";
import { createSandbox } from "../../fixtures/builders.js";
import { organizeScript, writeOrganizeTask, writeOrganizeWorkspace } from "../../fixtures/general-tasks.js";

const OUTPUT: CliErrorOutput = { schemaVersion: 1, kind: "error", code: "plan_run_missing", exitCode: 2, message: "m", category: "state", retryable: false };
/** For each language: what fits a plan's view (make it again) and a revert (keep the plan run), and what was only the revert's. */
const WORDS = {
  en: { plan: "codaryn run", revert: "To revert an apply", onlyRevert: ["this apply used", "An apply can be reverted only while"] },
  ko: { plan: "codaryn run", revert: "적용을 되돌리려면", onlyRevert: ["이 적용이 쓴", "남겨 두어야 합니다"] },
} as const;

function check(text: string, lang: "en" | "ko"): void {
  const words = WORDS[lang];
  assert.ok(text.includes(words.plan), `${lang}: how to make the plan again\n${text}`);
  assert.ok(text.includes(words.revert), `${lang}: how to revert an apply\n${text}`);
  for (const only of words.onlyRevert) assert.equal(text.includes(only), false, `${lang}: "${only}" is the revert's story only\n${text}`);
}

describe("U-190: plan_run_missing's lines fit a plan's view and a revert", () => {
  for (const lang of ["en", "ko"] as const) {
    test(`${lang}: the renderer's lines`, () => {
      const messages: MessageCatalog = createMessageCatalog(lang);
      check(createHumanOutput(messages).error(OUTPUT), lang);
    });
  }
});

describe("U-190 on the real CLI: plan with its plan.json gone, and a revert of an apply whose plan run is gone", () => {
  test("both say the same fitting lines; the JSON code is as before", { timeout: 60_000 }, async (t) => {
    const sb = createSandbox(t);
    writeOrganizeWorkspace(sb);
    const task = writeOrganizeTask(sb, "u190-organize", organizeScript());
    const made = JSON.parse((await runGuarded(sb, ["run", "--task", task], cliEnv())).stdout.trim()) as { runId: string; plan: { digest: string } };
    const applied = JSON.parse((await runGuarded(sb, ["apply", "--task", task, "--run", made.runId, "--digest", made.plan.digest.slice(0, 12)], cliEnv())).stdout.trim()) as {
      runId: string;
      status: string;
    };
    assert.equal(applied.status, "done");
    const planDir = path.join(sb.workspace, ".codaryn", "runs", made.runId);
    unlinkSync(path.join(planDir, "plan.json"));
    for (const lang of ["en", "ko"] as const) {
      const shown = await runGuarded(sb, ["plan", "--task", task, "--run", made.runId], cliEnv({ extra: { CODARYN_LANG: lang } }));
      assert.equal((JSON.parse(shown.stdout.trim()) as CliErrorOutput).code, "plan_run_missing", shown.stdout);
      check(shown.stderr, lang);
    }
    rmSync(planDir, { recursive: true, force: true });
    for (const lang of ["en", "ko"] as const) {
      const reverted = await runGuarded(sb, ["revert", "--workspace", sb.workspace, "--run", applied.runId], cliEnv({ extra: { CODARYN_LANG: lang } }));
      assert.equal((JSON.parse(reverted.stdout.trim()) as CliErrorOutput).code, "plan_run_missing", reverted.stdout);
      check(reverted.stderr, lang);
    }
  });
});
