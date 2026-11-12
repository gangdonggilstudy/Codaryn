/**
 * Output problems the documentation owner found with the real CLI (N-D report, section 4, items
 * 1, 3 and 4). Each test reproduces the report's input.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import type { CatalogText, CliErrorOutput, HumanOutput, MessageCatalog } from "../../../src/contracts/index.js";
import { runDoctor } from "../../../src/cli/doctor.js";
import { explainedErrorText } from "../../../src/cli/error-text.js";
import { helpText } from "../../../src/cli/help.js";
import { lexicalLocate } from "./locate.js";

describe("N-D 4.1: help names each option once", () => {
  test("an option text that already starts with its syntax is not prefixed again", () => {
    const catalog = {
      language: "en",
      format: (id: string) => (id === "help.option.workspace" ? "--workspace <dir>: the workspace directory" : `<${id}>`) as CatalogText,
    } as unknown as MessageCatalog;
    const text = helpText("runs", catalog);
    const line = text.split("\n").find((item) => item.includes("the workspace directory")) ?? "";
    assert.equal(line.split("--workspace").length - 1, 1, line);
    // A text without the syntax still gets it in front.
    assert.ok(text.includes("--limit <n>") && text.includes("<help.option.limit>"));
  });
});

describe("N-D 4.3: doctor --profile reports the config file's own error", () => {
  test("another profile over its limits is named by position, not as a missing profile", async () => {
    const config = {
      schemaVersion: 1,
      limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: 100, maxDurationMs: 1000 },
      profiles: { doc: { limits: { maxModelTurns: 2 } }, big: { limits: { maxModelTurns: 9 } } },
    };
    const outcome = await runDoctor({
      argv: ["doctor", "--config", "c.json", "--profile", "doc", "--json"],
      env: {},
      cwd: path.resolve("/tmp/codaryn-nd"),
      nodeVersion: "26.0.0",
      readFile: async () => JSON.stringify(config),
      isDirectory: async () => false,
      isFile: async () => false,
      locateInWorkspace: lexicalLocate,
      relatePaths: async () => "separate",
    });
    assert.ok("text" in outcome);
    const check = (JSON.parse(outcome.text) as { checks: { id: string; message: string }[] }).checks.find((item) => item.id === "config_file");
    assert.ok(check?.message.startsWith("profiles[1].limits.maxModelTurns"), String(check?.message));
  });
});

describe("N-D 4.4: the lock hint is indented like the other lines and written once", () => {
  const messages = { language: "en", format: (id: string) => (id === "lock.remove_hint" ? "remove .codaryn/lock.json" : id) as CatalogText } as unknown as MessageCatalog;
  const output = (code: CliErrorOutput["code"]): CliErrorOutput => ({ schemaVersion: 1, kind: "error", code, exitCode: 2, message: "m" });
  const human = (text: string) => ({ output: { error: () => text } as unknown as HumanOutput, messages });

  test("workspace_locked gets the hint, two spaces in, once", () => {
    const text = explainedErrorText(output("workspace_locked"), human("codaryn: error — locked\n  To fix: wait\n"));
    assert.deepEqual(text.split("\n"), ["codaryn: error — locked", "  To fix: wait", "  remove .codaryn/lock.json", ""]);
    const already = explainedErrorText(output("workspace_locked"), human("codaryn: error\n  remove .codaryn/lock.json\n"));
    assert.equal(already.split("remove .codaryn/lock.json").length - 1, 1);
  });

  test("other codes get nothing added: the renderer writes the doctor hint itself", () => {
    const text = "codaryn: error — no key\n  To fix: run codaryn doctor\n";
    assert.equal(explainedErrorText(output("provider_not_configured"), human(text)), text);
  });
});
