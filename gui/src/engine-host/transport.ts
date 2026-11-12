/**
 * R21-I-3: a transport for tests. With `--transport loopback-only` (given only by the smoke test
 * and the unit tests that start the real engine host; the app's own start never gives it), the
 * engine host hands the app layer this `fetch`: a request to this machine (a loopback address,
 * where the tests' fake API listens) goes through, anything else is refused before any socket or
 * name lookup. So a test can never reach a real API, whatever a config file says. It only takes
 * away; it never lets through what the real `fetch` would not.
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

/** Whether `url` names this machine (a loopback address). Unparsable URLs are not. */
export function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return LOOPBACK_HOSTS.has(host);
  } catch {
    return false;
  }
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** `real` for loopback requests only; any other is refused (and counted) without being sent. */
export function loopbackOnlyFetch(real: typeof fetch, refused: () => void): typeof fetch {
  const guarded = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): ReturnType<typeof fetch> => {
    if (isLoopbackUrl(urlOf(input))) return real(input, init);
    refused();
    return Promise.reject(new TypeError("codaryn test transport: only this machine can be reached"));
  };
  return guarded as typeof fetch;
}
