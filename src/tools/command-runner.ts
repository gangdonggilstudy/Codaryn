/**
 * Real command runner: starts one process without a shell, with a filtered environment,
 * a time limit, an output cap and cancellation.
 *
 * Windows: the name is looked up with PATH and PATHEXT of the child environment (see
 * `windows-launch.ts`). Nothing that resolves into the workspace is started (T-4). `.exe` and
 * `.com` start without a shell. `.cmd` and `.bat` start through `cmd.exe /d /s /c` only when the
 * script path and every argument use a narrow character set; anything else is refused as
 * `spawnFailed`. Other systems: the name is passed to `spawn` as before (no shell).
 *
 * Production code builds the runner with `createWorkspaceCommandRunner` (index.ts), which sets
 * `allowEnvValue` and `workspaceRoot`. Without them the env value check is off and, on Windows,
 * every `.cmd`/`.bat` is refused and executables are not checked against the workspace.
 *
 * Settling (T-2): the run ends when the child process exits. Its exit code is final then, and the
 * time limit no longer applies. The pipes are read for PIPE_GRACE_AFTER_EXIT_MS more and then
 * closed, even when a descendant still holds them. The tree is ended (time limit or cancel) only
 * while the child is alive; an ended child's PID is never signalled or passed to taskkill.
 *
 * Known limits (not OS isolation):
 * - Descendants that are still running when the child exits (a server started in the background,
 *   `start /b`, a detached process) are not ended. They can outlive the run and the CLI.
 * - Windows scripts: arguments with spaces, quotes, `%`, `!`, parentheses, `,`, `;`, wildcards
 *   or non-ASCII characters cannot be passed to a `.cmd`/`.bat`. A script under a path with
 *   such characters (for example `Program Files (x86)`) or on a UNC path is refused.
 *   Batch files see `=` and `,` as delimiters in `%1`..`%9`; `%*` keeps the arguments as given.
 * - What a script starts (for example the scripts in `package.json` that `npm test` runs) is
 *   not checked by this runner. Such files can be workspace content.
 * - Tree termination is best effort. Windows uses `taskkill /T /F` (forced, no graceful stop).
 *   POSIX signals the process group (SIGTERM, then SIGKILL after 2 s, also when the leader has
 *   already exited: a group id is not reused while the group has members). Descendants that left
 *   the tree or the group (detached, re-parented after their parent exited, own session) are not
 *   reached. The child can also exit between the alive check and taskkill.
 * - The child's file and network access are not restricted.
 * - Output is captured raw and decoded as UTF-8. The caller masks it. A secret written in another
 *   encoding (UTF-16LE, CP949) is not recognized by masking.
 * - Allow-listed variables are dropped when `allowEnvValue` rejects their value. On Windows,
 *   libuv still adds its own required variables (USERNAME, USERDOMAIN, HOMEDRIVE, HOMEPATH,
 *   LOGONSERVER, SYSTEMDRIVE) from the parent, without that check.
 */

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import path from "node:path";

import { CHILD_ENV_ALLOWLIST, MAX_COMMAND_OUTPUT_BYTES } from "../contracts/index.js";
import type { RunCommandPayload } from "../contracts/index.js";

import { envValue, planWindowsLaunch, realExecutableFileSystem } from "./windows-launch.js";
import type { WindowsLaunch } from "./windows-launch.js";

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

/**
 * Shared shape. `src/verify` declares the same shape in its own directory.
 *
 * The runner returns RAW output: each stream holds up to MAX_COMMAND_OUTPUT_BYTES plus
 * COMMAND_CAPTURE_SLACK_BYTES, and `truncated` means bytes beyond that capture were dropped.
 * The slack lets the caller mask first and cut afterwards, so a secret that crosses the cap is
 * still whole when it is masked. `run_command` masks and cuts to MAX_COMMAND_OUTPUT_BYTES.
 */
export interface CommandRunner {
  run(
    request: CommandRunRequest,
    signal: AbortSignal,
  ): Promise<RunCommandPayload | CommandSpawnFailure>;
}

