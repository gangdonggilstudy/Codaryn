/**
 * U-280 (CLI migration C-3a; PM after the board's GUI run): the GUI and its engine host load some of
 * the root build's modules by path, not by import (gui/src/engine-host/main.ts, gui/tests/unit/*), and
 * a missing module makes a GUI test skip itself quietly ("the engine is not built"). C-3a moved
 * src/cli/security/paths.ts to src/app/input/ without a re-export at the old path, so
 * gui/tests/unit/node-path-parity.test.ts stopped running. Plan A (PM, after U-267): every old path
 * that something loads keeps a re-export. This test names each path the GUI and the engine host load
 * from dist/src/cli and the names they take from it, and checks the build has them.
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
