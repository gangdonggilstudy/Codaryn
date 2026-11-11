/**
 * Text and JSON primitives shared by every module.
 *
 * RawText may contain secrets and must stay on the local machine.
 * MaskedText is the only text allowed in model requests, the journal and CLI output.
 */

declare const rawTextBrand: unique symbol;
declare const maskedTextBrand: unique symbol;

/** Local-only text that may contain secrets. Never sent to a model or written to the journal. */
export type RawText = string & { readonly [rawTextBrand]: "raw" };

/**
 * Text that passed the privacy gateway. Obtain it only from `PrivacyGateway.mask`.
 * No other module may cast a string to MaskedText.
 */
export type MaskedText = string & { readonly [maskedTextBrand]: "masked" };

/** Marks locally read content (files, command output, user input) as RawText. */
export function asRawText(text: string): RawText {
  return text as RawText;
}

/** SHA-256 of the exact file bytes, 64 lowercase hex characters. */
export type ContentHash = string;

/** Regular expression source matching a complete ContentHash. */
export const CONTENT_HASH_PATTERN_SOURCE = "^[0-9a-f]{64}$";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/**
 * Privacy token format: `[[CODARYN_SECRET:<16 lowercase hex>]]`.
 * The id is random per run and is never derived from the secret value.
 */
export const PRIVACY_TOKEN_PREFIX = "[[CODARYN_SECRET:";
export const PRIVACY_TOKEN_SUFFIX = "]]";
export const PRIVACY_TOKEN_ID_LENGTH = 16;

/** Regular expression source matching one well-formed token. Compile with the flags you need. */
export const PRIVACY_TOKEN_PATTERN_SOURCE = "\\[\\[CODARYN_SECRET:[0-9a-f]{16}\\]\\]";

/**
 * Regular expression source for token-like fragments (case-insensitive use intended).
 * A fragment that matches this but is not an issued, well-formed token is an invalid token.
 */
export const PRIVACY_TOKEN_FRAGMENT_PATTERN_SOURCE = "CODARYN_SECRET";
