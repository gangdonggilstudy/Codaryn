/**
 * GU-6 (docs/design/standalone-gui.md 3.10): one change of the config file the window asks for.
 * Pure (no Node, Electron or DOM), so the main process checks an edit as the engine host does.
 * The window never sends a config: it names one edit (language, a limit, a command rule, a
 * protected path, a secret variable name), the engine host applies it to the config as it is now
 * and asks the app layer for a proposal (`proposeSettingsChange`). The app layer judges what
 * widens; the main process keeps the new config and asks the person before a widening is written.
 * - A removal names the index and the text the window showed for it; the host checks that it is
 *   still that entry, so a file changed meanwhile cannot make a removal hit another entry.
 * - Secret variables are names only, never values (S-3).
 */

/** Text as the window may show it (the engine host's cleaning; identity where none is needed). */
export type Shown = (text: string) => string;

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);

export const LIMIT_KEYS = ["maxModelTurns", "maxToolCalls", "maxTotalTokens", "maxDurationMs", "maxRepairAttempts", "maxSameFailures"] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

export type SettingsEdit =
  | { readonly op: "language"; readonly value: "ko" | "en" | null }
  /** The config's `provider` (null: none named, the CLI's default). The engine host checks the name against the contract's table. */
  | { readonly op: "provider"; readonly value: string | null }
  | { readonly op: "limit"; readonly key: LimitKey; readonly value: number | null }
  | { readonly op: "addCommand"; readonly executable: string; readonly argsPrefix: readonly string[]; readonly allowExtraArgs: boolean }
  | { readonly op: "removeCommand"; readonly index: number; readonly shown: string }
  | { readonly op: "addProtectedPath"; readonly path: string }
  | { readonly op: "removeProtectedPath"; readonly index: number; readonly shown: string }
  | { readonly op: "addSecretEnv"; readonly name: string }
  | { readonly op: "removeSecretEnv"; readonly index: number; readonly shown: string };

const PLAIN = /^[^\u0000-\u001f\u007f]{1,200}$/;
const PATH = /^[^\u0000-\u001f\u007f]{1,1024}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const PROVIDER = /^[a-z][a-z0-9_-]{0,31}$/;
const MAX_ARGS = 20;
const MAX_LIMIT = 1_000_000_000;

const only = (value: Obj, keys: readonly string[]): boolean => Object.keys(value).every((key) => keys.includes(key));
const index = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < 10_000;

/** An edit the window sent, checked field by field; null when it does not fit. Shared by the main process. */
export function parseSettingsEdit(value: unknown): SettingsEdit | null {
  if (!isObj(value) || typeof value["op"] !== "string") return null;
  const v = value;
  switch (v["op"]) {
    case "language":
      return only(v, ["op", "value"]) && (v["value"] === "ko" || v["value"] === "en" || v["value"] === null) ? { op: "language", value: v["value"] } : null;
    case "provider":
      return only(v, ["op", "value"]) && (v["value"] === null || (typeof v["value"] === "string" && PROVIDER.test(v["value"]))) ? { op: "provider", value: v["value"] } : null;
    case "limit": {
      const key = v["key"];
      const limit = v["value"];
      if (!only(v, ["op", "key", "value"]) || typeof key !== "string" || !(LIMIT_KEYS as readonly string[]).includes(key)) return null;
      if (!(limit === null || (typeof limit === "number" && Number.isSafeInteger(limit) && limit >= 1 && limit <= MAX_LIMIT))) return null;
      return { op: "limit", key: key as LimitKey, value: limit as number | null };
    }
    case "addCommand": {
      const { executable, argsPrefix, allowExtraArgs } = v;
      if (!only(v, ["op", "executable", "argsPrefix", "allowExtraArgs"]) || typeof executable !== "string" || !PLAIN.test(executable) || typeof allowExtraArgs !== "boolean") return null;
      if (!Array.isArray(argsPrefix) || argsPrefix.length > MAX_ARGS || !argsPrefix.every((arg) => typeof arg === "string" && PLAIN.test(arg))) return null;
      return { op: "addCommand", executable, argsPrefix: argsPrefix as string[], allowExtraArgs };
    }
    case "addProtectedPath":
      return only(v, ["op", "path"]) && typeof v["path"] === "string" && PATH.test(v["path"]) ? { op: "addProtectedPath", path: v["path"] } : null;
    case "addSecretEnv":
      return only(v, ["op", "name"]) && typeof v["name"] === "string" && ENV_NAME.test(v["name"]) ? { op: "addSecretEnv", name: v["name"] } : null;
    case "removeCommand":
    case "removeProtectedPath":
    case "removeSecretEnv":
      return only(v, ["op", "index", "shown"]) && index(v["index"]) && typeof v["shown"] === "string" && v["shown"].length <= 2000
        ? ({ op: v["op"], index: v["index"], shown: v["shown"] } as SettingsEdit)
        : null;
    default:
      return null;
  }
}

