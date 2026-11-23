// GU-9: `npm run package -- --electron-zip-dir <folder> --node-exe <node.exe> --node-license <LICENSE>`
// (docs/design/gu9-packaging-proposal.md 6, 7; user decisions 2026-11-24: D-8b local only, D-5b,
// D-6, the whole package folder as the install folder). Makes gui/out/Codaryn-win32-x64/, its zip
// and a record of both, on this PC only. No signing, no installer, nothing published.
//
// Order (D-6): check the inputs -> list the payload and compute the engine list -> packager (into a
// fresh gui/out/Codaryn-win32-x64) -> copy the payload and the notices -> check the copies against
// the list with the app's own start check -> read Electron's fuse defaults -> flip all nine fuses
// (strict) -> read them back -> zip -> record. Any failure ends with exit code 1; nothing is
// overwritten, and a package folder left by a failed run says so and is not zipped.
//
// No download: packager gets `electronZipDir` (a copy of the checked zip made here) and no
// `download` option. With electronZipDir set, packager 20.3.0 takes the zip from that folder and
// never calls @electron/get (node_modules/@electron/packager/dist/packager.js:141-151; download
// options have no effect then, types.d.ts:375, 386-394). The name, versions and win32 company name
// are all given, so packager does not look for package.json files above the staging folder either
// (dist/infer.js:65-81). The script needs the root and GUI builds made first; it does not build.
//
// Temporary folders (review M1): packager deletes `<tmpdir>/electron-packager` with
// rm(recursive, force) before it works (dist/common.js:66-67 baseTempDir, dist/packager.js:51-54
// ensureTempDir, :189-192). Without `tmpdir` that is the shared os.tmpdir()/electron-packager, which
// another run may be using. Here `tmpdir` is a folder inside this run's own fresh staging folder
// (mkdtemp), so what packager deletes and makes belongs to this run alone; the staging folder is
// removed at the end.
//
// Inputs (review M2): the three paths are made absolute against process.cwd() (npm runs the script
// in gui/) and refused before any file access unless they are local paths by node-path.ts's
// isLocalPathSyntax (no UNC share, \\?\ or \\.\ path, device name). A drive letter mapped to a
// network share is not caught by the path's form (boundary).
//
// What is packaged (review M3) is an allow-list (plan.mjs selectBuild, selectEngine); any other file
// in the builds stops the run and is named. Existing outputs (review L1) are looked up with lstat,
// so a broken link or other entry counts as existing; gui/out itself must be a plain folder.
//
// Finished means recorded (review I1, L-new1): the record file is written last and only by a run
// that got through every step, the staging folder's removal included; it is written as
// <record>.partial, read back, then renamed, and "finished:" is printed only after that rename, so
// exit code 0, "finished:" and the record are always seen together. A package folder or zip without
// the record is incomplete and must not be used. The
// builds, the copies, the list and the zip are not one frozen snapshot: the copies are checked
// against the list, but a build file changed while the script runs is not caught by itself.

import { spawnSync } from "node:child_process";
import { constants, existsSync, readFileSync } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  APP_NAME,
  ARCH,
  ELECTRON_VERSION,
  ELECTRON_ZIP,
  FUSE_INDEX,
  PACKAGE_DIR_NAME,
  PINS,
  PLATFORM,
  RECORD_NAME,
  REQUIRED_APP,
  REQUIRED_ENGINE,
  REQUIRED_ENGINE_HOST,
  USAGE,
  ZIP_NAME,
  appPackageJson,
  defaultsFromWire,
  fuseConfig,
  listTree,
  localInputs,
  manifestFor,
  missingRequired,
  parseArgs,
  payloadEntries,
  rootPackageJson,
  selectBuild,
  selectEngine,
  sha256File,
  sha256Text,
  verifyInputs,
  wireMismatches,
} from "./plan.mjs";

class Stop extends Error {}
const stop = (message) => {
  throw new Stop(message);
};

