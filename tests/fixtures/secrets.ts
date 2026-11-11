/**
 * Fake secrets for integration tests. They are deliberately unlike any real key format.
 * Never put real secrets or API keys in fixtures.
 */

export const FAKE_SECRET_ENV_A = "CODARYN_TEST_SECRET";
/** Alphanumeric, so it can also appear in file names. */
export const FAKE_SECRET_A = "cdyFakeCanaryA7Q2xLm9Pz4w";

export const FAKE_SECRET_ENV_B = "CODARYN_TEST_SECRET_B";
/** Contains characters that change under URL encoding and JSON escaping. */
export const FAKE_SECRET_B = 'cdy-fake/B+"q9 canary';

/** Distinctive characters, so any 4-character piece of it is recognisable in outputs. */
export const FRAGMENT_SECRET = "zqv8Kx7Wv2Lp9HnRt4Ym3";

/** Contains a double quote, so its JSON-escaped form differs from the raw value. */
export const JSON_QUOTE_SECRET = 'cdyJson"Q7-canary';

/** Two secrets that overlap: the end of the first ("Rz8") is the start of the second. */
export const OVERLAP_SECRET_FIRST = "ovlpAlphaQm4Rz8";
export const OVERLAP_SECRET_SECOND = "Rz8BetaTn6Wq2";

/**
 * Its Base64 has "+" and "=" padding and its URL encoding has hex letters, so unpadded Base64,
 * base64url and lowercase percent encoding all differ from the listed forms.
 */
export const VARIANT_SECRET = "cdyVar/?>cdycdycdyKx";

/** A variable outside CHILD_ENV_ALLOWLIST that must not reach child processes. */
export const PROBE_ENV = "CODARYN_IT_PROBE";
export const PROBE_VALUE = "cdy-probe-not-allowlisted";
