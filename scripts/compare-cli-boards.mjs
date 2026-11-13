#!/usr/bin/env node
// U-130 (the CLI migration plan, DR-65): compares what the real CLI of two builds does.
//
// Usage: node scripts/compare-cli-boards.mjs --base <commit> --head <commit>
//          [--cases <name,name>] [--work <folder>] [--out <report.md>] [--keep]
//
// - Each commit is unpacked with `git archive` into a folder of its own under the work folder
//   (no worktree), and built there with this checkout's TypeScript (node_modules is linked in for
//   the build only and the link is taken back at once).
// - Each case of scripts/compare-cli/cases.mjs runs with each build's CLI in the same fresh case
//   folder: scripted models (a fake API on 127.0.0.1 only for the cases that need one, U-135), the
//   default config locations (APPDATA, XDG_CONFIG_HOME, HOME, USERPROFILE) inside the case folder,
//   no real key, and the tests' network fence
//   (dist/tests/support/net-guard.js) loaded so only loopback could be reached; a fence log fails
//   the case.
// - For each step: stdout, stderr and the exit code; after the steps, every file in the case
//   folder (the run records: result.json, journal.jsonl, plan.json and the rest, and the
//   workspace). Both sides are normalized (scripts/compare-cli/normalize.mjs) and compared
//   character by character; the report names every differing line.
// - Exit code: 0 no difference, 1 differences, 2 the tool could not compare.
// The work folder (default: the system's temporary folder) is removed at the end unless --keep.
//
// U-135: terminal cases, imitated. A step with `terminal` runs with scripts/compare-cli/
// terminal-preload.mjs loaded, which sets `isTTY` on the streams it names (as the unit tests'
// preloads do); the streams stay pipes. A step with `answers` types them one by one: each time the
// output stops without a line end (a question waits) the next answer and Enter are written
// (Ctrl+C is the byte 0x03 alone); when the answers run out the input is closed. A case with `api`
// gets a fake Anthropic API on 127.0.0.1 (scripts/compare-cli/fake-anthropic.mjs) and a fake key:
// a permission question comes only from a config's rule, and a config's runs use an API provider.
// The requests it got are compared too. The report says the terminal cases are an imitation.
//
// U-167: a case's `api.models` makes the fake API list those models (GET /v1/models) for
// `codaryn models`. A cleanup step's byte counts are normalized (normalize.mjs).

import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CASES, FAKE_API_KEY } from "./compare-cli/cases.mjs";
import { startFakeAnthropic } from "./compare-cli/fake-anthropic.mjs";
import { compareSides, normalizeSide, pathForms } from "./compare-cli/normalize.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STEP_TIMEOUT_MS = 120_000;
const NET_GUARD_LOG = "net-guard.log";
const TERMINAL_PRELOAD = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "compare-cli", "terminal-preload.mjs")).href;
/** A question is taken as waiting once the output has stopped this long without a line end. */
const QUESTION_IDLE_MS = 150;
const CTRL_C = String.fromCharCode(3);
/** The variable the fake API cases set to FAKE_API_KEY (the provider's key variable). */
const KEY_VARIABLE = "ANTHROPIC_API_KEY";

/** The note at the head of every report. */
export const TERMINAL_NOTE =
  "Terminal cases (`terminal-*`) are an imitation: the CLI's streams are pipes whose `isTTY` a preload sets true, as the unit tests do; readline then reads keys as at a terminal (Ctrl+C is the byte 0x03). No console or pty is used, so what only a real terminal does (raw mode, window size, echo) is not compared.";

function git(args) {
  return execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8" }).trim();
}

/**
 * Runs a program; resolves with its exit code and output. With `answers` its input stays open and
 * each answer is typed when the output stops without a line end; the input closes after the last.
 */
