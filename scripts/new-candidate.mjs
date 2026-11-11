#!/usr/bin/env node
// Prepares a self-development candidate (phase 3, decision U-4).
//
// Usage:
//   node scripts/new-candidate.mjs --repo <repository> --name <name> --out <candidate dir>
//                                  --state <settings dir> [--dry-run]
//
// What it does:
// - `git worktree add -b candidate/<name> -- <out> <commit>` in <repository>, where <commit> is the
//   repository's HEAD commit. The candidate holds the tracked files of that commit only.
// - Writes two templates into <state>, a directory outside the candidate:
//   <name>.config.json (model placeholder, conservative limits, maxRepairAttempts, suggested
//   protectedPaths, verifiers, an empty integrity.paths slot) and <name>.task.json (goal placeholder,
//   workspaceRoot = the candidate). Both must be edited before a run. They hold no key or secret.
//
// What it refuses (exit 1, nothing changed):
// - the candidate directory already exists (even empty), the branch or a conflicting ref exists,
//   a template file already exists, or the candidate path is registered as a worktree;
// - the candidate inside the repository, inside one of its worktrees or Git directory, or inside
//   the CLI installation (the package root this script belongs to). Links are resolved;
// - the settings directory inside the candidate, the repository, a worktree or the CLI installation;
// - <repository> that is not the top of a Git work tree, or has no commit.
// Usage errors exit 2. `--dry-run` runs every check and prints the plan without changing anything.
//
// Git runs without a shell, with the repository-location variables (GIT_DIR and the like) removed.
// The script never reads or creates keys, `.env` files or secrets. If `git worktree add` fails, the
// template files and the settings directories it created are removed again, and a branch it left
// behind is deleted only while it still points at the base commit.
//
// A worktree separates changes. It is not a security boundary: commands and verifiers that run in
// the candidate can read and write outside it.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const USAGE =
  "usage: node scripts/new-candidate.mjs --repo <repository> --name <name> --out <candidate dir> --state <settings dir> [--dry-run]";
const VALUE_OPTIONS = ["--repo", "--name", "--out", "--state"];
const BRANCH_PREFIX = "candidate/";

/** Lowercase letters, digits and inner hyphens, 1-40 characters. Usable as branch, task id and file name. */
const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
/** Windows device names cannot be file names, whatever the extension. */
const RESERVED_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/;

/** Suggested protectedPaths, always listed: verification inputs and the candidate's Git link. */
const BASE_PROTECTED = ["tests", "scripts", ".github", "package.json", "tsconfig.json", ".git", ".npmrc", "node_modules"];
/** Top-level files of the base commit that are listed too: other verification and dependency settings. */
const VERIFICATION_CONFIG = [
  /^tsconfig\..+\.json$/i,
  /^package-lock\.json$/i,
  /^npm-shrinkwrap\.json$/i,
  /^pnpm-lock\.yaml$/i,
  /^yarn\.lock$/i,
  /^eslint\.config\.[cm]?[jt]s$/i,
  /^\.eslintrc(\..+)?$/i,
  /^(jest|vitest|vite|playwright|karma|ava|cypress)\.config\.[cm]?[jt]s$/i,
  /^\.mocharc(\..+)?$/i,
  /^\.c8rc(\..+)?$/i,
  /^\.nycrc(\..+)?$/i,
  /^\.taprc$/i,
];

/** Conservative starting limits. The PM sets the real values per task (roadmap phase 3). */
const LIMITS = {
  maxModelTurns: 12,
  maxToolCalls: 24,
  maxTotalTokens: 150000,
  maxDurationMs: 1800000,
  maxRepairAttempts: 2,
  maxSameFailures: 2,
};
const VERIFIER_TIMEOUT_MS = 900000;

/** Variables that would point git at another repository or index than <repository>. */
const GIT_LOCATION_VARIABLES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
  "GIT_PREFIX",
];

const IS_WINDOWS = process.platform === "win32";
const FOLD_CASE = IS_WINDOWS || process.platform === "darwin";

class Stop extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}
const usageError = (message) => new Stop(`${message}\n${USAGE}`, 2);

