/**
 * U-67 (docs/design/standalone-gui.md 3.13, 10): the command palette (Ctrl+Shift+P). A fixed list
 * of the window's commands, found by name and run; nothing in it is built from a model's text or a
 * file name. A combobox over a listbox: typing filters (every word must be in the name), Up and Down
 * move, Enter runs the chosen command, Escape closes, and the focus goes back where it was. A
 * command that cannot run now (cancel with no run going) is listed as such and does not run.
 */

import type { Texts } from "../i18n/catalog.js";
import { el } from "./dom.js";

export interface Command {
  /** A fixed id (data-command), never shown text. */
  readonly id: string;
  /** The name as shown, from the window's own texts. */
  readonly label: string;
  /** The shortcut, when there is one (shown after the name). */
  readonly keys: string | null;
  readonly run: () => void;
  /** Absent: always available. */
  readonly available?: () => boolean;
}

/** The commands whose name holds every word of `query` (case ignored), in the list's order. */
export function filterCommands(commands: readonly Command[], query: string): Command[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter((word) => word.length > 0);
  return commands.filter((command) => {
    const name = command.label.toLocaleLowerCase();
    return words.every((word) => name.includes(word));
  });
}

export class Palette {
  readonly element: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private shown: Command[] = [];
  private active = 0;
  private returnTo: HTMLElement | null = null;

  constructor(
    private readonly texts: Texts,
    private readonly commands: () => readonly Command[],
  ) {
    const t = texts;
    this.element = el("div", undefined, { id: "palette", role: "dialog", "aria-modal": "true", "aria-label": t.format("palette.label"), hidden: "" });
    this.input = el("input", undefined, {
      id: "palette-input",
      type: "text",
      role: "combobox",
      autocomplete: "off",
      spellcheck: "false",
      "aria-expanded": "true",
      "aria-controls": "palette-list",
      "aria-autocomplete": "list",
      "aria-label": t.format("palette.input"),
    });
    this.list = el("ul", undefined, { id: "palette-list", role: "listbox", "aria-label": t.format("palette.label") });
    this.empty = el("p", t.format("palette.empty"), { id: "palette-empty", hidden: "" });
    this.element.append(this.input, this.list, this.empty);
    this.input.addEventListener("input", () => {
      this.active = 0;
      this.render();
    });
    // Every key stays in the palette (the window's own shortcuts wait until it is closed).
    this.element.addEventListener("keydown", (event) => {
      event.stopPropagation();
      this.onKey(event);
    });
  }

  get isOpen(): boolean {
    return !this.element.hasAttribute("hidden");
  }

  open(): void {
    if (this.isOpen) return;
    const active = document.activeElement;
    this.returnTo = active !== null && active !== undefined && "focus" in active ? (active as HTMLElement) : null;
    this.input.value = "";
    this.active = 0;
    this.element.removeAttribute("hidden");
    this.render();
    this.input.focus();
  }

  close(): void {
    if (!this.isOpen) return;
    this.element.setAttribute("hidden", "");
    const back = this.returnTo;
    this.returnTo = null;
    back?.focus();
  }

  private render(): void {
    this.shown = filterCommands(this.commands(), this.input.value);
    if (this.active >= this.shown.length) this.active = Math.max(0, this.shown.length - 1);
    const items = this.shown.map((command, index) => {
      const available = command.available?.() ?? true;
      const item = el("li", undefined, {
        role: "option",
        id: `palette-option-${command.id}`,
        "data-command": command.id,
        "aria-selected": String(index === this.active),
        ...(available ? {} : { "aria-disabled": "true" }),
      });
      item.append(el("span", command.label, { class: "palette-name" }));
      if (command.keys !== null) item.append(el("span", command.keys, { class: "palette-keys" }));
      if (!available) item.append(el("span", this.texts.format("palette.unavailable"), { class: "palette-note" }));
      item.addEventListener("click", () => this.choose(index));
      return item;
    });
    this.list.replaceChildren(...items);
    const current = this.shown[this.active];
    if (current === undefined) this.input.removeAttribute("aria-activedescendant");
    else this.input.setAttribute("aria-activedescendant", `palette-option-${current.id}`);
    if (this.shown.length === 0) this.empty.removeAttribute("hidden");
    else this.empty.setAttribute("hidden", "");
  }

  /** Runs the shown command at `index` after the palette closed (so its screen gets the focus). */
  private choose(index: number): void {
    const command = this.shown[index];
    if (command === undefined || !(command.available?.() ?? true)) return;
    this.close();
    command.run();
  }

  private onKey(event: KeyboardEvent): void {
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        this.close();
        return;
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        if (this.shown.length === 0) return;
        const step = event.key === "ArrowDown" ? 1 : this.shown.length - 1;
        this.active = (this.active + step) % this.shown.length;
        this.render();
        return;
      }
      case "Enter":
        event.preventDefault();
        this.choose(this.active);
        return;
      case "Tab":
        // The dialog holds the focus while it is open.
        event.preventDefault();
        this.input.focus();
        return;
      default:
    }
  }
}
