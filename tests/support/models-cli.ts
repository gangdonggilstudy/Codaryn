/**
 * `codaryn models` (Y-1 to Y-3) from the test side: argument lists, the config file before and
 * after `--use`, and the checks every models case shares. The command's output shape comes from
 * the contract once it is merged; nothing here parses it.
 */

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { FakeAnthropic, RecordedRequest } from "./fake-anthropic.js";
import { messagesRequests, modelsRequests } from "./fake-anthropic.js";
import { MODELS_PATH } from "./fake-models.js";

export interface ModelsArgs {
  readonly config?: string;
  readonly varsFile?: string;
  /** `--use <number or id>`. */
  readonly use?: string;
  readonly json?: boolean;
}

export function modelsArgs(args: ModelsArgs): string[] {
  const out = ["models"];
  if (args.config !== undefined) out.push("--config", args.config);
  if (args.varsFile !== undefined) out.push("--vars-file", args.varsFile);
  if (args.use !== undefined) out.push("--use", args.use);
  if (args.json === true) out.push("--json");
  return out;
}

export function readJsonFile(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

/** Bytes of a file, or null when it does not exist. */
export function fileBytes(path: string): Buffer | null {
  return existsSync(path) ? readFileSync(path) : null;
}

/** `--use` changed `model` only: every other field is the same value as before (Y-3). */
export function assertOnlyModelChanged(before: Record<string, unknown>, after: Record<string, unknown>, model: string): void {
  assert.equal(after["model"], model);
  const strip = (config: Record<string, unknown>): Record<string, unknown> => {
    const { model: _model, ...rest } = config;
    return rest;
  };
  assert.deepEqual(strip(after), strip(before), "fields other than model are kept");
}

/** No temporary file was left next to the config file by an atomic write. */
export function assertNoStrayFiles(dir: string, expected: readonly string[]): void {
  assert.deepEqual(readdirSync(dir).sort(), [...expected].sort(), "nothing else was left in the directory");
}

/**
 * The list was read page by page: the first request has no cursor and each later one asks
 * `after_id` = the previous page's last id. Returns the list requests.
 */
export function assertPagedList(api: FakeAnthropic, pageIds: readonly (readonly string[])[]): RecordedRequest[] {
  const list = modelsRequests(api).filter((request) => new URL(request.path, "http://x").pathname === MODELS_PATH);
  assert.equal(list.length, pageIds.length, "one request per page");
  list.forEach((request, index) => {
    const after = new URL(request.path, "http://x").searchParams.get("after_id");
    const previous = pageIds[index - 1];
    assert.equal(after, index === 0 ? null : (previous?.[previous.length - 1] ?? null), `page ${index + 1} cursor`);
  });
  return list;
}

/** Every models request carried the key in `x-api-key` and the same `anthropic-version` as Messages requests. */
export function assertModelsHeaders(api: FakeAnthropic, key: string, messagesVersion: string): void {
  const requests = modelsRequests(api);
  assert.ok(requests.length > 0, "at least one models request");
  for (const request of requests) {
    assert.equal(request.headers["x-api-key"], key);
    assert.equal(request.headers["anthropic-version"], messagesVersion);
  }
  assert.equal(messagesRequests(api).length, 0, "listing models sends no Messages request");
}
