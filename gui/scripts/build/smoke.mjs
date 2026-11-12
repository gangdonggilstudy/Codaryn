// Runs the GU-1/GU-2 smoke test (tests/smoke/smoke.ts) in the real Electron and checks what it saw.
// The app gets a clean environment (no API key, a config file that does not exist, this Node 26+
// as the engine host's Node, DR-26), a fresh Chromium profile and a fresh gui-state.json. Two
// workspaces are made in the temporary folder and removed afterwards. Needs `npm run build` here
// and in the repository root.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

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
  if (/^(ANTHROPIC_API_KEY|CODARYN_CONFIG|CODARYN_LANG|CODARYN_MODEL|NODE_OPTIONS|NODE_PATH|ELECTRON_RUN_AS_NODE|npm_node_execpath)$/i.test(name)) continue;
  env[name] = value;
}
env.CODARYN_CONFIG = join(gui, "build", "smoke-no-config.json");
env.npm_node_execpath = process.execPath;
env.CODARYN_SMOKE_SECOND = second;

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

for (const target of [result, profile, stateDir]) rmSync(target, { recursive: true, force: true });
const run = spawnSync(electron, [join(gui, "build", "tests", "smoke", "smoke.js"), first], { cwd: gui, env, stdio: "inherit", timeout: 180_000 });
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
const API = "doctor,forgetRecent,info,onWorkspaceOpened,openFolder,openRecent,recent,reveal,tree";

const expected = [
  ["initialTree", (v) => v === "ok"],
  ["initialWorkspace", (v) => typeof v === "string" && v.includes(firstName)],
  ["initialRows", (v) => rows(v).length === 1 && rows(v)[0].text.includes("first.txt")],
  ["secondOpened", (v) => v === true],
  ["secondTree", (v) => v === "ok"],
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
  ["treeText", (v) => typeof v === "string" && !v.includes("FAKEFAKE") && !v.includes(second)],
  ["recentShown", (v) => v === "2"],
  ["recentNames", (v) => JSON.stringify(v) === JSON.stringify([secondName, firstName])],
  ["stateFile", (v) => JSON.stringify(v) === JSON.stringify([secondName, firstName])],
  ["checks", (v) => v === "ok"],
  ["checksShown", (v) => typeof v === "number" && v >= 5],
  ["url", (v) => v === "app://codaryn/index.html"],
  ["renderer", (v) => v.process === "undefined" && v.require === "undefined" && v.ipcRenderer === "undefined" && v.module === "undefined" && v.api === API],
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
  // DR-8, GS-1, GS-11: no listening TCP socket, no bound UDP endpoint, no connection to anything
  // but this machine, in any app process. (Before the spellchecker was turned off, Chromium's
  // network service held a UDP socket for the DNS lookup of its dictionary download.)
  ["sockets", (v) => typeof v === "string" || (v.tcp === 0 && v.udp === 0 && v.outside === 0)],
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

const total = expected.length + 1 + switchChecks;
process.stdout.write(`gui smoke: ${total - Math.min(failed, total)} of ${total} checks passed, app exit ${run.status}\n`);
process.exit(failed === 0 ? 0 : 1);
