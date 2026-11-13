/**
 * GU-2: the read-only file tree in the file panel (docs/design/standalone-gui.md 3.3, 10). It draws
 * TreeModel's rows as one ARIA tree with a roving tabindex, fetches folders page by page through
 * the preload, and offers "show in folder" for the focused entry. It opens and changes nothing.
 * U-103 (G-list): the entries come from the app layer's workspace list; a masked one has no id, so it
 * cannot be opened, shown in the folder or copied. "Copy relative path" copies the focused entry's
 * path through the main process, by its id.
 *
 * U-65 (3.3): marks. The files one run created or changed (tree-marks.ts) and the folders that hold
 * them; choosing a changed file opens that run's comparison at the file. Entries the effective
 * policy's protected paths cover (the app layer's list says which, U-89). F5 or the refresh button
 * reads the tree again, keeping the folders that were open; the window also does that when a run ends.
 */

import type { Texts } from "../i18n/catalog.js";
import { asCopy, asTree } from "../api.js";
import type { CodarynApi, Workspace } from "../api.js";
import { button, el } from "../shell/dom.js";
import { TreeModel, isExpandable, pathOf } from "./tree-model.js";
import type { TreeAction, TreeNode, TreeRow } from "./tree-model.js";
import { ChangeMarks } from "./tree-marks.js";
import type { ChangeMarkSource, MarkedRun } from "./tree-marks.js";

export interface TreeOptions {
  /** U-65: opens the run's changes view at the file (a changed file was chosen). */
  readonly openChange?: (run: MarkedRun, path: string) => void;
  /** U-174 (DR-72, 3.14): opens the text view of a file, by its id and its shown name. */
  readonly openText?: (node: string, name: string) => void;
}

export class TreeView {
  private model = new TreeModel();
  private workspace: Workspace | null = null;
  private generation = 0;
  private focusKey: string | null = null;
  private readonly list = el("ul", undefined, { role: "tree", class: "tree" });
  private readonly reveal: HTMLButtonElement;
  /** U-103 (3.3): copies the focused entry's relative path (by its id; the main process resolves it). */
  private readonly copyPath: HTMLButtonElement;
  private readonly copyStatus: HTMLElement;
  /** U-174 (3.14): opens the focused file in the text view (a file the app layer did not mask). */
  private readonly openButton: HTMLButtonElement;
  private readonly refreshButton: HTMLButtonElement;
  private readonly note: HTMLParagraphElement;
  private readonly marksNote = el("p", undefined, { id: "tree-marks", class: "tree-note", hidden: "" });
  private readonly marksText = el("span", undefined, { id: "tree-marks-text" });
  private readonly protectedNote: HTMLParagraphElement;
  private marks: ChangeMarks | null = null;
  /** U-65: on a refresh, the shown paths of the folders that were open, and of the focused row. */
  private reopen = new Set<string>();
  private refocus: string | null = null;

