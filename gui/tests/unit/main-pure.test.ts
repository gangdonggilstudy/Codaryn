/**
 * GU-1: the main process's parts that need no Electron: the host environment, finding Node,
 * workspace handles, the app protocol's path mapping and the security values.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { APP_INDEX_URL, isAppUrl, resolveAppUrl } from "../../src/main/app-url.js";
import { REMOVED_HOST_VARIABLES, hostEnvironment } from "../../src/main/environment.js";
import { WorkspaceHandles } from "../../src/main/handles.js";
import { envValue, findDevelopmentNode } from "../../src/main/node-path.js";
import { CONTENT_SECURITY_POLICY, SESSION_PARTITION, debuggingRequested, forbiddenSwitch, secureWebPreferences } from "../../src/main/security-policy.js";
import { HANDLE_PATTERN } from "../../src/shared/ipc.js";

test("main: the host environment drops the code-loading variables in any case and keeps the rest", () => {
  const env = hostEnvironment({
    PATH: "C:\\bin",
    Node_Options: "--require evil.js",
    node_path: "C:\\evil",
    ELECTRON_RUN_AS_NODE: "1",
    CODARYN_LANG: "ko",
    EMPTY: "",
    UNSET: undefined,
  });
  assert.deepEqual(env, { PATH: "C:\\bin", CODARYN_LANG: "ko", EMPTY: "" });
  assert.deepEqual([...REMOVED_HOST_VARIABLES].sort(), ["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS", "NODE_PATH"]);
});

test("main: development Node comes from npm_node_execpath, else from absolute PATH entries", () => {
  const files = new Set(["C:\\node26\\node.exe", "C:\\other\\node.exe", "/usr/local/bin/node"]);
  const isFile = (file: string): boolean => files.has(file);
  assert.equal(findDevelopmentNode({ NPM_NODE_EXECPATH: "C:\\node26\\node.exe", PATH: "C:\\other" }, "win32", isFile), "C:\\node26\\node.exe");
  assert.equal(findDevelopmentNode({ npm_node_execpath: "node.exe", Path: ".;relative;\"C:\\other\"" }, "win32", isFile), "C:\\other\\node.exe");
  assert.equal(findDevelopmentNode({ PATH: ".;bin" }, "win32", isFile), null, "relative PATH entries are not searched");
  assert.equal(findDevelopmentNode({ PATH: "/usr/local/bin:/usr/bin" }, "linux", isFile), "/usr/local/bin/node");
  assert.equal(findDevelopmentNode({ path: "/usr/local/bin" }, "linux", isFile), null, "names keep their case off Windows");
  assert.equal(envValue({ Path: "x" }, "PATH", "win32"), "x");
});

test("main: handles are random hex, resolve only what was issued, and are cleared", () => {
  let counter = 0;
  const handles = new WorkspaceHandles((size) => Uint8Array.from({ length: size }, () => (counter++ * 37) & 0xff));
  const first = handles.issue("D:\\work\\a");
  const second = handles.issue("D:\\work\\b");
  assert.match(first, HANDLE_PATTERN);
  assert.notEqual(first, second);
  assert.equal(handles.resolve(first), "D:\\work\\a");
  assert.equal(handles.resolve("0".repeat(32)), null);
  assert.equal(handles.resolve("D:\\work\\a"), null, "a path is not a handle");
  assert.equal(handles.resolve(42), null);
  handles.clear();
  assert.equal(handles.resolve(first), null);
});

test("main: the app protocol serves only plain names under the root with known types", () => {
  const root = path.resolve("renderer-root");
  assert.deepEqual(resolveAppUrl(APP_INDEX_URL, root), { file: path.join(root, "index.html"), type: "text/html; charset=utf-8" });
  assert.deepEqual(resolveAppUrl("app://codaryn/", root), { file: path.join(root, "index.html"), type: "text/html; charset=utf-8" });
  assert.equal(resolveAppUrl("app://codaryn/app.js", root)?.type, "text/javascript; charset=utf-8");
  assert.equal(resolveAppUrl("app://codaryn/screens/run.js", root)?.file, path.join(root, "screens", "run.js"));
  // The URL parser resolves dot segments (plain or %2e) before anything else: never above the root.
  for (const [url, inside] of [
    ["app://codaryn/../secret.js", "secret.js"],
    ["app://codaryn/%2e%2e/%2E%2e/secret.js", "secret.js"],
    ["app://codaryn/a/%2e%2e/b.js", "b.js"],
  ] as const) {
    assert.equal(resolveAppUrl(url, root)?.file, path.join(root, inside), url);
  }
  for (const url of [
    "app://codaryn/..%5csecret.js",
    "app://codaryn/%2fsecret.js",
    "app://codaryn/a%00.js",
    "app://codaryn/a\\b.js",
    "app://codaryn/C:/Windows/x.js",
    "app://codaryn//x.js",
    "app://codaryn/x.js?y=1",
    "app://codaryn/notes.txt",
    "app://codaryn/app",
    "app://other/app.js",
    "app://user@codaryn/app.js",
    "app://codaryn:8080/app.js",
    "file:///C:/x/app.js",
    "https://codaryn/app.js",
    "not a url",
  ]) {
    assert.equal(resolveAppUrl(url, root), null, url);
  }
  assert.equal(isAppUrl("app://codaryn/x.js"), true);
  assert.equal(isAppUrl("app://codaryn.evil/x.js"), false);
  assert.equal(isAppUrl("https://example.invalid/"), false);
});

test("main: the window's web preferences isolate the renderer", () => {
  const prefs = secureWebPreferences("C:\\gui\\preload.cjs", false);
  assert.deepEqual(prefs, {
    preload: "C:\\gui\\preload.cjs",
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webviewTag: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    spellcheck: false,
    devTools: false,
    partition: SESSION_PARTITION,
  });
  assert.equal(SESSION_PARTITION.startsWith("persist:"), false, "the session is kept in memory");
});

test("main: the content security policy allows the app's own files only", () => {
  const rules = new Map(CONTENT_SECURITY_POLICY.split("; ").map((rule) => [rule.split(" ")[0], rule.split(" ").slice(1).join(" ")]));
  assert.equal(rules.get("default-src"), "'none'");
  assert.equal(rules.get("script-src"), "'self'");
  assert.equal(rules.get("connect-src"), "'none'");
  assert.equal(rules.get("object-src"), "'none'");
  assert.doesNotMatch(CONTENT_SECURITY_POLICY, /unsafe-|https?:|\*/);
});

