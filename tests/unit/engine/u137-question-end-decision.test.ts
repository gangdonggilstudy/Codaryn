/**
 * U-137 (review R88b-L1): a run that ends at a permission question (cancelled, or its time limit)
 * recorded the question and its answer but no `tool_decision` for that call. journal.ts promises
 * "the answer, then the call's tool_decision", and every reader counts denied calls by
 * `tool_decision` (run's end summary, report, the app layer's events). So the call was missing from
 * "Denied calls", and the add-a-rule hint for another, unruled command call was dropped: the summary
 * subtracts the calls denied after a question from the denied command calls.
 * Now the engine records the call's denial (`policy_effective`, `command`/`confirmation_required`)
 * right after the answer, as when the person says no; no `tool_result` follows (nothing goes back
 * to the model) and the run ends as before.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { ANTHROPIC_API_KEY_ENV } from "../../../src/contracts/index.js";
import type { CatalogText, ConfirmPermission, JournalEvent, PolicyDecision, ToolCall } from "../../../src/contracts/index.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { createHumanOutput } from "../../../src/cli/human/index.js";
import { runCli } from "../../../src/cli/run.js";
import type { CliEnvironment } from "../../../src/cli/run.js";
import { locateInWorkspace } from "../../../src/cli/security/index.js";
import { runTask } from "../../../src/engine/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { FakePolicy, finalAnswer, harness, response } from "./fakes.js";

const MARK: PolicyDecision = { allowed: false, permission: "command", code: "confirmation_required", confirm: true };
const command: ToolCall = { id: "c1", name: "run_command", args: { executable: "npm", args: ["test"] } };

/** The records of call c1 and the run's end, in order. */
function trail(events: readonly JournalEvent[]): string[] {
  return events
    .filter((event) => {
      if (event.type === "confirmation_requested" || event.type === "confirmation_answered" || event.type === "run_finished") return true;
      if (event.type === "tool_decision") return event.callId === "c1";
      return event.type === "tool_result" && event.result.callId === "c1";
    })
    .map((event) => {
      switch (event.type) {
        case "confirmation_answered":
          return `answered ${event.decision}/${event.by}`;
        case "tool_decision":
          return `decision ${event.stage} ${event.allowed ? "allowed" : `denied ${event.permission}/${event.code}`}`;
        case "tool_result":
          return `result ${event.result.ok ? "ok" : event.result.errorCode}`;
        case "run_finished":
          return `finished ${event.status}/${event.reason}`;
        default:
          return "requested";
      }
    });
}

function engineRun(confirm: ConfirmPermission, limits?: { maxDurationMs: number }) {
  let checks = 0;
  const policy = new FakePolicy({ effective: () => (checks++ === 0 ? MARK : { allowed: true }) });
  const h = harness({ steps: [() => response([command]), () => finalAnswer()], policy, ...(limits === undefined ? {} : { task: { limits } }) });
  h.deps = { ...h.deps, confirm };
  return h;
}

describe("U-137: a run that ends at the question records the call's denial", () => {
  test("cancelled while it waits: the answer, then the denial, no result, and the run is cancelled", async () => {
    let abort: () => void = () => {};
    const h = engineRun((_request, signal) => {
      abort();
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
    });
    abort = () => h.controller.abort();
    await runTask(h.deps);
    assert.deepEqual(trail(h.journal.events), [
      "requested",
      "answered deny/cancelled",
      "decision policy_effective denied command/confirmation_required",
      "finished cancelled/cancelled",
    ]);
    assert.equal(h.tools.executed.length, 0);
  });

  test("the time limit while it waits: the same, by default, and the run is budget-exhausted", async () => {
    const h = engineRun(() => new Promise(() => {}), { maxDurationMs: 60 });
    await runTask(h.deps);
    assert.deepEqual(trail(h.journal.events), [
      "requested",
      "answered deny/default",
      "decision policy_effective denied command/confirmation_required",
      "finished budget-exhausted/max_duration",
    ]);
    assert.equal(h.tools.executed.length, 0);
  });

  test("as before when the person says no: the answer, the denial, its result, and the run goes on", async () => {
    const h = engineRun(async () => ({ decision: "deny" }));
    await runTask(h.deps);
    assert.deepEqual(trail(h.journal.events), [
      "requested",
      "answered deny/user",
      "decision policy_effective denied command/confirmation_required",
      "result policy_denied",
      "finished done/verified",
    ]);
  });

  test("as before when it is allowed once: the answer, the allowed decision, the result", async () => {
    const h = engineRun(async () => ({ decision: "allow_once" }));
    await runTask(h.deps);
    assert.deepEqual(trail(h.journal.events).slice(0, 4), ["requested", "answered allow_once/user", "decision policy_effective allowed", "result ok"]);
  });
});

