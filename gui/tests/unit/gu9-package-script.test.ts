/**
 * GU-9 package script (gui/scripts/package/plan.mjs and package.mjs) without its tools: packager,
 * fuses and tar are never called here. The pure parts are tested directly; the whole run is tested
 * with fake tools in temporary folders (nothing goes to gui/out). The scripts are .mjs files the GUI
 * build does not compile, so they are loaded at run time from the gui folder, the way
 * node-path-parity.test.ts loads the root build.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { isLocalPathSyntax } from "../../src/main/node-path.js";
import * as engine from "../../src/main/packaged-engine.js";

const GUI = fileURLToPath(new URL("../../../", import.meta.url));
const ROOT = join(GUI, "..");
const B = "\\";

type Values = Record<string, string>;
interface InputOps {
  lstat: (file: string) => Promise<unknown>;
  sha256: (file: string) => Promise<string>;
}
interface Pins {
  electronZipSha256: string;
  nodeExeSha256: string;
  nodeLicenseSha256: string;
}
interface Entry {
  path: string;
  source?: string;
  text?: string;
}
type Wire = Record<string, unknown>;
interface PlanModule {
  ELECTRON_VERSION: string;
  ELECTRON_ZIP: string;
  ELECTRON_ZIP_SHA256: string;
  NODE_EXE_SHA256: string;
  NODE_LICENSE_SHA256: string;
  PACKAGE_DIR_NAME: string;
  ZIP_NAME: string;
  RECORD_NAME: string;
  REQUIRED_APP: string[];
  FUSE_INDEX: Record<string, number>;
  FUSES_OFF: string[];
  FUSES_ON: string[];
  FUSES_DEFAULT: string[];
  parseArgs(argv: string[]): { ok: true; values: Values } | { ok: false; message: string };
  verifyInputs(values: Values, checksums: Record<string, string>, pins?: Pins, ops?: InputOps): Promise<string[]>;
  localInputs(values: Values, cwd: string, isLocal: (path: string, platform: NodeJS.Platform) => boolean): { ok: true; values: Values } | { ok: false; problems: string[] };
  listTree(dir: string): Promise<string[]>;
  selectBuild(files: string[]): { app: string[]; engineHost: string[]; unexpected: string[] };
  selectEngine(files: string[]): { engine: string[]; unexpected: string[] };
  appPackageJson(pkg: Record<string, unknown>): string;
  rootPackageJson(pkg: Record<string, unknown>): string;
  payloadEntries(input: Record<string, unknown>): Entry[];
  manifestFor(entries: Entry[]): Promise<{ version: number; files: { path: string; size: number; sha256: string }[] }>;
  defaultsFromWire(wire: Wire): { ok: true; values: Record<string, boolean> } | { ok: false; message: string };
  fuseConfig(defaults: Record<string, boolean>): Record<string, unknown>;
  wireMismatches(wire: Wire, config: Record<string, unknown>): string[];
}
type Result = { ok: true; record: string } | { ok: false; message: string };
interface Tools {
  packager: (options: Record<string, unknown>) => Promise<string[]>;
  fuses: { getCurrentFuseWire: (exe: string) => Promise<Wire>; flipFuses: (exe: string, config: Record<string, unknown>) => Promise<number>; FuseV1Options: Record<string, number> };
  zip: (input: { cwd: string; zip: string; dir: string }) => Promise<{ ok: boolean; message?: string }>;
  engine: typeof engine;
  isLocalPath: (path: string, platform: NodeJS.Platform) => boolean;
}
interface PackageModule {
  runPackage(context: Record<string, unknown>, tools: Tools): Promise<Result>;
}

const plan = (await import(pathToFileURL(join(GUI, "scripts", "package", "plan.mjs")).href)) as PlanModule;
const script = (await import(pathToFileURL(join(GUI, "scripts", "package", "package.mjs")).href)) as PackageModule;

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

function tempDir(t: TestContext, name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `codaryn-gu9-${name}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(base: string, path: string, text: string): string {
  const full = join(base, ...path.split("/"));
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
  return full;
}

test("gu9 package: the pins and names are the decided ones", () => {
  assert.equal(plan.ELECTRON_VERSION, "45.3.1");
  assert.equal(plan.ELECTRON_ZIP, "electron-v45.3.1-win32-x64.zip");
  assert.equal(plan.ELECTRON_ZIP_SHA256, "d92d1aa4700e3a7e7f174731f5086ebd9c21f9773e642b260160fe0a6ebe12d2");
  assert.equal(plan.NODE_EXE_SHA256, "f5109dc868ec38703ad8f305e0aceece717cb60d4889873f434017af4e96cccb");
  assert.equal(plan.NODE_LICENSE_SHA256, "8e603aa87c70d36e497004f0dec63111511cb61b7d65ace12e10ea791599286c");
  assert.equal(plan.PACKAGE_DIR_NAME, "Codaryn-win32-x64");
  const checksums = JSON.parse(readFileSync(join(GUI, "node_modules", "electron", "checksums.json"), "utf8")) as Record<string, string>;
  assert.equal(checksums[plan.ELECTRON_ZIP], plan.ELECTRON_ZIP_SHA256, "the installed electron's checksums.json gives the pinned value");
});

test("gu9 package: the three inputs are required, once each, with a value", () => {
  const good = ["--electron-zip-dir", "Z", "--node-exe", "N", "--node-license", "L"];
  assert.deepEqual(plan.parseArgs(good), { ok: true, values: { electronZipDir: "Z", nodeExe: "N", nodeLicense: "L" } });
  for (const argv of [[], ["--node-exe", "N"], [...good, "--node-exe", "M"], [...good, "--extra"], ["--electron-zip-dir", "--node-exe", "N", "--node-license", "L"], ["--electron-zip-dir"]]) {
    assert.equal(plan.parseArgs(argv).ok, false, JSON.stringify(argv));
  }
});

test("gu9 package: inputs must have the pinned SHA-256 values before anything is made", async (t) => {
  const dir = tempDir(t, "inputs");
  write(dir, `zips/${plan.ELECTRON_ZIP}`, "zip bytes");
  const node = write(dir, "node.exe", "node bytes");
  const license = write(dir, "LICENSE", "license text");
  const pins = { electronZipSha256: sha256("zip bytes"), nodeExeSha256: sha256("node bytes"), nodeLicenseSha256: sha256("license text") };
  const values = { electronZipDir: join(dir, "zips"), nodeExe: node, nodeLicense: license };
  const checksums = { [plan.ELECTRON_ZIP]: pins.electronZipSha256 };
  assert.deepEqual(await plan.verifyInputs(values, checksums, pins), []);
  assert.equal((await plan.verifyInputs(values, checksums, { ...pins, nodeExeSha256: sha256("other") })).length, 1);
  assert.match((await plan.verifyInputs(values, { [plan.ELECTRON_ZIP]: "0".repeat(64) }, pins))[0] ?? "", /checksums\.json/);
  assert.match((await plan.verifyInputs({ ...values, electronZipDir: dir }, checksums, pins)).join(" "), /does not exist/);
  assert.match((await plan.verifyInputs({ ...values, nodeLicense: dir }, checksums, pins)).join(" "), /not a regular file/);
  assert.ok((await plan.verifyInputs(values, checksums)).length >= 3, "the real pins do not match test bytes");
});

test("gu9 package M3: files are chosen by an allow-list; anything else is named, not dropped", () => {
  const built = ["engine-host/main.js", "engine-host/main.js.map", "main/main.js", "main/main.js.map", "preload/preload.cjs", "preload/preload.cjs.map", "renderer/index.html", "renderer/styles.css", "shared/protocol.js"];
  assert.deepEqual(plan.selectBuild(built), {
    app: ["main/main.js", "preload/preload.cjs", "renderer/index.html", "renderer/styles.css", "shared/protocol.js"],
    engineHost: ["engine-host/main.js", "shared/protocol.js"],
    unexpected: [],
  });
  const odd = ["renderer/dev-settings.json", "renderer/other.html", "main/x.cjs", "shared/data.json", "engine-host/notes.txt", "tools/x.js", "main/MAIN.JS.MAP", "x.js"];
  assert.deepEqual(plan.selectBuild(odd).unexpected, odd);
  assert.deepEqual(plan.selectEngine(["app/index.js", "app/index.js.map", "cli/main.js", "private.env", "tests/probe.mjs"]), {
    engine: ["app/index.js", "cli/main.js"],
    unexpected: ["private.env", "tests/probe.mjs"],
  });
});

test("gu9 package M2: inputs are made absolute against cwd and must be local paths", () => {
  const cwd = "C:" + B + "work";
  const local = plan.localInputs({ electronZipDir: "zips", nodeExe: "C:" + B + "node" + B + "node.exe", nodeLicense: ".." + B + "LICENSE" }, cwd, isLocalPathSyntax);
  assert.equal(local.ok, true);
  if (local.ok) {
    assert.equal(local.values["electronZipDir"], join(cwd, "zips"));
    assert.equal(local.values["nodeLicense"], join(cwd, "..", "LICENSE"));
  }
  for (const bad of [B + B + "server" + B + "share" + B + "node.exe", "//server/share/node.exe", B + B + "?" + B + "C:" + B + "node.exe", B + B + "." + B + "pipe" + B + "x", "C:" + B + "node" + B + "nul", "C:" + B + "node" + B + "COM1.exe"]) {
    const result = plan.localInputs({ electronZipDir: "zips", nodeExe: bad, nodeLicense: "LICENSE" }, cwd, isLocalPathSyntax);
    assert.equal(result.ok, false, bad);
    if (!result.ok) assert.match(result.problems.join(" "), /--node-exe/);
  }
});

test("gu9 package: the real builds give an app without build/tests or the host, and a list the start check accepts", async (t) => {
  const guiBuild = join(GUI, "build", "src");
  const rootDist = join(ROOT, "dist", "src");
  if (!existsSync(join(rootDist, "app", "index.js"))) {
    t.skip("the root build (dist/src) is not here");
    return;
  }
  const build = plan.selectBuild(await plan.listTree(guiBuild));
  const engineSet = plan.selectEngine(await plan.listTree(rootDist));
  assert.deepEqual(build.unexpected, [], "the real GUI build holds only allowed files");
  assert.deepEqual(engineSet.unexpected, [], "the real root build holds only allowed files");
  const app = build.app;
  for (const required of plan.REQUIRED_APP) assert.ok(app.includes(required), required);
  assert.equal(app.some((path) => path.startsWith("engine-host/") || path.endsWith(".map") || path.includes("tests/")), false);
  const dir = tempDir(t, "real");
  const entries = plan.payloadEntries({
    guiBuild,
    engineHost: build.engineHost,
    rootDist,
    engine: engineSet.engine,
    nodeExe: write(dir, "node.exe", "node"),
    nodeLicense: write(dir, "LICENSE", "license"),
    rootPackageText: plan.rootPackageJson({ name: "codaryn", version: "0.1.0" }),
  });
  const manifest = await plan.manifestFor(entries);
  const text = JSON.stringify(manifest);
  assert.notEqual(engine.parseEngineManifest(text), null, "every real file name passes the start check's path rules");
  const paths = manifest.files.map((file) => file.path);
  assert.deepEqual([...paths].sort(), paths, "sorted");
  for (const required of engine.requiredListedFiles("win32")) assert.ok(paths.includes(required), required);
  assert.equal(paths.some((path) => path.endsWith(".map") || path.includes("/tests/")), false);
});

test("gu9 package: the two package.json files", () => {
  const root = JSON.parse(plan.rootPackageJson({ name: "codaryn", version: "0.1.0", scripts: { x: "y" }, devDependencies: { a: "1" } })) as unknown;
  assert.deepEqual(root, { name: "codaryn", version: "0.1.0", type: "module" });
  const gui = JSON.parse(readFileSync(join(GUI, "package.json"), "utf8")) as Record<string, unknown>;
  const app = JSON.parse(plan.appPackageJson(gui)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(app).sort(), ["license", "main", "name", "private", "type", "version"]);
  assert.equal(app["main"], "build/src/main/main.js");
  assert.equal(app["type"], "module");
});

function wireOf(states: Record<number, number>, extra: Record<string, unknown> = {}): Wire {
  return { version: "1", ...states, ...extra };
}
const ALL_ON: Record<number, number> = { 0: 49, 1: 49, 2: 49, 3: 49, 4: 48, 5: 48, 6: 48, 7: 49, 8: 49 };

test("gu9 package: the three default fuses come from the binary; anything unexpected stops", () => {
  const read = plan.defaultsFromWire(wireOf(ALL_ON));
  assert.deepEqual(read, { ok: true, values: { EnableCookieEncryption: true, LoadBrowserProcessSpecificV8Snapshot: false, WasmTrapHandlers: true } });
  assert.equal(plan.defaultsFromWire(wireOf(ALL_ON, { version: "2" })).ok, false);
  assert.equal(plan.defaultsFromWire(wireOf({ ...ALL_ON, 9: 49 })).ok, false, "a tenth fuse");
  const eight: Record<number, number> = { ...ALL_ON };
  delete eight[8];
  assert.equal(plan.defaultsFromWire(wireOf(eight)).ok, false, "a fuse missing");
  assert.equal(plan.defaultsFromWire(wireOf({ ...ALL_ON, 1: 114 })).ok, false, "a removed default fuse");
});

test("gu9 package: the fuse config names all nine, strictly, and the read-back check finds any difference", () => {
  const config = plan.fuseConfig({ EnableCookieEncryption: true, LoadBrowserProcessSpecificV8Snapshot: false, WasmTrapHandlers: true });
  assert.equal(config["version"], "1");
  assert.equal(config["strictlyRequireAllFuses"], true);
  const indices = Object.keys(config).filter((key) => /^[0-9]+$/.test(key)).map(Number).sort((a, b) => a - b);
  assert.deepEqual(indices, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  for (const name of plan.FUSES_OFF) assert.equal(config[String(plan.FUSE_INDEX[name])], false, name);
  for (const name of plan.FUSES_ON) assert.equal(config[String(plan.FUSE_INDEX[name])], true, name);
  assert.throws(() => plan.fuseConfig({ EnableCookieEncryption: true }));
  const flipped = wireOf(Object.fromEntries(indices.map((i) => [i, config[String(i)] === true ? 49 : 48])));
  assert.deepEqual(plan.wireMismatches(flipped, config), []);
  assert.deepEqual(plan.wireMismatches({ ...flipped, 0: 49 }, config), ["RunAsNode"]);
});

interface Fixture {
  readonly gui: string;
  readonly root: string;
  readonly out: string;
  readonly temp: string;
  readonly argv: string[];
  readonly pins: Pins;
}

/** A small gui folder, repository root and inputs, all in a temporary folder. */
function fixture(t: TestContext): Fixture {
  const base = tempDir(t, "run");
  const gui = join(base, "gui");
  const root = join(base, "repo");
  write(gui, "package.json", JSON.stringify({ name: "codaryn-gui", version: "0.1.0", private: true, license: "Apache-2.0", type: "module", main: "build/src/main/main.js", devDependencies: { electron: "45.3.1" } }));
  for (const path of ["main/main.js", "main/main.js.map", "preload/preload.cjs", "renderer/index.html", "renderer/styles.css", "shared/protocol.js", "engine-host/main.js"]) write(gui, `build/src/${path}`, `// ${path}\n`);
  write(gui, "build/tests/smoke/smoke.js", "// never packaged\n");
  write(root, "package.json", JSON.stringify({ name: "codaryn", version: "0.1.0", type: "module" }));
  for (const path of ["app/index.js", "app/index.js.map", "contracts/index.js", "i18n/index.js"]) write(root, `dist/src/${path}`, `// ${path}\n`);
  write(root, "LICENSE", "Apache License\n");
  write(root, "NOTICE", "Codaryn\nCopyright 2026 gangdonggil\n");
  write(base, `zips/${plan.ELECTRON_ZIP}`, "zip bytes");
  const node = write(base, "node/node.exe", "node bytes");
  const license = write(base, "node/LICENSE", "node license");
  const pins = { electronZipSha256: sha256("zip bytes"), nodeExeSha256: sha256("node bytes"), nodeLicenseSha256: sha256("node license") };
  write(gui, "node_modules/electron/checksums.json", JSON.stringify({ [plan.ELECTRON_ZIP]: pins.electronZipSha256 }));
  const out = join(base, "out");
  mkdirSync(out);
  const temp = join(base, "tmp");
  mkdirSync(temp);
  return { gui, root, out, temp, argv: ["--electron-zip-dir", join(base, "zips"), "--node-exe", node, "--node-license", license], pins };
}

