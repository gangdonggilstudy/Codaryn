/**
 * The workflow tools `inspect_files` and `propose_plan` (G-C). Design: docs/design/general-tasks.md
 * 5.3 and 6.3. Contracts: InspectFilesArgs/InspectFilesPayload (tool.ts), ProposePlanArgs,
 * ProposePlanPayload, PLAN_PROBLEMS, PlanRecorder (plan.ts). U-180 (DR-69 B-1, B-3):
 * `propose_changes` (ProposeChangesArgs, ProposeChangesPayload, CHANGES_PLAN_PROBLEMS), which writes
 * only plan.json of a `run` plan, through PlanRecorder.saveChangesPlan.
 *
 * Both return raw local text, like the built-in tools: the engine masks every result before it is
 * recorded or sent. Neither changes a workspace file. `propose_plan` writes only plan.json, through
 * the PlanRecorder, and only when every check passed. DR-28: each stored action carries its paths
 * as the run's own gateway masked them (`shown`, planActionShown).
 */

import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import {
  MAX_INSPECT_ENTRIES,
  MAX_INSPECT_HASH_BYTES,
  MAX_INVENTORY_FILES,
  MAX_PLAN_ACTIONS,
  CONTENT_HASH_PATTERN_SOURCE,
  MAX_PLAN_SOURCE_BYTES,
  MAX_PLANNED_FILES,
  PRIVACY_TOKEN_PATTERN_SOURCE,
  asRawText,
  maskedParts,
  safeModelText,
  planActionShown,
} from "../contracts/index.js";
import type {
  ChangesPlanProblem,
  InspectEntry,
  InspectFilesArgs,
  MaskedPlanAction,
  PlanActionArgs,
  PlanProblem,
  PlanRecorder,
  PlannedFileNow,
  PlannedFileProbe,
  PrivacyGateway,
  ProposeChangesArgs,
  ProposePlanArgs,
  RawWorkflowToolOutcome,
  ResolvedPath,
  ResolvedPlanAction,
  ResolvedPlannedFile,
  StoredPlanAction,
  StoredPlannedFile,
  ToolErrorCode,
  Workspace,
} from "../contracts/index.js";

import {
  hashFile,
  inspectDestination,
  inspectSource,
  isMissing,
  pathKey,
} from "./plan-files.js";
import type { FileIdentity, PlanFileOps } from "./plan-files.js";
import type { PathSet, PathSetSnapshot } from "../policy/path-set.js";
import { nodeFileLayer } from "../workspace/file-layer.js";
import { FolderWatch, retried, sameChain, walkChain } from "../workspace/guard.js";
import { takeJudged } from "../workspace/judged.js";

/**
 * Most entries `inspect_files` walks under one directory. Above it the call fails with
 * `too_large` and asks for a smaller directory. Same bound as the inventory check (DR-6).
 */
export const MAX_INSPECT_WALK_ENTRIES = MAX_INVENTORY_FILES;

type Failure = Extract<RawWorkflowToolOutcome, { ok: false }>;

function fail(code: ToolErrorCode, message: string): Failure {
  return { ok: false, code, message: asRawText(message) };
}