function exec(command, args, options = {}) {
  const { answers, timeoutMs, ...spawnOptions } = options;
  return new Promise((resolve) => {
    const child = spawn(command, args, { ...spawnOptions, stdio: [answers === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    const out = [];
    const err = [];
    let lastOutputAt = Date.now();
    let lastByte = 10;
    const seen = (chunks) => (chunk) => {
      chunks.push(chunk);
      lastOutputAt = Date.now();
      if (chunk.length > 0) lastByte = chunk[chunk.length - 1];
    };
    child.stdout.on("data", seen(out));
    child.stderr.on("data", seen(err));
    const timer = setTimeout(() => child.kill(), timeoutMs ?? STEP_TIMEOUT_MS);
    let typing = null;
    if (answers !== undefined) {
      const left = [...answers];
      if (left.length === 0) child.stdin.end();
      else {
        typing = setInterval(() => {
          if (lastByte === 10 || Date.now() - lastOutputAt < QUESTION_IDLE_MS) return;
          const answer = left.shift();
          child.stdin.write(answer === CTRL_C ? answer : `${answer}\n`);
          lastByte = 10;
          if (left.length === 0) {
            clearInterval(typing);
            typing = null;
            child.stdin.end();
          }
        }, 25);
      }
      child.stdin.on("error", () => {});
    }
    const finish = (result) => {
      clearTimeout(timer);
      if (typing !== null) clearInterval(typing);
      resolve(result);
    };
    child.on("error", (error) => finish({ code: null, signal: null, stdout: Buffer.concat(out), stderr: Buffer.concat([...err, Buffer.from(String(error))]) }));
    child.on("close", (code, signal) => finish({ code, signal, stdout: Buffer.concat(out), stderr: Buffer.concat(err) }));
  });
}

/** Takes back a link (junction) only: never what it points to. */
function removeLink(link) {
  let info;
  try {
    info = lstatSync(link);
  } catch {
    return;
  }
  if (!info.isSymbolicLink()) throw new Error(`${link} is not a link; it is left as it is`);
  try {
    unlinkSync(link);
  } catch {
    rmdirSync(link);
  }
}

/**
 * Unpacks `commit` into `dir` (git archive) and builds it. `alter(dir)` may change the unpacked
 * sources before the build (the tool's own tests). Returns the build.
 */
export async function prepareBoard({ commit, dir, nodeModules = path.join(REPO, "node_modules"), alter }) {
  const sha = git(["rev-parse", "--verify", `${commit}^{commit}`]);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const archive = await new Promise((resolve) => {
    const gitChild = spawn("git", ["-C", REPO, "archive", "--format=tar", sha], { stdio: ["ignore", "pipe", "pipe"] });
    const tarChild = spawn("tar", ["-x", "-f", "-"], { cwd: dir, stdio: ["pipe", "ignore", "pipe"] });
    const errors = [];
    gitChild.stderr.on("data", (chunk) => errors.push(chunk));
    tarChild.stderr.on("data", (chunk) => errors.push(chunk));
    gitChild.stdout.pipe(tarChild.stdin);
    let pending = 2;
    let failed = false;
    const done = (code) => {
      if (code !== 0) failed = true;
      pending -= 1;
      if (pending === 0) resolve({ ok: !failed, message: Buffer.concat(errors).toString("utf8") });
    };
    gitChild.on("close", done);
    tarChild.on("close", done);
  });
  if (!archive.ok) throw new Error(`could not unpack ${sha}: ${archive.message}`);
  if (alter !== undefined) await alter(dir);
  const link = path.join(dir, "node_modules");
  symlinkSync(nodeModules, link, "junction");
  let built;
  try {
    built = await exec(process.execPath, [path.join(dir, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"], { cwd: dir, timeoutMs: 600_000 });
  } finally {
    removeLink(link);
  }
  const cli = path.join(dir, "dist", "src", "cli", "main.js");
  if (built.code !== 0 || !existsSync(cli)) throw new Error(`the build of ${sha} failed:\n${built.stdout.toString("utf8")}${built.stderr.toString("utf8")}`);
  const guard = path.join(dir, "dist", "tests", "support", "net-guard.js");
  return { commit: sha, dir, cli, guard: existsSync(guard) ? guard : null };
}

/** The environment of a step: only what the CLI needs to start, everything else inside the case folder. */
function environmentFor(caseDir, lang, extra) {
  const env = {};
  const keep = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP"]);
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && keep.has(name.toUpperCase())) env[name] = value;
  }
  return {
    ...env,
    APPDATA: path.join(caseDir, "appdata"),
    LOCALAPPDATA: path.join(caseDir, "appdata"),
    XDG_CONFIG_HOME: path.join(caseDir, "xdg"),
    HOME: path.join(caseDir, "home"),
    USERPROFILE: path.join(caseDir, "home"),
    CODARYN_LANG: lang,
    CODARYN_IT_NET_GUARD_LOG: path.join(caseDir, NET_GUARD_LOG),
    ...extra,
  };
}

const text = (buffer) => (buffer.includes(0) ? null : buffer.toString("utf8"));
const lastJson = (stdout) => {
  const line = stdout.trimEnd().split("\n").filter((one) => one.startsWith("{")).at(-1);
  if (line === undefined) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};

/** Every file under `root` as [relative path, contents], sorted by path; the fence log left out (checked apart). */
function filesOf(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(root, full).split(path.sep).join("/");
      if (relative === NET_GUARD_LOG) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isSymbolicLink()) out.push([relative, Buffer.from("(link)")]);
      else out.push([relative, readFileSync(full)]);
    }
  };
  walk(root);
  return out;
}

/** How a step is shown in the report: its arguments, and for a terminal step the streams and answers. */
function stepName(index, args, terminal, answers) {
  const shown = (answer) => (answer === CTRL_C ? "Ctrl+C" : JSON.stringify(answer));
  const typed = answers === undefined ? "" : ` answers [${answers.map(shown).join(", ")}]`;
  return `step ${index + 1}: codaryn ${args.join(" ")}${terminal === undefined ? "" : ` [terminal: ${terminal}${typed}]`}`;
}

/** Runs one case with one build in `caseDir` (made afresh). Returns its artifacts, in order. */
export async function runCase(board, spec, caseDir) {
  rmSync(caseDir, { recursive: true, force: true });
  mkdirSync(caseDir, { recursive: true });
  const api = spec.api === undefined ? null : await startFakeAnthropic(spec.api.replies, { models: spec.api.models });
  try {
    spec.setup(caseDir, { api: api?.url ?? null });
    const outputs = [];
    const artifacts = [];
    const ctx = { dir: caseDir, json: (index) => outputs[index]?.json ?? null };
    for (const [index, step] of spec.steps.entries()) {
      const { args, lang, env, terminal, answers } = typeof step === "function" ? step(ctx) : step;
      const imports = [...(board.guard === null ? [] : [board.guard]), ...(terminal === undefined ? [] : [fileURLToPath(TERMINAL_PRELOAD)])];
      const nodeArgs = [...imports.flatMap((file) => ["--import", pathToFileURL(file).href]), board.cli, ...args];
      const stepEnv = { ...spec.env, ...env, ...(api === null ? {} : { [KEY_VARIABLE]: FAKE_API_KEY }), ...(terminal === undefined ? {} : { CODARYN_TEST_TERMINAL: terminal }) };
      const result = await exec(process.execPath, nodeArgs, {
        cwd: caseDir,
        env: environmentFor(caseDir, lang ?? spec.lang ?? "en", stepEnv),
        ...(answers === undefined && terminal?.includes("stdin") !== true ? {} : { answers: answers ?? [] }),
      });
      const stdout = result.stdout.toString("utf8");
      outputs.push({ json: lastJson(stdout) });
      const name = stepName(index, args, terminal, answers);
      artifacts.push({ key: `${name} | exit`, text: `${result.code}${result.signal === null ? "" : ` (${result.signal})`}` });
      artifacts.push({ key: `${name} | stdout`, text: text(result.stdout) });
      artifacts.push({ key: `${name} | stderr`, text: text(result.stderr) });
    }
    for (const [relative, contents] of filesOf(caseDir)) artifacts.push({ key: `file ${relative}`, text: text(contents) ?? `(not text) sha256 ${createHash("sha256").update(contents).digest("hex")}` });
    for (const [index, request] of (api?.requests ?? []).entries()) {
      let body = request.body;
      try {
        body = JSON.stringify(JSON.parse(request.body), null, 2);
      } catch {
        // Kept as it came.
      }
      artifacts.push({ key: `api request ${index + 1}: ${request.method} ${request.path}`, text: body });
    }
    const fence = path.join(caseDir, NET_GUARD_LOG);
    const fenceLog = existsSync(fence) ? readFileSync(fence, "utf8") : "";
    return { artifacts, fenceLog, apiUrl: api?.url ?? null };
  } finally {
    await api?.close();
  }
}

/** The path forms to replace for one case on one build (and the fake API's address, whose port differs). */
function pathsFor(caseDir, board, apiUrl) {
  const real = (dir) => {
    try {
      return realpathSync.native(dir);
    } catch {
      return dir;
    }
  };
  return [
    ...(apiUrl === null ? [] : [{ forms: [apiUrl, apiUrl.replace("http://", "")], label: "<API>" }]),
    { forms: [...new Set([...pathForms(caseDir), ...pathForms(real(caseDir))])].sort((a, b) => b.length - a.length), label: "<CASE>" },
    { forms: [...new Set([...pathForms(board.dir), ...pathForms(real(board.dir))])].sort((a, b) => b.length - a.length), label: "<BOARD>" },
  ];
}

/** Runs the cases with both builds and compares them. */
export async function compareBuilds({ base, head, cases = CASES, caseDir }) {
  const results = [];
  for (const spec of cases) {
    const sides = {};
    for (const [side, board] of [
      ["base", base],
      ["head", head],
    ]) {
      const ran = await runCase(board, spec, caseDir);
      sides[side] = { normalized: normalizeSide(ran.artifacts, { paths: pathsFor(caseDir, board, ran.apiUrl) }), fenceLog: ran.fenceLog };
    }
    rmSync(caseDir, { recursive: true, force: true });
    const differences = compareSides(sides.base.normalized, sides.head.normalized);
    const fence = [sides.base.fenceLog, sides.head.fenceLog].filter((log) => log.length > 0);
    results.push({ name: spec.name, differences, fence, artifacts: sides.base.normalized.size });
  }
  return results;
}

/** The report as Markdown. */
export function reportOf({ base, head, results }) {
  const out = [];
  const differing = results.filter((result) => result.differences.length > 0 || result.fence.length > 0);
  out.push("# CLI board comparison", "");
  out.push(`- base: \`${base.commit}\``, `- head: \`${head.commit}\``);
  out.push(`- cases: ${results.length}, with differences: ${differing.length}`, "");
  out.push(`> ${TERMINAL_NOTE}`, "");
  out.push("| case | artifacts | result |", "| --- | --- | --- |");
  for (const result of results) {
    const state = result.fence.length > 0 ? "NETWORK ATTEMPT" : result.differences.length === 0 ? "same" : `${result.differences.length} differing`;
    out.push(`| ${result.name} | ${result.artifacts} | ${state} |`);
  }
  for (const result of differing) {
    out.push("", `## ${result.name}`, "");
    for (const log of result.fence) out.push("- network attempt (fence log):", "", "```", log.trimEnd(), "```");
    for (const difference of result.differences) {
      out.push(`### ${difference.key}`, "");
      if (difference.kind !== "differ") {
        out.push(`- only in ${difference.kind === "only-base" ? "base" : "head"}`, "");
        continue;
      }
      out.push("```diff");
      for (const line of difference.lines) {
        if (line.kind === "change") {
          out.push(`- base ${line.baseLine}:${line.column}: ${line.base}`);
          out.push(`+ head ${line.headLine}:${line.column}: ${line.head}`);
        } else if (line.kind === "removed") out.push(`- base ${line.baseLine}: ${line.base}`);
        else out.push(`+ head ${line.headLine}: ${line.head}`);
      }
      out.push("```", "");
    }
  }
  return `${out.join("\n")}\n`;
}

function parseArgs(argv) {
  const options = { keep: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--keep") {
      options.keep = true;
      continue;
    }
    const value = argv[i + 1];
    if (!["--base", "--head", "--cases", "--work", "--out"].includes(flag) || value === undefined) throw new Error(`unknown or incomplete argument: ${flag}`);
    options[flag.slice(2)] = value;
    i += 1;
  }
  if (options.base === undefined || options.head === undefined) throw new Error("--base and --head are needed");
  return options;
}