// R88b-L1 itself, through the real `codaryn run`: the model calls other.mjs (no rule: denied) and
// then ask.mjs (a rule that asks first); the run is cancelled at the question.
const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});
/** Not a real key format; built from parts (G-10). */
const FAKE_KEY = ["fake", "u137", "r88b", "0137"].join("-");
const FAKE_MODEL = "fake-model-u137";
const NODE = process.execPath;
/** A closed loopback port: the injected fetch answers, so it is never reached. */
const UNREACHED = "http://127.0.0.1:9";

function fakeFetch(): typeof fetch {
  const message = (content: unknown[], stopReason: string) => ({ id: "msg_fake", type: "message", role: "assistant", model: FAKE_MODEL, content, stop_reason: stopReason, usage: { input_tokens: 10, output_tokens: 5 } });
  const replies = [
    message(
      [
        { type: "tool_use", id: "toolu_o1", name: "run_command", input: { executable: NODE, args: ["other.mjs"] } },
        { type: "tool_use", id: "toolu_a1", name: "run_command", input: { executable: NODE, args: ["ask.mjs"] } },
      ],
      "tool_use",
    ),
    message([{ type: "text", text: "done" }], "end_turn"),
  ];
  let at = 0;
  return (async () => {
    const reply = replies[at++];
    if (reply === undefined) throw new Error("no more fake replies");
    return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("U-137 (R88b-L1): the end summary keeps the add-a-rule hint for the unruled call", () => {
  test("cancelled at the question after an unruled command was denied: both are denied calls, and the hint is there", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "codaryn-u137-"));
    temporaryDirs.push(base);
    const work = path.join(base, "work");
    await mkdir(work);
    for (const name of ["ask", "other"]) await writeFile(path.join(work, `${name}.mjs`), `import { writeFileSync } from "node:fs";\nwriteFileSync("${name}-ran.txt", "ran\\n");\n`, "utf8");
    const policy = { commands: [{ executable: NODE, argsPrefix: ["ask.mjs"], allowExtraArgs: false, confirm: true }], network: "deny", destructive: "deny", restorePathTokens: false };
    const limits = { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: 100_000, maxDurationMs: 60_000 };
    await writeFile(path.join(base, "config.json"), JSON.stringify({ schemaVersion: 1, model: FAKE_MODEL, maxOutputTokens: 321, apiBaseUrl: UNREACHED, maxRetries: 0, limits, policy }), "utf8");
    const catalog = createMessageCatalog("en");
    const output = createHumanOutput(catalog);
    const written: string[] = [];
    const cancel = new AbortController();
    const io = {
      argv: ["run", "--config", path.join(base, "config.json"), "--workspace", work, "--goal", "run the scripts"],
      env: { [ANTHROPIC_API_KEY_ENV]: FAKE_KEY },
      cwd: base,
      readFile: (file: string) => readFile(file, "utf8"),
      isDirectory: async (dir: string) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
      loadEnvFile: () => {},
      locateInWorkspace: (file: string, root: string) => locateInWorkspace(file, root),
      clock: { now: () => Date.now() },
      randomBytes: (size: number) => randomBytes(size),
      assemble: assembleRun,
      anthropicDeps: { fetch: fakeFetch(), sleep: async () => {} },
      cancelSignal: () => ({ signal: cancel.signal, dispose: () => {} }),
      writeProgress: (line: string) => {
        written.push(line);
      },
      human: () => ({ output, messages: catalog }),
      ask: async (_question: string, signal: AbortSignal) => {
        cancel.abort();
        if (!signal.aborted) await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
        return null;
      },
    } as unknown as CliEnvironment;
    const outcome = await runCli(io);
    assert.ok(outcome.info !== undefined, JSON.stringify(outcome.output));
    const summary = outcome.info.summary;
    assert.deepEqual(summary.confirmationDenied, { user: 0, default: 0, cancelled: 1, couldAsk: true });
    assert.equal(summary.deniedToolCalls, 2, "other.mjs and the call cancelled at its question");
    assert.equal(summary.deniedCommandCalls, 2);
    const t = catalog.format as (id: string, ...rest: unknown[]) => CatalogText;
    const text = output.runSummary(outcome.output as never, summary);
    assert.ok(text.includes(String(t("summary.denied_hint"))), text);
    assert.ok(text.includes(String(t("summary.denied", { count: 2 }))), text);
  });
});
