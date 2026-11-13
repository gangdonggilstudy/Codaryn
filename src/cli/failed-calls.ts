/**
 * U-293 (the CLI migration's C-6a): the failed-call rule moved word for word to
 * src/app/failed-calls.ts, where the app layer counts a run's failed calls for its end summary
 * (src/app/tally.ts). The progress lines and the report here keep this path.
 */

export { createFailedCalls } from "../app/failed-calls.js";
export type { FailedCalls } from "../app/failed-calls.js";
