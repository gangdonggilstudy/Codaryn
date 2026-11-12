/**
 * R21-I-3: a transport for tests. With `--transport loopback-only` (given only by the smoke test
 * and the unit tests that start the real engine host; the app's own start never gives it), the
 * engine host hands the app layer this `fetch`: a request to this machine (a loopback address,
 * where the tests' fake API listens) goes through, anything else is refused before any socket or
 * name lookup. So a test can never reach a real API, whatever a config file says. It only takes
 * away; it never lets through what the real `fetch` would not.
 */

import type net from "node:net";
import type { Socket } from "node:net";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

/** Whether `url` names this machine (a loopback address). Unparsable URLs are not. */
export function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return LOOPBACK_HOSTS.has(host);
  } catch {
    return false;
  }
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** `real` for loopback requests only; any other is refused (and counted) without being sent. */
export function loopbackOnlyFetch(real: typeof fetch, refused: () => void): typeof fetch {
  const guarded = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): ReturnType<typeof fetch> => {
    if (isLoopbackUrl(urlOf(input))) return real(input, init);
    refused();
    return Promise.reject(new TypeError("codaryn test transport: only this machine can be reached"));
  };
  return guarded as typeof fetch;
}

/**
 * R21b-I-1: the same guard on the global `fetch`. The app layer hands a `fetch` to Anthropic's
 * transport only (anthropicDeps); another provider's adapter (OpenAI's) takes `globalThis.fetch`
 * when given none. Guarding the global one too keeps every provider, present and later, on this
 * machine in tests.
 */
export function guardGlobalFetch(target: { fetch: typeof fetch }, refused: () => void): void {
  target.fetch = loopbackOnlyFetch(target.fetch.bind(target), refused);
}

/** The error code of a connection the guard refused. */
export const REFUSED_CODE = "CODARYN_TEST_TRANSPORT";

/** Whether `host` names this machine as the transport counts it: 127.0.0.1, ::1 or localhost. */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.replace(/^\[|\]$/g, "").toLowerCase());
}

/**
 * Where a `Socket.prototype.connect` call goes, from its arguments as Node passes them: an options
 * object, Node's own normalized `[options, callback]`, `(port[, host])`, or `(path)` for a local pipe.
 */
function connectTarget(args: readonly unknown[]): { readonly kind: "pipe" } | { readonly kind: "host"; readonly host: string } {
  const first = Array.isArray(args[0]) ? (args[0] as readonly unknown[])[0] : args[0];
  if (typeof first === "object" && first !== null) {
    const options = first as Record<string, unknown>;
    if (typeof options["path"] === "string") return { kind: "pipe" };
    const host = options["host"];
    return { kind: "host", host: typeof host === "string" && host.length > 0 ? host : "localhost" };
  }
  if (typeof first === "string" && !/^[0-9]+$/.test(first)) return { kind: "pipe" };
  const host = args[1];
  return { kind: "host", host: typeof host === "string" && host.length > 0 ? host : "localhost" };
}

type Connect = (this: Socket, ...args: unknown[]) => Socket;

/**
 * PM (c): the same rule for connections made without `fetch`: node:net, and so node:http,
 * node:https and node:tls, which connect through `net.Socket.prototype.connect`. A connection to
 * another host is refused before the socket connects or a name is looked up (the socket ends with
 * REFUSED_CODE) and counted; a local pipe and this machine's loopback address go through. Returns
 * the function that puts the original back.
 */
export function guardSockets(netModule: typeof net, refused: (host: string) => void): () => void {
  const prototype = netModule.Socket.prototype as unknown as { connect: Connect };
  const original = prototype.connect;
  prototype.connect = function guardedConnect(this: Socket, ...args: unknown[]): Socket {
    const target = connectTarget(args);
    if (target.kind === "host" && !isLoopbackHost(target.host)) {
      refused(target.host);
      const error = Object.assign(new Error("codaryn test transport: only this machine can be reached"), { code: REFUSED_CODE });
      process.nextTick(() => this.destroy(error));
      return this;
    }
    return original.apply(this, args);
  };
  return () => {
    prototype.connect = original;
  };
}
