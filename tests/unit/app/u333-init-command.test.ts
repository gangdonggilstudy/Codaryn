/** U333: legacy public behavior fixed on the actual OLD before extracting the core. */
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import * as legacy from "../../../src/cli/init.js";
import type { InitEnvironment } from "../../../src/cli/init.js";
import { INIT_SUGGESTED_PROTECTED_PATHS } from "../../../src/contracts/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";

const english = createMessageCatalog("en");
const target = path.resolve("D:/synthetic-u333/config.json");
const workspace = path.resolve("D:/synthetic-u333/work");
function environment(overrides: Partial<InitEnvironment> = {}): InitEnvironment {
  const io: InitEnvironment = {
    argv: ["init", "--config", target], env: {}, cwd: "D:/synthetic-u333", platform: "win32", defaultConfig: null,
    messages: english, readFile: async () => { throw new Error("unexpected synthetic read"); },
    isDirectory: async () => true, locateInWorkspace: async () => "outside", exists: async () => false,
    makeDirectory: async () => {}, writeNewFile: async () => {},
  };
  return Object.defineProperties(io, Object.getOwnPropertyDescriptors(overrides));
}

test("U333 old exports, protected alias and config bytes remain stable", () => {
  assert.deepEqual(Object.keys(legacy).sort(), ["MAX_PACKAGE_JSON_BYTES", "SUGGESTED_PROTECTED_PATHS", "SUGGESTED_SCRIPTS", "initConfigText", "renderInit", "runInit"]);
  assert.equal(legacy.SUGGESTED_PROTECTED_PATHS, INIT_SUGGESTED_PROTECTED_PATHS);
  assert.equal(legacy.MAX_PACKAGE_JSON_BYTES, 1048576);
  assert.equal(legacy.initConfigText.length, 1);
  const text = legacy.initConfigText({ model: "model-a", commands: [], protectedPaths: [], language: null });
  assert.equal(text, '{\n  "schemaVersion": 1,\n  "model": "model-a",\n  "maxOutputTokens": 4096,\n  "limits": {\n    "maxModelTurns": 12,\n    "maxToolCalls": 24,\n    "maxTotalTokens": 150000,\n    "maxDurationMs": 600000\n  },\n  "policy": {\n    "commands": [],\n    "network": "deny",\n    "destructive": "deny",\n    "restorePathTokens": false\n  }\n}\n');
  const choices = { model: "model-o", commands: [legacy.SUGGESTED_SCRIPTS[1]!.rule], protectedPaths: ["tests"] as const, language: "ko" as const, provider: "openai" as const };
  const selected = JSON.parse(legacy.initConfigText(choices));
  assert.deepEqual(Object.keys(selected), ["schemaVersion", "provider", "providers", "limits", "policy", "language"]);
  assert.deepEqual(selected.providers, { openai: { model: "model-o", maxOutputTokens: 4096 } });
  assert.deepEqual(choices.commands[0], { executable: "npm", argsPrefix: ["run", "build"], allowExtraArgs: false });
});

test("U333 JSON reads initial platform/messages but never the ask or terminal getters", async () => {
  const trace: string[] = [];
  const io = environment({ argv: ["init", "--config", target, "--json"],
    get platform() { trace.push("platform"); return "win32" as const; },
    get messages() { trace.push("messages"); return english; },
    get ask(): InitEnvironment["ask"] { throw new Error("JSON must not read ask"); },
    get stdoutIsTerminal(): boolean { throw new Error("JSON must not read terminal"); },
    makeDirectory: async function (this: unknown) { assert.equal(this, io); trace.push("mkdir"); },
    writeNewFile: async function (this: unknown) { assert.equal(this, io); trace.push("write"); },
  });
  const result = await legacy.runInit(io);
  assert.deepEqual(trace, ["platform", "messages", "mkdir", "write"]);
  assert.ok("output" in result);
  assert.deepEqual(Object.keys(result.output), ["schemaVersion", "kind", "status", "exitCode", "config", "interactive", "model", "language", "commands", "protectedPaths", "keySet", "overriddenBy"]);
  assert.equal(result.output.kind, "init");
});

