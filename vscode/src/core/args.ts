/**
 * Argument lists and the spawn plan for one Codaryn CLI child (vscode-extension 3, 4.1, 6).
 * No VS Code API and no file system access here: the UI part gives absolute paths it resolved, and
 * the caller spawns with `shell: false`.
 *
 * - Every value is passed as its own argument after its flag. A value the CLI parser would refuse
 *   (empty, or starting with "--") is refused here first with the field's name, so a person gets a
 *   clear reason instead of "needs a value" (R-4 L-1).
 * - The run always streams events (`--events jsonl`); it answers questions over stdin only when the
 *   UI can ask (`--confirm stdio`). The cancel file is the extension's, outside the workspace.
 * - The child environment is the extension host's, without the variables that change how the
 *   child Node itself runs (VX-D13).
 * - `plan`, `apply`, `review` follow the G-A task form (DR-17); the CLI connects them later (G-E,
 *   G-F). `changes` is the CLI command of DR-14.
 */

import path from "node:path";

export type TaskFormInput = { readonly kind: "task"; readonly taskPath: string } | { readonly kind: "workspace"; readonly workspace: string };

export interface TaskFormArgs {
  readonly input: TaskFormInput;
  readonly configPath: string | null;
  readonly varsFile: string | null;
  readonly profile: string | null;
}

export interface RunArgsRequest {
  readonly input: { readonly kind: "task"; readonly taskPath: string } | { readonly kind: "quick"; readonly workspace: string; readonly goal: string };
  readonly configPath: string | null;
  readonly varsFile: string | null;
  readonly profile: string | null;
  readonly workflowRef: string | null;
  readonly cancelFile: string;
  /** The UI can show a question and send the answer (`--confirm stdio`). */
  readonly canAsk: boolean;
}

export type ArgsOutcome =
  | { readonly ok: true; readonly args: readonly string[] }
  | { readonly ok: false; readonly field: string; readonly reason: "empty" | "starts_with_dashes" };

/** Builds `[...pairs]` while checking each value the way the CLI parser will. */
class ArgList {
  private readonly list: string[];
  private problem: { field: string; reason: "empty" | "starts_with_dashes" } | null = null;

  constructor(command: string) {
    this.list = [command];
  }

  option(flag: string, field: string, value: string | null): this {
    if (value === null || this.problem !== null) return this;
    if (value.length === 0) this.problem = { field, reason: "empty" };
    else if (value.startsWith("--")) this.problem = { field, reason: "starts_with_dashes" };
    else this.list.push(flag, value);
    return this;
  }

  flag(name: string, on = true): this {
    if (on) this.list.push(name);
    return this;
  }

  taskForm(form: TaskFormArgs): this {
    if (form.input.kind === "task") this.option("--task", "taskPath", form.input.taskPath);
    else this.option("--workspace", "workspace", form.input.workspace).option("--profile", "profile", form.profile);
    return this.option("--config", "configPath", form.configPath).option("--vars-file", "varsFile", form.varsFile);
  }

  done(): ArgsOutcome {
    return this.problem === null ? { ok: true, args: [...this.list] } : { ok: false, ...this.problem };
  }
}

export function runArgs(request: RunArgsRequest): ArgsOutcome {
  const list = new ArgList("run");
  if (request.input.kind === "task") list.option("--task", "taskPath", request.input.taskPath);
  else list.option("--workspace", "workspace", request.input.workspace).option("--goal", "goal", request.input.goal);
  return list
    .option("--config", "configPath", request.configPath)
    .option("--vars-file", "varsFile", request.varsFile)
    .option("--profile", "profile", request.profile)
    .option("--workflow", "workflowRef", request.workflowRef)
    .option("--cancel-file", "cancelFile", request.cancelFile)
    .option("--events", "events", "jsonl")
    .flag("--confirm", request.canAsk)
    .flag("stdio", request.canAsk)
    .done();
}

/** G-A `apply` (DR-1, DR-2, DR-12): the plan run, the approved digest, events and the cancel file. */
export function applyArgs(request: { readonly settings: TaskFormArgs; readonly planRunId: string; readonly digest: string; readonly cancelFile: string }): ArgsOutcome {
  return new ArgList("apply")
    .taskForm(request.settings)
    .option("--run", "planRunId", request.planRunId)
    .option("--digest", "digest", request.digest)
    .option("--cancel-file", "cancelFile", request.cancelFile)
    .option("--events", "events", "jsonl")
    .done();
}

/** G-A `plan` (DR-17): the plan masked again with the task form's secrets. */
export function planArgs(request: { readonly settings: TaskFormArgs; readonly runId: string }): ArgsOutcome {
  return new ArgList("plan").taskForm(request.settings).option("--run", "runId", request.runId).flag("--json").done();
}

/** G-A `review` (DR-17, R-4 L-4). */
export function reviewArgs(request: {
  readonly settings: TaskFormArgs;
  readonly runId: string;
  readonly decision: "accept" | "reject";
  readonly note: string | null;
}): ArgsOutcome {
  return new ArgList("review")
    .taskForm(request.settings)
    .option("--run", "runId", request.runId)
    .flag(request.decision === "accept" ? "--accept" : "--reject")
    .option("--note", "note", request.note)
    .flag("--json")
    .done();
}