  constructor(
    private readonly texts: Texts,
    private readonly api: CodarynApi,
    private readonly panel: HTMLElement,
    private readonly options: TreeOptions = {},
  ) {
    this.reveal = button(texts.format("tree.reveal"), () => void this.revealFocused(), { id: "tree-reveal", disabled: "" });
    this.copyPath = button(texts.format("copy.path"), () => void this.copyFocused(), { id: "tree-copy-path", class: "copy", disabled: "" });
    this.copyStatus = el("span", undefined, { role: "status", class: "copy-status", id: "tree-copy-status" });
    this.openButton = button(texts.format("tree.open"), () => this.openFocused(), { id: "tree-open", disabled: "" });
    this.refreshButton = button(texts.format("tree.refresh"), () => this.refresh(), { id: "tree-refresh", disabled: "" });
    this.note = el("p", texts.format("tree.empty"), { class: "tree-note" });
    this.protectedNote = el("p", texts.format("tree.protectedNote"), { id: "tree-protected-note", class: "tree-note", hidden: "" });
    this.marksNote.append(this.marksText, button(texts.format("tree.marksClear"), () => this.clearMarks(), { id: "tree-marks-clear" }));
    this.list.setAttribute("aria-label", texts.format("tree.label"));
    this.list.addEventListener("keydown", (event) => this.onKey(event));
    // U-65: F5 anywhere in the file panel reads the tree again.
    panel.addEventListener("keydown", (event) => {
      if (event.key !== "F5" || event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
      event.preventDefault();
      this.refresh();
    });
    const head = el("div", undefined, { class: "panel-head" });
    head.append(el("h2", texts.format("region.files"), { id: "files-title" }), this.refreshButton, this.openButton, this.reveal, this.copyPath, this.copyStatus);
    panel.replaceChildren(head, this.note, this.marksNote, this.protectedNote, this.list);
  }

  /**
   * U-65: marks the files `run` created or changed (and the folders above them); an empty list
   * clears the marks. The marks stay over refreshes and go with the workspace.
   */
  markRun(run: MarkedRun, files: readonly ChangeMarkSource[]): void {
    const marks = new ChangeMarks(run, files);
    this.marks = marks.size === 0 ? null : marks;
    this.render();
  }

  clearMarks(): void {
    this.marks = null;
    this.render();
  }

  /** U-65: the run the marks are of, or null. */
  markedRun(): MarkedRun | null {
    return this.marks?.run ?? null;
  }

  /** U-65 (F5, the end of a run): reads the open workspace's tree again; open folders stay open. */
  refresh(): void {
    const workspace = this.workspace;
    if (workspace === null) return;
    const open = new Set<string>();
    const walk = (node: TreeNode): void => {
      for (const child of node.children) {
        if (!child.expanded) continue;
        const path = pathOf(child);
        if (path !== null) open.add(path);
        walk(child);
      }
    };
    walk(this.model.root);
    const focused = this.focusedNode();
    this.load(workspace);
    this.reopen = open;
    this.refocus = focused === null ? null : pathOf(focused);
  }

  /** Shows a workspace's top level, or nothing. Answers for an earlier workspace are dropped. */
  setWorkspace(workspace: Workspace | null): void {
    this.marks = null;
    this.note.textContent = workspace === null ? this.texts.format("tree.empty") : this.texts.format("tree.readOnly");
    this.load(workspace);
  }

  private load(workspace: Workspace | null): void {
    this.generation += 1;
    this.workspace = workspace;
    this.model = new TreeModel();
    this.focusKey = null;
    this.reopen = new Set();
    this.refocus = null;
    this.list.removeAttribute("data-tree-ready");
    if (workspace === null) this.refreshButton.setAttribute("disabled", "");
    else this.refreshButton.removeAttribute("disabled");
    this.render();
    if (workspace !== null) void this.run(this.model.beginLoad(this.model.root, 0));
  }

  private async run(action: TreeAction): Promise<void> {
    if (action === null || this.workspace === null) return;
    const generation = this.generation;
    const { node, offset } = action;
    this.render();
    const reply = asTree(await this.api.tree(this.workspace.handle, node === this.model.root ? null : node.id, offset));
    if (generation !== this.generation) return;
    const before = node.children.length;
    if (reply.ok) this.model.applyPage(node, reply);
    else this.model.applyError(node, reply.code);
    if (node === this.model.root) this.list.setAttribute("data-tree-ready", reply.ok ? "ok" : "error");
    // U-65: after a refresh, the folders that were open open again, and the focused row is found again.
    const again: TreeAction[] = [];
    for (const child of node.children.slice(before)) {
      const path = pathOf(child);
      if (path === null) continue;
      if (path === this.refocus) {
        this.focusKey = child.key;
        this.refocus = null;
      }
      if (isExpandable(child) && this.reopen.delete(path)) again.push(this.model.expand(child));
    }
    this.render();
    for (const action of again) void this.run(action);
  }

  private label(node: TreeNode): string {
    const t = this.texts;
    if (node.kind === "state") return `${node.name} — ${t.format("tree.state")}`;
    const name = node.name === "" ? t.format("tree.unshowable") : node.name;
    if (node.masked && node.name !== "") return `${name} — ${t.format("tree.masked")}`;
    if (node.kind === "link") return `${name} — ${t.format("tree.link")}`;
    if (node.kind === "other") return `${name} — ${t.format("tree.other")}`;
    return name;
  }

  /** U-65: a node's marks, as words: what the marked run did to it, and whether it is protected. */
  private markWords(node: TreeNode): { readonly words: string[]; readonly change: string | null; readonly holds: boolean } {
    const t = this.texts;
    const words: string[] = [];
    const path = this.marks === null ? null : pathOf(node);
    const mark = path === null || this.marks === null || node.kind !== "file" ? null : this.marks.file(path);
    const holds = path !== null && this.marks !== null && node.kind === "dir" && this.marks.holds(path);
    if (mark !== null) {
      words.push(t.format(mark.created ? "tree.mark.created" : "tree.mark.changed"));
      if (mark.state === "changed_since_run") words.push(t.format("tree.mark.changedSince"));
    }
    if (holds) words.push(t.format("tree.mark.holds"));
    if (node.protected) words.push(t.format("tree.mark.protected"));
    return { words, change: mark === null ? null : mark.created ? "created" : "changed", holds };
  }

  private rowElement(row: TreeRow): HTMLLIElement {
    const t = this.texts;
    if (row.type === "status") {
      const text =
        row.status === "loading" ? t.format("tree.loading") : row.status === "empty" ? t.format("tree.emptyFolder") : t.format("tree.error", { code: row.code ?? "?" });
      const item = el("li", text, { role: "treeitem", "aria-disabled": "true", class: `tree-status ${row.status}`, "aria-level": String(row.parent.depth + 2) });
      return item;
    }
    if (row.type === "more") {
      const item = el("li", t.format("tree.more", { count: row.remaining }), { role: "treeitem", class: "tree-more", "data-key": row.key, "aria-level": String(row.parent.depth + 2) });
      item.addEventListener("click", () => this.activate(row.key));
      return item;
    }
    const node = row.node;
    const item = el("li", undefined, {
      role: "treeitem",
      "data-key": row.key,
      "data-kind": node.kind,
      "data-masked": String(node.masked),
      "aria-level": String(node.depth + 1),
      "aria-setsize": String(row.setSize),
      "aria-posinset": String(row.position),
    });
    item.style.setProperty("--depth", String(node.depth));
    if (isExpandable(node)) item.setAttribute("aria-expanded", String(node.expanded));
    const marker = isExpandable(node) ? (node.expanded ? "▾" : "▸") : "";
    item.append(el("span", marker, { class: "marker", "aria-hidden": "true" }), el("span", this.label(node), { class: "name" }));
    const marks = this.markWords(node);
    if (marks.change !== null) item.setAttribute("data-change", marks.change);
    if (marks.holds) item.setAttribute("data-holds-changes", "true");
    if (node.protected) item.setAttribute("data-protected", "true");
    if (marks.words.length > 0) item.append(el("span", ` (${marks.words.join(", ")})`, { class: "tree-marks" }));
    item.addEventListener("click", () => this.activate(row.key));
    return item;
  }

  private render(): void {
    const rows = this.model.rows();
    const focusable = rows.filter((row) => row.type !== "status");
    if (this.focusKey === null || !focusable.some((row) => row.key === this.focusKey)) this.focusKey = focusable[0]?.key ?? null;
    const hadFocus = this.list.contains(document.activeElement);
    const items = rows.map((row) => {
      const item = this.rowElement(row);
      if (row.type !== "status") item.tabIndex = row.key === this.focusKey ? 0 : -1;
      return item;
    });
    this.list.replaceChildren(...items);
    const focused = this.focusedNode();
    const entry = focused !== null && focused.id !== null && (focused.kind === "file" || focused.kind === "dir");
    for (const control of [this.reveal, this.copyPath]) {
      if (entry) control.removeAttribute("disabled");
      else control.setAttribute("disabled", "");
    }
    // U-174: Open is for a file with an id (a masked entry has none), when the window can show it.
    if (focused !== null && focused.id !== null && focused.kind === "file" && this.options.openText !== undefined) this.openButton.removeAttribute("disabled");
    else this.openButton.setAttribute("disabled", "");
    if (this.marks === null) this.marksNote.setAttribute("hidden", "");
    else {
      this.marksText.textContent = `${this.texts.format("tree.marksOf", { runId: this.marks.run.runId, count: String(this.marks.size) })} `;
      this.marksNote.removeAttribute("hidden");
    }
    if (rows.some((row) => row.type === "node" && row.node.protected)) this.protectedNote.removeAttribute("hidden");
    else this.protectedNote.setAttribute("hidden", "");
    if (hadFocus) this.focusRow();
  }

  private focusRow(): void {
    if (this.focusKey === null) return;
    for (const item of this.list.querySelectorAll<HTMLElement>("[data-key]")) {
      if (item.getAttribute("data-key") === this.focusKey) {
        item.focus();
        return;
      }
    }
  }

  private focusedNode(): TreeNode | null {
    return this.focusKey === null ? null : this.model.find(this.focusKey);
  }

  private activate(key: string): void {
    this.focusKey = key;
    const result = this.model.navigate(key, "Enter");
    this.render();
    this.focusRow();
    if (result !== null) void this.run(result.action);
    this.openIfChanged(this.model.find(key));
  }

  /** U-65: a changed file of the marked run was chosen: its comparison opens. */
  private openIfChanged(node: TreeNode | null): void {
    if (node === null || node.kind !== "file" || this.marks === null || this.options.openChange === undefined) return;
    const path = pathOf(node);
    if (path !== null && this.marks.file(path) !== null) this.options.openChange(this.marks.run, path);
  }

  private onKey(event: KeyboardEvent): void {
    if (this.focusKey === null) return;
    // U-67 (10): a letter or digit moves to the next entry whose name starts with it.
    if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.altKey && !event.metaKey) {
      const key = this.model.jump(this.focusKey, event.key);
      if (key === null) return;
      event.preventDefault();
      this.focusKey = key;
      this.render();
      this.focusRow();
      return;
    }
    const result = this.model.navigate(this.focusKey, event.key);
    if (result === null) return;
    event.preventDefault();
    this.focusKey = result.focus;
    this.render();
    this.focusRow();
    void this.run(result.action);
    if (event.key === "Enter") this.openIfChanged(this.focusedNode());
  }

  private async copyFocused(): Promise<void> {
    const node = this.focusedNode();
    if (this.workspace === null || node === null || node.id === null) return;
    const reply = asCopy(await this.api.copyPath(this.workspace.handle, node.id));
    this.copyStatus.textContent = reply.ok ? this.texts.format("copy.done") : this.texts.format("copy.failed", { code: reply.code });
    this.copyStatus.setAttribute("data-copied", reply.ok ? "ok" : reply.code);
  }

  /** U-174: the focused file in the text view, by its id; its name as the tree shows it. */
  private openFocused(): void {
    const node = this.focusedNode();
    if (node === null || node.id === null || node.kind !== "file") return;
    this.options.openText?.(node.id, node.name);
  }

  private async revealFocused(): Promise<void> {
    const node = this.focusedNode();
    if (this.workspace === null || node === null || node.id === null) return;
    await this.api.reveal(this.workspace.handle, node.id);
  }
}
