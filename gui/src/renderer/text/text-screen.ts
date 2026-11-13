/**
 * U-174 (DR-71, DR-72; docs/design/standalone-gui.md 3.14): the read-only text view of one workspace
 * file, opened from the file tree ("Open") or the changes view ("Open this file") by the id the main
 * process gave there; the page never names a path.
 * - The text is the app layer's (adapter-contract 5.15, U-172): masked with the values registered
 *   now, key values and key shapes hidden, control characters shown as "?", LF line breaks. It goes
 *   into a read-only textarea through its value only (never parsed as HTML).
 * - Why the file could not be edited here is said in words, first of all that a masked text is not
 *   the file's text. A file not opened (too large, not text, missing, refused...) has no text, only
 *   why, and "Show in folder".
 * - A wrap switch (on by default, as the changes view). With wrapping off, line numbers stand beside
 *   the text (hidden from screen readers); the cursor's line and the line count are in the status line.
 * - Editing and saving are the next unit's (the main process's edit token and first-save confirmation).
 */

import type { Texts } from "../i18n/catalog.js";
import { errorText } from "../i18n/catalog.js";
import { asText } from "../api.js";
import type { CodarynApi, Workspace } from "../api.js";
import { button, el } from "../shell/dom.js";
import type { Screen } from "../shell/shell.js";

export interface TextDeps {
  readonly texts: Texts;
  readonly api: CodarynApi;
  readonly current: () => Workspace | null;
  /** Goes back to the screen the view was opened from. */
  readonly back: (screen: string) => void;
}

/** The entry to show: the main process's id for it, and its name as the tree or the changes view shows it (masked). */
export interface TextTarget {
  readonly node: string;
  readonly name: string;
}

export interface TextScreen extends Screen {
  /** The entry the view shows next, and the screen to go back to. */
  choose(target: TextTarget, from: string): void;
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

export function textScreen(deps: TextDeps): TextScreen {
  const { texts: t, api } = deps;
  let target: TextTarget | null = null;
  let from = "home";
  let wrap = true;
  return {
    id: "text",
    title: "nav.text",
    choose(next, screen) {
      target = next;
      // Opened from the view itself (another file chosen in the tree): back still goes where it came from.
      if (screen !== "text") from = screen;
    },
    show(root) {
      const workspace = deps.current();
      const chosen = target;
      const view = el("section", undefined, { id: "text", class: "text-view", "aria-labelledby": "text-title" });
      root.replaceChildren(view);
      if (workspace === null || chosen === null) {
        view.append(el("h2", t.format("nav.text"), { id: "text-title" }), el("p", t.format("text.none")));
        view.setAttribute("data-text-ready", "none");
        return;
      }
      const head = el("div", undefined, { class: "screen-head" });
      const reload = button(t.format("text.reload"), () => void load(), { id: "text-reload" });
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
      const body = el("div", undefined, { id: "text-body", "aria-live": "polite" });
      view.append(head, body);

      const load = async (): Promise<void> => {
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
        const parts: HTMLElement[] = [el("p", t.format("text.readOnlyView"), { id: "text-read-only", class: "notice" })];
        if (reply.protected) parts.push(el("p", t.format("tree.mark.protected"), { id: "text-protected", class: "mark" }));
        if (reply.readOnlyReasons.length > 0) {
          const list = el("ul", undefined, { id: "text-reasons", "aria-label": t.format("text.reasonsLabel") });
          for (const reason of reply.readOnlyReasons) list.append(el("li", t.format(`text.reason.${reason}`), { "data-reason": reason }));
          parts.push(el("p", t.format("text.reasonsLead")), list);
        }
        // The text, through the value only; read only.
        const area = el("textarea", undefined, { id: "text-content", class: "text-content", readonly: "", spellcheck: "false", "aria-label": t.format("text.label") });
        area.value = reply.text;
        const gutter = el("pre", undefined, { class: "text-lines", "aria-hidden": "true" });
        const status = el("p", undefined, { id: "text-status", role: "status" });
        const place = (): void => {
          status.textContent = t.format("text.status", { line: String(lineAt(reply.text, area.selectionStart ?? 0)), lines: String(reply.lines) });
        };
        const layout = (): void => {
          area.setAttribute("wrap", wrap ? "soft" : "off");
          view.setAttribute("data-wrap", wrap ? "on" : "off");
          if (wrap) gutter.setAttribute("hidden", "");
          else {
            gutter.textContent = lineNumbers(reply.lines);
            gutter.removeAttribute("hidden");
          }
        };
        for (const name of ["keyup", "click", "select", "focus"]) area.addEventListener(name, place);
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
        layout();
        place();
        body.replaceChildren(...parts, toggle, frame, status);
        view.setAttribute("data-text-ready", "opened");
        view.setAttribute("data-masked", String(reply.masked));
        view.setAttribute("data-editable", String(reply.editable));
      };
      void load();
    },
  };
}
