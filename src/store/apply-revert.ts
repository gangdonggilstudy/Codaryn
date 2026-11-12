/**
 * G-E: reverting an apply run (RevertRun, src/contracts/changes.ts, G-A part). Its journal starts
 * with `apply_started`; its done actions are handled last first.
 *
 * - A moved file goes back from `to` to `from` when the file at `to` has the action's SHA-256 and
 *   nothing exists at `from`. A discarded file goes back from
 *   `.codaryn/discarded/<runId>/<discardedStoredName(index)>` (DR-9) the same way. A move back is
 *   a hard link and the source's removal, so nothing is ever replaced; where a link cannot be made
 *   the file is skipped as `unsafe_move` (DR-24 b: no "check, then rename" on its own).
 * - DR-25: with the person's consent for this revert, such a file goes back by a plain rename made
 *   right after checking that its original path is still free, and is reported `unsafe: true`.
 *   A dry run creates nothing (N-7), so it cannot tell whether the volume makes hard links: it lists
 *   moves without `unsafe` and says so with `moveSafetyUnchecked`.
 * - Skips: the file changed since (`changed_since_run`), something at the original path
 *   (`original_path_taken`), the file already back (`already_reverted`), no safe move
 *   (`unsafe_move`), a read or write failure (`io_error`).
 * - Real paths (DR-24 f): the records hold masked paths, the plan run's plan.json the resolved
 *   ones. plan.json is used only when its bytes have the digest `apply_started` recorded as approved
 *   and it names that plan run; otherwise the revert rejects and nothing changes. Each record's
 *   SHA-256 must be the plan action's.
 * - R-9 I-4: an action with a `plan_item_started` record but neither a done record nor a
 *   `plan_item_failed` may or may not have been done. Done (the file with the action's hash at the
 *   destination, nothing at the original path): it goes back like a recorded one. Not done (the file
 *   at the original path, nothing at the destination): not listed. Anything else:
 *   `changed_since_run`, nothing touched. A failed action was not done and is not listed.
 * - A record that does not belong to the run, a stored name other than the action's
 *   (DISCARDED_STORED_NAME_PATTERN_SOURCE), or a plan that cannot be trusted rejects with
 *   ApplyRecordError (`invalid_run_record`) before anything is changed.
 */

import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { link, lstat, mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  CONTENT_HASH_PATTERN_SOURCE,
  DISCARDED_STORED_NAME_PATTERN_SOURCE,
  MAX_PLAN_ACTIONS,
  MAX_REPORT_FILE_BYTES,
  PLAN_FILE_NAME,
  RUNS_DIR_NAME,
  STATE_DIR_NAME,
  discardedStoredName,
  toRunId,
} from "../contracts/index.js";
import type { ContentHash, RevertAction, RevertOutcome, RevertSkipReason, RevertedFile, ResolvedPlanAction, SkippedFile, Workspace } from "../contracts/index.js";
import { createWorkspace } from "../workspace/index.js";
import { errorCode, isLinkUnsupported, isPlainDirectory, runDir } from "./common.js";
import { discardedRootPath } from "./discarded.js";
import { canonicalActions } from "./plan.js";

const CONTENT_HASH = new RegExp(CONTENT_HASH_PATTERN_SOURCE);
const STORED_NAME = new RegExp(DISCARDED_STORED_NAME_PATTERN_SOURCE);

/**
 * One action to look at. `recorded`: a done record exists. `started`: only a start record (R-9 I-4).
 * `shown` and `shownTo` are the masked paths of the record, for the outcome.
 */
interface Item {
  readonly index: number;
  readonly kind: "move" | "discard";
  readonly sha256: ContentHash;
  readonly shown: string;
  readonly shownTo: string | null;
  readonly recorded: boolean;
}

/** The journal's records failed a check. Thrown as RevertRunError("invalid_run_record") by the caller. */
export class ApplyRecordError extends Error {}

function bad(): never {
  throw new ApplyRecordError("the apply run's journal or its plan cannot be used; nothing was changed");
}

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function indexValue(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : bad();
}

function hash(value: unknown): ContentHash {
  return typeof value === "string" && CONTENT_HASH.test(value) ? (value as ContentHash) : bad();
}

