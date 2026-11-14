/**
 * `codaryn doctor [--config <file>] [--vars-file <file>] [--task <task.json> | --workspace <dir>] [--json]`
 * (U-6): checks what a run would need, without running one. No network access, no model request,
 * no write, and the process environment is not changed (the variables file is parsed, not loaded).
 *
 * Messages are built from fixed text, field positions and counts. No value read from a file or the
 * environment is printed: the API key is reported as set or not set only, and paths, names and
 * file contents are not echoed. Validation messages from the config and task parsers name fields
 * only, by the same rule. Printed text also passes `hideKeys`.
 */

import path from "node:path";
import { parseEnv } from "node:util";
import {
  API_PROVIDER_NAMES,
  API_PROVIDERS,
  CODARYN_CONFIG_ENV,
  DOCTOR_CHECK_IDS,
  DOCTOR_EXIT_CODES,
  CODARYN_LANG_ENV,
  LOCK_FILE_NAME,
  PARKED_DIR_NAME,
  STATE_DIR_NAME,
  mergeWorkflowPolicy,
  mergeWorkflowVerifiers,
  toApiOrigin,
  workflowPolicyNarrowings,
  workflowVerifierNarrowings,
  toSchemaFieldPath,
} from "../contracts/index.js";
import type {
  ApiKeyEnv,
  CatalogText,
  CodarynConfig,
  ConfigLocationDisplay,
  DoctorText,
  MessageCatalog,
  MessageId,
  SchemaFieldPath,
  DoctorCheck,
  DoctorCheckId,
  DoctorCheckStatus,
  DoctorOutput,
  ResolvedTaskSpec,
} from "../contracts/index.js";
import { createMessageCatalog } from "../i18n/index.js";
import { parseScript } from "../model/index.js";
// U-87: the transport's own key rule (S-11), as provider.ts takes the providers from this module.
import { isUsableApiKey } from "../model/anthropic/index.js";
import { resolveWorkflow, workflowDefinitions } from "../workflows/index.js";
import { parseDoctorArgs } from "./args.js";
import { parseConfig } from "../app/input/config.js";
import { chooseConfigFile, selectProfile } from "../app/input/config-file.js";
import { jsonLine } from "./guard.js";
import type { CommandOutcome } from "./guard.js";
import { argumentsError, cliError, workflowProblemText } from "../app/prepare.js";
import { normalizeApiBaseUrlStrict } from "../app/input/security/index.js";
import {
  configFieldOf,
  envValue,
  keyDestination,
  knownKeyValues,
  missingModelText,
  missingOutputCapText,
  modelPlaceholderSeen,
  providerSettingsOf,
  resolveModelId,
} from "../app/input/settings.js";
import type { SettingsEnvironment } from "../app/input/settings.js";
import { listParkedFiles } from "../store/index.js";
import { buildQuickTask, localPathProblem, parseTask, quickProvider } from "../app/input/task.js";
import { displayWidth, padEnd } from "./human/index.js";
import { hideKeys } from "../app/input/text-safety.js";
import { writablePathSetsOf } from "../app/input/writable.js";
import { UNREADABLE_PATHS_REQUIRED_TEXT, privateAnalysisWithoutData, runUnreadablePaths } from "../app/input/unreadable.js";

import { MODELS_HINT, MODEL_EXISTENCE_NOT_CHECKED, REQUIRED_NODE_MAJOR, loadJson, checkCommands, loadText, fieldOf, inspectLockFile, worst } from "../app/doctor-checks.js";
import type { CommandEntry } from "../app/doctor-checks.js";
import type { DoctorCheckEnvironment, LockState } from "../app/doctor-types.js";
export { MODELS_HINT, MODEL_EXISTENCE_NOT_CHECKED, REQUIRED_NODE_MAJOR, inspectLockFile } from "../app/doctor-checks.js";
export type { LockState } from "../app/doctor-types.js";

export interface DoctorEnvironment extends DoctorCheckEnvironment {
  readonly argv: readonly string[];
  /** N-21: the catalog for the text output in the chosen language. Absent: the English messages. */
  readonly messages?: MessageCatalog;
  /** U-115 (UXM-9): stdout is a terminal; then the text ends with what to do next. JSON is the same. */
  readonly stdoutIsTerminal?: boolean;
}

/** N-21: the text output in the catalog's language. Without a catalog (or a text), the English lines. */
/**
 * U-100 (design gap C-10, N-10, D-4): under a key check that says the variable is not set, the line
 * init gives for registering it on this operating system (init.key_hint_windows or
 * init.key_hint_posix). Neither puts a value in a command. For people only: the JSON is as before.
 */
/** U-100: init's registration line for a key variable. */
type KeyHint = { readonly id: "init.key_hint_windows" | "init.key_hint_posix"; readonly params: { readonly keyEnv: ApiKeyEnv } };

function keyHintOf(check: DoctorOutput["checks"][number], platform: NodeJS.Platform): KeyHint | null {
  if (check.id !== "api_key" || check.text === undefined || check.text.id !== "doctor.api_key.missing" || !("params" in check.text)) return null;
  const { keyEnv } = check.text.params as { keyEnv: ApiKeyEnv };
  return { id: platform === "win32" ? "init.key_hint_windows" : "init.key_hint_posix", params: { keyEnv } };
}

/**
 * The text of doctor. U-115 (UXM-9): with `terminal` (stdout is a terminal), what is not set up yet
 * and what to do next follow the closing line (nextStepLines); `task`: doctor was given --task;
 * U-132 (R-91 L-3): `workspace`: doctor was given --workspace.
 * Without it the text is as before, line for line.
 */
export function renderDoctor(
  output: DoctorOutput,
  messages?: MessageCatalog,
  platform: NodeJS.Platform = process.platform,
  options: { readonly terminal?: boolean; readonly task?: boolean; readonly workspace?: boolean } = {},
): string {
  const text = messages === undefined ? renderDoctorEnglish(output, platform) : renderDoctorLines(output, messages, platform);
  if (options.terminal !== true) return text;
  const next = nextStepLines(output, messages ?? createMessageCatalog("en"), options.task === true ? "task" : options.workspace === true ? "workspace" : "here");
  return next.length === 0 ? text : `${text}${next.join("\n")}\n`;
}

