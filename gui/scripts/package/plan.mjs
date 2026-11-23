// GU-9 package script, the parts without Electron tools (docs/design/gu9-packaging-proposal.md 6, 7;
// D-4b, D-5b, D-6, D-8b and the install-folder scope, user decisions 2026-11-24). package.mjs runs
// packager, fuses and tar around these; the unit test (tests/unit/gu9-package-script.test.ts) calls
// them directly. Nothing here downloads anything or starts another program.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";

export const ELECTRON_VERSION = "45.3.1";
export const ELECTRON_ZIP = `electron-v${ELECTRON_VERSION}-win32-x64.zip`;
/** gui/node_modules/electron/checksums.json:40 (D-4a, checked by the PM); the script also reads that file. */
export const ELECTRON_ZIP_SHA256 = "d92d1aa4700e3a7e7f174731f5086ebd9c21f9773e642b260160fe0a6ebe12d2";
/** Node 26.13.1 win-x64 node.exe, the official build's hash (D-5a, D-5b). */
export const NODE_EXE_SHA256 = "f5109dc868ec38703ad8f305e0aceece717cb60d4889873f434017af4e96cccb";
/** The Node 26.13.1 LICENSE text (D-5a). */
export const NODE_LICENSE_SHA256 = "8e603aa87c70d36e497004f0dec63111511cb61b7d65ace12e10ea791599286c";
export const PINS = Object.freeze({ electronZipSha256: ELECTRON_ZIP_SHA256, nodeExeSha256: NODE_EXE_SHA256, nodeLicenseSha256: NODE_LICENSE_SHA256 });

export const APP_NAME = "Codaryn";
export const PLATFORM = "win32";
export const ARCH = "x64";
export const PACKAGE_DIR_NAME = `${APP_NAME}-${PLATFORM}-${ARCH}`;
export const ZIP_NAME = `${PACKAGE_DIR_NAME}.zip`;
export const RECORD_NAME = `${PACKAGE_DIR_NAME}.record.json`;

/** The command line: three paths, all required, no defaults. */
const OPTIONS = { "--electron-zip-dir": "electronZipDir", "--node-exe": "nodeExe", "--node-license": "nodeLicense" };
export const USAGE = "usage: npm run package -- --electron-zip-dir <folder> --node-exe <node.exe> --node-license <LICENSE>";

export function parseArgs(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const key = OPTIONS[flag];
    if (key === undefined) return { ok: false, message: `unknown argument: ${flag}` };
    if (values[key] !== undefined) return { ok: false, message: `${flag} given twice` };
    const value = argv[i + 1];
    if (value === undefined || value.length === 0 || value.startsWith("--")) return { ok: false, message: `${flag} needs a value` };
    values[key] = value;
    i += 1;
  }
  const missing = Object.entries(OPTIONS).filter(([, key]) => values[key] === undefined).map(([flag]) => flag);
  if (missing.length > 0) return { ok: false, message: `missing: ${missing.join(", ")}` };
  return { ok: true, values };
}

/**
 * Review M2: the three inputs are made absolute against `cwd` (one stated base, npm runs the script
 * in gui/) and must be local paths by the Windows rule `isLocal` (node-path.ts's
 * `isLocalPathSyntax`, the CLI's `checkLocalPathSyntax` rule): no UNC share, no `\\?\` or `\\.\`
 * path, no device name. This runs before any file is touched, so a network or device path is never
 * opened. A drive letter mapped to a network share looks local and is not caught (boundary).
 */
export function localInputs(values, cwd, isLocal) {
  const absolute = {};
  const problems = [];
  for (const [flag, key] of Object.entries(OPTIONS)) {
    const path = resolve(cwd, values[key]);
    if (!isLocal(path, "win32")) problems.push(`${flag} is not a local path on this PC: ${path}`);
    absolute[key] = path;
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, values: absolute };
}

export async function sha256File(file) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

export function sha256Text(text) {
  return createHash("sha256").update(text).digest("hex");
}

