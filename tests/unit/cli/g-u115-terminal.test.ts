/**
 * U-115 (UXM-9): the first use on the real CLI (dist/src/cli/main.js), at a terminal and not. A
 * preload (u115-terminal-preload) makes the CLI see a terminal on the streams a case names; the
 * output still comes back through pipes. A sandboxed home (APPDATA, HOME, XDG_CONFIG_HOME), English,
 * no key variable, the network guard preloaded. Nothing is sent: every case stops before a request.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, describe, test } from "node:test";
import type { MessageId } from "../../../src/contracts/index.js";
import { helpText } from "../../../src/cli/help.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const MAIN = path.resolve(here, "..", "..", "..", "src", "cli", "main.js");
const TERMINAL = pathToFileURL(path.join(here, "u115-terminal-preload.js")).href;
const GUARD = pathToFileURL(path.resolve(here, "..", "..", "support", "net-guard.js")).href;
const english = createMessageCatalog("en");
const en = (id: MessageId, params?: Record<string, unknown>): string => (english.format as (id: MessageId, params?: Record<string, unknown>) => string)(id, params);
const LIMITS = { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: 10_000, maxDurationMs: 60_000 };

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A sandbox: a home with no config file yet and a workspace. */
function sandbox(): { base: string; home: string; work: string } {
  const base = mkdtempSync(path.join(tmpdir(), "codaryn-g-u115t-"));
  dirs.push(base);
  const home = path.join(base, "home");
  const work = path.join(base, "work");
  mkdirSync(home);
  mkdirSync(work);
  return { base, home, work };
}

/** The default config file of the sandbox's home, as the CLI finds it on this platform. */
function writeDefaultConfig(home: string, config: object): void {
  const dir = process.platform === "win32" ? path.join(home, "Codaryn") : path.join(home, "codaryn");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "config.json"), JSON.stringify(config));
}

function cli(box: { base: string; home: string }, args: readonly string[], terminal: readonly ("stdout" | "stderr" | "stdin")[]): { status: number | null; stdout: string; stderr: string } {
  const env: Record<string, string> = {
    APPDATA: box.home,
    LOCALAPPDATA: box.home,
    HOME: box.home,
    USERPROFILE: box.home,
    XDG_CONFIG_HOME: box.home,
    CODARYN_LANG: "en",
    CODARYN_TEST_TERMINAL: terminal.join(","),
    CODARYN_IT_NET_GUARD_LOG: path.join(box.base, "net-guard.log"),
  };
  for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP"]) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  const run = spawnSync(process.execPath, ["--import", GUARD, "--import", TERMINAL, MAIN, ...args], { cwd: box.base, env, encoding: "utf8", input: "" });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

const BOTH = ["stdout", "stderr"] as const;

describe("U-115 (A) on the real CLI: the short help at a terminal only", () => {
  test("codaryn and codaryn --help at a terminal: the short help, exit 0", () => {
    const box = sandbox();
    for (const args of [[], ["--help"]]) {
      const run = cli(box, args, BOTH);
      assert.equal(run.status, 0, run.stderr);
      assert.equal(run.stdout, helpText(null, english, { terminal: true }));
    }
  });

  test("not at a terminal: --help is the full help, codaryn alone is invalid_arguments, as before", () => {
    const box = sandbox();
    const full = cli(box, ["--help"], []);
    assert.equal(full.stdout, helpText(null, english));
    const alone = cli(box, [], []);
    assert.equal(alone.status, 2);
    assert.equal((JSON.parse(alone.stdout.trim()) as { code: string }).code, "invalid_arguments");
  });
});

describe("U-115 (B) on the real CLI: doctor's next steps at a terminal only", () => {
  const block = [
    en("doctor.next.heading"),
    `  1. ${en("doctor.next.init")}`,
    `  2. ${en("doctor.next.key", { keyEnv: "ANTHROPIC_API_KEY" })}`,
    `  3. ${en("doctor.next.model_after_key")}`,
    `  4. ${en("doctor.next.again")}`,
    en("first_use.try_without_key"),
  ];

  test("nothing set up: the block after the closing line; not at a terminal: the closing line ends it", () => {
    const box = sandbox();
    const atTerminal = cli(box, ["doctor"], BOTH);
    const plain = cli(box, ["doctor"], []);
    assert.equal(atTerminal.status, 1);
    assert.equal(plain.status, 1);
    assert.equal(atTerminal.stdout, `${plain.stdout}${block.join("\n")}\n`);
    assert.equal(plain.stdout.includes(en("doctor.next.heading")), false);
  });

  test("doctor --json at a terminal: as not at a terminal", () => {
    const box = sandbox();
    assert.equal(cli(box, ["doctor", "--json"], BOTH).stdout, cli(box, ["doctor", "--json"], []).stdout);
  });
});

describe("U-115 (c) on the real CLI: no config file at all", () => {
  test("the run's error carries config_missing; the human line says so, at a terminal and not", () => {
    const box = sandbox();
    const args = ["run", "--workspace", box.base, "--goal", "add an install section"];
    const plain = cli(box, args, []);
    assert.equal(plain.status, 2);
    const output = JSON.parse(plain.stdout.trim()) as { code: string; hint?: string };
    assert.deepEqual([output.code, output.hint], ["invalid_config", "config_missing"]);
    assert.ok(plain.stderr.includes(en("error.hint.config_missing")), plain.stderr);
    const atTerminal = cli(box, args, BOTH);
    assert.equal(atTerminal.status, 2);
    assert.ok(atTerminal.stderr.includes(en("error.hint.config_missing")), atTerminal.stderr);
  });
});

describe("U-115 (D, E) on the real CLI: the way to try without a key", () => {
  test("a run stopped for its provider settings: at a terminal the line follows the error; not at a terminal it does not", () => {
    const box = sandbox();
    writeDefaultConfig(box.home, { schemaVersion: 1, model: "fake-model-u115", maxOutputTokens: 1000, limits: LIMITS });
    const args = ["run", "--workspace", box.work, "--goal", "add an install section"];
    const atTerminal = cli(box, args, BOTH);
    const plain = cli(box, args, []);
    assert.equal(atTerminal.status, 7, atTerminal.stderr);
    assert.ok(atTerminal.stderr.trimEnd().endsWith(en("first_use.try_without_key")), atTerminal.stderr);
    assert.equal(plain.stderr.includes(en("first_use.try_without_key")), false, plain.stderr);
    assert.equal(atTerminal.stderr.replace(`  ${en("first_use.try_without_key")}\n`, ""), plain.stderr, "otherwise the same error text");
  });

  test("init with stdout at a terminal (no questions): the line after its next line; not at a terminal: as before", () => {
    const one = sandbox();
    const atTerminal = cli(one, ["init"], ["stdout"]);
    const two = sandbox();
    const plain = cli(two, ["init"], []);
    assert.equal(atTerminal.status, 0, atTerminal.stderr);
    assert.equal(atTerminal.stdout, `${plain.stdout}${en("first_use.try_without_key")}\n`);
    assert.ok(plain.stdout.endsWith(`${en("init.next")}\n`), plain.stdout);
  });
});
