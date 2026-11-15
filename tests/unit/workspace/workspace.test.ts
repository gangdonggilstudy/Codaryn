import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { MAX_READ_BYTES, MAX_SEARCH_ENTRIES, asRawText } from "../../../src/contracts/index.js";
import type { ResolvedPath, Workspace } from "../../../src/contracts/index.js";
import { nodeFileLayer } from "../../../src/workspace/file-layer.js";
import type { FileLayer } from "../../../src/workspace/file-layer.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { createWorkspaceWithFileLayer } from "../../../src/workspace/workspace.js";

const IS_WINDOWS = process.platform === "win32";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

let base: string;
let root: string;
let outside: string;
let workspace: Workspace;

before(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-ws-"));
  root = path.join(base, "root");
  outside = path.join(base, "outside");
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  fs.mkdirSync(path.join(root, ".codaryn"));
  fs.writeFileSync(path.join(root, ".codaryn", "journal.jsonl"), "{}\n");
  fs.writeFileSync(path.join(outside, "secret.txt"), "outside\n");
  workspace = await createWorkspace({ root });
});

after(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

async function resolved(input: string, access: "read" | "write" | "cwd" = "read"): Promise<ResolvedPath> {
  const outcome = await workspace.resolve(input, access);
  assert.equal(outcome.ok, true, `resolve(${JSON.stringify(input)}) should succeed`);
  assert.ok(outcome.ok);
  return outcome.path;
}

async function denial(input: string): Promise<string> {
  const outcome = await workspace.resolve(input, "write");
  assert.equal(outcome.ok, false, `resolve(${JSON.stringify(input)}) should be denied`);
  assert.ok(!outcome.ok);
  return outcome.code;
}

/** Creates a directory link without elevated rights where possible. Returns false when it cannot. */
function tryLinkDir(target: string, link: string): boolean {
  try {
    fs.symlinkSync(target, link, "junction");
    return true;
  } catch {
    return false;
  }
}

describe("Workspace.resolve", () => {
  test("root is the real path of the given directory", () => {
    assert.equal(workspace.root, fs.realpathSync.native(root));
  });

  test("accepts relative and absolute paths inside the root", async () => {
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "a.txt"), "a\n");

    const relative = await resolved("src/a.txt");
    assert.equal(relative.relative, "src/a.txt");
    assert.equal(relative.absolute, path.join(workspace.root, "src", "a.txt"));

    const absolute = await resolved(path.join(workspace.root, "src", "a.txt"));
    assert.equal(absolute.relative, "src/a.txt");

    assert.equal((await resolved(".")).relative, ".");
    assert.equal((await resolved("src/../src/./a.txt")).relative, "src/a.txt");
    assert.equal((await resolved("new/deep/file.txt", "write")).relative, "new/deep/file.txt");
  });

  test("rejects paths that leave the root", async () => {
    assert.equal(await denial(".."), "outside_root");
    assert.equal(await denial("../outside/secret.txt"), "outside_root");
    assert.equal(await denial("src/../../outside/secret.txt"), "outside_root");
    assert.equal(await denial(path.join(outside, "secret.txt")), "outside_root");
    assert.equal(await denial(`${workspace.root}-sibling`), "outside_root");
  });

  test("rejects the state directory", async () => {
    assert.equal(await denial(".codaryn"), "state_dir");
    assert.equal(await denial(".codaryn/journal.jsonl"), "state_dir");
    assert.equal(await denial("src/../.codaryn/new.txt"), "state_dir");
    assert.equal(await denial(".CODARYN/journal.jsonl"), "state_dir");
    assert.equal(await denial(path.join(workspace.root, ".codaryn", "lock.json")), "state_dir");
  });

  test("rejects empty paths and NUL characters", async () => {
    assert.equal(await denial(""), "invalid_path");
    assert.equal(await denial("src/a\0.txt"), "invalid_path");
  });

  test("rejects UNC, device, stream and drive-relative paths on Windows", { skip: !IS_WINDOWS }, async () => {
    for (const input of [
      "\\\\server\\share\\file.txt",
      "//server/share/file.txt",
      "\\\\.\\C:\\file.txt",
      "\\\\?\\C:\\file.txt",
      "src/a.txt:stream",
      "src/a.txt::$DATA",
      "C:file.txt",
      "NUL",
      "src/con.txt",
      "src/COM1",
      ".codaryn./journal.jsonl",
      ".codaryn /journal.jsonl",
      "src/a?.txt",
    ]) {
      assert.equal(await denial(input), "invalid_path", input);
    }
  });

  test("an 8.3 short name of the state directory is still the state directory", { skip: !IS_WINDOWS }, async (t) => {
    const short = fs.readdirSync(root).includes(".codaryn") ? path.join(root, "CODARY~1") : "";
    if (short === "" || !fs.existsSync(short)) {
      t.skip("8.3 short names are not generated on this volume");
      return;
    }
    assert.equal(await denial("CODARY~1/journal.jsonl"), "state_dir");
    assert.equal(await denial("CODARY~1/new.txt"), "state_dir");
  });

  test("compares without case on Windows", { skip: !IS_WINDOWS }, async () => {
    const upper = await resolved(path.join(workspace.root.toUpperCase(), "SRC", "A.TXT"));
    assert.equal(upper.relative, "src/a.txt");
  });

  test("rejects a link that points outside the root", async (t) => {
    const link = path.join(root, "link-out");
    if (!tryLinkDir(outside, link)) {
      t.skip("cannot create a directory link on this system");
      return;
    }
    assert.equal(await denial("link-out"), "outside_root");
    assert.equal(await denial("link-out/secret.txt"), "outside_root");
    assert.equal(await denial("link-out/new/file.txt"), "outside_root");
  });

  test("rejects a link into the state directory and a dangling link", async (t) => {
    const stateLink = path.join(root, "link-state");
    const dangling = path.join(root, "link-dangling");
    if (!tryLinkDir(path.join(root, ".codaryn"), stateLink) || !tryLinkDir(path.join(outside, "missing"), dangling)) {
      t.skip("cannot create a directory link on this system");
      return;
    }
    assert.equal(await denial("link-state/journal.jsonl"), "state_dir");
    assert.equal(await denial("link-dangling"), "outside_root");
    assert.equal(await denial("link-dangling/file.txt"), "outside_root");
  });

  test("accepts a link that stays inside the root and reports the real path", async (t) => {
    fs.mkdirSync(path.join(root, "real-dir"), { recursive: true });
    if (!tryLinkDir(path.join(root, "real-dir"), path.join(root, "link-in"))) {
      t.skip("cannot create a directory link on this system");
      return;
    }
    assert.equal((await resolved("link-in/file.txt")).relative, "real-dir/file.txt");
  });
});

