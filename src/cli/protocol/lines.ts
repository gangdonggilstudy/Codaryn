/**
 * The lines of the protocol for adapters outside the process (adapter-contract 6): what the CLI
 * writes on stderr with `--events jsonl`, and what it reads on stdin with `--confirm stdio`.
 *
 *   stderr  {"schemaVersion":1,"kind":"started","runId":"<runId>"}
 *           {"schemaVersion":1,"kind":"event","event":{…RunEvent or ApplyEvent…}}
 *           {"schemaVersion":1,"kind":"confirm","request":{…ConfirmRequest…}}
 *   stdin   {"schemaVersion":1,"kind":"answer","id":"<question id>","answer":{"decision":"allow_once"|"deny"|"dismissed"}}
 *
 * Every line is one JSON object and LF. JSON.stringify escapes line breaks and control characters
 * inside strings, so a value can never start a second line. Events are written as the app layer
 * gave them: built from the engine's records in memory and masked again (DR-15); nothing here reads
 * the journal file.
 */

import type { ApplyEvent, ConfirmAnswer, ConfirmRequest, RunEvent } from "../../app/types.js";

export const PROTOCOL_SCHEMA_VERSION = 1;

/** Longest stdin line read; a longer one is dropped as a whole. Answers are a few dozen bytes. */
export const MAX_ANSWER_LINE_LENGTH = 64 * 1024;

export function startedLine(runId: string): string {
  return `${JSON.stringify({ schemaVersion: PROTOCOL_SCHEMA_VERSION, kind: "started", runId })}\n`;
}

export function eventLine(event: RunEvent | ApplyEvent): string {
  return `${JSON.stringify({ schemaVersion: PROTOCOL_SCHEMA_VERSION, kind: "event", event })}\n`;
}

export function confirmLine(request: ConfirmRequest): string {
  return `${JSON.stringify({ schemaVersion: PROTOCOL_SCHEMA_VERSION, kind: "confirm", request })}\n`;
}

const DECISIONS = ["allow_once", "deny", "dismissed"] as const;

export type ParsedAnswer = { readonly ok: true; readonly id: string; readonly answer: ConfirmAnswer } | { readonly ok: false };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One stdin line (without its line ending). Anything but a well-formed answer is `ok: false` and is
 * ignored by the caller (adapter-contract 6: malformed lines do not answer anything).
 */
export function parseAnswerLine(line: string): ParsedAnswer {
  if (line.length > MAX_ANSWER_LINE_LENGTH) return { ok: false };
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { ok: false };
  }
  if (!isObject(value) || value["schemaVersion"] !== PROTOCOL_SCHEMA_VERSION || value["kind"] !== "answer") return { ok: false };
  const id = value["id"];
  const answer = value["answer"];
  if (typeof id !== "string" || id.length === 0 || !isObject(answer)) return { ok: false };
  const decision = answer["decision"];
  if (typeof decision !== "string" || !(DECISIONS as readonly string[]).includes(decision)) return { ok: false };
  if (Object.keys(answer).length !== 1) return { ok: false };
  return { ok: true, id, answer: { decision } as ConfirmAnswer };
}
