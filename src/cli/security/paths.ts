/**
 * U-280 (CLI migration C-3a): the path checks moved to src/app/input/security/paths.ts. This re-export
 * keeps the old path for the GUI, which loads it from the root build by path
 * (gui/tests/unit/node-path-parity.test.ts, PM after the board's GUI run); the code imports the new place.
 */

export * from "../../app/input/security/paths.js";