describe("Workspace.readText", () => {
  test("returns the exact decoding and the hash of the bytes", async () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("가나다\r\nabc\n", "utf8")]);
    fs.writeFileSync(path.join(root, "bom.txt"), bytes);

    const outcome = await workspace.readText(await resolved("bom.txt"));
    assert.ok(outcome.ok);
    assert.equal(outcome.snapshot.text, "\uFEFF가나다\r\nabc\n");
    assert.equal(outcome.snapshot.hash, sha256(bytes));
    assert.equal(outcome.snapshot.path.relative, "bom.txt");
  });

  test("reports not_found, too_large and not_text", async () => {
    fs.writeFileSync(path.join(root, "limit.txt"), Buffer.alloc(MAX_READ_BYTES, 0x61));
    fs.writeFileSync(path.join(root, "big.txt"), Buffer.alloc(MAX_READ_BYTES + 1, 0x61));
    fs.writeFileSync(path.join(root, "bad-utf8.txt"), Buffer.from([0x61, 0xff, 0xfe, 0x62]));
    fs.writeFileSync(path.join(root, "cut-utf8.txt"), Buffer.from("한", "utf8").subarray(0, 2));
    fs.writeFileSync(path.join(root, "zero-byte.bin"), Buffer.from([0x61, 0x00, 0x62]));

    const code = async (name: string): Promise<string> => {
      const outcome = await workspace.readText(await resolved(name));
      return outcome.ok ? "ok" : outcome.code;
    };
    assert.equal(await code("limit.txt"), "ok");
    assert.equal(await code("big.txt"), "too_large");
    assert.equal(await code("bad-utf8.txt"), "not_text");
    assert.equal(await code("cut-utf8.txt"), "not_text");
    assert.equal(await code("zero-byte.bin"), "not_text");
    assert.equal(await code("missing.txt"), "not_found");
    assert.equal(await code("src"), "not_text");
  });

  test("refuses a path object that resolve did not issue", async () => {
    const forged = { absolute: path.join(outside, "secret.txt"), relative: "secret.txt" } as unknown as ResolvedPath;
    assert.deepEqual(await workspace.readText(forged), { ok: false, code: "io_error" });
    assert.deepEqual(await workspace.list(forged), { ok: false, code: "io_error" });
    assert.deepEqual(
      await workspace.writeText({ path: forged, expectedHash: sha256(Buffer.from("outside\n")), text: asRawText("x") }),
      { ok: false, code: "io_error" },
    );
    assert.equal(fs.readFileSync(path.join(outside, "secret.txt"), "utf8"), "outside\n");
  });
});

