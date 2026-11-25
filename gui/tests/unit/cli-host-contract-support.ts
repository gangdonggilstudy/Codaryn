/**
 * Contract-layer cases after CP53 (standalone-gui 8.3 and 12): one run made once through the real CLI
 * child and once through a separate real engine host child, each in its own copy of the same fixture.
 * The stored result and journal are compared whole after CP53's mapping only (run id, journal path,
 * record times, run duration). CP53's own files are imported, never changed.
 *
 * A task case uses the scripted provider. A quick case (C-4: a permission question needs a settings
 * rule, so a quick run) gives each side its own fake Anthropic server on 127.0.0.1
 * (tests/support/fake-anthropic.ts), its own config at the default location and the fake key value of
 * tests/fixtures/secrets.ts; the CLI child runs behind the tests' network guard (tests/support/net-guard.ts).
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startEngineHost } from "../../src/main/engine-client.js";
import type { EngineHost } from "../../src/main/engine-client.js";
import { isRunId, toRunResultView } from "../../src/shared/ipc.js";
import { parseRunItems, RUN_TOKEN_PATTERN } from "../../src/shared/protocol.js";
import type { HostRunMessage } from "../../src/shared/protocol.js";
import { object, sha } from "./cli-host-parity-support.js";
import type { Obj, Stored } from "./cli-host-parity-support.js";
import { taskFile, within } from "./gsec-host-support.js";

const GUI = fileURLToPath(new URL("../../../", import.meta.url));
const ROOT = path.resolve(GUI, "..");
const ENGINE = path.join(ROOT, "dist", "src");
const CLI = path.join(ENGINE, "cli", "main.js");
const HOST = path.join(GUI, "build", "src", "engine-host", "main.js");
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/;
const CAPTURE_LIMIT = 2 * 1024 * 1024;
const load = async <T>(...parts: string[]): Promise<T> => (await import(pathToFileURL(path.join(ROOT, "dist", ...parts)).href)) as T;

/** tests/support/fake-anthropic.ts RecordedRequest, as far as these cases read it. */
export interface RecordedRequest {
  readonly index: number;
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyText: string;
  readonly body: unknown;
  readonly streamed: boolean;
  readonly outcome: string;
  readonly violations: readonly string[];
}
interface FakeApi { readonly url: string; readonly requests: readonly RecordedRequest[] }
/** The reply and config builders of the root tests (built into dist/tests). */
export interface MockApi {
  replyTools(blocks: readonly unknown[]): unknown;
  replyText(text: string): unknown;
  toolUse(id: string, name: string, input: Readonly<Record<string, unknown>>): unknown;
  fakeApiConfig(url: string, overrides: Record<string, unknown>): Record<string, unknown>;
}
interface MockParts extends MockApi {
  startFakeAnthropic(t: TestContext, steps: readonly unknown[]): Promise<FakeApi>;
  readonly key: string;
  readonly keyEnv: string;
  readonly guardEnv: string;
  readonly guardUrl: string;
}
let mockParts: MockParts | null = null;
async function mockPartsOf(): Promise<MockParts> {
  if (mockParts !== null) return mockParts;
  const fake = await load<Pick<MockParts, "startFakeAnthropic" | "replyTools" | "replyText" | "toolUse">>("tests", "support", "fake-anthropic.js");
  const fixtures = await load<Pick<MockApi, "fakeApiConfig">>("tests", "fixtures", "anthropic.js");
  const secrets = await load<{ FAKE_API_KEY: string }>("tests", "fixtures", "secrets.js");
  const guard = await load<{ NET_GUARD_LOG_ENV: string }>("tests", "support", "net-guard.js");
  const contracts = await load<{ ANTHROPIC_API_KEY_ENV: string }>("src", "contracts", "config.js");
  mockParts = {
    startFakeAnthropic: fake.startFakeAnthropic, replyTools: fake.replyTools, replyText: fake.replyText, toolUse: fake.toolUse,
    fakeApiConfig: fixtures.fakeApiConfig, key: secrets.FAKE_API_KEY, keyEnv: contracts.ANTHROPIC_API_KEY_ENV,
    guardEnv: guard.NET_GUARD_LOG_ENV, guardUrl: pathToFileURL(path.join(ROOT, "dist", "tests", "support", "net-guard.js")).href,
  };
  return mockParts;
}
export const mockApi = (): Promise<MockApi> => mockPartsOf();

