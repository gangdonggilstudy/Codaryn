/**
 * U-174, U-184 (DR-71, DR-72; docs/design/standalone-gui.md 3.14): the text view of one workspace
 * file, opened from the file tree ("Open") or the changes view ("Open this file") by the id the main
 * process gave there; the page never names a path.
 * - The text is the app layer's (adapter-contract 5.15, U-172): masked with the values registered
 *   now, key values and key shapes hidden, control characters shown as "?", LF line breaks. It goes
 *   into a textarea through its value only (never parsed as HTML).
 * - Why the file cannot be edited here is said in words, first of all that a masked text is not the
 *   file's text. A file not opened (too large, not text, missing, refused...) has no text, only why,
 *   and "Show in folder".
 * - U-184: a file the app layer found editable comes with the main process's edit token. The textarea
 *   can be edited then; Save (or Ctrl+S, not while an input method composes) sends the token and the
 *   text only. The main process asks the person once per opened file; the app layer judges the file
 *   and the new text again and writes it as it was opened. A refusal is said in words and the text
 *   stays. While a run goes on in this window the text is read only. Leaving the view (another
 *   screen, another file, F5) with an unsaved edit asks first; closing the window, the main process.
 * - Codex V-5 M-2: a save's reply belongs to the view that sent it. Opening another file, reading
 *   again, leaving or discarding makes a new view; a reply that comes later for an earlier view
 *   changes nothing on the current one (its text, its unsaved mark, what the main process is told).
 * - A wrap switch (on by default, as the changes view). With wrapping off, line numbers stand beside
 *   the text (hidden from screen readers); the cursor's line and the line count are in the status line.
 */

import type { Texts } from "../i18n/catalog.js";
import { errorText } from "../i18n/catalog.js";
import { asSaveText, asText } from "../api.js";
import type { CodarynApi, Workspace } from "../api.js";
import { button, el } from "../shell/dom.js";
import type { Screen } from "../shell/shell.js";

export interface TextDeps {
  readonly texts: Texts;
  readonly api: CodarynApi;
  readonly current: () => Workspace | null;
  /** Goes to a screen (back to the one the view was opened from, or where the person was going). */
  readonly back: (screen: string) => void;
  /** U-184: whether a run goes on in this window now, and a listener for when that changes (it returns its removal). */
  readonly running?: () => boolean;
  readonly watchRun?: (listener: () => void) => () => void;
}

/** The entry to show: the main process's id for it, and its name as the tree or the changes view shows it (masked). */
export interface TextTarget {
  readonly node: string;
  readonly name: string;
}

export interface TextScreen extends Screen {
  /**
   * The entry the view shows next, and the screen to go back to. U-184: with an unsaved edit the view
   * asks first and this answers false; the entry is shown once the person lets the edit go.
   */
  choose(target: TextTarget, from: string): boolean;
  /** U-184: whether the view may be left for `to` now; with an unsaved edit it asks first and answers false. */
  leave(to: string): boolean;
  /** U-184: whether the view holds an unsaved edit. */
  readonly dirty: boolean;
}