test("U333 immediate refusal and argv getter rejection retain Promise completion order", async () => {
  const trace: string[] = [];
  const pending = legacy.runInit(environment({ argv: ["init"], exists: async () => { assert.fail("no target"); } })).then((value) => { trace.push("fulfilled"); return value; });
  trace.push("returned"); queueMicrotask(() => trace.push("queued"));
  assert.equal((await pending).exitCode, 2);
  assert.deepEqual(trace, ["returned", "fulfilled", "queued"]);
  const fault = Symbol("synthetic argv");
  await legacy.runInit(environment({ get argv(): readonly string[] { throw fault; } })).then(() => assert.fail("expected rejection"), (error: unknown) => assert.equal(error, fault));
});

test("U333 deferred exists reads ask late but retains the initial catalog", { timeout: 2000 }, async () => {
  const gate = Promise.withResolvers<boolean>();
  let allowAsk = false, catalog = english, asks = 0;
  const io = environment({ get messages() { return catalog; },
    exists: () => gate.promise,
    get ask() { return allowAsk ? () => { asks++; return Promise.resolve(null); } : undefined; },
    writeNewFile: async () => { assert.fail("decline must not write"); },
  });
  const pending = legacy.runInit(io);
  allowAsk = true; catalog = createMessageCatalog("ko"); gate.resolve(false);
  assert.deepEqual(await pending, { text: english.format("init.declined") + "\n", exitCode: 3 });
  assert.equal(asks, 1);
});

test("U333 deferred write reads terminal only at synchronous finish", { timeout: 2000 }, async () => {
  const entered = Promise.withResolvers<void>(), gate = Promise.withResolvers<void>();
  const trace: string[] = [];
  let terminal = false;
  const io = environment({ get stdoutIsTerminal() { trace.push("terminal"); return terminal; },
    writeNewFile: () => { trace.push("write"); entered.resolve(); return gate.promise; },
  });
  const pending = legacy.runInit(io).then((value) => { trace.push("fulfilled"); return value; });
  trace.push("returned"); queueMicrotask(() => trace.push("queued"));
  await entered.promise;
  assert.equal(trace.includes("terminal"), false);
  terminal = true; trace.push("release"); gate.resolve();
  const result = await pending;
  assert.ok("text" in result && result.text.endsWith(english.format("first_use.try_without_key") + "\n"));
  assert.deepEqual(trace.slice(-3), ["release", "terminal", "fulfilled"]);
});

test("U333 rendering exceptions reject only after the write has completed", async () => {
  const fault = new Error("synthetic catalog");
  let written = false;
  const io = environment({ messages: { ...english, format() { assert.equal(written, true); throw fault; } },
    writeNewFile: async () => { written = true; },
  });
  await legacy.runInit(io).then(() => assert.fail("expected rejection"), (error: unknown) => assert.equal(error, fault));
});

test("U333 provider/model questions keep receivers, id reads and best-effort tell", async () => {
  const answers = ["y", "1", "1", "ko"], asked: string[] = [];
  let idReads = 0, written = "";
  const io = environment({ env: { ["ANTHROPIC_API" + "_KEY"]: "synthetic-u333-value" },
    ask: function (this: unknown, question) { assert.equal(this, undefined); asked.push(question); return Promise.resolve(answers.shift() ?? null); },
    tell: function (this: unknown) { assert.equal(this, io); throw new Error("stderr best effort"); },
    listModels: function (this: unknown) { assert.equal(this, undefined); return Promise.resolve({ ok: true, models: [{ get id() { idReads++; return "model-a"; }, displayName: "A", createdAt: null, maxInputTokens: null, maxOutputTokens: null }] }); },
    writeNewFile: async (_file, text) => { written = text; },
  });
  assert.equal((await legacy.runInit(io)).exitCode, 0);
  assert.equal(idReads, 5); assert.equal(asked.length, 4);
  assert.ok(asked.every((line) => line.endsWith(" ")));
  assert.deepEqual([JSON.parse(written).model, JSON.parse(written).language], ["model-a", "ko"]);
});