function invalidPlan(index: number | null, problem: PlanProblem): Failure {
  // The message names the action index and the code, never a path (plan.ts).
  return fail("invalid_plan", index === null ? `plan rejected: ${problem}` : `plan rejected: action ${index}: ${problem}`);
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function toRelative(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join("/");
}

function isStateDirSegment(segment: string): boolean {
  // The workspace compares the state directory name without case on every platform.
  return segment.toLowerCase() === ".codaryn";
}

export interface WorkflowToolDeps {
  readonly workspace: Workspace;
  readonly privacy: PrivacyGateway;
  readonly planRecorder?: PlanRecorder;
  readonly fileOps: PlanFileOps;
  readonly platform: NodeJS.Platform;
  /** U-203 (R-3, R-4): the run's unreadable paths (ToolRunnerOptions.unreadablePaths); inspect_files leaves them out. */
  readonly unreadable?: PathSet;
}

interface WalkedEntry {
  readonly relative: string;
  readonly absolute: string;
  readonly kind: "file" | "dir";
}

/**
 * Every file and directory under `dir`, sorted by root-relative path. Links and other special
 * entries are skipped and never followed. The state directory is never entered.
 * U-203 (Codex V-13 M-1): what `hidden` covers (the run's unreadable paths) is skipped before it is
 * counted, and a folder it covers is never read, so the limit and the outcome do not depend on what
 * exists there.
 */
async function walk(root: string, dir: string, signal: AbortSignal, watch: FolderWatch, hidden: PathSetSnapshot | null): Promise<WalkedEntry[] | Failure | "changed"> {
  const found: WalkedEntry[] = [];
  const pending: string[] = [dir];
  while (pending.length > 0) {
    if (signal.aborted) return fail("cancelled", "inspect_files cancelled");
    const current = pending.pop() as string;
    // U-189 (Codex V-10): each folder is looked at before it is read; a link there now is a swap.
    if (!(await watch.enter(current))) return "changed";
    let children: Dirent[];
    try {
      children = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      if (current === dir) return fail(isMissing(error) ? "not_found" : "io_error", "cannot list directory");
      continue; // removed while listing: skip it
    }
    for (const child of children) {
      if (current === root && isStateDirSegment(child.name)) continue;
      const absolute = path.join(current, child.name);
      const relative = toRelative(root, absolute);
      if (hidden !== null && hidden.covers(relative)) continue;
      if (child.isDirectory()) {
        found.push({ relative, absolute, kind: "dir" });
        pending.push(absolute);
      } else if (child.isFile()) {
        found.push({ relative, absolute, kind: "file" });
      } else {
        continue; // links, sockets, devices: not listed, not followed
      }
      if (found.length > MAX_INSPECT_WALK_ENTRIES) {
        return fail("too_large", `more than ${MAX_INSPECT_WALK_ENTRIES} entries; inspect a smaller directory`);
      }
    }
  }
  found.sort((a, b) => compareCodeUnits(a.relative, b.relative));
  return found;
}

const TOKEN_TEST = new RegExp(PRIVACY_TOKEN_PATTERN_SOURCE);
const DIGEST_PATTERN = new RegExp(CONTENT_HASH_PATTERN_SOURCE);

/**
 * Where the page after `after` starts. The model sees masked paths, so a path holding a registered
 * secret comes back as `after` with a token in it: such a value is matched against the masked
 * paths. Otherwise every path after it in code unit order follows.
 */
function startAfter(entries: readonly WalkedEntry[], after: string, privacy: PrivacyGateway): number | Failure {
  if (TOKEN_TEST.test(after)) {
    for (let index = 0; index < entries.length; index += 1) {
      const masked = privacy.mask((entries[index] as WalkedEntry).relative);
      if (!masked.ok) return fail("masking_failed", "masking a path failed");
      if (masked.text === after) return index + 1;
    }
  }
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (compareCodeUnits((entries[mid] as WalkedEntry).relative, after) <= 0) low = mid + 1;
    else high = mid;
  }
  return low;
}

export async function inspectFiles(
  deps: WorkflowToolDeps,
  args: InspectFilesArgs,
  signal: AbortSignal,
): Promise<RawWorkflowToolOutcome> {
  const { workspace } = deps;
  if (typeof args.path !== "string") return fail("invalid_args", "path must be a string");
  // U-189 (T-1, Codex V-10): the real path the policy gate judged for this argument, if it judged one.
  const judged = takeJudged(workspace, args.path, "read");
  const resolved = await workspace.resolve(args.path, "read");
  if (!resolved.ok) return fail("policy_denied", `path rejected by workspace: ${resolved.code}`);
  if (judged !== undefined && judged !== resolved.path.absolute) {
    return fail("policy_denied", "the path leads elsewhere than when the policy judged it; nothing was done");
  }
  try {
    const stat = await fs.stat(resolved.path.absolute);
    if (!stat.isDirectory()) return fail("invalid_args", "path is not a directory");
  } catch (error) {
    return fail(isMissing(error) ? "not_found" : "io_error", "cannot read directory");
  }
  // U-189 (P-1, Codex V-10): names, sizes, times and hashes come only from folders that stayed the
  // ones checked (guard.ts); a change seen is tried again, still seen it is io_error.
  const outcome = await retried(async () => {
    const first = await walkChain(nodeFileLayer.lstatId, workspace.root, resolved.path.relative);
    if (!first.ok) return first.code === "changed" ? "changed" : fail(first.code === "not_found" ? "not_found" : "io_error", "cannot read directory");
    const watch = new FolderWatch(nodeFileLayer.lstatId);
    const result = await inspectOnce(deps, args, signal, resolved.path.absolute, watch);
    if (result === "changed") return "changed";
    if (!result.ok) return result;
    const second = await walkChain(nodeFileLayer.lstatId, workspace.root, resolved.path.relative);
    if (!second.ok || !sameChain(first.seen, second.seen) || !(await watch.unchanged())) return "changed";
    return result;
  });
  return outcome === "changed" ? fail("io_error", "the folders changed while they were read; nothing was given") : outcome;
}

