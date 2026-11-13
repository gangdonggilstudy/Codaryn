/**
 * U-282 (CLI migration C-3b): the config file's location moved to src/app/input/config-file.js. This re-export keeps the
 * old path for the tests (PM, after U-267: plan A); the code imports the new place.
 */

export * from "../app/input/config-file.js";
