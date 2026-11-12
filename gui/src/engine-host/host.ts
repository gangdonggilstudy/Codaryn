/**
 * The engine host's request handling (DR-26, docs/design/standalone-gui.md 4.2). It calls app
 * layer functions only (src/app) and answers each request line with one response line. The app
 * and the message catalog are passed in, so unit tests run it with fakes and without Electron.
 */

import { isAbsolute } from "node:path";
import { CHANNEL_ERRORS, LineDecoder, encodeLine, parseRequest } from "../shared/protocol.js";
import type { HostCall, HostError, HostResponse } from "../shared/protocol.js";
import { modelsValue, selectedValue, settingsValue } from "./settings.js";
import type { Shown } from "./settings.js";

/** The `DoctorRequest` of the app layer (src/app/types.ts). The GUI passes no config, vars or task file yet. */
export interface HostDoctorRequest {
  readonly configPath: null;
  readonly varsFile: null;
  readonly taskPath: null;
  readonly workspace: string | null;
}

/** `ListModelsRequest` (src/app/types.ts). The GUI uses the settings a run would use (no --config, no vars file). */
export interface HostModelsRequest {
  readonly provider: string;
  readonly configPath: null;
  readonly varsFile: null;
}

/** The part of `CodarynApp` (src/app/types.ts) this host calls. */
export interface HostApp {
  doctor(request: HostDoctorRequest): Promise<unknown>;
  readSettings(request: { readonly configPath: null }): Promise<unknown>;
  /** A real API request (Y-2): only when the person asked for the list. */
  listModels(request: HostModelsRequest): Promise<unknown>;
  selectModel(request: HostModelsRequest & { readonly model: string }): Promise<unknown>;
}

/** Texts from the shared catalog (src/i18n), in the language the CLI would choose. */
export interface HostMessages {
  texts(osLocale: string | null, ids: readonly string[]): { readonly language: string; readonly texts: Readonly<Record<string, string>> };
}

/** GU-2: one directory of a workspace (tree.ts). */
export type HostTree = (request: { readonly workspace: string; readonly dir: string; readonly offset: number }) => Promise<unknown>;

export interface HostDeps {
  readonly app: HostApp;
  readonly messages: HostMessages;
  readonly tree: HostTree;
  /** Text from a file or the API as the window may show it (control characters and key shapes hidden). */
  readonly shown: Shown;
  /** The model providers the app layer connects (CONNECTED_MODEL_PROVIDERS, DR-22). */
  readonly providers: readonly string[];
  /** Writes one complete line to the channel. */
  readonly write: (line: string) => void;
  /** Diagnostics for stderr. Never the content of a request or a response. */
  readonly log: (text: string) => void;
  /**
   * R-10 L-2: called once when the input ends, which means the main process is gone or closing.
   * Whatever is still running is to stop now (GU-3 cancels its runs here).
   */
  readonly onInputEnd?: () => void;
}

/** How long `serve` waits for running calls after the input ended (R-10 L-2). */
export const INPUT_END_GRACE_MS = 1_000;

const MAX_PATH_CHARS = 4096;
const MAX_MESSAGE_IDS = 200;
const MESSAGE_ID = /^[a-z][a-z0-9_.-]{0,79}$/;
const LOCALE = /^[A-Za-z0-9_-]{1,64}$/;

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Obj, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

class ArgsError extends Error {}

function doctorArgs(args: unknown): HostDoctorRequest {
  if (!isObj(args) || !onlyKeys(args, ["workspace"])) throw new ArgsError();
  const workspace = args["workspace"] ?? null;
  if (workspace !== null && (typeof workspace !== "string" || workspace.length > MAX_PATH_CHARS || !isAbsolute(workspace) || workspace.includes("\0"))) {
    throw new ArgsError();
  }
  return { configPath: null, varsFile: null, taskPath: null, workspace };
}

function treeArgs(args: unknown): { workspace: string; dir: string; offset: number } {
  if (!isObj(args) || !onlyKeys(args, ["workspace", "dir", "offset"])) throw new ArgsError();
  const { workspace, dir, offset } = args;
  if (typeof workspace !== "string" || workspace.length > MAX_PATH_CHARS || !isAbsolute(workspace) || workspace.includes("\0")) throw new ArgsError();
  if (typeof dir !== "string" || dir.length > MAX_PATH_CHARS || dir.includes("\0")) throw new ArgsError();
  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0) throw new ArgsError();
  return { workspace, dir, offset };
}

/** A call that takes no arguments: `{}`. */
function noArgs(args: unknown): void {
  if (!isObj(args) || Object.keys(args).length > 0) throw new ArgsError();
}

/** A model id as the API gives it: printable ASCII without spaces. */
const MODEL_ID = /^[!-~]{1,200}$/;

