/**
 * U-48:
 * (1) U-42, R-59 I-1: the engine host draws a model's text with the app layer's modelTextRows and
 *     MODEL_TEXT_MAX_ROWS, not with the CLI's own module read by path (cli/human/format.js) and its
 *     quote mark taken off here. The rows that go to the window are the ones U-32 drew: compared
 *     with U-32's drawing, kept here as it was, over texts of every kind the drawing treats.
 * (2) U-43, DR-38: the app layer's changes output says when the run has a records-changed mark; the
 *     engine host and the main process pass it on, and the changes screen shows its warning first,
 *     as the run list, the plan and the report do, and says for each file why it has no text.
 */

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { modelTextOf } from "../../src/engine-host/model-text.js";
import type { ModelTextRows } from "../../src/engine-host/model-text.js";
import { changesValue } from "../../src/engine-host/plans.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { EN } from "../../src/renderer/i18n/en.js";
import { KO } from "../../src/renderer/i18n/ko.js";
import { changesScreen } from "../../src/renderer/changes/changes-screen.js";
import { MAX_PLAN_SUMMARY_ROWS, toChangesReply } from "../../src/shared/ipc.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

// This file runs as gui/build/tests/unit/u48-model-rows-changes-mark.test.js.
const GUI = fileURLToPath(new URL("../../../", import.meta.url));
const ENGINE_DIR = path.join(GUI, "..", "dist", "src");
const ENGINE_BUILT = existsSync(path.join(ENGINE_DIR, "app", "index.js")) && existsSync(path.join(ENGINE_DIR, "cli", "human", "format.js"));
const RUN = "20261113T010203Z-0000a048";

type Quote = (text: string, maxRows: number, columns: number | null) => string[];

/** U-32's drawing, as the engine host had it before U-48 (the CLI's quoteModelText, its quote mark taken off). */
function beforeU48(quote: Quote, prefix: string, maxRows: number, hide: (text: string) => string): (text: string) => readonly string[] {
  return (text) => {
    try {
      return quote(hide(text), maxRows, null).map((row) => (prefix.length > 0 && row.startsWith(prefix) ? row.slice(prefix.length) : row.trim()));
    } catch {
      return [];
    }
  };
}

const KEY_SHAPED = ["sk", "ant", "FAKE".repeat(10)].join("-");
/** A fake value of a key variable now set; not a real key. */
const CURRENT = ["CURRENT", "VALUE", "u48", "1234567890"].join("");
const lines = (count: number): string => Array.from({ length: count }, (_, k) => `line ${k + 1}`).join("\n");

/** Texts of every kind the drawing treats: folding, the cap, white space, invisible and control characters, keys. */
const TEXTS: readonly string[] = [
  "a.txt to moved",
  `Moves​files.   Key ${KEY_SHAPED}\nand ${CURRENT} ${"word ".repeat(40)}`,
  lines(19),
  lines(20),
  lines(21),
  lines(45),
  "one\r\ntwo\r\n\r\nthree\ttabbed\t\tend",
  "",
  "   ",
  "\n\n\n",
  "x".repeat(200),
  `${"가나다라마바사".repeat(20)} 끝`,
  "emoji 😀😀 and a combining é and a joiner a‍b",
  "bell\u0007 escape\u001b[31m red\u001b[0m bidi‮evil‬ sep after",
  `split key ${CURRENT.slice(0, 9)}\n${CURRENT.slice(9)} done`,
  "  | already quoted\n  | twice",
  "<b>bold</b> [[CODARYN_SECRET:0123456789abcdef]] `code` *star*",
  `${"long ".repeat(400)}`,
];

