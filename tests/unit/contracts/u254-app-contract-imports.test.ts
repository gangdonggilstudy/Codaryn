/**
 * U-254 (the CLI migration, DR-65, step C-1 = migration step 1a): the app layer's types are a
 * contract module, src/contracts/app.ts. Like every contract module it imports neither the app layer
 * nor the CLI: each of its import specifiers names a sibling contract module. src/app/types.ts only
 * passes the names on (no declaration of its own).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const source = (relative: string): string => readFileSync(path.join(repoRoot, relative), "utf8");
const specifiers = (text: string): string[] => [...text.matchAll(/\bfrom\s+"([^"]+)"/g)].map((match) => match[1] ?? "");

describe("U-254: src/contracts/app.ts", () => {
  test("imports only sibling contract modules, never the app layer or the CLI; src/app/types.ts only passes names on", () => {
    const imported = specifiers(source("src/contracts/app.ts"));
    assert.ok(imported.length > 0);
    for (const specifier of imported) assert.match(specifier, /^\.\/[a-z-]+\.js$/, specifier);
    const types = source("src/app/types.ts");
    assert.deepEqual(specifiers(types), ["../contracts/app.js"]);
    assert.doesNotMatch(types, /^export (interface|type) \w/m, "no declaration of its own");
  });
});
