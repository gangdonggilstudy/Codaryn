/**
 * N-4 P0 and N-14: a message never holds a value read from a file or the environment, in either
 * language. Every parameter of every message gets values shaped like file contents, paths,
 * environment values, a key, terminal controls and prototype names, including the review's
 * synthetic inputs (docs/reviews/2026-11-12-n-review-usability-contract.md H1), as a caller that
 * casts past the types could pass them. They carry "probe" so any leak shows. All values are fake.
 */

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, test } from "node:test";

import { ANTHROPIC_KEY_PATTERN_SOURCE, PRIVACY_TOKEN_PREFIX, toRunId } from "../../../src/contracts/index.js";
import { createMessageCatalog, MESSAGE_TEXTS } from "../../../src/i18n/index.js";
import { CONTROL, IDS, KEY_SHAPED, LANGS, loose, paramsFor, specOf } from "./support.js";

const KEY_PATTERN = new RegExp(ANTHROPIC_KEY_PATTERN_SOURCE);

/** Values a caller might wrongly pass straight from a file or the environment. */
const PROBES: readonly unknown[] = [
  "SYNTHETIC_PRIVATE_VALUE_probe",
  "customer private memo probe",
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
      const format = loose(catalog);
      for (const id of IDS) {
        for (const [name, kind] of Object.entries(specOf(id))) {
          for (const value of PROBES) {
            // A RunId is a run directory name by contract (toRunId); such a value is shown as a run id.
            if (kind === "runId" && typeof value === "string" && toRunId(value) !== null) continue;
            const line = format(id, paramsFor(catalog, id, { name, value }));
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
      const format = loose(createMessageCatalog(language));
      const changes = format("summary.changes", { count: "SYNTHETIC_PRIVATE_VALUE" });
      const field = format("diagnostic.invalid_value", { field: "SYNTHETIC_PRIVATE_VALUE" });
      for (const line of [changes, field]) assert.ok(!line.includes("SYNTHETIC") && line.includes("?"), line);
    }
  });

  test("a run id shown as such is still one clean line", () => {
    for (const language of LANGS) {
      const format = loose(createMessageCatalog(language));
      for (const value of [`${KEY_SHAPED}`, "a..b", "-x", "x".repeat(129), "a/b", "a b"]) {
        const line = format("summary.run_id", { runId: value });
        assert.doesNotMatch(line, KEY_PATTERN, value);
        assert.ok(!CONTROL.test(line), value);
      }
      assert.ok(format("summary.run_id", { runId: "a..b" }).endsWith("?"));
      assert.ok(format("summary.run_id", { runId: "a/b" }).endsWith("?"));
    }
  });

  test("a value never adds a line", () => {
    for (const language of LANGS) {
      const catalog = createMessageCatalog(language);
      const format = loose(catalog);
      for (const id of IDS) {
        for (const name of Object.keys(specOf(id))) {
          const line = format(id, paramsFor(catalog, id, { name, value: "x\nsecond\r\u2028third" }));
          assert.ok(!/[\r\n]/.test(line) && !line.includes("\u2028"), `${language} ${id}.${name}`);
        }
      }
    }
  });

  test("text produced by one catalog cannot carry a value into another", () => {
    const en = createMessageCatalog("en");
    const ko = createMessageCatalog("ko");
    const outside = en.format("summary.changes", { count: 3 });
    assert.equal(loose(ko)("progress.tool_allowed", { tool: outside }), "? — 허용");
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
      // `process.` as code (property access), not the word in a message ("a running process").
      for (const forbidden of [/\bprocess\s*\./, /\bprocess\s*\[/, /["']node:/, /\brequire\(/, /\bimport\(/, /\bglobalThis\b/, /\breadFile/, /\bfetch\(/]) {
        assert.doesNotMatch(source, forbidden, `${name} uses ${String(forbidden)}`);
      }
    }
  });
});
