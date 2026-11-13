/**
 * U-174, U-184 (DR-72; docs/design/standalone-gui.md 3.14): the main process's side of the text
 * view, apart from Electron so its order of checks can be tested: opening an entry by its id, and a
 * person's save by the edit token and the text.
 *
 * U-184 after Codex V-5 M-1: a reset (settings written drop every tree id and edit token, U-123's
 * treeReset; a closed window drops them too) also holds for requests already under way.
 * - An open checks again, after the host's read, that its entry id still stands for the same path;
 *   a read from before the reset (masked with the values registered then) is dropped, and no token
 *   is issued for it (`unknown_entry`).
 * - A save checks again, after the person's answer and before the host is asked to write, that its
 *   token still stands for the same file and digest; a token dropped meanwhile writes nothing
 *   (`unknown_entry`). A write already asked of the host is told as it ended: when the token was
 *   dropped during it, the reply says saved, with no next token (the view must be opened again).
 */

import type { HostCall, HostResponse } from "../shared/protocol.js";
import { MAX_TEXT_CHARS, parseRevealArgs, parseSaveTextArgs, textDigestOf, toSaveOutcome, toTextReply } from "../shared/ipc.js";
import type { SaveTextReply, TextReply } from "../shared/ipc.js";
import type { TextEdit, TextEdits } from "./text-edits.js";

export interface TextFilesDeps {
  readonly workspaces: {
    path(handle: string): string | null;
    readonly treeIds: { resolve(workspace: string, id: unknown): string | null };
  };
  readonly edits: TextEdits;
  readonly host: () => Promise<{ readonly host: { call(call: HostCall, args: unknown, timeoutMs: number): Promise<HostResponse> } } | { readonly failure: string }>;
  /** Asks the person, once per opened file, to save (principle 6, GUI-D22). */
  readonly confirm: () => Promise<boolean>;
  readonly timeoutMs: number;
}

export interface TextFiles {
  open(args: readonly unknown[]): Promise<TextReply>;
  save(args: readonly unknown[]): Promise<SaveTextReply>;
}

/** The same file as when the request began: same workspace, path and digest. */
const sameFile = (a: TextEdit | null, b: TextEdit): boolean => a !== null && a.workspace === b.workspace && a.path === b.path && a.digest === b.digest;

export function createTextFiles(deps: TextFilesDeps): TextFiles {
  return {
    async open(args) {
      const parsed = args.length === 1 ? parseRevealArgs(args[0]) : null;
      if (parsed === null) return { ok: false, code: "invalid_args" };
      const root = deps.workspaces.path(parsed.workspace);
      if (root === null) return { ok: false, code: "unknown_workspace" };
      const rel = deps.workspaces.treeIds.resolve(parsed.workspace, parsed.node);
      if (rel === null) return { ok: false, code: "unknown_entry" };
      const state = await deps.host();
      if (!("host" in state)) return { ok: false, code: state.failure };
      const response = await state.host.call("readText", { workspace: root, path: rel }, deps.timeoutMs);
      // V-5 M-1: the id must still stand for the same path; a read from before a reset is dropped.
      if (deps.workspaces.treeIds.resolve(parsed.workspace, parsed.node) !== rel || deps.workspaces.path(parsed.workspace) !== root) return { ok: false, code: "unknown_entry" };
      if (!response.ok) return { ok: false, code: response.error.code };
      const reply = toTextReply(response.value);
      // U-184: an editable file gets the token its save will need (the digest read stays here).
      const digest = textDigestOf(response.value);
      if (!reply.ok || !reply.opened || !reply.editable || digest === null) return reply;
      return { ...reply, editToken: deps.edits.issue(parsed.workspace, rel, digest) };
    },

    async save(args) {
      const parsed = args.length === 1 ? parseSaveTextArgs(args[0]) : null;
      if (parsed === null) return { ok: false, code: "invalid_args" };
      const edit = deps.edits.get(parsed.token);
      if (edit === null) return { ok: false, code: "unknown_entry" };
      const root = deps.workspaces.path(edit.workspace);
      if (root === null) return { ok: false, code: "unknown_workspace" };
      // Longer than any file the view opens: refused before anyone is asked (the app layer judges the bytes).
      if (parsed.text.length > MAX_TEXT_CHARS) return { ok: true, saved: false, status: "text_refused", readOnlyReasons: [], textProblems: ["too_large"], lockLeft: false };
      if (!deps.edits.begin(parsed.token)) return { ok: false, code: "busy" };
      try {
        if (!edit.confirmed) {
          if (!(await deps.confirm())) return { ok: false, code: "cancelled" };
          deps.edits.confirm(parsed.token);
        }
        const state = await deps.host();
        if (!("host" in state)) return { ok: false, code: state.failure };
        // V-5 M-1: after the waits, the token must still stand for the same file; one dropped meanwhile writes nothing.
        if (!sameFile(deps.edits.get(parsed.token), edit) || deps.workspaces.path(edit.workspace) !== root) return { ok: false, code: "unknown_entry" };
        const response = await state.host.call("writeText", { workspace: root, path: edit.path, text: parsed.text, baseDigest: edit.digest }, deps.timeoutMs);
        if (!response.ok) return { ok: false, code: response.error.code };
        const outcome = toSaveOutcome(response.value);
        if (!("saved" in outcome) || outcome.saved !== true) return outcome;
        // The write happened. A token dropped during it gives no next one: the view must be opened again.
        const next = deps.edits.replace(parsed.token, outcome.digest);
        return { ok: true, saved: true, unchanged: outcome.unchanged, lockLeft: outcome.lockLeft, editToken: next };
      } finally {
        deps.edits.end(parsed.token);
      }
    },
  };
}
