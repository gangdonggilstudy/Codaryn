/**
 * R-10 L-3: the main process's copy of the local path rule (src/main/node-path.ts) gives the same
 * answer as the CLI's `checkLocalPathSyntax` (src/cli/security/paths.ts) in the root build.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { isLocalPathSyntax } from "../../src/main/node-path.js";

const GUI = fileURLToPath(new URL("../../../", import.meta.url));
const PATHS_MODULE = path.join(GUI, "..", "dist", "src", "cli", "security", "paths.js");

const B = "\\";
const INPUTS = [
  "C:" + B + "Program Files" + B + "nodejs",
  "c:/tools/node",
  B + B + "server" + B + "share",
  "//server/share",
  B + B + "." + B + "pipe" + B + "x",
  B + B + "?" + B + "C:" + B + "x",
  "//?/C:/x",
  B + "??" + B + "C:" + B + "x",
  "C:" + B + "nul" + B + "bin",
  "C:" + B + "tools" + B + "COM1.txt",
  "C:" + B + "tools" + B + "con .x",
  "C:" + B + "console",
  "relative" + B + "bin",
  ".",
  "/usr/bin",
  "/dev/fd",
  "//dev/x",
  "/home/a/dev",
  "",
  "a\0b",
];

test("node path (R-10 L-3): the local path rule matches the CLI's on both platforms", { skip: !existsSync(PATHS_MODULE) && "the engine is not built" }, async () => {
  const cli = (await import(pathToFileURL(PATHS_MODULE).href)) as {
    checkLocalPathSyntax(input: string, platform: NodeJS.Platform): { ok: boolean };
  };
  for (const platform of ["win32", "linux"] as const) {
    for (const input of INPUTS) {
      assert.equal(isLocalPathSyntax(input, platform), cli.checkLocalPathSyntax(input, platform).ok, `${platform} ${JSON.stringify(input)}`);
    }
  }
});
