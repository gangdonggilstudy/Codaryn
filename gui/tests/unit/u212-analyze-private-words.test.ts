/**
 * U-212 (bundle A, PM's insert): with U-210, analyze offers query_table and analyze-private is listed by
 * itself (BUILTIN_WORKFLOW_IDS). The new task screen's analyze notice says so now: a table read as it is
 * goes to the model as it is, query_table can send its groups only, and tables with personal data go
 * under an unreadable path with analyze-private (then only groups of k, 5 by default, or more rows reach
 * the model). And a start the app layer refuses with one of the CLI's hints (analyze-private without an
 * unreadable path: invalid_task or invalid_config with hint unreadable_paths_required) says why in the
 * CLI's words: the engine host passes the hint id, the main process checks it, the window shows its
 * words (error.hint.<hint>) where it has them.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { failureOf } from "../../src/engine-host/settings.js";
import { asStartRun } from "../../src/renderer/api.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { startErrorText, textsFor } from "../../src/renderer/i18n/catalog.js";
import { EN } from "../../src/renderer/i18n/en.js";
import { KO } from "../../src/renderer/i18n/ko.js";
import { RunModel } from "../../src/renderer/run/run-model.js";
import { runScreen } from "../../src/renderer/run/run-screen.js";
import { toStartFailure } from "../../src/shared/ipc.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

// This file runs as gui/build/tests/unit/u212-analyze-private-words.test.js.
const GUI = fileURLToPath(new URL("../../../", import.meta.url));
const DIST = path.join(GUI, "..", "dist", "src");
const BUILT = existsSync(path.join(DIST, "i18n", "ko.js"));
const HINTS = ["unreadable_paths_required", "unreadable_with_commands", "min_group_size_range"] as const;

test("U-212: analyze's notice says what is true with query_table, and where personal data goes", () => {
  for (const [texts, query, privately, groups] of [
    [KO, /query_table로 집계만 받을 수도/, /읽기 제외 경로에 두고 analyze-private/, /k개\(기본 5\) 이상인 묶음의 집계만/],
    [EN, /get only its groups from query_table/, /under an unreadable path and use analyze-private/, /groups of k \(5 by default\) or more rows/],
  ] as const) {
    const notice = texts["task.analyzeNotice"];
    assert.match(notice, query);
    assert.match(notice, privately);
    assert.match(notice, groups);
    assert.doesNotMatch(notice, /아직 없|no tool yet/, "the old claim is gone");
  }
});

test("U-212: a refused start keeps the CLI's hint id from the engine host to the window", () => {
  const refused = { ok: false, error: { code: "invalid_config", message: "policy.unreadablePaths …", hint: "unreadable_paths_required" } };
  assert.deepEqual(failureOf(refused), { ok: false, code: "invalid_config", hint: "unreadable_paths_required" });
  assert.deepEqual(failureOf({ ok: false, error: { code: "invalid_config", hint: "Not An Id" } }), { ok: false, code: "invalid_config" }, "an id only");
  assert.deepEqual(failureOf({ ok: false, error: { code: "invalid_config" } }), { ok: false, code: "invalid_config" });
  assert.deepEqual(toStartFailure({ ok: false, code: "invalid_task", hint: "unreadable_paths_required" }), { ok: false, code: "invalid_task", hint: "unreadable_paths_required" });
  assert.deepEqual(toStartFailure({ ok: false, code: "invalid_task", hint: "../x" }), { ok: false, code: "invalid_task" });
  assert.deepEqual(asStartRun({ ok: false, code: "invalid_task", hint: "unreadable_paths_required" }), { ok: false, code: "invalid_task", hint: "unreadable_paths_required" });
  assert.deepEqual(asStartRun({ ok: false, code: "invalid_task", hint: 3 }), { ok: false, code: "invalid_task" });
  const model = new RunModel();
  assert.ok(model.starting({ goal: "g", profile: null, workflow: "analyze-private" }));
  model.failedToStart("invalid_config", "unreadable_paths_required");
  assert.deepEqual([model.startError, model.startHint], ["invalid_config", "unreadable_paths_required"]);
  assert.ok(model.starting({ goal: "g", profile: null, workflow: null }));
  assert.equal(model.startHint, null, "a new start forgets it");
});

test("U-212: the run screen says why analyze-private was refused, in the CLI's words; an unknown hint adds nothing", async () => {
  const restore = installFakeDom();
  const roots: FakeElement[] = [];
  try {
    for (const language of ["ko", "en"] as const) {
      const texts = language === "ko" ? KO : EN;
      const t = textsFor(language);
      assert.equal(startErrorText(t, "invalid_config", "unreadable_paths_required"), `${t.format("error.invalid_config")} ${texts["error.hint.unreadable_paths_required"]} ${t.format("error.code", { code: "invalid_config" })}`);
      assert.equal(startErrorText(t, "invalid_config", "made_up"), startErrorText(t, "invalid_config", null));
      const model = new RunModel();
      model.starting({ goal: "g", profile: null, workflow: "analyze-private" });
      model.failedToStart("invalid_config", "unreadable_paths_required");
      const root = new FakeElement("main");
      roots.push(root);
      runScreen({ texts: t, api: new Proxy({} as CodarynApi, { get: () => async () => null }), run: model, newTask: () => undefined, announce: () => undefined, current: () => ({ handle: "1".repeat(32), name: "ws" }), openPlan: () => undefined, openChanges: () => undefined, openReport: () => undefined }).show(root as unknown as HTMLElement);
      await settle();
      const shown = root.findAll((e) => e.getAttribute("data-error") === "invalid_config")[0];
      assert.equal(shown?.getAttribute("data-hint"), "unreadable_paths_required");
      assert.ok(shown?.textContent.includes(texts["error.hint.unreadable_paths_required"]), language);
    }
  } finally {
    for (const root of roots) root.replaceChildren();
    restore();
  }
});

test("U-212: the hints' words are the CLI's, once the root has them (U-210)", { skip: !BUILT && "the engine is not built (npm run build in the root)" }, async () => {
  const ko = (await import(pathToFileURL(path.join(DIST, "i18n", "ko.js")).href)) as { KO_MESSAGES: Record<string, string> };
  const en = (await import(pathToFileURL(path.join(DIST, "i18n", "en.js")).href)) as { EN_MESSAGES: Record<string, string> };
  for (const hint of HINTS) {
    for (const [window, cli, language] of [[KO, ko.KO_MESSAGES, "ko"], [EN, en.EN_MESSAGES, "en"]] as const) {
      const id = `error.hint.${hint}`;
      assert.ok((window as Readonly<Record<string, string>>)[id], `${language} ${id} in the window`);
      // Before U-210 is in the root, its words are not there to compare with.
      if (cli[id] !== undefined) assert.equal((window as Readonly<Record<string, string>>)[id], cli[id], `${language} ${id}`);
    }
  }
});
