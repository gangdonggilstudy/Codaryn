/**
 * U-177 (review R-99 M-2): U-170 put plan mode "run" in PLAN_MODES before anything carries it out
 * (B-3, B-4), and the CLI's parsePlanMode took it. A task file or a config definition with
 * `plan: "run"` then started a real model run that could only end as failed/model_error, with model
 * requests spent and advice that did not fit, and the message for a wrong plan value offered "run".
 * Until B-4 connects it, the CLI refuses "run" before anything is sent: invalid_task (task file) or
 * invalid_config (a definition), with its own message and the hint plan_run_not_available, whose
 * line tells the person in their language. A wrong value's message lists none and apply only.
 * Fake key, loopback fake server; the server counts the requests.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import type { MessageCatalog } from "../../../src/contracts/index.js";
import { parseConfig } from "../../../src/cli/config.js";
import { parseTask } from "../../../src/cli/task.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { cliEnv } from "../../support/cli.js";
import { messagesRequests, replyText, runGuarded, startFakeAnthropic } from "../../support/fake-anthropic.js";
import { ANTHROPIC_LIMITS, fakeApiConfig, writeAnthropicTask, writeConfigFile } from "../../fixtures/anthropic.js";
import { createSandbox } from "../../fixtures/builders.js";
import { FAKE_API_KEY } from "../../fixtures/secrets.js";

const HINT = "plan_run_not_available";
/** The hint's line in a catalog (the id is U-177's; loosely typed so this file builds before it). */
const hintLine = (catalog: MessageCatalog): string => (catalog.format as (id: string) => string)(`error.hint.${HINT}`);
const hintOf = (value: object): unknown => (value as { readonly hint?: unknown }).hint;

const TASK = {
  schemaVersion: 1,
  id: "u177",
  goal: "g",
  workflow: "code",
  workspaceRoot: "./ws",
  model: { provider: "scripted", scriptPath: "./script.json" },
  policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
  privacy: { secretEnv: [] },
  limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60_000 },
  verifiers: [],
};
const RUN_DEFINITION = { schemaVersion: 1, workflows: { rundef: { tools: ["read_file", "search_files", "write_file"], plan: "run" } } };

describe("U-177: the parsers refuse plan \"run\" until B-4", () => {
  test("a task file's plan \"run\": invalid_task, its own message, the hint", () => {
    const outcome = parseTask({ ...TASK, plan: "run" }, process.cwd());
    assert.equal(outcome.ok, false, "plan run must be refused");
    if (outcome.ok) return;
    assert.equal(outcome.code, "invalid_task");
    assert.match(outcome.message, /^plan "run" is not available yet/);
    assert.equal(hintOf(outcome), HINT);
  });

  test("a wrong plan value's message lists none and apply, not run", () => {
    const outcome = parseTask({ ...TASK, plan: "later" }, process.cwd());
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.message, "plan must be one of none, apply");
    assert.equal(hintOf(outcome), undefined);
  });

  test("a config definition's plan \"run\": refused with the hint; apply and none as before", () => {
    const outcome = parseConfig(RUN_DEFINITION);
    assert.equal(outcome.ok, false, "a definition with plan run must be refused");
    if (outcome.ok) return;
    assert.match(outcome.message, /plan "run" is not available yet/);
    assert.equal(hintOf(outcome), HINT);
    for (const plan of ["apply", "none"]) {
      assert.equal(parseConfig({ schemaVersion: 1, workflows: { d: { tools: ["read_file"], plan } } }).ok, true, plan);
      assert.equal(parseTask({ ...TASK, plan }, process.cwd()).ok, true, plan);
    }
  });
});

describe("U-177 on the real CLI: nothing is sent", () => {
  test("a task file with plan \"run\": exit 2, no model request, no run, the hint's line in English and Korean", { timeout: 60_000 }, async (t) => {
    const sb = createSandbox(t);
    const api = await startFakeAnthropic(t, [replyText("never")]);
    const config = writeConfigFile(sb, fakeApiConfig(api.url, { model: "cdy-u177-model", maxOutputTokens: 700, limits: ANTHROPIC_LIMITS }));
    const task = writeAnthropicTask(sb, { id: "u177-run", extraTop: { plan: "run" } });
    for (const [lang, catalog] of [["en", createMessageCatalog("en")], ["ko", createMessageCatalog("ko")]] as const) {
      const run = await runGuarded(sb, ["run", "--task", task, "--config", config], cliEnv({ fakeApiKey: FAKE_API_KEY, extra: { CODARYN_LANG: lang } }));
      assert.equal(run.exitCode, 2, run.stderr);
      const output = JSON.parse(run.stdout.trim()) as { code: string; hint?: string; message: string };
      assert.equal(output.code, "invalid_task");
      assert.equal(output.hint, HINT);
      assert.ok(run.stderr.includes(hintLine(catalog)), `${lang}: ${run.stderr}`);
    }
    assert.equal(messagesRequests(api).length, 0, "no model request");
    assert.equal(existsSync(path.join(sb.workspace, ".codaryn")), false, "no run was made");
  });

  test("a config definition with plan \"run\": invalid_config with the hint, no model request", { timeout: 60_000 }, async (t) => {
    const sb = createSandbox(t);
    const api = await startFakeAnthropic(t, [replyText("never")]);
    const config = writeConfigFile(sb, { ...fakeApiConfig(api.url, { model: "cdy-u177-model", maxOutputTokens: 700, limits: ANTHROPIC_LIMITS }), workflows: RUN_DEFINITION.workflows });
    const task = writeAnthropicTask(sb, { id: "u177-def", extraTop: { workflowRef: "rundef" } });
    const run = await runGuarded(sb, ["run", "--task", task, "--config", config], cliEnv({ fakeApiKey: FAKE_API_KEY }));
    assert.equal(run.exitCode, 2, run.stderr);
    const output = JSON.parse(run.stdout.trim()) as { code: string; hint?: string };
    assert.equal(output.code, "invalid_config");
    assert.equal(output.hint, HINT);
    assert.equal(messagesRequests(api).length, 0, "no model request");
  });
});