/**
 * U-115 (UXM-9): what is not set up yet and what to do next, from the checks' texts, numbered in a
 * fixed order: the config file (no file while the limits or the model fail: init, and the limits it
 * fills are not counted again; a file that fails: fix it), the key (not set, or holding a character that cannot be sent), the model
 * (not set or a placeholder; after the key when the key is a step), the other failed checks, the
 * warnings, then doctor again; with the key not set, the way to try without one. With nothing to
 * do, the next command (the warnings first, if any). U-132 (review R-91): with no default config
 * location at all, init with --config (L-1); after a key that cannot be sent, the model once its
 * value is fixed (L-4); the next command for what doctor checked: the task, the folder given with
 * --workspace (the quick form), or the folder the run starts in (L-3).
 */
function nextStepLines(output: DoctorOutput, catalog: MessageCatalog, checked: "task" | "workspace" | "here"): string[] {
  const raw = catalog.format as (id: MessageId, params?: object) => string;
  const say = (id: MessageId, params?: object): string => {
    try {
      return raw(id, params);
    } catch {
      return englishLine(params === undefined ? { id } : { id, params });
    }
  };
  const checkOf = (id: string) => output.checks.find((check) => check.id === id);
  const handled = new Set<string>();
  const steps: string[] = [];
  const configText = checkOf("config_file")?.text?.id;
  // No config file is a step only when a run would miss what it gives (a task file brings its own).
  const missesConfig = checkOf("limits")?.status === "fail" || checkOf("model")?.status === "fail";
  if ((configText === "doctor.config_file.default_missing" || configText === "doctor.config_file.none") && missesConfig) {
    // No default location at all: init cannot make one there, so the file goes where --config says.
    steps.push(say(configText === "doctor.config_file.none" ? "doctor.next.init_with_config" : "doctor.next.init"));
    handled.add("config_file").add("limits");
  } else if (checkOf("config_file")?.status === "fail") {
    steps.push(say("doctor.next.config_fix"));
    handled.add("config_file");
  }
  const key = checkOf("api_key")?.text;
  const keyEnv = key !== undefined && "params" in key ? (key.params as { readonly keyEnv?: unknown }).keyEnv : undefined;
  const keyMissing = key?.id === "doctor.api_key.missing" && typeof keyEnv === "string";
  const keyUnusable = key?.id === "doctor.api_key.unusable" && typeof keyEnv === "string";
  if (keyMissing || keyUnusable) {
    steps.push(say(keyMissing ? "doctor.next.key" : "doctor.next.key_unusable", { keyEnv }));
    handled.add("api_key");
  }
  const modelText = checkOf("model")?.text?.id;
  if (modelText === "doctor.model.missing" || modelText === "doctor.model.placeholder") {
    steps.push(say(keyMissing ? "doctor.next.model_after_key" : keyUnusable ? "doctor.next.model_after_key_fix" : "doctor.next.model"));
    handled.add("model");
  }
  const others = output.checks.filter((check) => check.status === "fail" && !handled.has(check.id)).length;
  if (others > 0) steps.push(say("doctor.next.other", { count: others }));
  const warnings = output.checks.filter((check) => check.status === "warn" && !handled.has(check.id)).length;
  if (steps.length > 0) {
    if (warnings > 0) steps.push(say("doctor.next.warnings", { count: warnings }));
    steps.push(say("doctor.next.again"));
    return [say("doctor.next.heading"), ...steps.map((step, index) => `  ${index + 1}. ${step}`), ...(keyMissing ? [say("first_use.try_without_key")] : [])];
  }
  const ready = say(checked === "task" ? "doctor.next.ready_task" : checked === "workspace" ? "doctor.next.ready_workspace" : "doctor.next.ready");
  return warnings > 0 ? [say("doctor.next.warnings", { count: warnings }), ready] : [ready];
}

function renderDoctorLines(output: DoctorOutput, messages: MessageCatalog, platform: NodeJS.Platform): string {
  const raw = messages.format as (id: MessageId, params?: object) => CatalogText;
  // A catalog without a text for an id (an older catalog) must not stop doctor: the English stays.
  const format = (id: MessageId, fallback: string, params?: object): string => {
    try {
      return raw(id, params);
    } catch {
      return fallback;
    }
  };
  const status = (value: DoctorCheckStatus): string => `[${format(`doctor.status.${value}`, value)}]`;
  const labels = output.checks.map((check) => format(`doctor.check.${check.id}`, check.id));
  // U-127: terminal columns (displayWidth), so a Korean label lines up as an English one does.
  const width = Math.max(...labels.map((label) => displayWidth(label)));
  const lines = output.checks.flatMap((check, index) => {
    // The check's own text; when the catalog has none, the message, which already holds the notes.
    let fromCatalog = check.text !== undefined;
    let body = check.message;
    if (check.text !== undefined) {
      try {
        body = raw(check.text.id, "params" in check.text ? check.text.params : undefined);
      } catch {
        fromCatalog = false;
      }
    }
    const first = `${padEnd(status(check.status), 10)}${padEnd(labels[index] ?? check.id, width)}  ${body}`;
    // DR-36 (b): each note on its own line under the check's text.
    const indent = " ".repeat(10 + width + 2);
    const notes = fromCatalog ? (check.notes ?? []).map((note) => `${indent}${format(note.id, noteEnglish(note), "params" in note ? note.params : undefined)}`) : [];
    const keyHint = keyHintOf(check, platform);
    const hint = keyHint === null ? [] : [`${indent}${format(keyHint.id, englishLine(keyHint), keyHint.params)}`];
    return [first, ...notes, ...hint];
  });
  const english = `doctor: ${output.status} (exit code ${output.exitCode}). No network access was made and nothing was changed.`;
  let footer: string;
  try {
    footer = raw("doctor.footer", { status: raw(`doctor.status.${output.status}`), exitCode: output.exitCode });
  } catch {
    footer = english;
  }
  lines.push("", footer);
  return `${lines.join("\n")}\n`;
}

