/**
 * GU-9 D-7: the packaged build's engine layout and its check against the list inside app.asar
 * (src/main/packaged-engine.ts). Plain Node, temporary folders only: no package, no Electron, no
 * network. The development paths in app.ts are checked in its source, since app.ts needs Electron.
 * Changes during the check are not raced: the check's file operations are wrapped so a change
 * happens at a fixed step, or an identity is reported as changed (gu9-engine-fix, review M1).
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { isLocalPathSyntax } from "../../src/main/node-path.js";
import {
  ENGINE_MANIFEST_FILE,
  NODE_ENGINE_FS,
  PACKAGED_ENGINE_ENTRY,
  PACKAGED_HOST_SCRIPT,
  PACKAGED_NODE,
  PACKAGED_PACKAGE_JSON,
  checkPackagedEngine,
  isListedPath,
  isShortName,
  isWindowsDeviceName,
  packageRootOf,
  packagedEnginePaths,
  parseEngineManifest,
  requiredListedFiles,
} from "../../src/main/packaged-engine.js";
import type { EngineFs, OpenedFile } from "../../src/main/packaged-engine.js";
import { errorText, textsFor } from "../../src/renderer/i18n/catalog.js";
import { EN } from "../../src/renderer/i18n/en.js";
import { KO } from "../../src/renderer/i18n/ko.js";

const GUI = fileURLToPath(new URL("../../../", import.meta.url));
const HANGUL = /[가-힣]/;
const B = "\\";

const BASE_FILES: Readonly<Record<string, string>> = {
  "resources/node/node.exe": "not a real node",
  "resources/engine/build/src/engine-host/main.js": "export {};\n",
  "resources/engine/build/src/shared/protocol.js": "export const P = 1;\n",
  "resources/engine/dist/src/app/index.js": "export const A = 1;\n",
  "resources/engine/dist/src/i18n/index.js": "export const I = 1;\n",
  "package.json": '{ "name": "codaryn", "version": "0.1.0", "type": "module" }\n',
};

interface ListEntry {
  path: string;
  size: number;
  sha256: string;
}
interface List {
  version: number;
  files: ListEntry[];
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Test helper: the list a packaging script would write for these files (sorted, `/` paths). */
function listFor(files: Readonly<Record<string, string>>): List {
  return {
    version: 1,
    files: Object.keys(files)
      .sort()
      .map((path) => ({ path, size: Buffer.byteLength(files[path] ?? ""), sha256: sha256(files[path] ?? "") })),
  };
}

interface Layout {
  readonly root: string;
  readonly resources: string;
  readonly manifestFile: string;
}

