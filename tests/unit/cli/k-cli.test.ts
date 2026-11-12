/**
 * K1, CLI side: U-3 (install directory refusal), U-1 (`integrity.paths` in the config file and
 * its checks before a run), U-7 (help, version, package entry) and U-8 (progress on stderr).
 * Real assembly on temporary directories, scripted model, fake values only, no network.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { MAX_INTEGRITY_PATHS, STATE_DIR_NAME } from "../../../src/contracts/index.js";
import type { Assemble, AssemblyInput } from "../../../src/cli/assemble.js";
import { parseArgs, parseDoctorArgs, parseReportArgs } from "../../../src/cli/args.js";
import { parseConfig, parseIntegrity } from "../../../src/cli/config.js";
import { renderOutcome } from "../../../src/cli/guard.js";
import { helpRequest, helpText, versionText } from "../../../src/cli/help.js";
import { findInstall } from "../../../src/cli/install.js";
import { PROGRESS_PREFIX, progressLine, withProgress } from "../../../src/cli/progress.js";
import { runCli } from "../../../src/cli/run.js";
import { findKeyInJson, relateRealPaths } from "../../../src/cli/security/index.js";
import type { RealpathFs } from "../../../src/cli/security/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";
import type { Journal, JournalEvent, MaskedText, MessageCatalog } from "../../../src/contracts/index.js";
import { FAKE_SECRET, IS_WINDOWS, cliIo, exists, setupRun, tempDir } from "./k-support.js";

const SEP = String.fromCharCode(92);
const ESC = String.fromCharCode(27);

/** An assembly that records its input and refuses, so nothing is run or written. */
function recordingAssemble(): { assemble: Assemble; inputs: AssemblyInput[] } {
  const inputs: AssemblyInput[] = [];
  return {
    inputs,
    assemble: async (input) => {
      inputs.push(input);
      return { ok: false, code: "internal_error", message: "recording assembly" };
    },
  };
}

describe("U-3 relateRealPaths", () => {
  test("same, inside, contains, separate and unknown, by real paths", async () => {
    const base = await tempDir();
    await mkdir(path.join(base, "a", "b"), { recursive: true });
    await mkdir(path.join(base, "c"));
    assert.equal(await relateRealPaths(path.join(base, "a"), path.join(base, "a")), "same");
    assert.equal(await relateRealPaths(path.join(base, "a", "b"), path.join(base, "a")), "inside");
    assert.equal(await relateRealPaths(path.join(base, "a"), path.join(base, "a", "b")), "contains");
    assert.equal(await relateRealPaths(path.join(base, "c"), path.join(base, "a")), "separate");
    assert.equal(await relateRealPaths(path.join(base, "missing"), path.join(base, "a")), "unknown");
    // "a" and "ab" share a prefix but not a segment.
    await mkdir(path.join(base, "ab"));
    assert.equal(await relateRealPaths(path.join(base, "ab"), path.join(base, "a")), "separate");
  });

  test("Windows compares without case and resolves junctions", { skip: !IS_WINDOWS }, async () => {
    const base = await tempDir();
    await mkdir(path.join(base, "install", "dist"), { recursive: true });
    assert.equal(await relateRealPaths(path.join(base, "INSTALL"), path.join(base, "install")), "same");
    await symlink(path.join(base, "install"), path.join(base, "link"), "junction");
    assert.equal(await relateRealPaths(path.join(base, "link"), path.join(base, "install")), "same");
    assert.equal(await relateRealPaths(path.join(base, "link", "dist"), path.join(base, "install")), "inside");
  });

  test("POSIX rules with injected real paths, including the root", async () => {
    const files: RealpathFs = { realpath: async (target) => target, lstat: async () => ({}) };
    assert.equal(await relateRealPaths("/srv/app", "/srv/app/", files, "linux"), "same");
    assert.equal(await relateRealPaths("/srv/app/x", "/srv/app", files, "linux"), "inside");
    assert.equal(await relateRealPaths("/", "/srv", files, "linux"), "contains");
    assert.equal(await relateRealPaths("/srv/App", "/srv/app", files, "linux"), "separate");
  });
});