describe("Workspace.writeText", () => {
  test("WS-01 refuses to write when the current hash differs from the expected hash", async () => {
    const dir = path.join(root, "ws01");
    fs.mkdirSync(dir);
    const file = path.join(dir, "note.txt");
    fs.writeFileSync(file, "first\n");
    const target = await resolved("ws01/note.txt", "write");
    const read = await workspace.readText(target);
    assert.ok(read.ok);

    // Someone else changes the file after the read.
    const userBytes = Buffer.from("changed by the user\n");
    fs.writeFileSync(file, userBytes);

    const stale = await workspace.writeText({ path: target, expectedHash: read.snapshot.hash, text: asRawText("mine\n") });
    assert.deepEqual(stale, { ok: false, code: "conflict", currentHash: sha256(userBytes) });

    const mustNotExist = await workspace.writeText({ path: target, expectedHash: null, text: asRawText("mine\n") });
    assert.deepEqual(mustNotExist, { ok: false, code: "conflict", currentHash: sha256(userBytes) });

    const missing = await workspace.writeText({
      path: await resolved("ws01/absent.txt", "write"),
      expectedHash: read.snapshot.hash,
      text: asRawText("mine\n"),
    });
    assert.deepEqual(missing, { ok: false, code: "conflict", currentHash: null });

    assert.deepEqual(fs.readFileSync(file), userBytes);
    assert.deepEqual(fs.readdirSync(dir), ["note.txt"]);
  });

  test("writes when the hash matches and creates new files only with expectedHash null", async () => {
    const created = await workspace.writeText({
      path: await resolved("made/sub/new.txt", "write"),
      expectedHash: null,
      text: asRawText("one\n"),
    });
    const oneHash = sha256(Buffer.from("one\n"));
    assert.deepEqual(created, { ok: true, previousHash: null, newHash: oneHash, created: true });

    const updated = await workspace.writeText({
      path: await resolved("made/sub/new.txt", "write"),
      expectedHash: oneHash,
      text: asRawText("two\n"),
    });
    assert.deepEqual(updated, {
      ok: true,
      previousHash: oneHash,
      newHash: sha256(Buffer.from("two\n")),
      created: false,
    });
    assert.deepEqual(fs.readFileSync(path.join(root, "made", "sub", "new.txt")), Buffer.from("two\n"));
    assert.deepEqual(fs.readdirSync(path.join(root, "made", "sub")), ["new.txt"]);
  });

  for (const step of ["writeNewFile", "rename"] as const) {
    test(`WS-02 keeps the original and removes the temporary file when ${step} fails`, async () => {
      const dir = path.join(root, `ws02-${step}`);
      fs.mkdirSync(dir);
      const file = path.join(dir, "data.txt");
      const original = Buffer.from("원본 내용\r\n", "utf8");
      fs.writeFileSync(file, original);

      const calls: string[] = [];
      const failing: FileLayer = {
        ...nodeFileLayer,
        writeNewFile: async (target, bytes) => {
          calls.push("writeNewFile");
          if (step === "writeNewFile") {
            // A partial temporary file is left behind before the failure.
            fs.writeFileSync(target, bytes.subarray(0, 3));
            throw Object.assign(new Error("injected write failure"), { code: "ENOSPC" });
          }
          if (step === "rename" && !target.endsWith(".codaryn-tmp")) {
            // The exclusive-create fallback that publishes a new file fails as well.
            throw Object.assign(new Error("injected create failure"), { code: "ENOSPC" });
          }
          await nodeFileLayer.writeNewFile(target, bytes);
        },
        // "rename" stands for the publish step: rename for a replacement, link for a new file.
        rename: async (from, to) => {
          calls.push("rename");
          if (step === "rename") {
            throw Object.assign(new Error("injected rename failure"), { code: "EPERM" });
          }
          await nodeFileLayer.rename(from, to);
        },
        link: async (existing, to) => {
          calls.push("link");
          if (step === "rename") {
            throw Object.assign(new Error("injected link failure"), { code: "EPERM" });
          }
          await nodeFileLayer.link(existing, to);
        },
      };
      const faulty = await createWorkspaceWithFileLayer({ root }, failing);
      const target = await faulty.resolve(`ws02-${step}/data.txt`, "write");
      assert.ok(target.ok);

      const outcome = await faulty.writeText({
        path: target.path,
        expectedHash: sha256(original),
        text: asRawText("새 내용\r\n"),
      });

      assert.deepEqual(outcome, { ok: false, code: "io_error" });
      assert.deepEqual(calls, step === "rename" ? ["writeNewFile", "rename"] : ["writeNewFile"]);
      assert.deepEqual(fs.readFileSync(file), original);
      assert.deepEqual(fs.readdirSync(dir), ["data.txt"]);

      // A new file that fails to be created leaves nothing behind either.
      const fresh = await faulty.resolve(`ws02-${step}/fresh.txt`, "write");
      assert.ok(fresh.ok);
      assert.deepEqual(await faulty.writeText({ path: fresh.path, expectedHash: null, text: asRawText("x") }), {
        ok: false,
        code: "io_error",
      });
      assert.deepEqual(fs.readdirSync(dir), ["data.txt"]);
    });
  }

  /** A file layer that runs `change` once, right after the temporary file is written. */
  function racingLayer(target: string, change: () => void): FileLayer {
    let fired = false;
    return {
      ...nodeFileLayer,
      writeNewFile: async (file, bytes) => {
        await nodeFileLayer.writeNewFile(file, bytes);
        if (!fired && file !== target) {
          fired = true;
          change();
        }
      },
    };
  }

  test("WS-01 race: a file created by someone else during a create is not overwritten", async () => {
    const dir = path.join(root, "race-new");
    fs.mkdirSync(dir);
    const file = path.join(dir, "new.txt");
    const userBytes = Buffer.from("created by the user\r\n", "utf8");
    const racing = await createWorkspaceWithFileLayer({ root }, racingLayer(file, () => fs.writeFileSync(file, userBytes)));
    const target = await racing.resolve("race-new/new.txt", "write");
    assert.ok(target.ok);

    const outcome = await racing.writeText({ path: target.path, expectedHash: null, text: asRawText("mine\n") });

    assert.deepEqual(outcome, { ok: false, code: "conflict", currentHash: sha256(userBytes) });
    assert.deepEqual(fs.readFileSync(file), userBytes);
    assert.deepEqual(fs.readdirSync(dir), ["new.txt"]);
  });

  test("WS-01 race: a change made after the hash check and before the replace is not overwritten", async () => {
    const dir = path.join(root, "race-edit");
    fs.mkdirSync(dir);
    const file = path.join(dir, "data.txt");
    const original = Buffer.from("원본\r\n", "utf8");
    const userBytes = Buffer.from("사용자가 고친 내용\r\n", "utf8");
    fs.writeFileSync(file, original);
    const racing = await createWorkspaceWithFileLayer({ root }, racingLayer(file, () => fs.writeFileSync(file, userBytes)));
    const target = await racing.resolve("race-edit/data.txt", "write");
    assert.ok(target.ok);

    const outcome = await racing.writeText({ path: target.path, expectedHash: sha256(original), text: asRawText("mine\n") });

    assert.deepEqual(outcome, { ok: false, code: "conflict", currentHash: sha256(userBytes) });
    assert.deepEqual(fs.readFileSync(file), userBytes);
    assert.deepEqual(fs.readdirSync(dir), ["data.txt"]);
  });

  test("creates a new file with an exclusive create when hard links are not supported", async () => {
    const dir = path.join(root, "no-links");
    fs.mkdirSync(dir);
    const file = path.join(dir, "new.txt");
    const userBytes = Buffer.from("user\n");
    let raced = false;
    const noLinks: FileLayer = {
      ...nodeFileLayer,
      link: async () => {
        // FAT and exFAT reject hard links. The second call simulates a concurrent creator.
        if (raced) fs.writeFileSync(file, userBytes);
        throw Object.assign(new Error("hard links not supported"), { code: "ENOTSUP" });
      },
    };
    const local = await createWorkspaceWithFileLayer({ root }, noLinks);
    const target = await local.resolve("no-links/new.txt", "write");
    assert.ok(target.ok);

    const created = await local.writeText({ path: target.path, expectedHash: null, text: asRawText("새 파일\r\n") });
    const bytes = Buffer.from("새 파일\r\n", "utf8");
    assert.deepEqual(created, { ok: true, previousHash: null, newHash: sha256(bytes), created: true });
    assert.deepEqual(fs.readFileSync(file), bytes);
    assert.deepEqual(fs.readdirSync(dir), ["new.txt"]);

    fs.rmSync(file);
    raced = true;
    const conflict = await local.writeText({ path: target.path, expectedHash: null, text: asRawText("mine\n") });
    assert.deepEqual(conflict, { ok: false, code: "conflict", currentHash: sha256(userBytes) });
    assert.deepEqual(fs.readFileSync(file), userBytes);
    assert.deepEqual(fs.readdirSync(dir), ["new.txt"]);
  });

  test("WS-01 race: a file deleted after the hash check is not recreated", async () => {
    const dir = path.join(root, "race-delete");
    fs.mkdirSync(dir);
    const file = path.join(dir, "data.txt");
    const original = Buffer.from("old\n");
    fs.writeFileSync(file, original);
    const racing = await createWorkspaceWithFileLayer({ root }, racingLayer(file, () => fs.rmSync(file)));
    const target = await racing.resolve("race-delete/data.txt", "write");
    assert.ok(target.ok);

    const outcome = await racing.writeText({ path: target.path, expectedHash: sha256(original), text: asRawText("mine\n") });

    assert.deepEqual(outcome, { ok: false, code: "conflict", currentHash: null });
    assert.deepEqual(fs.readdirSync(dir), []);
  });

  test("WS-03 keeps CRLF line endings and every untouched byte", async () => {
    const file = path.join(root, "crlf.txt");
    const original = Buffer.from("line one\r\nline two\r\nmixed\nline four\r\n", "utf8");
    fs.writeFileSync(file, original);
    const target = await resolved("crlf.txt", "write");
    const read = await workspace.readText(target);
    assert.ok(read.ok);

    const text = read.snapshot.text.replace("line two", "LINE 2");
    const written = await workspace.writeText({ path: target, expectedHash: read.snapshot.hash, text: asRawText(text) });

    const expected = Buffer.from("line one\r\nLINE 2\r\nmixed\nline four\r\n", "utf8");
    const actual = fs.readFileSync(file);
    assert.deepEqual(actual, expected);
    assert.ok(written.ok);
    assert.equal(written.newHash, sha256(expected));
    assert.equal(written.previousHash, sha256(original));
    // Bytes before and after the replaced span are identical to the original.
    const start = original.indexOf("line two");
    const tail = original.subarray(start + "line two".length);
    assert.deepEqual(actual.subarray(0, start), original.subarray(0, start));
    assert.deepEqual(actual.subarray(actual.length - tail.length), tail);
  });

  test("WS-04 keeps the BOM and multibyte text in a file with a Korean path", async () => {
    const dir = path.join(root, "문서 폴더");
    fs.mkdirSync(dir);
    const file = path.join(dir, "회의록.txt");
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const original = Buffer.concat([bom, Buffer.from("제목: 주간 회의\r\n참석자: 홍길동, 김철수 😀\r\n결론: 보류\r\n", "utf8")]);
    fs.writeFileSync(file, original);

    const target = await resolved("문서 폴더/회의록.txt", "write");
    assert.equal(target.relative, "문서 폴더/회의록.txt");
    const read = await workspace.readText(target);
    assert.ok(read.ok);
    assert.equal(read.snapshot.text.charCodeAt(0), 0xfeff);

    const text = read.snapshot.text.replace("결론: 보류", "결론: 승인");
    const written = await workspace.writeText({ path: target, expectedHash: read.snapshot.hash, text: asRawText(text) });
    assert.ok(written.ok);

    const expected = Buffer.concat([bom, Buffer.from("제목: 주간 회의\r\n참석자: 홍길동, 김철수 😀\r\n결론: 승인\r\n", "utf8")]);
    const actual = fs.readFileSync(file);
    assert.deepEqual(actual, expected);
    assert.deepEqual(actual.subarray(0, 3), bom);
    assert.equal(written.newHash, sha256(expected));
    assert.deepEqual(fs.readdirSync(dir), ["회의록.txt"]);

    // Text without a BOM is written without one: nothing is added.
    const plain = await workspace.writeText({
      path: await resolved("문서 폴더/새 문서.txt", "write"),
      expectedHash: null,
      text: asRawText("한글\n"),
    });
    assert.ok(plain.ok);
    assert.deepEqual(fs.readFileSync(path.join(dir, "새 문서.txt")), Buffer.from("한글\n", "utf8"));
  });
});

