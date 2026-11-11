import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { BUILTIN_TOOLS, asRawText } from "../../../src/contracts/index.js";
import type {
  EffectiveToolCall,
  JsonObject,
  PolicyConfig,
  PolicyGate,
  ToolDescriptor,
  Workspace,
} from "../../../src/contracts/index.js";
import { checkProtectedPaths, createPolicyGate } from "../../../src/policy/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";

const IS_WINDOWS = process.platform === "win32";
const ALLOW = { allowed: true };
const PROTECTED = { allowed: false, permission: "path", code: "protected_path" };
/** Well-formed token text. It is not a secret and maps to nothing. */
const TOKEN = "[[CODARYN_SECRET:0123456789abcdef]]";

const BASE: PolicyConfig = {
  commands: [{ executable: "node", argsPrefix: ["--test"], allowExtraArgs: true }],
  network: "deny",
  destructive: "deny",
  restorePathTokens: false,
};

let base: string;
let root: string;
let workspace: Workspace;

before(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-pp-"));
  root = path.join(base, "root");
  for (const dir of ["tests/sub", "tests2", "src", "protected-long-name"]) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  fs.writeFileSync(path.join(root, "tests", "a.test.ts"), "test\n");
  fs.writeFileSync(path.join(root, "tests", "sub", "b.ts"), "b\n");
  fs.writeFileSync(path.join(root, "tests2", "a.ts"), "a\n");
  fs.writeFileSync(path.join(root, "src", "a.ts"), "a\n");
  fs.writeFileSync(path.join(root, "verify.json"), "{}\n");
  workspace = await createWorkspace({ root });
});