test("U-48 (1): the rows that go to the window are the ones U-32 drew, for every kind of text and row cap", { skip: !ENGINE_BUILT && "the engine is not built (npm run build in the root)" }, async () => {
  const app = (await import(pathToFileURL(path.join(ENGINE_DIR, "app", "index.js")).href)) as { modelTextRows: ModelTextRows; MODEL_TEXT_MAX_ROWS: number };
  const format = (await import(pathToFileURL(path.join(ENGINE_DIR, "cli", "human", "format.js")).href)) as { quoteModelText: Quote; MODEL_TEXT_PREFIX: string };
  const output = (await import(pathToFileURL(path.join(ENGINE_DIR, "cli", "human", "output.js")).href)) as { FINAL_MESSAGE_MAX_LINES: number };
  const safety = (await import(pathToFileURL(path.join(ENGINE_DIR, "cli", "text-safety.js")).href)) as { hideKeys(text: string, key: string | null): string };
  // The host's hiding (main.ts hideAllKeys): key shapes, then every key value now set.
  const hide = (text: string): string => safety.hideKeys(safety.hideKeys(text, null), CURRENT);
  // The cap the host takes: the app layer's MODEL_TEXT_MAX_ROWS is the CLI's, and fits what the main process takes.
  assert.equal(app.MODEL_TEXT_MAX_ROWS, output.FINAL_MESSAGE_MAX_LINES, "the number U-32 took from the CLI");
  const hostRows = Math.min(MAX_PLAN_SUMMARY_ROWS - 1, app.MODEL_TEXT_MAX_ROWS);
  assert.equal(hostRows, 20);
  for (const maxRows of [hostRows, 0, 1, 2, 7]) {
    const now = modelTextOf(app.modelTextRows, maxRows, hide);
    const before = beforeU48(format.quoteModelText, format.MODEL_TEXT_PREFIX, maxRows, hide);
    for (const text of TEXTS) {
      assert.deepEqual(now(text), before(text), `rows ${maxRows}: ${JSON.stringify(text.slice(0, 40))}`);
      assert.ok(now(text).length <= maxRows + 1 && now(text).length <= MAX_PLAN_SUMMARY_ROWS);
    }
  }
  const now = modelTextOf(app.modelTextRows, hostRows, hide);
  assert.deepEqual(now("a.txt to moved"), ["a.txt to moved"], "the smoke run's plan summary, one row");
  assert.deepEqual(now(lines(45)).at(-1), "… (+25)");
  const keyed = now(TEXTS[1] as string).join("\n");
  assert.ok(!keyed.includes(KEY_SHAPED) && !keyed.includes(CURRENT) && !now(TEXTS[14] as string).join("\n").includes(CURRENT.slice(0, 9)), "keys hidden");
});

test("U-48 (1): a drawing that throws or gives something other than rows shows no model text", () => {
  const same = (text: string): string => text;
  assert.deepEqual(modelTextOf(() => { throw new Error("x"); }, 20, same)("a"), []);
  assert.deepEqual(modelTextOf(() => "a row", 20, same)("a"), []);
  assert.deepEqual(modelTextOf(() => ["a", 2], 20, same)("a"), []);
  assert.deepEqual(modelTextOf(() => null, 20, same)("a"), []);
  const asked: unknown[] = [];
  assert.deepEqual(modelTextOf((text, options) => { asked.push([text, options]); return ["ok"]; }, 20, (text) => `hidden ${text}`)("a"), ["ok"]);
  assert.deepEqual(asked, [["hidden a", { maxRows: 20 }]], "hidden first, then drawn at the host's cap; no key value given to the app layer");
});