describe("U-3 run refuses a workspace that overlaps the install directory", () => {
  const cases: { name: string; installDir: (base: string) => string | null }[] = [
    { name: "the same directory", installDir: (base) => path.join(base, "work") },
    { name: "the workspace inside it", installDir: (base) => base },
    { name: "the workspace containing it", installDir: (base) => path.join(base, "work", "tool") },
    { name: "an install directory that cannot be found", installDir: () => null },
  ];
  for (const item of cases) {
    test(item.name, async () => {
      const base = await setupRun({ "README.md": "# Title\n", "tool/package.json": "{}" }, {}, [{ text: "done" }]);
      const recorder = recordingAssemble();
      const outcome = await runCli(cliIo(base, { installDir: item.installDir(base), assemble: recorder.assemble }));
      assert.equal(outcome.exitCode, 2);
      assert.equal(outcome.output.kind === "error" ? outcome.output.code : "", "workspace_is_install_dir");
      assert.equal(recorder.inputs.length, 0, "nothing is assembled");
      assert.equal(await exists(path.join(base, "work", STATE_DIR_NAME)), false, "nothing is written");
    });
  }

  test("a junction to the install directory is refused", { skip: !IS_WINDOWS }, async () => {
    const base = await setupRun({ "README.md": "# Title\n" }, {}, [{ text: "done" }]);
    await symlink(path.join(base, "work"), path.join(base, "alias"), "junction");
    const outcome = await runCli(cliIo(base, { installDir: path.join(base, "alias") }));
    assert.equal(outcome.output.kind === "error" ? outcome.output.code : "", "workspace_is_install_dir");
  });

  test("a separate install directory lets the run go on", async () => {
    const base = await setupRun({ "README.md": "# Title\n" }, {}, [{ text: "done" }]);
    const elsewhere = await tempDir();
    const outcome = await runCli(cliIo(base, { installDir: elsewhere }));
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.output.kind === "run" ? outcome.output.status : "", "done");
  });
});

describe("U-3 findInstall", () => {
  test("walks up to the package.json named codaryn and reads its version", async () => {
    const root = await tempDir();
    await mkdir(path.join(root, "dist", "src", "cli"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "codaryn", version: "1.2.3" }));
    await writeFile(path.join(root, "dist", "package.json"), JSON.stringify({ name: "other", version: "9.9.9" }));
    const read = (file: string): Promise<string> => readFile(file, "utf8");
    assert.deepEqual(await findInstall(path.join(root, "dist", "src", "cli", "main.js"), read), { dir: root, version: "1.2.3" });
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "codaryn", version: "1.0.0\nX" }));
    assert.deepEqual(await findInstall(path.join(root, "dist", "src", "cli", "main.js"), read), { dir: root, version: null });
  });

  test("returns null when no codaryn package.json is above the entry", async () => {
    const root = await tempDir();
    const none = async (): Promise<string> => {
      throw new Error("missing");
    };
    assert.equal(await findInstall(path.join(root, "x", "main.js"), none), null);
  });

  test("the built entry file belongs to this package", async () => {
    const entry = fileURLToPath(new URL("../../../src/cli/main.js", import.meta.url));
    const found = await findInstall(entry, (file) => readFile(file, "utf8"));
    const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { version: string };
    assert.equal(path.resolve(found?.dir ?? ""), path.resolve(repoRoot));
    assert.equal(found?.version, pkg.version);
  });
});

