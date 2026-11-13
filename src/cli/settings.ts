/**
 * U-282 (CLI migration C-3b): the provider settings and key values moved to src/app/input/settings.js. This re-export keeps the
 * old path for the tests and the pinned file tests/unit/cli/sp0-pins.ts (PM, after U-267: plan A); the code imports the new place.
 */

export * from "../app/input/settings.js";
