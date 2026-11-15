/**
 * Strict API base URL normalization (S-9, H1-4).
 * Rejects anything the URL parser would silently repair or reinterpret, so the address that is
 * checked is the address that is used. The message never repeats the value.
 */

const LOOPBACK_HOSTS: readonly string[] = ["localhost", "127.0.0.1", "[::1]"];

export const API_BASE_URL_STRICT_RULE =
  "must be an https URL (http only on a loopback host) without user info, query, fragment, spaces or backslashes, and must not end with /v1 (the API path is added)";

/**
 * SP-4 (design 4.4): the rule for a provider whose address includes the API version (`with_version`,
 * openai). The adapter adds only the endpoint, so an address that already names one is refused.
 */
export const API_BASE_URL_WITH_VERSION_RULE =
  "must be an https URL (http only on a loopback host) without user info, query, fragment, spaces or backslashes, and must not end with /responses or /models (the endpoint is added)";

/** How an address relates to the API path (ApiProviderSpec.baseUrlPath). */
export type ApiBaseUrlPath = "without_version" | "with_version";

export type ApiBaseUrlOutcome = { readonly ok: true; readonly url: string } | { readonly ok: false; readonly message: string };

/**
 * `field` names the source in the message: "apiBaseUrl", "providers.<name>.apiBaseUrl" or
 * "CODARYN_API_BASE_URL". `pathRule` is the chosen provider's (API_PROVIDERS); the default is
 * anthropic's, the only rule before SP-4.
 */
export function normalizeApiBaseUrlStrict(value: unknown, field: string, pathRule: ApiBaseUrlPath = "without_version"): ApiBaseUrlOutcome {
  const rule = pathRule === "with_version" ? API_BASE_URL_WITH_VERSION_RULE : API_BASE_URL_STRICT_RULE;
  const rejected: ApiBaseUrlOutcome = { ok: false, message: `${field} ${rule}` };
  // `?` and `#` at all: a bare one leaves `search`/`hash` empty but changes the final URL.
  // Control characters, spaces and backslashes: the parser strips or rewrites them.
  if (typeof value !== "string" || value.length === 0 || /[?#\\\u0000- \u007f]/.test(value)) return rejected;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return rejected;
  }
  const secure = url.protocol === "https:";
  const loopback = url.protocol === "http:" && LOOPBACK_HOSTS.includes(url.hostname);
  if (!secure && !loopback) return rejected;
  if (url.username !== "" || url.password !== "") return rejected;
  if (pathRule === "with_version") {
    // The provider appends /responses or /models. A base that already names one would double it.
    if (/\/(responses|models)\/*$/i.test(url.pathname)) return rejected;
  } else if (/\/v1(\/messages)?\/*$/i.test(url.pathname)) {
    // The provider appends /v1/messages. A base that already names the API version would double it.
    return rejected;
  }
  return { ok: true, url: url.href.replace(/\/+$/, "") };
}
