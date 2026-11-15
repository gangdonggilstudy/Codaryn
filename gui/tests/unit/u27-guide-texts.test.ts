/**
 * U-27: R45-L-1 (the first-run guide when the config cannot be read), R46-L-1 (texts point only at
 * screens the window has) and R46-L-2 (the plan screen does not promise an apply command to paste).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { EN } from "../../src/renderer/i18n/en.js";
import { KO } from "../../src/renderer/i18n/ko.js";
import { setupScreen } from "../../src/renderer/setup/setup-screen.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

test("R45-L-1: when the config cannot be read, page 1 says page 4 tells why and page 4 still runs the checks", async () => {
  const restore = installFakeDom();
  try {
    const calls: string[] = [];
    const api = new Proxy({} as CodarynApi, {
      get: (_t, name: string) => async () => {
        calls.push(name);
        if (name === "settings") return { ok: false, code: "invalid_config" };
        if (name === "doctor") return { ok: true, view: { status: "fail", checks: [{ id: "config", status: "fail", message: "config file not found" }] }, labels: {}, workspaceName: "ws" };
        return null;
      },
    });
    const screen = setupScreen({ texts: textsFor("en"), api, current: () => ({ handle: "1".repeat(32), name: "ws" }), announce: () => undefined, show: () => undefined });
    const root = new FakeElement("main");
    const byId = (id: string) => root.findAll((e) => e.getAttribute("id") === id)[0];
    screen.show(root as unknown as HTMLElement);
    await settle();
    await settle();
    assert.equal(root.findAll((e) => e.getAttribute("data-error") === "invalid_config").length, 1, "the error is shown");
    assert.match(byId("setup-unreadable")?.textContent ?? "", /Checks/, "and where to see why");
    byId("setup-to-checks")?.click();
    await settle();
    await settle();
    assert.equal(byId("setup")?.getAttribute("data-step"), "checks");
    assert.ok(calls.includes("doctor"), "page 4 runs the checks although the settings cannot be read");
    assert.equal(byId("setup")?.getAttribute("data-ready"), "ok");
    assert.ok(root.textContent.includes("config file not found"), "the checks' reason is shown");
  } finally {
    restore();
  }
});

/** The screens' names in the window's navigation. */
const screensOf = (texts: Readonly<Record<string, string>>): string[] =>
  Object.entries(texts)
    .filter(([id]) => id.startsWith("nav.") && id !== "nav.label")
    .map(([, text]) => text);

/** English: "the X screen", "on the X or Y screen"; each X a screen's name. */
const namedEn = (text: string): string[] =>
  [...text.matchAll(/\b(?:the|on|in) ((?:[A-Z][a-z]*(?: [a-z]+)?)(?: or [A-Z][a-z]*(?: [a-z]+)?)*) screen\b/g)].flatMap((match) => (match[1] ?? "").split(" or "));

/** Korean: the word before "화면" (and the one before "이나" in "X이나 Y 화면"); each the last word of a screen's name. */
const namedKo = (text: string): string[] => {
  const words = text.split(" ");
  const named: string[] = [];
  words.forEach((word, i) => {
    if (!word.startsWith("화면") || i === 0) return;
    const before = words[i - 1] ?? "";
    if (/[.!?]$/.test(before)) return;
    named.push(before);
    const earlier = words[i - 2] ?? "";
    if (earlier.endsWith("이나")) named.push(earlier.slice(0, -2));
  });
  return named;
};

test("R46-L-1: an error text that points at a screen names one the window has", () => {
  const en = screensOf(EN);
  const koLast = screensOf(KO).map((name) => name.split(" ").pop());
  let seen = 0;
  for (const [id, text] of Object.entries(EN)) {
    if (!id.startsWith("error.")) continue;
    for (const named of namedEn(text)) {
      seen += 1;
      assert.ok(en.includes(named), `en ${id}: "${named}" is a screen`);
    }
  }
  for (const [id, text] of Object.entries(KO)) {
    if (!id.startsWith("error.")) continue;
    for (const named of namedKo(text)) {
      seen += 1;
      assert.ok(koLast.includes(named), `ko ${id}: "${named}" is a screen`);
    }
  }
  assert.ok(seen >= 10, "the texts that name screens were found");
  assert.deepEqual(namedEn("See it on the Model list screen."), ["Model list"], "a made-up screen is caught");
  // provider_not_configured names the first-run guide and the checks by their screen names.
  assert.ok(EN["error.provider_not_configured"].includes(`${EN["nav.setup"]} or ${EN["nav.checks"]} screen`));
  assert.ok(KO["error.provider_not_configured"].includes(`${KO["nav.setup"]}이나 ${KO["nav.checks"]} 화면`));
});

test("R46-L-2: the plan screen says codaryn plan gives the apply command's form, whose task part the person fills in", () => {
  assert.doesNotMatch(KO["plan.formUnknown"], /붙여 쓸/);
  assert.match(KO["plan.formUnknown"], /형식/);
  assert.match(KO["plan.formUnknown"], /채우/);
  assert.match(EN["plan.formUnknown"], /form of the apply command/);
  assert.match(EN["plan.formUnknown"], /fill/);
});
