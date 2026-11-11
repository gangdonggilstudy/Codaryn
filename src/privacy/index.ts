/**
 * Privacy gateway (phase 1a): exact-match masking of registered secrets and their listed
 * variants, token validation, field-scoped restoration and in-place document rebuilding.
 *
 * The table lives in memory for one gateway instance. Its unit is a pair of
 * "matched string" and "token": the raw secret, each listed variant, each merged run of
 * overlapping or touching matches, and each pre-existing `CODARYN_SECRET` fragment are
 * separate entries.
 *
 * Rules decided by the PM (C1-F, 2026-11-12):
 * - Tokens already issued by this gateway are recognised first and never cut by a match.
 * - All matches of all entries are merged when they overlap or touch; each merged run is one token.
 * - A `CODARYN_SECRET` fragment (any case) in local text that is not part of an issued token is
 *   itself a protected span. Fragments coming from the model are still `invalid_token`.
 * - `rebuildDocument` splits both masked texts at LF. The lines that hold a token (protected
 *   lines, CR included) must be identical in content and order. Other lines are free.
 */

import { randomBytes as nodeRandomBytes } from "node:crypto";

import type {
  CreatePrivacyGateway,
  MaskOutcome,
  PrivacyGateway,
  RebuildDocumentOutcome,
  RebuildDocumentRequest,
  ResolveArgsOutcome,
  ResolveArgsRequest,
} from "../contracts/privacy.js";
import {
  asRawText,
  PRIVACY_TOKEN_FRAGMENT_PATTERN_SOURCE,
  PRIVACY_TOKEN_ID_LENGTH,
  PRIVACY_TOKEN_PATTERN_SOURCE,
  PRIVACY_TOKEN_PREFIX,
  PRIVACY_TOKEN_SUFFIX,
} from "../contracts/text.js";
import type { JsonObject, JsonValue, MaskedText } from "../contracts/text.js";

const ID_BYTES = PRIVACY_TOKEN_ID_LENGTH / 2;
const MAX_ID_ATTEMPTS = 8;

/** A multi-line secret as given, with LF only and with CRLF only. */
function lineEndingForms(secret: string): string[] {
  if (!secret.includes("\n")) return [secret];
  return [secret, secret.replace(/\r\n/g, "\n"), secret.replace(/\r?\n/g, "\r\n")];
}

/**
 * Raw secret plus its listed variants, without duplicates. Raw comes first.
 * Listed: Base64 and base64url (each padded and unpadded), URL encoding (upper and lower case
 * hex), JSON escape, hex (lower and upper), each also for the LF and CRLF forms of the secret.
 */
function listedForms(secret: string): string[] {
  const forms: string[] = [];
  for (const text of lineEndingForms(secret)) {
    const bytes = Buffer.from(text, "utf8");
    const base64 = bytes.toString("base64");
    const unpadded = base64.replace(/=+$/, "");
    const base64url = bytes.toString("base64url");
    forms.push(text, base64, unpadded, base64url, base64url + base64.slice(unpadded.length));
    try {
      const url = encodeURIComponent(text);
      forms.push(url, url.replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase()));
    } catch {
      // A lone surrogate has no URL encoding. The other forms still apply.
    }
    forms.push(JSON.stringify(text).slice(1, -1));
    const hex = bytes.toString("hex");
    forms.push(hex, hex.toUpperCase());
  }
  return [...new Set(forms)];
}

interface Interval {
  start: number;
  end: number;
}

/** One token of a masked text and the local string it stands for. */
interface MaskedSpan {
  readonly token: string;
  readonly local: string;
}

class TokenScopeError extends Error {
  constructor(
    readonly code: "unresolved_token" | "invalid_token",
    readonly field: string,
  ) {
    super(code);
  }
}

