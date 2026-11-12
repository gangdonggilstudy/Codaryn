/**
 * Review R-12 L-2: the quick form of plan, apply and review explains in the JSON message that it
 * reads the run settings from the config and points at the plan run's --task (R-11 L-2), but the
 * person's stderr shows only the generic fix. The built CLI runs as a process; nothing is sent.
 *
 * The CLI sets `hint: "quick_form_needs_task"` (contract 2045058); the human renderer adds the line
 * (N-C) from the texts `error.hint.*` (N-B). Until both are in, the stderr case is `todo`.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, test } from "node:test";

const MAIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "src", "cli", "main.js");
const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

async function quickPlan(command: "plan" | "apply" | "review"): Promise<{ stdout: string; stderr: string; status: number | null }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-r12-"));
  temporaryDirs.push(base);
  const ws = path.join(base, "ws");
  await mkdir(ws);
  await writeFile(path.join(base, "config.json"), JSON.stringify({ schemaVersion: 1 }), "utf8");
  const extra = command === "apply" ? ["--digest", "0".repeat(12)] : command === "review" ? ["--accept"] : [];
  const argv = [MAIN, command, "--workspace", ws, "--config", path.join(base, "config.json"), "--run", "20261112T000000Z-00000000", ...extra];
  const env: Record<string, string> = { CODARYN_LANG: "en" };
  for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "HOME", "APPDATA"]) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  const result = spawnSync(process.execPath, argv, { cwd: base, env, encoding: "utf8" });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

describe("R-12 L-2: the quick form's config need", () => {
  test("the JSON message names the quick form and --task (R-11 L-2)", async () => {
    for (const command of ["plan", "apply", "review"] as const) {
      const { stdout, status } = await quickPlan(command);
      const output = JSON.parse(stdout) as { code: string; message: string; hint?: string };
      assert.deepEqual([output.code, status], ["invalid_config", 2], command);
      // R-12 L-2: the hint the human renderer turns into its own stderr line.
      assert.equal(output.hint, "quick_form_needs_task", command);
      assert.ok(output.message.includes("quick form") && output.message.includes("--task"), output.message);
    }
  });

  test("the person's stderr says it too", { todo: "R-12 L-2: the CLI sets hint quick_form_needs_task; the renderer line (N-C) and the texts error.hint.* (N-B) are next" }, async () => {
    for (const command of ["plan", "apply", "review"] as const) {
      const { stderr } = await quickPlan(command);
      assert.ok(stderr.includes("--task"), `${command}: ${stderr}`);
    }
  });
});
