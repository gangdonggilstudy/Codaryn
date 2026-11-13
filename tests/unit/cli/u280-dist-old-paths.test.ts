/**
 * U-280 (CLI migration C-3a; PM after the board's GUI run): the GUI and its engine host load some of
 * the root build's modules by path, not by import (gui/src/engine-host/main.ts, gui/tests/unit/*), and
 * a missing module makes a GUI test skip itself quietly ("the engine is not built"). C-3a moved
 * src/cli/security/paths.ts to src/app/input/ without a re-export at the old path, so
 * gui/tests/unit/node-path-parity.test.ts stopped running. Plan A (PM, after U-267): every old path
 * that something loads keeps a re-export. This test names each path the GUI and the engine host load
 * from dist/src/cli and the names they take from it, and checks the build has them.
 * U-282 (C-3b): and every old path the migration keeps as a re-export (plan A), with names the tests
 * and the pinned file (tests/unit/cli/sp0-pins.ts) take from it, so a later step cannot drop one
 * unseen. The PM decides after C-11 whether to clear them.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, test } from "node:test";

/** dist/src/cli, from this file's place in the build (dist/tests/unit/cli). */
const CLI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "src", "cli");

/** Each path under dist/src/cli the GUI or its engine host loads, the names it takes, and who loads it. */
const LOADED: readonly { readonly file: string; readonly names: readonly string[]; readonly by: string }[] = [
  { file: "security/paths.js", names: ["checkLocalPathSyntax"], by: "gui/tests/unit/node-path-parity.test.ts" },
  { file: "text-safety.js", names: ["cleanText", "hideKeys"], by: "gui/src/engine-host/main.ts, gui/tests/unit/u32-plan-view, u48-model-rows-changes-mark" },
  { file: "human/output.js", names: ["createHumanOutput", "FINAL_MESSAGE_MAX_LINES"], by: "gui/src/engine-host/main.ts, gui/tests/unit/u48-model-rows-changes-mark" },
  { file: "human/format.js", names: ["MODEL_TEXT_PREFIX", "MODEL_TEXT_COLUMNS", "quoteModelText"], by: "gui/tests/unit/u32-plan-view, u48-model-rows-changes-mark" },
  { file: "args.js", names: [], by: "gui/tests/unit/u32-plan-view, u44-form-unknown" },
  { file: "init.js", names: ["initConfigText"], by: "gui/tests/unit/u80-output-cap" },
];

describe("U-280: the modules the GUI loads by path from the root build are there", () => {
  for (const { file, names, by } of LOADED) {
    test(`dist/src/cli/${file} (${by})`, async () => {
      const full = path.join(CLI_DIR, ...file.split("/"));
      assert.ok(existsSync(full), `${file} is missing from the build; a re-export at the old path keeps it (plan A)`);
      const loaded = (await import(pathToFileURL(full).href)) as Record<string, unknown>;
      for (const name of names) assert.notEqual(loaded[name], undefined, `${file} gives ${name}`);
    });
  }
});

/** The old paths the CLI migration keeps as re-exports (plan A), by step, and names taken from each. */
const KEPT: readonly { readonly file: string; readonly names: readonly string[]; readonly step: string }[] = [
  { file: "security/index.js", names: ["locateInWorkspace", "relateRealPaths", "findKeyInJson"], step: "C-3a" },
  { file: "security/keys.js", names: ["findKeyInJson"], step: "C-3a" },
  { file: "security/paths.js", names: ["checkLocalPathSyntax"], step: "C-3a" },
  { file: "text-safety.js", names: ["cleanText", "hideKeys", "hideKeysInStrings"], step: "C-3a" },
  { file: "install.js", names: ["findInstall"], step: "C-3a" },
  { file: "run-id.js", names: ["createRunId"], step: "C-3a" },
  { file: "human/format.js", names: ["quoteModelText", "MODEL_TEXT_PREFIX"], step: "C-3a" },
  { file: "args.js", names: ["RUN_ID_PATTERN"], step: "C-3a (a name in a file that stays)" },
  { file: "human/output.js", names: ["FINAL_MESSAGE_MAX_LINES"], step: "C-3a (a name in a file that stays)" },
  { file: "settings.js", names: ["resolveAnthropicSettings", "resolveConnection", "resolveListSettings", "knownKeyValues"], step: "C-3b" },
  { file: "task.js", names: ["parseTask", "quickProvider"], step: "C-3b" },
  { file: "config.js", names: ["parseConfig"], step: "C-3b" },
  { file: "config-file.js", names: ["chooseConfigFile"], step: "C-3b" },
  { file: "unreadable.js", names: ["runGuards", "runUnreadablePaths", "runMinGroupSize"], step: "C-3b" },
  { file: "assemble.js", names: ["assembleRun", "createAssemble", "createRevertCommand", "revertStatus"], step: "C-4 (names in a file that stays; the pinned file takes assembleRun)" },
  {
    file: "run.js",
    names: ["prepareTask", "cliError", "withHint", "argumentsError", "settingsError", "positionDiagnostic", "jsonSyntaxError", "workflowProblemText", "runCli"],
    step: "C-5 (names in a file that stays; the pinned file takes runCli)",
  },
  {
    file: "run.js",
    names: ["MODEL_NOT_FOUND_HINT", "notePrivateData", "defaultConfigNotice", "runPrepared"],
    step: "C-6a (U-296; names in a file that stays: tests take the first three, plan-commands runPrepared)",
  },
  { file: "failed-calls.js", names: ["createFailedCalls"], step: "C-6a (U-293 moved it; progress.ts takes it)" },
  { file: "result-fields.js", names: ["withoutEmptyStateChanged"], step: "C-6a (U-293 moved it)" },
  { file: "human/query-table.js", names: ["queryTableFacts"], step: "C-6a (U-293 moved it; nc-human's file)" },
  {
    file: "plan-commands.js",
    names: ["NO_GOAL", "runPlan", "runReview", "runApply", "applyChangesPlan", "renderPlan", "renderReview", "applyQuestion", "unsafeMoveQuestion", "latestPlanRule", "planJsonLine"],
    step: "C-7a (U-306; names in a file that stays: tests and the app layer take them)",
  },
  { file: "run-ref.js", names: ["resolveRunReference", "STORE_RUN_REFERENCE_DEPS"], step: "C-7a (U-306; tests and the app's runs.ts take them)" },
  { file: "guard.js", names: ["jsonLine", "renderOutcome", "stdoutText", "runGuardedCommand"], step: "C-7a (U-306; a file that stays, its outcome types moved)" },
  { file: "json-position.js", names: ["jsonErrorOffset", "lineAndColumn", "jsonSyntaxPosition"], step: "C-5" },
];

describe("U-282: the old paths the CLI migration keeps as re-exports are there (plan A)", () => {
  for (const { file, names, step } of KEPT) {
    test(`dist/src/cli/${file} (${step})`, async () => {
      const full = path.join(CLI_DIR, ...file.split("/"));
      assert.ok(existsSync(full), `${file} is missing from the build; plan A keeps a re-export at the old path`);
      const loaded = (await import(pathToFileURL(full).href)) as Record<string, unknown>;
      for (const name of names) assert.notEqual(loaded[name], undefined, `${file} gives ${name}`);
    });
  }
});