export async function main(argv) {
  const options = parseArgs(argv);
  const names = options.cases === undefined ? null : new Set(options.cases.split(","));
  const cases = names === null ? CASES : CASES.filter((spec) => names.has(spec.name));
  if (names !== null && cases.length !== names.size) throw new Error(`unknown case in --cases: ${[...names].filter((name) => !CASES.some((spec) => spec.name === name)).join(", ")}`);
  const work = options.work ?? path.join(tmpdir(), `codaryn-compare-${process.pid}`);
  mkdirSync(work, { recursive: true });
  try {
    const base = await prepareBoard({ commit: options.base, dir: path.join(work, "base") });
    const head = await prepareBoard({ commit: options.head, dir: path.join(work, "head") });
    const results = await compareBuilds({ base, head, cases, caseDir: path.join(work, "case") });
    const report = reportOf({ base, head, results });
    if (options.out !== undefined) writeFileSync(options.out, report, "utf8");
    process.stdout.write(report);
    return results.some((result) => result.differences.length > 0 || result.fence.length > 0) ? 1 : 0;
  } finally {
    // A build's node_modules link is taken back right after the build; looked for once more before anything is removed.
    for (const side of ["base", "head"]) removeLink(path.join(work, side, "node_modules"));
    if (!options.keep) rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`compare-cli-boards: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(2);
    },
  );
}