function parseArgs(argv) {
  const values = {};
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--dry-run") {
      if (dryRun) throw usageError("--dry-run is given twice");
      dryRun = true;
      continue;
    }
    if (!VALUE_OPTIONS.includes(arg)) throw usageError(`unknown argument: ${arg}`);
    if (Object.hasOwn(values, arg)) throw usageError(`${arg} is given twice`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw usageError(`${arg} needs a value`);
    values[arg] = value;
    index += 1;
  }
  for (const option of VALUE_OPTIONS) {
    if (!Object.hasOwn(values, option)) throw usageError(`${option} is required`);
  }
  const name = values["--name"];
  if (!NAME_PATTERN.test(name) || RESERVED_NAME.test(name)) {
    throw usageError("--name must be 1-40 lowercase letters, digits and inner hyphens, and not a Windows device name");
  }
  const paths = {};
  for (const option of ["--repo", "--out", "--state"]) {
    const raw = values[option];
    if (raw.length === 0 || raw.includes("\0")) throw usageError(`${option} is not a path`);
    // UNC and device paths, and "C:x" (relative to a per-drive directory), are not supported.
    if (IS_WINDOWS && (/^[\\/]{2}/.test(raw) || /^[A-Za-z]:(?![\\/])/.test(raw))) {
      throw usageError(`${option} must be a local path (no UNC, device or drive-relative path)`);
    }
    paths[option] = path.resolve(raw);
  }
  return { help: false, dryRun, name, repo: paths["--repo"], out: paths["--out"], state: paths["--state"] };
}

function fold(value) {
  return FOLD_CASE ? value.toLowerCase() : value;
}

/** Same path or below it. */
function insideOrSame(target, root) {
  const child = fold(path.resolve(target));
  const base = fold(path.resolve(root));
  const prefix = base.endsWith(path.sep) ? base : `${base}${path.sep}`;
  return child === base || child.startsWith(prefix);
}

function errorCode(error) {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

function entryExists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return false;
    throw new Stop(`cannot inspect ${file} (${errorCode(error) ?? "unknown"})`);
  }
}

/**
 * Real path of the deepest existing ancestor, followed by the part that does not exist yet.
 * A link whose target is missing stops the script: a directory created through it could land anywhere.
 */
function realish(target) {
  let current = path.resolve(target);
  const rest = [];
  for (;;) {
    try {
      const real = fs.realpathSync.native(current);
      return rest.length > 0 ? path.join(real, ...rest) : real;
    } catch (error) {
      if (errorCode(error) !== "ENOENT" && errorCode(error) !== "ENOTDIR") {
        throw new Stop(`cannot resolve ${current} (${errorCode(error) ?? "unknown"})`);
      }
    }
    if (entryExists(current)) throw new Stop(`${current} is a link whose target does not exist`);
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(target);
    rest.unshift(path.basename(current));
    current = parent;
  }
}

/** The path as given and as resolved, so that a link cannot lead around a containment check. */
function forms(target) {
  return [path.resolve(target), realish(target)];
}

function within(target, roots) {
  const targets = forms(target);
  return roots.some((root) => forms(root).some((base) => targets.some((candidate) => insideOrSame(candidate, base))));
}

function gitEnvironment() {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  for (const name of Object.keys(env)) {
    if (GIT_LOCATION_VARIABLES.includes(name.toUpperCase())) delete env[name];
  }
  return env;
}

const GIT_ENV = gitEnvironment();

/** Runs git without a shell. Returns status, stdout and stderr; throws when git cannot start. */
function git(cwd, args, timeout = 120000) {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    cwd,
    env: GIT_ENV,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw new Stop(`git could not be run (${errorCode(result.error) ?? "unknown"})`);
  }
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function gitOk(cwd, args, what) {
  const result = git(cwd, args);
  if (result.status !== 0) throw new Stop(`${what} failed: ${result.stderr.trim() || `git exited with ${result.status}`}`);
  return result.stdout;
}

