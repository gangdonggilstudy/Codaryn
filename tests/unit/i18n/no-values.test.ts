/**
 * N-4 P0 (and N-14 direction): a message never holds a value read from a file or the
 * environment, in either language. Every parameter of every message gets values shaped like file
 * contents, paths, environment values, a key, terminal controls and prototype names, including
 * the review's synthetic inputs (docs/reviews/2026-11-12-n-review-usability-contract.md H1).
 * They carry "probe" so any leak shows. All values are fake.
 */

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, test } from "node:test";

import { ANTHROPIC_KEY_PATTERN_SOURCE, PRIVACY_TOKEN_PREFIX } from "../../../src/contracts/index.js";
import type { MessageCatalog, MessageId, MessageParams } from "../../../src/contracts/index.js";
import { createMessageCatalog, MESSAGE_TEXTS } from "../../../src/i18n/index.js";
import { CONTROL, IDS, KEY_SHAPED, LANGS, paramsFor, specOf } from "./support.js";

const KEY_PATTERN = new RegExp(ANTHROPIC_KEY_PATTERN_SOURCE);

function format(catalog: MessageCatalog, id: MessageId, params: Record<string, unknown>): string {
  return catalog.format(id, params as MessageParams);
}

/** Strings a caller might wrongly pass straight from a file or the environment. */
const PROBES: readonly unknown[] = [
  "SYNTHETIC_PRIVATE_VALUE_probe",
  "C:\\Users\\probe-user\\private\\notes.txt",
  "/home/probe-user/.config/codaryn/config.json",
  "D:\\work\\probe notes",
  "probe-env-value-7731",
  "probe_env_value",
  "probe",
  `${KEY_SHAPED}probe`,
  "\u001b[31mprobe-ansi",
  "probe-line\nsecond-line",
  "probe\u202eevil",
  "probe\r\nCRLF",
  "policy.probeSecretName",
  "profiles.probeProfile.limits",
  "probeUnknownField",
  "npm run probe",
  "codaryn revert --workspace D:\\probe --run x",
  "{\"probe\":1}",
  "{count}",
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

describe("i18n P0: no file or environment value in a message", () => {
  test("every parameter of every message drops every probe, in both languages", () => {
    for (const language of LANGS) {
      const catalog = createMessageCatalog(language);
      for (const id of IDS) {
        for (const name of Object.keys(specOf(id))) {
          for (const value of PROBES) {
            const line = format(catalog, id, paramsFor(catalog, id, { name, value }));
            const where = `${language} ${id}.${name} = ${JSON.stringify(String(value))}`;
            assert.ok(!line.toLowerCase().includes("probe"), `${where}: ${JSON.stringify(line)}`);
            assert.ok(!line.includes("7731") && !line.includes("SYNTHETIC"), where);
            assert.doesNotMatch(line, KEY_PATTERN, where);
            assert.ok(!CONTROL.test(line), `${where}: control character`);
            assert.ok(!line.includes("{count}"), `${where}: placeholder text was substituted again`);
          }
        }
      }
    }
  });

  test("the review's synthetic inputs render as the replacement mark", () => {
    for (const language of LANGS) {
      const catalog = createMessageCatalog(language);
      const changes = format(catalog, "summary.changes", { count: "SYNTHETIC_PRIVATE_VALUE" });
      const detail = format(catalog, "error.detail", { detail: "SYNTHETIC_PRIVATE_VALUE" });
      assert.ok(!changes.includes("SYNTHETIC") && changes.includes("?"), changes);
      assert.ok(!detail.includes("SYNTHETIC") && detail.includes("?"), detail);
    }
  });

  test("a value never adds a line or changes the layout", () => {
    for (const language of LANGS) {
      const catalog = createMessageCatalog(language);
      for (const id of IDS) {
        for (const name of Object.keys(specOf(id))) {
          const line = format(catalog, id, paramsFor(catalog, id, { name, value: "x\nsecond\r\u2028third" }));
          assert.ok(!/[\r\n]/.test(line) && !line.includes("\u2028"), `${language} ${id}.${name}`);
        }
      }
    }
  });

  test("text produced by one catalog cannot carry a value into another", () => {
    const en = createMessageCatalog("en");
    const ko = createMessageCatalog("ko");
    const outside = en.format("summary.changes", { count: 3 });
    assert.equal(ko.format("summary.result", { text: outside }), "결과: ?");
  });

  test("the fixed texts have no key shape, no privacy marker, no key assignment and no expanded location", () => {
    for (const language of LANGS) {
      for (const id of IDS) {
        const text = MESSAGE_TEXTS[language][id];
        assert.doesNotMatch(text, KEY_PATTERN, `${language} ${id}`);
        assert.ok(!text.includes(PRIVACY_TOKEN_PREFIX), `${language} ${id}`);
        assert.doesNotMatch(text, /\b(ANTHROPIC_API_KEY|OPENAI_API_KEY)\s*[=:]/, `${language} ${id}`);
        assert.doesNotMatch(text, /[A-Za-z]:\\Users\\|\/home\/|\/Users\//, `${language} ${id}`);
      }
    }
  });

  test("the i18n modules read neither the environment nor files", async () => {
    // Compiled next to this test: dist/src/i18n.
    const dir = new URL("../../../src/i18n/", import.meta.url);
    const files = (await readdir(dir)).filter((name) => name.endsWith(".js"));
    for (const expected of ["catalog.js", "en.js", "ko.js", "language.js", "params.js", "index.js"]) {
      assert.ok(files.includes(expected), `${expected} missing from ${files.join(", ")}`);
    }
    for (const name of files) {
      // Code only: block comments and whole-line comments are removed (they may mention process.env).
      const source = (await readFile(new URL(name, dir), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const forbidden of [/\bprocess\b/, /["']node:/, /\brequire\(/, /\bimport\(/, /\bglobalThis\b/, /\breadFile/, /\bfetch\(/]) {
        assert.doesNotMatch(source, forbidden, `${name} uses ${String(forbidden)}`);
      }
    }
  });
});
