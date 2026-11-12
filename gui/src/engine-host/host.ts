/**
 * The engine host's request handling (DR-26, docs/design/standalone-gui.md 4.2). It calls app
 * layer functions only (src/app) and answers each request line with one response line. The app
 * and the message catalog are passed in, so unit tests run it with fakes and without Electron.
 */

import { isAbsolute } from "node:path";
import { CHANNEL_ERRORS, LineDecoder, encodeLine, parseRequest } from "../shared/protocol.js";
import type { HostCall, HostError, HostResponse } from "../shared/protocol.js";
import { revertValue, runsValue } from "./history.js";
import type { PlanApplyOf } from "./history.js";
import { changesValue, planValue, reviewValue } from "./plans.js";
import { reportValue } from "./report.js";
import { createRunRegistry, taskForm } from "./runs.js";
import type { HostApplyRequest, HostStartRunRequest, HostTaskForm, RunItemOf } from "./runs.js";
import { modelsValue, proposalValue, selectedValue, settingsValue, writtenValue } from "./settings.js";
import type { ApiProviderEntry } from "./settings.js";
import { applySettingsEdit, parseSettingsEdit } from "../shared/settings-edit.js";
import { copyableText } from "../shared/ipc.js";
import { isCleanupTimestamp, parseCleanupSelection } from "../shared/cleanup.js";
import type { CleanupSelectionArg } from "../shared/cleanup.js";
import { appliedValue, previewValue, summaryValue } from "./cleanup.js";
import { reportMarkdownValue } from "./report.js";
import { initValue, suggestionsValue } from "./setup.js";
import type { Shown } from "./settings.js";
import type { ModelText } from "./model-text.js";

/** The `DoctorRequest` of the app layer (src/app/types.ts). The GUI passes no config, vars or task file yet. */
export interface HostDoctorRequest {
  readonly configPath: null;
  readonly varsFile: null;
  readonly taskPath: null;
  readonly workspace: string | null;
}

/** `ListModelsRequest` (src/app/types.ts). The GUI uses the settings a run would use (no --config, no vars file). */
export interface HostModelsRequest {
  readonly provider: string;
  readonly configPath: null;
  readonly varsFile: null;
}

/** The part of `CodarynApp` (src/app/types.ts) this host calls. */
export interface HostApp {
  doctor(request: HostDoctorRequest): Promise<unknown>;
  readSettings(request: { readonly configPath: null }): Promise<unknown>;
  /** A real API request (Y-2): only when the person asked for the list. */
  listModels(request: HostModelsRequest): Promise<unknown>;
  selectModel(request: HostModelsRequest & { readonly model: string }): Promise<unknown>;
  /** GU-3: `startRun` with the quick form; the observer gets the run's events (RunEvent). */
  startRun(request: HostStartRunRequest, observer: { onEvent(event: unknown): void }): Promise<unknown>;
  /** GU-4: the run list (N-7) and a revert, dry run or not (N-7, AC 5.5). */
  listRuns(request: { readonly workspace: string; readonly limit: number }): Promise<unknown>;
  /** DR-25: `unsafeMoveConsent` only after the person agreed in the main process's dialog, naming this run. */
  revert(request: { readonly workspace: string; readonly runId: string; readonly dryRun: boolean; readonly unsafeMoveConsent: { readonly runId: string } | null }): Promise<unknown>;
  /** GU-5: the plan view, its apply (DR-1, DR-2, DR-21) and a person's review (GT-D6). */
  plan(request: { readonly settings: HostTaskForm; readonly runId: string }): Promise<unknown>;
  applyPlan(request: HostApplyRequest, observer: { onEvent(event: unknown): void }): Promise<unknown>;
  review(request: { readonly settings: HostTaskForm; readonly runId: string; readonly decision: "accept" | "reject"; readonly note: string | null }): Promise<unknown>;
  /** DR-7, DR-29: a run's changed files, masked with the task form's secrets (paths and states go on). */
  changes(request: { readonly settings: HostTaskForm; readonly runId: string }): Promise<unknown>;
  /** GU-3 (3.7): a run's report (ReportOutput), read only. */
  report(request: { readonly workspace: string; readonly runId: string }): Promise<unknown>;
  /** U-11 (3.11): the config file with the defaults (init without questions), and init's fixed suggestions for a workspace. */
  createSettings(request: { readonly configPath: null; readonly workspace: string | null }): Promise<unknown>;
  settingsSuggestions(request: { readonly workspace: string }): Promise<unknown>;
  /** GU-3 (3.7): the report as `codaryn report` prints it (Markdown), for saving. */
  reportMarkdown(request: { readonly workspace: string; readonly runId: string }): Promise<unknown>;
  /** GU-4 (3.8), DR-39, DR-44: the state directory summed up, a cleanup preview, and a confirmed cleanup. */
  stateSummary(request: { readonly workspace: string }): Promise<unknown>;
  previewCleanup(request: { readonly workspace: string; readonly selection: CleanupSelectionArg }): Promise<unknown>;
  applyCleanup(request: {
    readonly workspace: string;
    readonly selection: CleanupSelectionArg;
    readonly now: string;
    readonly confirmation: { readonly digest: string; readonly discarded: boolean; readonly includeNotReverted: boolean };
  }): Promise<unknown>;
  /** GU-6 (3.10): a settings change, proposed (the app layer judges what widens) and written. */
  proposeSettingsChange(request: { readonly configPath: null; readonly next: unknown }): Promise<unknown>;
  applySettingsChange(request: { readonly configPath: null; readonly next: unknown; readonly baseDigest: string; readonly confirmWidening: boolean }): Promise<unknown>;
}

