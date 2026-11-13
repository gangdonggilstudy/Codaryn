/**
 * GU-2: the window frame (docs/design/standalone-gui.md 3.1): a header with the screen buttons, the
 * file panel, the work area and the status bar. Screens register here; one is shown at a time.
 * Keys: F6 moves between the regions, Ctrl+O opens a workspace, Ctrl+1 and Ctrl+2 switch screens.
 * U-67 (3.13): Ctrl+Shift+P opens the command palette, Ctrl+N the new task, Ctrl+comma the settings,
 * and F5 reads again (a panel that read again itself already took its F5). No single key cancels.
 * U-70 (3.1, 4.5): a separator between the file panel and the work area sets the panel's width, by
 * the pointer or by Left/Right (16 pixels) and Home/End; the width and the screen shown are told to
 * the handlers, which keep them.
 */

import type { Texts, TextId } from "../i18n/catalog.js";
import { button, el } from "./dom.js";

export interface Screen {
  readonly id: string;
  readonly title: TextId;
  /** Builds the screen's content into `root` each time it is shown. */
  show(root: HTMLElement): void;
}

/** U-70: the file panel's width range in CSS pixels (the main process checks the same, TREE_WIDTH_MIN/MAX). */
export const TREE_WIDTH_MIN = 160;
export const TREE_WIDTH_MAX = 800;
const TREE_WIDTH_STEP = 16;
/** The panel's width before one is chosen (as the layout's 18rem). */
const TREE_WIDTH_DEFAULT = 288;

export function clampTreeWidth(width: number): number {
  return Math.min(TREE_WIDTH_MAX, Math.max(TREE_WIDTH_MIN, Math.round(width)));
}

export interface ShellHandlers {
  readonly openWorkspace: () => void;
  /** U-70 (4.5): a width chosen with the separator, and the screen shown (to keep them). */
  readonly treeWidth?: (width: number) => void;
  readonly shown?: (screen: string) => void;
  /** U-67 (3.13): the command palette, the new task, the settings, and reading again (F5). */
  readonly palette?: () => void;
  readonly newTask?: () => void;
  readonly settings?: () => void;
  readonly refresh?: () => void;
  /** U-184 (3.14): whether the shown screen may give way to `to` (false: it asks first and stays). */
  readonly leaving?: (from: string, to: string) => boolean;
}

export class Shell {
  readonly filePanel = el("aside", undefined, { id: "files", tabindex: "-1" });
  private readonly work = el("main", undefined, { id: "work", tabindex: "-1" });
  private readonly nav = el("nav", undefined, { id: "screens" });
  private readonly statusEngine = el("span", undefined, { id: "status-engine" });
  private readonly statusWorkspace = el("span", undefined, { id: "status-workspace" });
  /** GU-3: the run that goes on (a button to its screen), hidden when there is none. */
  private readonly statusRun = el("button", undefined, { id: "status-run", type: "button", hidden: "" });
  private readonly announcer = el("p", undefined, { class: "visually-hidden", "aria-live": "polite", role: "status" });
  /** U-64 (3.12, 4.4): the card shown when the engine has ended, with its restart button. */
  private readonly engineCard = el("div", undefined, { id: "engine-ended", role: "alert", class: "error", hidden: "" });
  private readonly screens: Screen[] = [];
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private current: string | null = null;
  /** U-70: the file panel and the work area, with the separator between them. */
  private readonly body = el("div", undefined, { id: "body" });
  private readonly splitter = el("div", undefined, {
    id: "splitter",
    role: "separator",
    tabindex: "0",
    "aria-orientation": "vertical",
    "aria-controls": "files",
    "aria-valuemin": String(TREE_WIDTH_MIN),
    "aria-valuemax": String(TREE_WIDTH_MAX),
  });
  private width: number | null = null;
  /** U-69: the document's key listener, taken away when the frame is built again in another language. */
  private readonly keyListener = (event: KeyboardEvent): void => this.onKey(event);

  constructor(
    private readonly texts: Texts,
    private readonly handlers: ShellHandlers,
  ) {}

