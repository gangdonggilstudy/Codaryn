/**
 * Entry of the engine host: a separate Node 26+ process the Electron main process starts
 * (DR-26). Usage: `node main.js --engine-dir <absolute path of the built engine, dist/src>`.
 *
 * - stdout carries the channel only. Everything else written to stdout (console, a stray
 *   `process.stdout.write`) goes to stderr, so the channel cannot be broken by engine output.
 * - The first line is `ready` with this Node's version. On a Node older than 26 the host sends it
 *   and ends without loading the engine; the main process refuses it (MIN_NODE_MAJOR).
 * - The host ends when stdin ends, so it never outlives the main process (DR-8).
 */

import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { MIN_NODE_MAJOR, encodeLine, nodeMajor } from "../shared/protocol.js";
import { serve } from "./host.js";
import type { HostApp, HostMessages } from "./host.js";
import { createTreeLister } from "./tree.js";
import type { TreeEngine } from "./tree.js";

const channelWrite = process.stdout.write.bind(process.stdout);
const toStderr = ((chunk: unknown, ...rest: unknown[]): boolean =>
  (process.stderr.write as (chunk: unknown, ...rest: unknown[]) => boolean)(chunk, ...rest)) as typeof process.stdout.write;
process.stdout.write = toStderr;
console.log = console.error;
console.info = console.error;
console.debug = console.error;

function log(text: string): void {
  process.stderr.write(`${text}\n`);
}

function writeLine(line: string): void {
  channelWrite(line);
}

/** The engine modules this host uses, checked when loaded (src/app/index.ts, src/i18n/index.ts). */
interface EngineAppModule {
  createNodeAppEnvironment(): Promise<unknown>;
  createCodarynApp(environment: unknown): HostApp;
  /** DR-22: the providers the app layer connects (an array of names). */
  readonly CONNECTED_MODEL_PROVIDERS?: unknown;
}

interface EngineWorkspaceModule {
  createWorkspace: TreeEngine["createWorkspace"];
}

interface EngineTextSafetyModule {
  cleanText(text: string): string;
  hideKeys(text: string, currentKey: string | null): string;
}

interface EngineI18nModule {
  selectMessageLanguage(input: { env: string | null; config: null; osLocale: string | null }): string;
  createMessageCatalog(language: string): { format(id: string): string };
}

function engineDirFromArgs(argv: readonly string[]): string | null {
  if (argv.length !== 2 || argv[0] !== "--engine-dir") return null;
  const dir = argv[1] as string;
  const needed = [["app", "index.js"], ["i18n", "index.js"], ["workspace", "index.js"], ["cli", "text-safety.js"]];
  return isAbsolute(dir) && needed.every((parts) => existsSync(join(dir, ...parts))) ? dir : null;
}

async function load<T>(file: string, names: readonly string[]): Promise<T | null> {
  try {
    const module = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    return names.every((name) => typeof module[name] === "function") ? (module as T) : null;
  } catch {
    return null;
  }
}

async function main(): Promise<number> {
  const node = process.versions.node;
  const major = nodeMajor(node);
  if (major === null || major < MIN_NODE_MAJOR) {
    writeLine(encodeLine({ v: 1, type: "ready", node }));
    log(`codaryn engine host: Node ${MIN_NODE_MAJOR} or later is required`);
    return 3;
  }
  const engineDir = engineDirFromArgs(process.argv.slice(2));
  if (engineDir === null) {
    log("codaryn engine host: usage: main.js --engine-dir <absolute path of the built engine>");
    return 2;
  }
  const appModule = await load<EngineAppModule>(join(engineDir, "app", "index.js"), ["createNodeAppEnvironment", "createCodarynApp"]);
  const i18n = await load<EngineI18nModule>(join(engineDir, "i18n", "index.js"), ["selectMessageLanguage", "createMessageCatalog"]);
  const workspaceModule = await load<EngineWorkspaceModule>(join(engineDir, "workspace", "index.js"), ["createWorkspace"]);
  const textSafety = await load<EngineTextSafetyModule>(join(engineDir, "cli", "text-safety.js"), ["cleanText", "hideKeys"]);
  if (appModule === null || i18n === null || workspaceModule === null || textSafety === null) {
    log("codaryn engine host: the engine modules could not be loaded");
    return 2;
  }
  const app = appModule.createCodarynApp(await appModule.createNodeAppEnvironment());
  const messages: HostMessages = {
    texts(osLocale, ids) {
      const language = i18n.selectMessageLanguage({ env: process.env["CODARYN_LANG"] ?? null, config: null, osLocale });
      const catalog = i18n.createMessageCatalog(language);
      const texts: Record<string, string> = {};
      for (const id of ids) {
        try {
          texts[id] = catalog.format(id);
        } catch {
          // An unknown id or one that needs parameters is left out.
        }
      }
      return { language, texts };
    },
  };
  const providers = Array.isArray(appModule.CONNECTED_MODEL_PROVIDERS)
    ? appModule.CONNECTED_MODEL_PROVIDERS.filter((name): name is string => typeof name === "string" && /^[a-z][a-z0-9_-]{0,31}$/.test(name))
    : [];
  const shown = (text: string): string => textSafety.hideKeys(textSafety.cleanText(text), process.env["ANTHROPIC_API_KEY"] ?? null);
  const tree = createTreeLister({
    createWorkspace: (options) => workspaceModule.createWorkspace(options),
    cleanText: (text) => textSafety.cleanText(text),
    hideKeys: (text, key) => textSafety.hideKeys(text, key),
    currentKey: () => process.env["ANTHROPIC_API_KEY"] ?? null,
    platform: process.platform,
  });
  writeLine(encodeLine({ v: 1, type: "ready", node }));
  process.stdin.setEncoding("utf8");
  await serve(process.stdin, { app, messages, tree, shown, providers, write: writeLine, log });
  return 0;
}

/** Ends with `code`. Handles the engine left open cannot keep the host alive past half a second. */
function finish(code: number): void {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 500).unref();
}

main().then(finish, () => {
  log("codaryn engine host: stopped by an internal error");
  finish(1);
});
