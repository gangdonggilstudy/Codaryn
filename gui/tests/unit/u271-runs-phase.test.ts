/**
 * U-271 (p4g's design check, C-27, U-155): a run without a result says in the run list where it is, as
 * the CLI's runs does: still going (running), stopped without a result (no_result), or unknown (an older
 * list without the phase). The engine host passes RunListEntry.phase; the main process takes it only for
 * a row without a status.
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

// This file runs as gui/build/tests/unit/u271-runs-phase.test.js.
const DIST = path.join(fileURLToPath(new URL("../../../", import.meta.url)), "..", "dist", "src");
const BUILT = existsSync(path.join(DIST, "i18n", "ko.js"));
const same = (text: string): string => text;
const entry = (runId: string, extra: Record<string, unknown>) => ({ state: "checked", runId, kind: "run", startedAt: null, taskId: "t", status: null, reason: null, changes: null, reverted: null, revertRecordDamaged: false, ...extra });
const RUNS = ["20261114T010000Z-0000a271", "20261114T020000Z-0000b271", "20261114T030000Z-0000c271", "20261114T040000Z-0000d271"];

test("U-271: the phase of a run without a result reaches the run list in the CLI's words", { skip: !BUILT && "the engine is not built (npm run build in the root)" }, async () => {
  const value = runsValue(
    {
      ok: true,
      output: {
        kind: "runs",
        runs: [entry(RUNS[0] as string, { phase: "running" }), entry(RUNS[1] as string, { phase: "no_result" }), entry(RUNS[2] as string, {}), entry(RUNS[3] as string, { status: "done", reason: "completed", phase: "finished" })],
        omitted: 0,
      },
    },
    same,
  ) as { ok: true; runs: Record<string, unknown>[]; omitted: number };
  assert.deepEqual(value.runs.map((run) => run["phase"]), ["running", "no_result", null, null], "finished is a status, not a phase to show");
  const reply = toRunsReply(value);
  assert.ok(reply.ok);
  const forged = (phase: unknown, at = 0) => toRunsReply({ ...value, runs: value.runs.map((run, index) => (index === at ? { ...run, phase } : run)) }).ok;
  assert.equal(forged("finished"), false);
  assert.equal(forged("running", 3), false, "a row with a status has no phase to show");
  const ko = (await import(pathToFileURL(path.join(DIST, "i18n", "ko.js")).href)) as { KO_MESSAGES: Record<string, string> };
  const en = (await import(pathToFileURL(path.join(DIST, "i18n", "en.js")).href)) as { EN_MESSAGES: Record<string, string> };
  for (const [gui, cli] of [["runs.phase.running", "runs.running"], ["runs.phase.no_result", "runs.no_result"], ["runs.phase.unknown", "runs.incomplete"]] as const) {
    assert.equal(KO[gui], ko.KO_MESSAGES[cli], `ko ${gui}`);
    assert.equal(EN[gui], en.EN_MESSAGES[cli], `en ${gui}`);
  }
  const restore = installFakeDom();
  try {
    const api = new Proxy({} as CodarynApi, { get: (_t, name: string) => async () => (name === "listRuns" && reply.ok ? { ok: true, runs: reply.runs, omitted: 0 } : null) });
    const screen = runsScreen({ texts: textsFor("ko"), api, current: () => ({ handle: "1".repeat(32), name: "ws" }), open: () => undefined, announce: () => undefined, openPlan: () => undefined, openChanges: () => undefined, openReport: () => undefined });
    const root = new FakeElement("main");
    screen.show(root as unknown as HTMLElement);
    await settle();
    const facts = (runId: string): string => root.findAll((e) => e.getAttribute("data-run") === runId)[0]?.findAll((e) => e.getAttribute("class") === "run-facts")[0]?.textContent ?? "";
    assert.ok(facts(RUNS[0] as string).includes(KO["runs.phase.running"]));
    assert.ok(facts(RUNS[1] as string).includes(KO["runs.phase.no_result"]));
    assert.ok(facts(RUNS[2] as string).includes(KO["runs.phase.unknown"]));
  } finally {
    restore();
  }
});
