/**
 * GU-2: the read-only file tree's state (docs/design/standalone-gui.md 3.3). Pure: no DOM, so unit
 * tests run it under Node. The view (tree-view.ts) draws `rows()` and passes keys to `navigate`.
 *
 * Keyboard (WAI-ARIA tree pattern): Up and Down move between visible rows, Right opens a folder or
 * moves into it, Left closes it or moves to its parent, Home and End go to the first and last row,
 * Enter and Space open or close a folder or load the next page.
 */

import type { TreeEntryView, TreeKind } from "../../shared/ipc.js";

export interface TreeNode {
  readonly key: string;
  /** The main process's id; null for entries that cannot be opened (masked, link, state, other). */
  readonly id: string | null;
  readonly name: string;
  readonly kind: TreeKind;
  readonly masked: boolean;
  readonly depth: number;
  readonly parent: TreeNode | null;
  expanded: boolean;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  children: TreeNode[];
  total: number;
  nextOffset: number | null;
}

export type TreeRow =
  | { readonly type: "node"; readonly key: string; readonly node: TreeNode; readonly position: number; readonly setSize: number }
  | { readonly type: "more"; readonly key: string; readonly parent: TreeNode; readonly remaining: number }
  | { readonly type: "status"; readonly key: string; readonly parent: TreeNode; readonly status: "loading" | "empty" | "error"; readonly code: string | null };

export interface TreePage {
  readonly entries: readonly TreeEntryView[];
  readonly total: number;
  readonly offset: number;
  readonly nextOffset: number | null;
}

export type TreeAction = { readonly type: "load"; readonly node: TreeNode; readonly offset: number } | null;

export function isExpandable(node: TreeNode): boolean {
  return node.kind === "dir" && node.id !== null;
}

function makeNode(entry: TreeEntryView, parent: TreeNode, index: number): TreeNode {
  return {
    key: entry.id ?? `${parent.key}/#${index}`,
    id: entry.id,
    name: entry.name,
    kind: entry.kind,
    masked: entry.masked,
    depth: parent.depth + 1,
    parent,
    expanded: false,
    loading: false,
    loaded: false,
    error: null,
    children: [],
    total: 0,
    nextOffset: null,
  };
}

export class TreeModel {
  /** The workspace root: never shown as a row; its children are the top level. */
  readonly root: TreeNode = {
    key: "root",
    id: null,
    name: "",
    kind: "dir",
    masked: false,
    depth: -1,
    parent: null,
    expanded: true,
    loading: false,
    loaded: false,
    error: null,
    children: [],
    total: 0,
    nextOffset: null,
  };

  /** Starts loading `node` (the root or a folder) from `offset`; the caller fetches the page. */
  beginLoad(node: TreeNode, offset: number): TreeAction {
    node.loading = true;
    node.error = null;
    return { type: "load", node, offset };
  }

  /** Adds a fetched page under `node`. A page for an offset already passed is ignored. */
  applyPage(node: TreeNode, page: TreePage): void {
    node.loading = false;
    if (page.offset !== node.children.length) return;
    page.entries.forEach((entry, index) => node.children.push(makeNode(entry, node, page.offset + index)));
    node.total = page.total;
    node.nextOffset = page.nextOffset;
    node.loaded = true;
  }

  applyError(node: TreeNode, code: string): void {
    node.loading = false;
    node.error = code;
  }

  /** The rows to draw, in order. */
  rows(): TreeRow[] {
    const out: TreeRow[] = [];
    const walk = (node: TreeNode): void => {
      if (node.loading && node.children.length === 0) {
        out.push({ type: "status", key: `${node.key}:loading`, parent: node, status: "loading", code: null });
        return;
      }
      if (node.error !== null) out.push({ type: "status", key: `${node.key}:error`, parent: node, status: "error", code: node.error });
      if (node.loaded && node.children.length === 0 && node.error === null && node !== this.root) {
        out.push({ type: "status", key: `${node.key}:empty`, parent: node, status: "empty", code: null });
      }
      node.children.forEach((child, index) => {
        out.push({ type: "node", key: child.key, node: child, position: index + 1, setSize: Math.max(child.parent?.total ?? 0, node.children.length) });
        if (child.expanded) walk(child);
      });
      if (node.nextOffset !== null) {
        out.push({ type: "more", key: `${node.key}:more`, parent: node, remaining: Math.max(node.total - node.children.length, 0) });
      }
    };
    walk(this.root);
    return out;
  }

  find(key: string): TreeNode | null {
    const search = (node: TreeNode): TreeNode | null => {
      if (node.key === key) return node;
      for (const child of node.children) {
        const found = search(child);
        if (found !== null) return found;
      }
      return null;
    };
    return search(this.root);
  }

  /** Opens a folder; loads its first page if it was never loaded. */
  expand(node: TreeNode): TreeAction {
    if (!isExpandable(node) || node.expanded) return null;
    node.expanded = true;
    return node.loaded || node.loading ? null : this.beginLoad(node, 0);
  }

  collapse(node: TreeNode): void {
    node.expanded = false;
  }

  /**
   * Handles a key on the row `focusKey`. Returns the row to focus next and what to fetch, if anything.
   * Unknown keys return null (the view leaves them alone).
   */
  navigate(focusKey: string, key: string): { readonly focus: string; readonly action: TreeAction } | null {
    const rows = this.rows().filter((row) => row.type !== "status");
    const index = rows.findIndex((row) => row.key === focusKey);
    if (index < 0) return rows.length > 0 ? { focus: (rows[0] as TreeRow).key, action: null } : null;
    const row = rows[index] as TreeRow;
    const at = (i: number): string => (rows[Math.max(0, Math.min(rows.length - 1, i))] as TreeRow).key;
    switch (key) {
      case "ArrowDown":
        return { focus: at(index + 1), action: null };
      case "ArrowUp":
        return { focus: at(index - 1), action: null };
      case "Home":
        return { focus: at(0), action: null };
      case "End":
        return { focus: at(rows.length - 1), action: null };
      case "ArrowRight": {
        if (row.type !== "node" || !isExpandable(row.node)) return { focus: focusKey, action: null };
        if (!row.node.expanded) return { focus: focusKey, action: this.expand(row.node) };
        const first = row.node.children[0];
        return { focus: first?.key ?? focusKey, action: null };
      }
      case "ArrowLeft": {
        if (row.type === "node" && row.node.expanded) {
          this.collapse(row.node);
          return { focus: focusKey, action: null };
        }
        const parent = row.type === "node" ? row.node.parent : row.parent;
        return { focus: parent !== null && parent !== this.root ? parent.key : focusKey, action: null };
      }
      case "Enter":
      case " ": {
        if (row.type === "more") return { focus: focusKey, action: row.parent.loading ? null : this.beginLoad(row.parent, row.parent.children.length) };
        if (row.type === "node" && isExpandable(row.node)) {
          if (row.node.expanded) {
            this.collapse(row.node);
            return { focus: focusKey, action: null };
          }
          return { focus: focusKey, action: this.expand(row.node) };
        }
        return { focus: focusKey, action: null };
      }
      default:
        return null;
    }
  }
}