export interface CommandRunnerOptions {
  /** Parent environment to filter. Defaults to `process.env`. */
  readonly parentEnv?: NodeJS.ProcessEnv;
  /** Defaults to `process.platform`. */
  readonly platform?: NodeJS.Platform;
  /**
   * Value check for allow-listed variables. A variable whose value fails it is not passed.
   * Production code injects `envValueFreeOfSecrets(privacy)`. Without it, values are not checked.
   */
  readonly allowEnvValue?: (value: string) => boolean;
  /**
   * Real path of the workspace root. Windows only: `.cmd` and `.bat` files inside it are not run,
   * and without it no `.cmd` or `.bat` file is run at all.
   */
  readonly workspaceRoot?: string;
}

/** Extra bytes captured beyond MAX_COMMAND_OUTPUT_BYTES, so that masking happens before the cut. */
export const COMMAND_CAPTURE_SLACK_BYTES = 4_096;
const CAPTURE_LIMIT_BYTES = MAX_COMMAND_OUTPUT_BYTES + COMMAND_CAPTURE_SLACK_BYTES;

/** After a kill request, wait this long for the process to close before giving up on it. */
const CLOSE_WAIT_AFTER_KILL_MS = 5_000;
/**
 * After the child exits, keep reading the pipes this long for output still in flight (T-2).
 * Then the run is settled even when a descendant still holds the pipes.
 */
export const PIPE_GRACE_AFTER_EXIT_MS = 500;
/** POSIX only: time between SIGTERM and SIGKILL. */
const TERM_TO_KILL_MS = 2_000;

/**
 * Keeps only CHILD_ENV_ALLOWLIST variables. Names compare case-insensitively on Windows.
 * With `allowValue`, an allow-listed variable whose value fails the check is dropped too.
 */
export function buildChildEnv(
  parentEnv: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  allowValue?: (value: string) => boolean,
): Record<string, string> {
  const allowed = new Set<string>(CHILD_ENV_ALLOWLIST);
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(parentEnv)) {
    if (value === undefined) continue;
    const key = platform === "win32" ? name.toUpperCase() : name;
    if (!allowed.has(key)) continue;
    if (allowValue !== undefined && !allowValue(value)) continue;
    env[name] = value;
  }
  return env;
}

/** Collects at most `limitBytes` of a stream. `truncated` is set when bytes were dropped. */
export class OutputCapture {
  private readonly chunks: Buffer[] = [];
  private bytes = 0;
  truncated = false;

  constructor(private readonly limitBytes: number = CAPTURE_LIMIT_BYTES) {}

  push(chunk: Buffer): void {
    const remaining = this.limitBytes - this.bytes;
    if (chunk.length > remaining) this.truncated = true;
    if (remaining <= 0) return;
    const kept = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
    this.chunks.push(kept);
    this.bytes += kept.length;
  }

