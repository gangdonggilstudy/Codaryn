/**
 * Human output of the CLI (N-5, N-6, N-7, cli-contract 17.4): stderr text next to the JSON on
 * stdout, left out with `--quiet`. main.ts and run.ts connect it (N-A).
 */

export { FINAL_MESSAGE_MAX_LINES, HIDDEN_PATH, HUMAN_PREFIX, REVERT_MAX_LISTED, SUMMARY_MAX_PATHS, createHumanOutput } from "./output.js";
export { TOP_LEVEL_POSITION, closestKnownName, fieldPath, isFieldName } from "./fields.js";
export type { FieldSegment } from "./fields.js";
export { jsonSyntaxErrorOffset, jsonSyntaxErrorPosition, positionOf } from "./json-position.js";
export type { JsonPosition } from "./json-position.js";
export { createHumanWriter } from "./writer.js";
export type { HumanWriter, HumanWriterOptions } from "./writer.js";
// U-125: displayWidth, padEnd and padStart are the one terminal width for every table (doctor, models: U-127).
export { MODEL_TEXT_COLUMNS, MODEL_TEXT_FALLBACK_COLUMNS, MODEL_TEXT_PREFIX, displayWidth, formatLocalTime, padEnd, padStart, quoteModelText, shellArg, terminalColumns } from "./format.js";
