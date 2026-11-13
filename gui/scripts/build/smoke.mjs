// Runs the GU-1/GU-2 smoke test (tests/smoke/smoke.ts) in the real Electron and checks what it saw.
// The app gets a clean environment (the fixtures' fake API key, a config file pointing at a loopback
// fake API that this script runs, this Node 26+
// as the engine host's Node, DR-26), a fresh Chromium profile and a fresh gui-state.json. Two
// workspaces are made in the temporary folder and removed afterwards. Needs `npm run build` here
// and in the repository root.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const gui = fileURLToPath(new URL("../../", import.meta.url));
const electron = join(gui, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
const result = join(gui, "build", "smoke-result.json");
const profile = join(gui, "build", "smoke-profile");
const stateDir = join(gui, "build", "smoke-state");

if (!existsSync(electron)) {
  process.stderr.write("gui smoke: the Electron binary is missing (node node_modules/electron/install.js)\n");
  process.exit(1);
}

// A name with the shape of an API key, built here so no source file holds one. Fake value.
const KEY_SHAPED = ["sk", "ant", "FAKE".repeat(10)].join("-");

// GU-6 onward: a fake Anthropic API on a loopback port (the root build's test fake; never the real
// API), the fixtures' fake key, and a config file that points the app at the fake.
const rootDist = join(gui, "..", "dist");
const fromRoot = (...parts) => import(pathToFileURL(join(rootDist, ...parts)).href);
const fakeApi = await fromRoot("tests", "support", "fake-anthropic.js");
const fakeModels = await fromRoot("tests", "support", "fake-models.js");
const { FAKE_API_KEY, FAKE_OPENAI_KEY } = await fromRoot("tests", "fixtures", "secrets.js");
const { ANTHROPIC_API_KEY_ENV, API_PROVIDERS } = await fromRoot("src", "contracts", "index.js");
const { KO_MESSAGES } = await fromRoot("src", "i18n", "ko.js");
/**
 * U-40 (DR-52): a masking line shown right after the usage, with the CLI's summary.masking words and
 * the two counts the run's result.json recorded (at least one value registered: the fake keys).
 */
const maskingShown = (v) =>
  v !== null &&
  v.line !== null &&
  v.line.after === true &&
  v.recorded !== null &&
  Number.isSafeInteger(v.recorded.registeredValues) &&
  v.recorded.registeredValues >= 1 &&
  Number.isSafeInteger(v.recorded.maskedPlaces) &&
  v.recorded.maskedPlaces >= 0 &&
  v.line.text === KO_MESSAGES["summary.masking"].replace("{registered}", String(v.recorded.registeredValues)).replace("{masked}", String(v.recorded.maskedPlaces));
const closeFake = [];
// Model answers in order: a run that creates a file and ends; a run that hangs (cancelled from the
// window); a run that hangs (cancelled by closing the window).
// U-54 (R-65 L-1): an id the engine cannot keep ("bad id", a space) is replaced in each run, from
// codaryn-call-1 again. The first run's call with it is denied (a path outside the workspace); the
// analyze run's call with it, later in the same window, fails (not_found) and must still get its line.
// No model request is added: the two calls ride in replies the runs already had.
const U54_ID = "bad id";
const steps = [
  fakeApi.replyTools([
    fakeApi.toolUse("toolu_smoke_1", "write_file", { path: "made.txt", expectedHash: null, change: { kind: "replace_all", content: "made by the smoke run\n" } }),
    fakeApi.toolUse(U54_ID, "read_file", { path: "../outside-u54.txt" }),
  ]),
  fakeApi.replyText("done"),
  { kind: "hang" },
  fakeApi.replyTools([fakeApi.toolUse("toolu_smoke_plan_a", "propose_plan", { summary: "a.txt to moved", actions: [{ kind: "move", from: "a.txt", to: "moved/a.txt" }] })]),
  fakeApi.replyTools([fakeApi.toolUse("toolu_smoke_plan_b", "propose_plan", { summary: "sub/b.txt to moved", actions: [{ kind: "move", from: "sub/b.txt", to: "moved/b.txt" }] })]),
  fakeApi.replyTools([
    fakeApi.toolUse("toolu_smoke_report", "write_file", { path: "report.md", expectedHash: null, change: { kind: "replace_all", content: "결과 표\n해석\n" } }),
    fakeApi.toolUse("toolu_smoke_notes", "write_file", { path: "notes.md", expectedHash: null, change: { kind: "replace_all", content: "메모\n" } }),
    fakeApi.toolUse(U54_ID, "read_file", { path: "missing-u54.txt" }),
  ]),
  fakeApi.replyText("analysis written"),
  // U-13: a plan run that discards a file; its apply's discarded files stay through a cleanup.
  fakeApi.replyTools([fakeApi.toolUse("toolu_smoke_plan_c", "propose_plan", { summary: "discard sub/deeper/c.txt", actions: [{ kind: "discard", path: "sub/deeper/c.txt" }] })]),
  { kind: "hang" },
];
const api = await fakeApi.startFakeAnthropic({ after: (fn) => closeFake.push(fn) }, steps, {
  models: { models: [fakeModels.fakeModel("fake-model-a"), fakeModels.fakeModel("fake-model-b")] },
});
const configDir = join(gui, "build", "smoke-config");
rmSync(configDir, { recursive: true, force: true });
mkdirSync(configDir, { recursive: true });
const configFile = join(configDir, "config.json");
writeFileSync(
  configFile,
  JSON.stringify({
    schemaVersion: 1,
    model: "fake-model-a",
    maxOutputTokens: 1024,
    apiBaseUrl: api.url,
    requestTimeoutMs: 20000,
    maxRetries: 0,
    limits: { maxModelTurns: 6, maxToolCalls: 10, maxTotalTokens: 100000, maxDurationMs: 120000 },
    profiles: { doc: { limits: { maxModelTurns: 5 } }, tidy: { workflowRef: "organize" } },
  }),
);

const first = mkdtempSync(join(tmpdir(), "codaryn-smoke-one-"));
writeFileSync(join(first, "first.txt"), "one");
const second = mkdtempSync(join(tmpdir(), "codaryn-smoke-two-"));
writeFileSync(join(second, "a.txt"), "alpha");
mkdirSync(join(second, "sub", "deeper"), { recursive: true });
writeFileSync(join(second, "sub", "b.txt"), "bravo");
writeFileSync(join(second, "sub", "deeper", "c.txt"), "charlie");
mkdirSync(join(second, ".codaryn", "runs"), { recursive: true });
writeFileSync(join(second, `${KEY_SHAPED}.txt`), "fake");
let junction = true;
try {
  symlinkSync(join(second, "sub"), join(second, "link-to-sub"), "junction");
} catch {
  junction = false;
}

const env = {};
for (const [name, value] of Object.entries(process.env)) {
  if (value === undefined) continue;
  // Every provider's key, model and address variable of this machine stays out, and every Codaryn variable.
  const providerVariables = Object.values(API_PROVIDERS).flatMap((spec) => [spec.keyEnv, spec.modelEnv, spec.baseUrlEnv]);
  if (providerVariables.some((known) => known.toUpperCase() === name.toUpperCase())) continue;
  if (/^(ANTHROPIC_API_KEY|OPENAI_API_KEY|CODARYN_[A-Z0-9_]+|NODE_OPTIONS|NODE_PATH|ELECTRON_RUN_AS_NODE|npm_node_execpath)$/i.test(name)) continue;
  env[name] = value;
}
env.CODARYN_CONFIG = configFile;
// The fixtures' fake key, as the root tests set it (tests/support/cli.ts).
env[ANTHROPIC_API_KEY_ENV] = FAKE_API_KEY;
// The fixtures' fake OpenAI key: the settings screen shows that it is set, never its value. Runs here
// stay on anthropic; the engine host's test transport reaches this machine only, for every provider.
env[API_PROVIDERS.openai.keyEnv] = FAKE_OPENAI_KEY;
env.npm_node_execpath = process.execPath;
env.CODARYN_SMOKE_SECOND = second;
// U-11: the default config location (N-1: %APPDATA%\Codaryn, else $XDG_CONFIG_HOME/codaryn) of the app's
// engine host is a folder of this test. createSettings writes there, never into this machine's own.
const sandboxAppData = join(gui, "build", "smoke-appdata");
rmSync(sandboxAppData, { recursive: true, force: true });
mkdirSync(sandboxAppData, { recursive: true });
const realDefaultConfig = process.platform === "win32" && process.env.APPDATA ? join(process.env.APPDATA, "Codaryn", "config.json") : null;
const realDefaultBefore = realDefaultConfig !== null && existsSync(realDefaultConfig) ? statSync(realDefaultConfig).mtimeMs : null;
env.APPDATA = sandboxAppData;
env.XDG_CONFIG_HOME = sandboxAppData;
// R29-L1: how many model requests the fake API has received, for the app's steps that cancel or close
// a run: they wait until that run's request arrived (a file on this machine, rewritten every 50 ms).
const apiCountFile = join(gui, "build", "smoke-api-count.json");
// U-51: each count is written whole to a temporary file and renamed over the count file, so a read
// never meets a file half written (written in place, the file is emptied first: the app read -1 and
// its 5d step waited for a request that had arrived). Renaming over the file while the app has it
// open fails on Windows (EPERM): the count file then keeps the last whole count, and the next write,
// 50 ms later, tries again. A count can be a tick late, never wrong or unreadable.
const apiCountTemp = `${apiCountFile}.tmp`;
const apiCountWrites = { replaced: 0, retried: 0 };
const apiMessages = () => api.requests.filter((request) => request.method === "POST" && request.path.split("?")[0] === "/v1/messages").length;
const writeApiCount = () => {
  try {
    writeFileSync(apiCountTemp, JSON.stringify({ messages: apiMessages() }));
    renameSync(apiCountTemp, apiCountFile);
    apiCountWrites.replaced += 1;
  } catch {
    apiCountWrites.retried += 1;
  }
};
// The first count, before the app starts: nothing reads it yet, so it is written in place.
rmSync(apiCountTemp, { force: true });
writeFileSync(apiCountFile, JSON.stringify({ messages: apiMessages() }));
env.CODARYN_SMOKE_API_COUNT = apiCountFile;

// R-10 L-4: a link inside the built renderer to a folder outside it (the temporary folder, on
// another drive than the build here) with a script the page will try to import.
const outside = mkdtempSync(join(tmpdir(), "codaryn-smoke-outside-"));
writeFileSync(join(outside, "probe.js"), "export const probe = 1;\n");
const outsideLink = join(gui, "build", "src", "renderer", "outside-link");
rmSync(outsideLink, { recursive: true, force: true });
let outsideLinked = true;
try {
  symlinkSync(outside, outsideLink, "junction");
} catch {
  outsideLinked = false;
}

for (const target of [result, profile, stateDir, join(gui, "build", "smoke-report")]) rmSync(target, { recursive: true, force: true });
// Started without blocking: the fake API in this process must answer while the app runs.
const apiCountTimer = setInterval(writeApiCount, 50);
const run = await new Promise((resolve) => {
  const child = spawn(electron, [join(gui, "build", "tests", "smoke", "smoke.js"), first], { cwd: gui, env, stdio: "inherit" });
  const timer = setTimeout(() => child.kill(), 240_000);
  child.on("error", (error) => {
    clearTimeout(timer);
    resolve({ status: null, error });
  });
  child.on("exit", (status) => {
    clearTimeout(timer);
    resolve({ status, error: undefined });
  });
});
clearInterval(apiCountTimer);
rmSync(apiCountFile, { force: true });
rmSync(apiCountTemp, { force: true });
const realDefaultAfter = realDefaultConfig !== null && existsSync(realDefaultConfig) ? statSync(realDefaultConfig).mtimeMs : null;
const sandboxMade = existsSync(join(sandboxAppData, "Codaryn", "config.json"));
const apiRequestRows = api.requests.map((request) => ({ path: request.path.split("?")[0], method: request.method, key: request.headers["x-api-key"] === FAKE_API_KEY }));
const apiRequests = {
  models: apiRequestRows.filter((r) => r.path.startsWith("/v1/models") && r.method === "GET").length,
  messages: apiRequestRows.filter((r) => r.path === "/v1/messages" && r.method === "POST").length,
  other: apiRequestRows.filter((r) => !((r.path.startsWith("/v1/models") && r.method === "GET") || (r.path === "/v1/messages" && r.method === "POST"))),
  allFakeKey: apiRequestRows.every((r) => r.key === true),
};
for (const close of closeFake) await close();
let configModel = null;
try {
  configModel = JSON.parse(readFileSync(configFile, "utf8")).model ?? null;
} catch {
  configModel = "unreadable";
}
for (const dir of [first, second]) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
// The link itself is removed, not what it points to; then the folder it pointed to.
try {
  rmSync(outsideLink, { force: true });
} catch {
  // A junction removed as a file can fail on some systems; the build directory is rebuilt anyway.
}
rmSync(outside, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
if (!existsSync(result)) {
  process.stderr.write(`gui smoke: no result (exit ${run.status}, ${run.error?.message ?? "no error"})\n`);
  process.exit(1);
}
const seen = JSON.parse(readFileSync(result, "utf8"));
const [firstName, secondName] = [basename(first), basename(second)];
const rows = (value) => (Array.isArray(value) ? value : []);
/**
 * U-13 (5j2): the plan's apply, then three cleanups of its apply run: its records only; its records
 * and discarded files with "keep them" in the third dialog (R47-I4); both, deleted.
 */
const U13_DIALOGS = [
  "apply.message",
  ...["cleanup.message", "cleanup.notReverted.message"],
  ...["cleanup.message", "cleanup.notReverted.message", "cleanup.discarded.message"],
  ...["cleanup.message", "cleanup.notReverted.message", "cleanup.discarded.message"],
];
/** U-22 (5j3, Windows only): the cleanup of the analyze run's records while one of its files is held open. */
const U22_DIALOGS = process.platform === "win32" ? ["cleanup.message", "cleanup.notReverted.message"] : [];
// U-62: copyText joined the page's functions (a run id or a digest's first 12 only; no path, R-73).
// U-63: startTaskRun joined them (no path argument; the main process's dialogs choose the files).
const API = "applyCleanup,applyPlan,applySettings,cancelRun,changes,copyPath,copyText,createSettings,doctor,forgetRecent,info,listModels,listRuns,onEngineState,onRunDone,onRunEvents,onWorkspaceOpened,openFolder,openRecent,plan,previewCleanup,previewRevert,proposeSettings,recent,report,restartEngine,reveal,revert,revertConsent,review,saveReport,selectModel,settings,settingsSuggestions,startRun,startTaskRun,stateSummary,tree";
seen.apiRequests = apiRequests;
seen.discardLeftStatuses = ["discardLeftKept", "discardLeftKeepBox", "discardLeftBoth"].map((key) => seen[key]?.status ?? null);
seen.setupSandbox = { made: sandboxMade, realUntouched: realDefaultAfter === realDefaultBefore };
seen.configModel = configModel;

const expected = [
  ["initialTree", (v) => v === "ok"],
  ["initialWorkspace", (v) => typeof v === "string" && v.includes(firstName)],
  ["initialRows", (v) => rows(v).length === 1 && rows(v)[0].text.includes("first.txt")],
  ["secondOpened", (v) => v === true],
  ["secondTree", (v) => v === "ok"],
  ["networkFolder", (v) => JSON.stringify(v) === JSON.stringify({ ok: false, code: "workspace_not_local" })],
  [
    "secondRows",
    (v) => {
      const kinds = rows(v).map((row) => row.kind);
      const masked = rows(v).filter((row) => row.masked === "true");
      return (
        kinds.includes("state") &&
        kinds.includes("dir") &&
        kinds.includes("file") &&
        (!junction || kinds.includes("link")) &&
        rows(v).filter((row) => row.kind === "link").every((row) => row.expanded === null) &&
        masked.length === 1 &&
        !masked[0].text.includes("FAKE")
      );
    },
  ],
  ["expanded", (v) => v === "ok"],
  ["keyboard", (v) => v.moved === true && v.inTree === true],
  ["treeText", (v) => typeof v === "string" && !v.includes(FAKE_API_KEY) && !v.includes(FAKE_OPENAI_KEY) && !v.includes("FAKEFAKE") && !v.includes(second)],
  ["recentShown", (v) => v === "2"],
  ["recentNames", (v) => JSON.stringify(v) === JSON.stringify([secondName, firstName])],
  ["recentText", (v) => typeof v === "string" && v.length > 0 && !v.includes(FAKE_API_KEY) && !v.includes(FAKE_OPENAI_KEY) && !v.includes(first) && !v.includes(second) && !v.includes(tmpdir())],
  ["stateFile", (v) => JSON.stringify(v) === JSON.stringify([secondName, firstName])],
  ["checks", (v) => v === "ok"],
  ["checksShown", (v) => typeof v === "number" && v >= 5],
  ["url", (v) => v === "app://codaryn/index.html"],
  ["renderer", (v) => v.process === "undefined" && v.require === "undefined" && v.ipcRenderer === "undefined" && v.module === "undefined" && v.api === API],
  // U-103 (G-list, 3.3): the masked name has no id; plain paths copied by id, top and nested; other ids, a path string and another workspace refused.
  [
    "treeCopyPath",
    (v) =>
      JSON.stringify(v) ===
      JSON.stringify({ masked: [null], top: "copied", nested: "copied", unknown: "unknown_entry", pathString: "invalid_args", otherWorkspace: "unknown_workspace", button: "ok", texts: ["a.txt", "sub/b.txt", "a.txt"] }),
  ],
  ["treePathString", (v) => v.ok === false && v.code === "invalid_args"],
  ["treeUnknownNode", (v) => v.ok === false && v.code === "unknown_entry"],
  ["revealUnknown", (v) => v === false],
  ["doctorWithPath", (v) => v.ok === false && v.code === "invalid_args"],
  ["linkedScript", (v) => !outsideLinked || v === "blocked"],
  ["fetchHttp", (v) => v === "blocked"],
  ["fetchFile", (v) => v === "blocked"],
  ["windowOpen", (v) => v === "blocked"],
  ["urlAfterNavigation", (v) => v === "app://codaryn/index.html"],
  ["hostNode", (v) => typeof v === "string" && Number(v.split(".")[0]) >= 26],
  // GU-6: the settings screen, the model list (asked for, from the fake API) and a model choice.
  ["settingsReady", (v) => v === "ok"],
  // N-14: a file the environment names is shown by the variable name, not its path.
  ["settingsFile", (v) => v.source === "environment" && typeof v.text === "string" && v.text.includes("CODARYN_CONFIG") && !v.text.includes("smoke-config")],
  ["settingsProfiles", (v) => JSON.stringify(v) === JSON.stringify(["doc", "tidy"])],
  ["settingsKey", (v) => v === "available"],
  ["settingsText", (v) => typeof v === "string" && !v.includes(FAKE_API_KEY) && !v.includes(FAKE_OPENAI_KEY) && !v.includes(api.url)],
  ["modelsBeforeAsking", (v) => v === 0],
  ["modelsListed", (v) => v === "2"],
  ["modelChosen", (v) => v === "fake-model-b"],
  ["modelForgedEntry", (v) => v.ok === false && v.code === "unknown_entry"],
  ["modelIdAsEntry", (v) => v.ok === false && v.code === "invalid_args"],
  // GU-6 (3.10, 6.6): settings changes by the main process's token; widening asked first.
  // DR-41: the screen says the config's rules are merged with each task kind's own.
  ["settingsPolicyMerge", (v) => v === true],
  ["settingsNarrow", (v) => v === "ready"],
  ["settingsNarrowWritten", (v) => JSON.stringify(v) === JSON.stringify(["notes/private.md"])],
  ["settingsNarrowDialogs", (v) => v === 0],
  ["settingsWiden", (v) => v === "widens"],
  ["settingsWidenKinds", (v) => JSON.stringify(v) === JSON.stringify(["command_added"])],
  ["settingsWidenNarrowings", (v) => JSON.stringify(v) === JSON.stringify([["organize", "commands_dropped"]])],
  ["settingsWidenRefused", (v) => v === "not_confirmed"],
  ["settingsAfterRefusal", (v) => v === 0],
  ["settingsWidenWritten", (v) => JSON.stringify(v) === JSON.stringify(["node --version"])],
  ["settingsWidenDialogs", (v) => v === 2],
  ["settingsWholeConfig", (v) => v.ok === false && v.code === "invalid_args"],
  ["settingsForgedToken", (v) => v.ok === false && v.code === "unknown_proposal"],
  ["settingsTokenOnce", (v) => JSON.stringify(v) === JSON.stringify([true, "unknown_proposal"])],
  ["settingsSecretRemoval", (v) => v === "widens"],
  ["settingsSecretRemoved", (v) => v === true],
  ["settingsSecretDialogs", (v) => v === 1],
  [
    "settingsOnDisk",
    (v) =>
      v.model === "fake-model-b" &&
      JSON.stringify(v.commands) === JSON.stringify([{ executable: "node", argsPrefix: ["--version"], allowExtraArgs: false }]) &&
      JSON.stringify(v.protectedPaths) === JSON.stringify(["notes/private.md"]) &&
      JSON.stringify(v.secretEnv) === "[]",
  ],
  ["settingsChangeText", (v) => typeof v === "string" && !v.includes(FAKE_API_KEY) && !v.includes(FAKE_OPENAI_KEY) && !v.includes("smoke-config")],
  // PM task (2): the provider choice; keys set or not by name, never a value; the list only for the provider in use.
  ["providerRows", (v) => JSON.stringify(v) === JSON.stringify([["anthropic", "set"], ["openai", "set"]])],
  ["providerInUse", (v) => v === "anthropic"],
  // F-3 (app layer): a change of provider is a widening; the main process asks first.
  ["providerProposal", (v) => v === "widens"],
  ["providerWidenKinds", (v) => JSON.stringify(v) === JSON.stringify(["provider_changed"])],
  // F-1 (app layer): each provider has its own model list button.
  ["providerOpenai", (v) => JSON.stringify(v) === JSON.stringify({ inUse: "openai", lists: 2, noList: false })],
  ["providerBack", (v) => JSON.stringify(v) === JSON.stringify({ inUse: "anthropic", lists: 2, noList: false })],
  ["providerText", (v) => typeof v === "string" && v.includes(API_PROVIDERS.openai.keyEnv) && !v.includes(FAKE_OPENAI_KEY) && !v.includes(FAKE_API_KEY)],
  ["providerOnDisk", (v) => v === "anthropic"],
  ["configModel", (v) => v === "fake-model-b"],
  // Models are listed (GET), runs ask for answers (POST); every request carries the fake key only.
  [
    "apiRequests",
    // U-13's plan run (5j2) asks once more: 8 before it.
    (v) => v.models >= 2 && v.messages === 9 && v.other.length === 0 && v.allFakeKey === true,
  ],
  // GU-3: a run from the new task screen, a cancel from the window, and closing during a run.
  ["runDone", (v) => v === "done"],
  ["runResult", (v) => v !== null && ["done", "needs-input"].includes(v.status) && /^\d{8}T\d{6}Z-[0-9a-f]{8}$/.test(v.runId)],
  ["runLog", (v) => rows(v).length >= 2 && rows(v).includes("tool_decision")],
  // U-54 (R-65 L-1): the first run denied a call the engine recorded as codaryn-call-1, and its log says so.
  ["firstRunDenied", (v) => v !== null && v.denied >= 1 && JSON.stringify(v.call) === JSON.stringify({ decision: false, result: false })],
  ["runCounts", (v) => typeof v === "string" && /(도구 호출|tool calls) [1-9]/.test(v)],
  // U-21 (DR-47): the agent's last message, under the label that says it is its own words.
  ["runFinalMessage", (v) => JSON.stringify(v) === JSON.stringify({ label: "에이전트의 마지막 답(에이전트의 말이며 검증된 사실이 아님)", text: "done", cut: false })],
  // U-40 (DR-52): the masking counts at the run's end, as the CLI's end summary shows them.
  ["runMasking", maskingShown],
  ["runText", (v) => typeof v === "string" && !v.includes(FAKE_API_KEY) && !v.includes(FAKE_OPENAI_KEY) && !v.includes(second) && !v.includes(api.url)],
  ["runAgainWhileIdle", (v) => v === false],
  // U-65 (3.3): after the run, the tree marks the file it made; choosing it opens its comparison at that file.
  ["treeMarks", (v) => v?.made === "made.txt" && v.note === true],
  // U-66 (3.4): side by side (one table, the created file's lines on the right), wrapping off, show in folder recorded with the file's name; then back to the defaults.
  [
    "changesViews",
    (v) =>
      JSON.stringify(v) ===
      JSON.stringify({ side: { view: "side", tables: 1, columns: 0, hunks: 1, first: ["none", "added"] }, wrap: "off", status: "ok", shown: ["made.txt"], back: ["column", "on"] }),
  ],
  ["treeOpensChange", (v) => JSON.stringify(v) === JSON.stringify({ ready: "1", focus: "0", focused: "made.txt" })],
  // U-65: F5 reads the tree again; the protected path setup added is marked, with its note.
  ["treeProtected", (v) => JSON.stringify(v) === JSON.stringify({ before: 0, marked: "package.json", note: true })],
  // U-64 (3.12, 4.4): the engine ended: its card, calls fail, no restart on its own; the button starts a new host; no second restart while it runs.
  [
    "engineRestart",
    (v) =>
      JSON.stringify(v) ===
      JSON.stringify({ card: "shown", whileEnded: "adapter_host_exited", stillEnded: "adapter_host_exited", ready: "ready", newHost: true, cardHidden: true, doctorAfter: "ok", again: "engine_running" }),
  ],
  // U-63 (3.5, GUI-D8): a task file's run with a variables file, its next steps in the open workspace; a closed dialog and a task file inside its workspace start nothing.
  [
    "taskFileRun",
    (v) =>
      v !== null &&
      v.cancelled?.ok === false &&
      v.cancelled.code === "cancelled" &&
      v.inside?.ok === false &&
      typeof v.inside.code === "string" &&
      v.inside.code !== "cancelled" &&
      v.done === "done" &&
      v.result !== null &&
      v.place === "open" &&
      v.answersLeft === 0 &&
      v.pathsOnPage === false,
  ],
  // U-62 (6.4, R-73): copies go through the main process: a run id or a digest's first 12, nothing else.
  ["copyRunId", (v) => v !== null && v.status === "ok" && typeof v.runId === "string" && v.copied === v.runId],
  [
    "copyRefused",
    (v) =>
      JSON.stringify(v) ===
      JSON.stringify({ keyShape: "invalid_args", keyValue: "invalid_args", path: "invalid_args", words: "invalid_args", digestUpper: "invalid_args", lineBreak: "invalid_args", written: 0 }),
  ],
  ["copyDigest", (v) => v !== null && v.status === "ok" && typeof v.copied === "string" && /^[0-9a-f]{12}$/.test(v.copied) && v.summary.includes(v.copied)],
  // U-61 (3.12): a result that changed files offers the revert preview; it opens on the run list.
  ["revertFromResult", (v) => v !== null && v.offered === true && v.preview === "1" && typeof v.title === "string" && typeof v.runId === "string" && v.title.includes(v.runId)],
  ["cancelReady", (v) => v === "ready"],
  ["secondStartRefused", (v) => v.ok === false && v.code === "run_active"],
  ["cancelAsked", (v) => v === true],
  ["cancelDone", (v) => v === "cancelled"],
  // GU-4: the run list, a revert preview, refused requests, and the revert the main process asked about.
  ["runsListed", (v) => v === "2"],
  ["runsRows", (v) => rows(v).length === 2 && rows(v).every((r) => r.state === "checked")],
  ["revertPreview", (v) => v === "1"],
  ["revertPreviewActions", (v) => JSON.stringify(v) === JSON.stringify(["deleted"])],
  ["madeBeforeRevert", (v) => v === true],
  ["revertForged", (v) => v.ok === false && v.code === "unknown_preview"],
  ["previewLatest", (v) => v.ok === false && v.code === "invalid_args"],
  ["previewUnlisted", (v) => v.ok === false && v.code === "unknown_run"],
  ["revertDone", (v) => v === "complete"],
  ["madeAfterRevert", (v) => v === false],
  ["revertNoConsentOffer", (v) => v === true],
  ["revertConsentForged", (v) => v.ok === false && v.code === "unknown_retry"],
  // DR-29: paths and states only; the file's content never shows.
  ["changesShown", (v) => v === "1"],
  ["changesRows", (v) => rows(v).length === 1 && rows(v)[0].state === "missing" && rows(v)[0].created === "true" && rows(v)[0].text === "none" && rows(v)[0].path === "made.txt"],
  ["changesText", (v) => typeof v === "string" && !v.includes(FAKE_API_KEY) && !v.includes(FAKE_OPENAI_KEY) && !v.includes("made by the smoke run")],
  ["changesLatest", (v) => v.ok === false && v.code === "invalid_args"],
  // GU-5: a plan run, the plan screen, refused requests, an apply the main process asked about, a review.
  // R-14 L-3, R21-M-1: a plan whose task kind was chosen directly is shown and applied through the task form's workflowRef.
  ["directPlanShown", (v) => v === "pending"],
  // U-32 (U-14 AXM-15): the model's summary under the agent's-words label, after the actions, as the engine drew it.
  ["planAgentWords", (v) => v !== null && typeof v.label === "string" && /agent's own words|에이전트의 말/.test(v.label) && v.text === "a.txt to moved" && v.afterActions === true],
  ["applyByWorkflow", (v) => v !== null && v.applied === 1 && v.reason !== "consent_required" && v.reason !== "plan_stale"],
  ["applyByWorkflowMoved", (v) => v.from === false && v.to === true],
  ["planRun", (v) => v === "plan_pending"],
  ["planShown", (v) => v === "pending"],
  // R21b-L-1: opened from the run list with the remembered form, so it can be applied there.
  ["planFromList", (v) => v.apply === true && v.unknown === false],
  [
    "stateForms",
    (v) =>
      JSON.stringify(v) ===
      JSON.stringify([
        ["B", "tidy", null],
        ["A", null, "organize"],
      ]),
  ],
  ["planActions", (v) => JSON.stringify(v) === JSON.stringify(["move"])],
  ["planForged", (v) => v.ok === false && v.code === "unknown_plan"],
  ["consentUnasked", (v) => v.ok === false && v.code === "consent_not_asked"],
  ["applyDone", (v) => v !== null && v.applied === 1 && v.reason !== "consent_required" && v.reason !== "plan_stale"],
  // U-61 (U-16): both applied plans say so in the run list.
  ["planApplyInList", (v) => JSON.stringify(v) === JSON.stringify(["applied", "applied"])],
  ["applyMoved", (v) => v.from === false && v.to === true],
  ["reviewRun", (v) => v === "awaiting_review"],
  ["reviewAsked", (v) => v === true],
  ["reviewRecorded", (v) => v === "accepted"],
  // DR-29, DR-32 (c): the write recorded its digests, the same secrets mask it now: the text is compared.
  ["reportChanges", (v) => v === "2"],
  // Per file: report.md is still what the run left (its text); notes.md changed after the run (path and state only).
  [
    "changesPerFile",
    (v) =>
      JSON.stringify(v) ===
      JSON.stringify([
        { path: "report.md", state: "as_run_left", text: "shown", hidden: false },
        { path: "notes.md", state: "changed_since_run", text: "none", hidden: true },
      ]),
  ],
  ["changesPerFileText", (v) => typeof v === "string" && !v.includes(FAKE_API_KEY) && !v.includes(FAKE_OPENAI_KEY) && !v.includes("changed after the run") && !v.includes("메모")],
  ["reportDiff", (v) => v !== null && v.text === "shown" && JSON.stringify(v.kinds) === JSON.stringify(["added", "added"]) && JSON.stringify(v.lines) === JSON.stringify(["결과 표", "해석"])],
  ["reportF7", (v) => v === true],
  // GU-3 (3.7): reports from a result and from the run list.
  ["reportReady", (v) => v === "run"],
  ["reportTabs", (v) => JSON.stringify(v) === JSON.stringify(["summary", "checks", "changes", "protected", "usage", "review"])],
  ["reportSummary", (v) => v === "awaiting_review"],
  // U-54 (R-65 L-1): in the same window, the analyze run's codaryn-call-1 (allowed, then not_found) has
  // its failed line, the CLI's words, in its progress list.
  [
    "failedAfterDenial",
    (v) =>
      v !== null &&
      JSON.stringify(v.call) === JSON.stringify({ decision: true, result: false }) &&
      JSON.stringify(v.failed) === JSON.stringify([KO_MESSAGES["progress.tool_failed"].replace("{tool}", KO_MESSAGES["tool.read_file"]).replace("{code}", "not_found")]),
  ],
  ["reportMasking", maskingShown],
  ["reportVerdict", (v) => v === "accepted"],
  ["reportText", (v) => typeof v === "string" && !v.includes(FAKE_API_KEY) && !v.includes(FAKE_OPENAI_KEY) && !v.includes(second) && !v.includes("journal.jsonl")],
  ["listReport", (v) => v === "no_verifier"],
  // U-79: the run waiting for its review is reviewed from the list too: its report's review tab, with the verdict of 5g.
  // U-92 (R-73, U-79 L1): the page's form is not used (the remembered one is); a run never shown is refused.
  ["reviewGuard", (v) => JSON.stringify(v) === JSON.stringify({ forgedForm: "accepted", unlisted: "unknown_run" })],
  // U-92: a listed run with no remembered form (a task file's) is refused by the main process.
  ["reviewTaskRun", (v) => v === "form_unknown"],
  ["reviewFromList", (v) => v !== null && v.offered === true && v.tab === "review" && v.verdict === "accepted"],
  // PM (a): the engine host's test transport refused no request to another machine.
  ["transportRefused", (v) => JSON.stringify(v) === JSON.stringify({ mode: "loopback-only", refused: 0 })],
  ["transportRefusedEnd", (v) => v === "host ended" || JSON.stringify(v) === JSON.stringify({ mode: "loopback-only", refused: 0 })],
  // R29-L1: the run cancelled in the window and the run closed with it had sent their request first.
  ["cancelRequestArrived", (v) => v === true],
  ["closeRequestArrived", (v) => v === true],
  // GU-4 (3.8), DR-39, DR-44: the cleanup of the fully reverted run.
  // DR-44 (a): a run not reverted, asked about apart and kept.
  ["cleanupKeepPlan", (v) => v === "1"],
  ["cleanupKeepNotice", (v) => v === true],
  ["cleanupKeepResult", (v) => v === "done"],
  ["cleanupKeepRemoved", (v) => v === "0"],
  ["cleanupKeepReasons", (v) => JSON.stringify(v) === JSON.stringify(["not_reverted_not_confirmed"])],
  ["cleanupKeepDialogs", (v) => JSON.stringify(v) === JSON.stringify(["cleanup.message", "cleanup.notReverted.message"])],
  ["cleanupKeepStays", (v) => v === true],
  // U-22 (DR-48, R51-M-1): a cleanup that removed nothing is a result that says so, not host_error.
  ["cleanupKeepStatus", (v) => JSON.stringify(v) === JSON.stringify({ status: "nothing_removed", notice: "nothing_removed" })],
  ["cleanupReady", (v) => v === "ok"],
  ["cleanupRunsBefore", (v) => typeof v === "number" && v >= 2],
  ["cleanupPlan", (v) => v === "1"],
  ["cleanupPlanItems", (v) => JSON.stringify(v) === JSON.stringify([["run", "first run"]])],
  ["cleanupResult", (v) => v === "done"],
  ["cleanupRemoved", (v) => v === "1"],
  ["cleanupStatus", (v) => v === "removed"],
  ["cleanupDialogs", (v) => JSON.stringify(v) === JSON.stringify(["cleanup.message"])],
  ["cleanupRunsAfter", (v) => typeof v === "number" && v >= 1],
  ["cleanupFirstRunGone", (v) => v === true],
  ["cleanupForged", (v) => v.ok === false && v.code === "unknown_preview"],
  ["cleanupText", (v) => typeof v === "string" && !v.includes(FAKE_API_KEY) && !v.includes(FAKE_OPENAI_KEY) && !v.includes(second)],
  // U-13 (DR-53): the applied discard leaves its file in the apply's discarded files.
  ["discardApplied", (v) => JSON.stringify(v) === JSON.stringify({ fileGone: true, box: true })],
  // U-32 (UXM-14, U-14 AXM-2): the same plan with a records-changed mark first: the warning first, no
  // apply and no summary, no approval token from the main process, no dialog. Applied once unmarked.
  [
    "markedPlan",
    (v) => v !== null && v.first === "plan-records-changed" && v.apply === false && v.cannotApply === true && v.words === false && v.approval === null && v.dialogs === 0,
  ],
  // Its records only: kept as discarded_left (asked about as not reverted, answered "remove"), with
  // the plan's and the result's notices; the records and the discarded files stay.
  [
    "discardLeftKept",
    (v) =>
      v.chosen === true &&
      v.plan === "1" &&
      typeof v.warnings === "string" &&
      v.warnings.split(" ").includes("discarded_left") &&
      v.planNotice === true &&
      v.result === "done" &&
      v.removed === "0" &&
      JSON.stringify(v.kept) === JSON.stringify([["run", "discarded_left"]]) &&
      typeof v.keptText === "string" &&
      !v.keptText.includes("discarded_left") &&
      v.keptNotice === true &&
      JSON.stringify(v.dialogs) === JSON.stringify(["cleanup.message", "cleanup.notReverted.message"]) &&
      JSON.stringify(v.left) === JSON.stringify({ records: true, box: true }),
  ],
  // R47-I4: its discarded files chosen too, "keep them" in the third dialog (the default): both stay,
  // the discarded files as not_confirmed and the records as discarded_left.
  [
    "discardLeftKeepBox",
    (v) =>
      v.chosen === true &&
      v.plan === "2" &&
      v.result === "done" &&
      v.removed === "0" &&
      JSON.stringify([...v.kept].sort()) === JSON.stringify([["discarded", "not_confirmed"], ["run", "discarded_left"]]) &&
      v.keptNotice === true &&
      JSON.stringify(v.dialogs) === JSON.stringify(["cleanup.message", "cleanup.notReverted.message", "cleanup.discarded.message"]) &&
      JSON.stringify(v.left) === JSON.stringify({ records: true, box: true }),
  ],
  // U-22 (DR-48): the three cleanups of 5j2 removed nothing, nothing, both.
  ["discardLeftStatuses", (v) => JSON.stringify(v) === JSON.stringify(["nothing_removed", "nothing_removed", "removed"])],
  // U-22 (DR-48, R51-M-1): a cleanup that failed in part (Windows: a file held open) is shown as such:
  // nothing of the run removed, kept as io_error, no error box; the records stay.
  [
    "partlyFailed",
    (v) =>
      process.platform !== "win32"
        ? v === "not measured on this platform"
        : v !== null &&
          typeof v === "object" &&
          v.chosen === true &&
          v.result === "done" &&
          v.status === "partly_failed" &&
          v.notice === "partly_failed" &&
          v.errors === 0 &&
          v.removed === "0" &&
          JSON.stringify(v.kept) === JSON.stringify([["run", "io_error"]]) &&
          JSON.stringify(v.dialogs) === JSON.stringify(["cleanup.message", "cleanup.notReverted.message"]) &&
          v.stays === true,
  ],
  // Its discarded files chosen too and their deletion agreed to: both go, nothing kept.
  [
    "discardLeftBoth",
    (v) =>
      v.chosen === true &&
      v.plan === "2" &&
      v.result === "done" &&
      v.removed === "2" &&
      JSON.stringify(v.kept) === "[]" &&
      v.keptNotice === false &&
      JSON.stringify(v.dialogs) === JSON.stringify(["cleanup.message", "cleanup.notReverted.message", "cleanup.discarded.message"]) &&
      JSON.stringify(v.left) === JSON.stringify({ records: false, box: false }),
  ],
  // U-5 (3.6): the run that ended while the window was not active: one OS notification, fixed text and status word.
  ["endNotice", (v) => v !== null && v.title === "Codaryn" && v.body === "Codaryn 실행이 끝났습니다: 확인 필요"],
  ["endNotices", (v) => Array.isArray(v) && v.length >= 1 && v.every((body) => /^Codaryn 실행이 끝났습니다(: [^\n]{1,40}|\. 결과는 실행 목록에서 확인하세요\.)$/.test(body))],
  // U-5 (3.7): the report saved as the masked Markdown, to the file the save dialog gave; the window names the file only.
  ["reportSaved", (v) => v === "ok"],
  ["reportSaveText", (v) => typeof v === "string" && v.includes("codaryn-report-") && !v.includes("smoke-report") && !v.includes(gui)],
  [
    "reportFile",
    (v) =>
      v !== null &&
      v.name === `codaryn-report-${v.runId}.md` &&
      typeof v.text === "string" &&
      v.text.includes(v.runId) &&
      !v.text.includes(FAKE_API_KEY) &&
      !v.text.includes(FAKE_OPENAI_KEY),
  ],
  // UXM-14: the marked run in the run list (only it) and its report.
  ["runsRecordsChanged", (v) => v === true],
  ["runsUnmarked", (v) => v === 1],
  ["reportRecordsChanged", (v) => v === true],
  // U-32: the report's warning above its tabs; the marked run's revert preview says so, as the CLI's revert.
  ["reportRecordsChangedFirst", (v) => v === "report-records-changed"],
  ["revertRecordsChanged", (v) => v === true],
  // U-48 (U-43): the marked run's changes: the warning first, every file without text, no comparison.
  ["changesRecordsChanged", (v) => v !== null && v.first === "changes-records-changed" && v.files >= 1 && v.ready === String(v.files) && v.hidden === v.files && v.diffs === 0],
  // U-11 (3.11): the first-run guide.
  ["setupSandbox", (v) => v.made === true && v.realUntouched === true],
  ["setupFolder", (v) => v === "folder"],
  ["setupConfig", (v) => v === "exists"],
  // The guide's create, called directly: CODARYN_CONFIG names the file runs read, so the default location
  // (the test's folder) gets the defaults, said to be overridden; a second call finds it there.
  ["setupCreateAgain", (v) => v.ok === true && v.created === true && v.overridden === true],
  ["setupCreateExists", (v) => v.ok === false && v.code === "config_exists"],
  ["setupModel", (v) => v === "model"],
  ["setupKey", (v) => v === "set"],
  ["setupPermissions", (v) => v === "permissions"],
  ["setupSuggestions", (v) => JSON.stringify(v) === JSON.stringify([["command", "npm test", false], ["protect", "package.json", false]])],
  ["setupApplied", (v) => JSON.stringify(v) === JSON.stringify(["written", "written"])],
  ["setupDialogs", (v) => JSON.stringify(v) === JSON.stringify(["widen.message"])],
  ["setupChecks", (v) => v === "checks"],
  ["setupCheckItems", (v) => typeof v === "number" && v >= 5],
  ["setupOnDisk", (v) => v.npmTest === true && v.packageJson === true],
  ["setupText", (v) => typeof v === "string" && !v.includes(FAKE_API_KEY) && !v.includes(FAKE_OPENAI_KEY) && !v.includes("smoke-config")],
  ["closeGuard", (v) => JSON.stringify(v.dialogs) === JSON.stringify(["widen.message", "widen.message", "widen.message", "widen.message", "widen.message", "revert.message", "apply.message", "apply.message", "cleanup.message", "cleanup.notReverted.message", "cleanup.message", ...U13_DIALOGS, ...U22_DIALOGS, "widen.message", "closeRun.message"]) && v.closed === true && v.ms < 15000],
  // DR-8, GS-1, GS-11: no listening TCP socket, no bound UDP endpoint, no connection to anything
  // but this machine, in any app process. (Before the spellchecker was turned off, Chromium's
  // network service held a UDP socket for the DNS lookup of its dictionary download.)
  // R-10 L-5: only "not measured on this platform" off Windows may pass as text; on Windows any
  // text means the measurement failed, which is a failure.
  ["sockets", (v) => (typeof v === "string" ? process.platform !== "win32" && v === "not measured on this platform" : v.tcp === 0 && v.udp === 0 && v.outside === 0)],
];

let failed = 0;
for (const [name, ok] of expected) {
  let pass = false;
  try {
    pass = seen[name] !== undefined && ok(seen[name]);
  } catch {
    pass = false;
  }
  if (!pass) failed += 1;
  const shown = JSON.stringify(seen[name]) ?? "undefined";
  process.stdout.write(`${pass ? "ok" : "FAIL"} ${name}: ${shown.length > 300 ? `${shown.slice(0, 300)}...` : shown}\n`);
}
// GS-17: nothing fetched from outside; the spellchecker's dictionary is the one Chromium tried.
const dictionaries = join(profile, "Dictionaries");
const fetched = existsSync(dictionaries) ? readdirSync(dictionaries) : [];
process.stdout.write(`${fetched.length === 0 ? "ok" : "FAIL"} noDictionaryDownload: ${JSON.stringify(fetched)}\n`);
if (fetched.length > 0) failed += 1;
if (!junction) process.stdout.write("NOTE the junction could not be made here; the link row was not checked\n");
if (seen.error !== undefined) {
  failed += 1;
  process.stdout.write(`FAIL error: ${JSON.stringify(seen.error)}\n`);
}

// R-10 L-1, L-5 (GS-15): started with a debugging switch or NODE_OPTIONS, the app ends at its start
// check (exit 2) and never loads the window. Loopback port 0 only. --inspect-brk stops Node before
// any app code runs, so only the fuses can refuse it (GU-9); it is reported, not judged.
const started = join(gui, "build", "switch-started.txt");
const switchRuns = [
  ["--remote-debugging-port", ["--remote-debugging-port=0"], {}, true],
  ["--inspect", ["--inspect=127.0.0.1:0"], {}, true],
  ["NODE_OPTIONS=--inspect", [], { NODE_OPTIONS: "--inspect=127.0.0.1:0" }, true],
  ["--inspect-brk", ["--inspect-brk=127.0.0.1:0"], {}, false],
];
let switchChecks = 0;
for (const [label, args, extra, judged] of switchRuns) {
  rmSync(started, { force: true });
  const runOne = spawnSync(electron, [...args, join(gui, "build", "tests", "smoke", "switch-entry.js")], {
    cwd: gui,
    env: { ...env, ...extra },
    stdio: "ignore",
    timeout: judged ? 60_000 : 8_000,
    killSignal: "SIGKILL",
  });
  const loaded = existsSync(started);
  const ended = runOne.status === 2 && !loaded;
  if (!judged) {
    process.stdout.write(`NOTE ${label}: ${ended ? "ended at the check" : `not ended by the start check (exit ${runOne.status}, stopped by the test); needs the fuses (GU-9)`}\n`);
    continue;
  }
  switchChecks += 1;
  if (!ended) failed += 1;
  process.stdout.write(`${ended ? "ok" : "FAIL"} switch ${label}: exit ${runOne.status}, window loaded ${loaded}\n`);
}
rmSync(started, { force: true });
rmSync(join(gui, "build", "switch-profile"), { recursive: true, force: true });

// R-10 L-5 (DR-8): the engine host ends with the app, when it quits and when its main process is
// killed (its stdin closes). Waits at most five seconds for the host to go.
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function goneWithin(pid, ms) {
  for (let waited = 0; waited <= ms; waited += 100) {
    if (!alive(pid)) return true;
    await sleep(100);
  }
  return false;
}
let lifeChecks = 0;
const lifeCheck = (label, ok, detail) => {
  lifeChecks += 1;
  if (!ok) failed += 1;
  process.stdout.write(`${ok ? "ok" : "FAIL"} ${label}: ${detail}\n`);
};
const hostPid = typeof seen.hostPid === "number" ? seen.hostPid : null;
lifeCheck("hostEndsWithQuit", hostPid !== null && (await goneWithin(hostPid, 5_000)), `host ${hostPid} after the smoke app quit`);

const lifeFile = join(gui, "build", "life.json");
rmSync(lifeFile, { force: true });
const held = spawn(electron, [join(gui, "build", "tests", "smoke", "life-entry.js")], { cwd: gui, env: { ...env, CODARYN_SMOKE_LIFE: "hold" }, stdio: "ignore" });
let life = null;
for (let waited = 0; waited < 60_000 && life === null; waited += 200) {
  await sleep(200);
  try {
    life = JSON.parse(readFileSync(lifeFile, "utf8"));
  } catch {
    life = null;
  }
}
if (life === null || typeof life.hostPid !== "number") {
  lifeCheck("hostEndsWhenMainKilled", false, "the app did not start");
  held.kill();
} else {
  lifeCheck("lifeTransportRefused", JSON.stringify(life.transport) === JSON.stringify({ mode: "loopback-only", refused: 0 }), `transport ${JSON.stringify(life.transport)}`);
  // Kills the main process only (TerminateProcess on Windows), not its children.
  process.kill(life.mainPid);
  const gone = await goneWithin(life.hostPid, 5_000);
  lifeCheck("hostEndsWhenMainKilled", gone, `host ${life.hostPid} after main ${life.mainPid} was killed`);
  if (!gone) process.kill(life.hostPid);
}
await sleep(1_000);
rmSync(lifeFile, { force: true });
rmSync(sandboxAppData, { recursive: true, force: true });
rmSync(join(gui, "build", "life-profile"), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });

const total = expected.length + 1 + switchChecks + lifeChecks;
// U-51: how the request count reached the app (not a check): whole replacements, and the writes a read
// in progress refused (EPERM on Windows), left to the next one.
process.stdout.write(`api count file: ${apiCountWrites.replaced} replaced whole, ${apiCountWrites.retried} left to the next write\n`);
process.stdout.write(`gui smoke: ${total - Math.min(failed, total)} of ${total} checks passed, app exit ${run.status}\n`);
process.exit(failed === 0 ? 0 : 1);