  mount(root: HTMLElement): void {
    const t = this.texts;
    this.nav.setAttribute("aria-label", t.format("nav.label"));
    this.filePanel.setAttribute("aria-label", t.format("region.files"));
    this.work.setAttribute("aria-label", t.format("region.main"));
    const header = el("header", undefined, { id: "top" });
    header.append(el("h1", t.format("app.title")), this.nav);
    const footer = el("footer", undefined, { id: "status", "aria-label": t.format("region.status") });
    footer.append(this.statusEngine, this.statusWorkspace, this.statusRun, el("span", t.format("status.language"), { lang: t.language }));
    this.statusRun.addEventListener("click", () => this.show("run"));
    this.splitter.setAttribute("aria-label", t.format("region.splitter"));
    this.splitter.addEventListener("keydown", (event) => this.onSplitterKey(event));
    this.listenToPointer();
    this.body.append(this.filePanel, this.splitter, this.work);
    root.replaceChildren(header, this.engineCard, this.body, footer, this.announcer);
    document.addEventListener("keydown", this.keyListener);
  }

  /** U-69: stops listening to the document's keys (the frame is being built again). */
  destroy(): void {
    document.removeEventListener?.("keydown", this.keyListener);
  }

  add(screen: Screen): void {
    this.screens.push(screen);
    const index = this.screens.length;
    const tab = button(this.texts.format(screen.title), () => this.show(screen.id), { "data-screen": screen.id, title: `Ctrl+${index}` });
    this.buttons.set(screen.id, tab);
    this.nav.append(tab);
  }

  show(id: string): void {
    const screen = this.screens.find((candidate) => candidate.id === id);
    if (screen === undefined) return;
    // U-184: a screen holding an unsaved edit asks before it is left or drawn again.
    if (this.current !== null && this.handlers.leaving?.(this.current, id) === false) return;
    this.current = id;
    for (const [screenId, tab] of this.buttons) {
      if (screenId === id) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    }
    this.work.setAttribute("data-screen", id);
    screen.show(this.work);
    this.handlers.shown?.(id);
  }

  /** U-70: the file panel's width in CSS pixels (clamped), or null for the layout's own. */
  setTreeWidth(width: number | null): void {
    this.width = width === null ? null : clampTreeWidth(width);
    this.body.style.setProperty("--tree-width", this.width === null ? "" : `${this.width}px`);
    if (this.width === null) this.splitter.removeAttribute("aria-valuenow");
    else this.splitter.setAttribute("aria-valuenow", String(this.width));
  }

  private currentWidth(): number {
    if (this.width !== null) return this.width;
    const measured = typeof this.filePanel.getBoundingClientRect === "function" ? this.filePanel.getBoundingClientRect().width : 0;
    return measured > 0 ? measured : TREE_WIDTH_DEFAULT;
  }

  private onSplitterKey(event: KeyboardEvent): void {
    const keys: Record<string, (width: number) => number> = {
      ArrowLeft: (width) => width - TREE_WIDTH_STEP,
      ArrowRight: (width) => width + TREE_WIDTH_STEP,
      Home: () => TREE_WIDTH_MIN,
      End: () => TREE_WIDTH_MAX,
    };
    const next = keys[event.key];
    if (next === undefined || event.ctrlKey || event.altKey || event.metaKey) return;
    event.preventDefault();
    this.setTreeWidth(next(this.currentWidth()));
    if (this.width !== null) this.handlers.treeWidth?.(this.width);
  }

  /** U-70: dragging the separator; the width is kept when the pointer lets go. */
  private listenToPointer(): void {
    let start: { readonly x: number; readonly width: number } | null = null;
    this.splitter.addEventListener("pointerdown", (event) => {
      start = { x: event.clientX, width: this.currentWidth() };
      try {
        this.splitter.setPointerCapture(event.pointerId);
      } catch {
        // A pointer the browser does not know (a test's) is followed without capture.
      }
    });
    this.splitter.addEventListener("pointermove", (event) => {
      if (start !== null) this.setTreeWidth(start.width + event.clientX - start.x);
    });
    const end = (): void => {
      if (start === null) return;
      start = null;
      if (this.width !== null) this.handlers.treeWidth?.(this.width);
    };
    this.splitter.addEventListener("pointerup", end);
    this.splitter.addEventListener("pointercancel", end);
  }