test("U-48 (1): the engine host no longer reads the CLI's drawing module or takes its quote mark off", () => {
  const dir = path.join(GUI, "src", "engine-host");
  for (const name of readdirSync(dir).filter((file) => file.endsWith(".ts"))) {
    const source = readFileSync(path.join(dir, name), "utf8");
    assert.doesNotMatch(source, /"format\.js"|MODEL_TEXT_PREFIX|quoteModelText\(/, name);
  }
  assert.match(readFileSync(path.join(dir, "main.ts"), "utf8"), /appModule\.modelTextRows/);
});

const FILE = { path: "notes.md", created: false, state: "as_run_left", unavailable: "masking_unverified", before: null, after: null };
const changesOutput = (extra: Record<string, unknown> = {}) => ({ ok: true, output: { schemaVersion: 1, kind: "changes", runId: RUN, exitCode: 0, masking: "current_secrets", files: [FILE], ...extra } });
const same = (text: string): string => text;

test("U-48 (2): the changes mark goes from the app layer through the engine host and the main process", () => {
  const marked = changesValue(changesOutput({ recordsChanged: true }), same, same) as Record<string, unknown>;
  assert.equal(marked["recordsChanged"], true);
  const reply = toChangesReply(marked);
  assert.ok(reply.ok && reply.recordsChanged === true);
  const plain = changesValue(changesOutput(), same, same) as Record<string, unknown>;
  assert.equal("recordsChanged" in plain, false, "absent without a mark");
  const none = toChangesReply(plain);
  assert.ok(none.ok && none.recordsChanged === false, "absent is false");
  assert.equal(changesValue(changesOutput({ recordsChanged: "yes" }), same, same)["recordsChanged" as never], undefined, "only true is a mark");
  for (const bad of ["yes", 1, {}]) assert.equal(toChangesReply({ ...plain, recordsChanged: bad }).ok, false, `main refuses ${JSON.stringify(bad)}`);
  const nulled = toChangesReply({ ...plain, recordsChanged: null });
  assert.ok(nulled.ok && nulled.recordsChanged === false, "null is absent, as the report's check reads it");
});

async function changesShown(language: "ko" | "en", recordsChanged: boolean): Promise<FakeElement> {
  const reply = toChangesReply(changesValue(changesOutput(recordsChanged ? { recordsChanged: true } : {}), same, same));
  assert.ok(reply.ok);
  const api = new Proxy({} as CodarynApi, { get: (_t, name: string) => async () => (name === "changes" ? reply : null) });
  const screen = changesScreen({ texts: textsFor(language), api, current: () => ({ handle: "1".repeat(32), name: "ws" }) });
  screen.choose(RUN, null, "organize");
  const root = new FakeElement("main");
  screen.show(root as unknown as HTMLElement);
  await settle();
  await settle();
  return root;
}

test("U-48 (2): the changes screen of a marked run has the warning first, and each file says the mark is why it has no text", async () => {
  const restore = installFakeDom();
  try {
    for (const language of ["ko", "en"] as const) {
      const t = textsFor(language);
      const root = await changesShown(language, true);
      const body = root.findAll((e) => e.getAttribute("id") === "changes")[0];
      assert.equal(body?.getAttribute("data-changes-ready"), "1");
      assert.equal(body?.children[0]?.getAttribute("id"), "changes-records-changed", "the warning first");
      assert.equal(body?.children[0]?.textContent, t.format("changes.recordsChanged"));
      const hidden = root.findAll((e) => e.getAttribute("data-text") === "hidden");
      assert.deepEqual(hidden.map((e) => e.textContent), [t.format("changes.unverifiedMarked")]);
      const plain = await changesShown(language, false);
      assert.equal(plain.findAll((e) => e.getAttribute("id") === "changes-records-changed").length, 0);
      assert.deepEqual(plain.findAll((e) => e.getAttribute("data-text") === "hidden").map((e) => e.textContent), [t.format("changes.unverified")]);
    }
  } finally {
    restore();
  }
});

test("U-48 (2): the changes warning uses the words of the run list, the plan and the report, in both languages", () => {
  for (const key of ["runs.recordsChanged", "plan.recordsChanged", "report.recordsChanged", "changes.recordsChanged", "changes.unverifiedMarked"] as const) {
    assert.match(EN[key], /outside the run/, `en ${key}`);
    // U-163: the CLI's words for the mark (기록 변경됨, 기록 변경 표시), no longer 실행 밖.
    assert.match(KO[key], /기록 변경/, `ko ${key}`);
  }
  // As the CLI's changes.records_changed: no file text, paths and states only.
  assert.match(EN["changes.recordsChanged"], /no file text is shown; only paths and states/);
  assert.match(KO["changes.recordsChanged"], /파일 글을 보이지 않습니다. 경로와 상태만 보입니다/);
});
