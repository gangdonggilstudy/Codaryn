/**
 * Cancellation sources (PM decision P-2): SIGINT, SIGTERM, and a cancel file that appears.
 * All of them abort one signal.
 * U-296 (the CLI migration's C-6a; Codex V-31 L-1, PM after p5a's proposal): the source is the app
 * layer's (src/app/cancel.ts createRunCancelSource), which takes the same options and gives the same
 * source; this helper passes it on, so codaryn run, apply's plan of moves and apply's run of a run
 * plan (main.ts) get its two edges whole: a registration that throws removes what was registered
 * before it and is thrown on, and each removal is tried on its own and never throws. The file is
 * looked for at once and then every 100 ms, as before. The names stay for main.ts and the tests.
 */

export type { RunCancelSourceOptions as CancelSourceOptions, RunCancelSource as CancelSource } from "../app/cancel.js";
export { RUN_CANCEL_FILE_POLL_MS as CANCEL_FILE_POLL_MS, createRunCancelSource as createCancelSource } from "../app/cancel.js";
