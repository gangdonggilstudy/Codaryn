/**
 * Y-1 connection: `codaryn models` with the real `listAnthropicModels` (through the CLI's provider
 * module) and an injected fake `fetch`. No request leaves the process. The key value is fake and
 * not key-shaped.
 */

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";

import { ANTHROPIC_API_KEY_ENV, CODARYN_API_BASE_URL_ENV } from "../../../src/contracts/index.js";
import type { ModelsOutput } from "../../../src/contracts/index.js";
import type { CommandOutcome } from "../../../src/cli/guard.js";
import { runModels } from "../../../src/cli/models.js";
import type { ModelsEnvironment } from "../../../src/cli/models.js";
import { anthropicModelLister } from "../../../src/cli/provider.js";
import { listAnthropicModels } from "../../../src/model/anthropic/index.js";
import { tempDir } from "./k-support.js";

const FAKE_KEY = "fake-wire-key-value-0099";
const BASE = "http://127.0.0.1:9";

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

/** Answers each request with the next page; records what was sent. */
function fakeFetch(pages: readonly { status: number; body: unknown }[]): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  let next = 0;
  const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => {
      headers[name] = value;
    });
    sent.push({ url: String(input), method: init?.method ?? "GET", headers, body: init?.body ?? null });
    const page = pages[Math.min(next, pages.length - 1)] as { status: number; body: unknown };
    next += 1;
    return new Response(JSON.stringify(page.body), { status: page.status, headers: { "content-type": "application/json" } });
  };
  return { fetch: fake as typeof fetch, sent };
}

const PAGE_ONE = {
  data: [{ type: "model", id: "fake-model-a", display_name: "Fake A", created_at: "2026-01-01T00:00:00Z", max_input_tokens: 200000, max_tokens: 64000 }],
  has_more: true,
  first_id: "fake-model-a",
  last_id: "fake-model-a",
};
const PAGE_TWO = {
  data: [{ type: "model", id: "fake-model-b", display_name: "Fake B", created_at: "2026-02-01T00:00:00Z", max_input_tokens: 100000, max_tokens: 8000 }],
  has_more: false,
  first_id: "fake-model-b",
  last_id: "fake-model-b",
};

function io(base: string, argv: readonly string[], fetchImpl: typeof fetch, env: Record<string, string>): ModelsEnvironment {
  return {
    argv: ["models", ...argv],
    env: { [ANTHROPIC_API_KEY_ENV]: FAKE_KEY, ...env },
    cwd: base,
    readFile: (file) => readFile(file, "utf8"),
    loadEnvFile: () => {
      throw new Error("no variables file in this test");
    },
    listModels: anthropicModelLister,
    anthropicDeps: { fetch: fetchImpl, sleep: async () => {} },
  };
}

function printed(outcome: CommandOutcome): string {
  assert.ok("text" in outcome, JSON.stringify(outcome));
  return outcome.text;
}

describe("Y-1 connection: codaryn models uses listAnthropicModels", () => {
  test("the CLI's lister is the model module's listAnthropicModels", () => {
    assert.equal(anthropicModelLister, listAnthropicModels);
  });

  test("requests go to the configured address's /v1/models, every page; the key is in the header only", async () => {
    const base = await tempDir();
    const config = path.join(base, "config.json");
    await writeFile(config, JSON.stringify({ schemaVersion: 1, model: "fake-model-a", maxRetries: 0, requestTimeoutMs: 5000 }));
    const fake = fakeFetch([
      { status: 200, body: PAGE_ONE },
      { status: 200, body: PAGE_TWO },
    ]);
    const outcome = await runModels(io(base, ["--config", config, "--json", "--use", "2"], fake.fetch, { [CODARYN_API_BASE_URL_ENV]: BASE }));
    const output = JSON.parse(printed(outcome)) as ModelsOutput;

    assert.equal(fake.sent.length, 2, "both pages are read");
    for (const request of fake.sent) {
      const url = new URL(request.url);
      assert.equal(`${url.origin}${url.pathname}`, `${BASE}/v1/models`);
      assert.equal(request.method, "GET");
      assert.equal(request.body, null);
      assert.equal(request.headers["x-api-key"], FAKE_KEY);
      assert.ok((request.headers["anthropic-version"] ?? "").length > 0);
      assert.equal(request.url.includes(FAKE_KEY), false, "not in the URL");
      for (const [name, value] of Object.entries(request.headers)) {
        if (name !== "x-api-key") assert.equal(value.includes(FAKE_KEY), false, `not in ${name}`);
      }
    }
    assert.equal(new URL(fake.sent[1]?.url ?? "").searchParams.get("after_id"), "fake-model-a");

    assert.deepEqual(
      output.models.map((model) => [model.number, model.id, model.displayName, model.maxInputTokens, model.maxOutputTokens]),
      [
        [1, "fake-model-a", "Fake A", 200000, 64000],
        [2, "fake-model-b", "Fake B", 100000, 8000],
      ],
    );
    assert.deepEqual(output.selected, { id: "fake-model-b", created: false, overriddenBy: null });
    assert.equal(JSON.parse(await readFile(config, "utf8")).model, "fake-model-b");
    assert.equal(JSON.stringify(output).includes(FAKE_KEY), false);
  });

  test("without CODARYN_API_BASE_URL the config file's apiBaseUrl is used", async () => {
    const base = await tempDir();
    const config = path.join(base, "config.json");
    await writeFile(config, JSON.stringify({ schemaVersion: 1, apiBaseUrl: "http://localhost:7", maxRetries: 0 }));
    const fake = fakeFetch([{ status: 200, body: { ...PAGE_TWO } }]);
    printed(await runModels(io(base, ["--config", config], fake.fetch, {})));
    assert.equal(new URL(fake.sent[0]?.url ?? "").origin, "http://localhost:7");
  });

  test("an HTTP 401 is model_list_failed (auth_failed) and the key never shows", async () => {
    const base = await tempDir();
    const fake = fakeFetch([{ status: 401, body: { type: "error", error: { type: "authentication_error", message: `invalid x-api-key ${FAKE_KEY}` } } }]);
    const outcome = await runModels(io(base, [], fake.fetch, { [CODARYN_API_BASE_URL_ENV]: BASE }));
    assert.ok("output" in outcome && outcome.output.kind === "error");
    assert.equal(outcome.output.code, "model_list_failed");
    assert.equal(outcome.exitCode, 8);
    assert.ok(outcome.output.message.includes("(auth_failed)"));
    assert.equal(outcome.output.message.includes(FAKE_KEY), false);
    assert.equal(fake.sent.length, 1, "auth failures are not retried");
  });
});