/** A temporary `resources` folder with the files and, unless `list` is null, the list next to it. */
function layout(t: TestContext, files: Readonly<Record<string, string>> = BASE_FILES, list: List | string | null = listFor(files)): Layout {
  const root = mkdtempSync(join(tmpdir(), "codaryn-gu9-engine-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const resources = join(root, "resources");
  const app = join(root, "app");
  mkdirSync(resources, { recursive: true });
  mkdirSync(app, { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, ...path.split("/"));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  const manifestFile = join(app, ENGINE_MANIFEST_FILE);
  if (list !== null) writeFileSync(manifestFile, typeof list === "string" ? list : JSON.stringify(list));
  return { root, resources, manifestFile };
}

const check = (l: Layout, fs?: EngineFs) => checkPackagedEngine(l.resources, l.manifestFile, "win32", fs);

/** The real file operations with `open` wrapped: `around` may act before the real open or change what it returns. */
function wrapOpen(around: (file: string, real: () => Promise<OpenedFile>) => Promise<OpenedFile>): EngineFs {
  return { ...NODE_ENGINE_FS, open: (file) => around(file, () => NODE_ENGINE_FS.open(file)) };
}

function linkError(error: unknown): string {
  return (error as { code?: string }).code ?? String(error);
}

test("gu9 D-7: packaged paths are under resourcesPath, and only Windows gets a packaged Node", () => {
  const resources = join("P", "resources");
  assert.equal(packageRootOf(resources), "P");
  const win = packagedEnginePaths(resources, "win32");
  assert.equal(win.nodePath, join(resources, "node", "node.exe"));
  assert.equal(win.hostScript, join(resources, "engine", "build", "src", "engine-host", "main.js"));
  assert.equal(win.engineDir, join(resources, "engine", "dist", "src"));
  assert.equal(packagedEnginePaths(resources, "linux").nodePath, null);
  assert.deepEqual([...requiredListedFiles("win32")].sort(), [PACKAGED_ENGINE_ENTRY, PACKAGED_HOST_SCRIPT, PACKAGED_NODE, PACKAGED_PACKAGE_JSON].sort());
  assert.equal(requiredListedFiles("linux").includes(PACKAGED_NODE), false);
  assert.equal(requiredListedFiles("linux").includes(PACKAGED_PACKAGE_JSON), true);
});

test("gu9 D-7: the development paths in app.ts are the ones they were; the packaged branch comes first", () => {
  const source = readFileSync(join(GUI, "src", "main", "app.ts"), "utf8").split(/\r?\n/);
  const at = (line: string): number => {
    const index = source.indexOf(line);
    assert.notEqual(index, -1, `app.ts keeps: ${line.trim()}`);
    return index;
  };
  const packaged = at("  if (app.isPackaged) return startPackagedHost(options);");
  const engineDir = at('  const engineDir = join(options.guiRoot, "..", "dist", "src");');
  at("  const nodePath = app.isPackaged ? null : findDevelopmentNode(process.env, process.platform, isFile);");
  at('  if (nodePath === null) return { ok: false, failure: "node_not_found" };');
  at('  if (!existsSync(join(engineDir, "app", "index.js"))) return { ok: false, failure: "engine_not_built" };');
  at('    hostScript: join(options.guiRoot, "build", "src", "engine-host", "main.js"),');
  assert.ok(packaged === engineDir - 1, "the packaged branch is the first line of startHost");
  at('  if (!check.ok) return { ok: false, failure: "engine_integrity_failed" };');
});

test("gu9 D-7: files that match the list pass", async (t) => {
  assert.deepEqual(await check(layout(t)), { ok: true });
});

test("gu9 D-7: an empty extra folder holds no file and passes", async (t) => {
  const l = layout(t);
  mkdirSync(join(l.resources, "engine", "empty"));
  assert.deepEqual(await check(l), { ok: true });
});

test("gu9 D-7: one changed file fails, even with the same size", async (t) => {
  const l = layout(t);
  writeFileSync(join(l.resources, "node", "node.exe"), "not a real nodf");
  assert.deepEqual(await check(l), { ok: false, reason: "hash_mismatch" });
});

test("gu9 D-7: a file of another size fails", async (t) => {
  const l = layout(t);
  writeFileSync(join(l.resources, "engine", "dist", "src", "app", "index.js"), "export const A = 12;\n");
  assert.deepEqual(await check(l), { ok: false, reason: "size_mismatch" });
});

test("gu9 D-7: a listed file that is missing fails", async (t) => {
  const l = layout(t);
  unlinkSync(join(l.resources, "engine", "build", "src", "shared", "protocol.js"));
  assert.deepEqual(await check(l), { ok: false, reason: "file_missing" });
});

test("gu9 D-7: a file that is not listed fails, under engine/ and under node/", async (t) => {
  const a = layout(t);
  writeFileSync(join(a.resources, "engine", "dist", "src", "extra.js"), "export {};\n");
  assert.deepEqual(await check(a), { ok: false, reason: "file_extra" });
  const b = layout(t);
  writeFileSync(join(b.resources, "node", "npm.cmd"), "@echo off\n");
  assert.deepEqual(await check(b), { ok: false, reason: "file_extra" });
});

test("gu9 D-7: no list fails", async (t) => {
  assert.deepEqual(await check(layout(t, BASE_FILES, null)), { ok: false, reason: "manifest_missing" });
});

test("gu9 D-7: a list that cannot be read (a folder in its place) fails", async (t) => {
  const l = layout(t, BASE_FILES, null);
  mkdirSync(l.manifestFile);
  assert.deepEqual(await check(l), { ok: false, reason: "manifest_unreadable" });
});

test("gu9 D-7: a list without a file the start needs fails", async (t) => {
  const files = { ...BASE_FILES };
  delete files["resources/node/node.exe"];
  const l = layout(t, files);
  assert.deepEqual(await check(l), { ok: false, reason: "manifest_incomplete" });
});

test("gu9 D-7: list paths are relative, inside node/ or engine/, without .., drive, backslash or empty part", () => {
  for (const good of ["package.json", "resources/node/node.exe", "resources/engine/dist/src/app/index.js", "resources/engine/a b.js", "resources/engine/console.js", "resources/engine/~a.js", "resources/engine/comx.js"]) {
    assert.equal(isListedPath(good), true, good);
  }
  const bad = [
    "resources/engine/../node/node.exe",
    "/resources/engine/a.js",
    "C:/resources/engine/a.js",
    "resources/engine" + B + "a.js",
    "resources/engine//a.js",
    "resources/engine/./a.js",
    "resources/engine/a.js/",
    "other/a.js",
    "resources/other/a.js",
    "resources/engine",
    "resources",
    "engine/a.js",
    "node/node.exe",
    "resources/package.json",
    "./package.json",
    "Package.json",
    "",
    "resources/node/node.exe:stream",
    "resources/engine/a\u0000.js",
    "resources/engine/a\n.js",
    "x".repeat(1025),
    7,
    null,
  ];
  for (const value of bad) assert.equal(isListedPath(value), false, JSON.stringify(value));
});

test("gu9 D-7 I1: parts Windows reads as another name are refused in the list", () => {
  const aliases = [
    "resources/engine/a.js.",
    "resources/engine/a.js ",
    "resources/engine/dir./a.js",
    "resources/engine/nul",
    "resources/engine/NUL.txt",
    "resources/engine/con .x",
    "resources/engine/com1",
    "resources/engine/COM9.js",
    "resources/engine/lpt1.js",
    "resources/engine/lpt9",
    "resources/engine/aux",
    "resources/engine/prn.log",
    "resources/engine/conin$",
    "resources/engine/PROGRA~1/a.js",
    "resources/node/NODE~1.EXE",
  ];
  for (const value of aliases) assert.equal(isListedPath(value), false, value);
});

test("gu9 D-7 I1: the device name rule is node-path.ts's (through isLocalPathSyntax)", () => {
  const parts = ["nul", "NUL", "nul.txt", "con.txt", "con .x", "prn ", "aux.js", "com1", "COM¹", "lpt0", "lpt9.js", "conin$", "CONOUT$", "console", "com", "comx", "a", "nullable"];
  for (const part of parts) {
    assert.equal(isWindowsDeviceName(part), !isLocalPathSyntax("C:" + B + "x" + B + part, "win32"), part);
  }
});

test("gu9 D-7: a list of the wrong form fails, and so does the check", async (t) => {
  const good = listFor(BASE_FILES);
  const first = good.files[0];
  assert.ok(first !== undefined);
  const variants: Record<string, unknown> = {
    "dot-dot path": { ...good, files: [{ ...first, path: "resources/engine/../node/node.exe" }, ...good.files.slice(1)] },
    "absolute path": { ...good, files: [{ ...first, path: "/resources/engine/a.js" }] },
    "upper-case hash": { ...good, files: [{ ...first, sha256: first.sha256.toUpperCase() }, ...good.files.slice(1)] },
    "short hash": { ...good, files: [{ ...first, sha256: first.sha256.slice(1) }] },
    "same path twice": { ...good, files: [first, first, ...good.files.slice(1)] },
    "paths that differ in case only": {
      ...good,
      files: [
        { path: "resources/engine/A.js", size: 0, sha256: sha256("") },
        { path: "resources/engine/a.js", size: 0, sha256: sha256("") },
      ],
    },
    "out of order": { ...good, files: [...good.files].reverse() },
    "negative size": { ...good, files: [{ ...first, size: -1 }] },
    "fractional size": { ...good, files: [{ ...first, size: 1.5 }] },
    "size as text": { ...good, files: [{ ...first, size: "15" }] },
    "version 2": { ...good, version: 2 },
    "no version": { files: good.files },
    "unknown field": { ...good, note: "x" },
    "unknown entry field": { ...good, files: [{ ...first, mode: 420 }] },
    "files not a list": { ...good, files: {} },
    "a list at the top": [good],
  };
  for (const [name, value] of Object.entries(variants)) assert.equal(parseEngineManifest(JSON.stringify(value)), null, name);
  assert.equal(parseEngineManifest("{ not json"), null, "not JSON");
  assert.equal(parseEngineManifest(`\ufeff${JSON.stringify(good)}`), null, "a byte order mark");
  assert.notEqual(parseEngineManifest(JSON.stringify(good)), null, "the good list parses");
  const upper = { ...good, files: good.files.map((file) => ({ ...file, sha256: file.sha256.toUpperCase() })) };
  assert.deepEqual(await check(layout(t, BASE_FILES, upper)), { ok: false, reason: "manifest_invalid" });
  assert.deepEqual(await check(layout(t, BASE_FILES, "{ not json")), { ok: false, reason: "manifest_invalid" });
});

test("gu9 D-7: a junction or directory link met on the walk under engine/ fails", async (t) => {
  const l = layout(t);
  const target = join(l.root, "elsewhere");
  mkdirSync(target);
  writeFileSync(join(target, "hidden.js"), "export {};\n");
  try {
    symlinkSync(target, join(l.resources, "engine", "linked"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`could not make a directory link here: ${linkError(error)}`);
    return;
  }
  assert.deepEqual(await check(l), { ok: false, reason: "file_not_regular" });
});

test("gu9 D-7: engine/ itself as a link fails", async (t) => {
  const l = layout(t);
  const real = join(l.root, "real-engine");
  const engine = join(l.resources, "engine");
  // Move the engine folder aside and put a link in its place: the files are all there behind it.
  renameSync(engine, real);
  try {
    symlinkSync(real, engine, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`could not make a directory link here: ${linkError(error)}`);
    return;
  }
  assert.deepEqual(await check(l), { ok: false, reason: "file_not_regular" });
});

test("gu9 D-7: a file link met on the walk under engine/ fails", async (t) => {
  const l = layout(t);
  const target = join(l.root, "elsewhere.js");
  writeFileSync(target, "export {};\n");
  try {
    symlinkSync(target, join(l.resources, "engine", "link.js"), "file");
  } catch (error) {
    // Windows makes file links only with developer mode or an elevated user.
    t.skip(`could not make a file link here: ${linkError(error)}`);
    return;
  }
  assert.deepEqual(await check(l), { ok: false, reason: "file_not_regular" });
});

test("gu9 D-7 I2: an entry that is neither a file, a folder nor a link fails", async (t) => {
  const l = layout(t);
  const fs: EngineFs = {
    ...NODE_ENGINE_FS,
    entry: async (path) => {
      const info = await NODE_ENGINE_FS.entry(path);
      return path.endsWith("protocol.js") ? { ...info, kind: "other" } : info;
    },
  };
  assert.deepEqual(await check(l, fs), { ok: false, reason: "file_not_regular" });
});

test("gu9 D-7 I2: a read error while checking fails", async (t) => {
  const l = layout(t);
  const fs = wrapOpen(async (file, real) => {
    if (file.endsWith("index.js")) throw Object.assign(new Error("denied"), { code: "EACCES" });
    return real();
  });
  assert.deepEqual(await check(l, fs), { ok: false, reason: "read_failed" });
});

test("gu9 D-7 M1: the opened file is another file than the walk saw (identity) and fails", async (t) => {
  const l = layout(t);
  const fs = wrapOpen(async (file, real) => {
    const opened = await real();
    if (!file.endsWith("node.exe")) return opened;
    return { ...opened, info: async () => ({ ...(await opened.info()), ino: (await opened.info()).ino + 1n }) };
  });
  assert.deepEqual(await check(l, fs), { ok: false, reason: "file_changed" });
});

test("gu9 D-7 M1: the opened file's size is not the walk's and fails", async (t) => {
  const l = layout(t);
  const fs = wrapOpen(async (file, real) => {
    const opened = await real();
    if (!file.endsWith("main.js")) return opened;
    return { ...opened, info: async () => ({ ...(await opened.info()), size: (await opened.info()).size + 1n }) };
  });
  assert.deepEqual(await check(l, fs), { ok: false, reason: "file_changed" });
});

test("gu9 D-7 M1: fewer bytes read from the handle than its size fails", async (t) => {
  const l = layout(t);
  const fs = wrapOpen(async (file, real) => {
    const opened = await real();
    return file.endsWith("protocol.js") ? { ...opened, read: async () => 0 } : opened;
  });
  assert.deepEqual(await check(l, fs), { ok: false, reason: "file_changed" });
});

test("gu9 D-7 M1: the size and the hash are of the one open handle", async (t) => {
  const l = layout(t);
  const reads: string[] = [];
  const fs = wrapOpen(async (file, real) => {
    const opened = await real();
    return {
      ...opened,
      read: async (buffer, position) => {
        reads.push(file);
        return opened.read(buffer, position);
      },
    };
  });
  assert.deepEqual(await check(l, fs), { ok: true });
  assert.equal(new Set(reads).size, Object.keys(BASE_FILES).length, "every listed file is read through its handle");
});

test("gu9 D-7 M1: a file that appears during the check fails at the second walk", async (t) => {
  const l = layout(t);
  let added = false;
  const fs = wrapOpen(async (file, real) => {
    if (!added) {
      added = true;
      writeFileSync(join(l.resources, "engine", "dist", "src", "late.js"), "export {};\n");
    }
    return real();
  });
  assert.deepEqual(await check(l, fs), { ok: false, reason: "tree_changed" });
});

test("gu9 D-7 M1: a folder swapped for a junction during the check fails at the second walk", async (t) => {
  const l = layout(t);
  const shared = join(l.resources, "engine", "build", "src", "shared");
  const moved = join(l.root, "shared-moved");
  let swapped: string | null = null;
  const fs = wrapOpen(async (file, real) => {
    if (swapped === null) {
      renameSync(shared, moved);
      try {
        symlinkSync(moved, shared, process.platform === "win32" ? "junction" : "dir");
        swapped = "yes";
      } catch (error) {
        renameSync(moved, shared);
        swapped = linkError(error);
      }
    }
    return real();
  });
  const result = await check(l, fs);
  if (swapped !== "yes") {
    t.skip(`could not make a directory link here: ${swapped ?? "no open"}`);
    return;
  }
  assert.deepEqual(result, { ok: false, reason: "tree_changed" });
});

test("gu9 D-7 L1: only the 8.3 short name form is refused; long names with ~ and a digit are allowed", () => {
  for (const part of ["PROGRA~1", "progra~1.exe", "AB~12.JS", "NODE~1.EXE", "A~1"]) assert.equal(isShortName(part), true, part);
  for (const part of ["report~2026-draft.js", "a~b.js", "file~1.longext", "name12345.js", "v1.2.3.js", "~a.js", "abcdefghi~1", "x.y.z~1"]) {
    assert.equal(isShortName(part), false, part);
  }
  for (const path of ["resources/engine/report~2026-draft.js", "resources/engine/a~b.js", "resources/engine/file~1.longext", "resources/engine/name12345.js", "resources/engine/v1.2.3.js"]) {
    assert.equal(isListedPath(path), true, path);
  }
  for (const path of ["resources/engine/PROGRA~1/a.js", "resources/engine/progra~1.exe", "resources/engine/AB~12.JS"]) assert.equal(isListedPath(path), false, path);
});

/** The real file operations, counting opens per file and closes, with `change` able to alter what an open returns. */
function counting(change: (file: string, opened: OpenedFile) => OpenedFile = (_file, opened) => opened): {
  readonly fs: EngineFs;
  readonly opens: Map<string, number>;
  readonly closed: () => number;
} {
  const opens = new Map<string, number>();
  let closed = 0;
  const fs: EngineFs = {
    ...NODE_ENGINE_FS,
    open: async (file) => {
      opens.set(file, (opens.get(file) ?? 0) + 1);
      const real = await NODE_ENGINE_FS.open(file);
      const counted: OpenedFile = {
        ...real,
        close: async () => {
          closed += 1;
          await real.close();
        },
      };
      return change(file, counted);
    },
  };
  return { fs, opens, closed: () => closed };
}

const openCount = (opens: Map<string, number>): number => [...opens.values()].reduce((sum, n) => sum + n, 0);

test("gu9 D-7 I-new1: each file is opened once and every handle is closed, on success and on failure", async (t) => {
  const ok = counting();
  assert.deepEqual(await check(layout(t), ok.fs), { ok: true });
  assert.equal(ok.opens.size, Object.keys(BASE_FILES).length, "every listed file is opened");
  assert.ok([...ok.opens.values()].every((n) => n === 1), "no file is opened twice");
  assert.equal(ok.closed(), openCount(ok.opens), "every handle is closed");

  const bad = layout(t);
  writeFileSync(join(bad.resources, "engine", "dist", "src", "app", "index.js"), "export const B = 1;\n");
  const mismatch = counting();
  assert.deepEqual(await check(bad, mismatch.fs), { ok: false, reason: "hash_mismatch" });
  assert.ok(openCount(mismatch.opens) > 0);
  assert.equal(mismatch.closed(), openCount(mismatch.opens), "closed after a hash mismatch");

  const changed = counting((file, opened) =>
    file.endsWith("main.js") ? { ...opened, info: async () => ({ ...(await opened.info()), ino: (await opened.info()).ino + 1n }) } : opened,
  );
  assert.deepEqual(await check(layout(t), changed.fs), { ok: false, reason: "file_changed" });
  assert.equal(changed.closed(), openCount(changed.opens), "closed after an identity change");
});

test("gu9 D-7 I-new1: a file over 1 MiB is read in several chunks from one handle and its hash still matches", async (t) => {
  const unit = "0123456789abcdefghijklmnopqrstuvwxyz";
  const big = unit.repeat(Math.ceil((1024 * 1024 + 12345) / unit.length)).slice(0, 1024 * 1024 + 12345);
  const files = { ...BASE_FILES, "resources/node/node.exe": big };
  const reads: number[] = [];
  const watched = counting((file, opened) =>
    file.endsWith("node.exe")
      ? {
          ...opened,
          read: async (buffer, position) => {
            reads.push(position);
            return opened.read(buffer, position);
          },
        }
      : opened,
  );
  const l = layout(t, files);
  assert.deepEqual(await check(l, watched.fs), { ok: true });
  assert.deepEqual(reads, [0, 1024 * 1024, 1024 * 1024 + 12345], "two chunks, then the end");
  assert.equal(watched.opens.get(join(l.resources, "node", "node.exe")), 1, "the large file is opened once");
  assert.equal(watched.closed(), openCount(watched.opens));
});

test("gu9 D-7 I-new1: a read error partway through a file fails the check and the handle is closed", async (t) => {
  const unit = "abcdefghij";
  const big = unit.repeat(Math.ceil((1024 * 1024 + 10) / unit.length));
  const files = { ...BASE_FILES, "resources/node/node.exe": big };
  let calls = 0;
  const failing = counting((file, opened) =>
    file.endsWith("node.exe")
      ? {
          ...opened,
          read: async (buffer, position) => {
            calls += 1;
            if (calls === 2) throw Object.assign(new Error("device error"), { code: "EIO" });
            return opened.read(buffer, position);
          },
        }
      : opened,
  );
  assert.deepEqual(await check(layout(t, files), failing.fs), { ok: false, reason: "read_failed" });
  assert.equal(calls, 2, "the error came after the first chunk");
  assert.equal(failing.closed(), openCount(failing.opens), "the handle that failed is closed");
});

test("gu9 D-7 I-new1: an opened file on another volume (dev) fails like another file id", async (t) => {
  const moved = counting((file, opened) =>
    file.endsWith("protocol.js") ? { ...opened, info: async () => ({ ...(await opened.info()), dev: (await opened.info()).dev + 1n }) } : opened,
  );
  assert.deepEqual(await check(layout(t), moved.fs), { ok: false, reason: "file_changed" });
  assert.equal(moved.closed(), openCount(moved.opens));
});

test("gu9 D-7 I-new1: a folder whose identity differs at the second walk fails", async (t) => {
  const l = layout(t);
  const dist = join(l.resources, "engine", "dist");
  let hashing = false;
  const fs: EngineFs = {
    ...NODE_ENGINE_FS,
    open: async (file) => {
      hashing = true;
      return NODE_ENGINE_FS.open(file);
    },
    entry: async (path) => {
      const info = await NODE_ENGINE_FS.entry(path);
      return hashing && path === dist ? { ...info, ino: info.ino + 1n } : info;
    },
  };
  assert.deepEqual(await check(l, fs), { ok: false, reason: "tree_changed" });
});

test("gu9 package A: the root package.json is listed and checked like the trees", async (t) => {
  const missing = layout(t);
  unlinkSync(join(missing.root, "package.json"));
  assert.deepEqual(await check(missing), { ok: false, reason: "file_missing" });

  const changed = layout(t);
  writeFileSync(join(changed.root, "package.json"), '{ "name": "codaryx", "version": "0.1.0", "type": "module" }\n');
  assert.deepEqual(await check(changed), { ok: false, reason: "hash_mismatch" });

  const folder = layout(t);
  unlinkSync(join(folder.root, "package.json"));
  mkdirSync(join(folder.root, "package.json"));
  assert.deepEqual(await check(folder), { ok: false, reason: "file_not_regular" });

  const files = { ...BASE_FILES };
  delete files["package.json"];
  assert.deepEqual(await check(layout(t, files)), { ok: false, reason: "manifest_incomplete" });
});

test("gu9 package A: the root package.json as a file link fails", async (t) => {
  const l = layout(t);
  const target = join(l.root, "elsewhere-package.json");
  writeFileSync(target, BASE_FILES["package.json"] ?? "");
  unlinkSync(join(l.root, "package.json"));
  try {
    symlinkSync(target, join(l.root, "package.json"), "file");
  } catch (error) {
    t.skip(`could not make a file link here: ${linkError(error)}`);
    return;
  }
  assert.deepEqual(await check(l), { ok: false, reason: "file_not_regular" });
});

test("gu9 package A: resources itself as a link fails", async (t) => {
  const l = layout(t);
  const real = join(l.root, "real-resources");
  renameSync(l.resources, real);
  try {
    symlinkSync(real, l.resources, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`could not make a directory link here: ${linkError(error)}`);
    return;
  }
  assert.deepEqual(await check(l), { ok: false, reason: "file_not_regular" });
});

test("gu9 package A: the rest of the package folder is not part of this check", async (t) => {
  const l = layout(t);
  writeFileSync(join(l.root, "Codaryn.exe"), "not an exe");
  writeFileSync(join(l.root, "LICENSE"), "electron license");
  writeFileSync(join(l.resources, "app.asar"), "not an asar");
  mkdirSync(join(l.root, "licenses", "Codaryn"), { recursive: true });
  writeFileSync(join(l.root, "licenses", "Codaryn", "NOTICE"), "Codaryn\n");
  assert.deepEqual(await check(l), { ok: true });
});

test("gu9 D-7: the new failure has a text in both languages that says what to do", () => {
  assert.match(EN["error.engine_integrity_failed"], /Install the app again/);
  assert.match(KO["error.engine_integrity_failed"], HANGUL);
  assert.match(KO["error.engine_integrity_failed"], /다시 설치/);
  assert.doesNotMatch(EN["error.engine_integrity_failed"], HANGUL);
  assert.equal(errorText(textsFor("en"), "engine_integrity_failed"), EN["error.engine_integrity_failed"]);
  assert.equal(errorText(textsFor("ko"), "engine_integrity_failed"), KO["error.engine_integrity_failed"]);
});