describe("U-1 integrity.paths in the config file", () => {
  test("accepts absolute local paths", () => {
    const outcome = parseConfig({ schemaVersion: 1, integrity: { paths: [path.resolve("/baseline")] } });
    assert.ok(outcome.ok);
    assert.deepEqual(outcome.config.integrity, { paths: [path.resolve("/baseline")] });
    assert.deepEqual(parseIntegrity({ paths: ["/srv/baseline"] }, "linux"), { paths: ["/srv/baseline"] });
    assert.deepEqual(parseIntegrity({ paths: ["D:/baseline", `D:${SEP}base`] }, "win32"), { paths: ["D:/baseline", `D:${SEP}base`] });
  });

  test("rejects other forms, naming the position and never the value", () => {
    const marker = "zz-unique-marker";
    const cases: [unknown, string][] = [
      [[], "integrity must be an object"],
      [{ paths: ["D:/a"], extra: 1 }, "integrity has an unknown field"],
      [{ paths: `D:/${marker}` }, "integrity.paths must be an array"],
      [{ paths: ["D:/a", ""] }, "integrity.paths[1] must be a non-empty string"],
      [{ paths: [7] }, "integrity.paths[0] must be a non-empty string"],
      [{ paths: [`${marker}/rel`] }, "integrity.paths[0] must be an absolute path"],
      [{ paths: [`${SEP}${marker}`] }, "integrity.paths[0] must be an absolute path"],
      [{ paths: [`C:${marker}`] }, "integrity.paths[0] must be an absolute path"],
      [{ paths: [`${SEP}${SEP}server${SEP}${marker}`] }, "integrity.paths[0] is a network or device path"],
      [{ paths: [`//./${marker}`] }, "integrity.paths[0] is a network or device path"],
      [{ paths: [`C:/${marker}/nul.txt`] }, "integrity.paths[0] is a network or device path"],
      [{ paths: [`C:/${marker}\0`] }, "integrity.paths[0] is not a valid local path"],
    ];
    for (const [value, message] of cases) {
      assert.throws(() => parseIntegrity(value, "win32"), (error: Error) => {
        assert.ok(error.message.startsWith(message), `${JSON.stringify(value)} -> ${error.message}`);
        assert.equal(error.message.includes(marker), false);
        return true;
      });
    }
    const many = Array.from({ length: MAX_INTEGRITY_PATHS + 1 }, (_, index) => `D:/b${index}`);
    assert.throws(() => parseIntegrity({ paths: many }, "win32"), /at most 64 entries/);
    assert.throws(() => parseIntegrity({ paths: ["srv/x"] }, "linux"), /must be an absolute path/);
    const viaConfig = parseConfig({ schemaVersion: 1, integrity: { paths: ["relative"] } });
    assert.deepEqual(viaConfig, {
      ok: false,
      message: "integrity.paths[0] must be an absolute path",
      position: { code: "invalid_value", field: "integrity.paths[0]" },
    });
  });

  test("a key field under integrity is located with the known field name", () => {
    const found = findKeyInJson({ integrity: { paths: [], apiKey: "x" } }, null);
    assert.deepEqual(found, { kind: "key", location: "integrity.apiKey" });
  });

  async function runWithIntegrity(entry: (base: string) => string): Promise<{ base: string; code: string; message: string; inputs: AssemblyInput[] }> {
    const base = await setupRun({ "README.md": "# Title\n", "sub/a.txt": "a\n" }, {}, [{ text: "done" }]);
    await mkdir(path.join(base, "baseline"));
    await writeFile(
      path.join(base, "config.json"),
      JSON.stringify({ schemaVersion: 1, integrity: { paths: [path.join(base, "baseline"), entry(base)] } }),
    );
    const recorder = recordingAssemble();
    const io = cliIo(base, { assemble: recorder.assemble });
    const outcome = await runCli({ ...io, argv: [...io.argv, "--config", path.join(base, "config.json")] });
    const output = outcome.output;
    return {
      base,
      code: output.kind === "error" ? output.code : output.kind,
      message: output.kind === "error" ? output.message : "",
      inputs: recorder.inputs,
    };
  }

  test("an entry inside the workspace, containing it, or missing stops the run before assembly", async () => {
    const inside = await runWithIntegrity((base) => path.join(base, "work", "sub"));
    assert.deepEqual([inside.code, inside.message], ["invalid_config", "integrity.paths[1] must be outside the workspace and must not contain it"]);
    assert.equal(inside.inputs.length, 0);
    const same = await runWithIntegrity((base) => path.join(base, "work"));
    assert.equal(same.code, "invalid_config");
    const contains = await runWithIntegrity((base) => base);
    assert.deepEqual([contains.code, contains.message], ["invalid_config", "integrity.paths[1] must be outside the workspace and must not contain it"]);
    const missing = await runWithIntegrity((base) => path.join(base, "nowhere"));
    assert.deepEqual([missing.code, missing.message], ["invalid_config", "integrity.paths[1] does not exist or cannot be resolved"]);
    assert.equal(await exists(path.join(missing.base, "work", STATE_DIR_NAME)), false);
  });

  test("valid entries reach the assembly", async () => {
    const outcome = await runWithIntegrity((base) => path.join(base, "script.json"));
    assert.equal(outcome.inputs.length, 1);
    assert.deepEqual(outcome.inputs[0]?.integrityPaths, [path.join(outcome.base, "baseline"), path.join(outcome.base, "script.json")]);
  });

  test("the real assembly checks them (V-3 connection): unchanged material lets the run finish", async () => {
    const base = await setupRun({ "README.md": "# Title\n" }, {}, [{ text: "done" }]);
    await mkdir(path.join(base, "baseline"));
    await writeFile(path.join(base, "baseline", "spec.txt"), "spec\n");
    await writeFile(path.join(base, "config.json"), JSON.stringify({ schemaVersion: 1, integrity: { paths: [path.join(base, "baseline")] } }));
    const io = cliIo(base);
    const outcome = await runCli({ ...io, argv: [...io.argv, "--config", path.join(base, "config.json")] });
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.output.kind === "run" ? outcome.output.status : "", "done");
    assert.deepEqual(outcome.output.kind === "run" ? outcome.output.protectedChanged : null, []);
  });
});

