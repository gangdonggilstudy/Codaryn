/**
 * Privacy gateway: the single place where text is masked and where restoration is decided.
 * The token table lives in memory for one run and is never written to disk.
 */

import type { JsonObject, MaskedText, RawText } from "./text.js";

export const PRIVACY_ERROR_CODES = [
  "masking_failed",
  "unresolved_token",
  "invalid_token",
  "protected_span_violation",
] as const;
export type PrivacyErrorCode = (typeof PRIVACY_ERROR_CODES)[number];

export type MaskOutcome =
  | { readonly ok: true; readonly text: MaskedText }
  | { readonly ok: false; readonly code: "masking_failed" };

export interface ResolveArgsRequest {
  /** Validated arguments as the model sent them. They may contain tokens. */
  readonly args: JsonObject;
  /** Dot paths the policy allows to be restored for this call. May be empty. */
  readonly restoreFields: readonly string[];
  /** Dot paths that stay masked and are skipped here. */
  readonly documentFields: readonly string[];
}

export type ResolveArgsOutcome =
  | {
      readonly ok: true;
      /** Same shape as the input. Only permitted fields had tokens replaced by their values. */
      readonly args: JsonObject;
      readonly restoredFields: readonly string[];
    }
  | {
      readonly ok: false;
      /**
       * `unresolved_token`: a field outside restoreFields and documentFields still holds a token.
       * `invalid_token`: a token-like fragment that was not issued in this run or was altered.
       */
      readonly code: "unresolved_token" | "invalid_token";
      readonly field: string;
    };

export interface RebuildDocumentRequest {
  /** Current file text, or `null` when the file does not exist yet. */
  readonly original: RawText | null;
  /** Complete next text in masked form, as produced by applying the model's change. */
  readonly maskedNext: string;
}

export type RebuildDocumentOutcome =
  | { readonly ok: true; readonly text: RawText }
  | { readonly ok: false; readonly code: "protected_span_violation" | "invalid_token" };

export interface PrivacyGateway {
  /**
   * Replaces registered secrets and their listed variants with tokens.
   * Masking already masked text leaves its tokens unchanged.
   * On failure nothing may be sent or recorded.
   */
  mask(text: string): MaskOutcome;

  /**
   * Restores tokens only in `restoreFields`. Any token left in a field that needs a real value
   * rejects the whole call. Call this only after the policy accepted the requested call.
   */
  resolveToolArgs(request: ResolveArgsRequest): ResolveArgsOutcome;

  /**
   * Turns a masked next text back into local text.
   * Both `mask(original)` and `maskedNext` are split into lines at LF. The lines that contain a
   * token must be identical in content and order in both: a line holding a secret cannot be
   * changed, moved, duplicated or removed. Lines without a token may be added, removed or changed
   * freely. Protected lines are restored to the original bytes of that line. Any difference in
   * the token lines rejects the whole change with `protected_span_violation`.
   * With `original: null` any token is a violation.
   */
  rebuildDocument(request: RebuildDocumentRequest): RebuildDocumentOutcome;
}

export interface PrivacyGatewayOptions {
  /** Secret values registered for this run. Empty strings are not allowed. */
  readonly secrets: readonly string[];
  /** Random source for token ids. Inject it in tests for determinism. */
  readonly randomBytes?: (size: number) => Uint8Array;
}

/** Signature of `createPrivacyGateway`, exported by `src/privacy/index.ts`. */
export type CreatePrivacyGateway = (options: PrivacyGatewayOptions) => PrivacyGateway;
