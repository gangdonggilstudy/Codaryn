/**
 * N-1: which config file a command reads, and N-8: the profile chosen with `--profile`.
 *
 * Precedence: `--config` → CODARYN_CONFIG → the default location (`findDefaultConfigLocation`).
 * The default file is optional: when it does not exist there is no config file, as before N-1.
 * Nothing in the workspace is searched (C-3 as amended by N-1). Messages never show an expanded
 * path: the default location is shown as DEFAULT_CONFIG_DISPLAY's symbolic form.
 */

import path from "node:path";
import {
  CODARYN_CONFIG_ENV,
  DEFAULT_CONFIG_DIR_POSIX,
  DEFAULT_CONFIG_DIR_WINDOWS,
  DEFAULT_CONFIG_DISPLAY,
  DEFAULT_CONFIG_FILE_NAME,
  PROFILE_NAME_PATTERN_SOURCE,
} from "../contracts/index.js";
import type {
  CodarynConfig,
  ConfigLocationDisplay,
  ConfigSource,
  DefaultConfigLocation,
  FindDefaultConfigLocation,
} from "../contracts/index.js";
import { checkLocalPathSyntax } from "./security/index.js";
import { envValue } from "./settings.js";
import type { SettingsEnvironment } from "./settings.js";
import { localPathProblem } from "./task.js";

/** A variable's value; on Windows the name is matched without regard to case, as the OS does. */
function variable(env: SettingsEnvironment, name: string, platform: NodeJS.Platform): string | null {
  const direct = envValue(env, name);
  if (direct !== null || platform !== "win32") return direct;
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name.toUpperCase());
  return key === undefined ? null : envValue(env, key);
}

/** A Windows path with a drive letter, a colon and a separator. */
function isWindowsAbsolute(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value);
}

/**
 * N-1: the default location, or null when there is none. Windows: `%APPDATA%\Codaryn\config.json`.
 * Elsewhere: `$XDG_CONFIG_HOME/codaryn/config.json` (absolute XDG_CONFIG_HOME only), else
 * `<home>/.config/codaryn/config.json`. A location that is not a plain local path (S-5) is not used.
 */
export const findDefaultConfigLocation: FindDefaultConfigLocation = (platform, env, homeDir) => {
  let location: DefaultConfigLocation | null = null;
  if (platform === "win32") {
    const appData = variable(env, "APPDATA", platform);
    if (appData !== null && isWindowsAbsolute(appData)) {
      location = {
        path: path.win32.join(appData, DEFAULT_CONFIG_DIR_WINDOWS, DEFAULT_CONFIG_FILE_NAME),
        display: DEFAULT_CONFIG_DISPLAY.windows,
      };
    }
  } else {
    const xdg = variable(env, "XDG_CONFIG_HOME", platform);
    if (xdg !== null && xdg.startsWith("/")) {
      location = { path: path.posix.join(xdg, DEFAULT_CONFIG_DIR_POSIX, DEFAULT_CONFIG_FILE_NAME), display: DEFAULT_CONFIG_DISPLAY.xdg };
    } else if (homeDir !== null && homeDir.startsWith("/")) {
      location = {
        path: path.posix.join(homeDir, ".config", DEFAULT_CONFIG_DIR_POSIX, DEFAULT_CONFIG_FILE_NAME),
        display: DEFAULT_CONFIG_DISPLAY.home,
      };
    }
  }
  if (location === null) return null;
  // S-5: a network or device path is never used, not even to look for the file.
  return checkLocalPathSyntax(location.path, platform).ok ? location : null;
};

/**
 * True when the default location exists as a value but was refused by S-5, so `doctor` can warn.
 * Mirrors `findDefaultConfigLocation` without the final check.
 */
export function defaultLocationRefused(platform: NodeJS.Platform, env: SettingsEnvironment, homeDir: string | null): boolean {
  if (findDefaultConfigLocation(platform, env, homeDir) !== null) return false;
  if (platform === "win32") {
    const appData = variable(env, "APPDATA", platform);
    return appData !== null && !checkLocalPathSyntax(appData, platform).ok;
  }
  const xdg = variable(env, "XDG_CONFIG_HOME", platform);
  return xdg !== null && xdg.startsWith("/") && !checkLocalPathSyntax(xdg, platform).ok;
}