/** The variable the tests' terminal preload reads (it lives in tests/; product code does not read it). */
const TERMINAL_ENV = "CODARYN_TEST_TERMINAL";
/** C-5 to C-7: the terminal preload (built into dist/tests) and the first sentence of the CLI's question. */
interface TerminalParts { readonly url: string; readonly questionLead: string }
let terminalParts: TerminalParts | null = null;
async function terminalPartsOf(): Promise<TerminalParts> {
  if (terminalParts !== null) return terminalParts;
  const file = path.join(ROOT, "dist", "tests", "unit", "cli", "u110-terminal-preload.js");
  assert.ok(existsSync(file), `build prerequisite: ${file}`);
  const i18n = await load<{ createMessageCatalog(language: "en"): { format(id: string, params: { count: number }): string } }>("src", "i18n", "index.js");
  // The question as the catalog writes it (confirm.question.command); its first sentence is the same at every count.
  const text = i18n.createMessageCatalog("en").format("confirm.question.command", { count: 0 });
  const questionLead = text.slice(0, text.indexOf("?") + 1);
  assert.ok(questionLead.length > 10, "the question's first sentence");
  terminalParts = { url: pathToFileURL(file).href, questionLead };
  return terminalParts;
}

export interface QuickRun {
  readonly goal: string;
  /** The model's replies; each side's own fake API gives the same ones in order. */
  readonly replies: readonly unknown[];
  /** The config each side reads from its default location, given its own fake API's address. */
  readonly config: (apiUrl: string) => Record<string, unknown>;
}
export interface ContractCase {
  /** Lower-case; a task case's task is `gsec-<name>` (taskFile). */
  readonly name: string;
  /** The workspace before the run: relative path → text. */
  readonly files: Readonly<Record<string, string>>;
  /** A task case: its script steps and its task fields over taskFile's defaults. */
  readonly steps?: readonly unknown[];
  readonly task?: Readonly<Record<string, unknown>>;
  /** A quick case instead: CLI `run --workspace --goal`, host `startRun` (the same request, AC 5.1). */
  readonly quick?: QuickRun;
  /** Cancel once the journal holds this many model_request records: CLI `--cancel-file`, host `cancelRun`. */
  readonly cancelAt?: number;
  /**
   * The host side at each question, as the main process does it: "dismissed" (C-4: nobody could ask),
   * "deny" (the person's no, the dialog's Deny or Esc), "cancel" (cancelRun while the question is open),
   * "none" (no answer: the engine's time limit ends the question). Absent: a question fails the case.
   */
  readonly answer?: "dismissed" | "deny" | "cancel" | "none";
  /**
   * C-5 to C-7: the CLI child at a terminal, as the tests' preload makes it (tests/unit/cli/
   * u110-terminal-preload.ts, `--import`: only `isTTY` of stdin and stderr changes; stdin is a pipe),
   * so main.ts gives the run its question (`ask`). At each question on stderr: "deny" types `n`,
   * "interrupt" types Ctrl+C (0x03, readline's interrupt, which the CLI turns into SIGINT), "none" types
   * nothing. Absent: no terminal, so the CLI does not ask (C-1 to C-4).
   */
  readonly cliTerminal?: "deny" | "interrupt" | "none";
}
export interface SideRun extends Stored {
  /** Every workspace file outside `.codaryn` after the run: relative path → text. */
  readonly workspace: Readonly<Record<string, string>>;
}
export interface PairRun {
  readonly cli: SideRun;
  readonly host: SideRun;
  readonly cliExit: { readonly code: number | null; readonly signal: NodeJS.Signals | null };
  readonly ipc: unknown;
  readonly messages: readonly HostRunMessage[];
  /** Each side's own folder (the quick run's workspace path is under it). */
  readonly bases: { readonly cli: string; readonly host: string };
  /** The question ids the host sent, in order. */
  readonly questions: readonly string[];
  /** The question ids the host ended itself (questionEnded: the run's signal ended them), in order. */
  readonly questionsEnded: readonly string[];
  /** How many questions the CLI wrote on stderr (its terminal cases), as the answering loop counted them. */
  readonly cliQuestions: number;
  /** A quick case: what each side's fake API received. */
  readonly requests: { readonly cli: readonly RecordedRequest[]; readonly host: readonly RecordedRequest[] } | null;
}