/** The English of a note when the catalog has no text for it (the message already holds it). */
function noteEnglish(note: DoctorText): string {
  if (note.id === "doctor.model.other_provider_variable" && "params" in note) {
    const { variable, owner, provider } = note.params as { variable: string; owner: string; provider: string };
    return `${variable} is set but is ${owner}'s; an ${provider} run does not read it`;
  }
  return note.id;
}

/** The English catalog's text of a message and its parameters, or its id when that has none. */
function englishLine(text: { readonly id: MessageId; readonly params?: object }): string {
  try {
    return (createMessageCatalog("en").format as (id: MessageId, params?: object) => string)(text.id, text.params);
  } catch {
    return text.id;
  }
}

function renderDoctorEnglish(output: DoctorOutput, platform: NodeJS.Platform): string {
  const width = Math.max(...output.checks.map((check) => check.id.length));
  const lines = output.checks.flatMap((check) => {
    const line = `[${check.status}]`.padEnd(10) + `${check.id.padEnd(width)}  ${check.message}`;
    // U-100: the registration line, in English, under a missing key.
    const keyHint = keyHintOf(check, platform);
    return keyHint === null ? [line] : [line, `${" ".repeat(10 + width + 2)}${englishLine(keyHint)}`];
  });
  lines.push("", `doctor: ${output.status} (exit code ${output.exitCode}). No network access was made and nothing was changed.`);
  return `${lines.join("\n")}\n`;
}

