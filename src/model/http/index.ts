/**
 * The HTTP transport shared by the API providers (SP-3, docs/design/second-provider.md 5절). Moved
 * from the Anthropic adapter as it was; each adapter gives its headers, its status reading and its
 * error-body quoting, and its key shapes for redaction. Nothing here knows a provider's format.
 *
 * - Transport is the built-in `fetch` (decision C-7). Both `fetch` and the retry `sleep` are injectable.
 * - The key goes into the adapter's headers only. Every message an adapter returns passes through
 *   `createRedactor`: cut, with the key, its fragments and key-shaped strings removed (S-12).
 * - Bodies are read as a byte stream and the read stops at a limit: MAX_SUCCESS_BODY_BYTES for a
 *   success body (more is `malformed_response`), MAX_ERROR_BODY_BYTES for an error body (S-10).
 * - Redirects are refused, so the key is not sent elsewhere.
 * - A transport error is a connection failure only when its cause carries a known connection code;
 *   such failures are retried. Any other `TypeError` from fetch is a format error and is not retried.
 *   No text of a transport error is copied into a message, only fixed phrases and allowlisted codes.
 */

import { MAX_RETRIES_LIMIT } from "../../contracts/index.js";
import type { ListModelsSettings, ModelErrorKind } from "../../contracts/index.js";

/** Longest message an outcome carries. */
export const MAX_ERROR_MESSAGE_CHARS = 300;
/** A success body larger than this is `malformed_response`. The read stops at the limit. */
export const MAX_SUCCESS_BODY_BYTES = 8 * 1024 * 1024;
/** Only this much of an error body is read. */
export const MAX_ERROR_BODY_BYTES = 4096;
/** Only this much of any text is looked at before it becomes a message. */
const MAX_ERROR_SOURCE_CHARS = 4096;
/** A run of this many characters that also occurs in the key is removed from messages. */
export const KEY_FRAGMENT_CHARS = 8;
const REDACTED = "[redacted]";

/** One character that separates nothing in a key: control characters, white space, invisible marks. */
const SEPARATOR = /[\s\u0000-\u001f\u007f-\u009f​-‍⁠﻿]/;
export const SEPARATOR_RUN = /[\s\u0000-\u001f\u007f-\u009f​-‍⁠﻿]+/g;

/** A key may hold printable ASCII only (0x21-0x7E): no space, no control or non-ASCII character. */
const USABLE_KEY = /^[\x21-\x7e]+$/;

/** True when `apiKey` can be sent in a header as is. The CLI may call this before building a provider. */
export function isUsableApiKey(apiKey: string): boolean {
  return USABLE_KEY.test(apiKey);
}

/** Cause codes of Node's fetch that mean the connection failed. These attempts are retried. */
const CONNECTION_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENETDOWN",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
]);
/** Cause codes that mean the TLS handshake or certificate check failed. Not retried. */
const TLS_CODE = /^(CERT_[A-Z_]{1,40}|ERR_TLS_[A-Z_]{1,40}|ERR_SSL_[A-Z_]{1,40}|UNABLE_TO_[A-Z_]{1,40}|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN)$/;

type TransportError =
  | { readonly kind: "connection"; readonly code: string }
  | { readonly kind: "tls"; readonly code: string }
  | { readonly kind: "format" }
  | { readonly kind: "unknown" };

