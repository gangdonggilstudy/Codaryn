import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { startEngineHost } from "../../src/main/engine-client.js";
import type { EngineHost } from "../../src/main/engine-client.js";
import { isRunId, toRunResultView } from "../../src/shared/ipc.js";
import { parseRunItems, RUN_TOKEN_PATTERN } from "../../src/shared/protocol.js";
import type { HostRunMessage } from "../../src/shared/protocol.js";
import { taskFile, within } from "./gsec-host-support.js";

export type Obj = Record<string, unknown>;
export interface Stored { result: Obj; records: Obj[] }
export interface Observation extends Stored { resultText: string; journalText: string }
export const SECRET_A = "synthetic-parity-ALPHA-value-8426";
export const SECRET_B = "synthetic-parity-BETA-value-9753";
export const NOTE = "# Note\n\nSame scripted document.\n";
export const FINAL = "wrote NOTE.md";
const README = `# Readme\nA=${SECRET_A}\nB=${SECRET_B}\n`;
const MARKER = "protected marker\n";
const GUI = fileURLToPath(new URL("../../../", import.meta.url));
const ROOT = path.resolve(GUI, "..");
const ENGINE = path.join(ROOT, "dist", "src");
const CLI = path.join(ENGINE, "cli", "main.js");
const HOST = path.join(GUI, "build", "src", "engine-host", "main.js");
const TOKEN = /\[\[CODARYN_SECRET:[0-9a-f]{16}\]\]/g;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/;
export const sha = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
export function object(value: unknown, at: string): Obj {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `${at}: object`);
  return value as Obj;
}
function array(value: unknown, at: string): unknown[] { assert.ok(Array.isArray(value), `${at}: array`); return value; }
function children(value: unknown, visit: (text: string, at: string) => void, at = "$"): void {
  if (typeof value === "string") visit(value, at);
  else if (Array.isArray(value)) value.forEach((item, i) => children(item, visit, `${at}[${i}]`));
  else if (typeof value === "object" && value !== null) for (const [key, item] of Object.entries(value)) {
    visit(key, `${at}.<key>`); children(item, visit, `${at}.${key}`);
  }
}
export function assertSecretFree(value: unknown): void {
  children(value, (text, at) => {
    assert.ok(!text.includes(SECRET_A) && !text.includes(SECRET_B), `${at}: synthetic secret absent`);
  });
}
function contained(root: string, file: string): void {
  const rel = path.relative(root, path.resolve(file));
  assert.ok(rel !== "" && !rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel), "owned containment");
  let current = root;
  assert.ok(!lstatSync(root).isSymbolicLink(), "owned root is not a link");
  for (const part of rel.split(path.sep)) {
    current = path.join(current, part);
    if (existsSync(current)) assert.ok(!lstatSync(current).isSymbolicLink(), "owned ancestry is not a link");
  }
}
/** Optional artifacts belong to the explicit test operator's new job, never a hardcoded old job. */
export function evidence(name: string, value: unknown): void {
  const dir = process.env["CODARYN_TEST_PARITY_EVIDENCE"];
  if (dir === undefined) return;
  assert.match(name, /^[a-z0-9-]+$/);
  const allowed = path.join(ROOT, ".codaryn", "session-comms");
  assert.ok(path.isAbsolute(dir)); contained(allowed, dir);
  mkdirSync(dir, { recursive: true }); contained(allowed, path.join(dir, name + ".json"));
  writeFileSync(path.join(dir, name + ".json"), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}
function childEnv(base: string): Record<string, string> {
  return {
    ...(process.platform === "win32" ? { SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows" } : {}),
    PATH: path.dirname(process.execPath) + (process.platform === "win32" ? ";C:\\Windows\\System32" : ""),
    TEMP: base, TMP: base, HOME: base, USERPROFILE: base, APPDATA: path.join(base, "appdata"),
    LOCALAPPDATA: path.join(base, "local"), XDG_CONFIG_HOME: path.join(base, "xdg"), CODARYN_LANG: "en",
    PARITY_ALPHA: SECRET_A, PARITY_BETA: SECRET_B,
  };
}
function cliRun(base: string, task: string, env: Record<string, string>) {
  const child = spawn(process.execPath, [CLI, "run", "--task", task, "--json"], {
    cwd: base, env, stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true,
  });
  let closed = false, stdout = "", stderr = "", failure: Error | null = null;
  const ended = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>((resolve, reject) => {
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    const append = (channel: "stdout" | "stderr", text: string) => {
      if ((channel === "stdout" ? stdout.length : stderr.length) + text.length > 2 * 1024 * 1024) {
        failure = new Error(`CLI ${channel}: capture limit`); child.kill(); return;
      }
      if (channel === "stdout") stdout += text; else stderr += text;
    };
    child.stdout.on("data", (text: string) => append("stdout", text));
    child.stderr.on("data", (text: string) => append("stderr", text));
    child.once("error", (error) => { failure = error; reject(error); });
    child.once("close", (code, signal) => {
      closed = true;
      if (failure !== null) reject(failure); else resolve({ code, signal, stdout, stderr });
    });
  });
  return { child, ended, closed: () => closed };
}
async function readStored(work: string, id: string): Promise<Observation> {
  assert.ok(isRunId(id), "disk.runId: valid engine id");
  const run = path.join(work, ".codaryn", "runs", id);
  const resultFile = path.join(run, "result.json"), journalFile = path.join(run, "journal.jsonl");
  for (const file of [resultFile, journalFile]) {
    contained(work, file); assert.ok((await fs.lstat(file)).isFile(), "stored regular file");
    const real = await fs.realpath(file); contained(work, real);
  }
  assert.deepEqual(await fs.readdir(path.join(work, ".codaryn", "runs")), [id], "one exact run directory");
  const resultText = await fs.readFile(resultFile, "utf8"), journalText = await fs.readFile(journalFile, "utf8");
  assert.ok(journalText.endsWith("\n"), "journal: complete LF tail");
  const records = journalText.slice(0, -1).split("\n").map((line) => object(JSON.parse(line), "journal line"));
  const result = object(JSON.parse(resultText), "result");
  assert.equal(result.runId, id, "result.runId: disk identity");
  assert.equal(result.journalPath, `.codaryn/runs/${id}/journal.jsonl`, "result.journalPath: exact path");
  await assertNoLock(work);
  return { result, records, resultText, journalText };
}
async function assertNoLock(work: string): Promise<void> {
  await assert.rejects(fs.lstat(path.join(work, ".codaryn", "lock.json")), { code: "ENOENT" }, "lock released");
}

/** Exactly one CLI run and one separate real host run; resources are registered before awaits. */
export async function runPair(t: TestContext) {
  assert.ok(Number(process.versions.node.split(".")[0]) >= 26, "Node26 prerequisite");
  for (const file of [CLI, HOST, path.join(ENGINE, "app", "index.js")]) assert.ok(existsSync(file), `build prerequisite: ${file}`);
  const parent = await fs.realpath(os.tmpdir()), base = await fs.mkdtemp(path.join(parent, "codaryn-cli-host-parity-"));
  assert.ok(!path.resolve(base).toLowerCase().startsWith(ROOT.toLowerCase() + path.sep), "TEMP outside installation");
  const lifecycle: Obj = { pairedRuns: 1, cliTaskRuns: 0, hostTaskRuns: 0, hostInternalStderrCaptured: false };
  let running: ReturnType<typeof cliRun> | null = null, host: EngineHost | null = null, token: string | null = null, hostDone = false;
  t.after(async () => {
    const errors: string[] = [];
    const attempt = async (name: string, action: () => Promise<unknown>) => { try { await action(); } catch (error) { errors.push(`${name}: ${String(error)}`); } };
    if (host !== null) {
      if (!hostDone && token !== null) await attempt("cancel owned host run", () => host!.call("cancelRun", { run: token }, 10_000));
      await attempt("close owned host", () => within(host!.close(), 10_000, "host cleanup"));
      if (!host.exited) errors.push("host did not exit");
      lifecycle.hostExited = host.exited;
    }
    if (running !== null && !running.closed()) {
      running.child.kill(); await attempt("close owned CLI", () => within(running!.ended, 10_000, "CLI cleanup"));
    }
    lifecycle.cliClosed = running?.closed() ?? true;
    for (const name of ["cli", "host"]) {
      const work = path.join(base, name, "work");
      if (existsSync(path.join(work, ".codaryn"))) await attempt(`${name} lock`, () => assertNoLock(work));
    }
    if (errors.length === 0) await attempt("remove owned sandbox", async () => {
      contained(parent, base); assert.equal(await fs.realpath(base), base);
      await fs.rm(base, { recursive: true, force: false });
      await assert.rejects(fs.lstat(base), { code: "ENOENT" });
    });
    evidence("cleanup", { ...lifecycle, errors, removed: !existsSync(base) });
    assert.deepEqual(errors, [], "cleanup failures (primary test failure is retained separately)");
  });
  const steps = [
    { toolCalls: [{ id: "r1", name: "read_file", args: { path: "README.md" } }] },
    { toolCalls: [{ id: "wdeny", name: "write_file", args: { path: "keep/blocked.txt", expectedHash: null, change: { kind: "replace_all", content: "blocked\n" } } }] },
    { toolCalls: [{ id: "w1", name: "write_file", args: { path: "NOTE.md", expectedHash: null, change: { kind: "replace_all", content: NOTE } } }] },
    { text: FINAL },
  ];
  const sides: { base: string; work: string; task: string; env: Record<string, string>; before: string }[] = [];
  const baselines: Obj[] = [];
  for (const name of ["cli", "host"]) {
    const dir = path.join(base, name); await fs.mkdir(path.join(dir, "work", "keep"), { recursive: true });
    await fs.writeFile(path.join(dir, "work", "README.md"), README);
    await fs.writeFile(path.join(dir, "work", "keep", "marker.txt"), MARKER);
    const task = await taskFile(dir, "parity", steps, {
      workflow: "document", policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, protectedPaths: ["keep"] },
      privacy: { secretEnv: ["PARITY_ALPHA", "PARITY_BETA"] },
      verifiers: [{ id: "note", kind: "file_rules", rules: [{ type: "contains", path: "NOTE.md", text: "# Note" }] }],
    });
    const hashes: Obj = {};
    for (const file of ["parity.json", "parity-script.json", "work/README.md", "work/keep/marker.txt"]) hashes[file] = sha(await fs.readFile(path.join(dir, file)));
    baselines.push(hashes); const env = childEnv(dir);
    sides.push({ base: dir, work: path.join(dir, "work"), task, env, before: JSON.stringify(env) });
  }
  assert.deepEqual(baselines[0], baselines[1], "same initial task/script/workspace bytes"); evidence("fixture-baselines", baselines);
  const cli = sides[0]!, gui = sides[1]!;
  running = cliRun(cli.base, cli.task, cli.env); lifecycle.cliTaskRuns = 1;
  const cliEnd = await within(running.ended, 60_000, "CLI completion");
  assert.deepEqual([cliEnd.code, cliEnd.signal], [0, null], "CLI close code/signal");
  const cliJson = object(JSON.parse(cliEnd.stdout), "whole CLI stdout");
  assert.ok(isRunId(cliJson.runId), "CLI.runId");
  const cliStored = await readStored(cli.work, cliJson.runId);
  assert.deepEqual(cliJson, cliStored.result, "whole CLI stdout equals stored result");
  assertSecretFree(cliEnd); evidence("cli-observation", { ...cliStored, process: cliEnd });
  const started = await startEngineHost({ nodePath: process.execPath, hostScript: HOST, engineDir: ENGINE, env: gui.env, cwd: gui.base, transport: "loopback-only" });
  assert.ok(started.ok, `real host startup: ${JSON.stringify(started)}`); host = started.host;
  assert.notEqual(host.pid, process.pid, "host is a separate process");
  const messages: HostRunMessage[] = [], collectorErrors: string[] = [];
  const done = Promise.withResolvers<unknown>();
  host.onRunMessage((message) => {
    try {
      messages.push(message);
      if (message.type === "events") assert.notEqual(parseRunItems(message.items), null, "IPC events parse");
      if (message.type === "question" || message.type === "questionEnded") throw new Error("unexpected question message");
      if (message.type === "done") { hostDone = true; done.resolve(message.outcome); }
    } catch (error) { collectorErrors.push(String(error)); done.reject(error); }
  });
  const response = await host.call("startTaskRun", { taskPath: gui.task, varsFile: null, language: "en" }, 60_000);
  assert.ok(response.ok, `start envelope: ${JSON.stringify(response)}`);
  const value = object(response.value, "host start value"); assert.equal(value.ok, true, "host start value.ok");
  assert.ok(typeof value.run === "string" && RUN_TOKEN_PATTERN.test(value.run), "transport run token");
  assert.ok(isRunId(value.runId), "engine runId"); token = value.run; lifecycle.hostTaskRuns = 1;
  const ipcDone = await within(done.promise, 60_000, "host done");
  const hostStored = await readStored(gui.work, value.runId);
  const transport = await host.call("transport", {}, 10_000);
  assert.ok(transport.ok); assert.deepEqual(transport.value, { mode: "loopback-only", refused: 0 });
  await within(host.close(), 10_000, "normal host close"); assert.equal(host.exited, true);
  assert.deepEqual(collectorErrors, [], "listener failures are asserted outside callbacks");
  assert.equal(messages.filter((m) => m.type === "done").length, 1, "one done");
  assert.ok(messages.every((m) => m.run === token), "all IPC messages route to the start token");
  assertSecretFree({ response, messages });
  evidence("host-observation", { ...hostStored, response, messages, transport, separateHost: true, hostExited: host.exited, hostInternalStderrCaptured: false });
  for (let i = 0; i < sides.length; i++) {
    const side = sides[i]!;
    assert.equal(JSON.stringify(side.env), side.before, "caller child env unchanged");
    for (const file of Object.keys(baselines[i]!)) assert.equal(sha(await fs.readFile(path.join(side.base, file))), baselines[i]![file], `unchanged fixture ${file}`);
    assert.equal(await fs.readFile(path.join(side.work, "NOTE.md"), "utf8"), NOTE, "actual NOTE bytes");
    await assert.rejects(fs.lstat(path.join(side.work, "keep", "blocked.txt")), { code: "ENOENT" });
  }
  return { cli: cliStored, host: hostStored, ipcDone };
}

export function validateStored(value: Stored): void {
  const result = object(value.result, "$.result"), records = value.records;
  assert.ok(isRunId(result.runId), "$.result.runId");
  assert.deepEqual([result.schemaVersion, result.kind, result.taskId, result.provider, result.status, result.reason, result.exitCode], [1, "run", "gsec-parity", "scripted", "done", "verified", 0], "$.result.status/reason/identity");
  assert.equal(result.journalPath, `.codaryn/runs/${result.runId}/journal.jsonl`, "$.result.journalPath");
  assert.equal(records[0]?.type, "run_started", "$.records first type");
  assert.equal(records.at(-1)?.type, "run_finished", "$.records final type");
  for (const [i, row] of records.entries()) {
    assert.equal(row.seq, i + 1, `$.records[${i}].seq`); assert.equal(row.runId, result.runId, `$.records[${i}].runId`);
    assert.ok(typeof row.at === "string" && ISO.test(row.at) && Number.isFinite(Date.parse(row.at)), `$.records[${i}].at`);
  }
  const usage = object(result.usage, "$.result.usage"), last = records.at(-1)!;
  // Engine policy refusals return before the execution counter; n17 independently excludes refused calls.
  assert.deepEqual([usage.modelTurns, usage.toolCalls, usage.inputTokens, usage.outputTokens, usage.repairAttempts], [4, 2, 4, 4, 0], "$.result.usage exact counts");
  assert.ok(typeof usage.durationMs === "number" && Number.isFinite(usage.durationMs) && usage.durationMs >= 0, "$.result.usage.durationMs");
  assert.deepEqual(last.usage, usage, "$.records final usage equals result");
  assert.deepEqual([last.status, last.reason], [result.status, result.reason], "$.records final status/reason");
  assert.equal(records.filter((r) => r.type === "model_request").length, 4, "model requests");
  assert.equal(records.filter((r) => r.type === "model_response").length, 4, "model responses");
  assert.equal(records.filter((r) => r.type === "tool_result").length, 3, "tool results");
  assert.equal(records.filter((r) => String(r.type).startsWith("confirmation_")).length, 0, "no confirmation records");
  const denied = records.filter((r) => r.type === "tool_decision" && r.allowed === false);
  assert.equal(denied.length, 1, "$.records policy denial count");
  assert.deepEqual([denied[0]!.callId, denied[0]!.tool, denied[0]!.allowed, denied[0]!.code], ["wdeny", "write_file", false, "protected_path"], "$.records tool_decision policy fields");
  const failure = records.find((r) => r.type === "tool_result" && object(r.result, "tool result").callId === "wdeny");
  const failed = object(failure?.result, "$.records wdeny.result");
  assert.deepEqual([failed.tool, failed.ok, failed.errorCode], ["write_file", false, "policy_denied"], "$.records wdeny.result.errorCode");
  assert.deepEqual(result.changes, [{ path: "NOTE.md", previousHash: null, newHash: sha(NOTE), created: true }], "$.result.changes");
  assert.equal(records.filter((r) => r.type === "file_changed").length, 1, "one file_changed");
  const verifier = array(result.verifiers, "$.result.verifiers"); assert.equal(verifier.length, 1);
  const checked = object(verifier[0], "verifier");
  assert.deepEqual([checked.id, checked.kind, checked.outcome], ["note", "file_rules", "pass"], "verifier outcome");
  assert.equal(typeof checked.evidence, "string"); array(checked.checked, "verifier.checked"); array(checked.limits, "verifier.limits");
  const masking = object(result.masking, "$.result.masking");
  assert.equal(masking.registeredValues, 2, "registered synthetic values"); assert.ok(typeof masking.maskedPlaces === "number" && masking.maskedPlaces > 0, "masking count");
  assert.deepEqual(result.finalMessage, { text: FINAL, truncated: false }, "$.result.finalMessage");
  for (const field of ["plan", "planSummary", "planRunId", "planDigest", "review", "modelError"]) assert.equal(Object.hasOwn(result, field), false, `$.result.${field} absent`);
  for (const field of ["protectedChanged", "stateChanged"]) if (Object.hasOwn(result, field)) assert.deepEqual(result[field], [], `$.result.${field}`);
  assertSecretFree(value);
}

export function tokenAnchors(value: Stored): [string, string] {
  const read = value.records.find((r) => r.type === "tool_result" && object(r.result, "read result").callId === "r1");
  const content = object(read?.result, "read result").content; assert.equal(typeof content, "string");
  const payload = object(JSON.parse(content as string), "read payload");
  assert.deepEqual([payload.path, payload.hash, payload.hadBom], ["README.md", sha(README), false]);
  assert.equal(typeof payload.content, "string");
  const matches = [...(payload.content as string).matchAll(TOKEN)].map((match) => match[0]);
  assert.equal(matches.length, 2, "privacy tokens at two labels"); assert.notEqual(matches[0], matches[1], "privacy A/B tokens distinct");
  assert.equal(payload.content, `# Readme\nA=${matches[0]}\nB=${matches[1]}\n`, "privacy label anchors");
  return [matches[0]!, matches[1]!];
}
export function normalize(value: Stored) {
  validateStored(value);
  const anchors = tokenAnchors(value), coordinates: string[][] = [[], []];
  children({ result: value.result, records: value.records }, (text, at) => {
    assert.ok(!/CODARYN_SECRET/i.test(text.replace(TOKEN, "")), `${at}: malformed privacy token`);
    for (const match of text.matchAll(TOKEN)) {
      const role = anchors.indexOf(match[0]); assert.ok(role >= 0, `${at}: unissued privacy token`);
      coordinates[role]!.push(`${at}:${match.index}`);
    }
  });
  assert.ok(coordinates.every((places) => places.length > 0), "privacy bijection is surjective");
  const bundle: Stored = structuredClone({ result: value.result, records: value.records });
  bundle.result.runId = "<RUN>"; bundle.result.journalPath = ".codaryn/runs/<RUN>/journal.jsonl";
  object(bundle.result.usage, "usage").durationMs = "<DURATION_MS>";
  for (const row of bundle.records) { row.runId = "<RUN>"; row.at = "<AT>"; }
  object(bundle.records.at(-1)!.usage, "final usage").durationMs = "<DURATION_MS>";
  const replace = (node: unknown): unknown => {
    if (typeof node === "string") return node.replace(TOKEN, (token) => anchors.indexOf(token) === 0 ? "<TOKEN_A>" : "<TOKEN_B>");
    if (Array.isArray(node)) return node.map(replace);
    if (typeof node === "object" && node !== null) return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, replace(item)]));
    return node;
  };
  return { bundle: replace(bundle), receipt: { coordinates, anchors, originalJSON_SHA256: sha(JSON.stringify({ result: value.result, records: value.records })), mapped: ["result.runId", "result.journalPath", "records[*].runId", "records[*].at", "result.usage.durationMs", "records[last].usage.durationMs", "issued-token string occurrences"] } };
}
export function compareStored(left: Stored, right: Stored) {
  assert.deepEqual(right.records.map((r) => r.type), left.records.map((r) => r.type), "$.records kinds/order");
  const a = normalize(left), b = normalize(right);
  assert.deepEqual(b.receipt.coordinates, a.receipt.coordinates, "privacy bijection occurrence coordinates");
  assert.deepEqual(b.bundle, a.bundle, "complete stored result/journal fields");
  return { left: a.receipt, right: b.receipt };
}

export function assertIPC(actual: unknown, stored: Stored): void {
  const outcome = object(actual, "IPC outcome"), view = object(outcome.result, "IPC result"), full = stored.result;
  assert.deepEqual(Object.keys(outcome).sort(), ["ok", "result"]); assert.equal(outcome.ok, true);
  const usage = object(full.usage, "stored usage");
  const expected = {
    runId: full.runId, status: full.status, reason: full.reason, exitCode: full.exitCode,
    changes: array(full.changes, "changes").map((c) => { const row = object(c, "change"); return { path: row.path, created: row.created }; }),
    verifiers: array(full.verifiers, "verifiers").map((v, i) => ({ number: i + 1, outcome: object(v, "verifier").outcome })),
    usage: { turns: usage.modelTurns, tools: usage.toolCalls, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, durationMs: usage.durationMs },
    notices: full.notices, plan: null, review: null,
    protectedChanged: Array.isArray(full.protectedChanged) ? full.protectedChanged.length : null,
    finalMessage: full.finalMessage, masking: full.masking,
  };
  assert.deepEqual(view, expected, "independent minimized IPC projection from same stored run");
  assert.equal(toRunResultView(actual).ok, true, "actual GUI acceptance checker");
  assertSecretFree(actual);
}
