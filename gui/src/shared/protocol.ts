/**
 * The message channel between the Electron main process and the engine host (DR-26,
 * docs/design/standalone-gui.md 4.2): one JSON object per line on the host's stdin (requests) and
 * stdout (ready, responses). Version 1. Pure: no Node, Electron or DOM API, so the main process
 * (Electron's Node), the engine host (Node 26) and the unit tests share it.
 */

export const PROTOCOL_VERSION = 1;

/** Longest accepted line, in UTF-16 code units (about the same number of bytes for JSON text). */
export const MAX_LINE_CHARS = 8 * 1024 * 1024;

/** The engine host must run on Node 26 or later (M-21, DR-26). */
export const MIN_NODE_MAJOR = 26;

/** Calls the engine host answers. Each later unit adds the app layer functions it needs. */
export const HOST_CALLS = ["doctor", "messages", "tree"] as const;
export type HostCall = (typeof HOST_CALLS)[number];

export interface HostRequest {
  readonly v: 1;
  readonly id: number;
  readonly call: HostCall;
  readonly args: unknown;
}

export interface HostError {
  readonly code: string;
  readonly message: string;
}

export type HostResponse =
  | { readonly v: 1; readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly v: 1; readonly id: number; readonly ok: false; readonly error: HostError };

export interface HostReady {
  readonly v: 1;
  readonly type: "ready";
  /** `process.versions.node` of the engine host. */
  readonly node: string;
}

export type HostMessage = HostReady | HostResponse;

/** Error codes of the channel itself (the app layer's own errors travel inside `value`). */
export const CHANNEL_ERRORS = {
  invalidMessage: "invalid_message",
  unknownCall: "unknown_call",
  invalidArgs: "invalid_args",
  hostError: "host_error",
  hostExited: "adapter_host_exited",
  timeout: "adapter_timeout",
} as const;

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parseLine(line: string): Obj | null {
  if (line.length > MAX_LINE_CHARS) return null;
  try {
    const value: unknown = JSON.parse(line);
    return isObj(value) && value["v"] === PROTOCOL_VERSION ? value : null;
  } catch {
    return null;
  }
}

/** One message as a line. Throws when the line would be longer than MAX_LINE_CHARS. */
export function encodeLine(message: HostRequest | HostMessage): string {
  const text = JSON.stringify(message);
  if (text.length > MAX_LINE_CHARS) throw new RangeError("message too long for the channel");
  return `${text}\n`;
}

export type ParsedRequest =
  | { readonly ok: true; readonly request: HostRequest }
  | { readonly ok: false; readonly id: number | null; readonly error: HostError };

/** A request line as the engine host reads it. The id is kept when it can be, so the error can be answered. */
export function parseRequest(line: string): ParsedRequest {
  const value = parseLine(line);
  if (value === null) return { ok: false, id: null, error: { code: CHANNEL_ERRORS.invalidMessage, message: "not a version 1 message" } };
  const id = value["id"];
  if (!isId(id)) return { ok: false, id: null, error: { code: CHANNEL_ERRORS.invalidMessage, message: "the request has no valid id" } };
  const call = value["call"];
  if (typeof call !== "string" || !(HOST_CALLS as readonly string[]).includes(call)) {
    return { ok: false, id, error: { code: CHANNEL_ERRORS.unknownCall, message: "unknown call" } };
  }
  return { ok: true, request: { v: 1, id, call: call as HostCall, args: value["args"] } };
}

/** A line from the engine host as the main process reads it, or null when it is not a valid message. */
export function parseHostMessage(line: string): HostMessage | null {
  const value = parseLine(line);
  if (value === null) return null;
  if (value["type"] === "ready") {
    const node = value["node"];
    return typeof node === "string" && node.length > 0 && node.length <= 64 ? { v: 1, type: "ready", node } : null;
  }
  const id = value["id"];
  if (!isId(id)) return null;
  if (value["ok"] === true) return { v: 1, id, ok: true, value: value["value"] };
  if (value["ok"] === false) {
    const error = value["error"];
    if (!isObj(error) || typeof error["code"] !== "string" || typeof error["message"] !== "string") return null;
    return { v: 1, id, ok: false, error: { code: error["code"], message: error["message"] } };
  }
  return null;
}

/** The major version of a `process.versions.node` string, or null. */
export function nodeMajor(version: string): number | null {
  const match = /^v?(\d{1,4})\.\d{1,6}\.\d{1,6}/.exec(version);
  return match === null ? null : Number(match[1]);
}

/**
 * Splits a text stream into lines (LF, with a CR before it dropped). A line longer than the limit
 * is reported once through `onOverflow` and skipped up to its end; it is never delivered in part.
 */
export class LineDecoder {
  private buffer = "";
  private skipping = false;

  constructor(
    private readonly onLine: (line: string) => void,
    private readonly onOverflow: () => void,
    private readonly maxChars: number = MAX_LINE_CHARS,
  ) {}

  push(chunk: string): void {
    let rest = chunk;
    for (;;) {
      const end = rest.indexOf("\n");
      if (end < 0) {
        if (!this.skipping) {
          this.buffer += rest;
          if (this.buffer.length > this.maxChars) {
            this.buffer = "";
            this.skipping = true;
            this.onOverflow();
          }
        }
        return;
      }
      const piece = rest.slice(0, end);
      rest = rest.slice(end + 1);
      if (this.skipping) {
        this.skipping = false;
        continue;
      }
      let line = this.buffer + piece;
      this.buffer = "";
      if (line.length > this.maxChars) {
        this.onOverflow();
        continue;
      }
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.length > 0) this.onLine(line);
    }
  }

  /** The stream ended. A last line without LF is incomplete and dropped. */
  end(): void {
    this.buffer = "";
    this.skipping = false;
  }
}

/** Requests waiting for their response, each with a time limit. */
export class PendingCalls {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (response: HostResponse) => void; timer: ReturnType<typeof setTimeout> }>();

  /** A new request id. */
  next(): number {
    const id = this.nextId;
    this.nextId += 1;
    return id;
  }

  get size(): number {
    return this.pending.size;
  }

  /** Waits for the response with this id; after `timeoutMs` it resolves with an `adapter_timeout` error. */
  wait(id: number, timeoutMs: number): Promise<HostResponse> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ v: 1, id, ok: false, error: { code: CHANNEL_ERRORS.timeout, message: "the engine host did not answer in time" } });
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });
    });
  }

  /** Delivers a response. False when nobody waits for that id (late or unknown). */
  settle(response: HostResponse): boolean {
    const entry = this.pending.get(response.id);
    if (entry === undefined) return false;
    clearTimeout(entry.timer);
    this.pending.delete(response.id);
    entry.resolve(response);
    return true;
  }

  /** Ends every waiting request with this error (the host exited or broke the protocol). */
  failAll(error: HostError): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({ v: 1, id, ok: false, error });
    }
    this.pending.clear();
  }
}
