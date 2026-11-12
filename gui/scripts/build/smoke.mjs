// Runs the GU-1 smoke test (tests/smoke/smoke.ts) in the real Electron and checks what it saw.
// The app gets a clean environment: no API key, a config file that does not exist, and this
// Node (26+) as the engine host's Node (DR-26). Needs `npm run build` here and in the root.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const gui = fileURLToPath(new URL("../../", import.meta.url));
const electron = join(gui, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
const result = join(gui, "build", "smoke-result.json");

const env = {};
for (const [name, value] of Object.entries(process.env)) {
  if (value === undefined) continue;
  if (/^(ANTHROPIC_API_KEY|CODARYN_CONFIG|CODARYN_LANG|CODARYN_MODEL|NODE_OPTIONS|NODE_PATH|ELECTRON_RUN_AS_NODE|npm_node_execpath)$/i.test(name)) continue;
  env[name] = value;
}
env.CODARYN_CONFIG = join(gui, "build", "smoke-no-config.json");
env.npm_node_execpath = process.execPath;

if (!existsSync(electron)) {
  process.stderr.write("gui smoke: the Electron binary is missing (node node_modules/electron/install.js)\n");
  process.exit(1);
}
rmSync(result, { force: true });
// A fresh Chromium profile each run, so anything fetched or written is this run's.
const profile = join(gui, "build", "smoke-profile");
rmSync(profile, { recursive: true, force: true });
const run = spawnSync(electron, [join(gui, "build", "tests", "smoke", "smoke.js")], { cwd: gui, env, stdio: "inherit", timeout: 120_000 });
if (!existsSync(result)) {
  process.stderr.write(`gui smoke: no result (exit ${run.status}, ${run.error?.message ?? "no error"})\n`);
  process.exit(1);
}
const seen = JSON.parse(readFileSync(result, "utf8"));
const expected = [
  ["doctorWithoutWorkspace", (v) => v === "ok"],
  ["checksShown", (v) => typeof v === "number" && v >= 5],
  ["url", (v) => v === "app://codaryn/index.html"],
  ["renderer", (v) => v.process === "undefined" && v.require === "undefined" && v.ipcRenderer === "undefined" && v.module === "undefined" && v.api === "doctor,info,openFolder"],
  ["doctorWithWorkspace", (v) => v.ok === true && typeof v.workspaceName === "string" && typeof v.workspaceCheck === "string"],
  ["doctorWithPath", (v) => v.ok === false && v.code === "invalid_args"],
  ["doctorUnknownHandle", (v) => v.ok === false && v.code === "unknown_workspace"],
  ["fetchHttp", (v) => v === "blocked"],
  ["fetchFile", (v) => v === "blocked"],
  ["windowOpen", (v) => v === "blocked"],
  ["urlAfterNavigation", (v) => v === "app://codaryn/index.html"],
  ["hostNode", (v) => typeof v === "string" && Number(v.split(".")[0]) >= 26],
  // DR-8, GS-1: no listening TCP socket and no bound UDP endpoint in any app process. (Before the
  // spellchecker was turned off, Chromium's network service held a UDP socket for the DNS lookup of
  // its dictionary download.)
  ["listening", (v) => typeof v === "string" || (v.tcp === 0 && v.udp === 0)],
];
let failed = 0;
let failedChecks = 0;
for (const [name, ok] of expected) {
  let pass = false;
  try {
    pass = seen[name] !== undefined && ok(seen[name]);
  } catch {
    pass = false;
  }
  if (!pass) {
    failed += 1;
    failedChecks += 1;
  }
  process.stdout.write(`${pass ? "ok" : "FAIL"} ${name}: ${JSON.stringify(seen[name])}\n`);
}
if (typeof seen.listening === "object" && seen.listening !== null && seen.listening.udp > 0) {
  const types = seen.processes ?? {};
  for (const endpoint of seen.listening.endpoints) {
    process.stdout.write(`NOTE udp endpoint ${endpoint.address}:${endpoint.port} owned by ${types[String(endpoint.pid)] ?? "an app process"}\n`);
  }
}
// Nothing may be fetched from outside: the spellchecker's dictionary is the one Chromium tried.
const dictionaries = join(profile, "Dictionaries");
const fetched = existsSync(dictionaries) ? readdirSync(dictionaries) : [];
process.stdout.write(`${fetched.length === 0 ? "ok" : "FAIL"} noDictionaryDownload: ${JSON.stringify(fetched)}\n`);
if (fetched.length > 0) {
  failed += 1;
  failedChecks += 1;
}
if (seen.error !== undefined) {
  failed += 1;
  process.stdout.write(`FAIL error: ${JSON.stringify(seen.error)}\n`);
}
process.stdout.write(`gui smoke: ${expected.length + 1 - failedChecks} of ${expected.length + 1} checks passed, app exit ${run.status}\n`);
process.exit(failed === 0 ? 0 : 1);