function text(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : bad();
}

/** DR-24 (a): the stored name is the action's own (`discardedStoredName(index)`), one segment. */
function stored(value: unknown, actionIndex: number): string {
  const name = text(value);
  return STORED_NAME.test(name) && name === discardedStoredName(actionIndex) ? name : bad();
}

/** Whether the journal's first complete record is this run's `apply_started` (DR-12). */
export function isApplyJournal(journal: string, runId: string): boolean {
  const end = journal.indexOf("\n");
  if (end < 0) return false;
  try {
    const first: unknown = JSON.parse(journal.slice(0, end));
    return isObj(first) && first["type"] === "apply_started" && first["runId"] === runId;
  } catch {
    return false;
  }
}

/** The complete records of the journal. A cut-off last line is ignored (T-10). */
function journalRecords(journal: string): Obj[] {
  const lines = journal.split("\n");
  const last = lines.pop() ?? "";
  const records: Obj[] = [];
  for (const line of lines) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return bad();
    }
    records.push(isObj(value) ? value : bad());
  }
  if (last.length > 0) {
    try {
      const value: unknown = JSON.parse(last);
      records.push(isObj(value) ? value : bad());
    } catch (error) {
      if (error instanceof ApplyRecordError) throw error;
    }
  }
  return records;
}

/** The plan run, the approved digest and the actions to look at, in journal order. */
function applyRecords(journal: string, runId: string): { readonly planRunId: string; readonly digest: ContentHash; readonly items: Item[] } {
  const records = journalRecords(journal);
  const first = records[0];
  if (first === undefined || first["type"] !== "apply_started") bad();
  const planRunId = first["planRunId"];
  if (typeof planRunId !== "string" || toRunId(planRunId) === null) bad();
  const digest = hash(first["digest"]);
  // R-9b N-5: every record names one of the plan's actions (`apply_started.actions`, at most MAX_PLAN_ACTIONS).
  const total = first["actions"];
  if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 1 || total > MAX_PLAN_ACTIONS) bad();
  const index = (value: unknown): number => {
    const at = indexValue(value);
    return at < (total as number) ? at : bad();
  };

  const done = new Map<number, Item>();
  const started = new Map<number, Item>();
  const failed = new Set<number>();
  const order: number[] = [];
  const see = (at: number): void => {
    if (!order.includes(at)) order.push(at);
  };
  for (const record of records) {
    if (record["runId"] !== runId || typeof record["type"] !== "string") bad();
    switch (record["type"]) {
      case "file_moved": {
        const at = index(record["index"]);
        done.set(at, { index: at, kind: "move", sha256: hash(record["sha256"]), shown: text(record["from"]), shownTo: text(record["to"]), recorded: true });
        see(at);
        break;
      }
      case "file_discarded": {
        const at = index(record["index"]);
        stored(record["stored"], at);
        done.set(at, { index: at, kind: "discard", sha256: hash(record["sha256"]), shown: text(record["path"]), shownTo: null, recorded: true });
        see(at);
        break;
      }
      case "plan_item_started": {
        const at = index(record["index"]);
        const action = record["action"];
        if (!isObj(action)) bad();
        if (action["kind"] === "move") {
          started.set(at, { index: at, kind: "move", sha256: hash(action["sha256"]), shown: text(action["from"]), shownTo: text(action["to"]), recorded: false });
        } else if (action["kind"] === "discard") {
          started.set(at, { index: at, kind: "discard", sha256: hash(action["sha256"]), shown: text(action["path"]), shownTo: null, recorded: false });
        } else {
          bad();
        }
        see(at);
        break;
      }
      case "plan_item_failed":
        failed.add(index(record["index"]));
        break;
      default:
        break;
    }
  }
  const items: Item[] = [];
  for (const at of order) {
    const item = done.get(at) ?? (failed.has(at) ? undefined : started.get(at));
    if (item !== undefined) items.push(item);
  }
  return { planRunId: planRunId as string, digest, items };
}

/**
 * DR-24 (f): the plan run's resolved actions. Rejects unless plan.json is a plain file of that run
 * whose bytes have the approved digest.
 */