/** Texts from the shared catalog (src/i18n), in the language the CLI would choose. */
export interface HostMessages {
  texts(osLocale: string | null, ids: readonly string[]): { readonly language: string; readonly texts: Readonly<Record<string, string>> };
}

/** GU-2: one directory of a workspace (tree.ts). */
export type HostTree = (request: { readonly workspace: string; readonly dir: string; readonly offset: number }) => Promise<unknown>;

export interface HostDeps {
  readonly app: HostApp;
  readonly messages: HostMessages;
  readonly tree: HostTree;
  /** Text from a file or the API as the window may show it (control characters and key shapes hidden). */
  readonly shown: Shown;
  /**
   * A file text as the window may show it: CRLF as LF, line breaks and tabs kept, other control
   * characters and key shapes hidden. Absent in tests: each line then passes `shown`.
   */
  readonly shownText?: Shown;
  /**
   * U-32: a model's text (a plan's summary) as rows for people, by the app layer's modelTextRows
   * (U-48, model-text.ts). Absent (an engine without it, tests): no model text is shown.
   */
  readonly modelText?: ModelText;
  /** U-61 (U-16): the contract's planApplyStateOf; absent (an older engine, tests): no plan apply state. */
  readonly planApplyOf?: PlanApplyOf;
  /** The model providers the app layer connects (CONNECTED_MODEL_PROVIDERS, DR-22). */
  readonly providers: readonly string[];
  /** GU-6: whether an environment variable is set now (never its value); absent: none is. */
  readonly envSet?: (name: string) => boolean;
  /** PM (a): the test transport (loopback-only) and its count of refused requests; absent: real. */
  readonly transport?: () => { readonly mode: "loopback-only" | "real"; readonly refused: number };
  /** The contract's API provider table (API_PROVIDERS): names and variable names. Absent: none. */
  readonly apiProviders?: readonly ApiProviderEntry[];
  /** GU-3: how a run's events become progress items, in the window's language. */
  readonly itemsIn: (language: "ko" | "en") => RunItemOf;
  /** GU-3: a new run token (128 random bits as hex). */
  readonly token: () => string;
  /** Writes one complete line to the channel. */
  readonly write: (line: string) => void;
  /** Diagnostics for stderr. Never the content of a request or a response. */
  readonly log: (text: string) => void;
  /**
   * R-10 L-2: called once when the input ends, which means the main process is gone or closing.
   * Whatever is still running is to stop now (GU-3 cancels its runs here).
   */
  readonly onInputEnd?: () => void;
}

/** How long `serve` waits for running calls after the input ended (R-10 L-2). */
export const INPUT_END_GRACE_MS = 1_000;

const MAX_PATH_CHARS = 4096;
const MAX_MESSAGE_IDS = 200;
const MESSAGE_ID = /^[a-z][a-z0-9_.-]{0,79}$/;
const LOCALE = /^[A-Za-z0-9_-]{1,64}$/;

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Obj, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

class ArgsError extends Error {}

function doctorArgs(args: unknown): HostDoctorRequest {
  if (!isObj(args) || !onlyKeys(args, ["workspace"])) throw new ArgsError();
  const workspace = args["workspace"] ?? null;
  if (workspace !== null && (typeof workspace !== "string" || workspace.length > MAX_PATH_CHARS || !isAbsolute(workspace) || workspace.includes("\0"))) {
    throw new ArgsError();
  }
  return { configPath: null, varsFile: null, taskPath: null, workspace };
}