/** DR-14 `changes`. */
export function changesArgs(request: { readonly settings: TaskFormArgs; readonly runId: string }): ArgsOutcome {
  return new ArgList("changes").taskForm(request.settings).option("--run", "runId", request.runId).flag("--json").done();
}

export function reportArgs(request: { readonly workspace: string; readonly runId: string }): ArgsOutcome {
  return new ArgList("report").option("--workspace", "workspace", request.workspace).option("--run", "runId", request.runId).flag("--json").done();
}

/** N-7: `--dry-run` for the preview before the person confirms (UX-D4). */
export function revertArgs(request: { readonly workspace: string; readonly runId: string; readonly dryRun: boolean }): ArgsOutcome {
  return new ArgList("revert")
    .option("--workspace", "workspace", request.workspace)
    .option("--run", "runId", request.runId)
    .flag("--dry-run", request.dryRun)
    .done();
}

export function runsArgs(request: { readonly workspace: string; readonly limit: number | null }): ArgsOutcome {
  return new ArgList("runs")
    .option("--workspace", "workspace", request.workspace)
    .option("--limit", "limit", request.limit === null ? null : String(request.limit))
    .flag("--json")
    .done();
}

export function doctorArgs(request: { readonly configPath: string | null; readonly varsFile: string | null; readonly workspace: string | null }): ArgsOutcome {
  return new ArgList("doctor")
    .option("--config", "configPath", request.configPath)
    .option("--vars-file", "varsFile", request.varsFile)
    .option("--workspace", "workspace", request.workspace)
    .flag("--json")
    .done();
}

/** VX-D13: variables that change how the child Node itself runs. */
export const REMOVED_CHILD_VARIABLES = ["NODE_OPTIONS", "NODE_PATH"] as const;

/** The extension host's environment for the child, without REMOVED_CHILD_VARIABLES (names without case on Windows). */
export function childEnvironment(hostEnv: Readonly<Record<string, string | undefined>>, platform: NodeJS.Platform): Record<string, string> {
  const fold = (name: string): string => (platform === "win32" ? name.toUpperCase() : name);
  const removed = new Set<string>(REMOVED_CHILD_VARIABLES.map(fold));
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(hostEnv)) {
    if (value !== undefined && !removed.has(fold(name))) env[name] = value;
  }
  return env;
}

export interface SpawnPlanInput {
  /** `codaryn.nodePath`: an absolute path to Node 26 or later (VX-D2). */
  readonly nodePath: string;
  /** The bundled CLI's entry file, absolute. */
  readonly cliMain: string;
  /** The extension's storage folder: the child's cwd, outside every workspace. */
  readonly storageDir: string;
  /** The workspace the command works on, when it has one. */
  readonly workspace: string | null;
  readonly hostEnv: Readonly<Record<string, string | undefined>>;
  readonly platform: NodeJS.Platform;
  readonly args: readonly string[];
}

export interface SpawnPlan {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly shell: false;
  readonly windowsHide: true;
}

export type SpawnPlanOutcome =
  | { readonly ok: true; readonly plan: SpawnPlan }
  | {
      readonly ok: false;
      readonly reason: "node_path_not_absolute" | "cli_main_not_absolute" | "storage_dir_not_absolute" | "node_inside_workspace" | "storage_inside_workspace";
    };

/**
 * The lexical part of the checks (vscode-extension 3): absolute paths, and neither Node nor the
 * child's cwd inside the workspace. Links are not resolved here; the UI part checks real paths
 * before it calls this, as the CLI itself does for its own files (S-1).
 */
export function spawnPlan(input: SpawnPlanInput): SpawnPlanOutcome {
  const paths = input.platform === "win32" ? path.win32 : path.posix;
  if (!paths.isAbsolute(input.nodePath)) return { ok: false, reason: "node_path_not_absolute" };
  if (!paths.isAbsolute(input.cliMain)) return { ok: false, reason: "cli_main_not_absolute" };
  if (!paths.isAbsolute(input.storageDir)) return { ok: false, reason: "storage_dir_not_absolute" };
  if (input.workspace !== null) {
    const inside = (target: string): boolean => {
      const relative = paths.relative(paths.resolve(input.workspace as string), paths.resolve(target));
      return relative === "" || (!relative.startsWith("..") && !paths.isAbsolute(relative));
    };
    if (inside(input.nodePath)) return { ok: false, reason: "node_inside_workspace" };
    if (inside(input.storageDir)) return { ok: false, reason: "storage_inside_workspace" };
  }
  return {
    ok: true,
    plan: {
      command: input.nodePath,
      args: [input.cliMain, ...input.args],
      cwd: input.storageDir,
      env: childEnvironment(input.hostEnv, input.platform),
      shell: false,
      windowsHide: true,
    },
  };
}
