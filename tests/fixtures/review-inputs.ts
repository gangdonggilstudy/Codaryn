/**
 * Inputs that cross reviews reproduced with, kept so the cases can be fixed once the code they
 * need is connected (docs/reviews/, decisions N-23 and N-24 in docs/work-orders/phase-4-usability.md).
 * Synthetic values only.
 */

/**
 * R-3 (R3-1, N-24 (a)): a verifier id a person would not want printed. The progress line and the
 * Markdown report must show a sequence number instead; only `--json` keeps the id.
 */
export const SYNTHETIC_VERIFIER_ID = "SYNTHETIC_PRIVATE_VALUE";
/** The R-3 variant with spaces (review H1): the old progress line turned it into `?`, the report did not. */
export const SYNTHETIC_VERIFIER_ID_SPACED = "customer private memo SYNTHETIC";
/** Text no output may contain once N-24 (a) is connected: a piece both ids share. */
export const SYNTHETIC_MARK = "SYNTHETIC";

/**
 * R-2 (M-2, N-23 (b)): a run id from the future. Its time part and the first record's time are
 * the same second, so only the "not in the future" rule can catch it.
 */
export const FORGED_FUTURE_RUN_ID = "20991231T235959Z-deadbeef";
export const FORGED_FUTURE_AT = "2099-12-31T23:59:59.000Z";
/** A run id whose time part disagrees with the first record's time (N-23 (b), other half). */
export const FORGED_MISMATCH_RUN_ID = "20200101T000000Z-0badf00d";