export const createPrivacyGateway: CreatePrivacyGateway = (options) => {
  const randomBytes = options.randomBytes ?? ((size: number) => nodeRandomBytes(size));

  /** Every registered secret and listed variant, without duplicates. */
  const knownForms = new Set<string>();
  for (const secret of options.secrets) {
    if (typeof secret !== "string" || secret.length === 0) {
      throw new TypeError("privacy: a registered secret must be a non-empty string");
    }
    for (const form of listedForms(secret)) knownForms.add(form);
  }
  const forms = [...knownForms];

  // Tokens are issued on first match, so a random-source failure surfaces inside `mask`.
  const tokenByForm = new Map<string, string>();
  const formByToken = new Map<string, string>();

  const issuedTokenPattern = (): RegExp => new RegExp(PRIVACY_TOKEN_PATTERN_SOURCE, "g");
  const tokenInLine = new RegExp(PRIVACY_TOKEN_PATTERN_SOURCE);
  const fragmentPattern = new RegExp(PRIVACY_TOKEN_FRAGMENT_PATTERN_SOURCE, "i");

  function tokenFor(form: string): string {
    const existing = tokenByForm.get(form);
    if (existing !== undefined) return existing;
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
      const bytes = randomBytes(ID_BYTES);
      if (!(bytes instanceof Uint8Array) || bytes.length !== ID_BYTES) {
        throw new Error("privacy: random source returned an unexpected value");
      }
      const token = PRIVACY_TOKEN_PREFIX + Buffer.from(bytes).toString("hex") + PRIVACY_TOKEN_SUFFIX;
      if (formByToken.has(token)) continue;
      tokenByForm.set(form, token);
      formByToken.set(token, form);
      return token;
    }
    throw new Error("privacy: could not issue a unique token id");
  }

  /**
   * Protected intervals inside `[from, to)`: every occurrence of every registered form and every
   * `CODARYN_SECRET` fragment, merged when they overlap or touch. A match that would cross `to`
   * (the start of an issued token) is not taken.
   */
  function protectedIntervals(text: string, from: number, to: number): Interval[] {
    const found: Interval[] = [];
    for (const form of forms) {
      let at = text.indexOf(form, from);
      while (at !== -1 && at + form.length <= to) {
        found.push({ start: at, end: at + form.length });
        at = text.indexOf(form, at + 1);
      }
    }
    const fragment = new RegExp(PRIVACY_TOKEN_FRAGMENT_PATTERN_SOURCE, "gi");
    fragment.lastIndex = from;
    for (let m = fragment.exec(text); m !== null; m = fragment.exec(text)) {
      if (m.index + m[0].length > to) break;
      found.push({ start: m.index, end: m.index + m[0].length });
    }
    found.sort((a, b) => a.start - b.start || b.end - a.end);
    const merged: Interval[] = [];
    for (const interval of found) {
      const last = merged[merged.length - 1];
      if (last !== undefined && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
      else merged.push({ ...interval });
    }
    return merged;
  }

  /**
   * Masks `text` and lists every token of the result in order with the local string it stands
   * for. Issued tokens already in `text` are found first, kept as they are and stand for themselves.
   */
  function scan(text: string): { masked: string; spans: MaskedSpan[] } {
    const spans: MaskedSpan[] = [];
    let out = "";
    let cursor = 0;
    const maskUpTo = (to: number): void => {
      const from = cursor;
      for (const { start, end } of protectedIntervals(text, from, to)) {
        const local = text.slice(start, end);
        const token = tokenFor(local);
        out += text.slice(cursor, start) + token;
        spans.push({ token, local });
        cursor = end;
      }
      out += text.slice(cursor, to);
      cursor = to;
    };
    for (const match of text.matchAll(issuedTokenPattern())) {
      if (!formByToken.has(match[0])) continue;
      maskUpTo(match.index);
      out += match[0];
      spans.push({ token: match[0], local: match[0] });
      cursor = match.index + match[0].length;
    }
    maskUpTo(text.length);
    return { masked: out, spans };
  }

  /** Lines (split at LF, CR kept) that hold at least one well-formed token. */
  function protectedLines(masked: string): string[] {
    return masked.split("\n").filter((line) => tokenInLine.test(line));
  }

  /** Classifies the token content of one string without revealing any value. */
  function inspect(text: string): "none" | "issued" | "invalid" {
    let issued = false;
    const rest = text.replace(issuedTokenPattern(), (token) => {
      if (!formByToken.has(token)) return token;
      issued = true;
      return "\u0000";
    });
    if (fragmentPattern.test(rest)) return "invalid";
    return issued ? "issued" : "none";
  }

  function restoreIssued(text: string): string {
    return text.replace(issuedTokenPattern(), (token) => formByToken.get(token) ?? token);
  }

  function mask(text: string): MaskOutcome {
    try {
      if (typeof text !== "string") return { ok: false, code: "masking_failed" };
      return { ok: true, text: scan(text).masked as MaskedText };
    } catch {
      return { ok: false, code: "masking_failed" };
    }
  }

  function resolveToolArgs(request: ResolveArgsRequest): ResolveArgsOutcome {
    const covers = (fields: readonly string[], path: string): boolean =>
      fields.some((field) => path === field || path.startsWith(`${field}.`));
    const restoredFields: string[] = [];

    const visit = (value: JsonValue, path: string): JsonValue => {
      if (path !== "" && covers(request.documentFields, path)) return value;
      if (typeof value === "string") {
        const state = inspect(value);
        if (state === "invalid") throw new TokenScopeError("invalid_token", path);
        if (state === "none") return value;
        if (!covers(request.restoreFields, path)) throw new TokenScopeError("unresolved_token", path);
        restoredFields.push(path);
        return restoreIssued(value);
      }
      if (value === null || typeof value !== "object") return value;
      const join = (key: string): string => (path === "" ? key : `${path}.${key}`);
      if (Array.isArray(value)) {
        return (value as readonly JsonValue[]).map((item, index) => visit(item, join(String(index))));
      }
      const entries: [string, JsonValue][] = [];
      for (const [key, child] of Object.entries(value as JsonObject)) {
        const childPath = join(key);
        if (!covers(request.documentFields, childPath)) {
          // A key is never restored, so any token in a key rejects the call.
          const keyState = inspect(key);
          if (keyState === "invalid") throw new TokenScopeError("invalid_token", childPath);
          if (keyState === "issued") throw new TokenScopeError("unresolved_token", childPath);
        }
        entries.push([key, visit(child, childPath)]);
      }
      return Object.fromEntries(entries) as JsonObject;
    };

    try {
      const args = visit(request.args, "") as JsonObject;
      return { ok: true, args, restoredFields };
    } catch (error) {
      if (error instanceof TokenScopeError) {
        return { ok: false, code: error.code, field: error.field };
      }
      return { ok: false, code: "invalid_token", field: "" };
    }
  }

  function rebuildDocument(request: RebuildDocumentRequest): RebuildDocumentOutcome {
    try {
      const { maskedNext } = request;
      // Model-side text: every token or fragment must belong to a token issued in this run.
      if (inspect(maskedNext) === "invalid") return { ok: false, code: "invalid_token" };

      // The original as the model saw it, with the local string behind each token in order.
      const original = request.original === null ? { masked: "", spans: [] } : scan(request.original);

      // Protected lines must be identical in content (CR included) and order.
      const before = protectedLines(original.masked);
      const after = protectedLines(maskedNext);
      if (before.length !== after.length || before.some((line, index) => line !== after[index])) {
        return { ok: false, code: "protected_span_violation" };
      }

      // Same protected lines means the same token sequence. Each token takes the local string of
      // the span at the same position, never a lookup by value.
      let out = "";
      let cursor = 0;
      let index = 0;
      for (const match of maskedNext.matchAll(issuedTokenPattern())) {
        const span = original.spans[index];
        if (span === undefined || span.token !== match[0]) {
          return { ok: false, code: "protected_span_violation" };
        }
        out += maskedNext.slice(cursor, match.index) + span.local;
        cursor = match.index + match[0].length;
        index += 1;
      }
      if (index !== original.spans.length) return { ok: false, code: "protected_span_violation" };
      out += maskedNext.slice(cursor);
      return { ok: true, text: asRawText(out) };
    } catch {
      // Fail closed: nothing is rebuilt when the original cannot be scanned.
      return { ok: false, code: "protected_span_violation" };
    }
  }

  const gateway: PrivacyGateway = { mask, resolveToolArgs, rebuildDocument };
  return gateway;
};
