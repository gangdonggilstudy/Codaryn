/**
 * The main process's side of the engine host channel (DR-26, docs/design/standalone-gui.md 4.2,
 * 4.4). Starts the host as a separate Node 26+ process, speaks to it over stdin and stdout only,
 * and ends it with the app. Uses Node APIs only (no Electron), so unit tests run it under Node.
 */

import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams, SpawnOptions } from "node:child_process";
import { CHANNEL_ERRORS, LineDecoder, MIN_NODE_MAJOR, PendingCalls, encodeLine, nodeMajor, parseHostMessage } from "../shared/protocol.js";
import type { HostCall, HostResponse } from "../shared/protocol.js";

export interface EngineHostOptions {
  /** Absolute path of a Node 26+ executable (node-path.ts). */
  readonly nodePath: string;
  /** Absolute path of the built `engine-host/main.js`. */
  readonly hostScript: string;
  /** Absolute path of the built engine (`dist/src`). */
  readonly engineDir: string;
  /** The host's environment, already filtered (environment.ts). */
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  /** How long to wait for `ready`. Default 15 s. */
  readonly readyTimeoutMs?: number;
  /** How long `close` waits after closing stdin before killing the host. Default 3 s. */
  readonly closeTimeoutMs?: number;
  /** Pass the host's stderr through (development). Default: discarded. */
  readonly showStderr?: boolean;
}

export type EngineHostFailure = "host_not_started" | "node_too_old" | "ready_timeout" | "protocol_violation" | "host_exited";

export interface EngineHost {
  /** The host's Node version from `ready`. */
  readonly nodeVersion: string;
  readonly pid: number | undefined;
  /** True once the host has exited (on its own, by `close`, or after a protocol violation). */
  readonly exited: boolean;
  /** One request. Never rejects: failures come back as an error response. */
  call(call: HostCall, args: unknown, timeoutMs: number): Promise<HostResponse>;
  /** Closes stdin, waits for the host to end, and kills it after the close timeout. */
  close(): Promise<void>;
  /** Called once when the host has exited. */
  onExit(listener: () => void): void;
}

export type StartOutcome =
  | { readonly ok: true; readonly host: EngineHost }
  | { readonly ok: false; readonly failure: EngineHostFailure; readonly nodeVersion: string | null };

export async function startEngineHost(options: EngineHostOptions): Promise<StartOutcome> {
  const spawnOptions: SpawnOptions = {
    cwd: options.cwd,
    env: { ...options.env },
    stdio: ["pipe", "pipe", options.showStderr === true ? "inherit" : "ignore"],
    windowsHide: true,
    shell: false,
  };
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(options.nodePath, [options.hostScript, "--engine-dir", options.engineDir], spawnOptions) as ChildProcessWithoutNullStreams;
  } catch {
    return { ok: false, failure: "host_not_started", nodeVersion: null };
  }

  const pending = new PendingCalls();
  const exitListeners: (() => void)[] = [];
  let exited = false;
  let nodeVersion: string | null = null;
  let settleStart: ((outcome: StartOutcome) => void) | null = null;
  let host: EngineHost | null = null;

  const startOutcome = new Promise<StartOutcome>((resolve) => {
    settleStart = resolve;
  });
  const endStart = (outcome: StartOutcome): void => {
    const settle = settleStart;
    settleStart = null;
    settle?.(outcome);
  };

  /**
   * The start failed: the host is killed and the failure is reported once it has exited (or after
   * the close timeout), so no host is left behind when the caller hears about it (DR-8).
   */
  let failedStart: StartOutcome | null = null;
  const failStart = (failure: EngineHostFailure): void => {
    if (settleStart === null || failedStart !== null) return;
    failedStart = { ok: false, failure, nodeVersion };
    if (exited) {
      endStart(failedStart);
      return;
    }
    const outcome = failedStart;
    setTimeout(() => endStart(outcome), options.closeTimeoutMs ?? 3_000).unref();
    child.kill();
  };

  /** The host broke the channel: it is ended and every waiting request fails. */
  const violation = (): void => {
    pending.failAll({ code: CHANNEL_ERRORS.hostExited, message: "the engine host broke the message channel" });
    failStart("protocol_violation");
    child.kill();
  };

  const decoder = new LineDecoder((line) => {
    const message = parseHostMessage(line);
    if (message === null) {
      violation();
      return;
    }
    if ("type" in message) {
      if (nodeVersion !== null) {
        violation();
        return;
      }
      nodeVersion = message.node;
      const major = nodeMajor(message.node);
      if (major === null || major < MIN_NODE_MAJOR) {
        failStart("node_too_old");
        return;
      }
      host = makeHost(message.node);
      endStart({ ok: true, host });
      return;
    }
    if (nodeVersion === null || !pending.settle(message)) violation();
  }, violation);

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => decoder.push(chunk));
  child.stdout.on("end", () => decoder.end());
  // A write after the host closed its stdin must not throw in the main process.
  child.stdin.on("error", () => undefined);
  child.on("error", () => {
    endStart({ ok: false, failure: "host_not_started", nodeVersion });
  });
  child.on("exit", () => {
    exited = true;
    pending.failAll({ code: CHANNEL_ERRORS.hostExited, message: "the engine host has exited" });
    endStart(failedStart ?? { ok: false, failure: "host_exited", nodeVersion });
    for (const listener of exitListeners.splice(0)) listener();
  });

  const readyTimer = setTimeout(() => failStart("ready_timeout"), options.readyTimeoutMs ?? 15_000);
  const outcome = await startOutcome;
  clearTimeout(readyTimer);
  return outcome;

  function makeHost(version: string): EngineHost {
    return {
      nodeVersion: version,
      pid: child.pid,
      get exited() {
        return exited;
      },
      call(call, args, timeoutMs) {
        const id = pending.next();
        if (exited) {
          return Promise.resolve({ v: 1, id, ok: false, error: { code: CHANNEL_ERRORS.hostExited, message: "the engine host has exited" } });
        }
        let line: string;
        try {
          line = encodeLine({ v: 1, id, call, args });
        } catch {
          return Promise.resolve({ v: 1, id, ok: false, error: { code: CHANNEL_ERRORS.invalidArgs, message: "the request is too long" } });
        }
        const answer = pending.wait(id, timeoutMs);
        child.stdin.write(line);
        return answer;
      },
      close() {
        if (exited) return Promise.resolve();
        return new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            child.kill();
          }, options.closeTimeoutMs ?? 3_000);
          exitListeners.push(() => {
            clearTimeout(timer);
            resolve();
          });
          child.stdin.end();
        });
      },
      onExit(listener) {
        if (exited) listener();
        else exitListeners.push(listener);
      },
    };
  }
}