test("U333 workspace suggestions use fixed script order before protected paths", async () => {
  const asked: string[] = [], steps: string[] = [], answers = ["y", "1", "y", "y", "n", "", ""];
  let written = "";
  const io = environment({ argv: ["init", "--config", target, "--workspace", workspace],
    readFile: async function (this: unknown) { assert.equal(this, io); steps.push("scripts"); return '\ufeff{"scripts":{"build":"BODY-CANARY","test":"BODY-CANARY","lint":false}}'; },
    exists: async (file) => { if (file === target) return false; steps.push(path.basename(file)); return ["tests", "package.json"].includes(path.basename(file)); },
    ask: (question) => { asked.push(question); return Promise.resolve(answers.shift() ?? null); },
    writeNewFile: async (_file, text) => { written = text; },
  });
  await legacy.runInit(io);
  assert.deepEqual(steps, ["scripts", ...legacy.SUGGESTED_PROTECTED_PATHS]);
  assert.ok(asked[2]?.includes("npm test")); assert.ok(asked[3]?.includes("npm run build"));
  assert.equal(asked.join("").includes("BODY-CANARY"), false);
  assert.deepEqual(JSON.parse(written).policy.commands, [legacy.SUGGESTED_SCRIPTS[0]!.rule, legacy.SUGGESTED_SCRIPTS[1]!.rule]);
  assert.deepEqual(JSON.parse(written).policy.protectedPaths, ["package.json"]);
});

test("U333 mkdir/write error precedence preserves EEXIST and original catch scope", async () => {
  for (const [at, code, expected] of [["mkdir", "EACCES", "config_write_failed"], ["write", "EEXIST", "config_exists"], ["write", "EACCES", "config_write_failed"]]) {
    const trace: string[] = [];
    const io = environment({ makeDirectory: async () => { trace.push("mkdir"); if (at === "mkdir") throw { code }; },
      writeNewFile: async () => { trace.push("write"); throw { code }; },
    });
    const result = await legacy.runInit(io);
    assert.ok("output" in result && result.output.kind === "error"); assert.equal(result.output.code, expected);
    assert.deepEqual(trace, at === "mkdir" ? ["mkdir"] : ["mkdir", "write"]);
  }
});

test("U333 ask rejection propagates at both wrapped-confirm and direct-provider boundaries", async () => {
  for (const failAt of [1, 2]) {
    const fault = Symbol("synthetic ask"); let calls = 0;
    const io = environment({ ask: () => { if (++calls === failAt) throw fault; return Promise.resolve("y"); },
      makeDirectory: async () => { assert.fail("ask failed before mkdir"); },
    });
    await legacy.runInit(io).then(() => assert.fail("expected rejection"), (error: unknown) => assert.equal(error, fault));
  }
});

test("U333 malformed and oversized package data give no script question", async () => {
  for (const text of ["{", " ".repeat(legacy.MAX_PACKAGE_JSON_BYTES + 1)]) {
    let calls = 0;
    const io = environment({ argv: ["init", "--config", target, "--workspace", workspace], readFile: async () => text,
      ask: () => Promise.resolve(++calls === 1 ? "y" : ""),
    });
    assert.equal((await legacy.runInit(io)).exitCode, 0); assert.equal(calls, 3);
  }
});

test("U333 script suggestions retain the canonical entry and rule until selection", async () => {
  const entry = legacy.SUGGESTED_SCRIPTS[0]!;
  const descriptor = Object.getOwnPropertyDescriptor(entry, "rule")!;
  const rule = entry.rule;
  let ruleReads = 0, written = "", questions = 0;
  Object.defineProperty(entry, "rule", { configurable: true, enumerable: true, get() {
    assert.equal(this, entry); ruleReads++; return rule;
  } });
  try {
    const io = environment({ argv: ["init", "--config", target, "--workspace", workspace],
      readFile: async () => '{"scripts":{"test":"synthetic"}}',
      ask: () => {
        questions++;
        if (questions === 3) assert.equal(ruleReads, 0, "read rule only after the command answer");
        return Promise.resolve(questions === 1 || questions === 3 ? "y" : "");
      },
      writeNewFile: async (_file, text) => { written = text; },
    });
    assert.equal((await legacy.runInit(io)).exitCode, 0);
    assert.equal(ruleReads, 1);
    assert.deepEqual(JSON.parse(written).policy.commands, [rule]);
    assert.equal(Object.getOwnPropertyDescriptor(entry, "rule")?.get !== undefined, true);
  } finally {
    Object.defineProperty(entry, "rule", descriptor);
  }
});
