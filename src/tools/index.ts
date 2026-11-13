/**
 * Tool runner: executes one call that already passed validation, policy and restoration.
 * It does not judge policy again, but every path goes through `Workspace.resolve`.
 * Tool-level failures are returned as RawToolOutcome, never thrown.
 */

import { createHash } from "node:crypto";
import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  MAX_COMMAND_OUTPUT_BYTES,
  MAX_SEARCH_ENTRIES,
  MAX_SEARCH_MATCHES_PER_FILE,
  MAX_WRITE_BYTES,
  PRIVACY_TOKEN_PATTERN_SOURCE,
  asRawText,
  maskedParts,
  maskedPartsEncoding,
} from "../contracts/index.js";
import type {
  ChangeRecorder,
  ContentHash,
  PathAccess,
  PlanRecorder,
  PrivacyGateway,
  RawText,
  RawToolOutcome,
  ReadFileArgs,
  ResolvedPath,
  RunCommandArgs,
  RunCommandPayload,
  SearchEntry,
  SearchFilesArgs,
  SearchMatch,
  ToolErrorCode,
  ToolRunner,
  Workspace,
  WriteFileArgs,
} from "../contracts/index.js";

import { takeJudged } from "../workspace/judged.js";
import { createCommandRunner } from "./command-runner.js";
import type { CommandRunner } from "./command-runner.js";
import { nodePlanFileOps } from "./plan-files.js";
import type { PlanFileOps } from "./plan-files.js";
import { inspectFiles, proposePlan } from "./workflow-tools.js";

export { createPlanExecutor, discardedRootOf } from "./plan-executor.js";
export type { CountingPlanExecutor, PlanExecutorDeps } from "./plan-executor.js";
export { MAX_INSPECT_WALK_ENTRIES } from "./workflow-tools.js";
export { HARD_LINK_UNAVAILABLE_PROBLEM } from "./plan-files.js";
export type { PlanFileOps } from "./plan-files.js";

export {
  COMMAND_CAPTURE_SLACK_BYTES,
  MAX_UNFINISHED_LINE_DROP_BYTES,
  PIPE_GRACE_AFTER_EXIT_MS,
  OutputCapture,
  buildChildEnv,
  createCommandRunner,
  dropUnfinishedLine,
} from "./command-runner.js";
export type {
  CommandRunner,
  CommandRunnerOptions,
  CommandRunRequest,
  CommandSpawnFailure,
} from "./command-runner.js";
export { planWindowsLaunch } from "./windows-launch.js";
export type {
  ExecutableFileSystem,
  WindowsLaunch,
  WindowsLaunchInput,
  WindowsLaunchPlan,
} from "./windows-launch.js";

export interface ToolRunnerOptions {
  readonly workspace: Workspace;
  readonly privacy: PrivacyGateway;
  /**
   * Defaults to `createWorkspaceCommandRunner({ workspace, privacy })`. A runner passed here is
   * used as given: build it with `createWorkspaceCommandRunner` too (the CLI shares one runner
   * with the verifiers), never with a bare `createCommandRunner()`, or the env value check and the
   * workspace rules are missing. Unit tests inject a fake.
   */
  readonly commandRunner?: CommandRunner;
  /**
   * Keeps the original of every file `write_file` changes, for revert (R-6). When given,
   * `write_file` calls `saveOriginal` after all its checks and right before it writes, and does
   * not write when that fails. Without it, files are written as before and nothing is kept.
   */
  readonly changeRecorder?: ChangeRecorder;
  /**
   * G-A: stores the plan `propose_plan` built (plan.json). Without it `propose_plan` fails with
   * `io_error` and stores nothing. The four built-in tools never use it.
   */
  readonly planRecorder?: PlanRecorder;
  /** For tests: replaces parts of the file system the workflow tools use. */
  readonly fileOps?: Partial<PlanFileOps>;
  /** For tests. Defaults to `process.platform`. Decides whether plan paths compare without case. */
  readonly platform?: NodeJS.Platform;
}

/**
 * Value check for `createCommandRunner({ allowEnvValue })`: true only when masking leaves the
 * value unchanged, so a value that holds a registered secret (or a listed variant) is dropped.
 * A masking failure also drops the value.
 */
