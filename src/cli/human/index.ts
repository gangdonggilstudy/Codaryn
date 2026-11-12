/**
 * Human output of the CLI (N-5, N-6, N-7, cli-contract 17.4): stderr text next to the JSON on
 * stdout, left out with `--quiet`. main.ts and run.ts connect it (N-A).
 */

export { HIDDEN_PATH, HUMAN_PREFIX, REVERT_MAX_LISTED, SUMMARY_MAX_PATHS, createHumanOutput } from "./output.js";
export { TOP_LEVEL_POSITION, closestKnownName, fieldPath, isFieldName } from "./fields.js";
export type { FieldSegment } from "./fields.js";
export { jsonSyntaxErrorOffset, jsonSyntaxErrorPosition, positionOf } from "./json-position.js";
export type { JsonPosition } from "./json-position.js";
export { createHumanWriter } from "./writer.js";
export type { HumanWriter, HumanWriterOptions } from "./writer.js";
export { displayWidth, formatLocalTime, shellArg } from "./format.js";
