/**
 * U-174 (DR-72; docs/design/standalone-gui.md 3.14, adapter-contract 5.15): one workspace text file
 * for the window's text view, from the app layer's `readWorkspaceText` (U-172). The engine host
 * reads no file itself.
 *
 * - The app layer checks the path (plain relative segments), resolves it by the engine's workspace
 *   rules, follows no link or junction, refuses the state directory, and opens regular files of at
 *   most MAX_READ_BYTES that are UTF-8 text. The text comes without the byte order mark, LF line
 *   breaks, masked with the values registered now, key values and key shapes hidden, and control
 *   characters replaced. It also says whether a person may edit it here, and why not.
 * - The form is the tree's: the open workspace with the config file's defaults (no profile, no task
 *   type), so the view's protected mark is the tree's.
 * - The text passes the host's own `shownText` once more (key shapes, control characters). When
 *   that changes it, the window gets the changed text and the file is not editable (`masked`): the
 *   editor never holds a text that showing changes.
 * - Only the fields below are passed on, each checked; a value that does not fit is host_error. A
 *   file not opened (not_found, not_file, refused, too_large, not_text, unreadable, mask_failed)
 *   comes back as its status with no text; an app error as its code.
 */

import { MAX_TEXT_CHARS, TEXT_NOT_OPENED, TEXT_READ_ONLY_REASONS } from "../shared/ipc.js";
import type { TextReadOnlyReason } from "../shared/ipc.js";

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const HOST_ERROR = { ok: false, code: "host_error" } as const;
const CODE = /^[a-z][a-z0-9_]{0,63}$/;
const LINE_ENDINGS = ["lf", "crlf", "none", "mixed"] as const;

export type TextValue =
  | {
      readonly ok: true;
      readonly status: "opened";
      readonly text: string;
      readonly masked: boolean;
      readonly protected: boolean;
      readonly lineEnding: (typeof LINE_ENDINGS)[number];
      readonly bom: boolean;
      readonly digest: string;
      readonly bytes: number;
      readonly editable: boolean;
      readonly readOnlyReasons: readonly TextReadOnlyReason[];
    }
  | { readonly ok: true; readonly status: (typeof TEXT_NOT_OPENED)[number] }
  | { readonly ok: false; readonly code: string };

/** The reasons as the app layer gave them (known, each once), or null. */
function reasonsOf(value: unknown): TextReadOnlyReason[] | null {
  if (!Array.isArray(value) || value.length > TEXT_READ_ONLY_REASONS.length) return null;
  const out: TextReadOnlyReason[] = [];
  for (const reason of value) {
    if (typeof reason !== "string" || !(TEXT_READ_ONLY_REASONS as readonly string[]).includes(reason) || out.includes(reason as TextReadOnlyReason)) return null;
    out.push(reason as TextReadOnlyReason);
  }
  return out;
}

/** `readWorkspaceText`'s outcome as the host's text value; `shownText` hides key shapes and control characters once more. */
export function textValue(outcome: unknown, shownText: (text: string) => string): TextValue {
  if (!isObj(outcome)) return HOST_ERROR;
  if (outcome["ok"] !== true) {
    const code = isObj(outcome["error"]) ? outcome["error"]["code"] : undefined;
    return { ok: false, code: typeof code === "string" && CODE.test(code) ? code : "host_error" };
  }
  const output = outcome["output"];
  if (!isObj(output) || output["kind"] !== "workspace_text") return HOST_ERROR;
  const status = output["status"];
  if (typeof status === "string" && (TEXT_NOT_OPENED as readonly string[]).includes(status)) return { ok: true, status: status as (typeof TEXT_NOT_OPENED)[number] };
  if (status !== "opened" || output["masking"] !== "current_secrets") return HOST_ERROR;
  const { text, masked, lineEnding, bom, digest, bytes, editable } = output;
  const marked = output["protected"];
  const reasons = reasonsOf(output["readOnlyReasons"]);
  if (typeof text !== "string" || text.length > MAX_TEXT_CHARS || typeof masked !== "boolean" || typeof marked !== "boolean" || typeof bom !== "boolean" || typeof editable !== "boolean") return HOST_ERROR;
  if (typeof lineEnding !== "string" || !(LINE_ENDINGS as readonly string[]).includes(lineEnding) || typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)) return HOST_ERROR;
  if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_TEXT_CHARS) return HOST_ERROR;
  if (reasons === null || editable !== (reasons.length === 0) || (masked && !reasons.includes("masked"))) return HOST_ERROR;
  // The host's own pass: when it changes the text, what is shown is not the file's text.
  const shown = shownText(text);
  const changed = shown !== text;
  const finalReasons: TextReadOnlyReason[] = changed && !reasons.includes("masked") ? ["masked", ...reasons] : reasons;
  return {
    ok: true,
    status: "opened",
    text: shown,
    masked: masked || changed,
    protected: marked,
    lineEnding: lineEnding as (typeof LINE_ENDINGS)[number],
    bom,
    digest,
    bytes,
    editable: finalReasons.length === 0,
    readOnlyReasons: finalReasons,
  };
}