/** One pass of inspect_files over the checked folder `dir`, every folder read kept in `watch`. */
async function inspectOnce(deps: WorkflowToolDeps, args: InspectFilesArgs, signal: AbortSignal, dir: string, watch: FolderWatch): Promise<RawWorkflowToolOutcome | "changed"> {
  const { workspace, privacy } = deps;
  // U-203 (R-3, R-4): the walk leaves out every entry under the run's unreadable paths, by its text or
  // its real path, before anything is counted, hashed or paged (so `next` never names one).
  // `withheld` says an unreadable entry lies in the walked folder: it depends on the entries alone,
  // never on what exists there.
  const hidden = deps.unreadable === undefined ? null : await deps.unreadable.snapshot(workspace);
  const walked = await walk(workspace.root, dir, signal, watch, hidden);
  if (walked === "changed") return "changed";
  if (!Array.isArray(walked)) return walked;
  const withheld = hidden !== null && hidden.within(toRelative(workspace.root, dir) || ".");

  let start = 0;
  if (args.after !== undefined) {
    const found = startAfter(walked, args.after, privacy);
    if (typeof found !== "number") return found;
    start = found;
  }

  const entries: InspectEntry[] = [];
  let budget = MAX_INSPECT_HASH_BYTES;
  let hashesIncomplete = false;
  let index = start;
  for (; index < walked.length && entries.length < MAX_INSPECT_ENTRIES; index += 1) {
    if (signal.aborted) return fail("cancelled", "inspect_files cancelled");
    const item = walked[index] as WalkedEntry;
    let stat: Awaited<ReturnType<PlanFileOps["lstat"]>>;
    try {
      stat = await deps.fileOps.lstat(item.absolute);
    } catch {
      continue; // removed since the walk
    }
    if (stat.isSymbolicLink()) continue;
    const modified = new Date(Number(stat.mtimeMs));
    const modifiedAt = Number.isNaN(modified.getTime()) ? null : modified.toISOString();
    if (item.kind === "dir" || stat.isDirectory()) {
      entries.push({ path: item.relative, kind: "dir", size: null, modifiedAt });
      continue;
    }
    if (!stat.isFile()) continue;
    const size = Number(stat.size);
    const entry: { path: string; kind: "file"; size: number; modifiedAt: string | null; sha256?: string } = {
      path: item.relative,
      kind: "file",
      size,
      modifiedAt,
    };
    if (args.hash === true) {
      if (size > budget) {
        hashesIncomplete = true;
      } else {
        const identity: FileIdentity = { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeNs: stat.mtimeNs };
        const hashed = await hashFile(item.absolute, { expected: identity, maxBytes: budget, signal });
        if (hashed.ok) {
          entry.sha256 = hashed.hash;
          budget -= hashed.bytes;
        } else if (hashed.reason === "aborted") {
          return fail("cancelled", "inspect_files cancelled");
        } else {
          hashesIncomplete = true;
        }
      }
    }
    entries.push(entry);
  }
  const last = entries[entries.length - 1];
  const next = index < walked.length && last !== undefined ? last.path : null;
  return { ok: true, payload: { entries, next, hashesIncomplete, ...(withheld ? { withheld: true as const } : {}) } };
}

interface CheckedAction {
  readonly args: PlanActionArgs;
  readonly source: ResolvedPath;
  readonly identity: FileIdentity;
  readonly destination: ResolvedPath | null;
}

/**
 * Checks a plan and builds its resolved actions (PLAN_PROBLEMS). The first problem found, by
 * action order, rejects the whole plan. Nothing is written.
 */