async function trustedPlan(workspaceRoot: string, planRunId: string, digest: ContentHash): Promise<readonly ResolvedPlanAction[]> {
  const dir = runDir(workspaceRoot, planRunId);
  if (!(await isPlainDirectory(join(workspaceRoot, STATE_DIR_NAME, RUNS_DIR_NAME))) || !(await isPlainDirectory(dir))) return bad();
  let bytes: Buffer;
  try {
    const file = join(dir, PLAN_FILE_NAME);
    const info = await lstat(file);
    if (!info.isFile() || info.size > MAX_REPORT_FILE_BYTES) return bad();
    bytes = await readFile(file);
  } catch {
    return bad();
  }
  if (createHash("sha256").update(bytes).digest("hex") !== digest) bad();
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    return bad();
  }
  if (!isObj(value) || value["kind"] !== "plan" || value["runId"] !== planRunId) bad();
  return canonicalActions((value as Obj)["actions"]) ?? bad();
}

type FileState = { readonly kind: "file"; readonly sha256: ContentHash } | { readonly kind: "absent" } | { readonly kind: "other" } | { readonly kind: "error" };

/** What is at `file`: a regular file and its SHA-256 (streamed), nothing, something else (a link too), or unreadable. */
async function stateOf(file: string): Promise<FileState> {
  try {
    const info = await lstat(file);
    if (!info.isFile()) return { kind: "other" };
  } catch (error) {
    const code = errorCode(error);
    return code === "ENOENT" || code === "ENOTDIR" ? { kind: "absent" } : { kind: "error" };
  }
  try {
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(file)) digest.update(chunk as Buffer);
    return { kind: "file", sha256: digest.digest("hex") as ContentHash };
  } catch {
    return { kind: "error" };
  }
}

/** The file operations a move uses; tests replace single ones to inject failures. */
export interface MoveOperations {
  readonly link?: (existing: string, created: string) => Promise<void>;
}

/**
 * Moves `source` to `target` without ever replacing something at `target`: a hard link (which
 * fails when `target` exists) and then the source's removal. "unsafe" where the volume cannot
 * link: then nothing is moved (DR-24 b, DR-21).
 */
export async function moveWithoutReplacing(source: string, target: string, operations: MoveOperations = {}): Promise<"moved" | "taken" | "unsafe" | "failed"> {
  const linkFile = operations.link ?? link;
  try {
    await mkdir(dirname(target), { recursive: true });
  } catch {
    return "failed";
  }
  try {
    await linkFile(source, target);
  } catch (error) {
    if (errorCode(error) === "EEXIST") return "taken";
    return isLinkUnsupported(error) ? "unsafe" : "failed";
  }
  try {
    await rm(source);
    return "moved";
  } catch {
    // Undo the link so the file is not left in two places.
    await rm(target).catch(() => undefined);
    return "failed";
  }
}

type Outcome = { readonly action: RevertAction; readonly unsafe?: true } | { readonly reason: RevertSkipReason } | { readonly unlisted: true };

function movedOutcome(moved: "moved" | "taken" | "unsafe" | "failed", action: RevertAction): Outcome {
  if (moved === "moved") return { action };
  return { reason: moved === "taken" ? "original_path_taken" : moved === "unsafe" ? "unsafe_move" : "io_error" };
}

/**
 * A move back: safe (moveWithoutReplacing) where the volume makes hard links. DR-25: where it does
 * not, and only with the person's consent for this revert, a plain rename right after checking that
 * the original path is still free; the outcome is then marked unsafe.
 */
async function moveBack(away: string, back: string, action: RevertAction, consent: boolean): Promise<Outcome> {
  const moved = await moveWithoutReplacing(away, back);
  if (moved !== "unsafe" || !consent) return movedOutcome(moved, action);
  if ((await stateOf(back)).kind !== "absent") return { reason: "original_path_taken" };
  try {
    await rename(away, back);
    return { action, unsafe: true };
  } catch {
    return { reason: "io_error" };
  }
}

/** A workspace path to write through, or null when it cannot be resolved as it was given. */
async function resolved(workspace: Workspace, path: string): Promise<string | null> {
  const outcome = await workspace.resolve(path, "write");
  return outcome.ok && outcome.path.relative === path ? outcome.path.absolute : null;
}