after(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

function gate(protectedPaths: unknown, extra: Partial<PolicyConfig> = {}): PolicyGate {
  const config = { ...BASE, ...extra, protectedPaths } as PolicyConfig;
  return createPolicyGate({ config, workspace });
}

function writeArgs(target: string): JsonObject {
  return { path: target, expectedHash: null, change: { kind: "replace_all", content: "x" } };
}

/** Runs both checks on the same arguments and requires the same decision from each. */
async function both(g: PolicyGate, name: string, args: JsonObject, descriptor: ToolDescriptor): Promise<object> {
  const requested = g.checkRequested({ id: "c1", name, args }, descriptor);
  const effective = await g.checkEffective({ id: "c1", name, args } as unknown as EffectiveToolCall, descriptor);
  assert.deepEqual(effective, requested, `checkRequested and checkEffective disagree for ${JSON.stringify(args)}`);
  return requested;
}

const write = (g: PolicyGate, target: string): Promise<object> =>
  both(g, "write_file", writeArgs(target), BUILTIN_TOOLS.write_file);

function tryJunction(target: string, link: string): boolean {
  try {
    fs.symlinkSync(target, link, "junction");
    return true;
  } catch {
    return false;
  }
}

describe("PO-07 protected paths", () => {
  test("denies writes to a protected prefix and everything below it", async () => {
    const g = gate(["tests", "verify.json"]);
    assert.deepEqual(await write(g, "tests/a.test.ts"), PROTECTED);
    assert.deepEqual(await write(g, "tests/sub/b.ts"), PROTECTED);
    assert.deepEqual(await write(g, "tests/new/file.ts"), PROTECTED);
    assert.deepEqual(await write(g, "tests"), PROTECTED);
    assert.deepEqual(await write(g, "verify.json"), PROTECTED);
    // Other spellings of the same place.
    assert.deepEqual(await write(g, "./tests/a.test.ts"), PROTECTED);
    assert.deepEqual(await write(g, "src/../tests/a.test.ts"), PROTECTED);
    assert.deepEqual(await write(g, path.join(workspace.root, "tests", "a.test.ts")), PROTECTED);
    if (IS_WINDOWS) {
      assert.deepEqual(await write(g, "tests\\sub\\b.ts"), PROTECTED);
    }
  });

  test("allows a different name that only shares the prefix", async () => {
    const g = gate(["tests", "verify.json"]);
    assert.deepEqual(await write(g, "tests2/a.ts"), ALLOW);
    assert.deepEqual(await write(g, "testsuite/a.ts"), ALLOW);
    assert.deepEqual(await write(g, "tests.bak"), ALLOW);
    assert.deepEqual(await write(g, "verify.json.bak"), ALLOW);
    assert.deepEqual(await write(g, "src/tests/a.ts"), ALLOW);
    assert.deepEqual(await write(g, "src/a.ts"), ALLOW);
  });

  test("ignores case on Windows", { skip: !IS_WINDOWS }, async () => {
    const g = gate(["tests"]);
    assert.deepEqual(await write(g, "TESTS/a.test.ts"), PROTECTED);
    assert.deepEqual(await write(g, "Tests/Sub/B.ts"), PROTECTED);
    assert.deepEqual(await write(g, "TESTS/brand-new.ts"), PROTECTED);
    // The entry itself may be spelled in another case.
    assert.deepEqual(await write(gate(["TESTS/SUB"]), "tests/sub/b.ts"), PROTECTED);
  });

  test("is case-sensitive where the file system is", { skip: IS_WINDOWS }, async () => {
    assert.deepEqual(await write(gate(["tests"]), "TESTS/a.ts"), ALLOW);
  });

  test("a junction or link into a protected directory does not lead around it", async (t) => {
    const link = path.join(root, "alias");
    if (!tryJunction(path.join(root, "tests"), link)) {
      t.skip("cannot create a directory link on this system");
      return;
    }
    const g = gate(["tests"]);
    const args = writeArgs("alias/a.test.ts");
    // The lexical check cannot see the link; the effective check resolves it.
    assert.deepEqual(g.checkRequested({ id: "c1", name: "write_file", args }, BUILTIN_TOOLS.write_file), ALLOW);
    for (const target of ["alias/a.test.ts", "alias/new.ts", "alias/sub/b.ts"]) {
      const call = { id: "c1", name: "write_file", args: writeArgs(target) } as unknown as EffectiveToolCall;
      assert.deepEqual(await g.checkEffective(call, BUILTIN_TOOLS.write_file), PROTECTED, target);
    }
  });

  test("an 8.3 short name of a protected directory is still protected", { skip: !IS_WINDOWS }, async (t) => {
    if (!fs.existsSync(path.join(root, "PROTEC~1"))) {
      t.skip("8.3 short names are not generated on this volume");
      return;
    }
    const g = gate(["protected-long-name"]);
    const call = { id: "c1", name: "write_file", args: writeArgs("PROTEC~1/x.txt") } as unknown as EffectiveToolCall;
    assert.deepEqual(await g.checkEffective(call, BUILTIN_TOOLS.write_file), PROTECTED);
  });

  test("a hard link outside the protected path cannot change the protected file", async (t) => {
    const original = path.join(root, "tests", "a.test.ts");
    const linked = path.join(root, "src", "hard-link.ts");
    try {
      fs.linkSync(original, linked);
    } catch {
      t.skip("cannot create a hard link on this system");
      return;
    }
    const before = fs.readFileSync(original);
    const g = gate(["tests"]);
    assert.deepEqual(await write(g, "src/hard-link.ts"), ALLOW);

    // The write replaces the link name with a new file; the protected bytes stay.
    const target = await workspace.resolve("src/hard-link.ts", "write");
    assert.ok(target.ok);
    const outcome = await workspace.writeText({
      path: target.path,
      expectedHash: createHash("sha256").update(before).digest("hex"),
      text: asRawText("changed through the link\n"),
    });
    assert.equal(outcome.ok, true);
    assert.deepEqual(fs.readFileSync(original), before);
    assert.equal(fs.readFileSync(linked, "utf8"), "changed through the link\n");
  });

  test("reading, searching and running a command in a protected directory stay allowed", async () => {
    const g = gate(["tests"]);
    assert.deepEqual(await both(g, "read_file", { path: "tests/a.test.ts" }, BUILTIN_TOOLS.read_file), ALLOW);
    assert.deepEqual(await both(g, "search_files", { path: "tests", text: "x" }, BUILTIN_TOOLS.search_files), ALLOW);
    assert.deepEqual(
      await both(g, "run_command", { executable: "node", args: ["--test"], cwd: "tests" }, BUILTIN_TOOLS.run_command),
      ALLOW,
    );
  });

  test("model arguments and descriptors cannot lift the protection", async () => {
    const g = gate(["tests"]);
    const lifting = {
      ...writeArgs("tests/a.test.ts"),
      protectedPaths: [],
      policy: { protectedPaths: [] },
      access: "read",
    };
    assert.deepEqual(await both(g, "write_file", lifting, BUILTIN_TOOLS.write_file), PROTECTED);

    // A built-in name judged with a weaker descriptor keeps the fixed write requirement.
    const claimsRead: ToolDescriptor = {
      ...BUILTIN_TOOLS.write_file,
      requires: { ...BUILTIN_TOOLS.write_file.requires, paths: [{ field: "path", access: "read" }] },
    };
    assert.deepEqual(await both(g, "write_file", writeArgs("tests/a.test.ts"), claimsRead), PROTECTED);
    const claimsNothing: ToolDescriptor = {
      ...BUILTIN_TOOLS.write_file,
      requires: { paths: [], command: false, network: false, destructive: false },
    };
    assert.deepEqual(await both(g, "write_file", writeArgs("tests/a.test.ts"), claimsNothing), PROTECTED);

    // Any tool that writes a path field is covered, not only write_file.
    const copyTool: ToolDescriptor = {
      name: "copy_into",
      displayClass: "write-local",
      requires: { paths: [{ field: "to", access: "write" }, { field: "from", access: "read" }], command: false, network: false, destructive: false },
      restoreFields: [],
      documentFields: [],
    };
    assert.deepEqual(await both(g, "copy_into", { from: "tests/a.test.ts", to: "src/copy.ts" }, copyTool), ALLOW);
    assert.deepEqual(await both(g, "copy_into", { from: "src/a.ts", to: "tests/copy.ts" }, copyTool), PROTECTED);
  });

  test("a restored token path is judged after restoration", async () => {
    const g = gate(["tests"], { restorePathTokens: true });
    const masked = writeArgs(`tests/${TOKEN}.ts`);
    assert.deepEqual(g.checkRequested({ id: "c1", name: "write_file", args: masked }, BUILTIN_TOOLS.write_file), ALLOW);
    const restored = { id: "c1", name: "write_file", args: writeArgs("tests/restored.ts") } as unknown as EffectiveToolCall;
    assert.deepEqual(await g.checkEffective(restored, BUILTIN_TOOLS.write_file), PROTECTED);
  });

  test("\".\" protects the whole workspace for writing only", async () => {
    for (const entry of [".", "./"]) {
      const g = gate([entry]);
      assert.deepEqual(await write(g, "src/a.ts"), PROTECTED, entry);
      assert.deepEqual(await write(g, "new.txt"), PROTECTED, entry);
      assert.deepEqual(await both(g, "read_file", { path: "src/a.ts" }, BUILTIN_TOOLS.read_file), ALLOW, entry);
    }
  });

  test("entries may end with a separator or start with ./", async () => {
    for (const entry of ["tests/", "./tests", "tests//", ...(IS_WINDOWS ? ["tests\\", ".\\tests"] : [])]) {
      assert.deepEqual(await write(gate([entry]), "tests/a.test.ts"), PROTECTED, entry);
    }
    assert.deepEqual(await write(gate(["tests/sub"]), "tests/a.test.ts"), ALLOW);
    assert.deepEqual(await write(gate(["tests/sub"]), "tests/sub/b.ts"), PROTECTED);
  });

  test("absent or empty protects nothing", async () => {
    assert.deepEqual(await write(gate(undefined), "tests/a.test.ts"), ALLOW);
    assert.deepEqual(await write(gate([]), "tests/a.test.ts"), ALLOW);
  });

  test("an invalid entry fails closed: every write is denied, reading stays allowed", async () => {
    const invalid: unknown[] = [
      [""],
      ["tests", "../outside"],
      ["tests/../src"],
      ["/tests"],
      [path.join(root, "tests")],
      ["tests\0"],
      [5],
      ["tests", null],
      "tests",
      null,
    ];
    if (IS_WINDOWS) invalid.push(["C:tests"], ["\\\\server\\share"], ["tests."], ["src\\..\\tests"]);
    for (const entries of invalid) {
      const g = gate(entries);
      const label = JSON.stringify(entries);
      assert.deepEqual(await write(g, "src/a.ts"), PROTECTED, label);
      assert.deepEqual(await write(g, "brand-new.txt"), PROTECTED, label);
      assert.deepEqual(await both(g, "read_file", { path: "src/a.ts" }, BUILTIN_TOOLS.read_file), ALLOW, label);
    }
  });

  test("other path denials keep their own codes", async () => {
    const g = gate(["tests"]);
    assert.deepEqual(await write(g, "../outside.txt"), { allowed: false, permission: "path", code: "outside_root" });
    assert.deepEqual(await write(g, ".codaryn/x"), { allowed: false, permission: "path", code: "state_dir" });
  });
});

describe("T-13 checkProtectedPaths: one format rule for the CLI and the gate", () => {
  test("absent and empty lists have no problem; a usable list has none either", () => {
    assert.deepEqual(checkProtectedPaths(undefined), []);
    assert.deepEqual(checkProtectedPaths([]), []);
    assert.deepEqual(checkProtectedPaths(["tests", "./docs/spec.md", "a/b/", "."]), []);
  });

  test("reports each unusable entry by position and reason, never by value", () => {
    assert.deepEqual(checkProtectedPaths("tests"), [{ index: null, reason: "not_a_list" }]);
    assert.deepEqual(checkProtectedPaths(null), [{ index: null, reason: "not_a_list" }]);
    assert.deepEqual(checkProtectedPaths(["ok", 5, "", "   ", "/abs", "../x", "a/../b", "a\0b"]), [
      { index: 1, reason: "not_a_string" },
      { index: 2, reason: "empty" },
      { index: 3, reason: "empty" },
      { index: 4, reason: "absolute" },
      { index: 5, reason: "parent_segment" },
      { index: 6, reason: "parent_segment" },
      { index: 7, reason: "invalid_name" },
    ]);
  });

  test("Windows names the gate cannot match are invalid_name (the L4 inputs)", { skip: !IS_WINDOWS }, () => {
    assert.deepEqual(checkProtectedPaths(["tests ", "tests.", "a|b", "nul", "src/con.txt", "ab:c", "a*b"]), [
      { index: 0, reason: "invalid_name" },
      { index: 1, reason: "invalid_name" },
      { index: 2, reason: "invalid_name" },
      { index: 3, reason: "invalid_name" },
      { index: 4, reason: "invalid_name" },
      { index: 5, reason: "invalid_name" },
      { index: 6, reason: "invalid_name" },
    ]);
    // "a:b" names drive A: relative to its current directory, so it is absolute too.
    assert.deepEqual(checkProtectedPaths(["C:tests", "a:b", "C:\\tests", "\\\\server\\share", "\\tests"]), [
      { index: 0, reason: "absolute" },
      { index: 1, reason: "absolute" },
      { index: 2, reason: "absolute" },
      { index: 3, reason: "absolute" },
      { index: 4, reason: "absolute" },
    ]);
  });

  test("the gate denies every write exactly when checkProtectedPaths reports a problem", async () => {
    const samples: unknown[] = [["tests"], ["tests", "../x"], ["ok", ""], "tests", ["src/a.ts"]];
    if (IS_WINDOWS) samples.push(["tests "], ["tests."], ["a|b"], ["nul"]);
    for (const value of samples) {
      const unusable = checkProtectedPaths(value).length > 0;
      const decision = await write(gate(value), "free/unrelated.txt");
      assert.deepEqual(decision, unusable ? PROTECTED : ALLOW, JSON.stringify(value));
    }
  });
});

describe("T-13 an entry that is a link protects its real path too (M1)", () => {
  test("a junction entry also protects the directory it points to", async (t) => {
    fs.mkdirSync(path.join(root, "shared", "fixtures"), { recursive: true });
    fs.writeFileSync(path.join(root, "shared", "fixtures", "expected.txt"), "expected\n");
    if (!tryJunction(path.join(root, "shared", "fixtures"), path.join(root, "fixtures"))) {
      t.skip("cannot create a directory link on this system");
      return;
    }
    const g = gate(["fixtures"]);
    const effective = (target: string) =>
      g.checkEffective({ id: "c1", name: "write_file", args: writeArgs(target) } as unknown as EffectiveToolCall, BUILTIN_TOOLS.write_file);
    assert.deepEqual(await effective("fixtures/expected.txt"), PROTECTED);
    assert.deepEqual(await effective("shared/fixtures/expected.txt"), PROTECTED);
    assert.deepEqual(await effective("shared/fixtures/new.txt"), PROTECTED);
    if (IS_WINDOWS) assert.deepEqual(await effective("SHARED/FIXTURES/expected.txt"), PROTECTED);
    // Only the linked directory is covered, not its parent or a sibling.
    assert.deepEqual(await effective("shared/other.txt"), ALLOW);
    assert.deepEqual(await effective("shared/fixtures2/x.txt"), ALLOW);
  });

  test("an entry whose real path is outside the workspace makes every write fail closed", async (t) => {
    const outsideDir = path.join(base, "outside-fixtures");
    fs.mkdirSync(outsideDir, { recursive: true });
    if (!tryJunction(outsideDir, path.join(root, "linked-out"))) {
      t.skip("cannot create a directory link on this system");
      return;
    }
    const g = gate(["linked-out"]);
    const call = { id: "c1", name: "write_file", args: writeArgs("src/a.ts") } as unknown as EffectiveToolCall;
    assert.deepEqual(await g.checkEffective(call, BUILTIN_TOOLS.write_file), PROTECTED);
    // Reading stays allowed.
    const read = { id: "c1", name: "read_file", args: { path: "src/a.ts" } } as unknown as EffectiveToolCall;
    assert.deepEqual(await g.checkEffective(read, BUILTIN_TOOLS.read_file), ALLOW);
  });

  test("an entry that does not exist yet keeps its lexical form", async () => {
    const g = gate(["generated"]);
    assert.deepEqual(await write(g, "generated/out.txt"), PROTECTED);
    assert.deepEqual(await write(g, "src/a.ts"), ALLOW);
  });
});