  text(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "unknown";
}

/**
 * Low-level constructor: uses exactly the options given. For a run, build the runner with
 * `createWorkspaceCommandRunner({ workspace, privacy })` from index.ts instead, and hand that one
 * runner to both `createToolRunner` and the verifier runner. `createCommandRunner()` without
 * options passes allow-listed variables unchecked and does not know the workspace.
 */
export function createCommandRunner(options: CommandRunnerOptions = {}): CommandRunner {
  const parentEnv = options.parentEnv ?? process.env;
  const platform = options.platform ?? process.platform;
  const isWindows = platform === "win32";
  const systemRoot = envValue(parentEnv, "SystemRoot") ?? "C:\\Windows";

  /** Decides what to start. Windows looks the name up itself; other systems leave it to spawn. */
  async function plan(
    request: CommandRunRequest,
    env: Record<string, string>,
  ): Promise<WindowsLaunch | CommandSpawnFailure> {
    if (!isWindows) {
      return { file: request.executable, args: request.args, verbatimArguments: false, env };
    }
    try {
      const planned = await planWindowsLaunch({
        executable: request.executable,
        args: request.args,
        cwdAbsolute: request.cwdAbsolute,
        env,
        workspaceRoot: options.workspaceRoot,
        systemRoot,
        fileSystem: realExecutableFileSystem,
      });
      return planned.ok ? planned.launch : { spawnFailed: true, message: planned.message };
    } catch {
      return { spawnFailed: true, message: "could not start process (unknown)" };
    }
  }

  function killTree(child: ChildProcess): NodeJS.Timeout | undefined {
    const pid = child.pid;
    if (pid === undefined) return undefined;
    if (isWindows) {
      const taskkill = path.win32.join(systemRoot, "System32", "taskkill.exe");
      try {
        const killer = spawn(taskkill, ["/PID", String(pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
          shell: false,
        });
        killer.on("error", () => child.kill());
      } catch {
        child.kill();
      }
      return undefined;
    }
    const signalGroup = (sig: NodeJS.Signals): void => {
      try {
        process.kill(-pid, sig);
      } catch {
        child.kill(sig);
      }
    };
    signalGroup("SIGTERM");
    return setTimeout(() => signalGroup("SIGKILL"), TERM_TO_KILL_MS);
  }

  const notStarted: RunCommandPayload = { exitCode: null, stdout: "", stderr: "", timedOut: false, truncated: false };

  return {
    async run(request, signal) {
      if (signal.aborted) return notStarted;
      const launch = await plan(request, buildChildEnv(parentEnv, platform, options.allowEnvValue));
      if ("spawnFailed" in launch) return launch;
      if (signal.aborted) return notStarted;

      return new Promise((resolve) => {
        const stdout = new OutputCapture();
        const stderr = new OutputCapture();
        const payload = (exitCode: number | null, timedOut: boolean): RunCommandPayload => ({
          exitCode,
          stdout: stdout.text(),
          stderr: stderr.text(),
          timedOut,
          truncated: stdout.truncated || stderr.truncated,
        });

        let child: ChildProcess;
        try {
          child = spawn(launch.file, [...launch.args], {
            cwd: request.cwdAbsolute,
            env: launch.env,
            shell: false,
            windowsHide: true,
            // Only cmd.exe gets a command line built by `planWindowsLaunch`, passed as is.
            windowsVerbatimArguments: launch.verbatimArguments,
            stdio: ["ignore", "pipe", "pipe"],
            // POSIX: own process group, so the whole group can be signalled.
            detached: !isWindows,
          });
        } catch (error) {
          resolve({ spawnFailed: true, message: `could not start process (${errorCode(error)})` });
          return;
        }

        let settled = false;
        let stopping = false;
        let timedOut = false;
        let started = false;
        /** Set when the child process itself has ended (T-2). Its exit code is final then. */
        let exited = false;
        let exitCode: number | null = null;
        let escalateTimer: NodeJS.Timeout | undefined;
        let closeWaitTimer: NodeJS.Timeout | undefined;
        let graceTimer: NodeJS.Timeout | undefined;

        const settle = (result: RunCommandPayload | CommandSpawnFailure): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutTimer);
          clearTimeout(escalateTimer);
          clearTimeout(closeWaitTimer);
          clearTimeout(graceTimer);
          signal.removeEventListener("abort", onAbort);
          resolve(result);
        };

        /** Stops reading: a descendant may keep the pipes open for as long as it likes. */
        const settleWithoutPipes = (): void => {
          child.stdout?.destroy();
          child.stderr?.destroy();
          settle(payload(stopping ? null : exitCode, timedOut));
        };

        const stop = (): void => {
          if (stopping || settled) return;
          // T-2: the tree is only ended while the child is alive. An ended child's PID may already
          // belong to an unrelated process, so it is never signalled or passed to taskkill.
          if (exited) {
            settleWithoutPipes();
            return;
          }
          stopping = true;
          escalateTimer = killTree(child);
          closeWaitTimer = setTimeout(settleWithoutPipes, CLOSE_WAIT_AFTER_KILL_MS);
        };

        const onAbort = (): void => stop();
        const timeoutTimer = setTimeout(() => {
          timedOut = true;
          stop();
        }, request.timeoutMs);
        signal.addEventListener("abort", onAbort, { once: true });

        child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
        child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
        child.on("spawn", () => {
          started = true;
        });
        child.on("error", (error) => {
          if (!started) {
            settle({ spawnFailed: true, message: `could not start process (${errorCode(error)})` });
          }
          // After start an error means a failed kill. Close or the wait timer settles the run.
        });
        child.on("exit", (code) => {
          exited = true;
          exitCode = code;
          // The command finished: its time limit no longer applies (T-2).
          clearTimeout(timeoutTimer);
          // A stop in progress keeps its own wait (POSIX may still escalate to the group).
          // Otherwise output still in flight gets a short grace, then the pipes are closed even
          // when a background descendant holds them.
          if (!stopping) graceTimer = setTimeout(settleWithoutPipes, PIPE_GRACE_AFTER_EXIT_MS);
        });
        child.on("close", (code) => {
          settle(payload(stopping ? null : (exitCode ?? code), timedOut));
        });
      });
    },
  };
}
