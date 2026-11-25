/** Reading commands for the app; the injected context and hooks are used only when called. */
import { createPrivacyGateway } from "../privacy/index.js";
import { readChanges } from "./changes.js";
import { appError } from "./errors.js";
import type { createReadingContext } from "./reading-context.js";
import { runIdOf, workspaceRootOf } from "./runs.js";
import { listWorkspaceDirIn, workspaceDirArguments } from "./workspace-dir.js";
import { listRunEventsIn, runEventsArguments } from "./run-events.js";
import { readWorkspaceTextArguments, readWorkspaceTextIn, writeWorkspaceTextArguments, writeWorkspaceTextIn } from "./workspace-text.js";
import type {
  AppCallOutcome,
  AppEnvironment,
  ChangesOptions,
  ChangesOutput,
  ChangesRequest,
  ListRunEventsRequest,
  ListWorkspaceDirRequest,
  ReadWorkspaceTextRequest,
  RunEventsPage,
  WorkspaceDirListing,
  WorkspaceText,
  WorkspaceTextWritten,
  WriteWorkspaceTextRequest,
} from "./types.js";
import type { AppHooks } from "./app-hooks.js";

export function createReadingCommands(
  readingSecrets: ReturnType<typeof createReadingContext>["readingSecrets"],
  workspaceTextSource: ReturnType<typeof createReadingContext>["workspaceTextSource"],
  environment: AppEnvironment,
  hooks: Pick<AppHooks, "changesRead" | "workspaceText">,
) {
  /** DR-7, DR-29: a run's changes. U-234 (R-107 O-1): `options.signal` is given to the reads of the current files. */
  async function changes(request: ChangesRequest, options: ChangesOptions = {}): Promise<AppCallOutcome<ChangesOutput>> {
    try {
      const probe = await readingSecrets(request.settings);
      if (!probe.ok) return probe;
      const root = await workspaceRootOf(probe.workspaceRoot, environment.cwd);
      if (!root.ok) return root;
      const runId = await runIdOf(root.value, request.runId);
      if (!runId.ok) return runId;
      return await readChanges(root.value, runId.value, createPrivacyGateway({ secrets: probe.secrets }), {
        ...hooks.changesRead,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    } catch {
      return { ok: false, error: appError("internal_error", "the changes could not be read") };
    }
  }

  /** U-89 (GUI 3.3, adapter-contract 5.12): one directory of the workspace (workspace-dir.ts). */
  async function listWorkspaceDir(request: ListWorkspaceDirRequest): Promise<AppCallOutcome<WorkspaceDirListing>> {
    // The request first: nothing is read for one that does not fit.
    const checked = workspaceDirArguments(request);
    if (!checked.ok) return checked;
    try {
      const probe = await readingSecrets(request.settings);
      if (!probe.ok) return probe;
      const root = await workspaceRootOf(probe.workspaceRoot, environment.cwd);
      if (!root.ok) return root;
      const source = { workspaceRoot: root.value, privacy: createPrivacyGateway({ secrets: probe.secrets }), keys: probe.keys, protectedPaths: probe.protectedPaths };
      return await listWorkspaceDirIn(source, checked.dir, checked.offset, checked.limit);
    } catch {
      return { ok: false, error: appError("internal_error", "the directory could not be listed") };
    }
  }

  /** U-172 (DR-72, adapter-contract 5.15): a workspace text file for a person, and whether it can be edited here (workspace-text.ts). */
  async function readWorkspaceText(request: ReadWorkspaceTextRequest): Promise<AppCallOutcome<WorkspaceText>> {
    // The request first: nothing is read for one that does not fit.
    const checked = readWorkspaceTextArguments(request);
    if (!checked.ok) return checked;
    try {
      const ready = await workspaceTextSource(request.settings);
      if (!ready.ok) return ready;
      return await readWorkspaceTextIn(ready.source, checked.path, hooks.workspaceText);
    } catch {
      return { ok: false, error: appError("internal_error", "the file could not be read") };
    }
  }

  /** U-172 (DR-72, adapter-contract 5.15): a person's edit, judged again under the workspace lock; no run record (workspace-text.ts). */
  async function writeWorkspaceText(request: WriteWorkspaceTextRequest): Promise<AppCallOutcome<WorkspaceTextWritten>> {
    // The request first: nothing is read or locked for one that does not fit.
    const checked = writeWorkspaceTextArguments(request);
    if (!checked.ok) return checked;
    try {
      const ready = await workspaceTextSource(request.settings);
      if (!ready.ok) return ready;
      return await writeWorkspaceTextIn(
        { ...ready.source, clock: environment.clock, randomBytes: environment.randomBytes },
        { path: checked.path, text: checked.text, baseDigest: checked.baseDigest },
        hooks.workspaceText,
      );
    } catch {
      return { ok: false, error: appError("internal_error", "the file could not be written") };
    }
  }

  /** U-90 (GUI 3.7, adapter-contract 5.13): one page of a run's stored records (run-events.ts). */
  async function listRunEvents(request: ListRunEventsRequest): Promise<AppCallOutcome<RunEventsPage>> {
    // The request first: nothing is read for one that does not fit.
    const checked = runEventsArguments(request);
    if (!checked.ok) return checked;
    try {
      const probe = await readingSecrets(request.settings);
      if (!probe.ok) return probe;
      const root = await workspaceRootOf(probe.workspaceRoot, environment.cwd);
      if (!root.ok) return root;
      const source = { workspaceRoot: root.value, privacy: createPrivacyGateway({ secrets: probe.secrets }), keys: probe.keys };
      return await listRunEventsIn(source, checked.runId, checked.offset, checked.limit, checked.types);
    } catch {
      return { ok: false, error: appError("internal_error", "the run's records could not be listed") };
    }
  }

  return { changes, listWorkspaceDir, readWorkspaceText, writeWorkspaceText, listRunEvents };
}
