/**
 * Process facts for the app layer (adapter-contract section 4).
 *
 * The CLI loads `--vars-file` into `process.env` (`process.loadEnvFile`). In a process shared with
 * other code that would spread the file's values to all of it, so the app layer works on a copy of
 * the environment per call and reads the file with `util.parseEnv` (the parser `doctor` already
 * uses). Windows looks environment names up without case, as `process.env` does there.
 */

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { findInstall } from "../cli/install.js";
import type { AppEnvironment } from "./types.js";

/** A mutable copy of `source`. On Windows names are matched without case, keeping their first spelling. */
export function copyEnvironment(
  source: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform,
): Record<string, string | undefined> {
  const entries = Object.entries(source).filter((entry): entry is [string, string] => entry[1] !== undefined);
  if (platform !== "win32") return Object.fromEntries(entries);

  /** Folded name → [name as first spelled, value]. */
  const store = new Map<string, [string, string]>();
  for (const [name, value] of entries) {
    const folded = name.toUpperCase();
    if (!store.has(folded)) store.set(folded, [name, value]);
  }
  const lookup = (property: string | symbol): [string, string] | undefined =>
    typeof property === "string" ? store.get(property.toUpperCase()) : undefined;
  return new Proxy<Record<string, string | undefined>>(
    {},
    {
      get: (_target, property) => lookup(property)?.[1],
      has: (_target, property) => lookup(property) !== undefined,
      set: (_target, property, value: unknown) => {
        if (typeof property !== "string") return false;
        const folded = property.toUpperCase();
        if (value === undefined) {
          store.delete(folded);
          return true;
        }
        store.set(folded, [store.get(folded)?.[0] ?? property, String(value)]);
        return true;
      },
      deleteProperty: (_target, property) => {
        if (typeof property === "string") store.delete(property.toUpperCase());
        return true;
      },
      ownKeys: () => [...store.values()].map(([name]) => name),
      getOwnPropertyDescriptor: (_target, property) => {
        const found = lookup(property);
        return found === undefined ? undefined : { value: found[1], writable: true, enumerable: true, configurable: true };
      },
    },
  );
}

/**
 * DR-4: one variable's value, looked up as the platform does: without case on Windows, with case
 * elsewhere. Works on any environment object, not only on a `copyEnvironment` copy.
 */
export function lookupEnv(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (platform !== "win32") return env[name];
  const direct = env[name];
  if (direct !== undefined) return direct;
  const folded = name.toUpperCase();
  const key = Object.keys(env).find((item) => item.toUpperCase() === folded && env[item] !== undefined);
  return key === undefined ? undefined : env[key];
}

/** Default `readVarsFile`: the file's variables, parsed without touching `process.env`. */
export function readVarsFileSync(file: string): Readonly<Record<string, string>> {
  const parsed = parseEnv(readFileSync(file, "utf8"));
  return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

/**
 * Loads a variables file into `env` the way the CLI's `process.loadEnvFile` does for the run:
 * variables already set keep their values. Throws when the file cannot be read.
 */
export function loadVarsInto(env: Record<string, string | undefined>, file: string, read: AppEnvironment["readVarsFile"]): void {
  const loaded = read(file);
  for (const [name, value] of Object.entries(loaded)) {
    if (env[name] === undefined) env[name] = value;
  }
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

/**
 * The environment of the current Node process: a snapshot of `process.env`, the working
 * directory, and the install directory found from this module (the nearest package root named
 * "codaryn", as the CLI finds its own).
 */
export async function createNodeAppEnvironment(): Promise<AppEnvironment> {
  const readText = (file: string): Promise<string> => readFile(file, "utf8");
  let installDir: string | null;
  try {
    installDir = (await findInstall(fileURLToPath(import.meta.url), readText))?.dir ?? null;
  } catch {
    installDir = null;
  }
  return {
    env: { ...process.env },
    cwd: process.cwd(),
    installDir,
    nodeVersion: process.versions.node,
    readFile: readText,
    isDirectory,
    isFile,
    readVarsFile: readVarsFileSync,
    clock: { now: () => Date.now() },
    randomBytes: (size) => randomBytes(size),
  };
}