/** The config file a command will read. `optional`: a missing file means no config (the default location only). */
export interface ConfigCandidate {
  readonly source: ConfigSource;
  /** Absolute path. Never printed. */
  readonly path: string;
  /** How messages name it: "--config", CODARYN_CONFIG or the symbolic default location (N-14). */
  readonly display: ConfigLocationDisplay;
  readonly optional: boolean;
}

export type ChooseConfigOutcome =
  | { readonly ok: true; readonly candidate: ConfigCandidate | null }
  | { readonly ok: false; readonly message: string };

/**
 * `--config` → CODARYN_CONFIG → the default location. The first two are checked with S-5 here
 * (`--config` is also checked with the other command line paths by each command).
 */
export function chooseConfigFile(input: {
  readonly argument: string | null;
  readonly env: SettingsEnvironment;
  readonly cwd: string;
  readonly defaultLocation: DefaultConfigLocation | null;
}): ChooseConfigOutcome {
  if (input.argument !== null) {
    const problem = localPathProblem(input.argument, input.cwd);
    if (problem !== null) return { ok: false, message: `the path given by --config ${problem}` };
    return {
      ok: true,
      candidate: { source: "argument", path: path.resolve(input.cwd, input.argument), display: "--config", optional: false },
    };
  }
  const fromEnv = envValue(input.env, CODARYN_CONFIG_ENV);
  if (fromEnv !== null) {
    const problem = localPathProblem(fromEnv, input.cwd);
    if (problem !== null) return { ok: false, message: `the path given by ${CODARYN_CONFIG_ENV} ${problem}` };
    return {
      ok: true,
      candidate: { source: "environment", path: path.resolve(input.cwd, fromEnv), display: CODARYN_CONFIG_ENV, optional: false },
    };
  }
  if (input.defaultLocation === null) return { ok: true, candidate: null };
  return {
    ok: true,
    candidate: { source: "default", path: input.defaultLocation.path, display: input.defaultLocation.display, optional: true },
  };
}

/** A read failure that means "no file there" for the optional default location. */
export function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT";
}

const PROFILE_NAME = new RegExp(PROFILE_NAME_PATTERN_SOURCE);

export function isProfileName(value: string): boolean {
  return PROFILE_NAME.test(value);
}

export type SelectProfileOutcome =
  | { readonly ok: true; readonly config: CodarynConfig }
  /** U-37: `hint` names the reason for the human error (CliErrorOutput.hint). */
  | { readonly ok: false; readonly message: string; readonly hint: "profile_needs_config" | "profile_not_found" };

/**
 * N-8: the effective config for `--profile <name>`. The profile's `policy` and `verifiers` replace
 * the config's; its `limits` are laid over the config's field by field. The bound rule (a profile
 * limit never above the top-level one) was checked when the file was parsed (`parseConfig`).
 * The name is never echoed: it came from the command line and may not exist in the file.
 */
export function selectProfile(config: CodarynConfig | null, name: string): SelectProfileOutcome {
  if (config === null) return { ok: false, message: "--profile needs a config file (--config, CODARYN_CONFIG or the default location)", hint: "profile_needs_config" };
  const profiles = config.profiles ?? {};
  if (!Object.hasOwn(profiles, name)) return { ok: false, message: "the config file has no profile with the name given by --profile", hint: "profile_not_found" };
  const profile = profiles[name];
  if (profile === undefined) return { ok: false, message: "the config file has no profile with the name given by --profile", hint: "profile_not_found" };
  const limits = profile.limits === undefined ? config.limits : { ...(config.limits ?? {}), ...profile.limits };
  const policy = profile.policy ?? config.policy;
  const verifiers = profile.verifiers ?? config.verifiers;
  // SP-D10: the profile's provider wins over the file's for the quick form.
  const provider = profile.provider ?? config.provider;
  return {
    ok: true,
    config: {
      ...config,
      ...(provider === undefined ? {} : { provider }),
      ...(limits === undefined ? {} : { limits }),
      ...(policy === undefined ? {} : { policy }),
      ...(verifiers === undefined ? {} : { verifiers }),
    },
  };
}
