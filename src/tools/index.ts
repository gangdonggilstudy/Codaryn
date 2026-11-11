/**
 * Tool runner: executes one call that already passed validation, policy and restoration.
 * It does not judge policy again, but every path goes through `Workspace.resolve`.
 * Tool-level failures are returned as RawToolOutcome, never thrown.
 */

import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  MAX_SEARCH_ENTRIES,
  MAX_SEARCH_MATCHES_PER_FILE,
  asRawText,
} from "../contracts/index.js";
import type {
  PathAccess,
  PrivacyGateway,
  RawToolOutcome,
  ReadFileArgs,
  ResolvedPath,
  RunCommandArgs,
  SearchEntry,
  SearchFilesArgs,
  SearchMatch,
  ToolErrorCode,
  ToolRunner,
  Workspace,
  WriteFileArgs,
} from "../contracts/index.js";

import { createCommandRunner } from "./command-runner.js";
import type { CommandRunner } from "./command-runner.js";

export { buildChildEnv, createCommandRunner } from "./command-runner.js";
export type {
  CommandRunner,
  CommandRunnerOptions,
  CommandRunRequest,
  CommandSpawnFailure,
} from "./command-runner.js";

export interface ToolRunnerOptions {
  readonly workspace: Workspace;
  readonly privacy: PrivacyGateway;
  /** Defaults to the real runner from `createCommandRunner()`. Inject a fake in unit tests. */
  readonly commandRunner?: CommandRunner;
}

const BOM = "﻿";
/** Longest line text reported by `search_files`. Longer lines are cut and mark `truncated`. */
export const MAX_SEARCH_LINE_CHARS = 1_000;

type Failure = Extract<RawToolOutcome, { ok: false }>;

function fail(code: ToolErrorCode, message: string): Failure {
  return { ok: false, code, message: asRawText(message) };
}

export function createToolRunner(options: ToolRunnerOptions): ToolRunner {
  const { workspace, privacy } = options;
  const commandRunner = options.commandRunner ?? createCommandRunner();

  async function resolvePath(
    path: string,
    access: PathAccess,
  ): Promise<{ ok: true; path: ResolvedPath } | Failure> {
    const resolved = await workspace.resolve(path, access);
    if (resolved.ok) return resolved;
    // The policy gate should have stopped this call. The tool still refuses to touch the path.
    return fail("policy_denied", `path rejected by workspace: ${resolved.code}`);
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

    let truncated = listed.truncated;
    const entries: SearchEntry[] = [];
    for (const entry of listed.entries) {
      if (signal.aborted) return fail("cancelled", "search cancelled");
      if (args.nameContains !== undefined && !entry.relative.includes(args.nameContains)) continue;

      let matches: SearchMatch[] | undefined;
      if (args.text !== undefined) {
        if (entry.kind !== "file") continue;
        // Each file is resolved again, so a link that leaves the root is never read.
        const file = await workspace.resolve(entry.relative, "read");
        if (!file.ok) continue;
        const read = await workspace.readText(file.path);
        if (!read.ok) continue;
        matches = [];
        const lines = read.snapshot.text.split("\n");
        for (let index = 0; index < lines.length; index += 1) {
          let line = lines[index] ?? "";
          if (!line.includes(args.text)) continue;
          if (matches.length >= MAX_SEARCH_MATCHES_PER_FILE) {
            truncated = true;
            break;
          }
          if (index === 0 && line.startsWith(BOM)) line = line.slice(BOM.length);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.length > MAX_SEARCH_LINE_CHARS) {
            line = line.slice(0, MAX_SEARCH_LINE_CHARS);
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
          ? { path: entry.relative, kind: entry.kind }
          : { path: entry.relative, kind: entry.kind, matches },
      );
    }
    return { ok: true, payload: { entries, truncated } };
  }

  async function writeFile(args: WriteFileArgs): Promise<RawToolOutcome> {
    const resolved = await resolvePath(args.path, "write");
    if (!resolved.ok) return resolved;

    // 1. Local snapshot of the current file (raw, never leaves this function).
    const read = await workspace.readText(resolved.path);
    let currentText: string | null;
    let currentHash: string | null;
    if (read.ok) {
      currentText = read.snapshot.text;
      currentHash = read.snapshot.hash;
    } else if (read.code === "not_found") {
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

    // 5. Put the BOM back and write with the version check.
    const nextText: string = rebuilt.text;
    const finalText = hadBom && !nextText.startsWith(BOM) ? BOM + nextText : nextText;
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
    return { ok: true, payload: result };
  }

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
  };
}