describe("U-8 progress lines", () => {
  const masked = (text: string): MaskedText => text as MaskedText;

  test("one line per notable record, none for responses and results", () => {
    const events: [JournalEvent, string | null][] = [
      [{ type: "run_started", schemaVersion: 1, taskId: "t1", workflow: masked("w"), provider: "scripted", limits: { maxModelTurns: 1, maxToolCalls: 1, maxTotalTokens: null, maxDurationMs: 1 } }, "run started: task t1, provider scripted"],
      [{ type: "model_request", turn: 2, system: null, newMessages: [] }, "turn 2"],
      [{ type: "model_error", turn: 2, kind: "timeout", message: masked("m") }, "turn 2: model error timeout"],
      [{ type: "tool_decision", callId: "c", tool: "write_file", stage: "policy_effective", allowed: true, permission: null, code: null }, "tool write_file: allowed"],
      [{ type: "tool_decision", callId: "c", tool: "run_command", stage: "policy_requested", allowed: false, permission: "command", code: "command_not_allowed" }, "tool run_command: denied (command/command_not_allowed)"],
      [{ type: "file_changed", callId: "c", path: masked("src/a.ts"), previousHash: null, newHash: "0".repeat(64), created: true }, "created src/a.ts"],
      [{ type: "verifier_result", result: { id: "unit", kind: "command", outcome: "fail", evidence: masked(""), checked: [], limits: [] } }, "verifier unit: fail"],
      [{ type: "repair_started", attempt: 1, failedVerifiers: ["unit"], feedbackTruncated: false }, "repair 1: 1 verifier failed"],
      [{ type: "integrity_checked", phase: "before_verify", changed: [] }, "protected material before_verify: unchanged"],
      [{ type: "integrity_checked", phase: "after_verify", changed: [masked("a"), masked("b")] }, "protected material after_verify: 2 paths changed or not checkable"],
      [{ type: "run_finished", status: "needs-input", reason: "protected_changed", usage: { modelTurns: 1, toolCalls: 0, inputTokens: null, outputTokens: null, durationMs: 1 } }, "finished: needs-input (protected_changed)"],
      [{ type: "model_response", turn: 1, stop: "final", text: masked("x"), toolCalls: [], usage: null }, null],
      [{ type: "tool_result", result: { callId: "c", tool: "read_file", ok: true, content: masked("{}"), errorCode: null } }, null],
    ];
    for (const [event, line] of events) assert.equal(progressLine(event), line, event.type);
  });

  test("model-written names cannot drive the terminal", () => {
    const tool = progressLine({ type: "tool_decision", callId: "c", tool: `${ESC}[2Jx`, stage: "validate", allowed: false, permission: null, code: "unknown_tool" });
    assert.equal(tool, "tool (unknown tool): denied (check/unknown_tool)");
    const file = progressLine({ type: "file_changed", callId: "c", path: masked(`a${ESC}[31mb${String.fromCharCode(0x202e)}c\rd`), previousHash: null, newHash: "0".repeat(64), created: false });
    assert.equal(file, "changed a?[31mb?c?d");
    const id = progressLine({ type: "verifier_result", result: { id: `x${ESC}`, kind: "command", outcome: "pass", evidence: masked(""), checked: [], limits: [] } });
    assert.equal(id, "verifier ?: pass");
  });

  test("lines are masked with the run's secrets and a failing write is ignored", async () => {
    const appended: JournalEvent[] = [];
    const inner: Journal = { append: async (event) => void appended.push(event), close: async () => {} };
    const privacy = createPrivacyGateway({ secrets: [FAKE_SECRET] });
    const lines: string[] = [];
    const journal = withProgress(inner, privacy, (line) => lines.push(line));
    await journal.append({ type: "file_changed", callId: "c", path: masked(`notes-${FAKE_SECRET}.txt`), previousHash: null, newHash: "0".repeat(64), created: true });
    assert.equal(lines.length, 1);
    assert.ok(lines[0]?.startsWith(`${PROGRESS_PREFIX}created notes-`));
    assert.ok(lines[0]?.endsWith(".txt\n"));
    assert.equal(lines.join("").includes(FAKE_SECRET), false);

    const failing = withProgress(inner, privacy, () => {
      throw new Error("EPIPE");
    });
    await failing.append({ type: "model_request", turn: 1, system: null, newMessages: [] });
    assert.equal(appended.length, 2, "the record is stored even when the progress write fails");
  });

  test("a real run writes progress without secrets; --quiet and pre-run errors write none", async () => {
    const base = await setupRun(
      { "README.md": `# Title\nkey=${FAKE_SECRET}\n` },
      {},
      [
        { toolCalls: [{ name: "read_file", args: { path: "README.md" } }] },
        { toolCalls: [{ name: "write_file", args: { path: `n-${FAKE_SECRET}.txt`, expectedHash: null, change: { kind: "replace_all", content: "x\n" } } }] },
        { toolCalls: [{ name: "run_command", args: { executable: "nope", args: [] } }] },
        { text: "done" },
      ],
    );
    const lines: string[] = [];
    const outcome = await runCli(cliIo(base, { writeProgress: (line) => lines.push(line) }));
    assert.equal(outcome.exitCode, 0);
    const text = lines.join("");
    assert.ok(lines.every((line) => line.startsWith(PROGRESS_PREFIX) && line.endsWith("\n") && line.indexOf("\n") === line.length - 1));
    for (const part of ["run started: task k1-task", "turn 1", "tool read_file: allowed", "created n-", "tool run_command: denied", "verifier readme: pass", "finished: done (verified)"]) {
      assert.ok(text.includes(part), part);
    }
    assert.equal(text.includes(FAKE_SECRET), false);

    const quiet: string[] = [];
    const io = cliIo(base, { writeProgress: (line) => quiet.push(line) });
    await runCli({ ...io, argv: [...io.argv, "--quiet"] });
    assert.deepEqual(quiet, []);

    const early: string[] = [];
    const bad = cliIo(base, { writeProgress: (line) => early.push(line) });
    const refused = await runCli({ ...bad, argv: ["run", "--task", path.join(base, "missing.json")] });
    assert.equal(refused.exitCode, 2);
    assert.deepEqual(early, []);
  });
});

