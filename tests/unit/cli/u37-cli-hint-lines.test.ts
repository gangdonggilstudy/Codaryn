/**
 * U-37 (review R-69 M1, L2), on the real CLI: the human error tells the reason of the two most common
 * cases in the chosen language, as a line of its own, and the JSON line carries only `hint`:
 * - an unknown or repeated option (`run --bogus`, and `runs --bogus`, whose parser had no hint, L2):
 *   error.hint.unknown_option with the argument's position;
 * - a run whose provider has no key, model or output limit: error.hint.provider_settings_missing and
 *   one item line per setting not set.
 * The real CLI under the net guard, both languages, a sandboxed config folder and no key variable:
 * every case stops before a model is made, so nothing is sent. Fake values only.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, describe, test } from "node:test";
import { MESSAGE_LANGUAGES, toSchemaFieldPath } from "../../../src/contracts/index.js";
import type { CatalogText, SchemaFieldPath } from "../../../src/contracts/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const main = path.resolve(here, "..", "..", "..", "src", "cli", "main.js");
const guard = pathToFileURL(path.resolve(here, "..", "..", "support", "net-guard.js")).href;
const field = (place: string): SchemaFieldPath => toSchemaFieldPath(place) as SchemaFieldPath;

async function base(): Promise<{ dir: string; env: Record<string, string> }> {
  const dir = await mkdtemp(path.join(tmpdir(), "codaryn-u37-"));
  temporaryDirs.push(dir);
  await mkdir(path.join(dir, "ws"));
  await mkdir(path.join(dir, "config"));
  const env: Record<string, string> = { APPDATA: path.join(dir, "config"), XDG_CONFIG_HOME: path.join(dir, "config") };
  for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "HOME"]) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return { dir, env };
}

for (const language of MESSAGE_LANGUAGES) {
  const catalog = createMessageCatalog(language);
  const format = catalog.format as (id: string, ...rest: unknown[]) => CatalogText;
  const cli = (dir: string, env: Record<string, string>, args: readonly string[]) =>
    spawnSync(process.execPath, ["--import", guard, main, ...args], { cwd: dir, env: { ...env, CODARYN_LANG: language }, encoding: "utf8" });
  const json = (stdout: string): Record<string, unknown> => JSON.parse(stdout.trim().split(/\r?\n/).filter((line) => line.startsWith("{")).pop() ?? "{}") as Record<string, unknown>;

  describe(`U-37 (R-69) on the real CLI, ${language}`, () => {
    test("an unknown option: the reason line with its position; the JSON line has the hint and no position", async () => {
      const { dir, env } = await base();
      for (const [args, position] of [[["run", "--bogus"], 1], [["run", "--workspace", "ws", "--goal", "g", "--goal", "h"], 5]] as const) {
        const outcome = cli(dir, env, args);
        assert.equal(outcome.status, 2, outcome.stderr);
        assert.ok(outcome.stderr.split(/\r?\n/).includes(`  ${format("error.hint.unknown_option", { position })}`), outcome.stderr);
        const line = json(outcome.stdout);
        assert.deepEqual([line["code"], line["hint"]], ["invalid_arguments", "unknown_option"], outcome.stdout);
        assert.equal(outcome.stdout.includes("position"), false, outcome.stdout);
      }
    });

    test("runs: an unknown or repeated option has the same hint and line (L2)", async () => {
      const { dir, env } = await base();
      for (const [args, position] of [[["runs", "--bogus"], 1], [["runs", "--workspace", "ws", "--json", "--json"], 4], [["runs", "--limit", "2", "--limit", "3"], 3]] as const) {
        const outcome = cli(dir, env, args);
        assert.equal(outcome.status, 2, outcome.stderr);
        assert.ok(outcome.stderr.split(/\r?\n/).includes(`  ${format("error.hint.unknown_option", { position })}`), `${args.join(" ")}\n${outcome.stderr}`);
        assert.deepEqual([json(outcome.stdout)["code"], json(outcome.stdout)["hint"]], ["invalid_arguments", "unknown_option"], outcome.stdout);
      }
      // A value that is missing is another reason: no hint, as for the other commands.
      const missing = cli(dir, env, ["runs", "--limit"]);
      assert.equal(json(missing.stdout)["hint"], undefined, missing.stdout);
    });

    test("a provider with no key, model or output limit: the reason line, then one item per setting", async () => {
      const { dir, env } = await base();
      const task = {
        schemaVersion: 1, id: "u37", goal: "g", workflow: "test", workspaceRoot: "./ws", model: { provider: "anthropic" },
        policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false }, privacy: { secretEnv: [] },
        limits: { maxModelTurns: 2, maxToolCalls: 2, maxTotalTokens: 1000, maxDurationMs: 60_000 }, verifiers: [],
      };
      await writeFile(path.join(dir, "task.json"), JSON.stringify(task), "utf8");
      const outcome = cli(dir, env, ["run", "--task", "task.json"]);
      assert.equal(json(outcome.stdout)["hint"], "provider_settings_missing", outcome.stdout);
      const lines = outcome.stderr.split(/\r?\n/);
      const at = lines.indexOf(`  ${format("error.hint.provider_settings_missing")}`);
      assert.ok(at > 0, outcome.stderr);
      const items = lines.slice(at + 1).filter((line) => line.startsWith("    - "));
      assert.ok(items.length >= 2, outcome.stderr);
      assert.equal(items[0], `    - ${format("error.missing.key", { keyEnv: "ANTHROPIC_API_KEY" })}`, outcome.stderr);
      assert.ok(items.some((line) => line.startsWith(`    - ${format("error.missing.output_limit", { field: field("maxOutputTokens") }).split("(")[0] ?? "?"}`)), outcome.stderr);
      // The detail stays out of the JSON line: no "missing" key (the hint's own name has the word).
      assert.equal(/"missing"\s*:/.test(outcome.stdout), false, outcome.stdout);
    });
  });
}
