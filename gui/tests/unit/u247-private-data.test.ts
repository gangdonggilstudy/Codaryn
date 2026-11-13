/**
 * U-247 (bundle A, proposal P-4, p5a's U-215): the settings screen edits the config's unreadable paths
 * (policy.unreadablePaths) and its k (policy.minGroupSize), and the new task screen says what
 * analyze-private needs when it is chosen. The window names one edit; the engine host applies it to
 * the config as it is now and the app layer proposes the change (removing an entry or lowering k is a
 * widening, U-204, named by U-212's kinds). The app layer gives the config's list and k with the
 * contract's range (SettingsView.privateData); the engine host cleans the paths and the main process
 * checks the shape. Command rules cannot be kept with unreadable paths (the CLI's R-5): the settings
 * section says so, as an alert when the config has both.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { settingsValue } from "../../src/engine-host/settings.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { EN } from "../../src/renderer/i18n/en.js";
import { KO } from "../../src/renderer/i18n/ko.js";
import { RunModel } from "../../src/renderer/run/run-model.js";
import { newTaskScreen } from "../../src/renderer/run/new-task.js";
import { settingsScreen } from "../../src/renderer/settings/settings.js";
import { toSettingsView } from "../../src/shared/ipc.js";
import { applySettingsEdit, parseSettingsEdit } from "../../src/shared/settings-edit.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const HANDLE = "1".repeat(32);
const same = (text: string): string => text;
const clean = (text: string): string => text.replace("[[KEY]]", "[key]");
const byId = (root: FakeElement, id: string): FakeElement | undefined => root.findAll((e) => e.getAttribute("id") === id)[0];

test("U-247: the three edits are checked field by field and applied to the config's policy", () => {
  assert.deepEqual(parseSettingsEdit({ op: "addUnreadablePath", path: "data/private" }), { op: "addUnreadablePath", path: "data/private" });
  assert.deepEqual(parseSettingsEdit({ op: "removeUnreadablePath", index: 0, shown: "data/private" }), { op: "removeUnreadablePath", index: 0, shown: "data/private" });
  assert.deepEqual(parseSettingsEdit({ op: "minGroupSize", value: 10 }), { op: "minGroupSize", value: 10 });
  assert.deepEqual(parseSettingsEdit({ op: "minGroupSize", value: null }), { op: "minGroupSize", value: null });
  for (const bad of [{ op: "addUnreadablePath", path: "" }, { op: "addUnreadablePath", path: "a\u0007" }, { op: "minGroupSize", value: 7.5 }, { op: "minGroupSize", value: 0 }, { op: "minGroupSize", value: "10" }, { op: "minGroupSize", value: 10, extra: 1 }]) {
    assert.equal(parseSettingsEdit(bad), null, JSON.stringify(bad));
  }
  const config = { schemaVersion: 1, policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, unreadablePaths: ["data/[[KEY]]"] } };
  const added = applySettingsEdit(config, { op: "addUnreadablePath", path: "data/private" }, clean);
  assert.ok(added.ok && JSON.stringify((added.next["policy"] as Record<string, unknown>)["unreadablePaths"]) === JSON.stringify(["data/[[KEY]]", "data/private"]));
  assert.deepEqual(applySettingsEdit(config, { op: "addUnreadablePath", path: "data/[[KEY]]" }, clean), { ok: false, code: "already_present" });
  assert.deepEqual(applySettingsEdit(config, { op: "removeUnreadablePath", index: 0, shown: "data/other" }, clean), { ok: false, code: "settings_changed" }, "the shown text names the entry");
  const removed = applySettingsEdit(config, { op: "removeUnreadablePath", index: 0, shown: "data/[key]" }, clean);
  assert.ok(removed.ok && JSON.stringify((removed.next["policy"] as Record<string, unknown>)["unreadablePaths"]) === "[]");
  assert.equal(JSON.stringify(config).includes("data/private"), false, "the config given is not changed");
  const k = applySettingsEdit({ schemaVersion: 1 }, { op: "minGroupSize", value: 12 }, same);
  assert.ok(k.ok && (k.next["policy"] as Record<string, unknown>)["minGroupSize"] === 12, "a policy made when none is there");
  const unset = applySettingsEdit({ schemaVersion: 1 }, { op: "minGroupSize", value: null }, same);
  assert.ok(unset.ok && !("policy" in unset.next), "unsetting makes no policy");
  const back = applySettingsEdit({ policy: { minGroupSize: 12, commands: [] } }, { op: "minGroupSize", value: null }, same);
  assert.ok(back.ok && JSON.stringify(back.next["policy"]) === JSON.stringify({ commands: [] }));
});

const appView = (privateData: unknown) => ({
  ok: true,
  output: { file: null, config: { policy: { commands: [] } }, profiles: [], builtinWorkflows: ["analyze-private"], workflows: [], keyAvailable: false, privateData },
});

test("U-247: the engine host passes the app's private data, paths cleaned; the main process checks its shape", () => {
  const value = settingsValue(appView({ unreadablePaths: ["data/[[KEY]]", 3], minGroupSize: { configured: null, effective: 5, min: 5, max: 1000 } }), clean, []) as { ok: true; view: Record<string, unknown> };
  assert.deepEqual(value.view["privateData"], { unreadablePaths: ["data/[key]", "?"], minGroupSize: { configured: null, effective: 5, min: 5, max: 1000 } });
  const env = { model: false, language: false };
  const checked = toSettingsView(value, env);
  assert.ok(checked.ok && checked.view.privateData?.minGroupSize.effective === 5);
  assert.equal((settingsValue(appView(undefined), clean, []) as { view: Record<string, unknown> }).view["privateData"], null, "an app without it: none");
  assert.equal((settingsValue(appView({ unreadablePaths: [], minGroupSize: { configured: "x", effective: 5, min: 5, max: 1000 } }), clean, []) as { view: Record<string, unknown> }).view["privateData"], null);
  const forged = (privateData: unknown) => toSettingsView({ ...value, view: { ...value.view, privateData } }, env).ok;
  assert.equal(forged({ unreadablePaths: [], minGroupSize: { configured: null, effective: 3, min: 5, max: 1000 } }), false, "k below the range");
  assert.equal(forged({ unreadablePaths: [], minGroupSize: { configured: null, effective: 5, min: 1000, max: 5 } }), false);
  assert.equal(forged({ unreadablePaths: "data", minGroupSize: { configured: null, effective: 5, min: 5, max: 1000 } }), false);
  assert.equal(forged(null), true);
});

function settingsApi(view: Record<string, unknown>, calls: unknown[]): CodarynApi {
  const replies: Record<string, (arg: unknown) => unknown> = {
    settings: () => ({ ok: true, view }),
    proposeSettings: (edit) => {
      calls.push(edit);
      return { ok: true, token: "e".repeat(32), changes: [], widening: [] };
    },
  };
  return new Proxy({} as CodarynApi, { get: (_t, name: string) => async (arg: unknown) => replies[name]?.(arg) ?? null });
}

const baseView = (commands: string[], unreadablePaths: string[], configured: number | null) => ({
  file: { display: "~/cfg/config.json", source: "environment", exists: true },
  model: null,
  language: null,
  profiles: [],
  workflows: { builtin: ["analyze", "analyze-private"], config: [] },
  keyAvailable: true,
  providers: [],
  env: { model: false, language: false },
  rules: { limits: [], commands, protectedPaths: [], secretEnv: [] },
  privateData: { unreadablePaths, minGroupSize: { configured, effective: configured ?? 5, min: 5, max: 1000 } },
});

test("U-247: the settings screen lists the unreadable paths and k, proposes their edits, and says commands cannot be kept with them", async () => {
  const restore = installFakeDom();
  try {
    for (const language of ["ko", "en"] as const) {
      const texts = language === "ko" ? KO : EN;
      const calls: unknown[] = [];
      const screen = settingsScreen({ texts: textsFor(language), api: settingsApi(baseView([], ["data/private"], null), calls), language, announce: () => undefined });
      const root = new FakeElement("main");
      screen.show(root as unknown as HTMLElement);
      await settle();
      assert.ok(byId(root, "settings-private") !== undefined, language);
      assert.equal(byId(root, "settings-min-group-size")?.getAttribute("data-configured"), "none");
      assert.ok(byId(root, "settings-min-group-size")?.textContent.startsWith(texts["settings.minGroupSizeDefault"].replace("{value}", "5")));
      assert.ok(byId(root, "settings-unreadable-commands-note") !== undefined && byId(root, "settings-unreadable-commands") === undefined);
      (byId(root, "settings-unreadable-path") as FakeElement).value = " data/people ";
      byId(root, "settings-unreadable-add")?.click();
      await settle();
      root.findAll((e) => e.getAttribute("data-remove") === "removeUnreadablePath")[0]?.click();
      await settle();
      const input = byId(root, "settings-min-group-size-input") as FakeElement;
      input.value = "3";
      byId(root, "settings-min-group-size-set")?.click();
      assert.equal(byId(root, "settings-proposal")?.getAttribute("data-proposal"), "bad_number", "below the contract's range: not asked");
      input.value = "20";
      byId(root, "settings-min-group-size-set")?.click();
      await settle();
      assert.deepEqual(calls, [
        { op: "addUnreadablePath", path: "data/people" },
        { op: "removeUnreadablePath", index: 0, shown: "data/private" },
        { op: "minGroupSize", value: 20 },
      ]);
    }
    // A config with command rules and unreadable paths: runs are refused, said as an alert; k set: it can go back.
    const calls: unknown[] = [];
    const screen = settingsScreen({ texts: textsFor("ko"), api: settingsApi(baseView(["npm test"], ["data/private"], 10), calls), language: "ko", announce: () => undefined });
    const root = new FakeElement("main");
    screen.show(root as unknown as HTMLElement);
    await settle();
    assert.equal(byId(root, "settings-unreadable-commands")?.getAttribute("role"), "alert");
    assert.equal(byId(root, "settings-min-group-size")?.getAttribute("data-configured"), "10");
    byId(root, "settings-min-group-size-unset")?.click();
    await settle();
    assert.deepEqual(calls, [{ op: "minGroupSize", value: null }]);
  } finally {
    restore();
  }
});

test("U-247: choosing analyze-private says what it does and, from the config, what would make its run refused", async () => {
  const restore = installFakeDom();
  try {
    for (const [commands, paths, needs, refused] of [
      [[], [], true, false],
      [["npm test"], ["data/private"], false, true],
      [[], ["data/private"], false, false],
    ] as const) {
      const view = baseView([...commands], [...paths], null);
      const api = new Proxy({} as CodarynApi, { get: (_t, name: string) => async () => (name === "settings" ? { ok: true, view } : null) });
      const screen = newTaskScreen({ texts: textsFor("ko"), api, run: new RunModel(), current: () => ({ handle: HANDLE, name: "ws" }), open: () => undefined, showRun: () => undefined });
      const root = new FakeElement("main");
      screen.show(root as unknown as HTMLElement);
      await settle();
      const notice = byId(root, "task-private-notice") as FakeElement;
      assert.ok(notice.hasAttribute("hidden"), "not for other task types");
      const workflow = byId(root, "task-workflow") as FakeElement;
      workflow.value = "analyze-private";
      workflow.dispatch("change");
      assert.equal(notice.hasAttribute("hidden"), false);
      assert.ok(notice.textContent.startsWith(KO["task.privateNotice"]));
      assert.equal(byId(root, "task-private-needs-unreadable") !== undefined, needs, `needs ${JSON.stringify(paths)}`);
      assert.equal(byId(root, "task-private-commands") !== undefined, refused, `commands ${JSON.stringify(commands)}`);
      workflow.value = "analyze";
      workflow.dispatch("change");
      assert.ok(notice.hasAttribute("hidden"), "analyze's own notice instead");
    }
  } finally {
    restore();
  }
});
