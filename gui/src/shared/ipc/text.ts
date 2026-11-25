/** Text open/save IPC checks. Public callers use ../ipc.js. */
import { count, hasOnlyKeys, isHandle, isObj, hostCodeOf, UNSAFE_IN_MESSAGE } from "./primitives.js";

/**
 * U-174 (DR-72, standalone-gui 3.14, adapter-contract 5.15): the text view of one workspace file.
 * The text is the app layer's (masked with the values registered now, key values and key shapes
 * hidden, control characters replaced; LF line breaks); it reaches the page through the textarea's
 * value only. A file not opened has no text, only why. The digest, line ending and byte order mark
 * stay out of the page (the edit unit binds them to its token in the main process).
 */
export const TEXT_READ_ONLY_REASONS = ["masked", "control_characters", "mixed_line_endings", "protected", "settings_file", "read_only", "hard_link", "workspace_locked"] as const;
export type TextReadOnlyReason = (typeof TEXT_READ_ONLY_REASONS)[number];
export const TEXT_NOT_OPENED = ["not_found", "not_file", "refused", "too_large", "not_text", "unreadable", "mask_failed"] as const;
export type TextNotOpened = (typeof TEXT_NOT_OPENED)[number];
/** The longest text the view takes in UTF-16 units: a file of MAX_READ_BYTES (256 KiB) UTF-8 bytes has no more. */
export const MAX_TEXT_CHARS = 262_144;

export type TextReply =
  | {
      readonly ok: true;
      readonly opened: true;
      readonly text: string;
      /** Masking changed the text: what is shown is not the file's text. */
      readonly masked: boolean;
      readonly protected: boolean;
      /** Whether the edit unit may let the person change it; the reasons why not, in the app layer's order. */
      readonly editable: boolean;
      readonly readOnlyReasons: readonly TextReadOnlyReason[];
      readonly lines: number;
      /**
       * U-184: when editable, the main process's token for saving this file as opened (bound there to
       * the workspace, the path and the digest read); null otherwise. The page sends it back with the text.
       */
      readonly editToken: string | null;
    }
  | { readonly ok: true; readonly opened: false; readonly reason: TextNotOpened }
  | { readonly ok: false; readonly code: string };

/** The engine host's text value, checked field by field; nothing else reaches the page. */
export function toTextReply(value: unknown): TextReply {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const fail = { ok: false, code: "host_error" } as const;
  if (value["status"] !== "opened") {
    const reason = value["status"];
    return typeof reason === "string" && (TEXT_NOT_OPENED as readonly string[]).includes(reason) && hasOnlyKeys(value, ["ok", "status"]) ? { ok: true, opened: false, reason: reason as TextNotOpened } : fail;
  }
  const { text, masked, editable, readOnlyReasons, digest, lineEnding, bom, bytes } = value;
  const marked = value["protected"];
  if (typeof text !== "string" || text.length > MAX_TEXT_CHARS || UNSAFE_IN_MESSAGE.test(text)) return fail;
  if (typeof masked !== "boolean" || typeof marked !== "boolean" || typeof editable !== "boolean" || typeof bom !== "boolean") return fail;
  if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest) || !["lf", "crlf", "none", "mixed"].includes(lineEnding as string) || !count(bytes) || bytes > MAX_TEXT_CHARS) return fail;
  if (!Array.isArray(readOnlyReasons) || readOnlyReasons.length > TEXT_READ_ONLY_REASONS.length) return fail;
  const reasons: TextReadOnlyReason[] = [];
  for (const reason of readOnlyReasons) {
    if (typeof reason !== "string" || !(TEXT_READ_ONLY_REASONS as readonly string[]).includes(reason) || reasons.includes(reason as TextReadOnlyReason)) return fail;
    reasons.push(reason as TextReadOnlyReason);
  }
  // Editable exactly when nothing keeps it read only; masked text is never editable.
  if (editable !== (reasons.length === 0) || (masked && !reasons.includes("masked"))) return fail;
  return { ok: true, opened: true, text, masked, protected: marked, editable, readOnlyReasons: reasons, lines: text === "" ? 1 : text.split("\n").length, editToken: null };
}

/** U-184: the digest the engine host's opened text was read with (checked by toTextReply first), or null. */
export function textDigestOf(value: unknown): string | null {
  return isObj(value) && value["ok"] === true && value["status"] === "opened" && typeof value["digest"] === "string" && /^[0-9a-f]{64}$/.test(value["digest"]) ? value["digest"] : null;
}

