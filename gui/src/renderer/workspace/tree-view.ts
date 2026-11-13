/**
 * GU-2: the read-only file tree in the file panel (docs/design/standalone-gui.md 3.3, 10). It draws
 * TreeModel's rows as one ARIA tree with a roving tabindex, fetches folders page by page through
 * the preload, and offers "show in folder" for the focused entry. It opens and changes nothing.
 */

import type { Texts } from "../i18n/catalog.js";
import { asTree } from "../api.js";
import type { CodarynApi, Workspace } from "../api.js";
import { button, el } from "../shell/dom.js";
import { TreeModel, isExpandable } from "./tree-model.js";
import type { TreeAction, TreeNode, TreeRow } from "./tree-model.js";

export class TreeView {
  private model = new TreeModel();
  private workspace: Workspace | null = null;
  private generation = 0;
  private focusKey: string | null = null;
  private readonly list = el("ul", undefined, { role: "tree", class: "tree" });
  private readonly reveal: HTMLButtonElement;
  private readonly note: HTMLParagraphElement;

  constructor(
    private readonly texts: Texts,
    private readonly api: CodarynApi,
    private readonly panel: HTMLElement,
  ) {
    this.reveal = button(texts.format("tree.reveal"), () => void this.revealFocused(), { id: "tree-reveal", disabled: "" });
    this.note = el("p", texts.format("tree.empty"), { class: "tree-note" });
    this.list.setAttribute("aria-label", texts.format("tree.label"));
    this.list.addEventListener("keydown", (event) => this.onKey(event));
    const head = el("div", undefined, { class: "panel-head" });
    head.append(el("h2", texts.format("region.files"), { id: "files-title" }), this.reveal);
    panel.replaceChildren(head, this.note, this.list);
  }

  /** Shows a workspace's top level, or nothing. Answers for an earlier workspace are dropped. */
  setWorkspace(workspace: Workspace | null): void {
    this.generation += 1;
    this.workspace = workspace;
    this.model = new TreeModel();
    this.focusKey = null;
    this.note.textContent = workspace === null ? this.texts.format("tree.empty") : this.texts.format("tree.readOnly");
    this.list.removeAttribute("data-tree-ready");
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
    if (reply.ok) this.model.applyPage(node, reply);
    else this.model.applyError(node, reply.code);
    if (node === this.model.root) this.list.setAttribute("data-tree-ready", reply.ok ? "ok" : "error");
    this.render();
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
    if (focused !== null && focused.id !== null && (focused.kind === "file" || focused.kind === "dir")) this.reveal.removeAttribute("disabled");
    else this.reveal.setAttribute("disabled", "");
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
  }

  private onKey(event: KeyboardEvent): void {
    if (this.focusKey === null) return;
    const result = this.model.navigate(this.focusKey, event.key);
    if (result === null) return;
    event.preventDefault();
    this.focusKey = result.focus;
    this.render();
    this.focusRow();
    void this.run(result.action);
  }

  private async revealFocused(): Promise<void> {
    const node = this.focusedNode();
    if (this.workspace === null || node === null || node.id === null) return;
    await this.api.reveal(this.workspace.handle, node.id);
  }
}
