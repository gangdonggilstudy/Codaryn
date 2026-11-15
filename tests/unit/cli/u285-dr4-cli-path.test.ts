/**
 * U-285 (CLI migration C-4; adapter-contract 7.1): DR-4's two cases on the CLI's own path, which the
 * app layer's tests cover for the app (A-1, U-71) and the plan asks to pin on the CLI too before the
 * run's assembly moves to the app layer (C-4; the CLI's runs keep their parent environment there).
 * 1. On Windows a `secretEnv` name that differs from the environment variable only in case is found
 *    and its value masked; elsewhere such a name is not found (secret_env_missing).
 * 2. A variables file's allow-listed variable with a short value (LANG, under the 8 characters from
 *    which S-4 registers a value as a secret) reaches a child command as it is; a value of 8 or more
 *    characters is registered as a secret and is left out of the child's environment.
 * Real CLI, scripted model, temporary folders. These pass before the move and must after it.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { cliEnv } from "../../support/cli.js";
import type { CliRun } from "../../support/cli.js";
import { runGuarded } from "../../support/fake-anthropic.js";
import { createSandbox, writeWorkspaceFile } from "../../fixtures/builders.js";
import type { Sandbox } from "../../fixtures/builders.js";
import { textStep, toolStep, writeGeneralTask } from "../../fixtures/general-tasks.js";

const json = (run: CliRun): Record<string, unknown> => JSON.parse(run.stdout.trim().split("\n").pop() ?? "") as Record<string, unknown>;

function journalText(sb: Sandbox): string {
  const runs = path.join(sb.workspace, ".codaryn", "runs");
  return readdirSync(runs).map((id) => readFileSync(path.join(runs, id, "journal.jsonl"), "utf8")).join("\n");
}

describe("U-285 (DR-4) on the CLI's path", () => {
  test("a secretEnv name that differs only in case: found and masked on Windows, not found elsewhere", { timeout: 60_000 }, async (t) => {
    const sb = createSandbox(t);
    const value = "fake-dr4-SECRET-0099";
    writeWorkspaceFile(sb, "notes.md", `the value ${value} is here\n`);
    const task = writeGeneralTask(sb, { id: "u285-case", fields: { privacy: { secretEnv: ["CMP_DR4_SECRET"] } } }, [toolStep("read_file", { path: "notes.md" }), textStep("done")]);
    const ran = await runGuarded(sb, ["run", "--task", task], cliEnv({ extra: { cmp_dr4_secret: value } }));
    const output = json(ran);
    if (process.platform === "win32") {
      assert.equal(output["kind"], "run", ran.stdout);
      const journal = journalText(sb);
      assert.equal(journal.includes(value), false, "the value is masked in the records");
      assert.ok(journal.includes("[[CODARYN_SECRET:"), "a token stands in its place");
      assert.equal(`${ran.stdout}${ran.stderr}`.includes(value), false);
    } else {
      assert.equal(output["code"], "secret_env_missing", ran.stdout);
    }
  });

  for (const [label, lang, reaches] of [
    ["a short LANG from the variables file reaches the child command", "u285ko", true],
    ["a LANG of 8 or more characters is a secret and is left out of the child's environment", "u285-long-value", false],
  ] as const) {
    test(label, { timeout: 60_000 }, async (t) => {
      const sb = createSandbox(t);
      writeWorkspaceFile(sb, "README.md", "# Title\n");
      const script = path.join(sb.base, "check-lang.mjs");
      // Exit 0 when the child saw what the case expects, else 3.
      writeFileSync(script, `process.exit((process.env.LANG === ${JSON.stringify(lang)}) === ${String(reaches)} ? 0 : 3);\n`, "utf8");
      const vars = path.join(sb.base, "vars.env");
      writeFileSync(vars, `LANG=${lang}\n`, "utf8");
      const verifier = { id: "lang", kind: "command", executable: process.execPath, args: [script], expectExitCode: 0 };
      const task = writeGeneralTask(sb, { id: "u285-lang", verifiers: [verifier] as never }, [textStep("done")]);
      const ran = await runGuarded(sb, ["run", "--task", task, "--vars-file", vars], cliEnv());
      const output = json(ran);
      assert.deepEqual([output["status"], output["reason"]], ["done", "verified"], ran.stdout);
    });
  }
});