/** The 1-based line of a cursor at `offset` in `text`. */
export function lineAt(text: string, offset: number): number {
  let line = 1;
  const end = Math.max(0, Math.min(offset, text.length));
  for (let i = 0; i < end; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

/** The line numbers column's text for `lines` lines. */
export function lineNumbers(lines: number): string {
  return Array.from({ length: lines }, (_value, index) => String(index + 1)).join("\n");
}

/** The number of lines of a text as the view counts them. */
export function lineCount(text: string): number {
  return text === "" ? 1 : text.split("\n").length;
}

/** U-184: Ctrl+S (Cmd+S) as a save, never while an input method composes (Korean input). */
export function isSaveKey(event: { readonly key: string; readonly ctrlKey: boolean; readonly metaKey: boolean; readonly altKey: boolean; readonly isComposing?: boolean; readonly keyCode?: number }): boolean {
  if (event.isComposing === true || event.keyCode === 229) return false;
  return (event.ctrlKey || event.metaKey) && !event.altKey && (event.key === "s" || event.key === "S");
}

export function textScreen(deps: TextDeps): TextScreen {
  const { texts: t, api } = deps;
  let target: TextTarget | null = null;
  let from = "home";
  let wrap = true;
  let dirty = false;
  /** What a confirmed "discard" goes on to: a screen, or another file then the view. */
  let pending: { readonly screen: string; readonly next: TextTarget | null; readonly from: string | null } | null = null;
  /** The shown view's hooks: ask about the unsaved edit, and follow the run state. */
  let askToLeave: (() => void) | null = null;
  let followRun: (() => void) | null = null;
  /** V-5 M-2: the view now; a save's reply for an earlier one is dropped. */
  let current = 0;

  const setDirty = (value: boolean): void => {
    if (dirty === value) return;
    dirty = value;
    void api.textDirty(value);
  };
  deps.watchRun?.(() => followRun?.());

  const screen: TextScreen = {
    id: "text",
    title: "nav.text",
    get dirty() {
      return dirty;
    },
    choose(next, screenId) {
      if (dirty) {
        pending = { screen: "text", next, from: screenId };
        askToLeave?.();
        return false;
      }
      target = next;
      // Opened from the view itself (another file chosen in the tree): back still goes where it came from.
      if (screenId !== "text") from = screenId;
      return true;
    },
    leave(to) {
      if (!dirty) return true;
      pending = { screen: to, next: null, from: null };
      askToLeave?.();
      return false;
    },
    show(root) {
      const workspace = deps.current();
      const chosen = target;
      current += 1;
      setDirty(false);
      askToLeave = null;
      followRun = null;
      const view = el("section", undefined, { id: "text", class: "text-view", "aria-labelledby": "text-title" });
      root.replaceChildren(view);
      if (workspace === null || chosen === null) {
        view.append(el("h2", t.format("nav.text"), { id: "text-title" }), el("p", t.format("text.none")));
        view.setAttribute("data-text-ready", "none");
        return;
      }
      const head = el("div", undefined, { class: "screen-head" });
      const reload = button(t.format("text.reload"), () => (screen.leave("text") ? void load() : undefined), { id: "text-reload" });
      const revealStatus = el("span", undefined, { role: "status", class: "reveal-status", id: "text-reveal-status" });
      const reveal = button(
        t.format("tree.reveal"),
        () => {
          void (async () => {
            const shown = (await api.reveal(workspace.handle, chosen.node)) === true;
            revealStatus.textContent = shown ? "" : t.format("changes.revealFailed");
            revealStatus.setAttribute("data-revealed", shown ? "ok" : "no");
          })();
        },
        { id: "text-reveal" },
      );
      const close = button(t.format("text.close"), () => deps.back(from), { id: "text-close" });
      head.append(el("h2", t.format("text.title", { name: chosen.name }), { id: "text-title" }), reload, reveal, close, revealStatus);
      // U-184: the question about an unsaved edit, in the view (default: keep editing).
      const leaving = el("div", undefined, { id: "text-leave", role: "alert", class: "notice", hidden: "" });
      const body = el("div", undefined, { id: "text-body", "aria-live": "polite" });
      view.append(head, leaving, body);
      let focusText = (): void => undefined;

      askToLeave = (): void => {
        const keep = button(
          t.format("text.leaveKeep"),
          () => {
            pending = null;
            leaving.setAttribute("hidden", "");
            leaving.replaceChildren();
            focusText();
          },
          { id: "text-leave-keep" },
        );
        const discard = button(
          t.format("text.leaveDiscard"),
          () => {
            const go = pending;
            pending = null;
            // The edit is let go: a save of it still under way no longer speaks for this view.
            current += 1;
            setDirty(false);
            leaving.setAttribute("hidden", "");
            if (go === null) return;
            if (go.next !== null) {
              target = go.next;
              if (go.from !== null && go.from !== "text") from = go.from;
            }
            deps.back(go.screen);
          },
          { id: "text-leave-discard" },
        );
        leaving.replaceChildren(el("p", t.format("text.leaveAsk")), discard, keep);
        leaving.removeAttribute("hidden");
        keep.focus();
      };

      const load = async (): Promise<void> => {
        current += 1;
        const mine = current;
        setDirty(false);
        view.setAttribute("data-text-ready", "loading");
        body.replaceChildren(el("p", t.format("runs.loading")));
        const reply = asText(await api.openText(workspace.handle, chosen.node));
        if (!reply.ok) {
          body.replaceChildren(el("div", `${errorText(t, reply.code)} ${t.format("error.code", { code: reply.code })}`, { role: "alert", class: "error", "data-error": reply.code }));
          view.setAttribute("data-text-ready", "error");
          return;
        }
        if (!reply.opened) {
          body.replaceChildren(el("p", t.format(`text.notOpened.${reply.reason}`), { class: "notice", id: "text-not-opened", "data-reason": reply.reason }));
          view.setAttribute("data-text-ready", "not_opened");
          return;
        }
        const editable = reply.editable && reply.editToken !== null;
        let token = reply.editToken;
        let opened = reply.text;
        const parts: HTMLElement[] = [el("p", t.format(editable ? "text.editView" : "text.readOnlyView"), { id: "text-read-only", class: "notice" })];
        if (reply.protected) parts.push(el("p", t.format("tree.mark.protected"), { id: "text-protected", class: "mark" }));
        if (reply.readOnlyReasons.length > 0) {
          const list = el("ul", undefined, { id: "text-reasons", "aria-label": t.format("text.reasonsLabel") });
          for (const reason of reply.readOnlyReasons) list.append(el("li", t.format(`text.reason.${reason}`), { "data-reason": reason }));
          parts.push(el("p", t.format("text.reasonsLead")), list);
        }
        // U-184 (DR-72): before any save, what a save means for the records and for revert.
        if (editable) parts.push(el("p", t.format("text.saveNote"), { id: "text-save-note", class: "notice" }));
        // The text, through the value only.
        const area = el("textarea", undefined, { id: "text-content", class: "text-content", spellcheck: "false", "aria-label": t.format(editable ? "text.labelEdit" : "text.label") });
        area.value = reply.text;
        const gutter = el("pre", undefined, { class: "text-lines", "aria-hidden": "true" });
        const status = el("p", undefined, { id: "text-status", role: "status" });
        const result = el("div", undefined, { id: "text-result", role: "status", "aria-live": "polite" });
        const runNote = el("p", t.format("text.runGoesOn"), { id: "text-run-note", class: "notice", hidden: "" });
        const save = button(t.format("text.save"), () => void doSave(), { id: "text-save", "aria-keyshortcuts": "Control+S" });
        const restore = button(
          t.format("text.restore"),
          () => {
            area.value = opened;
            changed();
            area.focus();
          },
          { id: "text-restore" },
        );
        let saving = false;
        const lines = (): number => lineCount(area.value);
        const place = (): void => {
          const words = [t.format("text.status", { line: String(lineAt(area.value, area.selectionStart ?? 0)), lines: String(lines()) })];
          if (editable) words.push(t.format(dirty ? "text.unsaved" : "text.noEdits"));
          status.textContent = words.join(" · ");
        };
        const layout = (): void => {
          area.setAttribute("wrap", wrap ? "soft" : "off");
          view.setAttribute("data-wrap", wrap ? "on" : "off");
          if (wrap) gutter.setAttribute("hidden", "");
          else {
            gutter.textContent = lineNumbers(lines());
            gutter.removeAttribute("hidden");
          }
        };
        /** U-184: read only unless editable, no run goes on and no save is under way. */
        const writable = (): boolean => editable && token !== null && !saving && deps.running?.() !== true;
        const controls = (): void => {
          const open = writable();
          if (open) area.removeAttribute("readonly");
          else area.setAttribute("readonly", "");
          if (open && dirty) save.removeAttribute("disabled");
          else save.setAttribute("disabled", "");
          if (open && dirty) restore.removeAttribute("disabled");
          else restore.setAttribute("disabled", "");
          if (editable && deps.running?.() === true) runNote.removeAttribute("hidden");
          else runNote.setAttribute("hidden", "");
          view.setAttribute("data-editable", String(open));
        };
        const changed = (): void => {
          setDirty(editable && area.value !== opened);
          if (!wrap) gutter.textContent = lineNumbers(lines());
          controls();
          place();
        };
        const doSave = async (): Promise<void> => {
          if (!writable() || !dirty || token === null) return;
          saving = true;
          controls();
          result.replaceChildren(el("p", t.format("text.saving")));
          const text = area.value;
          const reply = asSaveText(await api.saveText(token, text));
          // V-5 M-2: the person moved on (another file, read again, left): this reply is not the current view's.
          if (mine !== current) return;
          saving = false;
          if (!reply.ok) {
            result.replaceChildren(el("p", reply.code === "cancelled" ? t.format("text.saveCancelled") : `${errorText(t, reply.code)} ${t.format("error.code", { code: reply.code })}`, { class: reply.code === "cancelled" ? "notice" : "error", "data-save": reply.code }));
          } else if (reply.saved) {
            token = reply.editToken;
            opened = text;
            const words = [el("p", t.format(reply.unchanged ? "text.saveUnchanged" : "text.saved"), { "data-save": reply.unchanged ? "unchanged" : "saved" })];
            // V-5 M-1: saved, but its token was dropped meanwhile (settings written): read only until opened again.
            if (reply.editToken === null) words.push(el("p", t.format("text.savedReopen"), { class: "notice", id: "text-saved-reopen" }));
            if (reply.lockLeft) words.push(el("p", t.format("text.lockLeft"), { class: "notice" }));
            result.replaceChildren(...words);
          } else {
            const words: HTMLElement[] = [el("p", t.format(`text.refused.${reply.status}`), { class: "error", "data-save": reply.status })];
            const why = reply.status === "not_editable" ? reply.readOnlyReasons.map((reason) => t.format(`text.reason.${reason}`)) : reply.textProblems.map((problem) => t.format(`text.problem.${problem}`));
            if (why.length > 0) {
              const list = el("ul", undefined, { id: "text-save-why" });
              for (const line of why) list.append(el("li", line));
              words.push(list);
            }
            if (reply.lockLeft) words.push(el("p", t.format("text.lockLeft"), { class: "notice" }));
            // Not editable here any more: the token goes; the text stays to be copied.
            if (reply.status === "not_editable" || reply.status === "path_changed") token = null;
            result.replaceChildren(...words);
          }
          changed();
        };
        for (const name of ["keyup", "click", "select", "focus"]) area.addEventListener(name, place);
        area.addEventListener("input", changed);
        area.addEventListener("keydown", (event) => {
          if (!isSaveKey(event as KeyboardEvent)) return;
          (event as KeyboardEvent).preventDefault();
          void doSave();
        });
        area.addEventListener("scroll", () => {
          gutter.scrollTop = area.scrollTop;
        });
        const box = el("input", undefined, { type: "checkbox", id: "text-wrap" });
        box.checked = wrap;
        box.addEventListener("change", () => {
          wrap = box.checked;
          layout();
        });
        const toggle = el("label", undefined, { class: "toggle" });
        toggle.append(box, el("span", t.format("changes.wrap")));
        const frame = el("div", undefined, { class: "text-frame" });
        frame.append(gutter, area);
        const actions = el("div", undefined, { class: "text-actions" });
        if (editable) actions.append(save, restore);
        layout();
        controls();
        place();
        focusText = (): void => area.focus();
        followRun = (): void => {
          controls();
          place();
        };
        body.replaceChildren(...parts, runNote, toggle, frame, status, actions, result);
        view.setAttribute("data-text-ready", "opened");
        view.setAttribute("data-masked", String(reply.masked));
      };
      void load();
    },
  };
  return screen;
}