interface Fakes {
  readonly tools: Tools;
  readonly calls: string[];
  readonly options: Record<string, unknown>[];
  readonly staged: string[][];
  readonly zipSeen: boolean[];
  readonly wire: Record<string, unknown>;
}

/** Fake packager, fuses and zip that act like the real ones on a tiny scale. */
function fakes(change: { packagerPath?: (made: string) => string; flip?: (config: Record<string, unknown>) => Record<string, unknown>; wire?: Wire } = {}): Fakes {
  const calls: string[] = [];
  const options: Record<string, unknown>[] = [];
  const staged: string[][] = [];
  const zipSeen: boolean[] = [];
  const wire: Record<string, unknown> = { ...(change.wire ?? wireOf(ALL_ON)) };
  const tools: Tools = {
    packager: async (given) => {
      calls.push("packager");
      options.push(given);
      staged.push(await plan.listTree(String(given["dir"])));
      zipSeen.push(existsSync(join(String(given["electronZipDir"]), plan.ELECTRON_ZIP)));
      // Like packager: work under <tmpdir>/electron-packager.
      write(join(String(given["tmpdir"]), "electron-packager"), "win32-x64-template/work.txt", "packager work\n");
      const made = join(String(given["out"]), plan.PACKAGE_DIR_NAME);
      for (const name of ["Codaryn.exe", "LICENSE", "LICENSES.chromium.html", "resources/app.asar"]) write(made, name, `fake ${name}\n`);
      return [change.packagerPath === undefined ? made : change.packagerPath(made)];
    },
    fuses: {
      getCurrentFuseWire: async () => {
        calls.push("read");
        return { ...wire };
      },
      flipFuses: async (_exe, config) => {
        calls.push("flip");
        const applied = change.flip === undefined ? config : change.flip(config);
        for (const [key, value] of Object.entries(applied)) if (/^[0-9]+$/.test(key)) wire[key] = value === true ? 49 : 48;
        return 1;
      },
      FuseV1Options: { ...plan.FUSE_INDEX },
    },
    zip: async ({ zip, dir }) => {
      calls.push("zip");
      writeFileSync(zip, `zip of ${dir}\n`);
      return { ok: true };
    },
    engine,
    isLocalPath: isLocalPathSyntax,
  };
  return { tools, calls, options, staged, zipSeen, wire };
}