/** Whether anything is at `path` (lstat: a broken link counts). Any error but ENOENT counts too; never throws. */
async function present(io, path) {
  try {
    await io.lstat(path);
    return true;
  } catch (error) {
    return error?.code !== "ENOENT";
  }
}

/** Names a few of `paths` for a message. */
const named = (paths) => `${paths.slice(0, 20).join(", ")}${paths.length > 20 ? ` and ${paths.length - 20} more` : ""}`;

async function isRegularFile(file) {
  try {
    const info = await lstat(file);
    return info.isFile() && !info.isSymbolicLink();
  } catch {
    return false;
  }
}

/** Copies one file; never over an existing one. */
async function copyNew(source, target) {
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target, constants.COPYFILE_EXCL);
}

async function writeNew(target, text) {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text, { flag: "wx" });
}

/**
 * The file operations around gui/out, the build listings, the staging folder and the record; the
 * unit test replaces some of them (reviews I-new1, L-new1). Everything else uses node:fs directly.
 */
const DEFAULT_IO = Object.freeze({
  lstat: (path) => lstat(path),
  listTree: (dir) => listTree(dir),
  rm: (path) => rm(path, { recursive: true, force: true }),
  writeNew: (path, text) => writeNew(path, text),
  readText: (path) => readFile(path, "utf8"),
  rename: (from, to) => rename(from, to),
  unlink: (path) => unlink(path),
});

/** A log line that cannot fail the run. */
function safeLog(log, line) {
  try {
    log(line);
  } catch {
    // The log is only a report; the result says what happened.
  }
}

/**
 * The whole run. `context`: `gui` (the gui folder), `root` (the repository root), `out` (gui/out),
 * `argv`, `cwd` (the base for relative inputs), and for the unit test `pins`, `temp`, `fileOps` (the
 * input check's file operations) and `io` (replaces parts of DEFAULT_IO). `tools`: `packager`, `fuses` (`getCurrentFuseWire`,
 * `flipFuses`, `FuseV1Options`), `zip({ cwd, zip, dir })`, `engine` (the built packaged-engine.js)
 * and `isLocalPath` (the built node-path.js's isLocalPathSyntax).
 * Resolves `{ ok: true, record }` or `{ ok: false, message }`; never rejects. `ok: true` exactly when
 * the record file was renamed into place.
 */
