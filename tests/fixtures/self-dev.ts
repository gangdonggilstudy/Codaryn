/**
 * Self-development rehearsal (phase 3, K5): a copy of part of this repository's own source is the
 * candidate workspace, and a protected verifier outside it compiles the copy and runs its unit
 * tests. This is a rehearsal with a scripted model, not evidence of real self-development.
 *
 * Scope (chosen to stay small and self-contained; see the K5 report):
 *   src/contracts/**                       no imports outside itself
 *   src/privacy/**                         imports src/contracts only
 *   tests/unit/privacy/gateway.test.ts     the privacy gateway's unit tests
 *   tests/unit/contracts/t-constants.test.ts
 *   package.json                           `{"type":"module"}` so NodeNext emits ES modules
 * Not copied: the engine, tools, CLI and their tests (tool-definitions.test.ts imports the engine).
 *
 * Layout of the sandbox:
 *   <base>/ws/...                          the candidate (the copied files)
 *   <base>/verifier/verify-candidate.mjs   protected verifier program (outside the workspace)
 *   <base>/verifier/tsconfig.candidate.json compile settings (outside the workspace)
 *   <base>/verifier/out/                   compiled output, rebuilt on every verification
 * The verifier uses this repository's TypeScript and @types/node; nothing is installed.
 */

