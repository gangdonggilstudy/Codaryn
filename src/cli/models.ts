/**
 * `codaryn models [--provider <name>] [--config <config.json>] [--vars-file <path>] [--json] [--use <number|id>]`
 * (Y-1 to Y-3, SP-6): lists the models the chosen provider's key can use and can write one where the
 * config file keeps that provider's model.
 *
 * - SP-6: the provider is `--provider`, else the config's `provider`, else anthropic. Its key, its
 *   address, its lister and its model variable are used, never another provider's.
 * - The key, the API address, the time limit and retries come from the same functions `run` uses
 *   (`resolveListSettings` → `resolveConnection` in settings.ts). The variables file and the config
 *   file go through the same checks as in `run` (S-5 paths, BOM, key check before parsing).
 * - The list comes from the provider's lister, injected: `listModels` (anthropic's) or `listers`
 *   (main.ts passes API_MODEL_LISTERS). Without one nothing is sent. The key reaches it in
 *   `settings` only, and the printed text never holds it.
 * - `--use` (or the answer at a terminal prompt) writes that provider's model and nothing else (see
 *   `withModel` for what is kept): anthropic's top-level `model`, or `providers.<name>.model` for
 *   another provider and for anthropic when the file keeps `providers.anthropic`. Atomically: a
 *   temporary file next to the target, then a rename. A missing config file is created with
 *   `schemaVersion` and that model only.
 * No workspace is needed and nothing else is written.
 */

import { CODARYN_MODEL_ENV, toSchemaFieldPath } from "../contracts/index.js";
import type { MessageCatalog, MessageId, ModelsListEntry, ModelsOutput } from "../contracts/index.js";
import { parseModelsArgs } from "./args.js";
import { jsonLine } from "./guard.js";
import type { CommandOutcome } from "./guard.js";
import { argumentsError } from "../app/prepare.js";
import { displayWidth, padEnd, padStart } from "./human/index.js";
import { cleanText, hideKeys } from "../app/input/text-safety.js";
import { LF } from "../app/config-write.js";
import { runModelsIn, scrub } from "../app/models-command.js";
import type { ModelsCommandEnvironment } from "../app/models-command.js";

export { withModel, writeConfigAtomic } from "../app/config-write.js";
export type { ConfigWriteOptions } from "../app/config-write.js";

export interface ModelsEnvironment extends ModelsCommandEnvironment {
  readonly argv: readonly string[];
  /** U-156: the person's message catalog for the text and the question (main.ts's); English without it. The JSON does not use it. */
  readonly messages?: MessageCatalog;
}

function tokens(value: number | null): string {
  return value === null ? "-" : String(value);
}

/** U-156 (nb-i18n's E group): the words of models' text; each line's values are put in by the renderer. */
interface ModelsWords {
  heads(): readonly [string, string, string, string];
  noneListed(): string;
  listed(count: number): string;
  noCurrent(variable: string): string;
  currentFrom(source: string): string;
  notListed(): string;
  writtenLabel(): string;
  writtenPlace(field: string, created: boolean): string;
  overridden(variable: string, field: string): string;
  usePrompt(field: string): string;
}

/** The text before U-156, character for character: without a catalog, and wherever the catalog cannot give one. */
const ENGLISH_WORDS: ModelsWords = {
  heads: () => ["id", "name", "input tokens", "output tokens"],
  noneListed: () => "No model was listed for this key.",
  listed: (count) => `Models this key can use (${count})`,
  noCurrent: (variable) => `No current model: none is set in ${variable} or the config file. Choose one with --use <number|id> --config <config.json>.`,
  currentFrom: (source) => `current model (from ${source === "config" ? "the config file" : source})`,
  notListed: () => "(not in this list)",
  writtenLabel: () => "Written",
  writtenPlace: (field, created) => `is now the config file's ${field}${created ? " (the file was created)" : ""}.`,
  overridden: (variable, field) => `Note: ${variable} is set and is used instead of the config file's ${field} until it is unset.`,
  usePrompt: (field) => `Number or id to write into the config file's ${field} (Enter to skip)`,
};

