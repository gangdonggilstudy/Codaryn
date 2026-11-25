/** Workspace and small UI replies. Public callers use ./api.js; dependencies stay in renderer. */
import type {
  DoctorReply,
  InfoView,
  OpenReply,
  RecentView,
  CopyReply,
  RestartReply,
  TreeEntryView,
  TreeReply,
  TextReadOnlyReason,
  TextNotOpened,
  TextReply,
  SaveTextReply,
  TextProblem,
  TextSaveRefusal,
} from "../shared/ipc.js";
import { asWorkspace, failed, HEX, isObj, str } from "./api-core.js";

const KINDS = ["dir", "file", "link", "state", "other"];

export function asInfo(value: unknown): InfoView {
  const info = isObj(value) ? value : {};
  return {
    language: info["language"] === "ko" ? "ko" : "en",
    engine: str(info["engine"]) ? info["engine"] : "host_error",
    initialWorkspace: asWorkspace(info["initialWorkspace"]),
    ui: asUi(info["ui"]),
  };
}

/** U-70: the remembered screen (a plain id) and file panel width (160 to 800), each dropped when it does not fit. */
function asUi(value: unknown): { readonly screen: string | null; readonly treeWidth: number | null } {
  const ui = isObj(value) ? value : {};
  const screen = ui["screen"];
  const width = ui["treeWidth"];
  return {
    screen: str(screen) && /^[a-z]{1,20}$/.test(screen) ? screen : null,
    treeWidth: typeof width === "number" && Number.isSafeInteger(width) && width >= 160 && width <= 800 ? width : null,
  };
}

export function asOpen(value: unknown): OpenReply {
  if (isObj(value) && value["ok"] === true) {
    const workspace = asWorkspace(value);
    if (workspace !== null) return { ok: true, ...workspace };
  }
  return { ok: false, code: isObj(value) && str(value["code"]) ? value["code"] : "host_error" };
}

export function asRecent(value: unknown): RecentView[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): RecentView[] =>
    isObj(item) && str(item["id"]) && HEX.test(item["id"]) && str(item["name"]) && str(item["where"]) && typeof item["exists"] === "boolean"
      ? [{ id: item["id"], name: item["name"], where: item["where"], exists: item["exists"] }]
      : [],
  );
}

export function asTree(value: unknown): TreeReply {
  if (!isObj(value)) return { ok: false, code: "host_error" };
  if (value["ok"] !== true) return { ok: false, code: str(value["code"]) ? value["code"] : "host_error" };
  const { entries, total, offset, nextOffset } = value;
  const count = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
  if (!Array.isArray(entries) || !count(total) || !count(offset) || !(nextOffset === null || count(nextOffset))) return { ok: false, code: "host_error" };
  const views: TreeEntryView[] = [];
  for (const entry of entries) {
    if (!isObj(entry) || !str(entry["name"]) || !str(entry["kind"]) || !KINDS.includes(entry["kind"]) || typeof entry["masked"] !== "boolean") {
      return { ok: false, code: "host_error" };
    }
    const id = entry["id"];
    views.push({ id: str(id) && HEX.test(id) ? id : null, name: entry["name"], kind: entry["kind"] as TreeEntryView["kind"], masked: entry["masked"], protected: entry["protected"] === true });
  }
  return { ok: true, entries: views, total, offset, nextOffset };
}

/**
 * U-174: the text view's reply (the main process checked it already). The page loads nothing from
 * outside its directory, so the known reasons are repeated here; one it does not know is dropped and
 * the file counts as not editable.
 */
const TEXT_REASONS: readonly string[] = ["masked", "control_characters", "mixed_line_endings", "protected", "settings_file", "read_only", "hard_link", "workspace_locked"];
const TEXT_NOT_OPENED: readonly string[] = ["not_found", "not_file", "refused", "too_large", "not_text", "unreadable", "mask_failed"];

export function asText(value: unknown): TextReply {
  if (!isObj(value) || value["ok"] !== true) return failed(value);
  if (value["opened"] === false) return str(value["reason"]) && TEXT_NOT_OPENED.includes(value["reason"]) ? { ok: true, opened: false, reason: value["reason"] as TextNotOpened } : { ok: false, code: "host_error" };
  const { text, lines } = value;
  if (value["opened"] !== true || !str(text) || typeof lines !== "number" || !Number.isSafeInteger(lines) || lines < 1) return { ok: false, code: "host_error" };
  const given: unknown[] = Array.isArray(value["readOnlyReasons"]) ? value["readOnlyReasons"] : [];
  const reasons = given.filter((reason: unknown): reason is TextReadOnlyReason => str(reason) && TEXT_REASONS.includes(reason));
  const masked = value["masked"] === true;
  return {
    ok: true,
    opened: true,
    text,
    masked,
    protected: value["protected"] === true,
    editable: value["editable"] === true && given.length === 0 && !masked && str(value["editToken"]) && HEX.test(value["editToken"]),
    readOnlyReasons: reasons,
    lines,
    editToken: str(value["editToken"]) && HEX.test(value["editToken"]) ? value["editToken"] : null,
  };
}

const TEXT_PROBLEMS: readonly string[] = ["masked", "control_characters", "too_large"];
const SAVE_REFUSALS: readonly string[] = ["conflict", "workspace_locked", "not_editable", "text_refused", "path_changed", "write_failed", ...TEXT_NOT_OPENED];

/** U-184: a save's reply (the main process checked it already); unknown reasons or problems are dropped. */
export function asSaveText(value: unknown): SaveTextReply {
  if (!isObj(value) || value["ok"] !== true) return failed(value);
  const lockLeft = value["lockLeft"] === true;
  if (value["saved"] === true) {
    const token = value["editToken"];
    // V-5 M-1: a write that ended after its token was dropped is saved with no next token.
    if (token === null) return { ok: true, saved: true, unchanged: value["unchanged"] === true, lockLeft, editToken: null };
    return str(token) && HEX.test(token) ? { ok: true, saved: true, unchanged: value["unchanged"] === true, lockLeft, editToken: token } : { ok: false, code: "host_error" };
  }
  const status = value["status"];
  if (value["saved"] !== false || !str(status) || !SAVE_REFUSALS.includes(status)) return { ok: false, code: "host_error" };
  const list = (field: string, known: readonly string[]): string[] => (Array.isArray(value[field]) ? (value[field] as unknown[]).filter((item): item is string => str(item) && known.includes(item)) : []);
  return {
    ok: true,
    saved: false,
    status: status as TextSaveRefusal,
    readOnlyReasons: list("readOnlyReasons", TEXT_REASONS) as TextReadOnlyReason[],
    textProblems: list("textProblems", TEXT_PROBLEMS) as TextProblem[],
    lockLeft,
  };
}

export function asDoctor(value: unknown): DoctorReply {
  if (!isObj(value)) return { ok: false, code: "host_error" };
  if (value["ok"] !== true) return { ok: false, code: str(value["code"]) ? value["code"] : "host_error" };
  return value as unknown as DoctorReply;
}

/** U-64: the answer to restartEngine. */
export function asRestart(value: unknown): RestartReply {
  return isObj(value) && value["ok"] === true ? { ok: true } : failed(value);
}

/** U-64: an engine state event: "ready", or an error code; null when it does not fit. */
export function asEngineState(value: unknown): string | null {
  const state = isObj(value) ? value["state"] : null;
  return typeof state === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(state) ? state : null;
}

/** U-62: a copy's answer. */
export function asCopy(value: unknown): CopyReply {
  return isObj(value) && value["ok"] === true ? { ok: true } : failed(value);
}
