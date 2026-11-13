/**
 * U-240 (nb-i18n's U-239 reading of the GUI's new texts, its seven for the GUI):
 * 1. a run plan is a "changes plan" (바꿀 파일 계획), as the CLI names it: "계획 실행" is the run that made
 *    a plan, and "실행 계획" differs from it only by word order;
 * 2. a workspace lock left is told in the meaning of the CLI's lock.release_failed (the next run clears it
 *    once Codaryn has closed; if a run is refused before then, the checks): no manual removal is advised;
 * 3. the permission questions' denial lines are the CLI's as U-136 worded them (summary.confirm_denied.*);
 * 4. the plan's summary is called "요약" (done with R-109; its label is the CLI's);
 * 6-8. "쓰기 허용 경로 더함" as the English "added"; no Windows-only "탐색기"; one name, "고친 글".
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DIALOG_TEXTS, widenText } from "../../src/main/dialog-texts.js";
import { EN } from "../../src/renderer/i18n/en.js";
import { KO } from "../../src/renderer/i18n/ko.js";

// This file runs as gui/build/tests/unit/u240-cli-words.test.js.
const GUI = fileURLToPath(new URL("../../../", import.meta.url));
const DIST = path.join(GUI, "..", "dist", "src");
const BUILT = existsSync(path.join(DIST, "i18n", "ko.js"));
const skip = !BUILT && "the engine is not built (npm run build in the root)";

const window = { ko: KO as Readonly<Record<string, string>>, en: EN as Readonly<Record<string, string>> };
const dialogs = { ko: DIALOG_TEXTS.ko as Readonly<Record<string, string>>, en: DIALOG_TEXTS.en as Readonly<Record<string, string>> };
const every = (language: "ko" | "en"): string[] => [...Object.values(window[language]), ...Object.values(dialogs[language])];

async function cli(): Promise<{ ko: Record<string, string>; en: Record<string, string> }> {
  const ko = (await import(pathToFileURL(path.join(DIST, "i18n", "ko.js")).href)) as { KO_MESSAGES: Record<string, string> };
  const en = (await import(pathToFileURL(path.join(DIST, "i18n", "en.js")).href)) as { EN_MESSAGES: Record<string, string> };
  return { ko: ko.KO_MESSAGES, en: en.EN_MESSAGES };
}

test("U-240 (1): a changes plan is called so in the window and the dialog, never by the plan run's name turned round", () => {
  assert.deepEqual(every("ko").filter((text) => text.includes("실행 계획")), []);
  assert.deepEqual(every("en").filter((text) => /run plan/i.test(text)), []);
  assert.ok(KO["plan.runSummary"].startsWith("바꿀 파일 계획:") && EN["plan.runSummary"].startsWith("Changes plan:"));
  assert.ok(dialogs.ko["applyRun.message"]?.includes("바꿀 파일 계획") && dialogs.en["applyRun.message"]?.includes("changes plan"));
});

test("U-240 (2): a lock left says what the CLI's lock.release_failed says, and advises no manual removal", { skip }, async () => {
  const catalog = await cli();
  // The CLI's advice after its first sentence, with the window's checks screen for `codaryn doctor`.
  const advice = { ko: catalog.ko["lock.release_failed"]?.split(". ").slice(1).join(". ") ?? "", en: catalog.en["lock.release_failed"]?.split(". ").slice(1).join(". ") ?? "" };
  assert.ok(advice.ko.includes("codaryn doctor") && advice.en.includes("codaryn doctor"), "the CLI's advice names its doctor");
  for (const language of ["ko", "en"] as const) {
    const expected = language === "ko" ? advice.ko.replace("codaryn doctor로", "점검 화면에서") : advice.en.replace("run codaryn doctor", "look at the Checks screen");
    for (const id of ["plancheck.lockLeft", "text.lockLeft", "run.lockLeft"]) {
      assert.ok(window[language][id]?.endsWith(expected), `${language} ${id}: ${window[language][id]}`);
    }
    assert.deepEqual(every(language).filter((text) => text.includes("lock.json")), [], `${language}: no file to remove by hand`);
  }
  assert.equal(window.en["nav.checks"], "Checks");
  assert.equal(window.ko["nav.checks"], "점검");
});

test("U-240 (3): the denial lines of the permission questions are the CLI's U-136 words", { skip }, async () => {
  const catalog = await cli();
  for (const language of ["ko", "en"] as const) {
    for (const by of ["user", "cancelled"] as const) assert.equal(window[language][`run.confirm.${by}`], catalog[language][`summary.confirm_denied.${by}`], `${language} ${by}`);
    // Unanswered: the CLI's words, with the window's own reason (a dialog, not a terminal's input).
    const head = (text: string | undefined): string => (text ?? "").split(language === "ko" ? "(" : " (")[0] ?? "";
    assert.equal(head(window[language]["run.confirm.unanswered"]), head(catalog[language]["summary.confirm_denied.unanswered"]), `${language} unanswered`);
  }
  assert.match(KO["run.confirm.cancelled"], /거부되었습니다\.$/, "its subject is the call");
});

test("U-240 (6-8): 더함 as 'added'; no Windows-only name; one name for an edit in the file view", () => {
  assert.equal(KO["widen.writable_path_added"], "쓰기 허용 경로 더함");
  assert.equal(widenText("ko", "writable_path_added", "policy.writablePaths[0]"), "- 쓰기 허용 경로 더함 (policy.writablePaths[0])");
  assert.equal(EN["widen.writable_path_added"], "a writable path added");
  assert.deepEqual(every("ko").filter((text) => text.includes("탐색기")), []);
  assert.ok(KO["text.refused.path_changed"].includes("파일 관리자") && EN["text.refused.path_changed"].includes("file manager"));
  assert.deepEqual(every("ko").filter((text) => text.includes("고침") && !text.includes("새로 고침")), []);
  assert.ok(KO["text.unsaved"].includes("고친 글") && KO["text.saveNote"].includes("고친 글"));
});