const run = (f: Fixture, tools: Tools, extra: Record<string, unknown> = {}) =>
  script.runPackage({ gui: f.gui, root: f.root, out: f.out, argv: f.argv, pins: f.pins, temp: f.temp, ...extra }, tools);

test("gu9 package: a whole run with fake tools, in order, with no download option and nothing overwritten", async (t) => {
  const f = fixture(t);
  const fake = fakes();
  const lines: string[] = [];
  const result = await run(f, fake.tools, { log: (line: string) => lines.push(line) });
  assert.equal(result.ok, true, result.ok ? "" : result.message);
  assert.deepEqual(fake.calls, ["packager", "read", "flip", "read", "zip"]);
  const options = fake.options[0] ?? {};
  assert.equal("download" in options, false, "no download option");
  const packagerTmp = String(options["tmpdir"]);
  assert.ok(packagerTmp.startsWith(join(f.temp, "codaryn-package-")), `M1: packager's tmpdir is inside this run's staging folder (${packagerTmp})`);
  assert.ok(lines.some((line) => line.startsWith("finished:")), "I1: the run says the record file marks a finished run");
  assert.equal(existsSync(join(f.out, `${plan.RECORD_NAME}.partial`)), false, "L-new1: no partial record is left");
  assert.deepEqual(fake.zipSeen, [true], "packager found the checked zip in electronZipDir");
  assert.ok(String(options["electronZipDir"]).startsWith(f.temp), "electronZipDir is the script's own copy in its staging folder");
  for (const [key, value] of Object.entries({ name: "Codaryn", platform: "win32", arch: "x64", electronVersion: "45.3.1", asar: true, prune: false, overwrite: false, out: f.out })) {
    assert.deepEqual(options[key], value, key);
  }
  assert.equal((options["win32metadata"] as Record<string, unknown>)["CompanyName"], "Codaryn", "no package.json walk for the company name");
  const staged = fake.staged[0] ?? [];
  assert.deepEqual(staged, [
    "build/src/main/main.js",
    "build/src/preload/preload.cjs",
    "build/src/renderer/index.html",
    "build/src/renderer/styles.css",
    "build/src/shared/protocol.js",
    "engine-manifest.json",
    "package.json",
  ]);
  const made = join(f.out, plan.PACKAGE_DIR_NAME);
  for (const path of ["resources/node/node.exe", "resources/node/LICENSE", "resources/engine/build/src/engine-host/main.js", "resources/engine/build/src/shared/protocol.js", "resources/engine/dist/src/app/index.js", "package.json", "licenses/Codaryn/LICENSE", "licenses/Codaryn/NOTICE", "LICENSE", "LICENSES.chromium.html"]) {
    assert.ok(existsSync(join(made, ...path.split("/"))), path);
  }
  assert.equal(existsSync(join(made, "resources", "engine", "dist", "src", "app", "index.js.map")), false, "no source map in the payload");
  assert.deepEqual(JSON.parse(readFileSync(join(made, "package.json"), "utf8")), { name: "codaryn", version: "0.1.0", type: "module" });
  assert.equal(readdirSync(f.temp).length, 0, "the staging folder is removed");
  const record = JSON.parse(readFileSync(join(f.out, plan.RECORD_NAME), "utf8")) as { zip: { sha256: string }; fuses: { after: Wire }; files: { path: string }[] };
  assert.equal(record.zip.sha256, sha256(`zip of ${plan.PACKAGE_DIR_NAME}\n`));
  assert.deepEqual(plan.wireMismatches(record.fuses.after, plan.fuseConfig({ EnableCookieEncryption: true, LoadBrowserProcessSpecificV8Snapshot: false, WasmTrapHandlers: true })), []);
  assert.ok(record.files.some((file) => file.path === "resources/node/node.exe"));
  const again = await run(f, fakes().tools);
  assert.equal(again.ok, false, "a second run does not overwrite");
});

