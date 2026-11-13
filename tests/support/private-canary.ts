/**
 * U-232 (bundle A, A-8 to come): finds the markers of tests/fixtures/private-tables.ts wherever a run
 * left text: what went to the model, the run's records, and what a person sees. A private data test
 * asserts on the findings by kind and channel; the harness's own test shows it finds what is there.
 *
 * Channels:
 * - "model": what Codaryn sent to the model. For a fake API, each request's system text, tool
 *   definitions and every message or item that is not the model's own (Anthropic: messages of role
 *   user, tool results included; OpenAI: input items other than the model's messages, function calls
 *   and reasoning). The model's own earlier turns come back in every request as conversation; they
 *   are left out, so a marker the script itself put in a tool's arguments is not taken for a row that
 *   went out. `modelEchoSources` keeps the whole bodies when that is wanted. For the scripted model,
 *   the journals' `model_request` records (what each request added: the goal, tool results, notices).
 * - "records": every file under `<workspace>/.codaryn` but change snapshots (raw copies of workspace
 *   files by contract), each also decoded when it is JSON or JSON lines.
 * - "output": a CLI process's stdout and stderr (stdout also decoded), or any text a test adds.
 *
 * Each marker is looked for as written and in the forms leak.ts knows (JSON escaped once to three
 * times, Base64, URL, hex), plus JSON with every non-ASCII character escaped as \uXXXX (the CLI's
 * JSON output writes Hangul so), once and twice; decoded sources find any depth of escaping. With
 * `fragments`, also any piece of that many characters (a marker cut by a limit).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { PrivateCanary } from "../fixtures/private-tables.js";
import type { CliRun } from "./cli.js";
import type { FakeAnthropic } from "./fake-anthropic.js";
import type { FakeOpenAI } from "./fake-openai.js";
import { decodedSource, secretVariants, stateRecordTexts } from "./leak.js";
import type { TextSource } from "./leak.js";

export type CanaryChannel = "model" | "records" | "output";
/** row: a marker of one row or line; name: a file or folder name; small_key/large_key: group keys under/at least k. */
export type CanaryKind = "row" | "name" | "small_key" | "large_key";

export interface ChannelSource extends TextSource {
  readonly channel: CanaryChannel;
}

export interface CanaryFinding {
  readonly kind: CanaryKind;
  readonly marker: string;
  readonly channel: CanaryChannel;
  readonly source: string;
  /** How it was written there: a leak.ts variant name, "ascii-json", "ascii-json-in-json", or "piece <n>". */
  readonly form: string;
}

const NUL = "\u0000";

/** Every string in a parsed JSON value, keys included, and in any string that is itself JSON. */
function stringsOf(value: unknown, out: string[], depth = 0): void {
  if (typeof value === "string") {
    out.push(value);
    const trimmed = value.trim();
    if (depth < 4 && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
      try {
        stringsOf(JSON.parse(trimmed), out, depth + 1);
      } catch {
        // not JSON text
      }
    }
  } else if (Array.isArray(value)) {
    for (const item of value) stringsOf(item, out, depth);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out.push(key);
      stringsOf(child, out, depth);
    }
  }
}

const textOf = (...values: unknown[]): string => {
  const out: string[] = [];
  for (const value of values) stringsOf(value, out);
  return out.join(NUL);
};