test("main: debugging and inspector switches are found in any form", () => {
  assert.equal(forbiddenSwitch(["--remote-debugging-port=9222"]), "remote-debugging-port");
  assert.equal(forbiddenSwitch(["app", "--Remote-Debugging-Pipe"]), "remote-debugging-pipe");
  assert.equal(forbiddenSwitch(["--inspect"]), "inspect");
  assert.equal(forbiddenSwitch(["--inspect-brk=0.0.0.0:9229"]), "inspect-brk");
  assert.equal(forbiddenSwitch(["-inspect"]), "inspect");
  assert.equal(forbiddenSwitch(["D:\\work\\notes", "--lang=ko"]), null);
});

test("main (R-10 L-1): debugging asked for by argument, by NODE_OPTIONS or by an open inspector is found", () => {
  const none = { argv: ["D:\work"], nodeOptions: undefined, inspectorUrl: undefined, hasSwitch: () => false };
  assert.equal(debuggingRequested(none), null);
  assert.equal(debuggingRequested({ ...none, argv: ["--inspect=127.0.0.1:0"] }), "inspect");
  assert.equal(debuggingRequested({ ...none, nodeOptions: "--max-old-space-size=4096 --inspect=127.0.0.1:0" }), "inspect");
  assert.equal(debuggingRequested({ ...none, nodeOptions: "--inspect-brk" }), "inspect-brk");
  assert.equal(debuggingRequested({ ...none, nodeOptions: "--max-old-space-size=4096" }), null);
  assert.equal(debuggingRequested({ ...none, inspectorUrl: "ws://127.0.0.1:9229/x" }), "inspector");
  assert.equal(debuggingRequested({ ...none, hasSwitch: (name) => name === "remote-debugging-port" }), "remote-debugging-port");
});
