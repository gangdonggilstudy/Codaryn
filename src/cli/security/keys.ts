/**
 * U-280 (CLI migration C-3a): the key checks moved to src/app/input/security/keys.js. This re-export keeps the
 * old path for the tests and the pinned file that import it (PM, after U-267); the code imports the new place.
 */

export * from "../../app/input/security/keys.js";