function providerArg(args: unknown, providers: readonly string[], keys: readonly string[]): Obj & { provider: string } {
  if (!isObj(args) || !onlyKeys(args, keys)) throw new ArgsError();
  const provider = args["provider"];
  if (typeof provider !== "string" || !providers.includes(provider)) throw new ArgsError();
  return args as Obj & { provider: string };
}

function messagesArgs(args: unknown): { osLocale: string | null; ids: string[] } {
  if (!isObj(args) || !onlyKeys(args, ["osLocale", "ids"])) throw new ArgsError();
  const osLocale = args["osLocale"] ?? null;
  if (osLocale !== null && (typeof osLocale !== "string" || !LOCALE.test(osLocale))) throw new ArgsError();
  const ids = args["ids"];
  if (!Array.isArray(ids) || ids.length > MAX_MESSAGE_IDS || !ids.every((id) => typeof id === "string" && MESSAGE_ID.test(id))) throw new ArgsError();
  return { osLocale, ids: ids as string[] };
}

export interface HostHandler {
  /** Handles one request line. Resolves after its response line is written. */
  handleLine(line: string): Promise<void>;
}

export function createHostHandler(deps: HostDeps): HostHandler {
  const respond = (response: HostResponse): void => deps.write(encodeLine(response));
  const fail = (id: number, error: HostError): void => respond({ v: 1, id, ok: false, error });

  async function run(call: HostCall, args: unknown): Promise<unknown> {
    switch (call) {
      case "doctor":
        return deps.app.doctor(doctorArgs(args));
      case "messages": {
        const { osLocale, ids } = messagesArgs(args);
        return deps.messages.texts(osLocale, ids);
      }
      case "tree":
        return deps.tree(treeArgs(args));
      case "settings":
        noArgs(args);
        return settingsValue(await deps.app.readSettings({ configPath: null }), deps.shown, deps.providers);
      case "listModels": {
        const { provider } = providerArg(args, deps.providers, ["provider"]);
        return modelsValue(provider, await deps.app.listModels({ provider, configPath: null, varsFile: null }), deps.shown);
      }
      case "selectModel": {
        const { provider, model } = providerArg(args, deps.providers, ["provider", "model"]);
        if (typeof model !== "string" || !MODEL_ID.test(model)) throw new ArgsError();
        return selectedValue(await deps.app.selectModel({ provider, configPath: null, varsFile: null, model }), deps.shown);
      }
    }
  }

  return {
    async handleLine(line: string): Promise<void> {
      const parsed = parseRequest(line);
      if (!parsed.ok) {
        if (parsed.id !== null) fail(parsed.id, parsed.error);
        else deps.log("codaryn engine host: ignored a line that is not a request");
        return;
      }
      const { id, call, args } = parsed.request;
      let value: unknown;
      try {
        value = await run(call, args);
      } catch (error) {
        if (error instanceof ArgsError) {
          fail(id, { code: CHANNEL_ERRORS.invalidArgs, message: "the arguments do not fit the call" });
        } else {
          // The exception text can hold paths or record content; it is not passed on.
          deps.log(`codaryn engine host: the ${call} call failed`);
          fail(id, { code: CHANNEL_ERRORS.hostError, message: "the engine host failed on this call" });
        }
        return;
      }
      try {
        respond({ v: 1, id, ok: true, value });
      } catch {
        fail(id, { code: CHANNEL_ERRORS.hostError, message: "the answer could not be sent" });
      }
    },
  };
}

/**
 * Reads request lines from `input` until it ends and answers each. Requests run concurrently.
 * When the input ends (the main process is gone or closing, DR-8) it tells `onInputEnd` and waits
 * for running calls at most `graceMs`; their answers have nobody to read them, so the host does not
 * stay for them (R-10 L-2).
 */
export async function serve(
  input: AsyncIterable<string | Uint8Array>,
  deps: HostDeps,
  options: { readonly graceMs?: number } = {},
): Promise<void> {
  const handler = createHostHandler(deps);
  const running = new Set<Promise<void>>();
  const decoder = new LineDecoder(
    (line) => {
      const task = handler.handleLine(line).finally(() => running.delete(task));
      running.add(task);
    },
    () => deps.log("codaryn engine host: ignored a line longer than the limit"),
  );
  const text = new TextDecoder();
  for await (const chunk of input) {
    decoder.push(typeof chunk === "string" ? chunk : text.decode(chunk, { stream: true }));
  }
  decoder.end();
  deps.onInputEnd?.();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const grace = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, options.graceMs ?? INPUT_END_GRACE_MS);
  });
  await Promise.race([Promise.all(running), grace]);
  clearTimeout(timer);
}