async function checkPlan(
  deps: WorkflowToolDeps,
  actions: readonly PlanActionArgs[],
  signal: AbortSignal,
): Promise<CheckedAction[] | Failure> {
  const { workspace, fileOps, platform } = deps;
  if (actions.length === 0) return invalidPlan(null, "empty");
  if (actions.length > MAX_PLAN_ACTIONS) return invalidPlan(null, "too_many");

  // Resolve every path first, so later checks compare real root-relative paths. The paths as
  // given are kept for the file checks: a link must be judged by the name, not by its target.
  const resolved: {
    source: ResolvedPath;
    sourceGiven: string;
    destination: ResolvedPath | null;
    destinationGiven: string | null;
  }[] = [];
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index] as PlanActionArgs;
    const sourcePath = action.kind === "move" ? action.from : action.path;
    if (typeof sourcePath !== "string") return fail("invalid_args", `action ${index}: path must be a string`);
    const source = await workspace.resolve(sourcePath, "write");
    if (!source.ok) return fail("policy_denied", `action ${index}: path rejected by workspace: ${source.code}`);
    let destination: ResolvedPath | null = null;
    if (action.kind === "move") {
      if (typeof action.to !== "string") return fail("invalid_args", `action ${index}: to must be a string`);
      const to = await workspace.resolve(action.to, "write");
      if (!to.ok) return fail("policy_denied", `action ${index}: path rejected by workspace: ${to.code}`);
      destination = to.path;
    } else if (action.kind !== "discard") {
      return fail("invalid_args", `action ${index}: unknown kind`);
    }
    resolved.push({
      source: source.path,
      sourceGiven: sourcePath,
      destination,
      destinationGiven: action.kind === "move" ? action.to : null,
    });
  }

  const key = (p: ResolvedPath): string => pathKey(p.relative, platform);
  const allSources = new Set(resolved.map((r) => key(r.source)));
  const allDestinations = new Set(resolved.flatMap((r) => (r.destination === null ? [] : [key(r.destination)])));
  const seenSources = new Set<string>();
  const seenDestinations = new Set<string>();
  const checked: CheckedAction[] = [];
  let totalBytes = 0n;

  for (let index = 0; index < actions.length; index += 1) {
    if (signal.aborted) return fail("cancelled", "propose_plan cancelled");
    const action = actions[index] as PlanActionArgs;
    const { source, sourceGiven, destination, destinationGiven } = resolved[index] as (typeof resolved)[number];
    const sourceKey = key(source);
    const destinationKey = destination === null ? null : key(destination);

    if (destinationKey !== null && destinationKey === sourceKey) return invalidPlan(index, "same_path");
    if (seenSources.has(sourceKey)) return invalidPlan(index, "duplicate_source");
    if (destinationKey !== null && seenDestinations.has(destinationKey)) return invalidPlan(index, "duplicate_destination");
    if (destinationKey !== null && allSources.has(destinationKey)) return invalidPlan(index, "destination_is_source");
    seenSources.add(sourceKey);
    if (destinationKey !== null) seenDestinations.add(destinationKey);

    const sourceCheck = await inspectSource(workspace, sourceGiven, fileOps);
    if (!sourceCheck.ok) {
      if (sourceCheck.problem === "denied") return fail("policy_denied", `action ${index}: path rejected by workspace`);
      if (sourceCheck.problem === "io_error") return fail("io_error", `action ${index}: cannot read the source`);
      return invalidPlan(index, sourceCheck.problem);
    }

    if (destination !== null && destinationKey !== null) {
      // A destination inside another destination would need that file to be a directory.
      const parents = destination.relative.split("/").slice(0, -1);
      for (let depth = 1; depth <= parents.length; depth += 1) {
        if (allDestinations.has(pathKey(parents.slice(0, depth).join("/"), platform))) {
          return invalidPlan(index, "destination_parent_not_dir");
        }
      }
      const destinationCheck = await inspectDestination(workspace, destinationGiven ?? destination.relative, fileOps);
      if (!destinationCheck.ok) {
        if (destinationCheck.problem === "denied") return fail("policy_denied", `action ${index}: path rejected by workspace`);
        if (destinationCheck.problem === "io_error") return fail("io_error", `action ${index}: cannot check the destination`);
        return invalidPlan(index, destinationCheck.problem);
      }
    }

    totalBytes += sourceCheck.identity.size;
    if (totalBytes > BigInt(MAX_PLAN_SOURCE_BYTES)) return invalidPlan(index, "too_large");
    checked.push({ args: action, source: sourceCheck.path, identity: sourceCheck.identity, destination });
  }
  return checked;
}

