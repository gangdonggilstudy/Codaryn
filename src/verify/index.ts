/**
 * Verifier runner: `command` (exit code) and `file_rules` (literal file checks).
 * Nothing here uses Git. Every path goes through `Workspace.resolve`.
 */

import { stat } from "node:fs/promises";

import { asRawText, DEFAULT_COMMAND_TIMEOUT_MS } from "../contracts/index.js";
import type {
  CommandVerifierConfig,
  FileRule,
  FileRulesVerifierConfig,
  RawVerifierResult,
  RunCommandPayload,
  VerifierConfig,
  VerifierKind,
  VerifierOutcome,
  VerifierRunner,
  Workspace,
} from "../contracts/index.js";

export interface CommandRunRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwdAbsolute: string;
  readonly timeoutMs: number;
}

export interface CommandSpawnFailure {
  readonly spawnFailed: true;
  readonly message: string;
}

/** Same shape as the runner exported by `src/tools` (`createCommandRunner`). Injected, not imported. */
export interface CommandRunner {
  run(
    request: CommandRunRequest,
    signal: AbortSignal,
  ): Promise<RunCommandPayload | CommandSpawnFailure>;
}

export interface VerifierRunnerOptions {
  readonly workspace: Workspace;
  readonly commandRunner: CommandRunner;
}

export interface RawVerifierResultInput {
  readonly id: string;
  readonly kind: VerifierKind;
  readonly outcome: VerifierOutcome;
  readonly evidence: string;
  readonly checked: readonly string[];
  readonly limits: readonly string[];
}

const OUTCOMES: readonly string[] = ["pass", "fail", "inconclusive"];
const KINDS: readonly string[] = ["command", "file_rules"];
const EVIDENCE_OUTPUT_TAIL_CHARS = 2000;

function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * The only place a verifier result is built (VF-03).
 * Rejects a result without `checked` (at least one non-empty entry) or without `limits`.
 * An empty `limits` list is accepted: it states "no known limits".
 */