/** The file operations the input check uses; the unit test counts them. */
export const INPUT_OPS = Object.freeze({ lstat: (file) => lstat(file), sha256: (file) => sha256File(file) });

/** A regular file (not a link, not a folder), or a reason. */
async function regularFile(file, ops) {
  try {
    const info = await ops.lstat(file);
    if (info.isSymbolicLink()) return "is a link";
    if (!info.isFile()) return "is not a regular file";
    return null;
  } catch (error) {
    return error?.code === "ENOENT" ? "does not exist" : `cannot be read (${error?.code ?? "error"})`;
  }
}

/**
 * Checks the three inputs before anything is made: the Electron zip's name and SHA-256 (against
 * the pin and against `electronChecksums`, the parsed checksums.json), node.exe's and the Node
 * LICENSE's SHA-256 (against the pins). Resolves the problems found; an empty list means all match.
 */
export async function verifyInputs(values, electronChecksums, pins = PINS, ops = INPUT_OPS) {
  const problems = [];
  if (electronChecksums?.[ELECTRON_ZIP] !== pins.electronZipSha256) problems.push(`checksums.json does not give ${ELECTRON_ZIP} the pinned SHA-256`);
  const inputs = [
    [join(values.electronZipDir, ELECTRON_ZIP), pins.electronZipSha256, ELECTRON_ZIP],
    [values.nodeExe, pins.nodeExeSha256, "node.exe"],
    [values.nodeLicense, pins.nodeLicenseSha256, "the Node LICENSE"],
  ];
  for (const [file, expected, label] of inputs) {
    const notRegular = await regularFile(file, ops);
    if (notRegular !== null) {
      problems.push(`${label} ${notRegular}`);
      continue;
    }
    if ((await ops.sha256(file)) !== expected) problems.push(`${label} does not have the pinned SHA-256`);
  }
  return problems;
}

/** Every regular file under `dir` as a `/` path relative to it, sorted. A link or special entry throws. */
export async function listTree(dir) {
  const files = [];
  const visit = async (full, prefix) => {
    for (const name of await readdir(full)) {
      const path = prefix === "" ? name : `${prefix}/${name}`;
      const info = await lstat(join(full, name));
      if (info.isSymbolicLink()) throw new Error(`${path} is a link`);
      if (info.isDirectory()) await visit(join(full, name), path);
      else if (info.isFile()) files.push(path);
      else throw new Error(`${path} is not a regular file`);
    }
  };
  await visit(dir, "");
  return files.sort();
}

/** Source maps (`.map`, exactly this lower-case ending): built, never read at run time, left out. */
const isMap = (path) => path.endsWith(".map");
const isJs = (path) => path.endsWith(".js");
/**
 * A file or folder whose name starts with a dot (`renderer/.hidden.js`, `.cache/x.js`). The builds
 * hold none (the PM's counts of 2026-11-24), so any is unexpected and stops the run (review I-new2).
 */
const isHidden = (path) => path.split("/").some((part) => part.startsWith("."));
/** The non-.js files the app may carry, by exact path (the build counts of 2026-11-24). */
const APP_EXTRA = new Set(["preload/preload.cjs", "renderer/index.html", "renderer/styles.css"]);

/**
 * Review M3: what is packaged from gui/build/src is chosen by an allow-list, not by leaving things
 * out. `app` (inside app.asar): `.js` under main/, preload/, renderer/, shared/, plus
 * `preload/preload.cjs`, `renderer/index.html` and `renderer/styles.css`. `engineHost` (in
 * resources/engine): `.js` under engine-host/ and shared/. Source maps are left out. Anything else
 * (another extension, another top folder, a name starting with a dot) is `unexpected`, and the
 * script stops on it and names it: nothing is dropped silently. build/tests is outside build/src
 * (R29-I4) and never read here.
 *
 * What this does not do: it is a rule on names (extension and place), not an approval of each file
 * or of its content. A `.js` file in an allowed place is packaged whatever it holds; the build
 * output itself is trusted (it is the build the PM tested).
 */
