import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { BUILTIN_TOOLS } from "../../../src/contracts/index.js";
import type {
  EffectiveToolCall,
  JsonObject,
  PolicyConfig,
  PolicyGate,
  ToolCall,
  ToolDescriptor,
  Workspace,
} from "../../../src/contracts/index.js";
import { createPolicyGate } from "../../../src/policy/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";

const IS_WINDOWS = process.platform === "win32";
const ALLOW = { allowed: true };
/** Well-formed token text. It is not a secret and maps to nothing. */
const TOKEN = "[[CODARYN_SECRET:0123456789abcdef]]";

const CONFIG: PolicyConfig = {
  commands: [
    { executable: "node", argsPrefix: ["--test"], allowExtraArgs: true },
    { executable: "git", argsPrefix: ["status", "--short"], allowExtraArgs: false },
  ],
  network: "deny",
  destructive: "deny",
  restorePathTokens: false,
};

let base: string;
let root: string;
let outside: string;
let workspace: Workspace;
let gate: PolicyGate;
let restoringGate: PolicyGate;

before(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-po-"));
  root = path.join(base, "root");
  outside = path.join(base, "outside");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, ".codaryn"));
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(root, "src", "a.txt"), "a\n");
  fs.writeFileSync(path.join(outside, "secret.txt"), "outside\n");
  workspace = await createWorkspace({ root });
  gate = createPolicyGate({ config: CONFIG, workspace });
  restoringGate = createPolicyGate({ config: { ...CONFIG, restorePathTokens: true }, workspace });
});

