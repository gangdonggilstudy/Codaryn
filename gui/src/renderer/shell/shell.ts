/**
 * GU-2: the window frame (docs/design/standalone-gui.md 3.1): a header with the screen buttons, the
 * file panel, the work area and the status bar. Screens register here; one is shown at a time.
 * Keys: F6 moves between the regions, Ctrl+O opens a workspace, Ctrl+1 and Ctrl+2 switch screens.
 */

import type { Texts, TextId } from "../i18n/catalog.js";
import { button, el } from "./dom.js";

export interface Screen {
  readonly id: string;
  readonly title: TextId;
  /** Builds the screen's content into `root` each time it is shown. */
  show(root: HTMLElement): void;
}

export interface ShellHandlers {
  readonly openWorkspace: () => void;
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
  private readonly screens: Screen[] = [];
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private current: string | null = null;

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
    const body = el("div", undefined, { id: "body" });
    body.append(this.filePanel, this.work);
    root.replaceChildren(header, body, footer, this.announcer);
    document.addEventListener("keydown", (event) => this.onKey(event));
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
    this.current = id;
    for (const [screenId, tab] of this.buttons) {
      if (screenId === id) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    }
    this.work.setAttribute("data-screen", id);
    screen.show(this.work);
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
      const number = Number(event.key);
      if (Number.isInteger(number) && number >= 1 && number <= this.screens.length) {
        event.preventDefault();
        this.show((this.screens[number - 1] as Screen).id);
      }
    }
  }
}
