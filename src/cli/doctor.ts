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

import type { ApiKeyEnv, CatalogText, DoctorText, MessageCatalog, MessageId, DoctorCheckStatus, DoctorOutput } from "../contracts/index.js";
import { createMessageCatalog } from "../i18n/index.js";
import { parseDoctorArgs } from "./args.js";
import { jsonLine } from "./guard.js";
import type { CommandOutcome } from "./guard.js";
import { argumentsError } from "../app/prepare.js";
import { displayWidth, padEnd } from "./human/index.js";
import { hideKeys } from "../app/input/text-safety.js";
import { checkDoctor } from "../app/doctor.js";
import type { DoctorCheckEnvironment } from "../app/doctor-types.js";
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

export function runDoctor(io: DoctorEnvironment): Promise<CommandOutcome> {
  try {
    const parsed = parseDoctorArgs(io.argv);
    if (!parsed.ok) return Promise.resolve(argumentsError(parsed));
    const args = parsed.args;
    return checkDoctor(args, io, (checked): CommandOutcome => {
      if (!checked.ok) return checked.outcome;
      const { output, currentKey, platform } = checked;
      const text = args.json ? jsonLine(output) : renderDoctor(output, io.messages, platform, { terminal: io.stdoutIsTerminal === true, task: args.taskPath !== null, workspace: args.workspace !== null });
      return { text: hideKeys(text, currentKey), exitCode: output.exitCode };
    });
  } catch (failure) {
    return Promise.reject(failure);
  }
}