function inside(root: string, file: string): boolean {
  const rel = path.relative(root, path.resolve(file));
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/** CP53's child environment without the privacy values: every config, home and temp place is the side's own. */
function childEnv(base: string): Record<string, string> {
  const windows = process.platform === "win32";
  const root = process.env["SystemRoot"] ?? process.env["WINDIR"] ?? "C:\\Windows";
  return {
    ...(windows ? { SystemRoot: root, WINDIR: root } : {}),
    PATH: path.dirname(process.execPath) + (windows ? path.delimiter + path.join(root, "System32") : ""),
    TEMP: base, TMP: base, HOME: base, USERPROFILE: base, APPDATA: path.join(base, "appdata"),
    LOCALAPPDATA: path.join(base, "local"), XDG_CONFIG_HOME: path.join(base, "xdg"), CODARYN_LANG: "en",
  };
}
/** The default config location under childEnv (src/app/input/config-file.ts findDefaultConfigLocation). */
function defaultConfigFile(base: string): string {
  return process.platform === "win32" ? path.join(base, "appdata", "Codaryn", "config.json") : path.join(base, "xdg", "codaryn", "config.json");
}

interface CliRun {
  readonly ended: Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>;
  readonly kill: () => void;
  readonly closed: () => boolean;
  /** stderr so far (the terminal cases watch it for the question). */
  readonly stderrNow: () => string;
  /** Types into the CLI's stdin (a terminal case only; nothing once the process ended). */
  readonly type: (text: string) => void;
  /** Closes the CLI's stdin (a terminal case only). */
  readonly endInput: () => void;
}
function startCli(base: string, args: readonly string[], env: Record<string, string>, nodeArgs: readonly string[], stdinPipe = false): CliRun {
  const child = spawn(process.execPath, [...nodeArgs, CLI, ...args], { cwd: base, env, stdio: [stdinPipe ? "pipe" : "ignore", "pipe", "pipe"], shell: false, windowsHide: true });
  // A write after the child ended is dropped, not an error of the case.
  child.stdin?.on("error", () => undefined);
  // Both are pipes (stdio above); the conditional stdin only widens the typings.
  const out = child.stdout!, err = child.stderr!;
  let closed = false, stdout = "", stderr = "", failure: Error | null = null;
  const ended = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>((resolve, reject) => {
    out.setEncoding("utf8"); err.setEncoding("utf8");
    const append = (channel: "stdout" | "stderr", text: string): void => {
      if ((channel === "stdout" ? stdout.length : stderr.length) + text.length > CAPTURE_LIMIT) {
        failure = new Error(`CLI ${channel}: capture limit`); child.kill(); return;
      }
      if (channel === "stdout") stdout += text; else stderr += text;
    };
    out.on("data", (text: string) => append("stdout", text));
    err.on("data", (text: string) => append("stderr", text));
    child.once("error", (error) => { failure = error; reject(error); });
    child.once("close", (code, signal) => {
      closed = true;
      if (failure !== null) reject(failure); else resolve({ code, signal, stdout, stderr });
    });
  });
  ended.catch(() => undefined); // awaited by the case; this only keeps an early failure from going unhandled
  return {
    ended,
    kill: () => child.kill(),
    closed: () => closed,
    stderrNow: () => stderr,
    type: (text) => { if (!closed && child.stdin !== null && !child.stdin.destroyed) child.stdin.write(text); },
    endInput: () => { if (child.stdin !== null && !child.stdin.destroyed) child.stdin.end(); },
  };
}

/** Complete journal lines of the one run so far (a line still being written is left out). */
async function journalTypes(work: string): Promise<string[]> {
  const runs = path.join(work, ".codaryn", "runs");
  const names = await fs.readdir(runs).catch(() => [] as string[]);
  if (names.length !== 1) return [];
  const text = await fs.readFile(path.join(runs, names[0]!, "journal.jsonl"), "utf8").catch(() => "");
  return text.slice(0, text.lastIndexOf("\n") + 1).split("\n").filter((line) => line !== "").map((line) => {
    try { return String((JSON.parse(line) as Obj).type); } catch { return "<partial>"; }
  });
}

/**
 * Waits until the run has recorded `count` model requests. The engine records model_request before it
 * calls the model (src/engine/index.ts converse), so a cancel after this lands in that turn, after its
 * record (it does not show that the provider's wait had begun; the run's signal ends the call either way).
 */
async function reach(work: string, count: number, alive: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    if ((await journalTypes(work)).filter((type) => type === "model_request").length >= count) return;
    assert.ok(alive(), `${what}: the run ended before its cancel point`);
    assert.ok(Date.now() < deadline, `${what}: the cancel point was not reached within 30 s`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function readStored(work: string, id: unknown): Promise<Stored> {
  assert.ok(isRunId(id), "stored runId: a valid engine id");
  const runs = path.join(work, ".codaryn", "runs");
  assert.deepEqual(await fs.readdir(runs), [id], "one exact run directory");
  const resultFile = path.join(runs, id, "result.json"), journalFile = path.join(runs, id, "journal.jsonl");
  for (const file of [resultFile, journalFile]) {
    assert.ok(inside(work, file) && (await fs.lstat(file)).isFile(), `stored regular file: ${path.basename(file)}`);
  }
  const journalText = await fs.readFile(journalFile, "utf8");
  assert.ok(journalText.endsWith("\n"), "journal: complete LF tail");
  const records = journalText.slice(0, -1).split("\n").map((line) => object(JSON.parse(line), "journal line"));
  const result = object(JSON.parse(await fs.readFile(resultFile, "utf8")), "result");
  await assert.rejects(fs.lstat(path.join(work, ".codaryn", "lock.json")), { code: "ENOENT" }, "lock released");
  return { result, records };
}

async function snapshot(work: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!(dir === work && entry.name === ".codaryn")) await walk(full); }
      else files[path.relative(work, full).split(path.sep).join("/")] = await fs.readFile(full, "utf8");
    }
  };
  await walk(work);
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Invariants every stored run of these cases keeps, whatever its end. */
export function validate(value: Stored): void {
  const { result, records } = value;
  assert.ok(isRunId(result.runId), "$.result.runId");
  assert.equal(result.journalPath, `.codaryn/runs/${String(result.runId)}/journal.jsonl`, "$.result.journalPath");
  assert.equal(records[0]?.type, "run_started", "$.records first type");
  assert.equal(records.at(-1)?.type, "run_finished", "$.records final type");
  for (const [i, row] of records.entries()) {
    assert.equal(row.seq, i + 1, `$.records[${i}].seq`);
    assert.equal(row.runId, result.runId, `$.records[${i}].runId`);
    assert.ok(typeof row.at === "string" && ISO.test(row.at) && Number.isFinite(Date.parse(row.at)), `$.records[${i}].at`);
  }
  const usage = object(result.usage, "$.result.usage"), last = records.at(-1)!;
  assert.ok(typeof usage.durationMs === "number" && Number.isFinite(usage.durationMs) && usage.durationMs >= 0, "$.result.usage.durationMs");
  assert.deepEqual(last.usage, usage, "$.records final usage equals result");
  assert.deepEqual([last.status, last.reason], [result.status, result.reason], "$.records final status/reason");
  assert.ok(!JSON.stringify(value).includes("CODARYN_SECRET"), "no privacy token (no value is registered)");
}

