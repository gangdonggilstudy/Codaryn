/**
 * U-100 (design gap C-10, N-10, usability review D-4): when the chosen provider's key variable is not
 * set, doctor said so but not how to register it, which init tells (init.key_hint_windows,
 * init.key_hint_posix). Now doctor's text gives the same line for the operating system it runs on,
 * under the key check. Neither line puts a value in a command: Windows opens the environment
 * variables window, macOS and Linux add an export line in an editor. `doctor --json` does not change.
 * runDoctor in this process with stand-in files; nothing is read from the host or sent.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import type { DoctorOutput, MessageCatalog, MessageId } from "../../../src/contracts/index.js";
import { runDoctor } from "../../../src/cli/doctor.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { lexicalLocate } from "./locate.js";

/** Not a real key format; built from parts (G-10). */
const FAKE_KEY = ["fake", "u100", "key", "0042"].join("-");

async function doctor(options: { platform: NodeJS.Platform; env?: Record<string, string>; json?: boolean; messages?: MessageCatalog }): Promise<string> {
  const outcome = await runDoctor({
    argv: ["doctor", ...(options.json === true ? ["--json"] : [])],
    env: options.env ?? {},
    cwd: path.resolve("/tmp/codaryn-u100"),
    nodeVersion: "26.0.0",
    platform: options.platform,
    readFile: async () => Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" })),
    isDirectory: async () => false,
    isFile: async () => false,
    locateInWorkspace: lexicalLocate,
    relatePaths: async () => "separate",
    ...(options.messages === undefined ? {} : { messages: options.messages }),
  });
  assert.ok("text" in outcome, JSON.stringify(outcome));
  return outcome.text;
}

const hint = (catalog: MessageCatalog, id: "init.key_hint_windows" | "init.key_hint_posix"): string =>
  (catalog.format as (id: MessageId, params: Record<string, string>) => string)(id, { keyEnv: "ANTHROPIC_API_KEY" });

describe("U-100: doctor tells how to register a missing key, for the operating system", () => {
  test("the key check says the variable is missing (the case this is about)", async () => {
    const output = JSON.parse(await doctor({ platform: "win32", json: true })) as DoctorOutput;
    const check = output.checks.find((entry) => entry.id === "api_key");
    assert.deepEqual([check?.status, check?.text?.id], ["fail", "doctor.api_key.missing"], JSON.stringify(check));
  });

  for (const language of ["en", "ko"] as const) {
    const catalog = createMessageCatalog(language);
    test(`${language}: Windows gets the Windows line, macOS and Linux the POSIX line, under the key check`, async () => {
      const windows = await doctor({ platform: "win32", messages: catalog });
      assert.ok(windows.includes(hint(catalog, "init.key_hint_windows")), windows);
      assert.equal(windows.includes(hint(catalog, "init.key_hint_posix")), false, windows);
      for (const platform of ["linux", "darwin"] as const) {
        const posix = await doctor({ platform, messages: catalog });
        assert.ok(posix.includes(hint(catalog, "init.key_hint_posix")), posix);
        assert.equal(posix.includes(hint(catalog, "init.key_hint_windows")), false, posix);
      }
      // The line comes right after the key check's own line.
      const lines = windows.split("\n");
      const at = lines.findIndex((line) => line.includes(hint(catalog, "init.key_hint_windows")));
      assert.ok(lines[at - 1]?.includes("ANTHROPIC_API_KEY"), windows);
    });
  }

  test("without a catalog (the English fallback) the line is there too", async () => {
    const text = await doctor({ platform: "linux" });
    assert.ok(text.includes(hint(createMessageCatalog("en"), "init.key_hint_posix")), text);
  });

  test("a key that is set: no such line", async () => {
    const catalog = createMessageCatalog("en");
    const text = await doctor({ platform: "win32", env: { ANTHROPIC_API_KEY: FAKE_KEY }, messages: catalog });
    assert.equal(text.includes(hint(catalog, "init.key_hint_windows")), false, text);
  });

  test("doctor --json is as before: the hint is for people only", async () => {
    const json = await doctor({ platform: "win32", json: true, messages: createMessageCatalog("en") });
    assert.equal(json.includes("rundll32"), false, json);
    assert.equal(json.includes("EditEnvironmentVariables"), false, json);
  });
});
