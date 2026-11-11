/**
 * Real command runner: starts one process without a shell, with a filtered environment,
 * a time limit, an output cap and cancellation.
 *
 * Known limits (not OS isolation):
 * - Windows: `.cmd` and `.bat` files cannot be started without a shell. Only real executables
 *   (for example `node`) work. Such a start is reported as `spawnFailed`.
 * - Tree termination is best effort. Windows uses `taskkill /T /F` (forced, no graceful stop).
 *   POSIX signals the process group (SIGTERM, then SIGKILL). Descendants that left the tree or
 *   the group (detached, re-parented after their parent exited, own session) are not reached.
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
}

/** Extra bytes captured beyond MAX_COMMAND_OUTPUT_BYTES, so that masking happens before the cut. */
export const COMMAND_CAPTURE_SLACK_BYTES = 4_096;
const CAPTURE_LIMIT_BYTES = MAX_COMMAND_OUTPUT_BYTES + COMMAND_CAPTURE_SLACK_BYTES;

/** After a kill request, wait this long for the process to close before giving up on it. */
const CLOSE_WAIT_AFTER_KILL_MS = 5_000;
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

export function createCommandRunner(options: CommandRunnerOptions = {}): CommandRunner {
  const parentEnv = options.parentEnv ?? process.env;
  const platform = options.platform ?? process.platform;
  const isWindows = platform === "win32";

  function killTree(child: ChildProcess): NodeJS.Timeout | undefined {
    const pid = child.pid;
    if (pid === undefined) return undefined;
    if (isWindows) {
      const systemRoot = parentEnv["SystemRoot"] ?? parentEnv["SYSTEMROOT"] ?? "C:\\Windows";
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

  return {
    run(request, signal) {
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

        if (signal.aborted) {
          resolve(payload(null, false));
          return;
        }

        let child: ChildProcess;
        try {
          child = spawn(request.executable, [...request.args], {
            cwd: request.cwdAbsolute,
            env: buildChildEnv(parentEnv, platform, options.allowEnvValue),
            shell: false,
            windowsHide: true,
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
        let escalateTimer: NodeJS.Timeout | undefined;
        let closeWaitTimer: NodeJS.Timeout | undefined;

        const settle = (result: RunCommandPayload | CommandSpawnFailure): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutTimer);
          clearTimeout(escalateTimer);
          clearTimeout(closeWaitTimer);
          signal.removeEventListener("abort", onAbort);
          resolve(result);
        };

        const stop = (): void => {
          if (stopping || settled) return;
          stopping = true;
          escalateTimer = killTree(child);
          // A descendant may keep the pipes open. Do not wait for it forever.
          closeWaitTimer = setTimeout(() => {
            child.stdout?.destroy();
            child.stderr?.destroy();
            settle(payload(null, timedOut));
          }, CLOSE_WAIT_AFTER_KILL_MS);
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
        child.on("close", (code) => {
          settle(payload(stopping ? null : code, timedOut));
        });
      });
    },
  };
}