/**
 * One action back: `away` is where the file went (the move's destination, or its place in the
 * discarded directory), `back` its original path. `recorded` false: only a start record exists.
 */
async function revertItem(
  away: string,
  back: string,
  sha256: ContentHash,
  recorded: boolean,
  action: RevertAction,
  mode: { readonly dryRun: boolean; readonly consent: boolean },
): Promise<Outcome> {
  const there = await stateOf(away);
  const original = await stateOf(back);
  if (there.kind === "error" || original.kind === "error") return { reason: "io_error" };
  const isDone = there.kind === "file" && there.sha256 === sha256;
  if (!recorded) {
    const notDone = original.kind === "file" && original.sha256 === sha256 && there.kind === "absent";
    if (notDone) return { unlisted: true };
    if (!isDone || original.kind !== "absent") return { reason: "changed_since_run" };
  }
  if (!isDone) {
    if (there.kind === "absent" && original.kind === "file" && original.sha256 === sha256) return { reason: "already_reverted" };
    return { reason: "changed_since_run" };
  }
  if (original.kind !== "absent") return { reason: "original_path_taken" };
  if (mode.dryRun) return { action };
  return moveBack(away, back, action, mode.consent);
}

/**
 * Reverts (or, with `dryRun`, decides) an apply run whose journal text was read by `revertRun`.
 * `consent`: the person consented to unsafe moves for this revert (DR-25; checked by the caller).
 * Rejects with ApplyRecordError before anything is changed when a record or the plan fails its checks.
 */
export async function revertApplyRun(workspaceRoot: string, runId: string, journal: string, dryRun: boolean, consent = false): Promise<RevertOutcome> {
  const mode = { dryRun, consent: consent && !dryRun };
  const { planRunId, digest, items } = applyRecords(journal, runId);
  const reverted: RevertedFile[] = [];
  const skipped: SkippedFile[] = [];
  if (items.length === 0) return { reverted, skipped };

  const plan = await trustedPlan(workspaceRoot, planRunId, digest);
  for (const item of items) {
    const planned = plan[item.index];
    if (planned === undefined || planned.kind !== item.kind || planned.sha256 !== item.sha256) bad();
  }
  let workspace: Workspace | null;
  try {
    workspace = await createWorkspace({ root: workspaceRoot });
  } catch {
    workspace = null;
  }
  const discardedRoot = discardedRootPath(workspaceRoot, runId);
  const discarded = (await isPlainDirectory(dirname(discardedRoot))) && (await isPlainDirectory(discardedRoot)) ? discardedRoot : null;

  for (const item of [...items].reverse()) {
    const planned = plan[item.index] as ResolvedPlanAction;
    let outcome: Outcome;
    try {
      if (workspace === null) {
        outcome = { reason: "io_error" };
      } else if (planned.kind === "move") {
        const away = await resolved(workspace, planned.to);
        const back = await resolved(workspace, planned.from);
        outcome = away === null || back === null ? { reason: "changed_since_run" } : await revertItem(away, back, item.sha256, item.recorded, "moved_back", mode);
      } else {
        const back = await resolved(workspace, planned.path);
        outcome =
          back === null
            ? { reason: "changed_since_run" }
            : discarded === null
              ? { reason: "io_error" }
              : await revertItem(join(discarded, discardedStoredName(item.index)), back, item.sha256, item.recorded, "restored_from_discard", mode);
      }
    } catch {
      outcome = { reason: "io_error" };
    }
    if ("unlisted" in outcome) continue;
    if ("action" in outcome) {
      const unsafe = outcome.unsafe === true ? { unsafe: true as const } : {};
      reverted.push(
        item.kind === "move" && item.shownTo !== null
          ? { path: item.shown, action: outcome.action, from: item.shownTo, ...unsafe }
          : { path: item.shown, action: outcome.action, ...unsafe },
      );
    } else {
      skipped.push({ path: item.shown, reason: outcome.reason });
    }
  }
  // DR-25: a dry run that lists a move back did not judge whether it can be made safely.
  return dryRun && reverted.length > 0 ? { reverted, skipped, moveSafetyUnchecked: true } : { reverted, skipped };
}
