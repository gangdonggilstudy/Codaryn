/**
 * Network fence for mock API tests. `startCli` preloads this module into the CLI process with
 * `node --import` when `netGuardLog` is set. It wraps the global `fetch` so that only loopback
 * hosts can be reached. Any other attempt is appended (origin only, never headers or bodies) to
 * the file named by NET_GUARD_LOG_ENV and fails like a network error.
 *
 * This is test harness code, not product code. It guarantees that a fake key never travels to a
 * real host, even when the CLI ignores a configured address. It covers `fetch` only, which is the
 * transport the work order fixes (C-7); `node:http`/`node:https` calls are not fenced.
 *
 * Importing this module elsewhere has no effect unless NET_GUARD_LOG_ENV is set in that process.
 */

import { appendFileSync } from "node:fs";

export const NET_GUARD_LOG_ENV = "CODARYN_IT_NET_GUARD_LOG";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function targetOf(input: Parameters<typeof fetch>[0]): URL | null {
  try {
    return new URL(input instanceof Request ? input.url : String(input));
  } catch {
    return null;
  }
}

const logFile = process.env[NET_GUARD_LOG_ENV];
if (logFile !== undefined && logFile !== "") {
  const originalFetch = globalThis.fetch;
  const guardedFetch = async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const target = targetOf(input);
    if (target === null || !LOOPBACK_HOSTS.has(target.hostname)) {
      appendFileSync(logFile, `${target === null ? "unparsable-url" : target.origin}\n`);
      throw new TypeError("integration test network guard: only loopback hosts may be reached");
    }
    return originalFetch(input, init);
  };
  globalThis.fetch = guardedFetch as typeof fetch;
}