/** CP53's mapping, nothing more: the fields that differ between any two runs. */
export function normalize(value: Stored): Stored {
  validate(value);
  const bundle: Stored = structuredClone({ result: value.result, records: value.records });
  bundle.result.runId = "<RUN>";
  bundle.result.journalPath = ".codaryn/runs/<RUN>/journal.jsonl";
  object(bundle.result.usage, "usage").durationMs = "<DURATION_MS>";
  for (const row of bundle.records) { row.runId = "<RUN>"; row.at = "<AT>"; }
  object(bundle.records.at(-1)!.usage, "final usage").durationMs = "<DURATION_MS>";
  return bundle;
}

export function compare(left: Stored, right: Stored): void {
  assert.deepEqual(right.records.map((r) => r.type), left.records.map((r) => r.type), "$.records kinds/order");
  assert.deepEqual(normalize(right), normalize(left), "complete stored result/journal fields");
}

/**
 * How many times a side's own folder appears in the strings of `value` (as is, with forward slashes,
 * JSON-escaped). Nothing is replaced: a quick run takes its workspace by path, and the comparison stays
 * strict, so a path that comes into a stored or sent text shows as a difference and the case asserts 0.
 * If a case ever needs the folder mapped, the mapping must also prove that no original text already
 * held the placeholder and that the mapped places are the same on both sides (no coordinate collision);
 * a plain replacement would hide a real difference (contract-review-codex-01 L1).
 */
