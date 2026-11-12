/**
 * The window (GU-1): open a workspace and show the engine's checks (`doctor`). Untrusted text is
 * put in with `textContent` only (docs/design/standalone-gui.md 6.2); no HTML is ever parsed from
 * a value. The page talks to `window.codaryn` (the preload) and to nothing else.
 */

import type { DoctorReply, InfoView, OpenFolderReply } from "../shared/ipc.js";
import { textsFor } from "./texts.js";
import type { GuiTexts, Language } from "./texts.js";

interface CodarynApi {
  info(): Promise<unknown>;
  openFolder(): Promise<unknown>;
  doctor(workspace: string | null): Promise<unknown>;
}

declare global {
  interface Window {
    readonly codaryn: CodarynApi;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

function asInfo(value: unknown): InfoView {
  const info = value as Partial<InfoView> | null;
  const language: Language = info?.language === "ko" ? "ko" : "en";
  return { language, engine: typeof info?.engine === "string" ? info.engine : "host_error" };
}

function asReply(value: unknown): DoctorReply {
  const reply = value as DoctorReply | null;
  if (reply === null || typeof reply !== "object") return { ok: false, code: "host_error" };
  return reply;
}

function asFolder(value: unknown): OpenFolderReply {
  const folder = value as { handle?: unknown; name?: unknown } | null;
  if (folder === null || typeof folder !== "object") return null;
  return typeof folder.handle === "string" && typeof folder.name === "string" ? { handle: folder.handle, name: folder.name } : null;
}

class View {
  private workspace: { handle: string; name: string } | null = null;
  private readonly workspaceLine = el("p", undefined, { id: "workspace" });
  private readonly results = el("section", undefined, { "aria-labelledby": "checks-title" });
  private readonly announce = el("p", undefined, { class: "visually-hidden", "aria-live": "polite", role: "status" });

  constructor(
    private readonly texts: GuiTexts,
    private readonly api: CodarynApi,
  ) {}

  mount(root: HTMLElement): void {
    const header = el("header");
    header.append(el("h1", this.texts.appTitle));
    const open = el("button", this.texts.openWorkspace, { type: "button", id: "open-workspace" });
    open.addEventListener("click", () => void this.openWorkspace());
    header.append(open, this.workspaceLine);
    const main = el("main", undefined, { id: "main" });
    main.append(el("h2", this.texts.checksTitle, { id: "checks-title" }), this.results);
    root.replaceChildren(header, main, this.announce);
    this.showWorkspace();
  }

  private showWorkspace(): void {
    this.workspaceLine.textContent =
      this.workspace === null ? this.texts.workspaceNone : `${this.texts.workspaceLabel}: ${this.workspace.name}`;
  }

  private async openWorkspace(): Promise<void> {
    const folder = asFolder(await this.api.openFolder());
    if (folder === null) return;
    this.workspace = folder;
    this.showWorkspace();
    await this.check();
  }

  showError(code: string): void {
    const box = el("div", undefined, { role: "alert", class: "error", "data-error": code });
    box.append(el("h3", this.texts.errorTitle), el("p", this.texts.errors[code] ?? this.texts.errorDefault), el("p", `(${code})`, { class: "code", lang: "en" }));
    this.results.replaceChildren(box);
    this.results.setAttribute("data-doctor-ready", "error");
    this.announce.textContent = this.texts.errorTitle;
  }

  async check(): Promise<void> {
    this.results.removeAttribute("data-doctor-ready");
    this.results.replaceChildren(el("p", this.texts.checking));
    const reply = asReply(await this.api.doctor(this.workspace?.handle ?? null));
    if (!reply.ok) {
      this.showError(typeof reply.code === "string" ? reply.code : "host_error");
      return;
    }
    const word = (status: string): string => reply.labels[`doctor.status.${status}`] ?? this.texts.statusFallback[status] ?? status;
    const overall = el("p", `${this.texts.overall}: ${word(reply.view.status)}`, { class: "overall", "data-status": reply.view.status });
    const list = el("ul", undefined, { class: "checks" });
    for (const check of reply.view.checks) {
      const item = el("li", undefined, { "data-status": check.status, "data-check": check.id });
      item.append(
        el("span", word(check.status), { class: "status" }),
        el("span", reply.labels[`doctor.check.${check.id}`] ?? check.id, { class: "label" }),
        el("span", check.message, { class: "detail", lang: "en", title: this.texts.detailInEnglish }),
      );
      list.append(item);
    }
    this.results.replaceChildren(overall, list);
    this.results.setAttribute("data-doctor-ready", "ok");
    this.announce.textContent = overall.textContent ?? "";
  }
}

async function start(): Promise<void> {
  const root = document.getElementById("app");
  if (root === null) return;
  const info = asInfo(await window.codaryn.info());
  document.documentElement.lang = info.language;
  const texts = textsFor(info.language);
  document.title = texts.appTitle;
  const view = new View(texts, window.codaryn);
  view.mount(root);
  if (info.engine !== "ready") {
    view.showError(info.engine);
    return;
  }
  await view.check();
}

void start();
