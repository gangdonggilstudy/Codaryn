/**
 * V-3 (L1-3): `--env-file-if-exists` is refused like `--env-file`, with the same hint, in every
 * command. And the K1 assembly connection: the run builds `createIntegrityChecker` from
 * `policy.protectedPaths` and the config file's `integrity.paths` and passes it as
 * `EngineDeps.integrity`. Real assembly, scripted model, fake values only, no network.
 */

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";

import { JOURNAL_FILE_NAME, RUNS_DIR_NAME, STATE_DIR_NAME } from "../../../src/contracts/index.js";
import type { EngineResult } from "../../../src/contracts/index.js";
import { ENV_FILE_REFUSED_MESSAGE, parseArgs, parseDoctorArgs, parseReportArgs, parseRevertArgs } from "../../../src/cli/args.js";
import { runCli } from "../../../src/cli/run.js";
import { FAKE_SECRET, cliIo, setupRun } from "./k-support.js";

describe("V-3 --env-file-if-exists is refused like --env-file", () => {
  test("the review's input: run --env-file-if-exists=no-such.env --task none.json", () => {
    const parsed = parseArgs(["run", "--env-file-if-exists=no-such.env", "--task", "none.json"]);
    assert.deepEqual(parsed, { ok: false, message: ENV_FILE_REFUSED_MESSAGE });
  });

  test("the message names both Node options and the codaryn one", () => {
    for (const name of ["--env-file", "--env-file-if-exists", "--vars-file"]) {
      assert.ok(ENV_FILE_REFUSED_MESSAGE.includes(name), name);
    }
  });

  test("both spellings, anywhere, in every command", () => {
    const forms = [
      ["--env-file-if-exists", "x.env"],
      ["--env-file-if-exists=x.env"],
      ["--env-file", "x.env"],
      ["--env-file=x.env"],
    ];
    for (const form of forms) {
      const run = parseArgs(["run", "--task", "t.json", ...form]);
      const doctor = parseDoctorArgs(["doctor", ...form]);
      const report = parseReportArgs(["report", "--workspace", "w", "--run", "r1", ...form]);
      const revert = parseRevertArgs(["revert", ...form, "--workspace", "w", "--run", "r1"]);
      for (const outcome of [run, doctor, report, revert]) {
        assert.deepEqual(outcome, { ok: false, message: ENV_FILE_REFUSED_MESSAGE }, form.join(" "));
      }
    }
    // Other names that only start the same way are ordinary unknown options.
    const other = parseArgs(["run", "--task", "t.json", "--env-files", "x"]);
    assert.ok(!other.ok && other.message !== ENV_FILE_REFUSED_MESSAGE);
  });

  test("runCli refuses it before reading anything", async () => {
    const base = await setupRun({ "README.md": "# Title\n" }, {}, [{ text: "done" }]);
    const read: string[] = [];
    const io = cliIo(base, {
      readFile: async (file) => {
        read.push(file);
        return readFile(file, "utf8");
      },
    });
    const outcome = await runCli({ ...io, argv: ["run", "--env-file-if-exists=no-such.env", "--task", "none.json"] });
    assert.equal(outcome.exitCode, 2);
    assert.deepEqual(outcome.output, { schemaVersion: 1, kind: "error", code: "invalid_arguments", exitCode: 2, message: ENV_FILE_REFUSED_MESSAGE });
    assert.deepEqual(read, []);
  });
});

/** Appends a line to a file: the verifier command that changes protected material. */
const TOUCH_SCRIPT = "import { appendFileSync } from 'node:fs';\nappendFileSync(process.argv[2], 'changed\\n');\n";

async function journalOf(work: string, runId: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(path.join(work, STATE_DIR_NAME, RUNS_DIR_NAME, runId, JOURNAL_FILE_NAME), "utf8");
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function run(
  base: string,
  configPath: string | null = null,
): Promise<{ result: EngineResult; journal: Record<string, unknown>[]; exitCode: number }> {
  const io = cliIo(base);
  const argv = configPath === null ? io.argv : [...io.argv, "--config", configPath];
  const outcome = await runCli({ ...io, argv });
  assert.equal(outcome.output.kind, "run", JSON.stringify(outcome.output));
  const result = outcome.output as EngineResult;
  return { result, journal: await journalOf(path.join(base, "work"), result.runId), exitCode: outcome.exitCode };
}

function phases(journal: readonly Record<string, unknown>[]): unknown[] {
  return journal.filter((record) => record["type"] === "integrity_checked").map((record) => [record["phase"], record["changed"]]);
}

const PROTECT_README = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, protectedPaths: ["README.md"] };

describe("K1 connection: the run passes an integrity checker to the engine", () => {
  test("protectedPaths alone: checked at start and around the round, nothing changed", async () => {
    const base = await setupRun({ "README.md": "# Title\n" }, { policy: PROTECT_README }, [{ text: "done" }]);
    const { result, journal } = await run(base);
    assert.equal(result.status, "done");
    assert.deepEqual(result.protectedChanged, []);
    assert.deepEqual(phases(journal), [
      ["run_start", []],
      ["before_verify", []],
      ["after_verify", []],
    ]);
  });

  test("a verifier command that changes a protected file ends the run as needs-input/protected_changed", async () => {
    const base = await setupRun(
      { "README.md": "# Title\n", "touch.mjs": TOUCH_SCRIPT },
      {
        policy: PROTECT_README,
        verifiers: [{ id: "toucher", kind: "command", executable: process.execPath, args: ["touch.mjs", "README.md"] }],
      },
      [{ text: "done" }],
    );
    const { result, journal, exitCode } = await run(base);
    assert.deepEqual([result.status, result.reason, exitCode], ["needs-input", "protected_changed", 3]);
    assert.deepEqual(result.protectedChanged, ["README.md"]);
    assert.deepEqual(phases(journal).at(-1), ["after_verify", ["README.md"]]);
  });

  test("integrity.paths outside the workspace are checked too, and a change there is caught", async () => {
    const base = await setupRun(
      { "README.md": "# Title\n", "touch.mjs": TOUCH_SCRIPT },
      {
        verifiers: [{ id: "toucher", kind: "command", executable: process.execPath, args: ["touch.mjs", path.join("..", "baseline", "spec.txt")] }],
      },
      [{ text: "done" }],
    );
    await mkdir(path.join(base, "baseline"));
    await writeFile(path.join(base, "baseline", "spec.txt"), `spec ${FAKE_SECRET}\n`);
    const config = path.join(base, "config.json");
    await writeFile(config, JSON.stringify({ schemaVersion: 1, integrity: { paths: [path.join(base, "baseline")] } }));
    const { result } = await run(base, config);
    assert.deepEqual([result.status, result.reason], ["needs-input", "protected_changed"]);
    const shown = (result.protectedChanged ?? []).join(" ");
    assert.ok(shown.endsWith("baseline/spec.txt"), shown);
    assert.equal(JSON.stringify(result).includes(FAKE_SECRET), false);
  });

  test("nothing protected: no checker, no integrity record, no protectedChanged", async () => {
    const base = await setupRun({ "README.md": "# Title\n" }, {}, [{ text: "done" }]);
    const { result, journal } = await run(base);
    assert.equal(result.status, "done");
    assert.equal("protectedChanged" in result, false);
    assert.deepEqual(phases(journal), []);
  });
});
