/**
 * What the page may call (the preload's `window.codaryn`) and checks on what comes back. The page
 * trusts nothing it receives: every reply is checked before use, and text goes in as textContent.
 * Types only come from src/shared (erased at build time); the page loads nothing outside its own
 * directory.
 */

import type { DoctorReply, InfoView, OpenReply, RecentView, TreeEntryView, TreeReply } from "../shared/ipc.js";

export interface CodarynApi {
  info(): Promise<unknown>;
  openFolder(): Promise<unknown>;
  recent(): Promise<unknown>;
  openRecent(id: string): Promise<unknown>;
  forgetRecent(id: string): Promise<unknown>;
  tree(workspace: string, node: string | null, offset: number): Promise<unknown>;
  reveal(workspace: string, node: string): Promise<unknown>;
  doctor(workspace: string | null): Promise<unknown>;
  onWorkspaceOpened(listener: (payload: unknown) => void): void;
}

declare global {
  interface Window {
    readonly codaryn: CodarynApi;
  }
}

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): value is string => typeof value === "string";
const HEX = /^[0-9a-f]{32}$/;
const KINDS = ["dir", "file", "link", "state", "other"];

export interface Workspace {
  readonly handle: string;
  readonly name: string;
}

export function asWorkspace(value: unknown): Workspace | null {
  if (!isObj(value) || !str(value["handle"]) || !HEX.test(value["handle"]) || !str(value["name"])) return null;
  return { handle: value["handle"], name: value["name"] };
}

export function asInfo(value: unknown): InfoView {
  const info = isObj(value) ? value : {};
  return {
    language: info["language"] === "ko" ? "ko" : "en",
    engine: str(info["engine"]) ? info["engine"] : "host_error",
    initialWorkspace: asWorkspace(info["initialWorkspace"]),
  };
}

export function asOpen(value: unknown): OpenReply {
  if (isObj(value) && value["ok"] === true) {
    const workspace = asWorkspace(value);
    if (workspace !== null) return { ok: true, ...workspace };
  }
  return { ok: false, code: isObj(value) && str(value["code"]) ? value["code"] : "host_error" };
}

export function asRecent(value: unknown): RecentView[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): RecentView[] =>
    isObj(item) && str(item["id"]) && HEX.test(item["id"]) && str(item["name"]) && str(item["path"]) && typeof item["exists"] === "boolean"
      ? [{ id: item["id"], name: item["name"], path: item["path"], exists: item["exists"] }]
      : [],
  );
}

export function asTree(value: unknown): TreeReply {
  if (!isObj(value)) return { ok: false, code: "host_error" };
  if (value["ok"] !== true) return { ok: false, code: str(value["code"]) ? value["code"] : "host_error" };
  const { entries, total, offset, nextOffset } = value;
  const count = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
  if (!Array.isArray(entries) || !count(total) || !count(offset) || !(nextOffset === null || count(nextOffset))) return { ok: false, code: "host_error" };
  const views: TreeEntryView[] = [];
  for (const entry of entries) {
    if (!isObj(entry) || !str(entry["name"]) || !str(entry["kind"]) || !KINDS.includes(entry["kind"]) || typeof entry["masked"] !== "boolean") {
      return { ok: false, code: "host_error" };
    }
    const id = entry["id"];
    views.push({ id: str(id) && HEX.test(id) ? id : null, name: entry["name"], kind: entry["kind"] as TreeEntryView["kind"], masked: entry["masked"] });
  }
  return { ok: true, entries: views, total, offset, nextOffset };
}

export function asDoctor(value: unknown): DoctorReply {
  if (!isObj(value)) return { ok: false, code: "host_error" };
  if (value["ok"] !== true) return { ok: false, code: str(value["code"]) ? value["code"] : "host_error" };
  return value as unknown as DoctorReply;
}
