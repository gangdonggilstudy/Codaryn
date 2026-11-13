/**
 * U-282 (CLI migration C-3b): the run's unreadable paths and k, and runGuards moved to src/app/input/unreadable.js. This re-export keeps the
 * old path for the tests (PM, after U-267: plan A); the code imports the new place.
 */

export * from "../app/input/unreadable.js";
