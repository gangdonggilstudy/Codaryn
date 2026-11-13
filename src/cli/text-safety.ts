/**
 * U-280 (CLI migration C-3a): text cleaning moved to src/app/input/text-safety.js. This re-export keeps the
 * old path for the tests and the pinned file that import it (PM, after U-267); the code imports the new place.
 */

export * from "../app/input/text-safety.js";