/** How a command rule reads in the window: the executable and its fixed arguments, and "…" when more may follow. */
export function commandText(rule: unknown, shown: Shown): string {
  if (!isObj(rule) || typeof rule["executable"] !== "string") return "?";
  const args = Array.isArray(rule["argsPrefix"]) ? rule["argsPrefix"].filter((arg): arg is string => typeof arg === "string") : [];
  return [shown(rule["executable"]), ...args.map(shown), ...(rule["allowExtraArgs"] === true ? ["…"] : [])].join(" ");
}

export type EditOutcome = { readonly ok: true; readonly next: Obj } | { readonly ok: false; readonly code: string };

const DEFAULT_POLICY = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false };

/** `config` with `edit` applied, as a new object; `config` is not changed. */
export function applySettingsEdit(config: unknown, edit: SettingsEdit, shown: Shown): EditOutcome {
  if (!isObj(config)) return { ok: false, code: "settings_missing" };
  const next = JSON.parse(JSON.stringify(config)) as Obj;
  const policy = (): Obj => {
    if (!isObj(next["policy"])) next["policy"] = { ...DEFAULT_POLICY };
    return next["policy"] as Obj;
  };
  const listOf = (owner: Obj, key: string): unknown[] => {
    if (!Array.isArray(owner[key])) owner[key] = [];
    return owner[key] as unknown[];
  };
  const removeAt = (items: unknown[], at: number, expected: string, text: (item: unknown) => string): EditOutcome | null => {
    if (at >= items.length) return { ok: false, code: "settings_changed" };
    if (text(items[at]) !== expected) return { ok: false, code: "settings_changed" };
    items.splice(at, 1);
    return null;
  };
  switch (edit.op) {
    case "language":
      if (edit.value === null) delete next["language"];
      else next["language"] = edit.value;
      break;
    case "provider":
      if (edit.value === null) delete next["provider"];
      else next["provider"] = edit.value;
      break;
    case "limit": {
      if (!isObj(next["limits"])) next["limits"] = {};
      const limits = next["limits"] as Obj;
      if (edit.value === null) delete limits[edit.key];
      else limits[edit.key] = edit.value;
      if (Object.keys(limits).length === 0) delete next["limits"];
      break;
    }
    case "addCommand": {
      const commands = listOf(policy(), "commands");
      const rule = { executable: edit.executable, argsPrefix: [...edit.argsPrefix], allowExtraArgs: edit.allowExtraArgs };
      if (commands.some((item) => JSON.stringify(item) === JSON.stringify(rule))) return { ok: false, code: "already_present" };
      commands.push(rule);
      break;
    }
    case "removeCommand": {
      const failed = removeAt(listOf(policy(), "commands"), edit.index, edit.shown, (item) => commandText(item, shown));
      if (failed !== null) return failed;
      break;
    }
    case "addProtectedPath": {
      const paths = listOf(policy(), "protectedPaths");
      if (paths.includes(edit.path)) return { ok: false, code: "already_present" };
      paths.push(edit.path);
      break;
    }
    case "removeProtectedPath": {
      const failed = removeAt(listOf(policy(), "protectedPaths"), edit.index, edit.shown, (item) => (typeof item === "string" ? shown(item) : "?"));
      if (failed !== null) return failed;
      break;
    }
    case "addSecretEnv": {
      const names = listOf(next, "secretEnv");
      if (names.includes(edit.name)) return { ok: false, code: "already_present" };
      names.push(edit.name);
      break;
    }
    case "removeSecretEnv": {
      const failed = removeAt(listOf(next, "secretEnv"), edit.index, edit.shown, (item) => (typeof item === "string" ? shown(item) : "?"));
      if (failed !== null) return failed;
      break;
    }
  }
  return { ok: true, next };
}