export function sidePlaces(value: unknown, base: string): number {
  const forms = [...new Set([JSON.stringify(base).slice(1, -1), base, base.split(path.sep).join("/")])];
  let places = 0;
  const walk = (node: unknown): void => {
    if (typeof node === "string") { for (const form of forms) places += node.split(form).length - 1; }
    else if (Array.isArray(node)) node.forEach(walk);
    else if (typeof node === "object" && node !== null) for (const [key, item] of Object.entries(node)) { walk(key); walk(item); }
  };
  walk(value);
  return places;
}

/** A quick case's request fields: all but the port in `host`, `content-length` (it follows the body) and the key headers. */
export function shownRequests(list: readonly RecordedRequest[]): Obj[] {
  return list.map((r) => ({
    index: r.index, method: r.method, path: r.path, streamed: r.streamed, outcome: r.outcome, violations: r.violations,
    headers: Object.fromEntries(Object.entries(r.headers).filter(([name]) => !["host", "content-length", "x-api-key", "authorization"].includes(name))),
    body: r.body ?? r.bodyText,
  }));
}

/**
 * The two fake APIs got the same requests, compared strictly (shownRequests); the key headers are
 * compared separately by a check that never shows them.
 */
export function compareRequests(pair: PairRun): number {
  assert.ok(pair.requests !== null, "a quick case");
  assert.deepEqual(shownRequests(pair.requests.host), shownRequests(pair.requests.cli), "the same requests to each side's fake API");
  const keys = (list: readonly RecordedRequest[]): string => JSON.stringify(list.map((r) => [r.headers["x-api-key"] ?? null, r.headers["authorization"] ?? null]));
  assert.ok(keys(pair.requests.cli) === keys(pair.requests.host), "the same key headers (values not shown)");
  return pair.requests.cli.length;
}

/**
 * I1: true when the quick case's fake key value is nowhere in `value` (as JSON). A boolean, so a failed
 * check names what was checked and never the value.
 */
export function fakeKeyAbsent(value: unknown): boolean {
  assert.ok(mockParts !== null, "the fake API parts are loaded (a quick case ran)");
  return !JSON.stringify(value).includes(mockParts.key);
}

/**
 * CP53's minimized IPC projection (cli-host-parity-support assertIPC), with the fields a stored
 * result may leave out: no final message and no masking counts are null in the view
 * (src/shared/ipc.ts toFinalMessage and maskingOf), and a run that asked gets its questions' ends
 * counted from its own records (`confirmations`, src/engine-host/runs.ts). CP53's case has none of these.
 */
export function assertIPCView(actual: unknown, stored: Stored): void {
  const outcome = object(actual, "IPC outcome"), view = object(outcome.result, "IPC result"), full = stored.result;
  assert.deepEqual(Object.keys(outcome).sort(), ["ok", "result"]);
  assert.equal(outcome.ok, true);
  const usage = object(full.usage, "stored usage");
  const list = (value: unknown, at: string): unknown[] => { assert.ok(Array.isArray(value), `${at}: array`); return value; };
  const expected: Obj = {
    runId: full.runId, status: full.status, reason: full.reason, exitCode: full.exitCode,
    changes: list(full.changes, "changes").map((c) => { const row = object(c, "change"); return { path: row.path, created: row.created }; }),
    verifiers: list(full.verifiers, "verifiers").map((v, i) => ({ number: i + 1, outcome: object(v, "verifier").outcome })),
    usage: { turns: usage.modelTurns, tools: usage.toolCalls, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, durationMs: usage.durationMs },
    notices: full.notices, plan: null, review: null,
    protectedChanged: Array.isArray(full.protectedChanged) ? full.protectedChanged.length : null,
    finalMessage: full.finalMessage === undefined ? null : full.finalMessage,
    masking: full.masking === undefined ? null : full.masking,
  };
  const answered = stored.records.filter((r) => r.type === "confirmation_answered");
  if (answered.length > 0) {
    const by = (name: string): number => answered.filter((r) => r.decision !== "allow_once" && r.by === name).length;
    expected.confirmations = { allowed: answered.filter((r) => r.decision === "allow_once").length, user: by("user"), default: by("default"), cancelled: by("cancelled") };
  }
  assert.deepEqual(view, expected, "independent minimized IPC projection from same stored run");
  assert.equal(toRunResultView(actual).ok, true, "actual GUI acceptance checker");
}

