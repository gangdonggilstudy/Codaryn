/**
 * Verifier runner: `command` (exit code), `file_rules` (literal file checks, and from U-116 the
 * Markdown rules of `./markdown.ts`) and, from G-D, `data_checks` (VF-04, `./data-checks.ts`,
 * tables read with `src/tabular`).
 * Nothing here uses Git. Every path goes through `Workspace.resolve`.
 *
 * Also exports `createIntegrityChecker` (U-1, K2, `./integrity.ts`): the SHA-256 list of protected
 * material that the engine compares around each verification round, and `createInventoryChecker`
 * (VF-05, DR-6, `./inventory.ts`): the file inventory an apply run checks its actions against.
 */

import { stat } from "node:fs/promises";

import { DEFAULT_COMMAND_TIMEOUT_MS, MARKDOWN_RULE_LIMITS, MARKDOWN_RULE_TYPES, MAX_COMMAND_OUTPUT_BYTES, markdownRuleLabel } from "../contracts/index.js";
import type {
  CommandVerifierConfig,
  FileRule,
  FileRulesVerifierConfig,
  MarkdownFileRule,
  RawVerifierResult,
  RunCommandPayload,
  VerifierConfig,
  VerifierOutcome,
  VerifierRunner,
  Workspace,
} from "../contracts/index.js";
import { runDataChecksVerifier } from "./data-checks.js";
import { checkMarkdownHeadings, checkMarkdownLinks } from "./markdown.js";
import { createRawVerifierResult } from "./result.js";

export { createIntegrityChecker } from "./integrity.js";
export { createInventoryChecker } from "./inventory.js";
export type { InventoryCheckerOptions } from "./inventory.js";
export { createRawVerifierResult } from "./result.js";
export type { RawVerifierResultInput } from "./result.js";

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
  /**
   * U-223 (bundle A, A-7, R-6): the run's unreadable paths, every source united
   * (ResolvedTaskSpec.unreadablePaths). data_checks writes no number read from a source under them.
   * Absent: none. The CLI's and the app's assembly pass it once a parser takes the field (A-6).
   */
  readonly unreadablePaths?: readonly string[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The command output for the evidence, exactly as the runner returned it (T-6: raw text is never
 * cut here; the engine masks first and cuts afterwards).
 *
 * When the runner dropped output, a stream may end at an arbitrary byte, possibly inside a secret.
 * The contract has the engine drop the trailing slack of truncated evidence, so a stream that may
 * have been cut goes last. Only a stream longer than MAX_COMMAND_OUTPUT_BYTES can have reached the
 * runner's capture limit. When both did, the first one's end lies more than
 * MAX_COMMAND_OUTPUT_BYTES from either end of the evidence, beyond MAX_EVIDENCE_BYTES.
 */
function commandOutput(ran: RunCommandPayload): string {
  const streams = [
    { label: "stdout", text: ran.stdout },
    { label: "stderr", text: ran.stderr },
  ].filter((stream) => stream.text.length > 0);
  if (ran.truncated) {
    const mayBeCut = (text: string): boolean => Buffer.byteLength(text, "utf8") > MAX_COMMAND_OUTPUT_BYTES;
    streams.sort((a, b) => Number(mayBeCut(a.text)) - Number(mayBeCut(b.text)));
  }
  return streams.map((stream) => `\n${stream.label}:\n${stream.text}`).join("");
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
  const result = (outcome: VerifierOutcome, evidence: string, evidenceTruncated = false): RawVerifierResult =>
    createRawVerifierResult({
      id: config.id,
      kind: "command",
      outcome,
      evidence,
      evidenceTruncated,
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
  const output = commandOutput(ran);
  const cut = ran.truncated;
  if (ran.timedOut) return result("inconclusive", `the command timed out${output}`, cut);
  if (signal.aborted) return result("inconclusive", `cancelled while the command was running${output}`, cut);
  if (ran.exitCode === null) {
    return result("inconclusive", `the command did not exit normally${output}`, cut);
  }
  return result(
    ran.exitCode === expected ? "pass" : "fail",
    `exit code ${ran.exitCode}, expected ${expected}${output}`,
    cut,
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
    case "markdown_headings":
    case "markdown_links":
      // U-116: the contract's label (the headings listed, as the evidence lists them).
      return markdownRuleLabel(rule);
  }
}

const isMarkdownRule = (rule: FileRule): rule is MarkdownFileRule => (MARKDOWN_RULE_TYPES as readonly string[]).includes(rule.type);

async function checkRule(rule: FileRule, workspace: Workspace, signal: AbortSignal): Promise<RuleVerdict> {
  // U-116: the Markdown rules read their file themselves (up to MAX_MARKDOWN_RULE_FILE_BYTES); they
  // look at the signal between their long steps (R-89 M-1, L-2).
  if (rule.type === "markdown_headings") return checkMarkdownHeadings(rule, workspace, { signal });
  if (rule.type === "markdown_links") return checkMarkdownLinks(rule, workspace, { signal });
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
        verdict = await checkRule(rule, workspace, signal);
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
  if (rules.some(isMarkdownRule)) limits.push(...MARKDOWN_RULE_LIMITS);
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
  const { workspace, commandRunner, unreadablePaths } = options;
  return {
    async run(config: VerifierConfig, signal: AbortSignal): Promise<RawVerifierResult> {
      try {
        if (config.kind === "command") {
          return await runCommandVerifier(config, workspace, commandRunner, signal);
        }
        if (config.kind === "file_rules") {
          return await runFileRulesVerifier(config, workspace, signal);
        }
        if (config.kind === "data_checks") {
          return await runDataChecksVerifier(config, workspace, signal, unreadablePaths === undefined ? {} : { unreadablePaths });
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
