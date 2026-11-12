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

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { MAX_RUN_ITEM_CHARS, MIN_NODE_MAJOR, encodeLine, nodeMajor } from "../shared/protocol.js";
import { serve } from "./host.js";
import type { HostApp, HostMessages } from "./host.js";
import type { RunItemOf } from "./runs.js";
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

/** N-C: the CLI's renderer for people (src/cli/human/output.ts); progress lines come from it (3.6). */
interface EngineHumanModule {
  createHumanOutput(catalog: unknown): {
    progressLine(event: unknown): string | null;
    applyProgressLine?(event: unknown): string | null;
  };
}

const RECORD_TYPE = /^[a-z][a-z_]{0,39}$/;
const RECORD_TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,9})?Z$/;

/** GU-3: a run's events as progress items in `language`: the CLI's sentences, on one line, cleaned. */
function runItems(human: ReturnType<EngineHumanModule["createHumanOutput"]>, shown: (text: string) => string): RunItemOf {
  const oneLine = (text: string): string => shown(text.replace(/\r?\n+$/, "").replace(/\r?\n/g, " ")).slice(0, MAX_RUN_ITEM_CHARS);
  return (event) => {
    if (typeof event !== "object" || event === null) return null;
    const { kind, text, record } = event as Record<string, unknown>;
    if (kind === "notice") return typeof text === "string" ? { at: null, kind: "notice", text: oneLine(text) } : null;
    if (kind !== "record" || typeof record !== "object" || record === null) return null;
    const { type, at } = record as Record<string, unknown>;
    if (typeof type !== "string" || !RECORD_TYPE.test(type)) return null;
    let line: string | null = null;
    try {
      line = human.progressLine(record);
    } catch {
      line = null;
    }
    if (line === null && human.applyProgressLine !== undefined) {
      try {
        line = human.applyProgressLine(record);
      } catch {
        line = null;
      }
    }
    if (line === null) return null;
    // A denied tool call is its own kind, so the window can show denials only (3.6 filter).
    const itemKind = type === "tool_decision" && (record as Record<string, unknown>)["allowed"] === false ? "tool_denied" : type;
    return { at: typeof at === "string" && RECORD_TIME.test(at) ? at : null, kind: itemKind, text: oneLine(line) };
  };
}

function engineDirFromArgs(argv: readonly string[]): string | null {
  if (argv.length !== 2 || argv[0] !== "--engine-dir") return null;
  const dir = argv[1] as string;
  const needed = [["app", "index.js"], ["i18n", "index.js"], ["workspace", "index.js"], ["cli", "text-safety.js"], ["cli", "human", "output.js"]];
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
  const humanModule = await load<EngineHumanModule>(join(engineDir, "cli", "human", "output.js"), ["createHumanOutput"]);
  if (appModule === null || i18n === null || workspaceModule === null || textSafety === null || humanModule === null) {
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
  const itemsIn = (language: "ko" | "en"): RunItemOf => runItems(humanModule.createHumanOutput(i18n.createMessageCatalog(language)), shown);
  const token = (): string => randomBytes(16).toString("hex");
  await serve(process.stdin, { app, messages, tree, shown, providers, itemsIn, token, write: writeLine, log });
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
