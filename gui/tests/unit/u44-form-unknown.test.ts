/**
 * U-44 (R-59 L-1): the guidance for a plan whose run was started outside this app names every option
 * of the CLI's task part that the apply commands it shows leave out (--profile, --config,
 * --vars-file), to be added as the run was started with them; filled that way the commands still
 * parse with the CLI's own argument reader and keep those values.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { applyCommands } from "../../src/renderer/plan/plan-screen.js";

// This file runs as gui/build/tests/unit/u44-form-unknown.test.js.
const GUI = fileURLToPath(new URL("../../../", import.meta.url));
const ARGS = path.join(GUI, "..", "dist", "src", "cli", "args.js");
const BUILT = existsSync(ARGS);
const RUN = "20261113T010203Z-0000a044";
const DIGEST = "0123456789ab".padEnd(64, "d");

interface Parsed {
  readonly ok: boolean;
  readonly args?: { readonly runId?: string; readonly form?: { readonly configPath: string | null; readonly varsFile: string | null; readonly profile: string | null } };
}

test("U-44: the guidance names each option of the CLI's task part that the shown commands leave out, in both languages", { skip: !BUILT && "the engine is not built (npm run build in the root)" }, async () => {
  const cli = (await import(pathToFileURL(ARGS).href)) as { TASK_FORM_USAGE: string };
  const options = [...new Set(cli.TASK_FORM_USAGE.match(/--[a-z][a-z-]*/g) ?? [])];
  assert.ok(options.includes("--config") && options.includes("--vars-file") && options.includes("--profile"), cli.TASK_FORM_USAGE);
  for (const language of ["ko", "en"] as const) {
    const t = textsFor(language);
    const shown = applyCommands(t, RUN, DIGEST).join(" ");
    const left = options.filter((option) => !shown.includes(option));
    assert.deepEqual(left.sort(), ["--config", "--profile", "--vars-file"], `${language}: what the person adds`);
    const text = t.format("plan.formUnknown", { runId: RUN });
    for (const option of left) assert.ok(text.includes(option), `${language}: names ${option}`);
    // As the run was started: the same values, only when the run was started with them.
    assert.match(text, language === "ko" ? /실행을 시작할 때/ : /when the run was started with/, language);
  }
});

test("U-44: the commands, filled as the guidance says, parse with the CLI's reader and keep the config and vars files", { skip: !BUILT && "the engine is not built (npm run build in the root)" }, async () => {
  const cli = (await import(pathToFileURL(ARGS).href)) as { parseApplyArgs(argv: readonly string[]): Parsed };
  const argv = (command: string): string[] => command.replace(/<[^>]+>/g, "filled").split(" ").slice(1);
  for (const language of ["ko", "en"] as const) {
    const [task, workspace] = applyCommands(textsFor(language), RUN, DIGEST);
    assert.ok(task !== undefined && workspace !== undefined);
    const extra = ["--config", "run-config.json", "--vars-file", "run-vars.json"];
    const byTask = cli.parseApplyArgs([...argv(task), ...extra]);
    assert.ok(byTask.ok, `${language}: ${JSON.stringify(byTask)}`);
    assert.equal(byTask.args?.form?.configPath, "run-config.json");
    assert.equal(byTask.args?.form?.varsFile, "run-vars.json");
    const byWorkspace = cli.parseApplyArgs([...argv(workspace), "--profile", "team", ...extra]);
    assert.ok(byWorkspace.ok, `${language}: ${JSON.stringify(byWorkspace)}`);
    assert.deepEqual([byWorkspace.args?.form?.profile, byWorkspace.args?.form?.configPath, byWorkspace.args?.form?.varsFile], ["team", "run-config.json", "run-vars.json"]);
    assert.equal(byWorkspace.args?.runId, RUN);
  }
});
