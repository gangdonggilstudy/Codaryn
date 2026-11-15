/**
 * The GUI wizard's first steps (standalone-gui 3.2, N-2): create the config file, and the fixed
 * suggestions a workspace offers.
 *
 * - `createSettings` is the CLI's `init --json` without questions (`runInit`): the same target
 *   (`--config`, else the N-1 default location), the same refusals (inside the workspace, S-1; a
 *   file already there, `config_exists`), the same file (defaults only: the model placeholder,
 *   default limits, the deny-all policy). It never asks for or writes a key (C-1).
 *   The wizard then sets what the person chose through `selectModel` and the settings change.
 * - `settingsSuggestions` names the candidates init would ask about for a workspace: the
 *   `package.json` scripts on init's fixed list (SUGGESTED_SCRIPTS) and the fixed protected paths
 *   that exist (SUGGESTED_PROTECTED_PATHS). As in init, nothing but those fixed names is taken from
 *   the workspace. Allowing a command widens the policy; the GUI asks before it writes one.
 */

import path from "node:path";
import { lstat, readFile } from "node:fs/promises";
import type { CommandRule, InitSuggestedCommand, InitSuggestedProtectedPath } from "../contracts/index.js";
import { MAX_PACKAGE_JSON_BYTES, SUGGESTED_PROTECTED_PATHS, SUGGESTED_SCRIPTS } from "./init-core.js";
import type { CreateSettingsRequest, SettingsSuggestions } from "./types.js";

/** The `codaryn init` arguments for a request, always `--json` (no questions). */
export function initArguments(request: CreateSettingsRequest): string[] {
  const argv = ["init"];
  if (request.configPath !== null) argv.push("--config", request.configPath);
  if (request.workspace !== null) argv.push("--workspace", request.workspace);
  argv.push("--json");
  return argv;
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch {
    return false;
  }
}

/** Script names of package.json that are on init's list. Nothing else is taken from the file. */
async function scriptsIn(workspace: string): Promise<readonly { readonly shown: InitSuggestedCommand; readonly rule: CommandRule }[]> {
  let text: string;
  try {
    text = await readFile(path.join(workspace, "package.json"), "utf8");
  } catch {
    return [];
  }
  if (Buffer.byteLength(text, "utf8") > MAX_PACKAGE_JSON_BYTES) return [];
  let scripts: unknown;
  try {
    scripts = (JSON.parse(text.replace(/^﻿/, "")) as { scripts?: unknown } | null)?.scripts;
  } catch {
    return [];
  }
  if (typeof scripts !== "object" || scripts === null || Array.isArray(scripts)) return [];
  return SUGGESTED_SCRIPTS.filter((entry) => typeof (scripts as Record<string, unknown>)[entry.script] === "string").map((entry) => ({
    shown: entry.shown,
    rule: { ...entry.rule, argsPrefix: [...entry.rule.argsPrefix] },
  }));
}

/** The fixed suggestions for `workspace` (an existing directory, absolute). */
export async function suggestionsFor(workspace: string): Promise<SettingsSuggestions> {
  const protectedPaths: InitSuggestedProtectedPath[] = [];
  for (const name of SUGGESTED_PROTECTED_PATHS) {
    if (await exists(path.join(workspace, name))) protectedPaths.push(name);
  }
  return { kind: "settings_suggestions", commands: [...(await scriptsIn(workspace))], protectedPaths };
}
