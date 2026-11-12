/**
 * File inventory of an apply run (VF-05, DR-6, G-D). See InventoryChecker in src/contracts/verify.ts.
 *
 * - capture: every file and link under the workspace root, the state directory at the root left
 *   out, as `/` separated relative paths with sizes. Links are listed, never followed (a link's
 *   size is the length of its stored target in UTF-8 bytes). No content is read. A path that cannot
 *   be listed or measured becomes `unchecked`. The listing stops at `maxFiles` entries
 *   (MAX_INVENTORY_FILES) with `limitReached`, independent of the integrity limits.
 * - check: the expected listing is `before` with the applied actions done (a move takes the
 *   source's size to the destination, a discard removes the path). `after` must equal it path by
 *   path in kind and size. Only the plan targets are hashed: each moved file at its new path, each
 *   discarded file in `discardedRoot`, against the plan's SHA-256. A target is read only when it is
 *   a regular file (not a link) at a path that stays inside its root.
 *   Outcome: a difference is `fail`; otherwise an `unchecked` path, a target that cannot be read or
 *   a listing that reached its limit is `inconclusive` (a reached limit decides alone: the listings
 *   are incomplete, so no difference is claimed); otherwise `pass`.
 *
 * Paths are local text: the result's evidence names them raw and the engine masks it.
 * Windows compares paths without case, as the file system does.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { INVENTORY_VERIFIER_ID, MAX_INVENTORY_FILES, STATE_DIR_NAME, asRawText } from "../contracts/index.js";
import type {
  AppliedPlanAction,
  ContentHash,
  InventoryCheckInput,
  InventoryChecker,
  InventoryEntry,
  InventoryManifest,
  RawVerifierResult,
  VerifierOutcome,
} from "../contracts/index.js";
import { createRawVerifierResult } from "./result.js";

/** What the checker needs from `lstat`. */
export interface InventoryStat {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  readonly size: number;
}

/** The file access the checker uses. Tests inject failures here. */
export interface InventoryFileSystem {
  /** Does not follow a link in the last segment. */
  lstat(target: string): Promise<InventoryStat>;
  /** Names of the entries of a directory. */
  readdir(dir: string): Promise<string[]>;
  /** The target text a link stores. */
  readlink(link: string): Promise<string>;
  /** SHA-256 of the file's bytes. */
  hashFile(file: string): Promise<ContentHash>;
}

async function hashFile(file: string): Promise<ContentHash> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file) as AsyncIterable<Buffer>) hash.update(chunk);
  return hash.digest("hex");
}

export const nodeInventoryFileSystem: InventoryFileSystem = {
  lstat: (target) => fs.lstat(target),
  readdir: (dir) => fs.readdir(dir),
  readlink: (link) => fs.readlink(link),
  hashFile,
};

export interface InventoryLimits {
  /** Most entries (files, links, unchecked paths) one capture lists. */
  readonly maxFiles: number;
}

export const DEFAULT_INVENTORY_LIMITS: InventoryLimits = { maxFiles: MAX_INVENTORY_FILES };

export interface InventoryCheckerOptions {
  /** Real absolute path of the workspace root. */
  readonly workspaceRoot: string;
  /** Defaults to `process.platform`. Windows compares paths without case. */
  readonly platform?: NodeJS.Platform;
}

/** Paths listed per difference in the evidence; the rest are counted. */
export const MAX_LISTED_PATHS = 20;

export const INVENTORY_CHECKED: readonly string[] = [
  "every file and link outside the state directory has the kind and size it had before the apply, with exactly the applied moves and discards done, and nothing added or removed",
  "each moved file has the plan's SHA-256 at its new path",
  "each discarded file has the plan's SHA-256 in the apply run's discarded directory",
];

export const INVENTORY_LIMITS: readonly string[] = [
  "only the plan targets are hashed: a file outside the plan whose content changed but kept its size is not detected",
  "directories are not listed: an empty directory that was created or removed is not detected",
  "links are compared by the length of their stored target, not followed",
];

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const HASH = /^[0-9a-f]{64}$/;

/**
 * A `/` separated relative path as path segments, or null when it is not one that stays inside its
 * root: empty, absolute, a drive or device form, `.` or `..` segments, backslashes or NUL.
 */
function safeSegments(relative: unknown): string[] | null {
  if (typeof relative !== "string" || relative.length === 0 || relative.length > 4096) return null;
  if (relative.includes("\\") || relative.includes("\0") || relative.startsWith("/") || /^[A-Za-z]:/.test(relative)) return null;
  const segments = relative.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  return segments;
}

