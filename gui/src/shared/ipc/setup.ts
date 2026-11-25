/** Settings creation and fixed-suggestion IPC checks. Public callers use ../ipc.js. */
import { hasOnlyKeys, isHandle, isObj, shortText, textList, hostCodeOf } from "./primitives.js";

/** U-11 (3.11): the config file made with the defaults; `config_exists` when one is there (it is used as it is). */
export type CreateSettingsReply =
  | { readonly ok: true; readonly created: boolean; readonly model: "selected" | "placeholder"; readonly keySet: boolean; readonly overridden: boolean }
  | { readonly ok: false; readonly code: string };

/** U-11 (3.11): init's fixed suggestions for the open workspace; a command's arguments are fixed. */
export interface SuggestedCommandView {
  readonly shown: string;
  readonly rule: { readonly executable: string; readonly argsPrefix: readonly string[]; readonly allowExtraArgs: boolean };
}
export type SuggestionsReply = { readonly ok: true; readonly commands: readonly SuggestedCommandView[]; readonly protectedPaths: readonly string[] } | { readonly ok: false; readonly code: string };

/** The engine host's createSettings value, checked. */
export function toCreateSettingsReply(value: unknown): CreateSettingsReply {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const { created, model, keySet, overridden } = value;
  if (typeof created !== "boolean" || (model !== "selected" && model !== "placeholder") || typeof keySet !== "boolean" || typeof overridden !== "boolean") return { ok: false, code: "host_error" };
  return { ok: true, created, model, keySet, overridden };
}

/** The engine host's suggestions value, checked. */
export function toSuggestionsReply(value: unknown): SuggestionsReply {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const commands = value["commands"];
  const paths = value["protectedPaths"];
  if (!Array.isArray(commands) || commands.length > 32 || !textList(paths) || paths.length > 32) return { ok: false, code: "host_error" };
  const out: SuggestedCommandView[] = [];
  for (const item of commands) {
    if (!isObj(item) || !shortText(item["shown"]) || !isObj(item["rule"])) return { ok: false, code: "host_error" };
    const { executable, argsPrefix, allowExtraArgs } = item["rule"];
    if (!shortText(executable) || !textList(argsPrefix) || argsPrefix.length > 20 || typeof allowExtraArgs !== "boolean") return { ok: false, code: "host_error" };
    out.push({ shown: item["shown"], rule: { executable, argsPrefix, allowExtraArgs } });
  }
  return { ok: true, commands: out, protectedPaths: paths };
}

/** U-11: `createSettings` arguments: `{workspace}`, a workspace handle or null. */
export function parseCreateSettingsArgs(value: unknown): { readonly workspace: string | null } | null {
  if (!isObj(value) || !hasOnlyKeys(value, ["workspace"])) return null;
  const workspace = value["workspace"] ?? null;
  return workspace === null || isHandle(workspace) ? { workspace } : null;
}