export async function runPackage(context, tools) {
  const { gui, root, out, argv, cwd = process.cwd(), pins = PINS, temp = tmpdir(), fileOps, log = () => {} } = context;
  const io = { ...DEFAULT_IO, ...(context.io ?? {}) };
  const packageRoot = join(out, PACKAGE_DIR_NAME);
  const zipPath = join(out, ZIP_NAME);
  const recordPath = join(out, RECORD_NAME);
  const partialPath = `${recordPath}.partial`;
  let staging = null;
  let started = false;
  let partialMine = false;
  let zipSha256 = null;
  let failure = null;
  try {
    const args = parseArgs(argv);
    if (!args.ok) stop(`${args.message}\n${USAGE}`);
    // M2: before any file is touched.
    const local = localInputs(args.values, cwd, tools.isLocalPath);
    if (!local.ok) stop(`the inputs must be local paths: ${local.problems.join("; ")}`);
    const inputs = local.values;
    safeLog(log, `inputs: ${inputs.electronZipDir}, ${inputs.nodeExe}, ${inputs.nodeLicense}`);
    // L1: lstat, so links (broken ones too) and other entries count as existing.
    try {
      const outInfo = await io.lstat(out);
      if (outInfo.isSymbolicLink() || !outInfo.isDirectory()) stop(`${out} is not a plain folder`);
    } catch (error) {
      if (error instanceof Stop) throw error;
      if (error?.code !== "ENOENT") stop(`${out} cannot be looked at (${error?.code ?? "error"})`);
    }
    for (const path of [packageRoot, zipPath, recordPath, partialPath]) {
      if (await present(io, path)) stop(`${path} already exists; remove it first (nothing is overwritten)`);
    }
    started = true;

    const guiBuild = join(gui, "build", "src");
    const rootDist = join(root, "dist", "src");
    if (!existsSync(guiBuild) || !existsSync(rootDist)) stop("build first: npm run build in the repository root, then in gui");
    const build = selectBuild(await io.listTree(guiBuild));
    const engineSet = selectEngine(await io.listTree(rootDist));
    const unexpected = [...build.unexpected.map((p) => `gui/build/src/${p}`), ...engineSet.unexpected.map((p) => `dist/src/${p}`)];
    if (unexpected.length > 0) stop(`the builds hold files that are not packaged by rule; remove them or rebuild: ${named(unexpected)}`);
    const missing = [
      ...missingRequired(build.app, REQUIRED_APP).map((p) => `gui/build/src/${p}`),
      ...missingRequired(build.engineHost, REQUIRED_ENGINE_HOST).map((p) => `gui/build/src/${p}`),
      ...missingRequired(engineSet.engine, REQUIRED_ENGINE).map((p) => `dist/src/${p}`),
    ];
    if (missing.length > 0) stop(`the builds lack ${missing.join(", ")}`);

    const checksums = JSON.parse(readFileSync(join(gui, "node_modules", "electron", "checksums.json"), "utf8"));
    const problems = await verifyInputs(inputs, checksums, pins, fileOps);
    if (problems.length > 0) stop(`the inputs do not match: ${problems.join("; ")}`);
    safeLog(log, "inputs match the pinned SHA-256 values");

    const guiPackage = JSON.parse(readFileSync(join(gui, "package.json"), "utf8"));
    const rootPackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    if (rootPackage.name !== "codaryn" || typeof rootPackage.version !== "string") stop("the root package.json is not codaryn's");
    const entries = payloadEntries({
      guiBuild,
      engineHost: build.engineHost,
      rootDist,
      engine: engineSet.engine,
      nodeExe: inputs.nodeExe,
      nodeLicense: inputs.nodeLicense,
      rootPackageText: rootPackageJson(rootPackage),
    });
    const manifest = await manifestFor(entries);
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    if (tools.engine.parseEngineManifest(manifestText) === null) stop("the engine list does not pass the start check's own rules");
    const pinned = { "resources/node/node.exe": pins.nodeExeSha256, "resources/node/LICENSE": pins.nodeLicenseSha256 };
    for (const [path, sha256] of Object.entries(pinned)) {
      if (manifest.files.find((file) => file.path === path)?.sha256 !== sha256) stop(`${path} changed after the input check`);
    }
    safeLog(log, `engine list: ${manifest.files.length} files`);

    staging = await mkdtemp(join(temp, "codaryn-package-"));
    const appDir = join(staging, "app");
    for (const rel of build.app) await copyNew(join(guiBuild, ...rel.split("/")), join(appDir, "build", "src", ...rel.split("/")));
    await writeNew(join(appDir, "package.json"), appPackageJson(guiPackage));
    await writeNew(join(appDir, tools.engine.ENGINE_MANIFEST_FILE), manifestText);
    const zipDir = join(staging, "electron");
    await copyNew(join(inputs.electronZipDir, ELECTRON_ZIP), join(zipDir, ELECTRON_ZIP));
    if ((await sha256File(join(zipDir, ELECTRON_ZIP))) !== pins.electronZipSha256) stop("the copied Electron zip does not have the pinned SHA-256");

    const options = {
      dir: appDir,
      name: APP_NAME,
      executableName: APP_NAME,
      appVersion: guiPackage.version,
      platform: PLATFORM,
      arch: ARCH,
      electronVersion: ELECTRON_VERSION,
      electronZipDir: zipDir,
      out,
      // M1: packager deletes and uses <tmpdir>/electron-packager; this folder is inside this run's staging.
      tmpdir: join(staging, "packager-tmp"),
      asar: true,
      prune: false,
      overwrite: false,
      quiet: true,
      win32metadata: { CompanyName: APP_NAME, ProductName: APP_NAME, FileDescription: APP_NAME },
    };
    const paths = await tools.packager(options);
    if (paths.length !== 1 || resolve(paths[0]) !== resolve(packageRoot)) stop(`packager made ${JSON.stringify(paths)}, expected ${packageRoot}`);
    safeLog(log, `packager made ${packageRoot}`);

    for (const name of ["LICENSE", "LICENSES.chromium.html"]) {
      if (!(await isRegularFile(join(packageRoot, name)))) stop(`packager left no ${name} (the Electron notices)`);
    }
    for (const path of ["resources/node", "resources/engine", "package.json", "licenses"]) {
      if (await present(io, join(packageRoot, ...path.split("/")))) stop(`${path} is already in the package; it would be overwritten`);
    }
    for (const entry of entries) {
      const target = join(packageRoot, ...entry.path.split("/"));
      if (entry.text !== undefined) await writeNew(target, entry.text);
      else await copyNew(entry.source, target);
    }
    await copyNew(join(root, "LICENSE"), join(packageRoot, "licenses", "Codaryn", "LICENSE"));
    await copyNew(join(root, "NOTICE"), join(packageRoot, "licenses", "Codaryn", "NOTICE"));
    const check = await tools.engine.checkPackagedEngine(join(packageRoot, "resources"), join(appDir, tools.engine.ENGINE_MANIFEST_FILE), PLATFORM);
    if (!check.ok) stop(`the copied payload fails the start check: ${check.reason}`);
    safeLog(log, "the copied payload passes the start check");

    for (const [name, index] of Object.entries(FUSE_INDEX)) {
      if (tools.fuses.FuseV1Options[name] !== index) stop(`@electron/fuses numbers ${name} differently than this script`);
    }
    const exe = join(packageRoot, `${APP_NAME}.exe`);
    if (!(await isRegularFile(exe))) stop(`no ${APP_NAME}.exe in the package`);
    const before = await tools.fuses.getCurrentFuseWire(exe);
    const defaults = defaultsFromWire(before);
    if (!defaults.ok) stop(defaults.message);
    const config = fuseConfig(defaults.values);
    await tools.fuses.flipFuses(exe, config);
    const after = await tools.fuses.getCurrentFuseWire(exe);
    const wrong = wireMismatches(after, config);
    if (wrong.length > 0) stop(`fuses not as set after flipping: ${wrong.join(", ")}`);
    safeLog(log, "fuses set and read back");

    const zipped = await tools.zip({ cwd: out, zip: zipPath, dir: PACKAGE_DIR_NAME });
    if (!zipped.ok) stop(`zip failed: ${zipped.message}`);
    if (!(await isRegularFile(zipPath))) stop("zip reported success but made no file");

    const files = [];
    for (const path of await listTree(packageRoot)) {
      const full = join(packageRoot, ...path.split("/"));
      files.push({ path, size: (await lstat(full)).size, sha256: await sha256File(full) });
    }
    const record = {
      electronVersion: ELECTRON_VERSION,
      inputs: { [ELECTRON_ZIP]: pins.electronZipSha256, "node.exe": pins.nodeExeSha256, "Node LICENSE": pins.nodeLicenseSha256 },
      engineManifestSha256: sha256Text(manifestText),
      fuses: { before, defaults: defaults.values, config, after },
      zip: { name: ZIP_NAME, size: (await lstat(zipPath)).size, sha256: await sha256File(zipPath) },
      files,
    };
    const recordText = `${JSON.stringify(record, null, 2)}\n`;
    zipSha256 = record.zip.sha256;

    // L-new1: everything else is done before the record. The staging folder goes first; if that
    // fails, the run fails and writes no record.
    await io.rm(staging);
    staging = null;
    // Then the record: a temporary name in gui/out (wx), read back, renamed to the final name.
    // Windows' rename replaces an existing file, so the final name is checked just before it; a run
    // started at the same time is the boundary already named for L1.
    if ((await present(io, recordPath)) || (await present(io, partialPath))) stop(`${recordPath} or ${partialPath} appeared during the run`);
    partialMine = true;
    await io.writeNew(partialPath, recordText);
    if ((await io.readText(partialPath)) !== recordText) stop("the record did not read back as written");
    if (await present(io, recordPath)) stop(`${recordPath} appeared during the run`);
    await io.rename(partialPath, recordPath);
    partialMine = false;
  } catch (error) {
    failure = error;
  }

  // Cleanup on every path; nothing from here on throws, so the Promise never rejects.
  const notes = [];
  if (staging !== null) {
    try {
      await io.rm(staging);
    } catch {
      notes.push(`\nthe staging folder ${staging} could not be removed; delete it`);
    }
  }
  if (partialMine) {
    try {
      await io.unlink(partialPath);
    } catch (error) {
      if (error?.code !== "ENOENT") notes.push(`\n${partialPath} could not be removed; delete it`);
    }
  }
  if (failure === null) {
    // Only now, after the rename: exit code 0, "finished:" and the record come together.
    safeLog(log, `done: ${zipPath} (${zipSha256})`);
    safeLog(log, `finished: ${recordPath} is written only by a finished run; without it the output must not be used`);
    return { ok: true, record: recordPath };
  }
  {
    const error = failure;
    const message = error instanceof Stop ? error.message : `unexpected error: ${error?.stack ?? String(error)}`;
    // Anything at these paths now was made by this run (they did not exist at its start).
    const made = [];
    if (started) for (const path of [packageRoot, zipPath]) if (await present(io, path)) made.push(path);
    const left = made.map((path) => `\n${path} is incomplete: do not use it, and remove it before running again`).join("");
    let unfinished = "";
    if (started) {
      unfinished = (await present(io, recordPath))
        ? `\n${recordPath} is there, but this run did not finish: do not trust it`
        : `\nno record file (${RECORD_NAME}) was written: this run did not finish`;
    }
    return { ok: false, message: `${message}${left}${unfinished}${notes.join("")}` };
  }
}