import { copyFileSync, cpSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { CommandVerifierConfig } from "../../src/contracts/index.js";
import { NODE, REPO_ROOT } from "../support/cli.js";
import type { Sandbox } from "./builders.js";

export interface CandidateScope {
  /** Repository-relative directories copied whole (`/` separated). */
  readonly dirs: readonly string[];
  /** Repository-relative single files. */
  readonly files: readonly string[];
}

export const SELF_DEV_SCOPE: CandidateScope = {
  dirs: ["src/contracts", "src/privacy"],
  files: ["tests/unit/privacy/gateway.test.ts", "tests/unit/contracts/t-constants.test.ts"],
};

/** Paths a rehearsal task protects with `policy.protectedPaths`. */
export const CANDIDATE_PROTECTED_PATHS: readonly string[] = ["tests", "package.json"];

/** The file the rehearsal scripts change. */
export const REHEARSAL_TARGET = "src/privacy/index.ts";

export const CANDIDATE_PACKAGE_JSON = `${JSON.stringify({ name: "codaryn-candidate", private: true, type: "module" }, null, 2)}\n`;

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

/**
 * Copies the scoped repository files into the sandbox workspace byte for byte, plus a package.json.
 * Only `.ts` files are taken from the directories. Returns the workspace-relative paths written.
 */
export function copyCandidateSource(sandbox: Sandbox, scope: CandidateScope = SELF_DEV_SCOPE): string[] {
  const sources: string[] = [];
  for (const dir of scope.dirs) {
    sources.push(...listFiles(join(REPO_ROOT, ...dir.split("/"))).filter((file) => file.endsWith(".ts")));
  }
  for (const file of scope.files) sources.push(join(REPO_ROOT, ...file.split("/")));
  const written: string[] = [];
  for (const source of sources) {
    const rel = relative(REPO_ROOT, source);
    const target = join(sandbox.workspace, rel);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    written.push(rel.split(sep).join("/"));
  }
  writeFileSync(join(sandbox.workspace, "package.json"), CANDIDATE_PACKAGE_JSON);
  written.push("package.json");
  return written.sort();
}

/** Current text of a candidate file, exactly as on disk (line endings as checked out). */
export function candidateText(sandbox: Sandbox, path: string): string {
  return readFileSync(join(sandbox.workspace, ...path.split("/")), "utf8");
}

/**
 * The protected verifier program. It rebuilds `<out>` from scratch, compiles the candidate with
 * the given tsconfig, marks `<out>` as ES modules, then runs every compiled unit test.
 * `node verify-candidate.mjs <tsc.js> <tsconfig> <out>`; exit 0 only when both steps pass.
 */
export const VERIFY_CANDIDATE = [
  'import { spawnSync } from "node:child_process";',
  'import { rmSync, writeFileSync } from "node:fs";',
  "const [tsc, tsconfig, out] = process.argv.slice(2);",
  "rmSync(out, { recursive: true, force: true });",
  'const compiled = spawnSync(process.execPath, [tsc, "-p", tsconfig], { stdio: "inherit" });',
  "if (compiled.status !== 0) {",
  '  console.log("candidate typecheck failed (exit " + String(compiled.status) + ")");',
  "  process.exit(1);",
  "}",
  'writeFileSync(out + "/package.json", JSON.stringify({ type: "module" }));',
  'const tested = spawnSync(process.execPath, ["--test", "tests/unit/**/*.test.js"], { cwd: out, stdio: "inherit" });',
  "process.exit(tested.status === 0 ? 0 : 1);",
  "",
].join("\n");

export interface CandidateVerifier {
  readonly dir: string;
  readonly scriptPath: string;
  readonly tsconfigPath: string;
  readonly outDir: string;
  /** Command verifier for the task. All its paths are absolute and outside the workspace. */
  readonly config: CommandVerifierConfig;
  /**
   * Verification material outside the workspace, for the config file's `integrity.paths` (U-1):
   * the verifier program and its compile settings.
   */
  readonly integrityPaths: readonly string[];
}

/** TypeScript's command line entry in this repository (TypeScript 7, run with node). */
export const REPO_TSC = join(REPO_ROOT, "node_modules", "typescript", "bin", "tsc");

/**
 * Writes the verifier program and its tsconfig into `<base>/verifier/`. The tsconfig takes the
 * repository's compiler options, roots the build at the workspace and writes to `<base>/verifier/out`.
 */
export function writeProtectedVerifier(sandbox: Sandbox, id = "candidate-tests"): CandidateVerifier {
  const dir = join(sandbox.base, "verifier");
  mkdirSync(dir, { recursive: true });
  const scriptPath = join(dir, "verify-candidate.mjs");
  writeFileSync(scriptPath, VERIFY_CANDIDATE);
  const outDir = join(dir, "out");
  const repoConfig = JSON.parse(readFileSync(join(REPO_ROOT, "tsconfig.json"), "utf8")) as {
    compilerOptions: Record<string, unknown>;
  };
  const tsconfig = {
    compilerOptions: {
      ...repoConfig.compilerOptions,
      rootDir: sandbox.workspace,
      outDir,
      sourceMap: false,
      typeRoots: [join(REPO_ROOT, "node_modules", "@types")],
    },
    include: [`${sandbox.workspace.split(sep).join("/")}/src/**/*.ts`, `${sandbox.workspace.split(sep).join("/")}/tests/**/*.ts`],
  };
  const tsconfigPath = join(dir, "tsconfig.candidate.json");
  writeFileSync(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`);
  return {
    dir,
    scriptPath,
    tsconfigPath,
    outDir,
    config: {
      id,
      kind: "command",
      executable: NODE,
      args: [scriptPath, REPO_TSC, tsconfigPath, outDir],
      timeoutMs: 120_000,
    },
    integrityPaths: [scriptPath, tsconfigPath],
  };
}

/** Appended by the scripted model in the passing flow: a comment only. */
export const BENIGN_NOTE = "\n// rehearsal: a comment-only change made by the scripted model\n";
/** Appended by the scripted model in the failing flow: a type error the protected verifier reports. */
export const TYPE_ERROR_SNIPPET = '\nexport const rehearsalBroken: number = "not a number";\n';

/**
 * Programs an allowed command runs to change what it should not: `node tamper.mjs <mode> <path>`.
 * mode `append` adds a line, `delete` removes the file, `create` writes a new one. The path may be
 * workspace-relative (a protected file such as a test) or absolute (verification material outside
 * the workspace). File tools could not do this; commands can (U-1 detects it, it does not block it).
 */
export const TAMPER = [
  'import { appendFileSync, rmSync, writeFileSync } from "node:fs";',
  "const [mode, target] = process.argv.slice(2);",
  'if (mode === "append") appendFileSync(target, "\\n// changed by an allowed command\\n");',
  'else if (mode === "delete") rmSync(target);',
  'else if (mode === "create") writeFileSync(target, "// created by an allowed command\\n");',
  "else process.exit(2);",
  'console.log(mode + " done");',
  "",
].join("\n");

export type TamperMode = "append" | "delete" | "create";

export interface InstallCopy {
  /** Package root of the copy (holds package.json). */
  readonly root: string;
  /** `<root>/dist/src/cli/main.js`, for `startCli(..., { cliPath })`. */
  readonly cliPath: string;
}

/**
 * Copies the built CLI (`dist/src` and package.json) to `<base>/install`. The self-install check
 * (U-3) is tried against this copy, so no test ever points a run at this repository or its
 * parent. The CLI has no runtime dependencies, so the copy runs on its own.
 */
export function installCopy(sandbox: Sandbox, parent: string = sandbox.base): InstallCopy {
  const root = join(parent, "install");
  cpSync(join(REPO_ROOT, "dist", "src"), join(root, "dist", "src"), { recursive: true });
  copyFileSync(join(REPO_ROOT, "package.json"), join(root, "package.json"));
  return { root, cliPath: join(root, "dist", "src", "cli", "main.js") };
}

/** Writes tamper.mjs into the workspace and returns the allow-list rule for it. */
export function writeTamperProgram(sandbox: Sandbox): { executable: string; argsPrefix: string[]; allowExtraArgs: boolean } {
  writeFileSync(join(sandbox.workspace, "tamper.mjs"), TAMPER);
  return { executable: NODE, argsPrefix: ["tamper.mjs"], allowExtraArgs: true };
}
