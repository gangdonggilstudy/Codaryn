/**
 * Windows `.cmd` helpers for the G1 integration cases (running batch files such as npm.cmd as
 * allowed commands). A test makes a temporary bin directory with a `.cmd` shim, puts that
 * directory first on PATH for the CLI process, and allows the shim by name.
 *
 * The shim works like npm.cmd: it starts node with a small recorder script and passes `%*`.
 * The recorder appends its arguments as one JSON line to `cmd-log.jsonl` in its working
 * directory, so a test can count real executions and see the exact arguments that arrived.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { NODE } from "./cli.js";

export const CMD_LOG_FILE = "cmd-log.jsonl";
/** Created in the working directory only if an injected command ever runs. */
export const CMD_INJECTION_MARKER = "cmd-injected.txt";

export const IS_WINDOWS = process.platform === "win32";

const RECORDER = [
  'import { appendFileSync } from "node:fs";',
  `appendFileSync(${JSON.stringify(CMD_LOG_FILE)}, JSON.stringify(process.argv.slice(2)) + "\\n");`,
  'process.stdout.write("cmd shim ran\\n");',
  "",
].join("\n");

export interface CmdShim {
  /** Directory to put first on PATH. */
  readonly binDir: string;
  /** Bare name, for example `fake-npm`. */
  readonly name: string;
  /** File name with extension, for example `fake-npm.cmd`. */
  readonly fileName: string;
  /** Absolute path of the `.cmd` file. */
  readonly path: string;
}

/**
 * Writes `<binDir>/<name>.cmd` (CRLF lines) and its recorder script. The node path is written
 * into the shim so the shim works even when PATH holds nothing else.
 */
export function writeCmdShim(binDir: string, name: string, extension: ".cmd" | ".bat" = ".cmd"): CmdShim {
  mkdirSync(binDir, { recursive: true });
  const recorder = `${name}-recorder.mjs`;
  writeFileSync(join(binDir, recorder), RECORDER);
  const fileName = `${name}${extension}`;
  const path = join(binDir, fileName);
  const lines = ["@ECHO OFF", `"${NODE}" "%~dp0${recorder}" %*`, "EXIT /B %ERRORLEVEL%", ""];
  writeFileSync(path, lines.join("\r\n"));
  return { binDir, name, fileName, path };
}

/**
 * Copy of `env` with `dir` first on PATH. Windows treats variable names case-insensitively, so
 * the existing entry (often `Path`) is replaced instead of adding a second `PATH`.
 */
export function withPathPrefix(env: NodeJS.ProcessEnv, dir: string): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  let current: string | undefined;
  let key = "PATH";
  for (const [name, value] of Object.entries(env)) {
    if (name.toUpperCase() === "PATH") {
      current = value;
      key = name;
      continue;
    }
    result[name] = value;
  }
  result[key] = current === undefined || current === "" ? dir : `${dir}${delimiter}${current}`;
  return result;
}

/**
 * Arguments that cmd.exe would treat as syntax. Each one, if it reached cmd.exe unquoted, could
 * run another command, redirect output, expand a variable or split the argument. The `&` and
 * `|` cases try to create CMD_INJECTION_MARKER.
 */
export const CMD_METACHAR_ARGS: readonly { readonly label: string; readonly arg: string }[] = [
  { label: "ampersand", arg: `x&echo pwned>${CMD_INJECTION_MARKER}` },
  { label: "pipe", arg: `x|echo pwned>${CMD_INJECTION_MARKER}` },
  { label: "redirect-out", arg: `x>${CMD_INJECTION_MARKER}` },
  { label: "redirect-in", arg: "x<nul" },
  { label: "caret", arg: "x^y" },
  { label: "percent", arg: "%PATH%" },
  { label: "bang", arg: "!PATH!" },
  { label: "double-quote", arg: 'x" & echo pwned>' + CMD_INJECTION_MARKER + ' & "' },
  { label: "parenthesis", arg: "(x)" },
  { label: "newline", arg: "x\r\necho pwned" },
];

/** Plain arguments a shim must receive unchanged. */
export const CMD_PLAIN_ARGS: readonly string[] = ["test", "--reporter=dot", "src/price.js", "a-b_c.d"];
