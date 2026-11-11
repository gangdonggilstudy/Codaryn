/**
 * Small contract stand-ins for the tool runner tests (PM decision P-5).
 * They sit only at the contract boundary: Workspace, PrivacyGateway and CommandRunner.
 */

import { createHash } from "node:crypto";

import { PRIVACY_TOKEN_PATTERN_SOURCE } from "../../../src/contracts/index.js";
import type {
  ListEntry,
  MaskedText,
  PathAccess,
  PrivacyGateway,
  RawText,
  ResolvedPath,
  RunCommandPayload,
  Workspace,
  WriteTextRequest,
} from "../../../src/contracts/index.js";
import type { CommandRunner, CommandRunRequest } from "../../../src/tools/index.js";

/** Fake secrets. They do not look like any real key format. */
export const FAKE_SECRET_A = "fake-secret-값-ALPHA";
export const FAKE_SECRET_B = "fake-secret-값-BRAVO";
export const TOKEN_A = "[[CODARYN_SECRET:00000000000000a1]]";
export const TOKEN_B = "[[CODARYN_SECRET:00000000000000b2]]";
/** Well-formed, but never issued by the fake gateway. */
export const TOKEN_UNKNOWN = "[[CODARYN_SECRET:ffffffffffffffff]]";

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function utf8(text: string): Buffer {
  return Buffer.from(text, "utf8");
}

export interface FakePrivacy extends PrivacyGateway {
  failMask: boolean;
}

export function createFakePrivacy(): FakePrivacy {
  const table = new Map<string, string>([
    [TOKEN_A, FAKE_SECRET_A],
    [TOKEN_B, FAKE_SECRET_B],
  ]);
  const maskText = (text: string): string => {
    let out = text;
    for (const [token, secret] of table) out = out.split(secret).join(token);
    return out;
  };
  const tokensOf = (text: string): string[] =>
    text.match(new RegExp(PRIVACY_TOKEN_PATTERN_SOURCE, "g")) ?? [];

  const gateway: FakePrivacy = {
    failMask: false,
    mask(text) {
      if (gateway.failMask) return { ok: false, code: "masking_failed" };
      return { ok: true, text: maskText(text) as MaskedText };
    },
    resolveToolArgs(request) {
      return { ok: true, args: request.args, restoredFields: [] };
    },
    rebuildDocument(request) {
      const next = tokensOf(request.maskedNext);
      if (next.some((token) => !table.has(token))) return { ok: false, code: "invalid_token" };
      const expected = request.original === null ? [] : tokensOf(maskText(request.original));
      if (next.length !== expected.length || next.some((token, i) => token !== expected[i])) {
        return { ok: false, code: "protected_span_violation" };
      }
      let text = request.maskedNext;
      for (const [token, secret] of table) text = text.split(token).join(secret);
      return { ok: true, text: text as RawText };
    },
  };
  return gateway;
}

export interface FakeWorkspace extends Workspace {
  /** File bytes by root-relative path. */
  readonly files: Map<string, Buffer>;
  readonly resolveCalls: { path: string; access: PathAccess }[];
  readonly readCalls: string[];
  readonly writeRequests: WriteTextRequest[];
  /** Runs right before the version check of `writeText`, to simulate a concurrent change. */
  beforeWrite: (() => void) | null;
  listTruncated: boolean;
}

export function createFakeWorkspace(initial: Record<string, string | Buffer> = {}): FakeWorkspace {
  const root = "/fake-root";
  const files = new Map<string, Buffer>();
  for (const [name, content] of Object.entries(initial)) {
    files.set(name, typeof content === "string" ? utf8(content) : content);
  }
  const toResolved = (relative: string): ResolvedPath =>
    ({ absolute: relative === "." ? root : `${root}/${relative}`, relative }) as ResolvedPath;

  const workspace: FakeWorkspace = {
    root,
    files,
    resolveCalls: [],
    readCalls: [],
    writeRequests: [],
    beforeWrite: null,
    listTruncated: false,

    async resolve(path, access) {
      workspace.resolveCalls.push({ path, access });
      const parts = path.split(/[\\/]/).filter((part) => part !== "" && part !== ".");
      if (parts.includes("..")) return { ok: false, code: "outside_root" };
      if (parts[0] === ".codaryn") return { ok: false, code: "state_dir" };
      return { ok: true, path: toResolved(parts.length === 0 ? "." : parts.join("/")) };
    },

    async readText(path) {
      workspace.readCalls.push(path.relative);
      const bytes = files.get(path.relative);
      if (bytes === undefined) return { ok: false, code: "not_found" };
      if (bytes.includes(0)) return { ok: false, code: "not_text" };
      return {
        ok: true,
        snapshot: { path, hash: sha256(bytes), text: bytes.toString("utf8") as RawText },
      };
    },

    async list(dir) {
      const prefix = dir.relative === "." ? "" : `${dir.relative}/`;
      const seen = new Map<string, ListEntry>();
      for (const name of files.keys()) {
        if (!name.startsWith(prefix)) continue;
        const parts = name.split("/");
        for (let depth = prefix.split("/").length; depth < parts.length; depth += 1) {
          const dirName = parts.slice(0, depth).join("/");
          seen.set(dirName, { relative: dirName, kind: "dir" });
        }
        seen.set(name, { relative: name, kind: "file" });
      }
      const entries = [...seen.values()].sort((a, b) =>
        a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0,
      );
      return { ok: true, entries, truncated: workspace.listTruncated };
    },

    async writeText(request) {
      workspace.writeRequests.push(request);
      workspace.beforeWrite?.();
      const current = files.get(request.path.relative);
      const currentHash = current === undefined ? null : sha256(current);
      if (currentHash !== request.expectedHash) return { ok: false, code: "conflict", currentHash };
      const bytes = utf8(request.text);
      files.set(request.path.relative, bytes);
      return {
        ok: true,
        previousHash: currentHash,
        newHash: sha256(bytes),
        created: current === undefined,
      };
    },
  };
  return workspace;
}

export interface FakeCommandRunner extends CommandRunner {
  readonly requests: CommandRunRequest[];
}

export function createFakeCommandRunner(
  respond: (
    request: CommandRunRequest,
    signal: AbortSignal,
  ) => Promise<RunCommandPayload | { spawnFailed: true; message: string }>,
): FakeCommandRunner {
  const runner: FakeCommandRunner = {
    requests: [],
    run(request, signal) {
      runner.requests.push(request);
      return respond(request, signal);
    },
  };
  return runner;
}

export const OK_PAYLOAD: RunCommandPayload = {
  exitCode: 0,
  stdout: "out",
  stderr: "",
  timedOut: false,
  truncated: false,
};