export function envValueFreeOfSecrets(privacy: PrivacyGateway): (value: string) => boolean {
  return (value) => {
    const masked = privacy.mask(value);
    return masked.ok && masked.text === value;
  };
}

export interface WorkspaceCommandRunnerOptions {
  /** The run's workspace. Its real root decides which files are inside the workspace (T-4). */
  readonly workspace: Pick<Workspace, "root">;
  /** The run's gateway. Allow-listed variables whose value holds a registered secret are dropped. */
  readonly privacy: PrivacyGateway;
  /** For tests. Defaults to `process.env`. */
  readonly parentEnv?: NodeJS.ProcessEnv;
  /** For tests. Defaults to `process.platform`. */
  readonly platform?: NodeJS.Platform;
}

/**
 * THE way to build the command runner for a run (T-1). It sets both options the runner needs:
 * `allowEnvValue: envValueFreeOfSecrets(privacy)` and `workspaceRoot: workspace.root`.
 * Build it once per run and pass the same runner to `createToolRunner({ commandRunner })` and to
 * the verifier runner. A runner from `createCommandRunner()` without these options passes secret
 * values in allow-listed variables to the child and, on Windows, refuses every `.cmd`/`.bat` and
 * does not refuse executables inside the workspace.
 *
 * CLI assembly: `const commandRunner = createWorkspaceCommandRunner({ workspace, privacy });`
 */
export function createWorkspaceCommandRunner(options: WorkspaceCommandRunnerOptions): CommandRunner {
  return createCommandRunner({
    ...(options.parentEnv === undefined ? {} : { parentEnv: options.parentEnv }),
    ...(options.platform === undefined ? {} : { platform: options.platform }),
    allowEnvValue: envValueFreeOfSecrets(options.privacy),
    workspaceRoot: options.workspace.root,
  });
}

const TOKEN_PATTERN = new RegExp(PRIVACY_TOKEN_PATTERN_SOURCE, "g");

/** Largest index <= `limit` that is not inside a privacy token or a surrogate pair. */
function tokenSafeCut(text: string, limit: number): number {
  if (limit >= text.length) return text.length;
  let cut = limit;
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const start = match.index;
    if (start >= cut) break;
    if (start + match[0].length > cut) {
      cut = start;
      break;
    }
  }
  const before = text.charCodeAt(cut - 1);
  if (cut > 0 && before >= 0xd800 && before <= 0xdbff) cut -= 1;
  return cut;
}

/** Largest code point boundary whose UTF-8 prefix fits in `maxBytes`. */
function indexForUtf8Bytes(text: string, maxBytes: number): number {
  let bytes = 0;
  let index = 0;
  while (index < text.length) {
    const code = text.codePointAt(index) ?? 0;
    const size = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (bytes + size > maxBytes) return index;
    bytes += size;
    index += code > 0xffff ? 2 : 1;
  }
  return index;
}

function commonPrefixLength(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  let index = 0;
  while (index < length && a.charCodeAt(index) === b.charCodeAt(index)) index += 1;
  return index;
}

const BOM = "\uFEFF";
/** Longest line text reported by `search_files`. Longer lines are cut and mark `truncated`. */
export const MAX_SEARCH_LINE_CHARS = 1_000;

type Failure = Extract<RawToolOutcome, { ok: false }>;

function fail(code: ToolErrorCode, message: string): Failure {
  return { ok: false, code, message: asRawText(message) };
}