/**
 * One CLI run and one separate real host run of `c`. Everything is registered for cleanup before the
 * first await on it; only the children this case started are ended, by their own handles (G-7).
 */
export async function runContractPair(t: TestContext, c: ContractCase): Promise<PairRun> {
  assert.match(c.name, /^[a-z0-9-]+$/);
  const quick = c.quick;
  assert.equal(quick === undefined, c.steps !== undefined && c.task !== undefined, "a task case or a quick case");
  assert.ok(Number(process.versions.node.split(".")[0]) >= 26, "Node26 prerequisite");
  for (const file of [CLI, HOST, path.join(ENGINE, "app", "index.js")]) assert.ok(existsSync(file), `build prerequisite: ${file}`);
  const mock = quick === undefined ? null : await mockPartsOf();
  // A terminal case asks: a quick run (a settings rule makes the question) with a host answer to compare.
  if (c.cliTerminal !== undefined) assert.ok(quick !== undefined && c.answer !== undefined && c.answer !== "dismissed", "a terminal case is a quick case with a host answer");
  const terminal = c.cliTerminal === undefined ? null : await terminalPartsOf();
  const parent = await fs.realpath(os.tmpdir());
  const base = await fs.mkdtemp(path.join(parent, `codaryn-cli-host-contract-${c.name}-`));
  assert.ok(!path.resolve(base).toLowerCase().startsWith(ROOT.toLowerCase() + path.sep), "TEMP outside installation");
  const cancelFile = path.join(base, "cli", "cancel.flag");
  let running: CliRun | null = null, host: EngineHost | null = null, token: string | null = null, hostDone = false;
  // L2 (contract-review-codex-01): a case whose time ran out goes on running after t.after. Once the
  // cleanup has begun, nothing new is started, and a host whose start ends after that is closed at once
  // (as gsec-host-support's scratch undoes what a case starts after it is over).
  let over = false;
  const live = (what: string): void => {
    if (over) throw new Error(`the case is over (its cleanup has begun): ${what} is not started`);
  };
  t.after(async () => {
    over = true;
    const errors: string[] = [];
    const attempt = async (name: string, action: () => Promise<unknown>): Promise<void> => {
      try { await action(); } catch (error) { errors.push(`${name}: ${String(error)}`); }
    };
    if (host !== null) {
      const owned = host;
      if (!hostDone && token !== null) await attempt("cancel owned host run", () => owned.call("cancelRun", { run: token }, 10_000));
      await attempt("close owned host", () => within(owned.close(), 10_000, "host cleanup"));
      if (!owned.exited) errors.push("host did not exit");
    }
    if (running !== null && !running.closed()) {
      const owned = running;
      owned.endInput(); // a question still waiting ends as no answer
      if (c.cancelAt !== undefined) {
        await fs.writeFile(cancelFile, "", "utf8").catch(() => undefined);
        await within(owned.ended, 30_000, "CLI cancel cleanup").catch(() => undefined);
      }
      if (!owned.closed()) { owned.kill(); await attempt("close owned CLI", () => within(owned.ended, 10_000, "CLI cleanup")); }
    }
    if (errors.length === 0) await attempt("remove owned sandbox", async () => {
      assert.ok(inside(parent, base) && !lstatSync(base).isSymbolicLink(), "owned sandbox");
      await fs.rm(base, { recursive: true, force: false, maxRetries: 20, retryDelay: 100 });
    });
    assert.deepEqual(errors, [], "cleanup failures (a primary test failure is reported separately)");
  });
  // Each side's own fake API (it closes itself after the case: startFakeAnthropic registers t.after).
  if (mock !== null) live("its fake APIs");
  const apis = mock === null || quick === undefined ? null : [await mock.startFakeAnthropic(t, quick.replies), await mock.startFakeAnthropic(t, quick.replies)] as const;

  const sides: { base: string; work: string; task: string | null; env: Record<string, string>; owned: Record<string, string> }[] = [];
  const baselines: Record<string, string>[] = [];
  const configs: string[] = [];
  for (const [i, name] of ["cli", "host"].entries()) {
    const dir = path.join(base, name);
    await fs.mkdir(path.join(dir, "work"), { recursive: true });
    for (const [rel, text] of Object.entries(c.files)) {
      const file = path.join(dir, "work", rel);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, text);
    }
    let task: string | null = null, env = childEnv(dir);
    const ownedFiles: string[] = [];
    if (quick === undefined) {
      task = await taskFile(dir, c.name, c.steps!, c.task!);
      ownedFiles.push(`${c.name}.json`, `${c.name}-script.json`);
    } else {
      const api = apis![i]!, config = defaultConfigFile(dir);
      await fs.mkdir(path.dirname(config), { recursive: true });
      await fs.writeFile(config, JSON.stringify(quick.config(api.url), null, 2));
      configs.push((await fs.readFile(config, "utf8")).split(api.url).join("<FAKE_API>"));
      ownedFiles.push(path.relative(dir, config));
      env = { ...env, [mock!.keyEnv]: mock!.key };
    }
    const owned: Record<string, string> = {};
    for (const file of ownedFiles) owned[file] = sha(await fs.readFile(path.join(dir, file)));
    const hashes: Record<string, string> = quick === undefined ? { ...owned } : {};
    for (const rel of Object.keys(c.files)) hashes[`work/${rel}`] = sha(await fs.readFile(path.join(dir, "work", rel)));
    baselines.push(hashes);
    sides.push({ base: dir, work: path.join(dir, "work"), task, env, owned });
  }
  assert.deepEqual(baselines[0], baselines[1], "same initial task/script/workspace bytes");
  if (quick !== undefined) assert.equal(configs[1], configs[0], "same config but each side's own fake API address");
  const cli = sides[0]!, gui = sides[1]!;

  // The CLI: its cancel file is made only after the run has started (adapter-contract 5.3).
  const cliArgs = quick === undefined ? ["run", "--task", cli.task!, "--json"] : ["run", "--workspace", cli.work, "--goal", quick.goal, "--json"];
  if (c.cancelAt !== undefined) cliArgs.push("--cancel-file", cancelFile);
  const guardLog = path.join(cli.base, "net-guard.log");
  live("its CLI"); // spawn is synchronous: `running` is set before the cleanup can run
  const cliRun = mock === null
    ? startCli(cli.base, cliArgs, cli.env, [])
    : terminal === null
      ? startCli(cli.base, cliArgs, { ...cli.env, [mock.guardEnv]: guardLog }, ["--import", mock.guardUrl])
      : startCli(cli.base, cliArgs, { ...cli.env, [mock.guardEnv]: guardLog, [TERMINAL_ENV]: "stdin,stderr" }, ["--import", mock.guardUrl, "--import", terminal.url], true);
  running = cliRun;
  if (c.cancelAt !== undefined) {
    await reach(cli.work, c.cancelAt, () => !cliRun.closed(), "CLI");
    await fs.writeFile(cancelFile, "", { encoding: "utf8", flag: "wx" });
  }
  // C-5 to C-7: what the CLI's terminal types at each question it writes on stderr: each answer goes
  // once its question is there (stderr is looked at every 25 ms), and "none" types nothing at all.
  let cliQuestions = 0;
  const typing = terminal === null ? Promise.resolve() : (async () => {
    while (!cliRun.closed()) {
      const asked = cliRun.stderrNow().split(terminal.questionLead).length - 1;
      for (; cliQuestions < asked; cliQuestions += 1) {
        if (c.cliTerminal === "deny") cliRun.type("n\n");
        else if (c.cliTerminal === "interrupt") cliRun.type("\u0003");
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  })();
  const cliEnd = await within(cliRun.ended, 60_000, "CLI completion");
  await typing;
  cliRun.endInput();
  if (mock !== null) assert.equal(existsSync(guardLog) ? readFileSync(guardLog, "utf8") : "", "", "the CLI reached no host but loopback");
  const cliJson = object(JSON.parse(cliEnd.stdout), "whole CLI stdout");
  const cliStored = await readStored(cli.work, cliJson.runId);
  assert.deepEqual(cliJson, cliStored.result, "whole CLI stdout equals stored result");

  // The separate real host, started and asked as the main process does.
  live("its host");
  const started = await startEngineHost({ nodePath: process.execPath, hostScript: HOST, engineDir: ENGINE, env: gui.env, cwd: gui.base, transport: "loopback-only" });
  if (started.ok && over) {
    // The cleanup ran while this host was starting and could not see it: close it here.
    await within(started.host.close(), 10_000, "late host close").catch(() => undefined);
    throw new Error(`the case is over: the host that started late is closed (exited: ${String(started.host.exited)})`);
  }
  assert.ok(started.ok, `real host startup: ${JSON.stringify(started)}`);
  const owned = started.host;
  host = owned;
  assert.notEqual(owned.pid, process.pid, "host is a separate process");
  const messages: HostRunMessage[] = [], collectorErrors: string[] = [], questions: string[] = [], questionsEnded: string[] = [];
  const answering: ReturnType<EngineHost["call"]>[] = [];
  const done = Promise.withResolvers<unknown>();
  done.promise.catch(() => undefined);
  owned.onRunMessage((message) => {
    try {
      messages.push(message);
      if (message.type === "events") assert.notEqual(parseRunItems(message.items), null, "IPC events parse");
      if (message.type === "question") {
        if (c.answer === undefined) throw new Error("unexpected question message");
        questions.push(message.question.id);
        // "none" answers nothing; "cancel" cancels the run while the question is open (handle.cancel, AC 5.3).
        const sent = c.answer === "none" ? null
          : c.answer === "cancel" ? owned.call("cancelRun", { run: message.run }, 10_000)
          : owned.call("answerQuestion", { run: message.run, id: message.question.id, decision: c.answer }, 10_000);
        if (sent !== null) {
          sent.catch(() => undefined);
          answering.push(sent);
        }
      }
      if (message.type === "questionEnded") {
        // Only the run's signal ends a question on the host's side (a cancel, or the time limit).
        if (c.answer !== "cancel" && c.answer !== "none") throw new Error("unexpected questionEnded message");
        questionsEnded.push(message.id);
      }
      if (message.type === "done") { hostDone = true; done.resolve(message.outcome); }
    } catch (error) { collectorErrors.push(String(error)); done.reject(error); }
  });
  const response = quick === undefined
    ? await owned.call("startTaskRun", { taskPath: gui.task, varsFile: null, language: "en" }, 60_000)
    : await owned.call("startRun", { workspace: gui.work, goal: quick.goal, profile: null, workflowRef: null, language: "en" }, 60_000);
  assert.ok(response.ok, `start envelope: ${JSON.stringify(response)}`);
  const value = object(response.value, "host start value");
  assert.equal(value.ok, true, `host start value.ok: ${JSON.stringify(value)}`);
  assert.ok(typeof value.run === "string" && RUN_TOKEN_PATTERN.test(value.run), "transport run token");
  token = value.run;
  if (c.cancelAt !== undefined) {
    await reach(gui.work, c.cancelAt, () => !hostDone, "host");
    const cancelled = await owned.call("cancelRun", { run: token }, 10_000);
    assert.ok(cancelled.ok, JSON.stringify(cancelled));
    assert.deepEqual(cancelled.value, { ok: true }, "the host took the cancel");
  }
  const ipc = await within(done.promise, 60_000, "host done");
  for (const answered of await Promise.all(answering)) {
    assert.ok(answered.ok, JSON.stringify(answered));
    assert.deepEqual(answered.value, { ok: true }, "the host took the answer (or the cancel)");
  }
  const hostStored = await readStored(gui.work, value.runId);
  if (mock !== null) {
    const transport = await owned.call("transport", {}, 10_000);
    assert.ok(transport.ok, JSON.stringify(transport));
    assert.deepEqual(transport.value, { mode: "loopback-only", refused: 0 }, "the host reached no host but loopback");
  }
  await within(owned.close(), 10_000, "normal host close");
  assert.equal(owned.exited, true);
  assert.deepEqual(collectorErrors, [], "listener failures are asserted outside callbacks");
  assert.equal(messages.filter((m) => m.type === "done").length, 1, "one done");
  assert.ok(messages.every((m) => m.run === token), "all IPC messages route to the start token");

  for (const side of sides) {
    for (const [file, hash] of Object.entries(side.owned)) assert.equal(sha(await fs.readFile(path.join(side.base, file))), hash, `unchanged fixture ${file}`);
  }
  return {
    cli: { ...cliStored, workspace: await snapshot(cli.work) },
    host: { ...hostStored, workspace: await snapshot(gui.work) },
    cliExit: { code: cliEnd.code, signal: cliEnd.signal },
    ipc,
    messages,
    bases: { cli: cli.base, host: gui.base },
    questions,
    questionsEnded,
    cliQuestions,
    requests: apis === null ? null : { cli: [...apis[0].requests], host: [...apis[1].requests] },
  };
}