/** N-21: a catalog stand-in that shows the message id, so the help's structure can be checked without N-B's texts. */
const idMessages = { language: "en", format: (id: string) => `<${id}>` } as unknown as MessageCatalog;

describe("U-7 help, version and the package entry", () => {
  test("help and version requests", () => {
    assert.deepEqual(helpRequest(["--help"]), { kind: "help", command: null });
    assert.deepEqual(helpRequest(["-h"]), { kind: "help", command: null });
    assert.deepEqual(helpRequest(["help", "doctor"]), { kind: "help", command: "doctor" });
    assert.deepEqual(helpRequest(["run", "--task", "t.json", "--help"]), { kind: "help", command: "run" });
    assert.deepEqual(helpRequest(["report", "-h"]), { kind: "help", command: "report" });
    assert.deepEqual(helpRequest(["--version"]), { kind: "version" });
    assert.deepEqual(helpRequest(["-v"]), { kind: "version" });
    assert.equal(helpRequest(["help", "nosuch"]), null);
    assert.equal(helpRequest(["--version", "x"]), null);
    assert.equal(helpRequest(["run", "--goal", "-h", "--workspace", "w"]), null);
    assert.equal(helpRequest(["run", "--task", "t.json"]), null);
  });

  test("texts", () => {
    // N-21: usage lines stay English; every description is a catalog message.
    const general = helpText(null, idMessages);
    for (const part of ["codaryn run", "codaryn revert", "codaryn report", "codaryn doctor", "codaryn init", "codaryn runs", "<help.intro>", "<help.key>"]) {
      assert.ok(general.includes(part), part);
    }
    const doctor = helpText("doctor", idMessages);
    for (const part of ["usage: codaryn doctor", "<help.command.doctor>", "--profile <name>", "<help.option.profile>", "<help.exit.doctor>"]) {
      assert.ok(doctor.includes(part), part);
    }
    assert.ok(helpText("revert", idMessages).includes("--dry-run"));
    assert.equal(versionText("0.1.0"), "codaryn 0.1.0\n");
    assert.equal(versionText(null), "codaryn (version unknown)\n");
  });

  test("text is printed as is, JSON as one line", () => {
    assert.equal(renderOutcome({ text: "a\nb", exitCode: 0 }), "a\nb\n");
    assert.equal(renderOutcome({ text: "a\n", exitCode: 0 }), "a\n");
    const output = { schemaVersion: 1, kind: "error", code: "invalid_arguments", exitCode: 2, message: "m" } as const;
    assert.equal(renderOutcome({ output, exitCode: 2 }), `${JSON.stringify(output)}\n`);
  });

  test("package.json bin and files point at the built entry, which starts with a shebang", () => {
    const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
      bin: Record<string, string>;
      files: string[];
      engines: { node: string };
      type: string;
    };
    assert.deepEqual(pkg.bin, { codaryn: "dist/src/cli/main.js" });
    assert.ok(pkg.files.includes("dist/src"));
    assert.equal(pkg.type, "module");
    assert.equal(pkg.engines.node, ">=26.0.0");
    const entry = readFileSync(path.join(repoRoot, "dist", "src", "cli", "main.js"), "utf8");
    assert.ok(entry.startsWith("#!/usr/bin/env node\n") || entry.startsWith("#!/usr/bin/env node\r\n"));
  });
});