export function createRawVerifierResult(input: RawVerifierResultInput): RawVerifierResult {
  const value: Partial<Record<keyof RawVerifierResultInput, unknown>> = input ?? {};
  if (typeof value.id !== "string" || value.id.length === 0) {
    throw new TypeError("verifier result: id must be a non-empty string");
  }
  if (typeof value.kind !== "string" || !KINDS.includes(value.kind)) {
    throw new TypeError("verifier result: unknown kind");
  }
  if (typeof value.outcome !== "string" || !OUTCOMES.includes(value.outcome)) {
    throw new TypeError("verifier result: unknown outcome");
  }
  if (typeof value.evidence !== "string") {
    throw new TypeError("verifier result: evidence must be a string");
  }
  if (
    !isStringList(value.checked) ||
    value.checked.length === 0 ||
    value.checked.some((item) => item.trim().length === 0)
  ) {
    throw new TypeError("verifier result: checked must list at least one non-empty entry");
  }
  if (!isStringList(value.limits)) {
    throw new TypeError("verifier result: limits is required (use an empty list for no known limits)");
  }
  return {
    id: value.id,
    kind: value.kind as VerifierKind,
    outcome: value.outcome as VerifierOutcome,
    evidence: asRawText(value.evidence),
    checked: [...value.checked],
    limits: [...value.limits],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function tail(text: string): string {
  return text.length <= EVIDENCE_OUTPUT_TAIL_CHARS
    ? text
    : `...${text.slice(text.length - EVIDENCE_OUTPUT_TAIL_CHARS)}`;
}

const COMMAND_LIMITS: readonly string[] = [
  "only the exit code is compared; the command's output and what the command itself covers are not judged",
];

async function runCommandVerifier(
  config: CommandVerifierConfig,
  workspace: Workspace,
  commandRunner: CommandRunner,
  signal: AbortSignal,
): Promise<RawVerifierResult> {
  const expected = config.expectExitCode ?? 0;
  const cwd = config.cwd ?? ".";
  const checked = [
    `exit code of ${JSON.stringify([config.executable, ...config.args])} in "${cwd}" equals ${expected}`,
  ];
  const result = (outcome: VerifierOutcome, evidence: string): RawVerifierResult =>
    createRawVerifierResult({
      id: config.id,
      kind: "command",
      outcome,
      evidence,
      checked,
      limits: COMMAND_LIMITS,
    });

  if (signal.aborted) return result("inconclusive", "cancelled before the command started");

  const resolved = await workspace.resolve(cwd, "cwd");
  if (!resolved.ok) {
    return result("inconclusive", `working directory rejected (${resolved.code}); the command was not run`);
  }

  const ran = await commandRunner.run(
    {
      executable: config.executable,
      args: config.args,
      cwdAbsolute: resolved.path.absolute,
      timeoutMs: config.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
    },
    signal,
  );

  if ("spawnFailed" in ran) {
    return result("inconclusive", `the command could not be started: ${ran.message}`);
  }
  const output =
    (ran.stdout.length > 0 ? `\nstdout:\n${tail(ran.stdout)}` : "") +
    (ran.stderr.length > 0 ? `\nstderr:\n${tail(ran.stderr)}` : "");
  if (ran.timedOut) return result("inconclusive", `the command timed out${output}`);
  if (signal.aborted) return result("inconclusive", `cancelled while the command was running${output}`);
  if (ran.exitCode === null) {
    return result("inconclusive", `the command did not exit normally${output}`);
  }
  return result(
    ran.exitCode === expected ? "pass" : "fail",
    `exit code ${ran.exitCode}, expected ${expected}${output}`,
  );
}

type RuleState = "held" | "not_held" | "undecided";

interface RuleVerdict {
  readonly state: RuleState;
  readonly note: string;
}

function describeText(text: string): string {
  const literal = JSON.stringify(text);
  return literal.length <= 80 ? literal : `${literal.slice(0, 77)}..."`;
}

function describeRule(rule: FileRule): string {
  switch (rule.type) {
    case "exists":
      return `"${rule.path}" exists`;
    case "absent":
      return `"${rule.path}" is absent`;
    case "contains":
      return `"${rule.path}" contains the literal text ${describeText(rule.text)}`;
    case "not_contains":
      return `"${rule.path}" does not contain the literal text ${describeText(rule.text)}`;
  }
}

async function checkRule(rule: FileRule, workspace: Workspace): Promise<RuleVerdict> {
  const resolved = await workspace.resolve(rule.path, "read");
  if (!resolved.ok) return { state: "undecided", note: `path rejected (${resolved.code})` };

  if (rule.type === "exists" || rule.type === "absent") {
    let present: boolean;
    try {
      await stat(resolved.path.absolute);
      present = true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        return { state: "undecided", note: `could not inspect the path (${code ?? "unknown error"})` };
      }
      present = false;
    }
    const held = rule.type === "exists" ? present : !present;
    return { state: held ? "held" : "not_held", note: present ? "present" : "not present" };
  }

  const read = await workspace.readText(resolved.path);
  if (!read.ok) {
    // A missing file cannot contain required text. For not_contains it stays undecided:
    // reporting "held" for a file that was never read would be a false pass.
    if (read.code === "not_found" && rule.type === "contains") {
      return { state: "not_held", note: "file not found" };
    }
    return { state: "undecided", note: `file could not be read (${read.code})` };
  }
  const found = read.snapshot.text.includes(rule.text);
  const held = rule.type === "contains" ? found : !found;
  return { state: held ? "held" : "not_held", note: found ? "text found" : "text not found" };
}

async function runFileRulesVerifier(
  config: FileRulesVerifierConfig,
  workspace: Workspace,
  signal: AbortSignal,
): Promise<RawVerifierResult> {
  const rules = Array.isArray(config.rules) ? config.rules : [];
  if (rules.length === 0) {
    return createRawVerifierResult({
      id: config.id,
      kind: "file_rules",
      outcome: "inconclusive",
      evidence: "the verifier has no rules, so nothing was checked",
      checked: ["that the verifier has at least one rule"],
      limits: [],
    });
  }

  const checked: string[] = [];
  const lines: string[] = [];
  let failed = false;
  let undecided = false;
  for (const rule of rules) {
    const label = describeRule(rule);
    checked.push(label);
    let verdict: RuleVerdict;
    if (signal.aborted) {
      verdict = { state: "undecided", note: "cancelled before this rule was checked" };
    } else {
      try {
        verdict = await checkRule(rule, workspace);
      } catch (error) {
        verdict = { state: "undecided", note: `check failed: ${errorMessage(error)}` };
      }
    }
    if (verdict.state === "not_held") failed = true;
    if (verdict.state === "undecided") undecided = true;
    lines.push(`${verdict.state.replace("_", " ")}: ${label} (${verdict.note})`);
  }

  const limits: string[] = [];
  if (rules.some((rule) => rule.type === "contains" || rule.type === "not_contains")) {
    limits.push("text rules are literal substring matches; structure, meaning and link targets are not checked");
  }
  return createRawVerifierResult({
    id: config.id,
    kind: "file_rules",
    outcome: failed ? "fail" : undecided ? "inconclusive" : "pass",
    evidence: lines.join("\n"),
    checked,
    limits,
  });
}

export function createVerifierRunner(options: VerifierRunnerOptions): VerifierRunner {
  const { workspace, commandRunner } = options;
  return {
    async run(config: VerifierConfig, signal: AbortSignal): Promise<RawVerifierResult> {
      try {
        if (config.kind === "command") {
          return await runCommandVerifier(config, workspace, commandRunner, signal);
        }
        if (config.kind === "file_rules") {
          return await runFileRulesVerifier(config, workspace, signal);
        }
      } catch (error) {
        return createRawVerifierResult({
          id: config.id,
          kind: config.kind,
          outcome: "inconclusive",
          evidence: `the verifier could not complete: ${errorMessage(error)}`,
          checked: [`verifier "${config.id}" (${config.kind}) was attempted`],
          limits: [],
        });
      }
      throw new TypeError("unknown verifier kind");
    },
  };
}