describe("Workspace.list", () => {
  test("lists recursively in code unit order, skips the state directory and does not follow links", async (t) => {
    const listRoot = path.join(base, "list-root");
    fs.mkdirSync(path.join(listRoot, "a", "b"), { recursive: true });
    fs.mkdirSync(path.join(listRoot, ".codaryn"));
    fs.writeFileSync(path.join(listRoot, ".codaryn", "lock.json"), "{}");
    fs.writeFileSync(path.join(listRoot, "a", "b", "c.txt"), "c");
    fs.writeFileSync(path.join(listRoot, "a.txt"), "a");
    fs.writeFileSync(path.join(listRoot, "B.txt"), "b");
    fs.writeFileSync(path.join(listRoot, "가.txt"), "가");
    const linked = tryLinkDir(outside, path.join(listRoot, "a", "link"));

    const local = await createWorkspace({ root: listRoot });
    const top = await local.resolve(".", "read");
    assert.ok(top.ok);
    const outcome = await local.list(top.path);

    const expected = [
      { relative: "B.txt", kind: "file" },
      { relative: "a", kind: "dir" },
      { relative: "a.txt", kind: "file" },
      { relative: "a/b", kind: "dir" },
      { relative: "a/b/c.txt", kind: "file" },
      ...(linked ? [{ relative: "a/link", kind: "file" }] : []),
      { relative: "가.txt", kind: "file" },
    ];
    assert.deepEqual(outcome, { ok: true, entries: expected, truncated: false });

    const sub = await local.resolve("a/b", "read");
    assert.ok(sub.ok);
    assert.deepEqual(await local.list(sub.path), {
      ok: true,
      entries: [{ relative: "a/b/c.txt", kind: "file" }],
      truncated: false,
    });

    const missing = await local.resolve("nope", "read");
    assert.ok(missing.ok);
    assert.deepEqual(await local.list(missing.path), { ok: false, code: "not_found" });

    if (!linked) {
      t.diagnostic("link case not covered: cannot create a directory link on this system");
    }
  });

  test("stops at MAX_SEARCH_ENTRIES and reports truncation", async () => {
    const manyRoot = path.join(base, "many-root");
    fs.mkdirSync(manyRoot);
    const names: string[] = [];
    for (let index = 0; index < MAX_SEARCH_ENTRIES + 5; index += 1) {
      const name = `f${String(index).padStart(4, "0")}.txt`;
      names.push(name);
      fs.writeFileSync(path.join(manyRoot, name), "");
    }
    const local = await createWorkspace({ root: manyRoot });
    const top = await local.resolve(".", "read");
    assert.ok(top.ok);

    const outcome = await local.list(top.path);
    assert.ok(outcome.ok);
    assert.equal(outcome.truncated, true);
    assert.deepEqual(
      outcome.entries.map((entry) => entry.relative),
      names.slice(0, MAX_SEARCH_ENTRIES),
    );

    // Exactly at the limit nothing is cut.
    for (const name of names.slice(MAX_SEARCH_ENTRIES)) {
      fs.rmSync(path.join(manyRoot, name));
    }
    const exact = await local.list(top.path);
    assert.ok(exact.ok);
    assert.equal(exact.entries.length, MAX_SEARCH_ENTRIES);
    assert.equal(exact.truncated, false);
  });
});

describe("createWorkspace", () => {
  test("rejects a root that is missing, relative or not a directory", async () => {
    await assert.rejects(createWorkspace({ root: path.join(base, "no-such-root") }));
    await assert.rejects(createWorkspace({ root: "relative-root" }));
    await assert.rejects(createWorkspace({ root: path.join(outside, "secret.txt") }));
  });
});
