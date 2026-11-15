/**
 * U-64 (docs/design/standalone-gui.md 3.12, 4.4): when the engine host has ended (or did not start),
 * the window shows a card that says a run going on has an unknown end and offers to start the
 * engine again; only that button restarts it (the main process never does on its own). A failed
 * restart says why and can be tried again; a restart that worked hides the card.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { asEngineState, asRestart } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { Shell } from "../../src/renderer/shell/shell.js";
import { IPC_CHANNELS, IPC_EVENTS } from "../../src/shared/ipc.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

test("U-64: the engine card says the end is unknown, restarts only on its button, and goes when the engine is ready", async () => {
  const restore = installFakeDom();
  try {
    const shell = new Shell(textsFor("en"), { openWorkspace: () => undefined });
    const root = new FakeElement("div");
    shell.mount(root as unknown as HTMLElement);
    const byId = (id: string): FakeElement | undefined => root.findAll((e) => e.getAttribute("id") === id)[0];
    assert.equal(byId("engine-ended")?.hasAttribute("hidden"), true, "no card while the engine is there");
    const answers = ["engine_running", "ready"];
    let asked = 0;
    shell.engineEnded("adapter_host_exited", async () => {
      asked += 1;
      return answers.shift() ?? "ready";
    });
    assert.equal(asked, 0, "nothing restarts on its own");
    const card = byId("engine-ended");
    assert.equal(card?.hasAttribute("hidden"), false);
    assert.equal(card?.getAttribute("role"), "alert");
    assert.ok(byId("engine-ended-text")?.textContent.includes("adapter_host_exited"));
    assert.ok(byId("engine-ended-text")?.textContent.includes("run list"), "a run going on: its end is in the run list");
    assert.equal(byId("status-engine")?.getAttribute("data-engine"), "adapter_host_exited");
    byId("engine-restart")?.click();
    await settle();
    assert.equal(card?.getAttribute("data-restart"), "engine_running", "a failed restart says why");
    assert.equal(byId("engine-restart")?.hasAttribute("disabled"), false, "and can be tried again");
    byId("engine-restart")?.click();
    await settle();
    assert.equal(asked, 2);
    assert.equal(card?.hasAttribute("hidden"), true, "ready: the card goes");
    assert.equal(byId("status-engine")?.getAttribute("data-engine"), "ready");
  } finally {
    restore();
  }
});

test("U-64: the channel and the event, and how the window reads their values", () => {
  assert.equal(IPC_CHANNELS.restartEngine, "codaryn:app:restartengine");
  assert.equal(IPC_EVENTS.engineState, "codaryn:event:enginestate");
  assert.deepEqual(asRestart({ ok: true }), { ok: true });
  assert.deepEqual(asRestart({ ok: false, code: "engine_running" }), { ok: false, code: "engine_running" });
  assert.equal(asEngineState({ state: "adapter_host_exited" }), "adapter_host_exited");
  assert.equal(asEngineState({ state: "ready" }), "ready");
  for (const bad of [null, {}, { state: "Not A Code" }, { state: 3 }]) assert.equal(asEngineState(bad), null, JSON.stringify(bad));
  for (const language of ["ko", "en"] as const) {
    const t = textsFor(language);
    assert.ok(t.has("engine.ended") && t.has("engine.restart") && t.has("engine.restartFailed"), language);
    assert.doesNotMatch(t.format("error.adapter_host_exited"), /^[^.]*\.$/, `${language}: names the restart, not only the app's start`);
  }
});