test("gu9 package: an output already there stops the run before packager", async (t) => {
  const f = fixture(t);
  mkdirSync(join(f.out, plan.PACKAGE_DIR_NAME));
  const fake = fakes();
  const result = await run(f, fake.tools);
  assert.equal(result.ok, false);
  assert.deepEqual(fake.calls, []);
});

test("gu9 package: an input with another hash stops the run before packager", async (t) => {
  const f = fixture(t);
  const fake = fakes();
  const result = await script.runPackage({ gui: f.gui, root: f.root, out: f.out, argv: f.argv, pins: { ...f.pins, nodeExeSha256: sha256("other") }, temp: f.temp }, fake.tools);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.message, /node\.exe/);
  assert.deepEqual(fake.calls, []);
});

test("gu9 package: a binary with an unexpected fuse wire stops before any flip", async (t) => {
  const f = fixture(t);
  const fake = fakes({ wire: wireOf({ ...ALL_ON, 9: 49 }) });
  const result = await run(f, fake.tools);
  assert.equal(result.ok, false);
  assert.deepEqual(fake.calls, ["packager", "read"]);
  assert.match(result.ok ? "" : result.message, /incomplete/);
});

test("gu9 package: fuses that do not read back as set stop the run with no zip", async (t) => {
  const f = fixture(t);
  const fake = fakes({ flip: (config) => ({ ...config, 0: true }) });
  const result = await run(f, fake.tools);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.message, /RunAsNode/);
  assert.match(result.ok ? "" : result.message, /no record file/, "I1: a failed run says it did not finish");
  assert.equal(fake.calls.includes("zip"), false);
  assert.equal(existsSync(join(f.out, plan.ZIP_NAME)), false);
  assert.equal(existsSync(join(f.out, plan.RECORD_NAME)), false);
});