describe("arguments of the new switches and commands", () => {
  test("run --quiet", () => {
    const parsed = parseArgs(["run", "--quiet", "--task", "t.json"]);
    assert.ok(parsed.ok);
    assert.equal(parsed.args.quiet, true);
    assert.equal(parseArgs(["run", "--task", "t.json", "--quiet", "--quiet"]).ok, false);
    // DR-49 (U-23): run takes --json (its JSON line at a terminal); g-u23-terminal-json tests it.
    assert.equal(parseArgs(["run", "--task", "t.json", "--json"]).ok, true);
  });

  test("report", () => {
    assert.deepEqual(parseReportArgs(["report", "--workspace", "w", "--run", "r1", "--json"]), {
      ok: true,
      args: { command: "report", workspace: "w", runId: "r1", json: true },
    });
    assert.equal(parseReportArgs(["report", "--workspace", "w"]).ok, false);
    assert.equal(parseReportArgs(["report", "--workspace", "w", "--run", "../x"]).ok, false);
    assert.equal(parseReportArgs(["report", "--workspace", "w", "--run", "r", "--quiet"]).ok, false);
  });

  test("doctor", () => {
    assert.deepEqual(parseDoctorArgs(["doctor"]), {
      ok: true,
      args: { command: "doctor", configPath: null, varsFile: null, taskPath: null, workspace: null, profile: null, json: false },
    });
    const parsed = parseDoctorArgs(["doctor", "--json", "--config", "c.json", "--vars-file", "v", "--task", "t.json"]);
    assert.ok(parsed.ok);
    assert.deepEqual([parsed.args.configPath, parsed.args.varsFile, parsed.args.taskPath, parsed.args.json], ["c.json", "v", "t.json", true]);
    assert.equal(parseDoctorArgs(["doctor", "--task", "t.json", "--workspace", "w"]).ok, false);
    const envFile = parseDoctorArgs(["doctor", "--env-file", "x"]);
    assert.ok(!envFile.ok && envFile.message.includes("--vars-file"));
  });
});