function causeCode(error: unknown): string | null {
  const cause = (error as { cause?: unknown } | null)?.cause;
  const code = (cause as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" ? code : null;
}

/**
 * Connection and format errors both arrive as `TypeError` (often "fetch failed"). Only the cause's
 * code tells them apart: a known connection code is a connection failure; any other `TypeError`
 * (invalid header, ByteString conversion, invalid URL, blocked port) is a format error.
 */
function classifyTransportError(error: unknown): TransportError {
  const code = causeCode(error);
  if (code !== null && CONNECTION_CODES.has(code)) return { kind: "connection", code };
  if (code !== null && TLS_CODE.test(code)) return { kind: "tls", code };
  if (error instanceof TypeError) return { kind: "format" };
  return { kind: "unknown" };
}

export const BASE_BACKOFF_MS = 500;
export const MAX_BACKOFF_MS = 8_000;
export const MAX_RETRY_AFTER_MS = 60_000;


export type Failure = {
  readonly ok: false;
  readonly kind: ModelErrorKind;
  readonly message: string;
  /** SP-3: the HTTP status of a failure that is an HTTP response (ModelOutcome.httpStatus). */
  readonly httpStatus?: number;
};

/**
 * One HTTP attempt. `body`: a 2xx body read within MAX_SUCCESS_BODY_BYTES, for the caller to parse.
 * `final`: an end that is neither retried nor counted in the message (an oversized success body).
 */
type Attempt =
  | { readonly type: "body"; readonly text: string }
  | { readonly type: "final"; readonly kind: ModelErrorKind; readonly message: string }
  | { readonly type: "aborted" }
  | {
      readonly type: "failed";
      readonly kind: ModelErrorKind;
      readonly message: string;
      readonly retryable: boolean;
      readonly retryAfterMs?: number;
      /** SP-3: the status of the HTTP response this failure is, absent for a transport failure. */
      readonly status?: number;
    };


export function isPlainObject(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}


/**
 * Builds the function every outgoing message passes through.
 *
 * Matching runs on a compact view of the text with every separator (control character, white space,
 * invisible mark) left out, so a key split by line breaks or spaces is still found. A match marks
 * the original range it spans, separators included. Only then are separator runs turned into one space.
 */
export function createRedactor(apiKey: string, keyShapeSources: readonly string[]): (text: string) => string {
  const fragments = new Set<string>();
  for (let index = 0; index + KEY_FRAGMENT_CHARS <= apiKey.length; index += 1) {
    fragments.add(apiKey.slice(index, index + KEY_FRAGMENT_CHARS));
  }
  const keyShapes = keyShapeSources.map((source) => new RegExp(source, "g"));
  const keyShapesAtStart = keyShapeSources.map((source) => new RegExp(source, "y"));

  return (input: string): string => {
    const text = input.length > MAX_ERROR_SOURCE_CHARS ? input.slice(0, MAX_ERROR_SOURCE_CHARS) : input;

    // Compact view: kept characters and where each one sits in `text`.
    const positions: number[] = [];
    let compact = "";
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index] as string;
      if (SEPARATOR.test(char)) continue;
      positions.push(index);
      compact += char;
    }

    const covered = new Uint8Array(text.length);
    const cover = (start: number, length: number): void => {
      const from = positions[start];
      const to = positions[start + length - 1];
      if (from !== undefined && to !== undefined) covered.fill(1, from, to + 1);
    };
    for (let at = compact.indexOf(apiKey); apiKey.length > 0 && at !== -1; at = compact.indexOf(apiKey, at + 1)) {
      cover(at, apiKey.length);
    }
    for (let index = 0; fragments.size > 0 && index + KEY_FRAGMENT_CHARS <= compact.length; index += 1) {
      if (fragments.has(compact.slice(index, index + KEY_FRAGMENT_CHARS))) cover(index, KEY_FRAGMENT_CHARS);
    }
    for (const keyShape of keyShapes) {
      for (const match of compact.matchAll(keyShape)) cover(match.index, match[0].length);
      // SP-5: also on the text as it is, for a key whose end runs into the next word in the compact view.
      for (const match of text.matchAll(keyShape)) covered.fill(1, match.index, match.index + match[0].length);
    }
    // SP-5: a shape that needs a word start (``, the OpenAI ones) finds none in the compact view
    // where a separator was left out: the key is glued to the word before it. So each such place is
    // also tried as a start, which keeps a key split by separators findable there too.
    for (let index = 1; index < compact.length; index += 1) {
      if ((positions[index] as number) - (positions[index - 1] as number) === 1) continue;
      const rest = compact.slice(index);
      for (const keyShape of keyShapesAtStart) {
        keyShape.lastIndex = 0;
        const match = keyShape.exec(rest);
        if (match !== null) cover(index, match[0].length);
      }
    }

    let out = "";
    let index = 0;
    while (index < text.length) {
      if (covered[index] === 1) {
        out += REDACTED;
        while (index < text.length && covered[index] === 1) index += 1;
      } else {
        out += text[index];
        index += 1;
      }
    }

    out = out.replace(SEPARATOR_RUN, " ").trim();
    return out.length > MAX_ERROR_MESSAGE_CHARS ? `${out.slice(0, MAX_ERROR_MESSAGE_CHARS - 3)}...` : out;
  };
}