/** Windows' own tar (bsdtar) makes the zip; its path is fixed, not looked up in PATH. */
function windowsZip({ cwd, zip, dir }) {
  if (process.platform !== "win32") return { ok: false, message: "the package is made on Windows only" };
  const tar = join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "tar.exe");
  const result = spawnSync(tar, ["-a", "-c", "-f", zip, "-C", cwd, dir], { shell: false, windowsHide: true, encoding: "utf8" });
  if (result.error !== undefined) return { ok: false, message: String(result.error) };
  if (result.status !== 0) return { ok: false, message: `tar exited with ${result.status}: ${(result.stderr ?? "").trim()}` };
  return { ok: true };
}

async function main() {
  const gui = fileURLToPath(new URL("../../", import.meta.url));
  const root = join(gui, "..");
  const engineModule = join(gui, "build", "src", "main", "packaged-engine.js");
  const nodePathModule = join(gui, "build", "src", "main", "node-path.js");
  if (!existsSync(engineModule) || !existsSync(nodePathModule)) {
    process.stderr.write("gui package: build first: npm run build in the repository root, then in gui\n");
    process.exitCode = 1;
    return;
  }
  const [{ packager }, fuses, engine, { isLocalPathSyntax }] = await Promise.all([
    import("@electron/packager"),
    import("@electron/fuses"),
    import(pathToFileURL(engineModule).href),
    import(pathToFileURL(nodePathModule).href),
  ]);
  const result = await runPackage(
    { gui, root, out: join(gui, "out"), argv: process.argv.slice(2), cwd: process.cwd(), log: (line) => process.stdout.write(`gui package: ${line}\n`) },
    { packager, fuses, zip: windowsZip, engine, isLocalPath: isLocalPathSyntax },
  );
  if (!result.ok) {
    process.stderr.write(`gui package: ${result.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
