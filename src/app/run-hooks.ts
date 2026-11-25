import { existsSync } from "node:fs";
import type { EngineResult, PrivacyGateway, RunApprovedPlan, RunTask } from "../contracts/index.js";
import { runApprovedPlan as engineRunApprovedPlan, runTask as engineRunTask } from "../engine/index.js";
import { createAppAssemble } from "./assemble.js";
import type { Assemble } from "./assembly.js";
import { createRunCancelSource } from "./cancel.js";
import { deliver, journalWithEvents } from "./events.js";
import { confirmThrough } from "./permission.js";
import type { RunLifeEnvironment } from "./run-life.js";
import type { AppEnvironment, RunObserver } from "./types.js";
import type { AppHooks } from "./app-hooks.js";

/**
 * The hooks of a run through the app, for the CLI's run environment: startRun's, and since U-218
 * those of the run that carries out an approved run plan (applyPlan).
 * - The assembly (createAppAssemble): DR-15's events from the records the engine appends, masked
 *   again with the run's gateway, to `observer`; U-108's permission questions to `observer.confirm`;
 *   U-193's lockLeft.
 * - The start gate (adapter-contract 5.1): `started` gives the run id and workspace once the run
 *   is assembled; the engine (runTask, or runApprovedPlan for an approved plan) waits for `open`,
 *   which the caller calls after it handed out the handle, so the id is known before the first event.
 * - The cancel channel: no signal handler on the process; the CLI's two signal sources become
 *   `cancel`, and the cancel file, when requested, is watched as in the CLI (P-2).
 */
export function appRunHooks(
  env: Record<string, string | undefined>,
  observer: RunObserver | undefined,
  environment: AppEnvironment,
  platform: NodeJS.Platform,
  hooks: Pick<AppHooks, "runTask" | "runApprovedPlan">,
  nextMacrotask: () => Promise<void>,
) {
  const cancelHandlers = new Set<() => void>();
  let reportStart: (value: { runId: string; workspaceRoot: string; privacy: PrivacyGateway }) => void = () => {};
  const started = new Promise<{ runId: string; workspaceRoot: string; privacy: PrivacyGateway }>((resolve) => {
    reportStart = resolve;
  });
  let openGate: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    openGate = resolve;
  });
  /** Notices of the engine's own result; the CLI may add more afterwards (Y-4). */
  let engineNotices: number | null = null;
  let assembledRun: { readonly privacy: PrivacyGateway; readonly workspaceRoot: string } | null = null;
  /** U-193: the run's lock could not be released at its end (told in the outcome, the result kept). */
  let lockLeft = false;
  const ownAssemble = createAppAssemble(
    env,
    platform,
    (assembled) => {
      assembledRun = assembled;
    },
    () => {
      lockLeft = true;
    },
  );
  const assemble: Assemble = async (input) => {
    const assembled = await ownAssemble(input);
    if (!assembled.ok || assembledRun === null) return assembled;
    const { privacy, workspaceRoot } = assembledRun;
    // DR-15: events from the records the engine appends, in memory, masked again with this gateway.
    const journal = journalWithEvents(assembled.deps.journal, observer, privacy);
    reportStart({ runId: input.runId, workspaceRoot, privacy });
    // U-108 (B-4, DR-3): the engine's permission questions go to the observer (permission.ts).
    return { ...assembled, deps: { ...assembled.deps, journal, confirm: confirmThrough(observer) } };
  };
  const runTask: RunTask = async (deps) => {
    await gate;
    await nextMacrotask();
    const ended = await (hooks.runTask ?? engineRunTask)(deps);
    engineNotices = ended.notices.length;
    return ended;
  };
  const runApprovedPlan: RunApprovedPlan = async (deps) => {
    await gate;
    await nextMacrotask();
    const ended = await (hooks.runApprovedPlan ?? engineRunApprovedPlan)(deps);
    engineNotices = ended.notices.length;
    return ended;
  };
  const cancelSignal: RunLifeEnvironment["cancelSignal"] = (cancelFile) =>
    createRunCancelSource({
      cancelFile,
      fileExists: (file) => existsSync(file),
      onSignal: (name, handler) => {
        // U-293 (C-6a, 6.2): the process's signals too, when the adapter listens to them (AppEnvironment.onSignal, the CLI).
        // Codex V-31 L-1: kept for handle.cancel only once that registration worked, and taken out
        // before the adapter's removal is called (cancel.ts tries each removal on its own).
        const off = environment.onSignal?.(name, handler);
        cancelHandlers.add(handler);
        return () => {
          cancelHandlers.delete(handler);
          off?.();
        };
      },
    });
  return {
    parts: { assemble, runTask, runApprovedPlan, cancelSignal },
    started,
    open: (): void => openGate(),
    cancel: (): void => {
      for (const handler of [...cancelHandlers]) handler();
    },
    /** The run's end, from the CLI's result: the notices the CLI added are delivered; whether the lock was left. */
    ended: (output: EngineResult): { readonly lockLeft: boolean } => {
      if (engineNotices !== null) {
        for (const text of output.notices.slice(engineNotices)) deliver(observer, { kind: "notice", text });
      }
      return { lockLeft };
    },
  };
}