/** Result of reading a body up to a byte limit. */
export interface LimitedBody {
  readonly bytes: Uint8Array;
  /** True when the body had more bytes than the limit. The rest was neither read nor kept. */
  readonly over: boolean;
}

/**
 * Reads at most `limit` bytes of the body, then cancels the stream so the transfer stops.
 * A body that is `null` (no content) is empty. A response without a readable body throws.
 */
async function readLimited(response: Response, limit: number): Promise<LimitedBody> {
  const stream = response.body;
  if (stream === null) return { bytes: new Uint8Array(0), over: false };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let over = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = limit - size;
    if (value.byteLength > room) {
      if (room > 0) chunks.push(value.subarray(0, room));
      size += Math.max(room, 0);
      over = true;
      // Stop the transfer. Waiting for the cancellation is not needed and could hang.
      reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  return { bytes: Buffer.concat(chunks, size), over };
}

/** Lets go of a body that will not be read. */
function discardBody(response: Response): void {
  try {
    response.body?.cancel().catch(() => undefined);
  } catch {
    // A locked or broken body is left to the garbage collector.
  }
}

export const decoder = new TextDecoder("utf-8");


/**
 * Checks shared by model requests and model listing: the key is a non-empty string, the time
 * limit and retry count are in range, and the base URL is https (http for a loopback host only)
 * without credentials, a query or a fragment. Returns the base URL without a trailing slash.
 * Messages are fixed text: they never carry a value from the settings. `providerLabel` (a
 * provider name such as "anthropic") starts each message.
 */
export function validateConnection(settings: ListModelsSettings, providerLabel: string): string {
  if (typeof settings.apiKey !== "string" || settings.apiKey.length === 0) {
    throw new TypeError(`${providerLabel} provider: apiKey must be a non-empty string`);
  }
  if (!Number.isSafeInteger(settings.requestTimeoutMs) || settings.requestTimeoutMs <= 0) {
    throw new TypeError(`${providerLabel} provider: requestTimeoutMs must be a positive integer`);
  }
  if (
    !Number.isSafeInteger(settings.maxRetries) ||
    settings.maxRetries < 0 ||
    settings.maxRetries > MAX_RETRIES_LIMIT
  ) {
    throw new TypeError(`${providerLabel} provider: maxRetries must be an integer from 0 to ${MAX_RETRIES_LIMIT}`);
  }
  let base: URL;
  try {
    base = new URL(settings.apiBaseUrl);
  } catch {
    throw new TypeError(`${providerLabel} provider: apiBaseUrl is not a valid URL`);
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if (!(base.protocol === "https:" || (base.protocol === "http:" && loopback))) {
    throw new TypeError(`${providerLabel} provider: apiBaseUrl must use https (http only for a loopback host)`);
  }
  if (base.username !== "" || base.password !== "" || base.search !== "" || base.hash !== "") {
    throw new TypeError(`${providerLabel} provider: apiBaseUrl must not carry credentials, a query or a fragment`);
  }
  return settings.apiBaseUrl.replace(/\/+$/, "");
}


export function retryAfterMs(header: string | null, now: number): number | undefined {
  if (header === null) return undefined;
  const trimmed = header.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}


export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** What one HTTP exchange needs. Shared by model requests and model listing of every provider. */
export interface Transport {
  readonly fetch: typeof fetch;
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** The provider's headers (its key header among them), plus `content-type` for a request with a body. */
  readonly headers: { readonly [name: string]: string };
  readonly timeoutMs: number;
  readonly maxRetries: number;
  /**
   * The provider's reading of an error response: error kind and whether it is retried. It gets the
   * error body as read (within MAX_ERROR_BODY_BYTES) for providers that tell causes apart by it
   * (SP-5: OpenAI's quota errors are 429 like rate limits).
   */
  readonly classifyStatus: (status: number, body: LimitedBody) => { kind: ModelErrorKind; retryable: boolean };
  /**
   * How a `retry-after` header sets the wait (absent: "cap"). "cap": the header's wait replaces
   * the backoff, up to MAX_RETRY_AFTER_MS (Anthropic, as before). "minimum" (SP-5, DR-31 (f)): the
   * wait is the larger of the header's and the backoff, and a header asking for more than
   * MAX_RETRY_AFTER_MS ends the retries instead of retrying early.
   */
  readonly retryAfter?: "cap" | "minimum";
  /**
   * DR-35 (b): how many bytes of an error body are read for classifyStatus and describeError
   * (absent: MAX_ERROR_BODY_BYTES, as before). OpenAI reads more, so that a quota error with a long
   * message is still told apart from a rate limit.
   */
  readonly errorBodyLimit?: number;
  /**
   * The provider's description of an error response (what of its body may be quoted). SP-5: it also
   * gets the response headers, for a provider whose request id is a header (OpenAI `x-request-id`).
   */
  readonly describeError: (status: number, body: LimitedBody, headers: Headers) => string;
}

export interface HttpRequest {
  readonly method: "GET" | "POST";
  readonly url: string;
  /** Sent exactly as given on every attempt. Absent for GET. */
  readonly body?: string;
}

/** A request that ended: the 2xx body, or a failure whose message is not yet redacted. */
export type Sent =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly kind: ModelErrorKind; readonly message: string; readonly httpStatus?: number };

/**
 * One attempt: the request time limit, no redirects (the key is not sent elsewhere), the body read
 * within its byte limit, the status classified. Transport errors become fixed phrases (S-12).
 */
async function attemptOnce(transport: Transport, request: HttpRequest, signal: AbortSignal): Promise<Attempt> {
  const controller = new AbortController();
  let timedOut = false;
  const forward = (): void => controller.abort();
  signal.addEventListener("abort", forward, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, transport.timeoutMs);

  /** `stage` says whether the request was being sent or its response body read. */
  const transportFailure = (error: unknown, stage: "send" | "read"): Attempt => {
    if (signal.aborted) return { type: "aborted" };
    if (timedOut) {
      return {
        type: "failed",
        kind: "timeout",
        message: `the request did not finish within ${transport.timeoutMs} ms`,
        retryable: true,
      };
    }
    // Fixed phrases only: the error's own text may hold a header value or a character code.
    const failure = classifyTransportError(error);
    switch (failure.kind) {
      case "connection":
        return { type: "failed", kind: "api_error", message: `network error: connection failed (${failure.code})`, retryable: true };
      case "tls":
        return { type: "failed", kind: "api_error", message: `network error: TLS connection failed (${failure.code})`, retryable: false };
      case "format":
        return {
          type: "failed",
          kind: "api_error",
          message:
            stage === "send"
              ? "the transport refused the request format (header, URL or port); nothing was sent"
              : "the response body could not be read",
          retryable: false,
        };
      case "unknown":
        return { type: "failed", kind: "api_error", message: "network error: unknown transport failure", retryable: false };
    }
  };

  try {
    let response: Response;
    try {
      response = await transport.fetch(request.url, {
        method: request.method,
        headers: transport.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        signal: controller.signal,
        redirect: "manual",
      });
    } catch (error) {
      return transportFailure(error, "send");
    }
    if (signal.aborted) {
      discardBody(response);
      return { type: "aborted" };
    }

    const status = response.status;
    const success = status >= 200 && status < 300;
    if (!success && (response.type === "opaqueredirect" || status === 0 || (status >= 300 && status < 400))) {
      discardBody(response);
      return {
        type: "failed",
        kind: "api_error",
        message: `HTTP ${status}: redirects are not followed, so the key is not sent elsewhere`,
        retryable: false,
        ...(status > 0 ? { status } : {}),
      };
    }

    let read: LimitedBody;
    try {
      read = await readLimited(response, success ? MAX_SUCCESS_BODY_BYTES : (transport.errorBodyLimit ?? MAX_ERROR_BODY_BYTES));
    } catch (error) {
      return transportFailure(error, "read");
    }
    if (signal.aborted) return { type: "aborted" };

    if (success) {
      if (read.over) {
        return { type: "final", kind: "malformed_response", message: `malformed response: the response body is larger than ${MAX_SUCCESS_BODY_BYTES} bytes` };
      }
      return { type: "body", text: decoder.decode(read.bytes) };
    }
    const { kind, retryable } = transport.classifyStatus(status, read);
    const after = retryable ? retryAfterMs(response.headers.get("retry-after"), Date.now()) : undefined;
    return {
      type: "failed",
      kind,
      message: transport.describeError(status, read, response.headers),
      retryable,
      ...(after === undefined ? {} : { retryAfterMs: after }),
      status,
    };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", forward);
  }
}

/** Attempts until a body, a final failure, or the retries (`maxRetries`) are used up. */
export async function sendWithRetries(transport: Transport, request: HttpRequest, signal: AbortSignal): Promise<Sent> {
  const attempts = transport.maxRetries + 1;
  for (let attempt = 1; ; attempt += 1) {
    const result = await attemptOnce(transport, request, signal);
    if (result.type === "aborted") return { ok: false, kind: "aborted", message: "cancelled while the request was in flight" };
    if (result.type === "body") return { ok: true, text: result.text };
    if (result.type === "final") return { ok: false, kind: result.kind, message: result.message };
    const minimum = transport.retryAfter === "minimum";
    const tooLong = minimum && result.retryAfterMs !== undefined && result.retryAfterMs > MAX_RETRY_AFTER_MS;
    if (!result.retryable || attempt >= attempts || tooLong) {
      const suffix = attempt > 1 ? ` (after ${attempt} attempts)` : "";
      return { ok: false, kind: result.kind, message: `${result.message}${suffix}`, ...(result.status === undefined ? {} : { httpStatus: result.status }) };
    }
    const backoff = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
    const delay = minimum
      ? Math.max(result.retryAfterMs ?? 0, backoff)
      : result.retryAfterMs !== undefined
        ? Math.min(result.retryAfterMs, MAX_RETRY_AFTER_MS)
        : backoff;
    try {
      await transport.sleep(delay, signal);
    } catch {
      // A sleep that rejects is treated like one that ended early.
    }
    if (signal.aborted) return { ok: false, kind: "aborted", message: "cancelled while waiting to retry" };
  }
}


export const UNUSABLE_KEY_MESSAGE =
  "the API key may hold printable ASCII characters only (0x21-0x7E, no spaces); nothing was sent";


/**
 * True when `text` holds the key, a run of KEY_FRAGMENT_CHARS characters of it, or a key-shaped
 * string, ignoring separators as the redactor does. Used to refuse values from a response that
 * would carry key material out of this module.
 */
export function createKeyMaterialCheck(apiKey: string, keyShapeSources: readonly string[]): (text: string) => boolean {
  const fragments = new Set<string>();
  for (let index = 0; index + KEY_FRAGMENT_CHARS <= apiKey.length; index += 1) {
    fragments.add(apiKey.slice(index, index + KEY_FRAGMENT_CHARS));
  }
  const keyShapes = keyShapeSources.map((source) => new RegExp(source));
  const keyShapesAtStart = keyShapeSources.map((source) => new RegExp(source, "y"));
  return (text: string): boolean => {
    const compact = text.replace(SEPARATOR_RUN, "");
    if (apiKey.length > 0 && compact.includes(apiKey)) return true;
    for (let index = 0; fragments.size > 0 && index + KEY_FRAGMENT_CHARS <= compact.length; index += 1) {
      if (fragments.has(compact.slice(index, index + KEY_FRAGMENT_CHARS))) return true;
    }
    // SP-5: the text as it is, and each place a separator run was left out as a start (see createRedactor).
    if (keyShapes.some((keyShape) => keyShape.test(compact) || keyShape.test(text))) return true;
    const pieces = text.split(SEPARATOR_RUN);
    for (let index = 1; index < pieces.length; index += 1) {
      const rest = pieces.slice(index).join("");
      for (const keyShape of keyShapesAtStart) {
        keyShape.lastIndex = 0;
        if (keyShape.test(rest)) return true;
      }
    }
    return false;
  };
}
