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
export const HOST_CALLS = ["doctor", "messages", "tree", "settings", "listModels", "selectModel", "startRun", "cancelRun", "listRuns", "revert", "plan", "applyPlan", "review", "changes", "report", "proposeSettings", "applySettings", "transport", "stateSummary", "previewCleanup", "applyCleanup", "reportMarkdown", "createSettings", "settingsSuggestions", "startTaskRun", "configFile", "runEvents", "checkPlan", "answerQuestion", "readText"] as const;
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

/** GU-3: a run token the engine host issued for one run (128 random bits, lowercase hex). */
export const RUN_TOKEN_PATTERN = /^[0-9a-f]{32}$/;
/** Most items in one events message, and the longest item text. */
export const MAX_RUN_ITEMS = 2000;
export const MAX_RUN_ITEM_CHARS = 4000;
const RUN_ITEM_KIND = /^[a-z][a-z_]{0,39}$/;
const RECORD_TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,9})?Z$/;

/**
 * One line of a run's progress, made by the engine host from a record or a notice (3.6): the
 * shared catalog's sentence, masked and cleaned. `kind` is the record type ("notice" for a note,
 * "gap" when records went missing).
 */
export interface HostRunItem {
  readonly at: string | null;
  readonly kind: string;
  readonly text: string;
}

/** Host → main, about every 100 ms while a run goes on (4.2). */
export interface HostRunEvents {
  readonly v: 1;
  readonly type: "events";
  readonly run: string;
  readonly items: readonly HostRunItem[];
  /** Model turns and tool calls so far. */
  readonly counts: { readonly turns: number; readonly tools: number };
}

/** Host → main, once, after the run's last events: how it ended (checked by the main process). */
export interface HostRunDone {
  readonly v: 1;
  readonly type: "done";
  readonly run: string;
  readonly outcome: unknown;
}

/**
 * U-124 (3.6, DR-3, adapter-contract 5.9): the engine asks a person about a call a `confirm: true`
 * rule allows. The engine's masked fields only: the executable (`subject`) and the number of
 * arguments, never an argument. Only the command permission is asked; nothing else comes here.
 */
export interface PermissionQuestion {
  readonly id: string;
  readonly callId: string;
  readonly tool: string;
  readonly permission: "command";
  readonly subject: string;
  readonly argumentCount: number;
}

/** Host → main: a question of the run (the main process's OS dialog asks; the window cannot answer). */
export interface HostQuestion {
  readonly v: 1;
  readonly type: "question";
  readonly run: string;
  readonly question: PermissionQuestion;
}

/** Host → main: the run's signal ended the question (cancelled, or its time is up); the dialog goes. */
export interface HostQuestionEnded {
  readonly v: 1;
  readonly type: "questionEnded";
  readonly run: string;
  readonly id: string;
}

export const QUESTION_ID_PATTERN = /^q[1-9][0-9]{0,5}$/;
export const MAX_QUESTION_SUBJECT_CHARS = 1000;
const CALL_ID = /^[A-Za-z0-9_-]{1,64}$/;
const TOOL_NAME = /^[a-z][a-z_]{0,39}$/;
/** Control, line, format, direction and invisible characters: a subject holding one is not asked about. */
const HIDDEN_CHARACTER = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/;

/** A question as the host sends it, checked field by field; null when it does not fit. */
export function parseQuestion(value: unknown): PermissionQuestion | null {
  if (!isObj(value)) return null;
  const { id, callId, tool, permission, subject, argumentCount } = value;
  if (typeof id !== "string" || !QUESTION_ID_PATTERN.test(id) || typeof callId !== "string" || !CALL_ID.test(callId) || typeof tool !== "string" || !TOOL_NAME.test(tool)) return null;
  if (permission !== "command" || typeof subject !== "string" || subject.length === 0 || subject.length > MAX_QUESTION_SUBJECT_CHARS || HIDDEN_CHARACTER.test(subject) || !isCount(argumentCount)) return null;
  return { id, callId, tool, permission, subject, argumentCount };
}

export type HostRunMessage = HostRunEvents | HostRunDone | HostQuestion | HostQuestionEnded;
export type HostMessage = HostReady | HostResponse | HostRunMessage;

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Run items as the engine host gives them (also, U-118, a page of a run's stored records). */
export function parseRunItems(value: unknown): HostRunItem[] | null {
  if (!Array.isArray(value) || value.length > MAX_RUN_ITEMS) return null;
  const items: HostRunItem[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const { at, kind, text } = item as Record<string, unknown>;
    if (!(at === null || (typeof at === "string" && RECORD_TIME.test(at)))) return null;
    if (typeof kind !== "string" || !RUN_ITEM_KIND.test(kind) || typeof text !== "string" || text.length > MAX_RUN_ITEM_CHARS) return null;
    items.push({ at: at as string | null, kind, text });
  }
  return items;
}

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
  if (value["type"] === "question" || value["type"] === "questionEnded") {
    const run = value["run"];
    if (typeof run !== "string" || !RUN_TOKEN_PATTERN.test(run)) return null;
    if (value["type"] === "questionEnded") {
      const id = value["id"];
      return typeof id === "string" && QUESTION_ID_PATTERN.test(id) ? { v: 1, type: "questionEnded", run, id } : null;
    }
    const question = parseQuestion(value["question"]);
    return question === null ? null : { v: 1, type: "question", run, question };
  }
  if (value["type"] === "events" || value["type"] === "done") {
    const run = value["run"];
    if (typeof run !== "string" || !RUN_TOKEN_PATTERN.test(run)) return null;
    if (value["type"] === "done") return { v: 1, type: "done", run, outcome: value["outcome"] };
    const items = parseRunItems(value["items"]);
    const counts = value["counts"];
    if (items === null || typeof counts !== "object" || counts === null) return null;
    const { turns, tools } = counts as Record<string, unknown>;
    return isCount(turns) && isCount(tools) ? { v: 1, type: "events", run, items, counts: { turns, tools } } : null;
  }
  if (value["type"] !== undefined) return null;
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

/**
 * What became of a response:
 * - delivered: a request was waiting for it.
 * - late: its id was issued, but its request is settled already (the time ran out, or an answer
 *   came before). The answer is dropped and the host is fine (R-10 M-1). Ids are issued in order
 *   from 1, so this needs no memory of past ids and holds for any number of them (R10b-L-1).
 * - unknown: an id this side never issued. Only this breaks the channel.
 */
export type SettleOutcome = "delivered" | "late" | "unknown";

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

  /** Whether this side has issued `id` (1 up to the last one). */
  private issued(id: number): boolean {
    return Number.isSafeInteger(id) && id >= 1 && id < this.nextId;
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

  /** Delivers a response to the request waiting for it, or says why it cannot (SettleOutcome). */
  settle(response: HostResponse): SettleOutcome {
    const entry = this.pending.get(response.id);
    if (entry === undefined) return this.issued(response.id) ? "late" : "unknown";
    clearTimeout(entry.timer);
    this.pending.delete(response.id);
    entry.resolve(response);
    return "delivered";
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