/** An action's paths masked by `privacy`, or null when one cannot be masked. */
function maskPlanAction(action: ResolvedPlanAction, privacy: PrivacyGateway): MaskedPlanAction | null {
  const mask = (text: string) => {
    const masked = privacy.mask(text);
    return masked.ok ? masked.text : null;
  };
  if (action.kind === "move") {
    const from = mask(action.from);
    const to = mask(action.to);
    return from === null || to === null ? null : { kind: "move", from, to, sha256: action.sha256 };
  }
  const where = mask(action.path);
  return where === null ? null : { kind: "discard", path: where, sha256: action.sha256 };
}

export async function proposePlan(
  deps: WorkflowToolDeps,
  args: ProposePlanArgs,
  signal: AbortSignal,
): Promise<RawWorkflowToolOutcome> {
  if (!Array.isArray(args.actions)) return fail("invalid_args", "actions must be an array");
  const checked = await checkPlan(deps, args.actions, signal);
  if (!Array.isArray(checked)) return checked;

  // The tool computes every source hash; the model never supplies one.
  const actions: ResolvedPlanAction[] = [];
  for (let index = 0; index < checked.length; index += 1) {
    const item = checked[index] as CheckedAction;
    const hashed = await hashFile(item.source.absolute, { expected: item.identity, signal });
    if (!hashed.ok) {
      if (hashed.reason === "aborted") return fail("cancelled", "propose_plan cancelled");
      if (hashed.reason === "missing") return invalidPlan(index, "source_missing");
      if (hashed.reason === "changed") return invalidPlan(index, "source_not_file");
      return fail("io_error", `action ${index}: cannot read the source`);
    }
    actions.push(
      item.destination === null
        ? { kind: "discard", path: item.source.relative, sha256: hashed.hash }
        : { kind: "move", from: item.source.relative, to: item.destination.relative, sha256: hashed.hash },
    );
  }

  if (signal.aborted) return fail("cancelled", "propose_plan cancelled");
  if (deps.planRecorder === undefined) return fail("io_error", "no plan store is available; nothing was stored");

  // DR-28 (R-11 M-1): each stored action keeps its paths as this run's own gateway masks them, so a
  // later plan view or apply can tell whether the secrets registered then mask them the same way.
  // A path that cannot be masked stores nothing.
  const stored: StoredPlanAction[] = [];
  for (const action of actions) {
    const masked = maskPlanAction(action, deps.privacy);
    if (masked === null) return fail("io_error", "masking a plan path failed; nothing was stored");
    const shown = planActionShown(masked);
    if (action.kind === "move" && "from" in shown) stored.push({ ...action, shown });
    else if (action.kind === "discard" && "path" in shown) stored.push({ ...action, shown });
    else return fail("io_error", "masking a plan path failed; nothing was stored");
  }
  let digest: string;
  try {
    digest = await deps.planRecorder.savePlan(stored);
  } catch {
    // No detail: it could carry raw paths.
    return fail("io_error", "storing the plan failed; no plan exists");
  }
  // R-5 I-4: the digest is what a person approves later. A store that returns anything but a
  // SHA-256 in the contract's form is not trusted; the run then ends without a pending plan.
  if (typeof digest !== "string" || !DIGEST_PATTERN.test(digest)) {
    return fail("io_error", "the plan store returned no valid digest; the plan cannot be approved");
  }
  return { ok: true, payload: { digest, actions } };
}

function invalidChanges(index: number | null, problem: ChangesPlanProblem): Failure {
  // As invalidPlan: the file index and the code, never a path (plan.ts).
  return fail("invalid_plan", index === null ? `plan rejected: ${problem}` : `plan rejected: file ${index}: ${problem}`);
}

interface CheckedFile {
  readonly path: ResolvedPath;
  readonly change: "create" | "modify";
  /** For `modify`: the file as it was checked, so the hash is of that file. */
  readonly identity: FileIdentity | null;
}

/**
 * U-180 (B-1, B-5): checks a `run` plan's files (CHANGES_PLAN_PROBLEMS). The first problem by file
 * order rejects the whole plan. Files only: a `modify` path must be a regular file now (not a link,
 * not a directory), a `create` path must hold nothing (not even a dangling link) with every existing
 * parent a directory, and no create may lie under another planned file. Nothing is written.
 */
