/**
 * N-4 P0: a message never holds a value read from a file or the environment (S-3, S-6, S-12),
 * in either language. Every parameter of every message gets values shaped like file contents,
 * paths, environment values, a key, terminal controls and prototype names. Those values carry
 * "probe" so any leak shows. All values are fake.
 */

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, test } from "node:test";

import { ANTHROPIC_KEY_PATTERN_SOURCE, PRIVACY_TOKEN_PREFIX } from "../../../src/contracts/index.js";
import { DISPLAY_GROUPS, RECORDED_KINDS, translate } from "../../../src/i18n/index.js";
import type { Language, MessageKey, ParamKind } from "../../../src/i18n/index.js";
import { CONTROL, KEY_SHAPED, KEYS, LANGS, paramsFor, specOf } from "./support.js";

const KEY_PATTERN = new RegExp(ANTHROPIC_KEY_PATTERN_SOURCE);
/** From a string, as CONTROL in support.ts. */
const LINE_BREAK = new RegExp("[\\r\\n\\u2028\\u2029]", "u");

function render(language: Language, key: MessageKey, params: Record<string, unknown>): string {
  return (translate as (l: Language, k: MessageKey, p: Record<string, unknown>) => string)(language, key, params);
}

/** Strings a caller might wrongly pass straight from a file or the environment. */
const PROBE_STRINGS: readonly string[] = [
  "C:\\Users\\probe-user\\private\\notes.txt",
  "/home/probe-user/.config/codaryn/config.json",
  "probe-env-value-7731",
  `${KEY_SHAPED}probe`,
  "\u001b[31mprobe-ansi",
  "probe-line\nsecond-line",
  "probe\u202eevil",
  "probe\r\nCRLF",
  "policy.probeSecretName",
  "profiles.probeProfile.limits",
  "probe value with spaces",
  "{\"probe\":1}",
];

/** Non-strings, and strings that look like valid input to some other kind. */
const ODD_VALUES: readonly unknown[] = [
  -1,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  2 ** 60,
  "3",
  null,
  undefined,
  true,
  {},
  ["probe-array"],
  { toString: () => "probe-object" },
  "__proto__",
  "constructor",
  "toString",
  "",
];

function isRecorded(kind: ParamKind): boolean {
  return (RECORDED_KINDS as readonly string[]).includes(kind);
}

function groupOf(key: string): string {
  return key.slice(0, key.indexOf("."));
}

