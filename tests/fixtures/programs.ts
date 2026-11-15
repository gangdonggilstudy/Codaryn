/**
 * Small Node programs that tests copy into a temporary workspace and run through
 * `run_command` or a command verifier. They read and write files relative to their cwd.
 */

import { writeWorkspaceFile } from "./builders.js";
import type { Sandbox } from "./builders.js";

export const PROGRAMS = {
  /** Exits 0 when src/math.mjs adds correctly. */
  "check-add.mjs": [
    'import { add } from "./src/math.mjs";',
    "process.exit(add(2, 3) === 5 ? 0 : 1);",
    "",
  ].join("\n"),

  /** Prints a secret read from a workspace file, plus its Base64 and hex forms. */
  "print-secret.mjs": [
    'import { readFileSync } from "node:fs";',
    'const text = readFileSync("data/secret-source.txt", "utf8");',
    "const a = /^A=(.*)$/m.exec(text)[1];",
    "const b = /^B=(.*)$/m.exec(text)[1];",
    'process.stdout.write("raw:" + a + "\\n");',
    'process.stdout.write("b64:" + Buffer.from(a, "utf8").toString("base64") + "\\n");',
    'process.stdout.write("hex:" + Buffer.from(a, "utf8").toString("hex") + "\\n");',
    'process.stdout.write("rawB:" + b + "\\n");',
    'process.stderr.write("err:" + a + "\\n");',
    "",
  ].join("\n"),

  /** Reports which sensitive variable names reached this child process. */
  "env-report.mjs": [
    'import { writeFileSync } from "node:fs";',
    "const names = Object.keys(process.env).map((name) => name.toUpperCase());",
    "const report = {",
    '  secretA: names.includes("CODARYN_TEST_SECRET"),',
    '  secretB: names.includes("CODARYN_TEST_SECRET_B"),',
    '  probe: names.includes("CODARYN_IT_PROBE"),',
    '  apiKey: names.includes("ANTHROPIC_API_KEY"),',
    '  model: names.includes("CODARYN_MODEL"),',
    "};",
    'writeFileSync("env-report.json", JSON.stringify(report));',
    "console.log(JSON.stringify(report));",
    "",
  ].join("\n"),

  /** Appends its arguments as one JSON line. Used to count real executions. */
  "ok-log.mjs": [
    'import { appendFileSync } from "node:fs";',
    'appendFileSync("ok-log.txt", JSON.stringify(process.argv.slice(2)) + "\\n");',
    "",
  ].join("\n"),

  /** Leaves a marker if it ever runs. It is never on the allow list. */
  "evil.mjs": ['import { writeFileSync } from "node:fs";', 'writeFileSync("marker-evil.txt", "ran");', ""].join("\n"),

  /** Records the arguments it received. */
  "echo-args.mjs": [
    'import { writeFileSync } from "node:fs";',
    'writeFileSync("echo-out.txt", JSON.stringify(process.argv.slice(2)));',
    "",
  ].join("\n"),

  /** Starts a grandchild, writes both pids and keeps running. */
  "spawn-tree.mjs": [
    'import { spawn } from "node:child_process";',
    'import { writeFileSync } from "node:fs";',
    'writeFileSync("child.pid", String(process.pid));',
    'spawn(process.execPath, ["grandchild.mjs"], { stdio: "ignore" });',
    "setInterval(() => {}, 1000);",
    "",
  ].join("\n"),

  /** Writes its pid and a heartbeat every 100 ms until killed. */
  "grandchild.mjs": [
    'import { writeFileSync } from "node:fs";',
    'writeFileSync("grandchild.pid", String(process.pid));',
    'setInterval(() => writeFileSync("heartbeat.txt", String(Date.now())), 100);',
    "",
  ].join("\n"),

  /** Runs for ten minutes unless killed. */
  "sleep.mjs": ["setTimeout(() => {}, 600000);", ""].join("\n"),

  /**
   * Prints `pad` filler characters followed by the secret from data/secret.txt, on stdout and
   * stderr, so the secret straddles the output size limit.
   */
  "print-boundary.mjs": [
    'import { readFileSync } from "node:fs";',
    'const secret = readFileSync("data/secret.txt", "utf8").split("\\n")[0];',
    "const pad = Number(process.argv[2]);",
    'process.stdout.write("y".repeat(pad) + secret + "\\n");',
    'process.stderr.write("w".repeat(pad) + secret + "\\n");',
    "",
  ].join("\n"),

  /** Prints JSON that holds the secret from data/secret.txt (so the secret is JSON-escaped). */
  "print-json.mjs": [
    'import { readFileSync } from "node:fs";',
    'const secret = readFileSync("data/secret.txt", "utf8").split("\\n")[0];',
    'process.stdout.write(JSON.stringify({ value: secret, nested: { list: [secret] } }) + "\\n");',
    "",
  ].join("\n"),

  /** Prints unpadded Base64, base64url and lowercase percent encoding of the secret. */
  "print-variants.mjs": [
    'import { readFileSync } from "node:fs";',
    'const secret = readFileSync("data/secret.txt", "utf8").split("\\n")[0];',
    'const bytes = Buffer.from(secret, "utf8");',
    'process.stdout.write("nopad:" + bytes.toString("base64").replace(/=+$/, "") + "\\n");',
    'process.stdout.write("url64:" + bytes.toString("base64url") + "\\n");',
    "const lower = encodeURIComponent(secret).replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase());",
    'process.stdout.write("pct:" + lower + "\\n");',
    "",
  ].join("\n"),

  /** Exits with the code given as the first argument (default 1). */
  "exit-code.mjs": ['process.exit(Number(process.argv[2] ?? "1"));', ""].join("\n"),
} as const;

export type ProgramName = keyof typeof PROGRAMS;

export function writeProgram(sandbox: Sandbox, name: ProgramName): void {
  writeWorkspaceFile(sandbox, name, PROGRAMS[name]);
}