async function checkChanges(
  deps: WorkflowToolDeps,
  files: ProposeChangesArgs["files"],
  signal: AbortSignal,
): Promise<CheckedFile[] | Failure> {
  const { workspace, fileOps, platform } = deps;
  if (files.length === 0) return invalidChanges(null, "empty");
  if (files.length > MAX_PLANNED_FILES) return invalidChanges(null, "too_many");

  const resolved: ResolvedPath[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const given = (files[index] as ProposeChangesArgs["files"][number]).path;
    if (typeof given !== "string") return fail("invalid_args", `file ${index}: path must be a string`);
    const where = await workspace.resolve(given, "write");
    if (!where.ok) return fail("policy_denied", `file ${index}: path rejected by workspace: ${where.code}`);
    resolved.push(where.path);
  }
  const key = (p: ResolvedPath): string => pathKey(p.relative, platform);
  const allPaths = new Set(resolved.map(key));
  const seen = new Set<string>();
  const checked: CheckedFile[] = [];
  let totalBytes = 0n;

  for (let index = 0; index < files.length; index += 1) {
    if (signal.aborted) return fail("cancelled", "propose_changes cancelled");
    const file = files[index] as ProposeChangesArgs["files"][number];
    const where = resolved[index] as ResolvedPath;
    const fileKey = key(where);
    if (seen.has(fileKey)) return invalidChanges(index, "duplicate_path");
    seen.add(fileKey);
    // A planned file inside another planned file would need that file to be a directory.
    const parents = where.relative.split("/").slice(0, -1);
    for (let depth = 1; depth <= parents.length; depth += 1) {
      if (allPaths.has(pathKey(parents.slice(0, depth).join("/"), platform))) return invalidChanges(index, "parent_not_dir");
    }
    if (file.change === "modify") {
      const now = await inspectSource(workspace, file.path, fileOps);
      if (!now.ok) {
        if (now.problem === "denied") return fail("policy_denied", `file ${index}: path rejected by workspace`);
        if (now.problem === "io_error") return fail("io_error", `file ${index}: cannot read the file`);
        return invalidChanges(index, now.problem === "source_missing" ? "file_missing" : "not_file");
      }
      totalBytes += now.identity.size;
      if (totalBytes > BigInt(MAX_PLAN_SOURCE_BYTES)) return invalidChanges(index, "too_large");
      checked.push({ path: now.path, change: "modify", identity: now.identity });
    } else if (file.change === "create") {
      const now = await inspectDestination(workspace, file.path, fileOps);
      if (!now.ok) {
        if (now.problem === "denied") return fail("policy_denied", `file ${index}: path rejected by workspace`);
        if (now.problem === "io_error") return fail("io_error", `file ${index}: cannot check the path`);
        return invalidChanges(index, now.problem === "destination_exists" ? "file_exists" : "parent_not_dir");
      }
      checked.push({ path: now.path, change: "create", identity: null });
    } else {
      return fail("invalid_args", `file ${index}: unknown change`);
    }
  }
  return checked;
}

/**
 * U-180 (DR-69 B-1, B-3): `propose_changes`. Checks the files, hashes every `modify` file (the model
 * never supplies a hash), and stores plan.json of a `run` plan through PlanRecorder.saveChangesPlan:
 * the summary and each path as this run's own gateway masks them, as visible parts (MaskedParts: no
 * privacy token, no secret value); the summary also made safe with safeModelText (V-7 M-1: key
 * shapes hidden, control and invisible characters left out). It is stored under the digest (R-99 L-1). Without a
 * recorder that can store such a plan, or when a text cannot be masked, nothing is stored
 * (`io_error`).
 */