describe("i18n P0: no file or environment value in a message", () => {
  test("ids and recorded paths are taken by display messages only (progress, summary, revert, runs)", () => {
    for (const key of KEYS) {
      const recorded = Object.values(specOf(key)).filter(isRecorded);
      if (recorded.length > 0) {
        assert.ok((DISPLAY_GROUPS as readonly string[]).includes(groupOf(key)), `${key} shows recorded text`);
      }
    }
  });

  test("error, input, config, key, model, hint, language, init and doctor messages drop every probe", () => {
    for (const language of LANGS) {
      for (const key of KEYS) {
        if ((DISPLAY_GROUPS as readonly string[]).includes(groupOf(key))) continue;
        for (const name of Object.keys(specOf(key))) {
          for (const value of [...PROBE_STRINGS, ...ODD_VALUES]) {
            const line = render(language, key, paramsFor(key, { name, value }));
            assert.ok(!line.toLowerCase().includes("probe"), `${language} ${key}.${name}: ${JSON.stringify(line)}`);
            assert.ok(!line.includes("7731"), `${language} ${key}.${name}`);
            assert.doesNotMatch(line, KEY_PATTERN, `${language} ${key}.${name}`);
            assert.ok(!CONTROL.test(line), `${language} ${key}.${name}: control character`);
          }
        }
      }
    }
  });

  test("display messages drop probes from every parameter that is not a recorded id or path", () => {
    for (const language of LANGS) {
      for (const key of KEYS) {
        if (!(DISPLAY_GROUPS as readonly string[]).includes(groupOf(key))) continue;
        for (const [name, kind] of Object.entries(specOf(key))) {
          if (isRecorded(kind)) continue;
          for (const value of [...PROBE_STRINGS, ...ODD_VALUES]) {
            const line = render(language, key, paramsFor(key, { name, value }));
            assert.ok(!line.toLowerCase().includes("probe"), `${language} ${key}.${name}: ${JSON.stringify(line)}`);
          }
        }
      }
    }
  });

  test("recorded ids and paths are shown as one line without controls or key-shaped text", () => {
    for (const language of LANGS) {
      for (const key of KEYS) {
        for (const [name, kind] of Object.entries(specOf(key))) {
          if (!isRecorded(kind)) continue;
          for (const value of [...PROBE_STRINGS, ...ODD_VALUES, `x${"y".repeat(400)}`]) {
            const line = render(language, key, paramsFor(key, { name, value }));
            assert.ok(!CONTROL.test(line), `${language} ${key}.${name}: control character in ${JSON.stringify(line)}`);
            assert.doesNotMatch(line, KEY_PATTERN, `${language} ${key}.${name}`);
            assert.ok(!line.includes("probe-object") && !line.includes("probe-array"), `${language} ${key}.${name}`);
            assert.ok(line.length < 400, `${language} ${key}.${name}: ${line.length} characters`);
          }
        }
      }
    }
  });

  test("ids accept recorded identifier shapes only", () => {
    assert.equal(render("en", "progress.verifier", { id: "unit-tests", outcome: "pass" }), "check unit-tests — passed");
    assert.equal(render("en", "progress.verifier", { id: "C:\\probe path", outcome: "pass" }), "check ? — passed");
    assert.equal(render("ko", "progress.runStarted", { task: "x".repeat(129), provider: "scripted" }), "실행 시작 — 작업 ?, 모델 제공자 scripted");
  });

  test("a field position shows contract field names only: names from a file become ?", () => {
    const line = (field: unknown): string => render("en", "input.invalidField", { input: "config", field });
    assert.equal(line("profiles.probeProfile.limits.maxModelTurns"), "The config file's profiles.?.limits.maxModelTurns is not valid (values are not shown).");
    assert.equal(line("modle"), "The config file's ? is not valid (values are not shown).");
    assert.equal(line("policy.commands[2].argsPrefix[0]"), "The config file's policy.commands[2].argsPrefix[0] is not valid (values are not shown).");
    assert.equal(
      render("ko", "input.unknownField", { input: "task", parent: "", suggestion: "workspaceRoot" }),
      "task 파일의 최상위에 모르는 필드가 있습니다. 가까운 이름: workspaceRoot",
    );
  });

  test("a value never changes the language or adds a line", () => {
    for (const language of LANGS) {
      for (const key of KEYS) {
        for (const name of Object.keys(specOf(key))) {
          const line = render(language, key, paramsFor(key, { name, value: "probe\nsecond line\r\u2028third" }));
          assert.ok(!LINE_BREAK.test(line), `${language} ${key}.${name}`);
        }
      }
    }
  });

  test("the fixed text itself has no key shape, no privacy marker and no key assignment", () => {
    for (const language of LANGS) {
      for (const key of KEYS) {
        const line = render(language, key, paramsFor(key));
        assert.doesNotMatch(line, KEY_PATTERN, `${language} ${key}`);
        assert.ok(!line.includes(PRIVACY_TOKEN_PREFIX), `${language} ${key}`);
        assert.doesNotMatch(line, /\b(ANTHROPIC_API_KEY|OPENAI_API_KEY)\s*[=:]/, `${language} ${key}`);
      }
    }
  });

  test("the message modules read neither the environment nor files", async () => {
    // Compiled next to this test: dist/src/i18n. language.js alone reads process (the locale
    // inputs); its result is a language code, checked in language.test.ts.
    const dir = new URL("../../../src/i18n/", import.meta.url);
    const files = (await readdir(dir)).filter((name) => name.endsWith(".js"));
    assert.ok(files.includes("ko.js") && files.includes("en.js") && files.includes("translate.js"), files.join(", "));
    for (const name of files) {
      if (name === "language.js") continue;
      const source = await readFile(new URL(name, dir), "utf8");
      for (const forbidden of [/\bprocess\b/, /["']node:/, /\brequire\(/, /\bimport\(/, /\bglobalThis\b/, /\breadFile/]) {
        assert.doesNotMatch(source, forbidden, `${name} uses ${String(forbidden)}`);
      }
    }
  });
});