test("gu9 package: packager output in another place stops the run", async (t) => {
  const f = fixture(t);
  const fake = fakes({ packagerPath: (made) => `${made}-other` });
  const result = await run(f, fake.tools);
  assert.equal(result.ok, false);
  assert.deepEqual(fake.calls, ["packager"]);
});

test("gu9 package M2: a network input is refused before the injected input operations (lstat, sha256), the gui/out lookup and the build listings run", async (t) => {
  const f = fixture(t);
  const touched: string[] = [];
  const looked: string[] = [];
  const io = {
    lstat: async (path: string) => {
      looked.push(path);
      throw new Error("gui/out and the outputs should not be looked at");
    },
    listTree: async (dir: string) => {
      looked.push(dir);
      throw new Error("the builds should not be listed");
    },
  };
  const fileOps: InputOps = {
    lstat: async (file) => {
      touched.push(file);
      throw new Error("no file should be looked at");
    },
    sha256: async (file) => {
      touched.push(file);
      throw new Error("no file should be read");
    },
  };
  const unc = B + B + "server" + B + "share" + B + "node.exe";
  const argv = [...f.argv];
  argv[3] = unc;
  const fake = fakes();
  const result = await run({ ...f, argv }, fake.tools, { fileOps, io });
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.message, /local paths/);
  assert.deepEqual(touched, [], "no injected input operation (lstat, sha256)");
  assert.deepEqual(looked, [], "no gui/out lookup and no build listing");
  assert.deepEqual(fake.calls, []);
});