function treeArgs(args: unknown): { workspace: string; dir: string; offset: number } {
  if (!isObj(args) || !onlyKeys(args, ["workspace", "dir", "offset"])) throw new ArgsError();
  const { workspace, dir, offset } = args;
  if (typeof workspace !== "string" || workspace.length > MAX_PATH_CHARS || !isAbsolute(workspace) || workspace.includes("\0")) throw new ArgsError();
  if (typeof dir !== "string" || dir.length > MAX_PATH_CHARS || dir.includes("\0")) throw new ArgsError();
  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0) throw new ArgsError();
  return { workspace, dir, offset };
}

/** A call that takes no arguments: `{}`. */
function noArgs(args: unknown): void {
  if (!isObj(args) || Object.keys(args).length > 0) throw new ArgsError();
}

/** A model id as the API gives it: printable ASCII without spaces. */
const MODEL_ID = /^[!-~]{1,200}$/;

function providerArg(args: unknown, providers: readonly string[], keys: readonly string[]): Obj & { provider: string } {
  if (!isObj(args) || !onlyKeys(args, keys)) throw new ArgsError();
  const provider = args["provider"];
  if (typeof provider !== "string" || !providers.includes(provider)) throw new ArgsError();
  return args as Obj & { provider: string };
}

/** The longest goal the window may send (the CLI's own checks still run in startRun). */
const MAX_GOAL_CHARS = 20_000;
/** A profile or task kind name: one short line without control characters. */
const NAME = /^[^\u0000-\u001f\u007f]{1,200}$/;

function startRunArgs(args: unknown): { workspace: string; goal: string; profile: string | null; workflowRef: string | null; language: "ko" | "en" } {
  if (!isObj(args) || !onlyKeys(args, ["workspace", "goal", "profile", "workflowRef", "language"])) throw new ArgsError();
  const { workspace, goal, language } = args;
  const profile = args["profile"] ?? null;
  const workflowRef = args["workflowRef"] ?? null;
  if (typeof workspace !== "string" || workspace.length > MAX_PATH_CHARS || !isAbsolute(workspace) || workspace.includes("\0")) throw new ArgsError();
  if (typeof goal !== "string" || goal.trim().length === 0 || goal.length > MAX_GOAL_CHARS || goal.includes("\0")) throw new ArgsError();
  if (profile !== null && (typeof profile !== "string" || !NAME.test(profile))) throw new ArgsError();
  if (workflowRef !== null && (typeof workflowRef !== "string" || !NAME.test(workflowRef))) throw new ArgsError();
  if (language !== "ko" && language !== "en") throw new ArgsError();
  return { workspace, goal, profile, workflowRef, language };
}

/** How many runs the list asks for (RUNS_MAX_LIMIT of the app layer is larger). */
const RUN_LIST_LIMIT = 200;
const RUN_ID = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/;

/** A review note's longest length (MAX_REVIEW_NOTE_CHARS of the contract; the CLI checks it again). */
const MAX_NOTE_CHARS = 500;

/** A profile name or null. */
function nameArg(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !NAME.test(value)) throw new ArgsError();
  return value;
}

function workspaceArg(args: Obj, keys: readonly string[]): string {
  if (!onlyKeys(args, keys)) throw new ArgsError();
  const workspace = args["workspace"];
  if (typeof workspace !== "string" || workspace.length > MAX_PATH_CHARS || !isAbsolute(workspace) || workspace.includes("\0")) throw new ArgsError();
  return workspace;
}

function messagesArgs(args: unknown): { osLocale: string | null; ids: string[] } {
  if (!isObj(args) || !onlyKeys(args, ["osLocale", "ids"])) throw new ArgsError();
  const osLocale = args["osLocale"] ?? null;
  if (osLocale !== null && (typeof osLocale !== "string" || !LOCALE.test(osLocale))) throw new ArgsError();
  const ids = args["ids"];
  if (!Array.isArray(ids) || ids.length > MAX_MESSAGE_IDS || !ids.every((id) => typeof id === "string" && MESSAGE_ID.test(id))) throw new ArgsError();
  return { osLocale, ids: ids as string[] };
}