const record = (value: unknown): Record<string, unknown> => (value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

/** "model": the parts of each Anthropic request body that are not the model's own turns. */
export function anthropicInboundSources(api: FakeAnthropic): ChannelSource[] {
  return api.requests.map((request) => {
    const body = record(request.body);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const inbound = messages.filter((message) => record(message).role !== "assistant");
    return { channel: "model" as const, label: `anthropic request ${request.index} (sent by Codaryn)`, text: textOf(body.system, body.tools, inbound) };
  });
}

/** "model": the parts of each OpenAI Responses request body that are not the model's own output. */
export function openAIInboundSources(api: FakeOpenAI): ChannelSource[] {
  return api.requests
    .filter((request) => request.endpoint === "responses")
    .map((request) => {
      const body = record(request.body);
      const input = Array.isArray(body.input) ? body.input : [];
      const inbound = input.filter((item) => {
        const it = record(item);
        return it.type !== "function_call" && it.type !== "reasoning" && it.role !== "assistant";
      });
      return { channel: "model" as const, label: `openai request ${request.index} (sent by Codaryn)`, text: textOf(body.instructions, body.tools, inbound) };
    });
}

/** "model": whole request bodies, the model's own earlier turns included (as sent, and decoded). */
export function modelEchoSources(api: { readonly requests: readonly { readonly index: number; readonly bodyText: string }[] }, name: string): ChannelSource[] {
  return api.requests.flatMap((request) => [
    { channel: "model" as const, label: `${name} request ${request.index} body`, text: request.bodyText },
    { channel: "model" as const, ...decodedSource(`${name} request ${request.index} body`, request.bodyText, false) },
  ]);
}

/** "model": the journals' model_request records, what each request to a scripted model added. */
export function scriptedModelSources(workspace: string): ChannelSource[] {
  const runs = path.join(workspace, ".codaryn", "runs");
  if (!existsSync(runs)) return [];
  const out: ChannelSource[] = [];
  for (const runId of readdirSync(runs)) {
    const journal = path.join(runs, runId, "journal.jsonl");
    if (!existsSync(journal)) continue;
    for (const line of readFileSync(journal, "utf8").split("\n")) {
      if (line.trim() === "") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const item = record(parsed);
      if (item.type !== "model_request") continue;
      out.push({ channel: "model", label: `run ${runId} model_request turn ${String(item.turn)}`, text: textOf(item.system, item.newMessages, item.tools) });
    }
  }
  return out;
}

/** "records": every file under the state folder but change snapshots, JSON also decoded. */
export function recordSources(workspace: string): ChannelSource[] {
  const files = stateRecordTexts(workspace);
  const decoded = files
    .filter((file) => file.label.endsWith(".json") || file.label.endsWith(".jsonl"))
    .map((file) => decodedSource(file.label, file.text, file.label.endsWith(".jsonl")));
  return [...files, ...decoded].map((source) => ({ channel: "records", ...source }));
}

/** "output": a CLI process's stdout and stderr, stdout also decoded (JSON lines). */
export function outputSources(name: string, run: CliRun): ChannelSource[] {
  return [
    { channel: "output", label: `${name} stdout`, text: run.stdout },
    { channel: "output", label: `${name} stderr`, text: run.stderr },
    { channel: "output", ...decodedSource(`${name} stdout`, run.stdout, true) },
  ];
}

export interface CanarySourceOptions {
  readonly workspace: string;
  /** Every CLI process of the case, by a name for the labels. */
  readonly runs?: Readonly<Record<string, CliRun>>;
  readonly anthropic?: FakeAnthropic;
  readonly openai?: FakeOpenAI;
  /** The scripted model's requests (the journals' model_request records). */
  readonly scripted?: boolean;
}

/** Every source of a case: what went to the model, the records, the outputs. */
export function canarySources(options: CanarySourceOptions): ChannelSource[] {
  return [
    ...(options.anthropic === undefined ? [] : anthropicInboundSources(options.anthropic)),
    ...(options.openai === undefined ? [] : openAIInboundSources(options.openai)),
    ...(options.scripted === true ? scriptedModelSources(options.workspace) : []),
    ...recordSources(options.workspace),
    ...Object.entries(options.runs ?? {}).flatMap(([name, run]) => outputSources(name, run)),
  ];
}

/** \uXXXX for every character outside ASCII (lowercase hex, as JSON.stringify of Node never does). */
function asciiJson(text: string, upper: boolean): string {
  return [...text]
    .map((char) => {
      const code = char.charCodeAt(0);
      if (code < 0x80) return JSON.stringify(char).slice(1, -1);
      const hex = code.toString(16).padStart(4, "0");
      return `\\u${upper ? hex.toUpperCase() : hex}`;
    })
    .join("");
}

/** The forms a marker is looked for in (see the module's note). */
export function markerForms(marker: string): { readonly name: string; readonly value: string }[] {
  const forms = [...secretVariants(marker)];
  for (const upper of [false, true]) {
    const once = asciiJson(marker, upper);
    forms.push({ name: `ascii-json${upper ? "-upper" : ""}`, value: once });
    forms.push({ name: `ascii-json-in-json${upper ? "-upper" : ""}`, value: JSON.stringify(once).slice(1, -1) });
  }
  const seen = new Set<string>();
  return forms.filter((form) => (seen.has(form.value) ? false : (seen.add(form.value), true)));
}

export interface FindOptions {
  /** Also look for every piece of this many characters of each row marker (a cut marker). */
  readonly fragments?: number;
}

/** The markers of each kind in `canary`. */
export function canaryMarkers(canary: PrivateCanary): Readonly<Record<CanaryKind, readonly string[]>> {
  return { row: canary.rowMarkers, name: canary.nameMarkers, small_key: canary.smallKeys, large_key: canary.largeKeys };
}

/** Every marker of `canary` found in `sources`, once per marker, source and form. */
export function findCanary(sources: readonly ChannelSource[], canary: PrivateCanary | Readonly<Partial<Record<CanaryKind, readonly string[]>>>, options: FindOptions = {}): CanaryFinding[] {
  const markers = "rowMarkers" in canary ? canaryMarkers(canary as PrivateCanary) : (canary as Partial<Record<CanaryKind, readonly string[]>>);
  const findings: CanaryFinding[] = [];
  for (const [kind, list] of Object.entries(markers) as [CanaryKind, readonly string[]][]) {
    for (const marker of list ?? []) {
      const forms = markerForms(marker);
      for (const source of sources) {
        let found = false;
        for (const form of forms) {
          if (source.text.includes(form.value)) {
            findings.push({ kind, marker, channel: source.channel, source: source.label, form: form.name });
            found = true;
          }
        }
        const size = options.fragments;
        if (!found && kind === "row" && size !== undefined && size < marker.length) {
          for (let start = 0; start + size <= marker.length; start += 1) {
            if (source.text.includes(marker.slice(start, start + size))) {
              findings.push({ kind, marker, channel: source.channel, source: source.label, form: `piece ${start}` });
              break;
            }
          }
        }
      }
    }
  }
  return findings;
}

/** The findings that are leaks: rows, names and keys of groups of fewer than k rows. */
export function leaksOf(findings: readonly CanaryFinding[]): CanaryFinding[] {
  return findings.filter((finding) => finding.kind !== "large_key");
}

/** Which markers of `list` were found in `channel` (any source, any form). */
export function foundIn(findings: readonly CanaryFinding[], channel: CanaryChannel, list: readonly string[]): string[] {
  const found = new Set(findings.filter((finding) => finding.channel === channel).map((finding) => finding.marker));
  return list.filter((marker) => found.has(marker));
}

/** One line per finding, for an assertion message (the marker itself is printed: it is test data). */
export function describeFindings(findings: readonly CanaryFinding[], limit = 20): string {
  const lines = findings.slice(0, limit).map((finding) => `${finding.kind} ${finding.marker} in ${finding.channel}: ${finding.source} (${finding.form})`);
  return findings.length > limit ? `${lines.join("\n")}\n… and ${findings.length - limit} more` : lines.join("\n");
}