export async function proposeChanges(
  deps: WorkflowToolDeps,
  args: ProposeChangesArgs,
  signal: AbortSignal,
): Promise<RawWorkflowToolOutcome> {
  if (!Array.isArray(args.files)) return fail("invalid_args", "files must be an array");
  const checked = await checkChanges(deps, args.files, signal);
  if (!Array.isArray(checked)) return checked;

  const files: ResolvedPlannedFile[] = [];
  for (let index = 0; index < checked.length; index += 1) {
    const item = checked[index] as CheckedFile;
    if (item.change === "create" || item.identity === null) {
      files.push({ path: item.path.relative, change: "create", sha256: null });
      continue;
    }
    const hashed = await hashFile(item.path.absolute, { expected: item.identity, signal });
    if (!hashed.ok) {
      if (hashed.reason === "aborted") return fail("cancelled", "propose_changes cancelled");
      if (hashed.reason === "missing") return invalidChanges(index, "file_missing");
      if (hashed.reason === "changed") return invalidChanges(index, "not_file");
      return fail("io_error", `file ${index}: cannot read the file`);
    }
    files.push({ path: item.path.relative, change: "modify", sha256: hashed.hash });
  }

  if (signal.aborted) return fail("cancelled", "propose_changes cancelled");
  const recorder = deps.planRecorder;
  if (recorder === undefined || typeof recorder.saveChangesPlan !== "function") {
    return fail("io_error", "no plan store for this kind of plan is available; nothing was stored");
  }
  // Review V-7 M-1: the summary is made safe as the engine's last message and plan summary are
  // (safeModelText): control and invisible characters left out, the registered values masked, and
  // key shapes hidden (HIDDEN_KEY_MARKER) also when nobody registered them. It goes into plan.json
  // and from there into the system text of the run that carries the plan out.
  const summary = typeof args.summary === "string" ? safeModelText(args.summary, (text) => deps.privacy.mask(text)) : null;
  if (summary === null) return fail("io_error", "masking the summary failed; nothing was stored");
  const stored: StoredPlannedFile[] = [];
  for (const file of files) {
    const masked = deps.privacy.mask(file.path);
    if (!masked.ok) return fail("io_error", "masking a plan path failed; nothing was stored");
    stored.push({ ...file, shown: maskedParts(masked.text) });
  }
  let digest: string;
  try {
    digest = await recorder.saveChangesPlan({ summary: maskedParts(summary), files: stored });
  } catch {
    // No detail: it could carry raw paths.
    return fail("io_error", "storing the plan failed; no plan exists");
  }
  // R-5 I-4, as propose_plan: only a SHA-256 in the contract's form can be approved.
  if (typeof digest !== "string" || !DIGEST_PATTERN.test(digest)) {
    return fail("io_error", "the plan store returned no valid digest; the plan cannot be approved");
  }
  return { ok: true, payload: { digest, files } };
}

/**
 * U-187 (DR-69 B-6): the PlannedFileProbe for a workspace (contract plan.ts): what is at a planned
 * file's path now, with propose_changes' own checks. `create`: `missing` when nothing is at the path
 * and its existing parents are folders (inspectDestination), else `other`. `modify`: `file` with the
 * SHA-256 of the regular file the path names, its last name not a link (inspectSource, hashFile),
 * `missing` when it is gone, else `other`. A check that fails, a path the workspace refuses and a
 * cancel answer `other` (fail closed: plannedFileStale takes it as stale). Reads only.
 * Review V-11 H-1: a planned file's path is its effective path when the plan was made (links
 * resolved, ResolvedPlannedFile). It still fits only while it resolves to itself: a link now on its
 * way (a parent folder turned into a junction) leads elsewhere, and that is `other`.
 */
export function createPlannedFileProbe(options: {
  readonly workspace: Workspace;
  readonly fileOps: PlanFileOps;
  readonly platform?: NodeJS.Platform;
}): PlannedFileProbe {
  const { workspace, fileOps } = options;
  const platform = options.platform ?? process.platform;
  const itself = (resolved: ResolvedPath, planned: string): boolean => pathKey(resolved.relative, platform) === pathKey(planned, platform);
  return async (file, signal): Promise<PlannedFileNow> => {
    try {
      if (file.change === "create") {
        const now = await inspectDestination(workspace, file.path, fileOps);
        return now.ok && itself(now.path, file.path) ? { kind: "missing" } : { kind: "other" };
      }
      const now = await inspectSource(workspace, file.path, fileOps);
      if (!now.ok) return now.problem === "source_missing" ? { kind: "missing" } : { kind: "other" };
      if (!itself(now.path, file.path)) return { kind: "other" };
      const hashed = await hashFile(now.path.absolute, { expected: now.identity, signal });
      if (hashed.ok) return { kind: "file", sha256: hashed.hash };
      return hashed.reason === "missing" ? { kind: "missing" } : { kind: "other" };
    } catch {
      return { kind: "other" };
    }
  };
}
