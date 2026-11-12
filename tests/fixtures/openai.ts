/**
 * Values for mock API tests of the second provider, OpenAI (docs/design/second-provider.md, DR-31).
 * Shapes and names follow docs/design/second-provider-facts.md; each constant names its item (C-n).
 * These are the facts as the fake server enforces them, kept apart from the product contract on
 * purpose; o00 checks that the two agree where both say something (minimum output tokens, the
 * address with `/v1`). Key names and shapes come from the contract (SP-1: OPENAI_API_KEY_ENV,
 * API_KEY_ENVS, API_KEY_PATTERN_SOURCES, API_KEY_MASK_PATTERN_SOURCES).
 * Mock API verification only, not the real API. Task and config writers wait for SP-4's schema.
 */

/** C-4: paths below the base address, which itself ends with `/v1`. */
export const OPENAI_VERSION_PATH = "/v1";
export const OPENAI_RESPONSES_PATH = "/v1/responses";
export const OPENAI_MODELS_PATH = "/v1/models";

/** C-10: the smallest `max_output_tokens` the API takes. */
export const MIN_MAX_OUTPUT_TOKENS = 16;

/** C-10: response `status` values. */
export const RESPONSE_STATUSES = ["completed", "failed", "in_progress", "cancelled", "queued", "incomplete"] as const;
export type ResponseStatus = (typeof RESPONSE_STATUSES)[number];

/** C-10: `incomplete_details.reason` values. */
export const INCOMPLETE_REASONS = ["max_output_tokens", "max_messages", "content_filter", "steered"] as const;
export type IncompleteReason = (typeof INCOMPLETE_REASONS)[number];

/** C-5: error statuses the API documents. */
export const OPENAI_ERROR_STATUSES = [400, 401, 403, 404, 409, 413, 422, 429, 500, 503] as const;

/** C-5: a 429 that can be retried: this type with code `slow_down`, or no code at all. */
export const RATE_LIMIT_TYPE = "rate_limit_error";
export const RATE_LIMIT_CODE = "slow_down";

/**
 * C-5, SP-D7: a 429 that retrying does not fix (quota_exhausted). The type, each of the four codes,
 * and the older code the design also matches ([미확인] in the facts, matched to be safe).
 */
export const QUOTA_TYPE = "insufficient_quota";
export const QUOTA_CODES = [
  "credit_balance_exhausted",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
] as const;
export const LEGACY_QUOTA_CODE = "insufficient_quota";

/** One 429 body per way the API reports an exhausted quota (OI-32). */
export interface QuotaCase {
  readonly label: string;
  readonly type: string;
  readonly code: string | null;
}
export const QUOTA_CASES: readonly QuotaCase[] = [
  { label: "type insufficient_quota", type: QUOTA_TYPE, code: null },
  ...QUOTA_CODES.map((code) => ({ label: `code ${code}`, type: "invalid_request_error", code })),
  { label: "older code insufficient_quota", type: "invalid_request_error", code: LEGACY_QUOTA_CODE },
];

/** C-7, DR-31 (d): tool names stay inside this pattern. */
export const OPENAI_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Opaque stand-in for a reasoning item's `encrypted_content` (C-11). It may appear only in request
 * bodies sent back to the fake server within the same run, never in a record, result or output.
 */
export const FAKE_ENCRYPTED_CONTENT = "cdyEncReasoning-Gx7Vq2Lm9Tz4Wn8";

/** Call ids the fake server hands out. C-8: their format and length are not documented. */
export const CALL_ID_PLAIN = "call_cdy01";
/** DR-31 (e): longer than CALL_ID_PATTERN_SOURCE allows (64), so the engine records another id. */
export const CALL_ID_LONG = `call_${"q7".repeat(47)}x`;
/** DR-31 (e): characters outside CALL_ID_PATTERN_SOURCE. */
export const CALL_ID_ODD = "call:a/b+c=";

/** A model the fake catalog lists (C-12). Unix seconds; `shutdown_date` is optional. */
export interface FakeOpenAIModel {
  readonly id: string;
  readonly created: number;
  readonly owned_by: string;
  readonly shutdown_date?: string;
}

/**
 * Prefix of every listed id. Every fake key starts with "cdy-fake" (eight characters), and a
 * listing refuses ids that share eight characters with the key (y01), so listed ids must not.
 */
export const LISTED_OPENAI_MODEL_PREFIX = "cdy-listed-oai-";

/** 2026-01-01T00:00:00Z and 2026-06-01T00:00:00Z as Unix seconds. */
export const CREATED_2026_01_01 = 1_767_225_600;
export const CREATED_2026_06_01 = 1_780_272_000;

export const FAKE_OPENAI_MODEL_CATALOG: readonly FakeOpenAIModel[] = [
  { id: `${LISTED_OPENAI_MODEL_PREFIX}alpha`, created: CREATED_2026_01_01, owned_by: "cdy-owner" },
  { id: `${LISTED_OPENAI_MODEL_PREFIX}beta`, created: CREATED_2026_06_01, owned_by: "cdy-owner", shutdown_date: "2027-04-01" },
  { id: `${LISTED_OPENAI_MODEL_PREFIX}gamma`, created: CREATED_2026_06_01, owned_by: "system" },
];

/**
 * A value with an OpenAI key shape, built at run time so no source file holds the shape (the commit
 * hook would flag it). Key-shape cases only: such a value must never reach a server.
 * - `refused`: the narrow shape that refuses a run (contract OPENAI_KEY_PATTERN_SOURCE, DR-32 (a)):
 *   `sk-`, then 40 characters with a digit and an upper-case letter.
 * - `masked_only`: the loose shape only (OPENAI_KEY_LOOSE_PATTERN_SOURCE): 40 lower-case letters
 *   after `sk-`, hidden in output but never a reason to refuse.
 */
export function skShapedValue(tag: string, kind: "refused" | "masked_only" = "refused"): string {
  if (!/^[A-Za-z]{1,16}$/.test(tag)) throw new Error("tag must be 1 to 16 letters");
  const body = kind === "refused" ? `cdyShape7${tag}`.padEnd(40, "Q") : `cdyshape${tag.toLowerCase()}`.padEnd(40, "q");
  return ["s", "k-"].join("") + body;
}

/** The loose shape the guard in cliEnv refuses for a fake key (anything starting with `sk-`). */
export const LOOSE_SK_SHAPE = /(^|[^A-Za-z0-9])sk-/;
