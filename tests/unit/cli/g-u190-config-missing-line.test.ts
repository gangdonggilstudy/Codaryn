/**
 * U-190 (AXM-21, review R-99's list): with no config file at all, the quick form's error said two
 * things that disagree: the diagnostic line "config file - limits.maxModelTurns has an invalid
 * value" and the hint line "There is no config file yet". The setting is missing, not invalid. The
 * JSON line keeps its diagnostic (invalid_value, DR-48); the CLI now gives the renderer the same
 * error with that diagnostic shown as missing_field when the hint is config_missing, so the human
 * lines agree. Without the hint the line is as before. Real CLI with the default config location in
 * a sandbox folder (APPDATA and the others), so the hint is given; no key, no network.
 */

import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { CLI_ERROR_HINTS, toSchemaFieldPath } from "../../../src/contracts/index.js";
import type { CliErrorOutput, InputDiagnostic, MessageCatalog, SchemaFieldPath } from "../../../src/contracts/index.js";
import { explainedErrorText } from "../../../src/cli/error-text.js";
import { createHumanOutput } from "../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { cliEnv } from "../../support/cli.js";
import { runGuarded } from "../../support/fake-anthropic.js";
import { createSandbox } from "../../fixtures/builders.js";

const FIELD = "limits.maxModelTurns";
const DIAGNOSTIC: InputDiagnostic = { code: "invalid_value", file: "config", field: toSchemaFieldPath(FIELD) as SchemaFieldPath, line: null, column: null };
const OUTPUT: CliErrorOutput = {
  schemaVersion: 1,
  kind: "error",
  code: "invalid_config",
  exitCode: 2,
  message: `${FIELD} is not set in the task or the config file`,
  diagnostic: DIAGNOSTIC,
  category: "input",
  retryable: false,
};
const human = (lang: "en" | "ko"): { output: ReturnType<typeof createHumanOutput>; messages: MessageCatalog } => {
  const messages = createMessageCatalog(lang);
  return { output: createHumanOutput(messages), messages };
};
const lines = (messages: MessageCatalog) => {
  const file = messages.format("diagnostic.file.config");
  return {
    invalid: `${file} — ${messages.format("diagnostic.invalid_value", { field: FIELD as never })}`,
    missing: `${file} — ${messages.format("diagnostic.missing_field", { field: FIELD as never })}`,
    hint: messages.format("error.hint.config_missing"),
  };
};

describe("U-190: no config file: the diagnostic line says the setting is missing, as the hint does", () => {
  assert.ok((CLI_ERROR_HINTS as readonly string[]).includes("config_missing"));
  for (const lang of ["en", "ko"] as const) {
    test(`${lang}: with config_missing, missing and not invalid; the output given is not changed`, () => {
      const given = { ...OUTPUT, hint: "config_missing" as const };
      const text = explainedErrorText(given, human(lang));
      const expected = lines(human(lang).messages);
      assert.ok(text.includes(expected.missing), text);
      assert.equal(text.includes(expected.invalid), false, text);
      assert.ok(text.includes(expected.hint), text);
      assert.deepEqual(given.diagnostic, DIAGNOSTIC, "the caller's output (the JSON line) is as it was");
    });

    test(`${lang}: without the hint the line is as before`, () => {
      const text = explainedErrorText(OUTPUT, human(lang));
      assert.ok(text.includes(lines(human(lang).messages).invalid), text);
    });
  }
});

describe("U-190 on the real CLI: the JSON keeps invalid_value, the human lines agree", () => {
  test("run --workspace --goal with no config file anywhere", { timeout: 60_000 }, async (t) => {
    const sb = createSandbox(t);
    const home = path.join(sb.base, "home");
    mkdirSync(home);
    const sandboxed = { APPDATA: home, LOCALAPPDATA: home, XDG_CONFIG_HOME: home, HOME: home, USERPROFILE: home };
    for (const lang of ["en", "ko"] as const) {
      const run = await runGuarded(sb, ["run", "--workspace", sb.workspace, "--goal", "x"], cliEnv({ extra: { ...sandboxed, CODARYN_LANG: lang } }));
      assert.equal(run.exitCode, 2, run.stderr);
      const output = JSON.parse(run.stdout.trim()) as CliErrorOutput;
      assert.equal(output.hint, "config_missing", run.stdout);
      assert.equal(output.diagnostic?.code, "invalid_value", "the JSON line is as before");
      const expected = lines(human(lang).messages);
      assert.ok(run.stderr.includes(expected.missing), run.stderr);
      assert.equal(run.stderr.includes(expected.invalid), false, run.stderr);
      assert.ok(run.stderr.includes(expected.hint), run.stderr);
    }
  });
});
