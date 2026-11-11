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

/** A variable outside CHILD_ENV_ALLOWLIST that must not reach child processes. */
export const PROBE_ENV = "CODARYN_IT_PROBE";
export const PROBE_VALUE = "cdy-probe-not-allowlisted";