/** The CLI installation: the package root this script belongs to. */
function installationRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function inspectRepository(repo) {
  if (!isDirectory(repo)) throw new Stop(`--repo ${repo} is not a directory`);
  const located = git(repo, ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"]);
  if (located.status !== 0) throw new Stop(`--repo ${repo} is not a Git work tree`);
  const [top = "", commonDir = ""] = located.stdout.split(/\r?\n/);
  if (top === "" || commonDir === "") throw new Stop(`--repo ${repo} is not a Git work tree`);
  if (fold(realish(repo)) !== fold(realish(path.resolve(top)))) {
    throw new Stop(`--repo must be the top of the work tree (${path.resolve(top)}), not a directory inside it`);
  }
  const head = git(repo, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
  if (head.status !== 0) throw new Stop("the repository has no commit to start the candidate from");
  const worktrees = gitOk(repo, ["worktree", "list", "--porcelain", "-z"], "git worktree list")
    .split("\0")
    .filter((field) => field.startsWith("worktree "))
    .map((field) => path.resolve(field.slice("worktree ".length)));
  return { top: path.resolve(top), commonDir: path.resolve(commonDir), base: head.stdout.trim(), worktrees };
}

/** A ref that `candidate/<name>` would collide with: itself, a ref below it, or a branch named `candidate`. */
function conflictingRef(repo, branch) {
  const target = fold(`refs/heads/${branch}`);
  const parent = fold(`refs/heads/${BRANCH_PREFIX.slice(0, -1)}`);
  const refs = gitOk(repo, ["for-each-ref", "--format=%(refname)", "refs/heads/"], "git for-each-ref")
    .split(/\r?\n/)
    .filter(Boolean);
  return refs.find((ref) => {
    const folded = fold(ref);
    return folded === target || folded.startsWith(`${target}/`) || folded === parent;
  });
}

function suggestedProtectedPaths(repo, base) {
  const names = gitOk(repo, ["ls-tree", "--name-only", "-z", base], "git ls-tree").split("\0").filter(Boolean);
  const extra = names.filter((name) => VERIFICATION_CONFIG.some((pattern) => pattern.test(name))).sort();
  return [...BASE_PROTECTED, ...extra.filter((name) => !BASE_PROTECTED.includes(name))];
}

function templates({ name, out, protectedPaths, hasPackageJson }) {
  const policy = {
    commands: [],
    network: "deny",
    destructive: "deny",
    restorePathTokens: false,
    protectedPaths,
  };
  const verifiers = hasPackageJson
    ? [{ id: "tests", kind: "command", executable: "npm", args: ["test"], timeoutMs: VERIFIER_TIMEOUT_MS }]
    : [];
  const config = {
    schemaVersion: 1,
    model: "<모델 ID>",
    maxOutputTokens: 4096,
    requestTimeoutMs: 600000,
    maxRetries: 2,
    limits: LIMITS,
    policy,
    verifiers,
    secretEnv: [],
    integrity: { paths: [] },
  };
  const task = {
    schemaVersion: 1,
    id: name,
    goal: "<후보에서 할 작은 변경 하나. 모델이 실행할 명령은 policy.commands의 규칙과 정확히 같게 적는다>",
    workflow: "self-development",
    workspaceRoot: out,
    model: { provider: "anthropic" },
    policy,
    privacy: { secretEnv: [] },
    verifiers,
  };
  return { config: `${JSON.stringify(config, null, 2)}\n`, task: `${JSON.stringify(task, null, 2)}\n` };
}

function plan(args) {
  const install = installationRoot();
  const repository = inspectRepository(args.repo);
  const branch = `${BRANCH_PREFIX}${args.name}`;
  const files = {
    config: path.join(args.state, `${args.name}.config.json`),
    task: path.join(args.state, `${args.name}.task.json`),
  };

  // Existing targets: nothing is touched.
  if (entryExists(args.out)) throw new Stop(`the candidate directory ${args.out} already exists`);
  if (repository.worktrees.some((tree) => fold(tree) === fold(args.out) || fold(realish(tree)) === fold(realish(args.out)))) {
    throw new Stop(`${args.out} is already registered as a worktree of the repository`);
  }
  const conflict = conflictingRef(repository.top, branch);
  if (conflict !== undefined) throw new Stop(`the branch ${branch} cannot be created: ${conflict} exists`);
  if (entryExists(args.state) && !isDirectory(args.state)) {
    throw new Stop(`--state ${args.state} exists and is not a directory`);
  }
  for (const file of Object.values(files)) {
    if (entryExists(file)) throw new Stop(`${file} already exists`);
  }

  // Where the candidate and the settings may live.
  const repositoryRoots = [repository.top, repository.commonDir, ...repository.worktrees];
  if (within(args.out, repositoryRoots)) {
    throw new Stop(`the candidate directory must be outside the repository and its worktrees: ${args.out}`);
  }
  if (within(args.out, [install])) {
    throw new Stop(`the candidate directory must be outside the CLI installation (${install}): ${args.out}`);
  }
  if (within(args.state, [args.out])) {
    throw new Stop(`the settings directory must be outside the candidate: ${args.state}`);
  }
  if (within(args.state, repositoryRoots)) {
    throw new Stop(`the settings directory must be outside the repository and its worktrees: ${args.state}`);
  }
  if (within(args.state, [install])) {
    throw new Stop(`the settings directory must be outside the CLI installation (${install}): ${args.state}`);
  }

  const protectedPaths = suggestedProtectedPaths(repository.top, repository.base);
  const hasPackageJson = git(repository.top, ["cat-file", "-e", `${repository.base}:package.json`]).status === 0;
  return { install, repository, branch, files, ...templates({ name: args.name, out: args.out, protectedPaths, hasPackageJson }) };
}

/** Removes `dir` and its parents up to `top`, each only when empty. */
function removeEmptyDirs(dir, top) {
  let current = dir;
  for (;;) {
    try {
      fs.rmdirSync(current);
    } catch {
      return;
    }
    if (fold(current) === fold(top)) return;
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

/** Writes the templates, then adds the worktree. On failure, removes what this run created. */
function create(args, planned) {
  const written = [];
  let createdDir;
  const removeTemplates = () => {
    for (const file of written) fs.rmSync(file, { force: true });
    if (createdDir !== undefined) removeEmptyDirs(args.state, createdDir);
  };
  try {
    if (!entryExists(args.state)) createdDir = fs.mkdirSync(args.state, { recursive: true });
    for (const [file, content] of [
      [planned.files.config, planned.config],
      [planned.files.task, planned.task],
    ]) {
      fs.writeFileSync(file, content, { encoding: "utf8", flag: "wx" });
      written.push(file);
    }
  } catch (error) {
    removeTemplates();
    throw new Stop(`writing the templates failed (${errorCode(error) ?? "unknown"}); nothing was kept`);
  }

  let failure;
  try {
    const add = git(
      planned.repository.top,
      ["worktree", "add", "-b", planned.branch, "--", args.out, planned.repository.base],
      600000,
    );
    if (add.status !== 0) failure = add.stderr.trim() || `git exited with ${add.status}`;
  } catch (error) {
    failure = error instanceof Stop ? error.message : "git could not be run";
  }
  if (failure !== undefined) {
    removeTemplates();
    // `git worktree add -b` creates the branch before the worktree and may leave it behind.
    // It is removed only while it still points at the base commit (update-ref compares first).
    let branchNote = "";
    try {
      const ref = `refs/heads/${planned.branch}`;
      git(planned.repository.top, ["update-ref", "-d", ref, planned.repository.base]);
      if (git(planned.repository.top, ["show-ref", "--verify", "--quiet", ref]).status === 0) {
        branchNote = `; the branch ${planned.branch} still exists, check it`;
      }
    } catch {
      branchNote = `; check whether the branch ${planned.branch} exists`;
    }
    throw new Stop(`git worktree add failed; the templates were removed${branchNote}:\n${failure}`);
  }

  const head = git(args.out, ["rev-parse", "HEAD"]).stdout.trim();
  const branch = git(args.out, ["symbolic-ref", "--short", "HEAD"]).stdout.trim();
  if (head !== planned.repository.base || branch !== planned.branch) {
    throw new Stop(`the candidate was created but is not at ${planned.branch} ${planned.repository.base}; check it before use`);
  }
}

function describe(args, planned, dryRun) {
  const lines = [
    dryRun ? "new-candidate: dry run, nothing was changed" : "new-candidate: candidate created",
    `  repository   ${planned.repository.top}`,
    `  base commit  ${planned.repository.base} (HEAD; uncommitted changes are not included)`,
    `  branch       ${planned.branch}`,
    `  candidate    ${args.out}`,
    `  config       ${planned.files.config}`,
    `  task         ${planned.files.task}`,
  ];
  if (dryRun) {
    lines.push(
      "would run:",
      `  git -C ${planned.repository.top} worktree add -b ${planned.branch} -- ${args.out} ${planned.repository.base}`,
      `config template:\n${planned.config}`,
      `task template:\n${planned.task}`,
    );
  }
  lines.push(
    "next steps (the templates are not ready to run):",
    `  1. In the config, set "model" and review "limits", "policy", "verifiers" and "integrity.paths".`,
    `  2. In the task, replace "goal" with one small change.`,
    "  3. Install the candidate's dependencies if its verifiers need them.",
    "  4. Run the CLI built from the adopted commit, outside the candidate:",
    `     node ${path.join(planned.install, "dist", "src", "cli", "main.js")} run --task ${planned.files.task} --config ${planned.files.config} [--vars-file <file outside the candidate>]`,
    "  The worktree separates changes; it is not a security boundary.",
  );
  return lines.join("\n");
}

/** "check" until every check has passed; a stop before that has changed nothing. */
let phase = "check";

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  const planned = plan(args);
  phase = "create";
  if (!args.dryRun) create(args, planned);
  console.log(describe(args, planned, args.dryRun));
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof Stop)) throw error;
  console.error(`new-candidate: ${error.message}`);
  if (phase === "check") console.error("new-candidate: nothing was changed");
  process.exitCode = error.exitCode;
}
