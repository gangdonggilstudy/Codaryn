/**
 * U-244 (the CLI's runs table, U-139 and U-198): in the run list, an apply run names the plan run it
 * applied (runs.apply_of) and a run that carried out a changes plan names the plan run it carried out
 * (runs.carried_plan), right after its facts, in the CLI's words. The engine host passes the entry's
 * planRunId (RunListEntry.planRunId), the main process takes only a run id that is not the row's own.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runsValue } from "../../src/engine-host/history.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { EN } from "../../src/renderer/i18n/en.js";
import { KO } from "../../src/renderer/i18n/ko.js";
import { runsScreen } from "../../src/renderer/runs/runs-screen.js";
import { toRunsReply } from "../../src/shared/ipc.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

// This file runs as gui/build/tests/unit/u244-runs-plan-of.test.js.
const GUI = fileURLToPath(new URL("../../../", import.meta.url));
const DIST = path.join(GUI, "..", "dist", "src");
const BUILT = existsSync(path.join(DIST, "i18n", "ko.js"));

const HANDLE = "1".repeat(32);
const PLAN = "20261113T160000Z-0000a244";
const APPLY = "20261113T161000Z-0000b244";
const CARRY = "20261113T162000Z-0000c244";
const OTHER = "20261113T163000Z-0000d244";
const same = (text: string): string => text;
const entry = (runId: string, extra: Record<string, unknown>) => ({ state: "checked", runId, kind: "run", startedAt: null, taskId: "t", status: "done", reason: "completed", changes: 0, reverted: null, revertRecordDamaged: false, ...extra });
const entries = [
  entry(PLAN, { status: "needs-input", reason: "plan_pending" }),
  entry(APPLY, { kind: "apply", planRunId: PLAN, reason: "applied" }),
  entry(CARRY, { planRunId: PLAN, status: "needs-input", reason: "no_verifier", changes: 1 }),
  entry(OTHER, { planRunId: "latest" }),
];

test("U-244: the engine host passes the plan run an apply run applied or a run carried out; the main process checks it", () => {
  const value = runsValue({ ok: true, output: { kind: "runs", runs: entries, omitted: 0 } }, same) as { ok: true; runs: Record<string, unknown>[]; omitted: number };
  assert.deepEqual(
    value.runs.map((run) => [run["runId"], run["planRunId"]]),
    [
      [PLAN, null],
      [APPLY, PLAN],
      [CARRY, PLAN],
      [OTHER, null],
    ],
    "a value that is not a run id is not passed on",
  );
  const reply = toRunsReply(value);
  assert.ok(reply.ok);
  if (reply.ok) assert.deepEqual(reply.runs.map((run) => (run.state === "checked" ? run.planRunId : undefined)), [null, PLAN, PLAN, null]);
  const forged = (planRunId: unknown, at = 1) => toRunsReply({ ...value, runs: value.runs.map((run, index) => (index === at ? { ...run, planRunId } : run)) }).ok;
  assert.equal(forged("latest"), false);
  assert.equal(forged(APPLY), false, "not the row's own id");
  assert.equal(forged(undefined), true, "absent: none");
});

test("U-244: an apply run's row and a carrying run's row name their plan run in the CLI's runs words", { skip: !BUILT && "the engine is not built (npm run build in the root)" }, async () => {
  const ko = (await import(pathToFileURL(path.join(DIST, "i18n", "ko.js")).href)) as { KO_MESSAGES: Record<string, string> };
  const en = (await import(pathToFileURL(path.join(DIST, "i18n", "en.js")).href)) as { EN_MESSAGES: Record<string, string> };
  assert.equal(KO["runs.applyOf"], ko.KO_MESSAGES["runs.apply_of"]);
  assert.equal(EN["runs.applyOf"], en.EN_MESSAGES["runs.apply_of"]);
  assert.equal(KO["runs.carriedPlan"], ko.KO_MESSAGES["runs.carried_plan"]);
  assert.equal(EN["runs.carriedPlan"], en.EN_MESSAGES["runs.carried_plan"]);
  const value = runsValue({ ok: true, output: { kind: "runs", runs: entries, omitted: 0 } }, same);
  const reply = toRunsReply(value);
  assert.ok(reply.ok);
  const restore = installFakeDom();
  try {
    for (const language of ["ko", "en"] as const) {
      const texts = language === "ko" ? KO : EN;
      const api = new Proxy({} as CodarynApi, { get: (_t, name: string) => async () => (name === "listRuns" && reply.ok ? { ok: true, runs: reply.runs, omitted: 0 } : null) });
      const screen = runsScreen({ texts: textsFor(language), api, current: () => ({ handle: HANDLE, name: "ws" }), open: () => undefined, announce: () => undefined, openPlan: () => undefined, openChanges: () => undefined, openReport: () => undefined });
      const root = new FakeElement("main");
      screen.show(root as unknown as HTMLElement);
      await settle();
      const of = (runId: string): FakeElement | undefined => root.findAll((e) => e.getAttribute("data-run") === runId)[0]?.findAll((e) => e.getAttribute("class") === "plan-of")[0];
      assert.deepEqual([of(APPLY)?.getAttribute("data-plan-of-kind"), of(APPLY)?.textContent], ["apply", texts["runs.applyOf"].replace("{runId}", PLAN)]);
      assert.deepEqual([of(CARRY)?.getAttribute("data-plan-of-kind"), of(CARRY)?.textContent], ["carried", texts["runs.carriedPlan"].replace("{runId}", PLAN)]);
      assert.equal(of(PLAN), undefined, "a plan run names no plan run");
      assert.equal(of(OTHER), undefined);
    }
  } finally {
    restore();
  }
});
