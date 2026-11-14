/** U-324 (C10-1): the doctor's check ports, moved from src/cli/doctor.ts. CLI presentation stays there. */
import type { DefaultConfigLocation, ExplainMessageLanguage, ListParkedFiles } from "../contracts/index.js";
import type { PathRelation, WorkspaceLocation } from "./input/security/index.js";
import type { SettingsEnvironment } from "./input/settings.js";

export interface DoctorCheckEnvironment {
  /** The process environment. Read, never changed. */
  readonly env: SettingsEnvironment;
  readonly cwd: string;
  /** `process.versions.node`. */
  readonly nodeVersion: string;
  /** The CLI's package root. Undefined: not checked. Null: it could not be determined. */
  readonly installDir?: string | null;
  readonly readFile: (file: string) => Promise<string>;
  readonly isDirectory: (dir: string) => Promise<boolean>;
  /** True when `file` names an existing regular file. Never throws. */
  readonly isFile: (file: string) => Promise<boolean>;
  /** Real path, as the command runner resolves it (`fs.realpath` when absent). */
  readonly realpath?: (file: string) => Promise<string>;
  readonly locateInWorkspace: (file: string, workspaceRoot: string) => Promise<WorkspaceLocation>;
  readonly relatePaths: (target: string, base: string) => Promise<PathRelation>;
  readonly platform?: NodeJS.Platform;
  /** N-1: the default config location (`findDefaultConfigLocation`). Absent or null: none. */
  readonly defaultConfig?: DefaultConfigLocation | null;
  /** N-1: a default location exists but is a network or device path, so it is not used. */
  readonly defaultConfigRefused?: boolean;
  /** N-20: `explainMessageLanguage` (src/i18n). Absent: the `language` check is `skipped`. */
  readonly explainLanguage?: ExplainMessageLanguage;
  /** `Intl` locale for the language check (`runtimeLocale()` in the real CLI). */
  readonly osLocale?: string | null;
  /** N-25 (a): the state of `<workspace>/.codaryn/lock.json`, read without changing it. Absent: `skipped`. */
  readonly inspectLock?: (workspaceRoot: string) => Promise<LockState>;
  /** R-16 L-1: the store's `listParkedFiles` (the default); tests inject it. */
  readonly listParkedFiles?: ListParkedFiles;
}

/**
 * N-25 (a): none, held by a live process, left by an ended one, or unreadable. DR-27 (b):
 * `reclaim_left` when `lock.json.reclaim` is in a state the store never clears, so no lock is
 * reclaimed while it stays.
 */
export type LockState = "none" | "held" | "stale" | "unreadable" | "reclaim_left";