export interface HostHandler {
  /** Handles one request line. Resolves after its response line is written. */
  handleLine(line: string): Promise<void>;
  /** Cancels every run this handler started (the main process is gone, R-10 L-2). */
  cancelAll(): void;
}

export function createHostHandler(deps: HostDeps): HostHandler {
  const respond = (response: HostResponse): void => deps.write(encodeLine(response));
  const fail = (id: number, error: HostError): void => respond({ v: 1, id, ok: false, error });
  /** File texts and evidence keep their lines; without the host's own cleaner each line passes `shown`. */
  const shownText = deps.shownText ?? ((text: string) => text.split(/\r?\n/).map(deps.shown).join("\n"));
  const items = new Map<"ko" | "en", RunItemOf>();
  let language: "ko" | "en" = "en";
  const runs = createRunRegistry({
    startRun: (request, observer) => deps.app.startRun(request, observer),
    applyPlan: (request, observer) => deps.app.applyPlan(request, observer),
    itemOf: (event) => {
      let of = items.get(language);
      if (of === undefined) {
        of = deps.itemsIn(language);
        items.set(language, of);
      }
      return of(event);
    },
    shown: deps.shown,
    shownText,
    token: deps.token,
    write: deps.write,
    log: deps.log,
  });

  async function run(call: HostCall, args: unknown): Promise<unknown> {
    switch (call) {
      case "doctor":
        return deps.app.doctor(doctorArgs(args));
      case "messages": {
        const { osLocale, ids } = messagesArgs(args);
        return deps.messages.texts(osLocale, ids);
      }
      case "tree":
        return deps.tree(treeArgs(args));
      case "settings":
        noArgs(args);
        return settingsValue(await deps.app.readSettings({ configPath: null }), deps.shown, deps.providers, deps.envSet, deps.apiProviders);
      case "listModels": {
        const { provider } = providerArg(args, deps.providers, ["provider"]);
        return modelsValue(provider, await deps.app.listModels({ provider, configPath: null, varsFile: null }), deps.shown);
      }
      case "selectModel": {
        const { provider, model } = providerArg(args, deps.providers, ["provider", "model"]);
        if (typeof model !== "string" || !MODEL_ID.test(model)) throw new ArgsError();
        return selectedValue(await deps.app.selectModel({ provider, configPath: null, varsFile: null, model }), deps.shown);
      }
      case "startRun": {
        const { language: chosen, ...rest } = startRunArgs(args);
        language = chosen;
        return runs.start(rest);
      }
      case "listRuns": {
        if (!isObj(args)) throw new ArgsError();
        const workspace = workspaceArg(args, ["workspace"]);
        return runsValue(await deps.app.listRuns({ workspace, limit: RUN_LIST_LIMIT }), deps.shown, deps.planApplyOf);
      }
      case "revert": {
        // The window never names "latest": a run id the person chose from the list (3.8).
        if (!isObj(args)) throw new ArgsError();
        const workspace = workspaceArg(args, ["workspace", "runId", "dryRun", "consent"]);
        const { runId, dryRun } = args;
        const consent = args["consent"] ?? false;
        if (typeof runId !== "string" || !RUN_ID.test(runId) || typeof dryRun !== "boolean" || typeof consent !== "boolean") throw new ArgsError();
        // DR-25: a dry run moves nothing and takes no consent; a consent names this run only.
        if (consent && dryRun) throw new ArgsError();
        return revertValue(await deps.app.revert({ workspace, runId, dryRun, unsafeMoveConsent: consent ? { runId } : null }), deps.shown);
      }
      case "plan": {
        if (!isObj(args)) throw new ArgsError();
        const workspace = workspaceArg(args, ["workspace", "profile", "workflowRef", "runId"]);
        const profile = nameArg(args["profile"]);
        const workflowRef = nameArg(args["workflowRef"]);
        const runId = args["runId"];
        if (typeof runId !== "string" || !RUN_ID.test(runId)) throw new ArgsError();
        return planValue(await deps.app.plan({ settings: taskForm(workspace, profile, workflowRef), runId }), deps.shown, deps.modelText);
      }
      case "applyPlan": {
        if (!isObj(args)) throw new ArgsError();
        const workspace = workspaceArg(args, ["workspace", "profile", "workflowRef", "planRunId", "digest", "consent", "language"]);
        const profile = nameArg(args["profile"]);
        const workflowRef = nameArg(args["workflowRef"]);
        const { planRunId, digest, consent, language: chosen } = args;
        if (typeof planRunId !== "string" || !RUN_ID.test(planRunId) || typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)) throw new ArgsError();
        if (typeof consent !== "boolean" || (chosen !== "ko" && chosen !== "en")) throw new ArgsError();
        language = chosen;
        return runs.startApply({ workspace, profile, workflowRef, planRunId, digest, consent });
      }
      case "changes": {
        if (!isObj(args)) throw new ArgsError();
        const workspace = workspaceArg(args, ["workspace", "profile", "workflowRef", "runId"]);
        const profile = nameArg(args["profile"]);
        const workflowRef = nameArg(args["workflowRef"]);
        const runId = args["runId"];
        if (typeof runId !== "string" || !RUN_ID.test(runId)) throw new ArgsError();
        return changesValue(await deps.app.changes({ settings: taskForm(workspace, profile, workflowRef), runId }), deps.shown, shownText);
      }
      case "copyCheck": {
        // U-62 (6.4): whether this host's own hiding (control characters, key shapes, every key value
        // now set) leaves the text as it is; only then does the main process copy it. Nothing is kept.
        if (!isObj(args) || Object.keys(args).length !== 1) throw new ArgsError();
        const text = copyableText(args["text"]);
        if (text === null) throw new ArgsError();
        return { ok: true, clean: deps.shown(text) === text };
      }
      case "transport":
        // PM (a): the test transport's mode and how many requests to another machine it refused.
        if (!isObj(args) || Object.keys(args).length > 0) throw new ArgsError();
        return deps.transport?.() ?? { mode: "real", refused: 0 };
      case "proposeSettings": {
        if (!isObj(args) || !onlyKeys(args, ["edit"])) throw new ArgsError();
        const edit = parseSettingsEdit(args["edit"]);
        if (edit === null) throw new ArgsError();
        if (edit.op === "provider" && edit.value !== null && !(deps.apiProviders ?? []).some((entry) => entry.name === edit.value)) throw new ArgsError();
        const read = await deps.app.readSettings({ configPath: null });
        const output = isObj(read) && read["ok"] === true && isObj(read["output"]) ? read["output"] : null;
        if (output === null) return { ok: false, code: "settings_unreadable" };
        const applied = applySettingsEdit(output["config"], edit, deps.shown);
        if (!applied.ok) return applied;
        return proposalValue(await deps.app.proposeSettingsChange({ configPath: null, next: applied.next }), applied.next, deps.shown);
      }
      case "applySettings": {
        if (!isObj(args) || !onlyKeys(args, ["next", "baseDigest", "confirmWidening"])) throw new ArgsError();
        const { next, baseDigest, confirmWidening } = args;
        if (!isObj(next) || typeof baseDigest !== "string" || !/^[0-9a-f]{64}$/.test(baseDigest) || typeof confirmWidening !== "boolean") throw new ArgsError();
        return writtenValue(await deps.app.applySettingsChange({ configPath: null, next, baseDigest, confirmWidening }), deps.shown);
      }
      case "createSettings": {
        if (!isObj(args) || !onlyKeys(args, ["workspace"])) throw new ArgsError();
        const workspace = args["workspace"] === null ? null : workspaceArg(args, ["workspace"]);
        return initValue(await deps.app.createSettings({ configPath: null, workspace }));
      }
      case "settingsSuggestions": {
        if (!isObj(args)) throw new ArgsError();
        return suggestionsValue(await deps.app.settingsSuggestions({ workspace: workspaceArg(args, ["workspace"]) }), deps.shown);
      }
      case "reportMarkdown": {
        if (!isObj(args)) throw new ArgsError();
        const workspace = workspaceArg(args, ["workspace", "runId"]);
        const runId = args["runId"];
        if (typeof runId !== "string" || !RUN_ID.test(runId)) throw new ArgsError();
        return reportMarkdownValue(await deps.app.reportMarkdown({ workspace, runId }), shownText);
      }
      case "stateSummary": {
        if (!isObj(args)) throw new ArgsError();
        return summaryValue(await deps.app.stateSummary({ workspace: workspaceArg(args, ["workspace"]) }));
      }
      case "previewCleanup": {
        if (!isObj(args)) throw new ArgsError();
        const workspace = workspaceArg(args, ["workspace", "selection"]);
        const selection = parseCleanupSelection(args["selection"]);
        if (selection === null) throw new ArgsError();
        return previewValue(await deps.app.previewCleanup({ workspace, selection }));
      }
      case "applyCleanup": {
        if (!isObj(args)) throw new ArgsError();
        const workspace = workspaceArg(args, ["workspace", "selection", "now", "confirmation"]);
        const selection = parseCleanupSelection(args["selection"]);
        const { now, confirmation } = args;
        if (selection === null || !isCleanupTimestamp(now) || !isObj(confirmation) || !onlyKeys(confirmation, ["digest", "discarded", "includeNotReverted"])) throw new ArgsError();
        const { digest, discarded, includeNotReverted } = confirmation;
        if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest) || typeof discarded !== "boolean" || typeof includeNotReverted !== "boolean") throw new ArgsError();
        return appliedValue(await deps.app.applyCleanup({ workspace, selection, now, confirmation: { digest, discarded, includeNotReverted } }));
      }
      case "report": {
        if (!isObj(args)) throw new ArgsError();
        const workspace = workspaceArg(args, ["workspace", "runId"]);
        const runId = args["runId"];
        if (typeof runId !== "string" || !RUN_ID.test(runId)) throw new ArgsError();
        return reportValue(await deps.app.report({ workspace, runId }), deps.shown, shownText);
      }
      case "review": {
        if (!isObj(args)) throw new ArgsError();
        const workspace = workspaceArg(args, ["workspace", "profile", "workflowRef", "runId", "decision", "note"]);
        const profile = nameArg(args["profile"]);
        const workflowRef = nameArg(args["workflowRef"]);
        const { runId, decision } = args;
        const note = args["note"] ?? null;
        if (typeof runId !== "string" || !RUN_ID.test(runId) || (decision !== "accept" && decision !== "reject")) throw new ArgsError();
        if (note !== null && (typeof note !== "string" || note.length > MAX_NOTE_CHARS)) throw new ArgsError();
        return reviewValue(await deps.app.review({ settings: taskForm(workspace, profile, workflowRef), runId, decision, note }));
      }
      case "cancelRun": {
        if (!isObj(args) || !onlyKeys(args, ["run"]) || typeof args["run"] !== "string" || !/^[0-9a-f]{32}$/.test(args["run"])) throw new ArgsError();
        return { ok: runs.cancel(args["run"]) };
      }
    }
  }

  return {
    cancelAll: () => runs.cancelAll(),
    async handleLine(line: string): Promise<void> {
      const parsed = parseRequest(line);
      if (!parsed.ok) {
        if (parsed.id !== null) fail(parsed.id, parsed.error);
        else deps.log("codaryn engine host: ignored a line that is not a request");
        return;
      }
      const { id, call, args } = parsed.request;
      let value: unknown;
      try {
        value = await run(call, args);
      } catch (error) {
        if (error instanceof ArgsError) {
          fail(id, { code: CHANNEL_ERRORS.invalidArgs, message: "the arguments do not fit the call" });
        } else {
          // The exception text can hold paths or record content; it is not passed on.
          deps.log(`codaryn engine host: the ${call} call failed`);
          fail(id, { code: CHANNEL_ERRORS.hostError, message: "the engine host failed on this call" });
        }
        return;
      }
      try {
        respond({ v: 1, id, ok: true, value });
      } catch {
        fail(id, { code: CHANNEL_ERRORS.hostError, message: "the answer could not be sent" });
      }
    },
  };
}

/**
 * Reads request lines from `input` until it ends and answers each. Requests run concurrently.
 * When the input ends (the main process is gone or closing, DR-8) it tells `onInputEnd` and waits
 * for running calls at most `graceMs`; their answers have nobody to read them, so the host does not
 * stay for them (R-10 L-2).
 */
export async function serve(
  input: AsyncIterable<string | Uint8Array>,
  deps: HostDeps,
  options: { readonly graceMs?: number } = {},
): Promise<void> {
  const handler = createHostHandler(deps);
  const running = new Set<Promise<void>>();
  const decoder = new LineDecoder(
    (line) => {
      const task = handler.handleLine(line).finally(() => running.delete(task));
      running.add(task);
    },
    () => deps.log("codaryn engine host: ignored a line longer than the limit"),
  );
  const text = new TextDecoder();
  for await (const chunk of input) {
    decoder.push(typeof chunk === "string" ? chunk : text.decode(chunk, { stream: true }));
  }
  decoder.end();
  handler.cancelAll();
  deps.onInputEnd?.();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const grace = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, options.graceMs ?? INPUT_END_GRACE_MS);
  });
  await Promise.race([Promise.all(running), grace]);
  clearTimeout(timer);
}