export function selectBuild(guiBuildSrc) {
  const app = [];
  const engineHost = [];
  const unexpected = [];
  for (const path of guiBuildSrc) {
    if (isHidden(path)) {
      unexpected.push(path);
      continue;
    }
    if (isMap(path)) continue;
    const top = path.split("/")[0];
    if (top === "shared" && isJs(path)) {
      app.push(path);
      engineHost.push(path);
    } else if (top === "engine-host" && isJs(path)) {
      engineHost.push(path);
    } else if ((top === "main" || top === "preload" || top === "renderer") && (isJs(path) || APP_EXTRA.has(path))) {
      app.push(path);
    } else {
      unexpected.push(path);
    }
  }
  return { app, engineHost, unexpected };
}

/**
 * The engine from the root build dist/src: `.js` only (the build counts: 203 `.js`, 203 `.map`),
 * hidden names unexpected, by the same name rule as selectBuild (content not checked).
 */
export function selectEngine(distSrc) {
  const engine = [];
  const unexpected = [];
  for (const path of distSrc) {
    if (isHidden(path)) {
      unexpected.push(path);
      continue;
    }
    if (isMap(path)) continue;
    if (isJs(path)) engine.push(path);
    else unexpected.push(path);
  }
  return { engine, unexpected };
}

/** The files the packaged start cannot do without; a build that lacks one stops the script. */
export const REQUIRED_APP = ["main/main.js", "preload/preload.cjs", "renderer/index.html", "renderer/styles.css"];
export const REQUIRED_ENGINE_HOST = ["engine-host/main.js"];
export const REQUIRED_ENGINE = ["app/index.js", "contracts/index.js", "i18n/index.js"];

export function missingRequired(files, required) {
  const have = new Set(files);
  return required.filter((path) => !have.has(path));
}

/** The app's package.json inside app.asar: the GUI's own fields that Electron reads, no dependencies. */
export function appPackageJson(guiPackage) {
  const { name, version, main, type, license } = guiPackage;
  return `${JSON.stringify({ name, version, private: true, main, type, license }, null, 2)}\n`;
}

/**
 * The package.json at the package root. Its name and version are how the engine finds its install
 * folder (src/app/input/install.ts:31-48), so the whole package folder is that folder; `type` makes
 * the engine's .js files ES modules. The list covers this file (packaged-engine.ts).
 */
export function rootPackageJson(rootPackage) {
  return `${JSON.stringify({ name: rootPackage.name, version: rootPackage.version, type: "module" }, null, 2)}\n`;
}

/**
 * The payload outside app.asar, as `{ path, source }` (a file to copy) or `{ path, text }` (written),
 * with list paths relative to the package root. `guiBuild` and `rootDist` are the absolute folders
 * gui/build/src and dist/src; `engineHost` and `engine` are what `selectBuild` and `selectEngine` chose.
 */
