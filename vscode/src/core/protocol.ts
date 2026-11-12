/**
 * The line protocol between the extension and one Codaryn CLI child (adapter-contract 6,
 * vscode-extension 3): what the child writes on stderr with `--events jsonl`, what the extension
 * writes on stdin with `--confirm stdio`, and the one JSON line on stdout at the end.
 *
 * No VS Code API here. The child is the same program a person runs, but its output is still read
 * as data: every line is parsed and checked for shape, nothing in it is executed or followed.
 * Types are imported as types only; nothing of the engine is loaded at run time.
 */

import type { CliErrorOutput, EngineResult } from "../../../src/contracts/index.js";
import type { ApplyEvent, ApplyResult, ConfirmAnswer, ConfirmRequest, RunEvent } from "../../../src/app/index.js";

/** A line longer than this (in UTF-16 code units) is dropped, not parsed. */
export const MAX_LINE_LENGTH = 4 * 1024 * 1024;

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export type IgnoredReason = "not_json" | "unknown_kind" | "malformed" | "too_long";

export type ProtocolLine =
  | { readonly kind: "started"; readonly runId: string }
  | { readonly kind: "event"; readonly event: RunEvent | ApplyEvent }
  | { readonly kind: "confirm"; readonly request: ConfirmRequest }
  | { readonly kind: "ignored"; readonly reason: IgnoredReason };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRunId(value: unknown): value is string {
  return typeof value === "string" && RUN_ID.test(value) && !value.includes("..");
}

function isEvent(value: unknown): value is RunEvent | ApplyEvent {
  if (!isObject(value)) return false;
  if (value["kind"] === "notice") return typeof value["text"] === "string";
  if (value["kind"] !== "record" || !isObject(value["record"])) return false;
  const record = value["record"];
  return (
    typeof record["seq"] === "number" &&
    Number.isSafeInteger(record["seq"]) &&
    record["seq"] >= 1 &&
    typeof record["type"] === "string" &&
    typeof record["at"] === "string" &&
    isRunId(record["runId"])
  );
}

function isConfirmRequest(value: unknown): value is ConfirmRequest {
  return (
    isObject(value) &&
    value["kind"] === "permission" &&
    typeof value["id"] === "string" &&
    value["id"].length > 0 &&
    typeof value["callId"] === "string" &&
    typeof value["tool"] === "string" &&
    typeof value["permission"] === "string" &&
    typeof value["subject"] === "string"
  );
}

/** One stderr line (without its line ending). */
export function parseProtocolLine(line: string): ProtocolLine {
  if (line.length > MAX_LINE_LENGTH) return { kind: "ignored", reason: "too_long" };
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { kind: "ignored", reason: "not_json" };
  }
  if (!isObject(value) || value["schemaVersion"] !== 1) return { kind: "ignored", reason: "malformed" };
  switch (value["kind"]) {
    case "started":
      return isRunId(value["runId"]) ? { kind: "started", runId: value["runId"] } : { kind: "ignored", reason: "malformed" };
    case "event":
      return isEvent(value["event"]) ? { kind: "event", event: value["event"] } : { kind: "ignored", reason: "malformed" };
    case "confirm":
      return isConfirmRequest(value["request"]) ? { kind: "confirm", request: value["request"] } : { kind: "ignored", reason: "malformed" };
    default:
      return { kind: "ignored", reason: "unknown_kind" };
  }
}

/**
 * Splits a stream of text into lines (LF or CRLF). A line that grows past MAX_LINE_LENGTH before
 * its end is dropped as a whole and reported once by `push`/`end` as "too_long".
 */
export class LineSplitter {
  private buffer = "";
  private dropping = false;

  /** The complete lines in this chunk, and how many over-long lines were dropped. */
  push(chunk: string): { readonly lines: string[]; readonly dropped: number } {
    const lines: string[] = [];
    let dropped = 0;
    let rest = chunk;
    for (;;) {
      const end = rest.indexOf("\n");
      if (end < 0) break;
      const piece = rest.slice(0, end);
      rest = rest.slice(end + 1);
      if (this.dropping) {
        this.dropping = false;
        this.buffer = "";
        continue;
      }
      const line = this.buffer + piece;
      this.buffer = "";
      if (line.length > MAX_LINE_LENGTH) {
        dropped += 1;
        continue;
      }
      lines.push(line.endsWith("\r") ? line.slice(0, -1) : line);
    }
    if (!this.dropping) {
      this.buffer += rest;
      if (this.buffer.length > MAX_LINE_LENGTH) {
        this.dropping = true;
        this.buffer = "";
        dropped += 1;
      }
    }
    return { lines, dropped };
  }

  /** The last line when the stream ended without a line feed. */
  end(): { readonly lines: string[]; readonly dropped: number } {
    const last = this.buffer;
    this.buffer = "";
    const wasDropping = this.dropping;
    this.dropping = false;
    if (wasDropping || last.length === 0) return { lines: [], dropped: 0 };
    return { lines: [last.endsWith("\r") ? last.slice(0, -1) : last], dropped: 0 };
  }
}

/** The stdin line that answers one question (`--confirm stdio`). */
export function answerLine(id: string, answer: ConfirmAnswer): string {
  return `${JSON.stringify({ schemaVersion: 1, kind: "answer", id, answer })}\n`;
}

export type FinalOutput = EngineResult | ApplyResult | CliErrorOutput;

export type FinalOutcome =
  | { readonly kind: "output"; readonly output: FinalOutput }
  | {
      readonly kind: "protocol_error";
      /** not_one_line: stdout is not exactly one line; exit_code_mismatch: the JSON's exitCode is not the process's. */
      readonly reason: "not_one_line" | "not_json" | "unknown_kind" | "exit_code_mismatch";
    };

/**
 * The child's whole stdout once it ended, and its exit code (null when it was killed). Exactly one
 * JSON line of kind "run", "apply" or "error" whose `exitCode` is the process's.
 */
export function parseFinalStdout(stdout: string, exitCode: number | null): FinalOutcome {
  const trimmed = stdout.endsWith("\r\n") ? stdout.slice(0, -2) : stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout;
  if (trimmed.length === 0 || trimmed.includes("\n")) return { kind: "protocol_error", reason: "not_one_line" };
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return { kind: "protocol_error", reason: "not_json" };
  }
  if (!isObject(value) || value["schemaVersion"] !== 1 || !["run", "apply", "error"].includes(value["kind"] as string)) {
    return { kind: "protocol_error", reason: "unknown_kind" };
  }
  if (typeof value["exitCode"] !== "number" || value["exitCode"] !== exitCode) return { kind: "protocol_error", reason: "exit_code_mismatch" };
  return { kind: "output", output: value as unknown as FinalOutput };
}
