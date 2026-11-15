/**
 * U-11 (docs/design/standalone-gui.md 3.11): the first-run guide's two app layer calls, as the
 * window may see them: `createSettings` (init without questions: the defaults, never over an
 * existing file, never a key) and `settingsSuggestions` (the fixed commands and protected paths
 * init would offer for a workspace). Codes and words only; the full config path stays out.
 */

import { failureOf } from "./settings.js";
import type { HostFailure, Shown } from "./settings.js";

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const HOST_ERROR: HostFailure = { ok: false, code: "host_error" };

/** `createSettings` → `{ok, created, model, keySet, overridden}`; `config_exists` and the rest go on as codes. */
export function initValue(outcome: unknown): Obj | HostFailure {
  if (!isObj(outcome) || outcome["ok"] !== true) return failureOf(outcome);
  const output = outcome["output"];
  if (!isObj(output) || output["kind"] !== "init" || (output["status"] !== "created" && output["status"] !== "declined")) return HOST_ERROR;
  return {
    ok: true,
    created: output["status"] === "created",
    model: output["model"] === "selected" ? "selected" : "placeholder",
    keySet: output["keySet"] === true,
    overridden: output["overriddenBy"] === "CODARYN_CONFIG",
  };
}

/** `settingsSuggestions` → `{ok, commands: [{shown, rule}], protectedPaths}`; a rule's arguments are fixed. */
export function suggestionsValue(outcome: unknown, shown: Shown): Obj | HostFailure {
  if (!isObj(outcome) || outcome["ok"] !== true) return failureOf(outcome);
  const output = outcome["output"];
  if (!isObj(output) || output["kind"] !== "settings_suggestions" || !Array.isArray(output["commands"]) || !Array.isArray(output["protectedPaths"])) return HOST_ERROR;
  const commands = output["commands"].slice(0, 32).flatMap((item) => {
    if (!isObj(item) || typeof item["shown"] !== "string" || !isObj(item["rule"])) return [];
    const { executable, argsPrefix, allowExtraArgs } = item["rule"];
    if (typeof executable !== "string" || !Array.isArray(argsPrefix) || !argsPrefix.every((arg) => typeof arg === "string") || typeof allowExtraArgs !== "boolean") return [];
    return [{ shown: shown(item["shown"]), rule: { executable, argsPrefix: [...(argsPrefix as string[])], allowExtraArgs } }];
  });
  const protectedPaths = output["protectedPaths"].slice(0, 32).flatMap((item) => (typeof item === "string" ? [shown(item)] : []));
  return { ok: true, commands, protectedPaths };
}