export function payloadEntries({ guiBuild, engineHost, rootDist, engine, nodeExe, nodeLicense, rootPackageText }) {
  const entries = [
    { path: "resources/node/node.exe", source: nodeExe },
    { path: "resources/node/LICENSE", source: nodeLicense },
    { path: "package.json", text: rootPackageText },
  ];
  for (const rel of engineHost) entries.push({ path: `resources/engine/build/src/${rel}`, source: join(guiBuild, ...rel.split("/")) });
  for (const rel of engine) entries.push({ path: `resources/engine/dist/src/${rel}`, source: join(rootDist, ...rel.split("/")) });
  return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The list (engine-manifest.json) for the payload: sizes and SHA-256 from the files themselves. */
export async function manifestFor(entries) {
  const files = [];
  for (const entry of entries) {
    if (entry.text !== undefined) {
      files.push({ path: entry.path, size: Buffer.byteLength(entry.text), sha256: sha256Text(entry.text) });
    } else {
      const info = await lstat(entry.source);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${entry.path}: the source is not a regular file`);
      files.push({ path: entry.path, size: info.size, sha256: await sha256File(entry.source) });
    }
  }
  return { version: 1, files };
}

// D-6 (standalone-gui.md 6.7): four off, two on, and the other three at Electron 45.3.1's own
// values, read from the binary before flipping. Indices are @electron/fuses's FuseV1Options;
// package.mjs checks that they still match the installed module before using them.
export const FUSE_INDEX = Object.freeze({
  RunAsNode: 0,
  EnableCookieEncryption: 1,
  EnableNodeOptionsEnvironmentVariable: 2,
  EnableNodeCliInspectArguments: 3,
  EnableEmbeddedAsarIntegrityValidation: 4,
  OnlyLoadAppFromAsar: 5,
  LoadBrowserProcessSpecificV8Snapshot: 6,
  GrantFileProtocolExtraPrivileges: 7,
  WasmTrapHandlers: 8,
});
export const FUSES_OFF = ["RunAsNode", "EnableNodeOptionsEnvironmentVariable", "EnableNodeCliInspectArguments", "GrantFileProtocolExtraPrivileges"];
export const FUSES_ON = ["EnableEmbeddedAsarIntegrityValidation", "OnlyLoadAppFromAsar"];
export const FUSES_DEFAULT = ["EnableCookieEncryption", "LoadBrowserProcessSpecificV8Snapshot", "WasmTrapHandlers"];
/** @electron/fuses FuseState: the byte of each fuse in the wire. */
export const FUSE_STATE = Object.freeze({ DISABLE: 48, ENABLE: 49 });
export const FUSE_WIRE_VERSION = "1";

/**
 * Electron's own values of the three fuses left at their default, from a wire read before any
 * flip (`getCurrentFuseWire`). The wire must be version 1 with exactly the nine known fuses, and
 * each of the three must be plainly on or off; anything else is an error, nothing is guessed.
 */
export function defaultsFromWire(wire) {
  if (wire?.version !== FUSE_WIRE_VERSION) return { ok: false, message: `fuse wire version ${String(wire?.version)}, expected ${FUSE_WIRE_VERSION}` };
  const indices = Object.keys(wire).filter((key) => key !== "version").map(Number).sort((a, b) => a - b);
  const expected = Object.values(FUSE_INDEX).sort((a, b) => a - b);
  if (JSON.stringify(indices) !== JSON.stringify(expected)) return { ok: false, message: `the binary has fuses ${indices.join(",")}, expected ${expected.join(",")}` };
  const values = {};
  for (const name of FUSES_DEFAULT) {
    const state = wire[FUSE_INDEX[name]];
    if (state === FUSE_STATE.ENABLE) values[name] = true;
    else if (state === FUSE_STATE.DISABLE) values[name] = false;
    else return { ok: false, message: `${name} is neither on nor off in the binary (${String(state)})` };
  }
  return { ok: true, values };
}

/** The flipFuses config: all nine fuses named, strictlyRequireAllFuses on. */
export function fuseConfig(defaults) {
  const config = { version: FUSE_WIRE_VERSION, strictlyRequireAllFuses: true };
  for (const name of FUSES_OFF) config[FUSE_INDEX[name]] = false;
  for (const name of FUSES_ON) config[FUSE_INDEX[name]] = true;
  for (const name of FUSES_DEFAULT) {
    if (typeof defaults[name] !== "boolean") throw new Error(`no default value for ${name}`);
    config[FUSE_INDEX[name]] = defaults[name];
  }
  return config;
}

/** The fuses whose state in a wire read after flipping is not the config's. Empty when all match. */
export function wireMismatches(wire, config) {
  const wrong = [];
  if (wire?.version !== config.version) wrong.push("version");
  for (const [name, index] of Object.entries(FUSE_INDEX)) {
    const want = config[index] ? FUSE_STATE.ENABLE : FUSE_STATE.DISABLE;
    if (wire?.[index] !== want) wrong.push(name);
  }
  return wrong;
}
