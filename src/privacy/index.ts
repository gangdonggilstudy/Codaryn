/**
 * Privacy gateway (phase 1a): exact-match masking of registered secrets and their listed
 * variants, token validation, field-scoped restoration and in-place document rebuilding.
 *
 * The table lives in memory for one gateway instance. Its unit is a pair of
 * "matched string" and "token": the raw secret and each listed variant are separate entries.
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

const TOKEN_LENGTH =
  PRIVACY_TOKEN_PREFIX.length + PRIVACY_TOKEN_ID_LENGTH + PRIVACY_TOKEN_SUFFIX.length;
const ID_BYTES = PRIVACY_TOKEN_ID_LENGTH / 2;
const MAX_ID_ATTEMPTS = 8;

/** Raw secret plus its listed variants, without duplicates. Raw comes first. */
function listedForms(secret: string): string[] {
  const bytes = Buffer.from(secret, "utf8");
  const forms = [secret, bytes.toString("base64")];
  try {
    forms.push(encodeURIComponent(secret));
  } catch {
    // A lone surrogate has no URL encoding. The other forms still apply.
  }
  forms.push(JSON.stringify(secret).slice(1, -1));
  const hex = bytes.toString("hex");
  forms.push(hex, hex.toUpperCase());
  return [...new Set(forms)];
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

  /** Matched strings grouped by first code unit, longest first. */
  const formsByFirst = new Map<string, string[]>();
  const known = new Set<string>();
  for (const secret of options.secrets) {
    if (typeof secret !== "string" || secret.length === 0) {
      throw new TypeError("privacy: a registered secret must be a non-empty string");
    }
    for (const form of listedForms(secret)) {
      if (known.has(form)) continue;
      known.add(form);
      const first = form.charAt(0);
      const group = formsByFirst.get(first);
      if (group) group.push(form);
      else formsByFirst.set(first, [form]);
    }
  }
  for (const group of formsByFirst.values()) group.sort((a, b) => b.length - a.length);

  // Tokens are issued on first match, so a random-source failure surfaces inside `mask`.
  const tokenByForm = new Map<string, string>();
  const formByToken = new Map<string, string>();

  const issuedTokenPattern = (): RegExp => new RegExp(PRIVACY_TOKEN_PATTERN_SOURCE, "g");
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
   * One left-to-right pass, leftmost-longest. Tokens issued by this gateway are kept as they are.
   * `spans` maps the offset of each newly written token in the output to the string it replaced.
   */
  function scan(text: string): { masked: string; spans: Map<number, string> } {
    const spans = new Map<number, string>();
    let out = "";
    let plainStart = 0;
    let i = 0;
    while (i < text.length) {
      if (text.startsWith(PRIVACY_TOKEN_PREFIX, i)) {
        const candidate = text.slice(i, i + TOKEN_LENGTH);
        if (formByToken.has(candidate)) {
          i += TOKEN_LENGTH;
          continue;
        }
      }
      const group = formsByFirst.get(text.charAt(i));
      const form = group?.find((candidateForm) => text.startsWith(candidateForm, i));
      if (form === undefined) {
        i += 1;
        continue;
      }
      out += text.slice(plainStart, i);
      spans.set(out.length, form);
      out += tokenFor(form);
      i += form.length;
      plainStart = i;
    }
    out += text.slice(plainStart);
    return { masked: out, spans };
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
      const wellFormed = issuedTokenPattern();
      if (fragmentPattern.test(maskedNext.replace(wellFormed, "\u0000"))) {
        return { ok: false, code: "invalid_token" };
      }

      // Protected spans of the original, in order: token as the model saw it and the local string.
      const originalSpans: { token: string; local: string }[] = [];
      if (request.original !== null) {
        const { masked, spans } = scan(request.original);
        for (const match of masked.matchAll(issuedTokenPattern())) {
          // A token-shaped literal that was already in the file stands for itself.
          originalSpans.push({ token: match[0], local: spans.get(match.index) ?? match[0] });
        }
      }

      const nextTokens = [...maskedNext.matchAll(issuedTokenPattern())];
      const originalTokens = new Set(originalSpans.map((span) => span.token));
      for (const match of nextTokens) {
        if (!formByToken.has(match[0]) && !originalTokens.has(match[0])) {
          return { ok: false, code: "invalid_token" };
        }
      }
      if (
        nextTokens.length !== originalSpans.length ||
        nextTokens.some((match, index) => match[0] !== originalSpans[index]?.token)
      ) {
        return { ok: false, code: "protected_span_violation" };
      }

      let out = "";
      let cursor = 0;
      nextTokens.forEach((match, index) => {
        out += maskedNext.slice(cursor, match.index) + (originalSpans[index]?.local ?? "");
        cursor = match.index + match[0].length;
      });
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