/** The catalog's words (models.*); a text the catalog cannot give (an id or value it refuses) is the English one. */
function catalogWords(messages: MessageCatalog): ModelsWords {
  const format = messages.format as (id: MessageId, params?: object) => string;
  const or = (line: () => string, english: () => string): string => {
    try {
      return line();
    } catch {
      return english();
    }
  };
  // `{field}` is a SchemaFieldPath and `{variable}` a model variable (settingEnv); anything else is the English.
  const field = (value: string): string => {
    const checked = toSchemaFieldPath(value);
    if (checked === null) throw new Error("not a field path");
    return checked;
  };
  return {
    heads: () => {
      const [id, name, input, output] = ENGLISH_WORDS.heads();
      return [
        or(() => format("models.table.id"), () => id),
        or(() => format("models.table.name"), () => name),
        or(() => format("models.table.input_tokens"), () => input),
        or(() => format("models.table.output_tokens"), () => output),
      ];
    },
    noneListed: () => or(() => format("models.none_listed"), ENGLISH_WORDS.noneListed),
    listed: (count) => or(() => format("models.listed", { count }), () => ENGLISH_WORDS.listed(count)),
    noCurrent: (variable) => or(() => format("models.no_current", { variable }), () => ENGLISH_WORDS.noCurrent(variable)),
    currentFrom: (source) =>
      or(
        () => (source === "config" ? format("models.current_from_config") : format("models.current_from_env", { variable: source })),
        () => ENGLISH_WORDS.currentFrom(source),
      ),
    notListed: () => or(() => format("models.not_listed"), ENGLISH_WORDS.notListed),
    writtenLabel: () => or(() => format("models.written_label"), ENGLISH_WORDS.writtenLabel),
    writtenPlace: (place, created) =>
      or(() => format(created ? "models.written_place_created" : "models.written_place", { field: field(place) }), () => ENGLISH_WORDS.writtenPlace(place, created)),
    overridden: (variable, place) => or(() => format("models.overridden", { variable, field: field(place) }), () => ENGLISH_WORDS.overridden(variable, place)),
    usePrompt: (place) => or(() => format("models.use_prompt", { field: field(place) }), () => ENGLISH_WORDS.usePrompt(place)),
  };
}

const wordsOf = (messages: MessageCatalog | undefined): ModelsWords => (messages === undefined ? ENGLISH_WORDS : catalogWords(messages));

function table(models: readonly ModelsListEntry[], currentId: string | null, words: ModelsWords = ENGLISH_WORDS): string[] {
  const rows = models.map((model) => [
    `${model.id === currentId ? "*" : " "} ${model.number}`,
    cleanText(model.id),
    cleanText(model.displayName),
    tokens(model.maxInputTokens),
    tokens(model.maxOutputTokens),
  ]);
  // The `  #` column head is not a word and stays as it is.
  const header = ["  #", ...words.heads()];
  // U-127: terminal columns (displayWidth), so a name with wide characters keeps the columns after it.
  const widths = header.map((title, column) => Math.max(displayWidth(title), ...rows.map((row) => displayWidth(row[column] ?? ""))));
  const format = (row: readonly string[]): string =>
    row
      .map((cell, column) => (column >= 3 ? padStart(cell, widths[column] ?? 0) : padEnd(cell, widths[column] ?? 0)))
      .join("  ")
      .trimEnd();
  return [format(header), ...rows.map(format)];
}

/** SP-6: how the text names the provider's model variable and where `--use` writes. */
export interface ModelsTextPlaces {
  readonly modelEnv: string;
  readonly field: string;
}

const ANTHROPIC_PLACES: ModelsTextPlaces = { modelEnv: CODARYN_MODEL_ENV, field: "model" };

/**
 * The text of models. U-156: the lines come from `messages` (models.*) in the person's language; the
 * renderer puts in the values and marks (`: `, `* `, the model ids and names). Without a catalog, the
 * English, which the English catalog gives character for character.
 */
export function renderModels(output: ModelsOutput, withTable: boolean, places: ModelsTextPlaces = ANTHROPIC_PLACES, messages?: MessageCatalog): string {
  const words = wordsOf(messages);
  const lines: string[] = [];
  if (withTable) {
    if (output.models.length === 0) {
      lines.push(words.noneListed());
    } else {
      lines.push(`${words.listed(output.models.length)}:`, "", ...table(output.models, output.current?.id ?? null, words), "");
    }
  }
  const current = output.current;
  if (current === null) {
    lines.push(words.noCurrent(places.modelEnv));
  } else {
    lines.push(`* ${words.currentFrom(current.source)}: ${cleanText(current.id)}${current.listed ? "" : ` ${words.notListed()}`}`);
  }
  const selected = output.selected;
  if (selected !== null) {
    lines.push(`${words.writtenLabel()}: ${cleanText(selected.id)} ${words.writtenPlace(places.field, selected.created)}`);
    if (selected.overriddenBy !== null) lines.push(words.overridden(selected.overriddenBy, places.field));
  }
  return `${lines.join(LF)}${LF}`;
}

export function runModels(io: ModelsEnvironment): Promise<CommandOutcome> {
  try {
    const parsed = parseModelsArgs(io.argv);
    if (!parsed.ok) return Promise.resolve(argumentsError(parsed));
    const args = parsed.args;
    return runModelsIn(io, args, {
      ask(before, places, secrets, currentKey) {
        const shown = hideKeys(scrub(renderModels(before, true, places, io.messages), secrets), currentKey);
        return io.ask!(`${shown}${wordsOf(io.messages).usePrompt(places.field)}: `);
      },
      choice(answer) {
        return answer === null || answer.trim() === "" ? null : answer.trim();
      },
      complete(output, prompted, places, secrets, currentKey) {
        const printed = args.json ? jsonLine(output) : renderModels(output, !prompted, places, io.messages);
        return { text: hideKeys(scrub(printed, secrets), currentKey), exitCode: output.exitCode };
      },
    });
  } catch (error) {
    return Promise.reject(error);
  }
}