export function createToolRunner(options: ToolRunnerOptions): ToolRunner {
  const { workspace, privacy, changeRecorder } = options;
  const commandRunner =
    options.commandRunner ??
    createWorkspaceCommandRunner({ workspace, privacy });

  /** Masks a text or reports that the whole call must fail with `masking_failed`. */
  function maskText(text: string): string | null {
    const masked = privacy.mask(text);
    return masked.ok ? masked.text : null;
  }

  /**
   * Masks one raw output stream, then cuts it to MAX_COMMAND_OUTPUT_BYTES outside any token.
   * When the runner dropped bytes, its capture may end inside a secret. Only the part of the
   * masked text that is the same as masking the first MAX_COMMAND_OUTPUT_BYTES raw bytes is
   * kept, so a cut secret of at most COMMAND_CAPTURE_SLACK_BYTES never survives, even when
   * earlier long secrets made the masked text shorter than the raw capture.
   * Output the runner did not read to its end arrives without its unfinished last line (V-2).
   */
  function maskOutput(raw: string, rawTruncated: boolean): { text: string; truncated: boolean } | null {
    const full = maskText(raw);
    if (full === null) return null;
    let limit = indexForUtf8Bytes(full, MAX_COMMAND_OUTPUT_BYTES);
    if (rawTruncated) {
      const head = maskText(raw.slice(0, indexForUtf8Bytes(raw, MAX_COMMAND_OUTPUT_BYTES)));
      if (head === null) return null;
      limit = Math.min(limit, commonPrefixLength(full, head));
    }
    const cut = tokenSafeCut(full, limit);
    return { text: full.slice(0, cut), truncated: rawTruncated || cut < full.length };
  }

  async function resolvePath(
    path: string,
    access: PathAccess,
  ): Promise<{ ok: true; path: ResolvedPath } | Failure> {
    // U-189 (T-1): the real path the policy gate judged for this argument, if it judged one.
    const judged = takeJudged(workspace, path, access);
    const resolved = await workspace.resolve(path, access);
    if (!resolved.ok) {
      // The policy gate should have stopped this call. The tool still refuses to touch the path.
      return fail("policy_denied", `path rejected by workspace: ${resolved.code}`);
    }
    // A folder swapped for a link after the gate judged the path makes this resolution land elsewhere
    // (perhaps a protected path or one outside the writable lists): nothing is done.
    if (judged !== undefined && judged !== resolved.path.absolute) {
      return fail("policy_denied", "the path leads elsewhere than when the policy judged it; nothing was done");
    }
    return resolved;
  }

  async function readFile(args: ReadFileArgs): Promise<RawToolOutcome> {
    const resolved = await resolvePath(args.path, "read");
    if (!resolved.ok) return resolved;
    const read = await workspace.readText(resolved.path);
    if (!read.ok) return fail(read.code, `cannot read file: ${read.code}`);
    const text: string = read.snapshot.text;
    const hadBom = text.startsWith(BOM);
    return {
      ok: true,
      payload: {
        path: resolved.path.relative,
        content: hadBom ? text.slice(BOM.length) : text,
        hash: read.snapshot.hash,
        hadBom,
      },
    };
  }

  async function searchFiles(args: SearchFilesArgs, signal: AbortSignal): Promise<RawToolOutcome> {
    const resolved = await resolvePath(args.path, "read");
    if (!resolved.ok) return resolved;
    const listed = await workspace.list(resolved.path);
    if (!listed.ok) return fail(listed.code, `cannot list directory: ${listed.code}`);

    // Matching works on masked text only: the path names and the file contents a model would
    // see. Matching raw text would let the result reveal secrets one character at a time.
    let truncated = listed.truncated;
    const entries: SearchEntry[] = [];
    for (const entry of listed.entries) {
      if (signal.aborted) return fail("cancelled", "search cancelled");
      const maskedPath = maskText(entry.relative);
      if (maskedPath === null) return fail("masking_failed", "masking a path failed");
      if (args.nameContains !== undefined && !maskedPath.includes(args.nameContains)) continue;

      let matches: SearchMatch[] | undefined;
      if (args.text !== undefined) {
        if (entry.kind !== "file") continue;
        // Each file is resolved again, so a link that leaves the root is never read.
        const file = await workspace.resolve(entry.relative, "read");
        if (!file.ok) continue;
        const read = await workspace.readText(file.path);
        if (!read.ok) continue;
        const raw: string = read.snapshot.text;
        const masked = maskText(raw.startsWith(BOM) ? raw.slice(BOM.length) : raw);
        if (masked === null) return fail("masking_failed", "masking a file failed");
        matches = [];
        const lines = masked.split("\n");
        for (let index = 0; index < lines.length; index += 1) {
          let line = lines[index] ?? "";
          if (!line.includes(args.text)) continue;
          if (matches.length >= MAX_SEARCH_MATCHES_PER_FILE) {
            truncated = true;
            break;
          }
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.length > MAX_SEARCH_LINE_CHARS) {
            line = line.slice(0, tokenSafeCut(line, MAX_SEARCH_LINE_CHARS));
            truncated = true;
          }
          matches.push({ line: index + 1, text: line });
        }
        if (matches.length === 0) continue;
      }

      if (entries.length >= MAX_SEARCH_ENTRIES) {
        truncated = true;
        break;
      }
      entries.push(
        matches === undefined
          ? { path: maskedPath, kind: entry.kind }
          : { path: maskedPath, kind: entry.kind, matches },
      );
    }
    return { ok: true, payload: { entries, truncated } };
  }

  /**
   * DR-29, DR-32 (c): the digest of `text` masked by this run's gateway: the SHA-256 of
   * maskedPartsEncoding(maskedParts(masked text)), as 64 lowercase hex characters. Undefined when
   * masking fails. It holds no visible text (R-19 L-3).
   */
  function shownDigest(text: string): ContentHash | undefined {
    const masked = privacy.mask(text);
    if (!masked.ok) return undefined;
    return createHash("sha256").update(maskedPartsEncoding(maskedParts(masked.text)), "utf8").digest("hex") as ContentHash;
  }

  async function writeFile(args: WriteFileArgs): Promise<RawToolOutcome> {
    const resolved = await resolvePath(args.path, "write");
    if (!resolved.ok) return resolved;

    // 1. Local snapshot of the current file (raw, never leaves this function except to the
    //    change recorder, which keeps it in the state directory).
    const read = await workspace.readText(resolved.path);
    let original: RawText | null;
    let currentText: string | null;
    let currentHash: string | null;
    if (read.ok) {
      original = read.snapshot.text;
      currentText = read.snapshot.text;
      currentHash = read.snapshot.hash;
    } else if (read.code === "not_found") {
      original = null;
      currentText = null;
      currentHash = null;
    } else {
      return fail(read.code, `cannot read current file: ${read.code}`);
    }

    // 2. The change was prepared against `expectedHash`. A different state is a conflict.
    if (currentHash !== args.expectedHash) {
      return fail("conflict", "file state differs from expectedHash; read the file again");
    }

    const hadBom = currentText !== null && currentText.startsWith(BOM);
    const body = currentText === null ? null : hadBom ? currentText.slice(BOM.length) : currentText;

    // 3. Apply the change in the masked context: the text the model actually saw.
    let maskedNext: string;
    const change = args.change;
    if (change.kind === "replace_all") {
      maskedNext = change.content;
    } else {
      if (body === null) return fail("not_found", "replace_text needs an existing file");
      if (change.oldText.length === 0) return fail("invalid_args", "oldText must not be empty");
      const masked = privacy.mask(body);
      if (!masked.ok) return fail("masking_failed", "masking the current file failed");
      const context: string = masked.text;
      const first = context.indexOf(change.oldText);
      if (first === -1) return fail("no_match", "oldText was not found in the file");
      if (context.indexOf(change.oldText, first + 1) !== -1) {
        return fail("ambiguous_match", "oldText occurs more than once in the file");
      }
      maskedNext =
        context.slice(0, first) + change.newText + context.slice(first + change.oldText.length);
    }

    // 4. Back to local text. Protected spans must stay where they were.
    const rebuilt = privacy.rebuildDocument({
      original: body === null ? null : asRawText(body),
      maskedNext,
    });
    if (!rebuilt.ok) return fail(rebuilt.code, `change rejected: ${rebuilt.code}`);

    // 4a. DR-72 (U-173): the file this write leaves, BOM put back, as its bytes on disk. Over
    //     MAX_WRITE_BYTES it is not written: too_large, with no original kept and nothing written.
    const nextText: string = rebuilt.text;
    const finalText = hadBom && !nextText.startsWith(BOM) ? BOM + nextText : nextText;
    if (Buffer.byteLength(finalText, "utf8") > MAX_WRITE_BYTES) {
      return fail("too_large", `the file would be larger than ${MAX_WRITE_BYTES} bytes; nothing was written`);
    }

    // 5. Every check passed. Keep the original for revert; without it, do not write.
    //    DR-29, DR-32 (c): with it, how this run masks it (null for a new file). When masking fails
    //    no digest is given, and the comparison view will show no text for this path.
    const shownOriginal = changeRecorder === undefined || original === null ? null : shownDigest(original);
    if (changeRecorder !== undefined) {
      try {
        if (shownOriginal === undefined) await changeRecorder.saveOriginal(resolved.path, original);
        else await changeRecorder.saveOriginal(resolved.path, original, shownOriginal);
      } catch {
        // No detail: it could carry raw paths or file text.
        return fail("io_error", "keeping the original for revert failed; nothing was written");
      }
    }

    // 6. Write with the version check (the BOM was put back in 4a).
    const written = await workspace.writeText({
      path: resolved.path,
      expectedHash: args.expectedHash,
      text: asRawText(finalText),
    });
    if (!written.ok) {
      return written.code === "conflict"
        ? fail("conflict", "file changed since it was read; read the file again")
        : fail("io_error", "writing the file failed");
    }
    // 7. DR-29, DR-32 (c): how this run masks the text it left. Only when the original's form was
    //    given and this text can be masked; a failure here never changes the outcome (the write
    //    happened, and the view then finds no record and shows no text).
    if (changeRecorder?.saveNext !== undefined && shownOriginal !== undefined) {
      const partsDigest = shownDigest(finalText);
      if (partsDigest !== undefined) {
        try {
          await changeRecorder.saveNext(resolved.path, written.newHash, partsDigest);
        } catch {
          // No detail, as above.
        }
      }
    }
    return {
      ok: true,
      payload: {
        path: resolved.path.relative,
        previousHash: written.previousHash,
        newHash: written.newHash,
        created: written.created,
      },
    };
  }

  async function runCommand(args: RunCommandArgs, signal: AbortSignal): Promise<RawToolOutcome> {
    const resolved = await resolvePath(args.cwd ?? ".", "cwd");
    if (!resolved.ok) return resolved;
    if (signal.aborted) return fail("cancelled", "command cancelled before start");
    const result = await commandRunner.run(
      {
        executable: args.executable,
        args: args.args,
        cwdAbsolute: resolved.path.absolute,
        timeoutMs: args.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
      },
      signal,
    );
    if ("spawnFailed" in result) return fail("spawn_failed", result.message);
    if (signal.aborted) return fail("cancelled", "command cancelled");
    // The runner returns raw output with slack beyond the cap. Mask first, then cut.
    const stdout = maskOutput(result.stdout, result.truncated);
    const stderr = maskOutput(result.stderr, result.truncated);
    if (stdout === null || stderr === null) {
      return fail("masking_failed", "masking the command output failed");
    }
    const payload: RunCommandPayload = {
      exitCode: result.exitCode,
      stdout: stdout.text,
      stderr: stderr.text,
      timedOut: result.timedOut,
      truncated: stdout.truncated || stderr.truncated,
    };
    return { ok: true, payload };
  }

  const workflowDeps = {
    workspace,
    privacy,
    ...(options.planRecorder === undefined ? {} : { planRecorder: options.planRecorder }),
    fileOps: { ...nodePlanFileOps, ...options.fileOps },
    platform: options.platform ?? process.platform,
  };

  return {
    async execute(call, signal) {
      try {
        if (signal.aborted) return fail("cancelled", "cancelled before start");
        switch (call.name) {
          case "read_file":
            return await readFile(call.args);
          case "search_files":
            return await searchFiles(call.args, signal);
          case "write_file":
            return await writeFile(call.args);
          case "run_command":
            return await runCommand(call.args, signal);
        }
      } catch {
        // No error detail: it could carry raw file text or paths.
        return fail("io_error", "unexpected tool failure");
      }
    },

    async executeWorkflowTool(call, signal) {
      try {
        if (signal.aborted) return fail("cancelled", "cancelled before start");
        switch (call.name) {
          case "inspect_files":
            return await inspectFiles(workflowDeps, call.args, signal);
          case "propose_plan":
            return await proposePlan(workflowDeps, call.args, signal);
        }
      } catch {
        // No error detail: it could carry raw file text or paths.
        return fail("io_error", "unexpected tool failure");
      }
    },
  };
}
