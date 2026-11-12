/**
 * The `app://codaryn/` protocol's mapping from a URL to a built renderer file
 * (docs/design/standalone-gui.md 6.3). Pure path logic, so it is tested without Electron. The
 * protocol handler (protocol.ts) also checks that the real path stays under the root.
 */

import { extname, isAbsolute, join, relative, sep } from "node:path";

export const APP_SCHEME = "app";
export const APP_HOST = "codaryn";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_INDEX_URL = `${APP_ORIGIN}/index.html`;

/** The only file types served, with their content types. */
export const SERVED_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const SEGMENT = /^[A-Za-z0-9._-]{1,128}$/;
const MAX_SEGMENTS = 16;

/** Whether a URL belongs to the app's own origin. */
export function isAppUrl(url: string): boolean {
  return url === APP_ORIGIN || url.startsWith(`${APP_ORIGIN}/`);
}

/**
 * The file under `root` that an `app://codaryn/...` GET request names, with its content type.
 * Null for any other scheme or host, user info, a port, a query, encoded or plain `..` or `.`,
 * a segment with characters outside [A-Za-z0-9._-], or a type not in SERVED_TYPES.
 */
export function resolveAppUrl(url: string, root: string): { readonly file: string; readonly type: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${APP_SCHEME}:` || parsed.hostname !== APP_HOST) return null;
  if (parsed.username !== "" || parsed.password !== "" || parsed.port !== "" || parsed.search !== "") return null;
  // The raw path is checked before any decoding: encoded characters are not accepted at all.
  const raw = parsed.pathname === "/" ? "/index.html" : parsed.pathname;
  const segments = raw.split("/").slice(1);
  if (segments.length === 0 || segments.length > MAX_SEGMENTS) return null;
  for (const segment of segments) {
    if (!SEGMENT.test(segment) || segment === "." || segment === "..") return null;
  }
  const type = SERVED_TYPES[extname(segments[segments.length - 1] as string).toLowerCase()];
  if (type === undefined) return null;
  const file = join(root, ...segments);
  const inside = relative(root, file);
  if (inside.length === 0 || inside.startsWith("..") || isAbsolute(inside) || inside.split(sep).includes("..")) return null;
  return { file, type };
}