test("gu9 package M3: an unexpected file in either build stops the run before packager and is named", async (t) => {
  for (const [where, path] of [
    ["root", "dist/src/private.env"],
    ["gui", "build/src/renderer/dev-settings.json"],
    ["gui", "build/src/tools/probe.js"],
  ] as const) {
    const f = fixture(t);
    write(where === "root" ? f.root : f.gui, path, "x\n");
    const fake = fakes();
    const result = await run(f, fake.tools);
    assert.equal(result.ok, false, path);
    assert.ok(!result.ok && result.message.includes(path), `the message names ${path}`);
    assert.deepEqual(fake.calls, [], path);
  }
});

test("gu9 package L1: a broken link where an output goes counts as existing", async (t) => {
  const f = fixture(t);
  try {
    symlinkSync(join(f.out, "missing-target"), join(f.out, plan.PACKAGE_DIR_NAME), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`could not make a link here: ${(error as { code?: string }).code ?? String(error)}`);
    return;
  }
  assert.equal(existsSync(join(f.out, plan.PACKAGE_DIR_NAME)), false, "existsSync does not see a broken link");
  const fake = fakes();
  const result = await run(f, fake.tools);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.message, /already exists/);
  assert.deepEqual(fake.calls, []);
});

test("gu9 package L1: gui/out must be a plain folder, not a file or a link", async (t) => {
  const asFile = fixture(t);
  rmSync(asFile.out, { recursive: true, force: true });
  writeFileSync(asFile.out, "not a folder");
  const one = fakes();
  const fileResult = await run(asFile, one.tools);
  assert.equal(fileResult.ok, false);
  assert.match(fileResult.ok ? "" : fileResult.message, /not a plain folder/);
  assert.deepEqual(one.calls, []);

  const asLink = fixture(t);
  const real = `${asLink.out}-real`;
  rmSync(asLink.out, { recursive: true, force: true });
  mkdirSync(real);
  try {
    symlinkSync(real, asLink.out, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`could not make a link here: ${(error as { code?: string }).code ?? String(error)}`);
    return;
  }
  const two = fakes();
  const linkResult = await run(asLink, two.tools);
  assert.equal(linkResult.ok, false);
  assert.match(linkResult.ok ? "" : linkResult.message, /not a plain folder/);
  assert.deepEqual(two.calls, []);
});