export function buildInventoryChecker(
  options: InventoryCheckerOptions,
  limits: InventoryLimits = DEFAULT_INVENTORY_LIMITS,
  files: InventoryFileSystem = nodeInventoryFileSystem,
): InventoryChecker {
  const root = options.workspaceRoot;
  const windows = (options.platform ?? process.platform) === "win32";
  const fold = (text: string): string => (windows ? text.toLowerCase() : text);
  const stateName = fold(STATE_DIR_NAME);

  async function capture(): Promise<InventoryManifest> {
    const entries: InventoryEntry[] = [];
    let limitReached = false;
    const add = (entry: InventoryEntry): boolean => {
      if (entries.length >= limits.maxFiles) {
        limitReached = true;
        return false;
      }
      entries.push(entry);
      return true;
    };
    const unchecked = (display: string): InventoryEntry => ({ path: asRawText(display), kind: "unchecked" });

    /** Directories still to list: absolute path and display path ("" for the root). */
    const queue: [string, string][] = [[root, ""]];
    outer: while (queue.length > 0) {
      const [dir, display] = queue.pop() as [string, string];
      let names: string[];
      try {
        names = await files.readdir(dir);
      } catch {
        if (!add(unchecked(display === "" ? "." : display))) break;
        continue;
      }
      for (const name of names) {
        if (display === "" && fold(name) === stateName) continue;
        const child = path.join(dir, name);
        const childDisplay = display === "" ? name : `${display}/${name}`;
        let info: InventoryStat;
        try {
          info = await files.lstat(child);
        } catch {
          if (!add(unchecked(childDisplay))) break outer;
          continue;
        }
        if (info.isDirectory() && !info.isSymbolicLink()) {
          queue.push([child, childDisplay]);
          continue;
        }
        let entry: InventoryEntry;
        if (info.isSymbolicLink()) {
          try {
            entry = { path: asRawText(childDisplay), kind: "link", size: Buffer.byteLength(await files.readlink(child), "utf8") };
          } catch {
            entry = unchecked(childDisplay);
          }
        } else if (info.isFile()) {
          entry = { path: asRawText(childDisplay), kind: "file", size: info.size };
        } else {
          entry = unchecked(childDisplay);
        }
        if (!add(entry)) break outer;
      }
    }
    entries.sort((a, b) => compareCodeUnits(a.path, b.path));
    return { entries, limitReached };
  }

  /** The plan target's hash at `base/relative`: a regular file only, never through a link. */
  async function targetHash(base: string, relative: unknown): Promise<{ readonly hash: ContentHash } | "missing" | "unreadable"> {
    const segments = safeSegments(relative);
    if (segments === null) return "unreadable";
    if (base === root && fold(segments[0] ?? "") === stateName) return "unreadable";
    const absolute = path.join(base, ...segments);
    let info: InventoryStat;
    try {
      info = await files.lstat(absolute);
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      return code === "ENOENT" || code === "ENOTDIR" ? "missing" : "unreadable";
    }
    if (info.isSymbolicLink() || !info.isFile()) return "unreadable";
    try {
      return { hash: (await files.hashFile(absolute)).toLowerCase() };
    } catch {
      return "unreadable";
    }
  }

  async function check(input: InventoryCheckInput): Promise<RawVerifierResult> {
    const result = (outcome: VerifierOutcome, evidence: string): RawVerifierResult =>
      createRawVerifierResult({
        id: INVENTORY_VERIFIER_ID,
        kind: "inventory",
        outcome,
        evidence,
        checked: INVENTORY_CHECKED,
        limits: INVENTORY_LIMITS,
      });

    const before = input?.before;
    const after = input?.after;
    if (!Array.isArray(before?.entries) || !Array.isArray(after?.entries) || !Array.isArray(input.applied)) {
      return result("inconclusive", "the inventory input is incomplete, so nothing was compared");
    }
    if (before.limitReached || after.limitReached) {
      const which = [before.limitReached ? "before" : null, after.limitReached ? "after" : null].filter((item) => item !== null);
      return result(
        "inconclusive",
        `the inventory ${which.join(" and ")} the apply stopped at ${limits.maxFiles} entries, so the workspace was not compared`,
      );
    }

    const differences = { missing: [] as string[], added: [] as string[], changed: [] as string[], plan: [] as string[], hash: [] as string[] };
    const open: string[] = [];

    type Known = { readonly path: string; readonly kind: "file" | "link"; readonly size: number };
    const expected = new Map<string, Known>();
    /** Folded path → path as listed, for every path either listing could not measure. */
    const uncheckedPaths = new Map<string, string>();
    const uncheckedKeys = { has: (key: string): boolean => uncheckedPaths.has(key) };
    for (const entry of before.entries) {
      if (entry.kind === "unchecked") uncheckedPaths.set(fold(entry.path), entry.path);
      else expected.set(fold(entry.path), { path: entry.path, kind: entry.kind, size: entry.size });
    }
    const actual = new Map<string, Known>();
    for (const entry of after.entries) {
      if (entry.kind === "unchecked") uncheckedPaths.set(fold(entry.path), entry.path);
      else actual.set(fold(entry.path), { path: entry.path, kind: entry.kind, size: entry.size });
    }

    const targets: { readonly action: AppliedPlanAction; readonly base: string; readonly relative: unknown; readonly label: string }[] = [];
    for (const applied of input.applied) {
      const action = applied?.action;
      const index = typeof applied?.index === "number" ? applied.index : -1;
      if (action?.kind === "move" && typeof action.from === "string" && typeof action.to === "string") {
        const from = fold(action.from);
        const to = fold(action.to);
        const source = expected.get(from);
        if (uncheckedKeys.has(from) || uncheckedKeys.has(to)) {
          open.push(`action ${index}: its source or destination could not be listed`);
        } else if (source === undefined || source.kind !== "file") {
          differences.plan.push(`action ${index}: the source ${action.from} was not a file before the apply`);
        } else if (expected.has(to)) {
          differences.plan.push(`action ${index}: the destination ${action.to} already existed before the apply`);
        } else {
          expected.delete(from);
          expected.set(to, { path: action.to, kind: "file", size: source.size });
        }
        targets.push({ action: applied, base: root, relative: action.to, label: action.to });
      } else if (action?.kind === "discard" && typeof action.path === "string") {
        const key = fold(action.path);
        const source = expected.get(key);
        if (uncheckedKeys.has(key)) open.push(`action ${index}: its path could not be listed`);
        else if (source === undefined || source.kind !== "file") differences.plan.push(`action ${index}: ${action.path} was not a file before the apply`);
        else expected.delete(key);
        targets.push({ action: applied, base: input.discardedRoot, relative: applied.stored, label: `${action.path} (discarded)` });
      } else {
        open.push(`action ${index}: not a move or discard this check can read`);
      }
    }

    for (const [key, entry] of expected) {
      if (uncheckedKeys.has(key)) continue;
      const now = actual.get(key);
      if (now === undefined) differences.missing.push(entry.path);
      else if (now.kind !== entry.kind || now.size !== entry.size) {
        differences.changed.push(`${entry.path} (${entry.kind} ${entry.size} bytes, now ${now.kind} ${now.size} bytes)`);
      }
    }
    for (const [key, entry] of actual) {
      if (!uncheckedKeys.has(key) && !expected.has(key)) differences.added.push(entry.path);
    }
    for (const shown of uncheckedPaths.values()) open.push(`could not list or measure ${shown}`);

    let hashed = 0;
    for (const target of targets) {
      const planned = String(target.action.action.sha256 ?? "").toLowerCase();
      if (!HASH.test(planned)) {
        open.push(`${target.label}: the plan has no SHA-256 to compare`);
        continue;
      }
      if (typeof target.base !== "string" || target.base.length === 0) {
        open.push(`${target.label}: no directory to read it from`);
        continue;
      }
      const found = await targetHash(target.base, target.relative);
      if (found === "missing") differences.hash.push(`${target.label}: not found`);
      else if (found === "unreadable") open.push(`${target.label}: could not be read as a regular file`);
      else if (found.hash !== planned) differences.hash.push(`${target.label}: SHA-256 differs from the plan`);
      else hashed += 1;
    }

    const section = (title: string, items: readonly string[]): string | null => {
      if (items.length === 0) return null;
      const listed = items.slice(0, MAX_LISTED_PATHS).map((item) => `  ${item}`);
      if (items.length > MAX_LISTED_PATHS) listed.push(`  … ${items.length - MAX_LISTED_PATHS} more`);
      return `${title} (${items.length}):\n${listed.join("\n")}`;
    };
    const failed = Object.values(differences).some((items) => items.length > 0);
    const summary =
      `${before.entries.length} entries before, ${after.entries.length} after; ${input.applied.length} applied actions; ` +
      `${hashed} of ${targets.length} plan targets have the plan's SHA-256`;
    const body = [
      section("missing", differences.missing),
      section("added", differences.added),
      section("changed", differences.changed),
      section("not as planned", differences.plan),
      section("plan targets that differ", differences.hash),
      section("not checked", open),
    ].filter((item) => item !== null);
    const outcome: VerifierOutcome = failed ? "fail" : open.length > 0 ? "inconclusive" : "pass";
    return result(outcome, [summary, ...body].join("\n"));
  }

  return { capture, check };
}

/** VF-05: the checker with the contract's limit and the real file system. */
export function createInventoryChecker(options: InventoryCheckerOptions): InventoryChecker {
  return buildInventoryChecker(options);
}