/**
 * U-184 (DR-72, 3.14; adapter-contract 5.15): a person's save of a text the view opened editable.
 * The page sends the main process's edit token and the textarea's text (LF line breaks, no byte order
 * mark) only; the main process asks the person once per opened file and the app layer judges and writes.
 */
export const TEXT_PROBLEMS = ["masked", "control_characters", "too_large"] as const;
export type TextProblem = (typeof TEXT_PROBLEMS)[number];
export const TEXT_SAVE_REFUSALS = ["conflict", "workspace_locked", "not_editable", "text_refused", "path_changed", "write_failed", ...TEXT_NOT_OPENED] as const;
export type TextSaveRefusal = (typeof TEXT_SAVE_REFUSALS)[number];

export type SaveTextReply =
  | {
      readonly ok: true;
      readonly saved: true;
      /** The text was the file's already: nothing was written. */
      readonly unchanged: boolean;
      /** The workspace lock could not be taken back (the app layer says so; never hidden). */
      readonly lockLeft: boolean;
      /**
       * The token for the next save (the file as written now); null when the token was dropped during
       * the write (settings written, the window closed): saved, and the view must be opened again.
       */
      readonly editToken: string | null;
    }
  | {
      readonly ok: true;
      readonly saved: false;
      readonly status: TextSaveRefusal;
      readonly readOnlyReasons: readonly TextReadOnlyReason[];
      readonly textProblems: readonly TextProblem[];
      readonly lockLeft: boolean;
    }
  | { readonly ok: false; readonly code: string };

/** `saveText` arguments: `{token, text}`; the text a string of well-formed UTF-16 (its size is judged after). */
export function parseSaveTextArgs(value: unknown): { readonly token: string; readonly text: string } | null {
  if (!isObj(value) || !hasOnlyKeys(value, ["token", "text"])) return null;
  const { token, text } = value;
  if (!isHandle(token) || typeof text !== "string") return null;
  // A lone surrogate cannot be written as UTF-8 (the app layer refuses it too).
  return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text) ? null : { token, text };
}

/** `textDirty` arguments: `{dirty}`, whether the text view holds an unsaved edit. */
export function parseTextDirtyArgs(value: unknown): boolean | null {
  return isObj(value) && hasOnlyKeys(value, ["dirty"]) && typeof value["dirty"] === "boolean" ? value["dirty"] : null;
}

/** A known list, each value once, or null. */
function knownList<T extends string>(value: unknown, known: readonly T[]): T[] | null {
  if (!Array.isArray(value) || value.length > known.length) return null;
  const out: T[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !(known as readonly string[]).includes(item) || out.includes(item as T)) return null;
    out.push(item as T);
  }
  return out;
}

/**
 * The engine host's write value, checked field by field. `saved` comes with the new digest (for the
 * next token, which the caller issues); a refusal with its reasons or problems only.
 */
export function toSaveOutcome(value: unknown): { readonly saved: true; readonly unchanged: boolean; readonly digest: string; readonly lockLeft: boolean } | Exclude<SaveTextReply, { readonly saved: true }> {
  // (The next token is the caller's to issue; see main/text-files.ts.)
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const fail = { ok: false, code: "host_error" } as const;
  const { status, digest, lockLeft } = value;
  const reasons = knownList(value["readOnlyReasons"], TEXT_READ_ONLY_REASONS);
  const problems = knownList(value["textProblems"], TEXT_PROBLEMS);
  if (typeof lockLeft !== "boolean" || reasons === null || problems === null) return fail;
  if (status === "written" || status === "unchanged") {
    return typeof digest === "string" && /^[0-9a-f]{64}$/.test(digest) && reasons.length === 0 && problems.length === 0 ? { saved: true, unchanged: status === "unchanged", digest, lockLeft } : fail;
  }
  if (typeof status !== "string" || !(TEXT_SAVE_REFUSALS as readonly string[]).includes(status) || digest !== null) return fail;
  // Reasons go with not_editable only, problems with text_refused only, and those two are never empty.
  if ((status === "not_editable") !== reasons.length > 0 || (status === "text_refused") !== problems.length > 0) return fail;
  return { ok: true, saved: false, status: status as TextSaveRefusal, readOnlyReasons: reasons, textProblems: problems, lockLeft };
}