test("gu9 package I-new2: a name starting with a dot is unexpected in either build", () => {
  const build = plan.selectBuild(["main/main.js", "renderer/.hidden.js", ".cache/x.js", "shared/.x.js", "engine-host/.y.js.map"]);
  assert.deepEqual(build.app, ["main/main.js"]);
  assert.deepEqual(build.unexpected, ["renderer/.hidden.js", ".cache/x.js", "shared/.x.js", "engine-host/.y.js.map"]);
  assert.deepEqual(plan.selectEngine(["app/index.js", ".hidden.js", "app/.x.js"]).unexpected, [".hidden.js", "app/.x.js"]);
});

test("gu9 package I-new2: a hidden .js file in a build stops the run before packager", async (t) => {
  const f = fixture(t);
  write(f.gui, "build/src/renderer/.hidden.js", "// hidden\n");
  const fake = fakes();
  const result = await run(f, fake.tools);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.message.includes("build/src/renderer/.hidden.js"));
  assert.deepEqual(fake.calls, []);
});

/** A failed finish: not ok, no final record, no partial record, no "finished:" line. */
function assertUnfinished(f: Fixture, result: Result, lines: string[], why: string): void {
  assert.equal(result.ok, false, why);
  assert.equal(existsSync(join(f.out, plan.RECORD_NAME)), false, `${why}: no final record`);
  assert.equal(existsSync(join(f.out, `${plan.RECORD_NAME}.partial`)), false, `${why}: the partial record is removed`);
  assert.equal(lines.some((line) => line.startsWith("finished:")), false, `${why}: no finished line`);
  assert.match(result.ok ? "" : result.message, /no record file/, why);
}

