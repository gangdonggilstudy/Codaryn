/**
 * DR-21: the GUI's consent to unsafe moves, turned into G-A's UnsafeMoveConsent.
 *
 * The person consents on the GUI's screen; its main process puts `unsafeMoveConsent` into the
 * apply request. Here it gets the channel `adapter` (the GUI cannot name `cli-tty` or `cli-flag`)
 * and must name the full digest of the plan being applied. A consent for another plan is refused
 * before anything runs, so the person never believes they consented to an apply the engine then
 * treats as unconsented. The engine checks the digest once more (G-A: a consent for another plan
 * counts as none).
 */

import { CONTENT_HASH_PATTERN_SOURCE, MIN_PLAN_DIGEST_PREFIX } from "../contracts/index.js";
import { appError } from "./errors.js";
import type { UnsafeMoveConsent } from "./general-tasks.js";
import type { AppError, ApplyPlanRequest } from "./types.js";

const CONTENT_HASH = new RegExp(CONTENT_HASH_PATTERN_SOURCE);
const DIGEST_PREFIX = new RegExp(`^[0-9a-f]{${MIN_PLAN_DIGEST_PREFIX},64}$`);

/** The consent the apply passes on, or null for none. Pure. */
export function unsafeMoveConsentOf(
  request: Pick<ApplyPlanRequest, "digest" | "unsafeMoveConsent">,
): { readonly ok: true; readonly consent: UnsafeMoveConsent | null } | { readonly ok: false; readonly error: AppError } {
  const given = request.unsafeMoveConsent;
  if (given === null) return { ok: true, consent: null };
  if (typeof given !== "object" || typeof given.digest !== "string" || !CONTENT_HASH.test(given.digest)) {
    return { ok: false, error: appError("invalid_arguments", "a consent to unsafe moves names the plan's full digest (64 lowercase hex characters); nothing was moved") };
  }
  if (!DIGEST_PREFIX.test(request.digest) || !given.digest.startsWith(request.digest)) {
    return { ok: false, error: appError("invalid_arguments", "the consent to unsafe moves is for another plan than the one applied; nothing was moved") };
  }
  return { ok: true, consent: { channel: "adapter", digest: given.digest } };
}
