/**
 * CRLF, BOM and Korean paths and content keep their bytes (testing.md T9, contract section 7).
 * Fixture bytes are generated here so Git line ending conversion cannot change them.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { ReadFilePayload } from "../../src/contracts/index.js";
import { createSandbox, withBom, writeTask, writeWorkspaceFile } from "../fixtures/builders.js";
import { expectRunResult, payloadOf, readRunFiles, runTask, sha256Hex, toolResultFor } from "../support/cli.js";

const KO_PATH = "문서/한글 파일.md";
const KO_TEXT = "제목\r\n본문 한글\r\n끝\r\n";
const CRLF_TEXT = "a\r\nb\r\nc\r\n";
const BOM_OLD = "old\r\n";

test("CRLF, BOM and Korean bytes are preserved", { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  const koBytes = withBom(KO_TEXT);
  const bomBytes = withBom(BOM_OLD);
  writeWorkspaceFile(sb, KO_PATH, koBytes);
  writeWorkspaceFile(sb, "crlf.txt", CRLF_TEXT);
  writeWorkspaceFile(sb, "bom-all.txt", bomBytes);

  const taskPath = writeTask(
    sb,
    {
      id: "encoding",
      workflow: "document",
      verifiers: [{ id: "ko", kind: "file_rules", rules: [{ type: "contains", path: KO_PATH, text: "본문 수정" }] }],
    },
    [
      { toolCalls: [{ id: "r1", name: "read_file", args: { path: KO_PATH } }] },
      {
        toolCalls: [
          {
            id: "w-ko",
            name: "write_file",
            args: {
              path: KO_PATH,
              expectedHash: sha256Hex(koBytes),
              change: { kind: "replace_text", oldText: "본문 한글", newText: "본문 수정" },
            },
          },
          {
            id: "w-crlf",
            name: "write_file",
            args: {
              path: "crlf.txt",
              expectedHash: sha256Hex(CRLF_TEXT),
              change: { kind: "replace_text", oldText: "b", newText: "B" },
            },
          },
          {
            id: "w-bom-all",
            name: "write_file",
            args: {
              path: "bom-all.txt",
              expectedHash: sha256Hex(bomBytes),
              change: { kind: "replace_all", content: "새 내용\r\n" },
            },
          },
        ],
      },
      { text: "끝" },
    ],
  );

  const run = await runTask(taskPath, { cwd: sb.base });
  const result = expectRunResult(run);
  const { records } = readRunFiles(sb.workspace, result);

  await t.test("read_file hides the BOM and reports it", () => {
    const payload = payloadOf<ReadFilePayload>(toolResultFor(records, "r1"));
    assert.equal(payload.hadBom, true);
    assert.equal(payload.content, KO_TEXT);
    assert.equal(payload.hash, sha256Hex(koBytes), "hash is over the exact file bytes, BOM included");
  });

  await t.test("replace_text keeps BOM, CRLF and Korean bytes", () => {
    assert.equal(toolResultFor(records, "w-ko").ok, true);
    assert.deepEqual(readFileSync(join(sb.workspace, "문서", "한글 파일.md")), withBom("제목\r\n본문 수정\r\n끝\r\n"));
  });

  await t.test("replace_text keeps CRLF in a file without BOM", () => {
    assert.equal(toolResultFor(records, "w-crlf").ok, true);
    assert.deepEqual(readFileSync(join(sb.workspace, "crlf.txt")), Buffer.from("a\r\nB\r\nc\r\n", "utf8"));
  });

  await t.test("replace_all on a BOM file re-attaches the BOM and keeps the given line endings", () => {
    assert.equal(toolResultFor(records, "w-bom-all").ok, true);
    assert.deepEqual(readFileSync(join(sb.workspace, "bom-all.txt")), withBom("새 내용\r\n"));
  });

  await t.test("run ends verified", () => {
    assert.equal(result.status, "done");
    assert.equal(result.changes.length, 3);
  });
});