test("gu9 package L-new1: a staging folder that cannot be removed fails the run before any record", async (t) => {
  const f = fixture(t);
  const lines: string[] = [];
  let calls = 0;
  const io = {
    rm: async (path: string) => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("busy"), { code: "EBUSY" });
      rmSync(path, { recursive: true, force: true });
    },
  };
  const result = await run(f, fakes().tools, { io, log: (line: string) => lines.push(line) });
  assertUnfinished(f, result, lines, "cleanup failure");
  assert.equal(calls, 2, "the run tried once before the record and once more at the end");
  assert.equal(readdirSync(f.temp).length, 0, "the second try removed it");
});

test("gu9 package L-new1: a record that cannot be written in full fails the run, and its part is removed", async (t) => {
  const f = fixture(t);
  const lines: string[] = [];
  const io = {
    writeNew: async (path: string, text: string) => {
      writeFileSync(path, text.slice(0, 10), { flag: "wx" });
      throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
    },
  };
  const result = await run(f, fakes().tools, { io, log: (line: string) => lines.push(line) });
  assertUnfinished(f, result, lines, "partial write failure");
});

test("gu9 package L-new1: a record that does not read back as written fails the run", async (t) => {
  const f = fixture(t);
  const lines: string[] = [];
  const result = await run(f, fakes().tools, { io: { readText: async () => "{}\n" }, log: (line: string) => lines.push(line) });
  assertUnfinished(f, result, lines, "read-back mismatch");
});

test("gu9 package L-new1: a record that cannot be renamed into place fails the run", async (t) => {
  const f = fixture(t);
  const lines: string[] = [];
  const io = {
    rename: async () => {
      throw Object.assign(new Error("denied"), { code: "EPERM" });
    },
  };
  const result = await run(f, fakes().tools, { io, log: (line: string) => lines.push(line) });
  assertUnfinished(f, result, lines, "rename failure");
});

test("gu9 package L-new1: the run resolves, never rejects, even when every cleanup fails", async (t) => {
  const f = fixture(t);
  const lines: string[] = [];
  const io = {
    rm: async () => {
      throw Object.assign(new Error("busy"), { code: "EBUSY" });
    },
  };
  const result = await run(f, fakes({ flip: (config) => ({ ...config, 0: true }) }).tools, { io, log: (line: string) => lines.push(line) });
  assertUnfinished(f, result, lines, "fuse mismatch with cleanup failing");
  assert.match(result.ok ? "" : result.message, /staging folder .* could not be removed/);
});