export async function runDoctor(io: DoctorEnvironment): Promise<CommandOutcome> {
  const parsed = parseDoctorArgs(io.argv);
  if (!parsed.ok) return argumentsError(parsed);
  const args = parsed.args;
  const platform = io.platform ?? process.platform;

  // S-5: nothing given on the command line may reach another machine or a device.
  const given: [string | null, string][] = [
    [args.configPath, "--config"],
    [args.varsFile, "--vars-file"],
    [args.taskPath, "--task"],
    [args.workspace, "--workspace"],
  ];
  for (const [value, option] of given) {
    if (value === null) continue;
    const problem = localPathProblem(value, io.cwd);
    if (problem !== null) return cliError("invalid_arguments", `the path given by ${option} ${problem}`);
  }

  const results = new Map<DoctorCheckId, DoctorCheck>();
  // DR-36 (b): `notes` are further lines of the same check (absent when there are none).
  const set = (id: DoctorCheckId, status: DoctorCheckStatus, message: string, text: DoctorText, notes: readonly DoctorText[] = []): void => {
    results.set(id, { id, status, message, text, ...(notes.length === 0 ? {} : { notes }) });
  };

  // node_version
  const major = Number.parseInt(io.nodeVersion.split(".")[0] ?? "", 10);
  if (Number.isSafeInteger(major) && major >= REQUIRED_NODE_MAJOR) {
    set("node_version", "ok", `Node.js ${major} meets the requirement (${REQUIRED_NODE_MAJOR} or later)`, {
      id: "doctor.node_version.ok",
      params: { major, required: REQUIRED_NODE_MAJOR },
    });
  } else {
    set("node_version", "fail", `Node.js ${REQUIRED_NODE_MAJOR} or later is required`, { id: "doctor.node_version.fail", params: { required: REQUIRED_NODE_MAJOR } });
  }

  // vars_file: parsed, never loaded. Variables already set keep their values, as in `run`.
  let env: SettingsEnvironment = io.env;
  let varsPath: string | null = null;
  if (args.varsFile === null) {
    set("vars_file", "skipped", "no --vars-file given", { id: "doctor.vars_file.skipped" });
  } else {
    varsPath = path.resolve(io.cwd, args.varsFile);
    let text: string | null;
    try {
      text = await io.readFile(varsPath);
    } catch {
      text = null;
    }
    if (text === null) {
      set("vars_file", "fail", "the file given by --vars-file cannot be read", { id: "doctor.vars_file.unreadable" });
    } else if (text.charCodeAt(0) === 0xfeff) {
      set("vars_file", "fail", "the file given by --vars-file starts with a byte order mark; save it as UTF-8 without BOM", { id: "doctor.vars_file.bom" });
    } else {
      let loaded: Record<string, string | undefined>;
      try {
        loaded = parseEnv(text);
      } catch {
        loaded = {};
      }
      env = { ...loaded, ...io.env };
      const count = Object.keys(loaded).length;
      set("vars_file", "ok", `the file given by --vars-file defines ${count} variable(s)`, { id: "doctor.vars_file.ok", params: { count } });
    }
  }
  const currentKey = knownKeyValues(env);

  // config_file: --config, CODARYN_CONFIG, then the default location (N-1).
  let config: CodarynConfig | null = null;
  // U-182: the config file as parsed, before --profile (its own writable list, as a run sees it).
  let fileConfig: CodarynConfig | null = null;
  let configPath: string | null = null;
  // U-210, U-228: where the valid config file was found, for a later failure of its check.
  let configDisplay: ConfigLocationDisplay | null = null;
  const chosen = chooseConfigFile({ argument: args.configPath, env, cwd: io.cwd, defaultLocation: io.defaultConfig ?? null });
  const refusedNote = io.defaultConfigRefused === true ? "; the default location is a network or device path and is not used" : "";
  if (!chosen.ok) {
    set("config_file", "fail", `the path given by ${CODARYN_CONFIG_ENV} is not a plain local path`, { id: "doctor.config_file.env_not_local" });
  } else if (chosen.candidate === null) {
    if (io.defaultConfigRefused === true) {
      set("config_file", "warn", `no --config given and ${CODARYN_CONFIG_ENV} is not set${refusedNote}`, { id: "doctor.config_file.default_refused" });
    } else {
      set("config_file", "skipped", `no --config given, ${CODARYN_CONFIG_ENV} is not set and there is no default location`, { id: "doctor.config_file.none" });
    }
  } else {
    const candidate = chosen.candidate;
    const where = candidate.source === "default" ? ` at the default location ${candidate.display}` : "";
    const loaded = await loadJson(io, candidate.path, "config file", currentKey);
    if (!loaded.ok && candidate.optional && loaded.missing === true) {
      set(
        "config_file",
        "skipped",
        `no --config given, ${CODARYN_CONFIG_ENV} is not set and there is no file at the default location ${candidate.display}; \`codaryn init\` creates one`,
        { id: "doctor.config_file.default_missing", params: { location: candidate.display } },
      );
    } else if (!loaded.ok) {
      set("config_file", "fail", `${loaded.message}${where}`, loadText("config", loaded, candidate.display));
    } else {
      const outcome = parseConfig(loaded.value);
      if (outcome.ok) {
        config = outcome.config;
        fileConfig = outcome.config;
        configPath = loaded.path;
        configDisplay = candidate.display;
        // N-A 32.3 (0d38bfa): valid_at names the default location; a file given by --config or
        // CODARYN_CONFIG is valid_given (valid_at called every source "the default location").
        const validText: DoctorText =
          candidate.source === "default"
            ? { id: "doctor.config_file.valid_at", params: { location: candidate.display } }
            : { id: "doctor.config_file.valid_given", params: { location: candidate.display } };
        set("config_file", "ok", `the config file${where} is valid`, validText);
      } else {
        const field = fieldOf(outcome.position);
        set(
          "config_file",
          "fail",
          outcome.message,
          field === null
            ? { id: "doctor.config_file.invalid_unlocated", params: { location: candidate.display } }
            : { id: "doctor.config_file.invalid", params: { location: candidate.display, field } },
          // U-210 (R-110 M-1): k outside its range says why.
          outcome.hint === "min_group_size_range" ? [{ id: "doctor.private_data.min_group_size_range" }] : undefined,
        );
      }
    }
  }
  // N-8: --profile is checked against the config file as a run would. N-D 4.3: when the config
  // file itself failed, that failure stays the reason (a profile cannot be looked up in it).
  if (args.profile !== null && results.get("config_file")?.status !== "fail") {
    const selected = selectProfile(config, args.profile);
    if (selected.ok) config = selected.config;
    else set("config_file", "fail", selected.message, { id: "doctor.config_file.profile_missing" });
  }
  // U-210 (bundle A, P-1): the quick form under a profile whose task type is analyze-private, with no
  // unreadable path in the run (as run.ts unites them): a run refuses it at resolution.
  if (args.taskPath === null && args.profile !== null && configDisplay !== null && results.get("config_file")?.status === "ok") {
    const profileRef = config?.profiles?.[args.profile]?.workflowRef ?? null;
    if (privateAnalysisWithoutData(profileRef, { config: fileConfig, profile: args.profile, definition: undefined, taskFilePolicy: null })) {
      const field = toSchemaFieldPath("policy.unreadablePaths");
      set(
        "config_file",
        "fail",
        `policy.unreadablePaths ${UNREADABLE_PATHS_REQUIRED_TEXT}`,
        field === null ? { id: "doctor.config_file.invalid_unlocated", params: { location: configDisplay } } : { id: "doctor.config_file.invalid", params: { location: configDisplay, field } },
        // R-110 M-1: why.
        [{ id: "doctor.private_data.unreadable_paths_required" }],
      );
    }
  }

  // task_file
  let task: ResolvedTaskSpec | null = null;
  let taskPath: string | null = null;
  if (args.taskPath === null) {
    set("task_file", "skipped", "no --task given", { id: "doctor.task_file.skipped" });
  } else {
    const loaded = await loadJson(io, path.resolve(io.cwd, args.taskPath), "task file", currentKey);
    if (!loaded.ok) {
      set("task_file", "fail", loaded.message, loadText("task", loaded, "--config"));
    } else {
      const outcome = parseTask(loaded.value, path.dirname(loaded.path), { limits: config?.limits });
      if (outcome.ok) {
        task = outcome.task;
        taskPath = loaded.path;
        // U-210 (bundle A, P-1): its task type (else the profile's) is analyze-private and the run has
        // no unreadable path (as run.ts unites them): a run refuses the task at resolution.
        const ref = outcome.task.workflowRef ?? (args.profile === null ? null : (config?.profiles?.[args.profile]?.workflowRef ?? null));
        if (privateAnalysisWithoutData(ref, { config: fileConfig, profile: args.profile, definition: undefined, taskFilePolicy: outcome.task.policy })) {
          const field = toSchemaFieldPath("policy.unreadablePaths");
          // R-110 M-1: the note says why.
          set("task_file", "fail", `policy.unreadablePaths ${UNREADABLE_PATHS_REQUIRED_TEXT}`, field === null ? { id: "doctor.task_file.invalid_unlocated" } : { id: "doctor.task_file.invalid", params: { field } }, [
            { id: "doctor.private_data.unreadable_paths_required" },
          ]);
        } else {
          set("task_file", "ok", "the task file is valid", { id: "doctor.task_file.valid" });
        }
      } else {
        const field = fieldOf(outcome.position);
        // U-210 (R-110 M-1): k outside its range says why.
        const why = outcome.hint === "min_group_size_range" ? [{ id: "doctor.private_data.min_group_size_range" } as const] : undefined;
        set("task_file", "fail", outcome.message, field === null ? { id: "doctor.task_file.invalid_unlocated" } : { id: "doctor.task_file.invalid", params: { field } }, why);
      }
    }
  }
  const taskUnusable = args.taskPath !== null && task === null;
  // U-228 (U-224): a task type resolved to a plan mode without its plan tool, which a run refuses at
  // resolution (plan_tool_missing), as run.ts resolves it: the task's fields, else the profile's task
  // type. The check of the file to fix fails: the config file's for its task type (workflows) or a
  // profile, else the task file's. Other resolution problems are left to the run, as before.
  const resolutionProfileRef = args.profile === null ? null : (config?.profiles?.[args.profile]?.workflowRef ?? null);
  if (!taskUnusable && (task !== null || resolutionProfileRef !== null) && results.get("config_file")?.status !== "fail") {
    const resolved = resolveWorkflow({
      definitions: workflowDefinitions(config?.workflows),
      task: {
        ...(task?.workflowRef === undefined ? {} : { workflowRef: task.workflowRef }),
        ...(task?.tools === undefined ? {} : { tools: task.tools }),
        ...(task?.plan === undefined ? {} : { plan: task.plan }),
        ...(task?.completion === undefined ? {} : { completion: task.completion }),
        ...(task?.humanReview === undefined ? {} : { humanReview: task.humanReview }),
      },
      profileWorkflowRef: resolutionProfileRef,
      commandRules: task?.policy.commands.length ?? 0,
    });
    if (!resolved.ok && resolved.problem === "plan_tool_missing") {
      const message = `${resolved.field} ${workflowProblemText("plan_tool_missing")}`;
      const inConfig = task === null || resolved.field.startsWith("workflows") || resolved.field.startsWith("profiles");
      if (inConfig && configDisplay !== null) {
        set("config_file", "fail", message, { id: "doctor.config_file.plan_tool_missing", params: { location: configDisplay } });
      } else {
        set("task_file", "fail", message, { id: "doctor.task_file.plan_tool_missing" });
      }
    }
  }
  // SP-D3, SP-D10: the task's provider, else the quick form's (the profile's, else the file's, else
  // anthropic; the profile was laid over above).
  const provider = task?.model.provider ?? quickProvider(config);

  // api_key: present or not, nothing else.
  if (taskUnusable) {
    set("api_key", "skipped", "the task file could not be used", { id: "doctor.task_unusable" });
  } else if (provider === "scripted") {
    set("api_key", "skipped", "the task uses the scripted model; no key is needed", { id: "doctor.api_key.scripted" });
  } else {
    // The chosen provider's own key variable (API_PROVIDERS, SP-D12); the other known keys do not
    // count (SP-2 only hides them).
    const keyEnv = API_PROVIDERS[provider].keyEnv;
    const key = envValue(env, keyEnv);
    if (key !== null && !isUsableApiKey(key)) {
      // U-87 (C-12, PM): a key a request cannot carry. The run sends nothing and ends as a run
      // result (model_error, not_configured); doctor says so first. The reason only, never the value.
      set(
        "api_key",
        "fail",
        `${keyEnv} is set but holds a character other than printable ASCII (0x21-0x7E, no spaces); it cannot be sent, so an ${provider} run sends nothing and ends with model_error (not_configured)`,
        { id: "doctor.api_key.unusable", params: { keyEnv } },
      );
    } else if (key !== null) {
      // DR-34 (a), DR-36 (b): say where the key goes (the origin of the address, never its path) and
      // where that address is set, in the message and as the catalog text.
      const destination = keyDestination(env, config, provider);
      const origin = destination.kind === "invalid" ? null : toApiOrigin(destination.address);
      let where: string;
      let keyText: DoctorText = { id: "doctor.api_key.ok", params: { keyEnv } };
      // Review R-26 L-1: the config file gives the address (and the quick form's provider); when it
      // failed its checks it was set aside, so only an address variable still decides. Without one,
      // no destination is named (it was the default address, which may not be where runs go).
      const configSetAside = results.get("config_file")?.status === "fail";
      if (configSetAside && destination.kind !== "env" && destination.kind !== "invalid") {
        where = "where it is sent is not known until the config file passes its checks";
      } else if (destination.kind === "invalid") {
        where = `its address in ${destination.variable} is not valid (see the model check), so nothing is sent`;
        keyText = { id: "doctor.api_key.address_invalid", params: { keyEnv, variable: destination.variable } };
      } else if (origin === null) {
        // An address whose origin is not of the contract's shape is not echoed.
        where = `${provider} requests send it only to its own address`;
      } else if (destination.kind === "env") {
        where = `${provider} requests send it only to ${origin} (${destination.variable})`;
        keyText = { id: "doctor.api_key.sends_to_env", params: { keyEnv, provider, origin, variable: destination.variable } };
      } else if (destination.kind === "config") {
        where = `${provider} requests send it only to ${origin} (config ${destination.field})`;
        const field = toSchemaFieldPath(destination.field);
        if (field !== null) keyText = { id: "doctor.api_key.sends_to_config", params: { keyEnv, provider, origin, field } };
      } else {
        where = `${provider} requests send it only to ${origin} (the default address)`;
        keyText = { id: "doctor.api_key.sends_to_default", params: { keyEnv, provider, origin } };
      }
      set("api_key", "ok", `${keyEnv} is set; ${where}`, keyText);
    } else {
      set("api_key", "fail", `${keyEnv} is not set; an ${provider} run stops with provider_not_configured`, { id: "doctor.api_key.missing", params: { keyEnv, provider } });
    }
  }

  // model
  if (taskUnusable) {
    set("model", "skipped", "the task file could not be used", { id: "doctor.task_unusable" });
  } else if (task !== null && task.model.provider === "scripted") {
    const scriptPath = task.model.scriptPath;
    const loaded = await loadJson(io, scriptPath, "script file", currentKey);
    const script = loaded.ok ? parseScript(loaded.value) : null;
    if (!loaded.ok) set("model", "fail", loaded.message, loadText("script", loaded, "--config"));
    else if (script !== null && !script.ok) {
      const field = fieldOf(undefined, script.message);
      set("model", "fail", script.message, field === null ? { id: "doctor.model.script_invalid_unlocated" } : { id: "doctor.model.script_invalid", params: { field } });
    } else set("model", "ok", "the scripted model file is valid", { id: "doctor.model.scripted_ok" });
  } else if (provider !== "scripted") {
    // SP-4: the chosen API provider's model, cap and address (its config entry and path rule).
    // With a task, `provider` is its model.provider, so the task's model settings are this provider's.
    const fromTask = task !== null && task.model.provider !== "scripted" ? task.model : null;
    // N-3: a placeholder (blank or <...>) counts as not set at every level.
    const modelId = resolveModelId(fromTask?.model, env, config, provider);
    const maxOutputTokens = fromTask?.maxOutputTokens ?? providerSettingsOf(config, provider).maxOutputTokens ?? null;
    const missing: string[] = [];
    if (modelId === null) {
      missing.push(
        missingModelText(modelPlaceholderSeen(fromTask?.model, env, config, provider), configFieldOf(config, provider, "model"), API_PROVIDERS[provider].modelEnv),
      );
    }
    if (maxOutputTokens === null) missing.push(missingOutputCapText(configFieldOf(config, provider, "maxOutputTokens")));
    // DR-34 (a): the provider's own address variable.
    const baseUrlEnv = API_PROVIDERS[provider].baseUrlEnv;
    const baseUrl = envValue(env, baseUrlEnv);
    const baseUrlProblem = baseUrl === null ? null : normalizeApiBaseUrlStrict(baseUrl, baseUrlEnv, API_PROVIDERS[provider].baseUrlPath);
    const placeholder = modelPlaceholderSeen(fromTask?.model, env, config, provider);
    // N-A 33.3 (0d38bfa): the provider's model variable and the config places in the person's text.
    const placeOf = (field: "model" | "maxOutputTokens") => toSchemaFieldPath(configFieldOf(config, provider, field)) ?? (toSchemaFieldPath(field) as SchemaFieldPath);
    const missingText: DoctorText =
      modelId === null
        ? placeholder
          ? { id: "doctor.model.placeholder" }
          : { id: "doctor.model.missing", params: { variable: API_PROVIDERS[provider].modelEnv, field: placeOf("model") } }
        : { id: "doctor.model.output_cap_missing", params: { field: placeOf("maxOutputTokens") } };
    // SP-6, review R-19 I-4: another provider's model or address variable is not read by this run;
    // say so, so a value left for one provider is not silently ignored (names only, never values).
    // DR-36 (b): the same as notes, one catalog text per variable.
    const unread = API_PROVIDER_NAMES.filter((other) => other !== provider).flatMap((other) =>
      [API_PROVIDERS[other].modelEnv, API_PROVIDERS[other].baseUrlEnv]
        .filter((name) => envValue(env, name) !== null)
        .map((variable) => ({ variable, owner: other })),
    );
    const note = unread.map(({ variable, owner }) => `; ${variable} is set but is ${owner}'s; an ${provider} run does not read it`).join("");
    const notes: DoctorText[] = unread.map(({ variable, owner }) => ({ id: "doctor.model.other_provider_variable", params: { variable, owner, provider } }));
    if (missing.length > 0) set("model", "fail", `not set: ${missing.join("; ")}; ${MODELS_HINT}${note}`, missingText, notes);
    else if (baseUrlProblem !== null && !baseUrlProblem.ok) set("model", "fail", `${baseUrlProblem.message}${note}`, { id: "doctor.model.base_url_invalid" }, notes);
    else set("model", "ok", `the model and maxOutputTokens are set; ${MODEL_EXISTENCE_NOT_CHECKED}${note}`, { id: "doctor.model.ok" }, notes);
  }

  // limits
  if (taskUnusable) {
    set("limits", "skipped", "the task file could not be used", { id: "doctor.task_unusable" });
  } else if (task !== null) {
    set("limits", "ok", "every limit is set", { id: "doctor.limits.ok" });
  } else {
    const quick = buildQuickTask({ workspace: args.workspace ?? ".", goal: "doctor", cwd: io.cwd, config });
    if (quick.ok) set("limits", "ok", "every limit is set for the quick form", { id: "doctor.limits.ok_quick" });
    else {
      const field = fieldOf(quick.position);
      set("limits", "fail", quick.message, field === null ? { id: "doctor.limits.invalid_unlocated" } : { id: "doctor.limits.invalid", params: { field } });
    }
  }

  // workspace
  const workspaceRoot = task?.workspaceRoot ?? (args.workspace === null ? null : path.resolve(io.cwd, args.workspace));
  let workspaceReady = false;
  if (workspaceRoot === null) {
    set("workspace", "skipped", "no --workspace or --task given", { id: "doctor.workspace.skipped" });
  } else if (await io.isDirectory(workspaceRoot)) {
    workspaceReady = true;
    set("workspace", "ok", "the workspace is an existing directory", { id: "doctor.workspace.ok" });
  } else {
    set("workspace", "fail", "the workspace is not an existing directory", { id: "doctor.workspace.missing" });
  }

  // file_locations (S-1)
  if (!workspaceReady || workspaceRoot === null) {
    set("file_locations", "skipped", "no usable workspace", { id: "doctor.no_workspace" });
  } else {
    const files: [string | null, string][] = [
      [varsPath, "the file given by --vars-file"],
      [configPath, "the config file"],
      [taskPath, "the task file"],
      [task !== null && task.model.provider === "scripted" ? task.model.scriptPath : null, "the script file"],
    ];
    const inside: string[] = [];
    let checked = 0;
    for (const [file, label] of files) {
      if (file === null) continue;
      checked += 1;
      if ((await io.locateInWorkspace(file, workspaceRoot)) !== "outside") inside.push(label);
    }
    if (checked === 0) set("file_locations", "skipped", "no input file given", { id: "doctor.file_locations.no_input" });
    else if (inside.length > 0) {
      set("file_locations", "fail", `inside the workspace or not confirmable: ${inside.join(", ")}; a run refuses them`, {
        id: "doctor.file_locations.inside",
        params: { count: inside.length },
      });
    } else set("file_locations", "ok", `${checked} input file(s) are outside the workspace`, { id: "doctor.file_locations.ok", params: { count: checked } });
  }

  // commands
  // DR-41: where a workflow definition applies (the task's workflowRef, else the profile's), the
  // policy a run uses is the given one merged with the definition's (mergeWorkflowPolicy), and what
  // the merge left out is a note of the commands check. The quick form's given policy is the
  // profile's or the config's; a task file's is its own. DR-43 (a): its verifiers likewise, the
  // definition's always checked and the given ones added (mergeWorkflowVerifiers).
  const givenPolicy = task?.policy ?? (args.taskPath === null ? config?.policy : undefined);
  const profileRef = args.profile === null ? null : (config?.profiles?.[args.profile]?.workflowRef ?? null);
  const workflowRef = (task === null ? undefined : task.workflowRef) ?? profileRef;
  const definitions = workflowDefinitions(config?.workflows);
  const definition = workflowRef !== null && Object.hasOwn(definitions, workflowRef) ? definitions[workflowRef] : undefined;
  const policy = definition === undefined ? givenPolicy : (mergeWorkflowPolicy(definition.policy, givenPolicy) ?? givenPolicy);
  const givenVerifiers = task?.verifiers ?? (args.taskPath === null ? config?.verifiers : undefined);
  const narrowings =
    definition === undefined
      ? []
      : [...workflowPolicyNarrowings(definition.policy, givenPolicy), ...workflowVerifierNarrowings(definition.verifiers, givenVerifiers)];
  const policyNotes: DoctorText[] = narrowings.map((narrowing) =>
    narrowing.kind === "restore_path_tokens_off"
      ? { id: "doctor.workflow_policy.restore_path_tokens_off" }
      : { id: `doctor.workflow_policy.${narrowing.kind}`, params: { count: narrowing.count } },
  );
  const verifiers = (definition === undefined ? givenVerifiers : mergeWorkflowVerifiers(definition.verifiers, givenVerifiers)) ?? [];
  const commandEntries: CommandEntry[] = [];
  (policy?.commands ?? []).forEach((rule, index) =>
    commandEntries.push({ position: `policy.commands[${index}]`, executable: rule.executable, args: rule.argsPrefix, cwd: null }),
  );
  verifiers.forEach((verifier, index) => {
    if (verifier.kind === "command") {
      commandEntries.push({ position: `verifiers[${index}]`, executable: verifier.executable, args: verifier.args, cwd: verifier.cwd ?? "." });
    }
  });
  if (taskUnusable) {
    set("commands", "skipped", "the task file could not be used", { id: "doctor.task_unusable" });
  } else if (commandEntries.length === 0) {
    set("commands", "skipped", "no command is allowed and no command verifier is configured", { id: "doctor.commands.none" }, policyNotes);
  } else if (runUnreadablePaths({ config: fileConfig, profile: args.profile, definition, taskFilePolicy: task?.policy ?? null }).length > 0) {
    // U-210 (bundle A, R-5): the run's unreadable paths (as run.ts unites them) with command rules or
    // command verifiers: a run refuses to start, so the check fails without running the commands.
    const count = commandEntries.length;
    set(
      "commands",
      "fail",
      `command rules and command checks while unreadablePaths is set: ${count}; a run refuses them, since a command can read any file, the ones kept from the agent too`,
      { id: "doctor.commands.unreadable_with_commands", params: { count } },
      policyNotes,
    );
  } else {
    const checked = await checkCommands(io, commandEntries, env, workspaceReady ? workspaceRoot : null, platform);
    // U-182 (DR-69 B-8): writable lists bind the file tools only; an allowed command can write
    // anywhere it can. The lists a run would have (writablePathSetsOf, as run.ts builds them).
    const commandRules = (policy?.commands ?? []).length;
    const writableLists = writablePathSetsOf({ config: fileConfig, profile: args.profile, definition, taskFilePolicy: task?.policy ?? null });
    // U-195 (DR-69 B-8): likewise a plan of mode "run": its approved files bind the file tools only.
    // The task's plan, else the task type definition's (as resolveWorkflow resolves it).
    const planMode = task?.plan ?? definition?.plan ?? "none";
    const laterWarnings: { readonly message: string; readonly text: DoctorText }[] = [];
    if (commandRules > 0 && writableLists.length > 0) {
      laterWarnings.push({
        message: `${commandRules} command rule(s) while writablePaths limits the file tools; writablePaths does not bind commands, so an allowed command can write files outside it`,
        text: { id: "doctor.commands.writable_with_commands", params: { count: commandRules } },
      });
    }
    if (commandRules > 0 && planMode === "run") {
      laterWarnings.push({
        message: `${commandRules} command rule(s) with plan "run"; the approved files bind the file tools only, so an allowed command can write files outside the plan`,
        text: { id: "doctor.commands.plan_run_with_commands", params: { count: commandRules } },
      });
    }
    const withWritable = (message: string): string => [message, ...laterWarnings.map((warning) => warning.message)].join("; ");
    // A warning is the check's text when nothing else is said; otherwise one of its notes.
    const writableNotes: DoctorText[] = [...laterWarnings.map((warning) => warning.text), ...policyNotes];
    // G-F (general-tasks.md 7.1, PM answer Q5): rules that take any further arguments beside plan
    // actions. Codaryn does not check a command's arguments, so such a command can change files
    // outside an approved plan. Problems found above keep their text; the warning joins the message.
    const extraArgs = (policy?.commands ?? []).filter((rule) => rule.allowExtraArgs).length;
    if (extraArgs > 0 && (policy?.planActions ?? []).length > 0) {
      const warning =
        `${extraArgs} command rule(s) take any further arguments (allowExtraArgs) while plans may move or discard files ` +
        "(policy.planActions); Codaryn does not check those arguments, so such a command can change files outside an approved plan";
      if (checked.status === "ok") {
        set("commands", "warn", withWritable(warning), { id: "doctor.commands.extra_args_with_plan", params: { count: extraArgs } }, writableNotes);
      } else {
        set("commands", checked.status, withWritable(`${checked.message}; ${warning}`), checked.text, writableNotes);
      }
    } else if (laterWarnings.length > 0 && checked.status === "ok") {
      const [first, ...rest] = laterWarnings as [{ readonly message: string; readonly text: DoctorText }, ...{ readonly message: string; readonly text: DoctorText }[]];
      set("commands", "warn", laterWarnings.map((warning) => warning.message).join("; "), first.text, [...rest.map((warning) => warning.text), ...policyNotes]);
    } else {
      set("commands", checked.status, withWritable(checked.message), checked.text, writableNotes);
    }
  }

  // install_dir (U-3)
  if (!workspaceReady || workspaceRoot === null) {
    set("install_dir", "skipped", "no usable workspace", { id: "doctor.no_workspace" });
  } else if (io.installDir === undefined) {
    set("install_dir", "skipped", "the install directory is not known in this environment", { id: "doctor.install_dir.unknown_env" });
  } else if (io.installDir === null) {
    set("install_dir", "fail", "the CLI's install directory cannot be determined; a run refuses to start", { id: "doctor.install_dir.not_found" });
  } else {
    const relation = await io.relatePaths(workspaceRoot, io.installDir);
    if (relation === "separate") set("install_dir", "ok", "the workspace is outside the CLI's install directory", { id: "doctor.install_dir.ok" });
    else {
      set("install_dir", "fail", "the workspace is the CLI's install directory, lies inside it, contains it, or cannot be compared", {
        id: "doctor.install_dir.overlap",
      });
    }
  }

  // integrity_paths (U-1)
  const integrityPaths = config?.integrity?.paths ?? [];
  if (integrityPaths.length === 0) {
    set("integrity_paths", "skipped", "integrity.paths is not set", { id: "doctor.integrity_paths.skipped" });
  } else {
    const problems: string[] = [];
    for (const [index, entry] of integrityPaths.entries()) {
      const relation = workspaceReady && workspaceRoot !== null ? await io.relatePaths(entry, workspaceRoot) : await io.relatePaths(entry, entry);
      if (relation === "unknown") problems.push(`integrity.paths[${index}] does not exist`);
      else if (workspaceReady && relation !== "separate") problems.push(`integrity.paths[${index}] is not outside the workspace`);
    }
    const missingCount = problems.filter((problem) => problem.endsWith("does not exist")).length;
    const integrityCount = { count: integrityPaths.length };
    if (problems.length > 0) {
      set("integrity_paths", "fail", problems.join("; "), {
        id: "doctor.integrity_paths.problems",
        params: { missing: missingCount, inside: problems.length - missingCount },
      });
    } else if (workspaceReady) {
      set("integrity_paths", "ok", `${integrityPaths.length} path(s) exist outside the workspace`, { id: "doctor.integrity_paths.ok", params: integrityCount });
    } else {
      set("integrity_paths", "ok", `${integrityPaths.length} path(s) exist; give --workspace or --task to check their position`, {
        id: "doctor.integrity_paths.ok",
        params: integrityCount,
      });
    }
  }

  // language (N-20): which language the human output uses and where that came from.
  if (io.explainLanguage === undefined) {
    set("language", "skipped", "the language selection is not connected in this build", { id: "doctor.language.unchecked" });
  } else {
    const choice = io.explainLanguage({ env: env[CODARYN_LANG_ENV] ?? null, config: config?.language ?? null, osLocale: io.osLocale ?? null });
    if (choice.envIgnored) {
      set("language", "warn", `${CODARYN_LANG_ENV} is not ko or en and is ignored; messages use ${choice.language}`, {
        id: "doctor.language.env_ignored",
        params: { language: choice.language },
      });
    } else {
      set("language", "ok", `messages use ${choice.language} (from ${choice.source})`, {
        id: `doctor.language.from_${choice.source}`,
        params: { language: choice.language },
      });
    }
  }

  // lock (N-25 a): read only. A lock held by a live process may be a run in progress.
  if (!workspaceReady || workspaceRoot === null) {
    set("lock", "skipped", "no usable workspace", { id: "doctor.no_workspace" });
  } else {
    const state = await (io.inspectLock ?? ((root: string) => inspectLockFile(root, io.readFile)))(workspaceRoot);
    const lockMessages: { readonly [S in LockState]: readonly [DoctorCheckStatus, string] } = {
      none: ["ok", "no run holds the workspace lock"],
      held: ["warn", `a process holds ${STATE_DIR_NAME}/${LOCK_FILE_NAME}; if no Codaryn is running in this workspace, remove that file`],
      stale: ["ok", "the lock was left by a process that has ended; the next run reclaims it"],
      unreadable: ["warn", `${STATE_DIR_NAME}/${LOCK_FILE_NAME} cannot be read; if no Codaryn is running in this workspace, remove that file`],
      reclaim_left: [
        "warn",
        `${STATE_DIR_NAME}/${LOCK_FILE_NAME}.reclaim was left by an attempt to reclaim the lock; while it stays, a lock left by an ended process is not reclaimed. If no Codaryn is running in this workspace, remove ${STATE_DIR_NAME}/${LOCK_FILE_NAME}.reclaim (and ${STATE_DIR_NAME}/${LOCK_FILE_NAME} if it is there)`,
      ],
    };
    const [status, message] = lockMessages[state];
    // R-16 L-1: files a revert moved aside and could not put back stay in .codaryn/parked/ until the
    // person moves them back or deletes them. A lock problem keeps its text; the warning joins it.
    let parked: number;
    try {
      parked = (await (io.listParkedFiles ?? listParkedFiles)(workspaceRoot)).length;
    } catch {
      parked = 0;
    }
    const parkedWarning = `${parked} file(s) a revert could not put back are in ${STATE_DIR_NAME}/${PARKED_DIR_NAME}/; move them back or delete them`;
    const parkedText: DoctorText = { id: "doctor.lock.parked_left", params: { count: parked } };
    if (parked > 0 && status === "ok") {
      set("lock", "warn", parkedWarning, parkedText);
    } else {
      // DR-37 (c), review R-24 L-2: with another lock state the lock's own text stays, and the
      // parked files are its note, so the person's output names them too (not only the message).
      set("lock", status, parked > 0 ? `${message}; ${parkedWarning}` : message, { id: `doctor.lock.${state}` }, parked > 0 ? [parkedText] : []);
    }
  }

  const checks = DOCTOR_CHECK_IDS.map((id) => results.get(id) as DoctorCheck);
  const status = worst(checks);
  const output: DoctorOutput = { schemaVersion: 1, kind: "doctor", status, exitCode: DOCTOR_EXIT_CODES[status], checks };
  const text = args.json ? jsonLine(output) : renderDoctor(output, io.messages, platform, { terminal: io.stdoutIsTerminal === true, task: args.taskPath !== null, workspace: args.workspace !== null });
  return { text: hideKeys(text, currentKey), exitCode: output.exitCode };
}
