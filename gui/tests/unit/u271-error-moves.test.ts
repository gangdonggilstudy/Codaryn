/**
 * U-271 (docs/design/standalone-gui.md 3.12): "when the fix is going to a screen, the error card has a
 * button to that screen." The GUI had such buttons in a few places only (the first-run guide, the open
 * checks). Now the run screen's start and end errors, the new task screen's, the plan screen's apply
 * errors and the settings screen's error cards add one for each screen the error's text sends the person
 * to (a fixed table by code, error-move.ts), and none to the screen the card is on.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { EN } from "../../src/renderer/i18n/en.js";
import { KO } from "../../src/renderer/i18n/ko.js";
import { RunModel } from "../../src/renderer/run/run-model.js";
import { runScreen } from "../../src/renderer/run/run-screen.js";
import type { RunScreenDeps } from "../../src/renderer/run/run-screen.js";
import { ERROR_MOVES, withMoves } from "../../src/renderer/shell/error-move.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const textOf = (table: Readonly<Record<string, string>>, id: string): string => table[id] ?? "";

test("U-271 (3.12): each screen a move goes to is the one its error's text names, in both languages", () => {
  assert.ok(Object.keys(ERROR_MOVES).length >= 9);
  for (const [code, screens] of Object.entries(ERROR_MOVES)) {
    for (const screen of screens) {
      assert.ok(textOf(KO, `error.${code}`).includes(textOf(KO, `nav.${screen}`)), `ko error.${code} names ${screen}`);
      assert.ok(textOf(EN, `error.${code}`).includes(textOf(EN, `nav.${screen}`)), `en error.${code} names ${screen}`);
    }
  }
});

test("U-271 (3.12): a card gets a button to each screen its fix names, but not to its own screen or without a way to go", () => {
  const restore = installFakeDom();
  try {
    const t = textsFor("ko");
    const went: string[] = [];
    const card = withMoves(new FakeElement("div") as unknown as HTMLElement, t, "provider_not_configured", (screen) => went.push(screen), "run") as unknown as FakeElement;
    const moves = card.findAll((e) => e.hasAttribute("data-move"));
    assert.deepEqual(moves.map((m) => m.getAttribute("data-move")), ["setup", "checks"]);
    assert.equal(moves[0]?.textContent, KO["move.toScreen"].replace("{screen}", KO["nav.setup"]));
    for (const move of moves) move.click();
    assert.deepEqual(went, ["setup", "checks"]);
    const here = withMoves(new FakeElement("div") as unknown as HTMLElement, t, "config_exists", () => undefined, "settings") as unknown as FakeElement;
    assert.equal(here.findAll((e) => e.hasAttribute("data-move")).length, 0, "not to the screen it is on");
    const none = withMoves(new FakeElement("div") as unknown as HTMLElement, t, "config_exists", undefined, "run") as unknown as FakeElement;
    assert.equal(none.findAll((e) => e.hasAttribute("data-move")).length, 0, "no way to go");
    const other = withMoves(new FakeElement("div") as unknown as HTMLElement, t, "adapter_timeout", () => undefined, "run") as unknown as FakeElement;
    assert.equal(other.findAll((e) => e.hasAttribute("data-move")).length, 0, "an error whose fix is no screen");
    const proto = withMoves(new FakeElement("div") as unknown as HTMLElement, t, "__proto__", () => undefined, "run") as unknown as FakeElement;
    assert.equal(proto.findAll((e) => e.hasAttribute("data-move")).length, 0, "only the table's own codes");
  } finally {
    restore();
  }
});

test("U-271 (3.12): the run screen's refused start says where to fix it, with a button there", async () => {
  const restore = installFakeDom();
  const root = new FakeElement("main");
  try {
    const run = new RunModel();
    const went: string[] = [];
    const api = new Proxy({} as CodarynApi, { get: () => async () => null });
    const deps: RunScreenDeps = {
      texts: textsFor("en"),
      api,
      run,
      newTask: () => undefined,
      announce: () => undefined,
      current: () => ({ handle: "1".repeat(32), name: "ws" }),
      openPlan: () => undefined,
      openChanges: () => undefined,
      openReport: () => undefined,
      showScreen: (screen) => went.push(screen),
    };
    runScreen(deps).show(root as unknown as HTMLElement);
    assert.ok(run.starting({ goal: "g", profile: null, workflow: null }));
    run.failedToStart("secret_env_missing");
    await settle();
    const card = root.findAll((e) => e.getAttribute("data-error") === "secret_env_missing")[0];
    assert.ok(card !== undefined);
    const move = card.findAll((e) => e.getAttribute("data-move") === "settings")[0];
    assert.equal(move?.textContent, EN["move.toScreen"].replace("{screen}", EN["nav.settings"]));
    move?.click();
    assert.deepEqual(went, ["settings"]);
  } finally {
    // The run screen's timer stops once the screen is gone, also when an assertion above failed.
    root.replaceChildren();
    restore();
  }
});