after(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

function call(name: string, args: JsonObject): ToolCall {
  return { id: "call-1", name, args };
}

function effective(name: string, args: JsonObject): EffectiveToolCall {
  return { id: "call-1", name, args } as unknown as EffectiveToolCall;
}

function denied(permission: string, code: string): object {
  return { allowed: false, permission, code };
}

/** Runs both checks on the same arguments and requires the same decision from each. */
async function both(name: string, args: JsonObject, descriptor: ToolDescriptor, g: PolicyGate = gate): Promise<object> {
  const requested = g.checkRequested(call(name, args), descriptor);
  const eff = await g.checkEffective(effective(name, args), descriptor);
  assert.deepEqual(eff, requested, "checkRequested and checkEffective disagree");
  return requested;
}

describe("PolicyGate", () => {
  test("PO-01 an allowed path does not stand in for a denied command", async () => {
    const run = BUILTIN_TOOLS.run_command;
    assert.deepEqual(await both("run_command", { executable: "rm", args: ["-rf", "src"], cwd: "src" }, run), denied("command", "command_not_allowed"));
    // The reverse: an allowed command does not stand in for a denied path.
    assert.deepEqual(await both("run_command", { executable: "node", args: ["--test"], cwd: ".." }, run), denied("path", "outside_root"));
    assert.deepEqual(await both("run_command", { executable: "node", args: ["--test"], cwd: ".codaryn" }, run), denied("path", "state_dir"));
    // Both allowed, with and without an explicit cwd.
    assert.deepEqual(await both("run_command", { executable: "node", args: ["--test"], cwd: "src" }, run), ALLOW);
    assert.deepEqual(await both("run_command", { executable: "node", args: ["--test"] }, run), ALLOW);
  });

  test("PO-02 allows paths inside the root and denies paths that leave it", async () => {
    const read = BUILTIN_TOOLS.read_file;
    assert.deepEqual(await both("read_file", { path: "src/a.txt" }, read), ALLOW);
    assert.deepEqual(await both("read_file", { path: path.join(workspace.root, "src", "a.txt") }, read), ALLOW);
    assert.deepEqual(await both("search_files", { path: "." }, BUILTIN_TOOLS.search_files), ALLOW);

    assert.deepEqual(await both("read_file", { path: "../outside/secret.txt" }, read), denied("path", "outside_root"));
    assert.deepEqual(await both("read_file", { path: "src/../../outside/secret.txt" }, read), denied("path", "outside_root"));
    assert.deepEqual(await both("read_file", { path: path.join(outside, "secret.txt") }, read), denied("path", "outside_root"));
    assert.deepEqual(await both("read_file", { path: ".codaryn/journal.jsonl" }, read), denied("path", "state_dir"));
    assert.deepEqual(await both("read_file", { path: "" }, read), denied("path", "invalid_path"));
    assert.deepEqual(await both("read_file", {}, read), denied("path", "invalid_path"));
    assert.deepEqual(await both("read_file", { path: 7 }, read), denied("path", "invalid_path"));
    if (IS_WINDOWS) {
      assert.deepEqual(await both("read_file", { path: "\\\\server\\share\\x.txt" }, read), denied("path", "invalid_path"));
      assert.deepEqual(await both("read_file", { path: "src/a.txt:stream" }, read), denied("path", "invalid_path"));
    }
  });

  test("PO-02 a real link that points outside the root passes the lexical check and fails the effective check", async (t) => {
    const link = path.join(root, "link-out");
    try {
      fs.symlinkSync(outside, link, "junction");
    } catch {
      t.skip("cannot create a directory link on this system");
      return;
    }
    const args = { path: "link-out/secret.txt", expectedHash: null, change: { kind: "replace_all", content: "x" } };
    assert.deepEqual(gate.checkRequested(call("write_file", args), BUILTIN_TOOLS.write_file), ALLOW);
    assert.deepEqual(
      await gate.checkEffective(effective("write_file", args), BUILTIN_TOOLS.write_file),
      denied("path", "outside_root"),
    );
    assert.deepEqual(
      await gate.checkEffective(effective("run_command", { executable: "node", args: ["--test"], cwd: "link-out" }), BUILTIN_TOOLS.run_command),
      denied("path", "outside_root"),
    );
  });

  test("PO-03 denies executables outside the list and forbidden arguments", async () => {
    const run = BUILTIN_TOOLS.run_command;
    const check = (executable: unknown, args: unknown): Promise<object> =>
      both("run_command", { executable, args } as JsonObject, run);

    assert.deepEqual(await check("node", ["--test"]), ALLOW);
    assert.deepEqual(await check("node", ["--test", "dist/tests"]), ALLOW);
    assert.deepEqual(await check("git", ["status", "--short"]), ALLOW);

    assert.deepEqual(await check("npm", ["test"]), denied("command", "command_not_allowed"));
    assert.deepEqual(await check("Node", ["--test"]), denied("command", "command_not_allowed"));
    assert.deepEqual(await check("node.exe", ["--test"]), denied("command", "command_not_allowed"));
    assert.deepEqual(await check("./node", ["--test"]), denied("command", "command_not_allowed"));
    assert.deepEqual(await check("node --test", []), denied("command", "command_not_allowed"));
    assert.deepEqual(await check(null, ["--test"]), denied("command", "command_not_allowed"));

    assert.deepEqual(await check("node", ["-e", "process.exit(0)"]), denied("command", "args_not_allowed"));
    assert.deepEqual(await check("node", []), denied("command", "args_not_allowed"));
    assert.deepEqual(await check("node", ["--TEST"]), denied("command", "args_not_allowed"));
    assert.deepEqual(await check("git", ["status"]), denied("command", "args_not_allowed"));
    assert.deepEqual(await check("git", ["status", "--short", "--ignored"]), denied("command", "args_not_allowed"));
    assert.deepEqual(await check("git", ["push", "--force"]), denied("command", "args_not_allowed"));
    assert.deepEqual(await check("node", "--test"), denied("command", "args_not_allowed"));
    assert.deepEqual(await check("node", ["--test", 1]), denied("command", "args_not_allowed"));

    // An empty allow list runs nothing.
    const closed = createPolicyGate({ config: { ...CONFIG, commands: [] }, workspace });
    assert.deepEqual(await both("run_command", { executable: "node", args: ["--test"] }, run, closed), denied("command", "command_not_allowed"));
  });

  test("PO-04 denies destructive tools inside the root and allows a versioned write", async () => {
    const deleteFile: ToolDescriptor = {
      name: "delete_file",
      displayClass: "write-local",
      requires: { paths: [{ field: "path", access: "write" }], command: false, network: false, destructive: true },
      restoreFields: ["path"],
      documentFields: [],
    };
    const overwriteFile: ToolDescriptor = { ...deleteFile, name: "overwrite_file" };
    assert.deepEqual(await both("delete_file", { path: "src/a.txt" }, deleteFile), denied("destructive", "destructive_denied"));
    assert.deepEqual(
      await both("overwrite_file", { path: "src/a.txt", content: "x" }, overwriteFile),
      denied("destructive", "destructive_denied"),
    );

    const hash = createHash("sha256").update(fs.readFileSync(path.join(root, "src", "a.txt"))).digest("hex");
    const write = { path: "src/a.txt", expectedHash: hash, change: { kind: "replace_text", oldText: "a", newText: "b" } };
    assert.deepEqual(await both("write_file", write, BUILTIN_TOOLS.write_file), ALLOW);
    assert.deepEqual(
      await both("write_file", { ...write, path: "../outside/secret.txt" }, BUILTIN_TOOLS.write_file),
      denied("path", "outside_root"),
    );
  });

  test("PO-05 denies a tool that requires the network", async () => {
    const fetchUrl: ToolDescriptor = {
      name: "fetch_url",
      displayClass: "external",
      requires: { paths: [], command: false, network: true, destructive: false },
      restoreFields: [],
      documentFields: [],
    };
    assert.deepEqual(await both("fetch_url", { url: "https://example.invalid/" }, fetchUrl), denied("network", "network_denied"));
  });

  test("PO-06 arguments and workspace files cannot lower the fixed requirements", async () => {
    // A project file that claims wider permissions is never read by the gate.
    fs.writeFileSync(
      path.join(root, "codaryn.policy.json"),
      JSON.stringify({ commands: [{ executable: "rm", argsPrefix: [], allowExtraArgs: true }], destructive: "allow", network: "allow" }),
    );
    const loweringArgs = {
      executable: "rm",
      args: ["-rf", "."],
      requires: { paths: [], command: false, network: false, destructive: false },
      policy: { commands: [{ executable: "rm", argsPrefix: [], allowExtraArgs: true }] },
      allowExtraArgs: true,
      destructive: "allow",
      network: "allow",
    };
    assert.deepEqual(await both("run_command", loweringArgs, BUILTIN_TOOLS.run_command), denied("command", "command_not_allowed"));

    // A descriptor that claims less than the fixed table for a built-in name is judged by the table.
    const weakened: ToolDescriptor = {
      ...BUILTIN_TOOLS.run_command,
      requires: { paths: [], command: false, network: false, destructive: false },
    };
    assert.deepEqual(await both("run_command", { executable: "rm", args: ["-rf", "."] }, weakened), denied("command", "command_not_allowed"));
    assert.deepEqual(await both("run_command", { executable: "node", args: ["--test"], cwd: ".." }, weakened), denied("path", "outside_root"));
    const weakenedWrite: ToolDescriptor = { ...BUILTIN_TOOLS.write_file, requires: weakened.requires };
    assert.deepEqual(
      await both("write_file", { path: ".codaryn/lock.json", expectedHash: null, change: { kind: "replace_all", content: "" } }, weakenedWrite),
      denied("path", "state_dir"),
    );

    // Extra requirements on a descriptor are added, never dropped.
    const networked: ToolDescriptor = {
      ...BUILTIN_TOOLS.read_file,
      requires: { ...BUILTIN_TOOLS.read_file.requires, network: true, destructive: true },
    };
    assert.deepEqual(await both("read_file", { path: "src/a.txt", network: false }, networked), denied("network", "network_denied"));
  });

  test("every required permission is checked and one denial denies the call", async () => {
    const everything: ToolDescriptor = {
      name: "do_everything",
      displayClass: "external",
      requires: { paths: [{ field: "target.path", access: "write" }], command: true, network: true, destructive: true },
      restoreFields: [],
      documentFields: [],
    };
    const good = { target: { path: "src/a.txt" }, executable: "node", args: ["--test"] };
    // Path and command pass, network is still denied.
    assert.deepEqual(await both("do_everything", good, everything), denied("network", "network_denied"));
    assert.deepEqual(await both("do_everything", { ...good, target: { path: "../x" } }, everything), denied("path", "outside_root"));
    assert.deepEqual(await both("do_everything", { ...good, executable: "rm" }, everything), denied("command", "command_not_allowed"));

    const destructiveOnly: ToolDescriptor = { ...everything, requires: { ...everything.requires, network: false } };
    assert.deepEqual(await both("do_everything", good, destructiveOnly), denied("destructive", "destructive_denied"));
  });

  test("restorableFields follows restorePathTokens", () => {
    assert.deepEqual(gate.restorableFields(BUILTIN_TOOLS.read_file), []);
    assert.deepEqual(gate.restorableFields(BUILTIN_TOOLS.run_command), []);
    assert.deepEqual(restoringGate.restorableFields(BUILTIN_TOOLS.read_file), ["path"]);
    assert.deepEqual(restoringGate.restorableFields(BUILTIN_TOOLS.run_command), ["cwd"]);
  });

  test("token paths wait for the effective check, which judges the restored value", async () => {
    const read = BUILTIN_TOOLS.read_file;
    const tokenPath = { path: `src/${TOKEN}.txt` };

    // Restoration is off: the token can never become a real path.
    assert.deepEqual(gate.checkRequested(call("read_file", tokenPath), read), denied("restore", "restore_denied"));
    // Restoration is on: the lexical check is deferred, other permissions are still judged.
    assert.deepEqual(restoringGate.checkRequested(call("read_file", tokenPath), read), ALLOW);
    assert.deepEqual(
      restoringGate.checkRequested(call("run_command", { executable: "rm", args: [], cwd: TOKEN }), BUILTIN_TOOLS.run_command),
      denied("command", "command_not_allowed"),
    );

    // After restoration the real value is judged (PR-09 from the policy side).
    assert.deepEqual(await restoringGate.checkEffective(effective("read_file", { path: "src/a.txt" }), read), ALLOW);
    assert.deepEqual(
      await restoringGate.checkEffective(effective("read_file", { path: "../outside/secret.txt" }), read),
      denied("path", "outside_root"),
    );
    assert.deepEqual(
      await restoringGate.checkEffective(effective("read_file", { path: ".codaryn/vault" }), read),
      denied("path", "state_dir"),
    );
    // A token that survived restoration is not executable.
    assert.deepEqual(await restoringGate.checkEffective(effective("read_file", tokenPath), read), denied("restore", "restore_denied"));
  });
});