  /** Shows the current screen again (after the workspace changed). */
  refresh(): void {
    if (this.current !== null) this.show(this.current);
  }

  get currentScreen(): string | null {
    return this.current;
  }

  setEngine(code: string): void {
    this.statusEngine.textContent = code === "ready" ? this.texts.format("status.engineReady") : this.texts.format("status.engineError", { code });
    this.statusEngine.setAttribute("data-engine", code);
  }

  /**
   * U-64 (3.12, 4.4): the engine is not there (it ended, or did not start). Says that a run going on
   * has an unknown end (the run list tells it), and offers to start the engine again; `restart`
   * answers "ready" or a code. Nothing restarts on its own.
   */
  engineEnded(code: string, restart: () => Promise<string>): void {
    this.setEngine(code);
    const message = el("p", this.texts.format("engine.ended", { code }), { id: "engine-ended-text" });
    const again = button(this.texts.format("engine.restart"), () => {
      again.setAttribute("disabled", "");
      void (async () => {
        const result = await restart();
        if (result === "ready") {
          this.engineReady();
          return;
        }
        message.textContent = this.texts.format("engine.restartFailed", { code: result });
        this.engineCard.setAttribute("data-restart", result);
        again.removeAttribute("disabled");
      })();
    }, { id: "engine-restart" });
    this.engineCard.replaceChildren(message, again);
    this.engineCard.removeAttribute("hidden");
    this.engineCard.removeAttribute("data-restart");
  }

  /** U-64: the engine is ready (again): the card goes. */
  engineReady(): void {
    this.setEngine("ready");
    this.engineCard.setAttribute("hidden", "");
    this.engineCard.replaceChildren();
    this.refresh();
  }

  setWorkspace(name: string | null): void {
    this.statusWorkspace.textContent = name === null ? this.texts.format("status.noWorkspace") : this.texts.format("status.workspace", { name });
    document.title = name === null ? this.texts.format("app.title") : `${name} - ${this.texts.format("app.title")}`;
  }

  /** GU-3: the run's state word and counts in the status bar, or null to hide it. */
  setRun(text: string | null): void {
    if (text === null) {
      this.statusRun.setAttribute("hidden", "");
      this.statusRun.textContent = "";
      return;
    }
    this.statusRun.textContent = text;
    this.statusRun.removeAttribute("hidden");
  }

  /** Says a short fixed text to screen readers. */
  announce(text: string): void {
    this.announcer.textContent = text;
  }

  private onKey(event: KeyboardEvent): void {
    if (event.key === "F5" && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
      if (event.defaultPrevented) return;
      event.preventDefault();
      this.handlers.refresh?.();
      return;
    }
    if (event.ctrlKey && event.shiftKey && !event.altKey && (event.key === "P" || event.key === "p")) {
      event.preventDefault();
      this.handlers.palette?.();
      return;
    }
    if (event.key === "F6") {
      event.preventDefault();
      const regions: HTMLElement[] = [this.nav.querySelector("button") ?? this.nav, this.filePanel, this.work];
      const active = document.activeElement;
      const index = regions.findIndex((region) => region === active || (active !== null && region.contains(active)));
      const next = regions[(index + (event.shiftKey ? regions.length - 1 : 1)) % regions.length] as HTMLElement;
      const target = next === this.filePanel ? (this.filePanel.querySelector<HTMLElement>("[tabindex='0']") ?? next) : next;
      target.focus();
      return;
    }
    if (event.ctrlKey && !event.altKey && !event.shiftKey) {
      if (event.key === "o" || event.key === "O") {
        event.preventDefault();
        this.handlers.openWorkspace();
        return;
      }
      if ((event.key === "n" || event.key === "N") && this.handlers.newTask !== undefined) {
        event.preventDefault();
        this.handlers.newTask();
        return;
      }
      if (event.key === "," && this.handlers.settings !== undefined) {
        event.preventDefault();
        this.handlers.settings();
        return;
      }
      const number = Number(event.key);
      if (Number.isInteger(number) && number >= 1 && number <= this.screens.length) {
        event.preventDefault();
        this.show((this.screens[number - 1] as Screen).id);
      }
    }
  }
}
