/**
 * The `app://codaryn/` protocol (docs/design/standalone-gui.md 6.3): the window loads only the
 * built renderer files, never `file://`, a server or a remote address.
 */

import { readFile, realpath } from "node:fs/promises";
import { relative, sep } from "node:path";
import { protocol } from "electron";
import type { Session } from "electron";
import { APP_SCHEME, resolveAppUrl } from "./app-url.js";
import { CONTENT_SECURITY_POLICY } from "./security-policy.js";

/** Must run before the app is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false, stream: false } },
  ]);
}

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" } });
}

/** Serves files under `root` (the built renderer) on the session's `app` scheme. */
export function handleAppProtocol(ses: Session, root: string): void {
  let realRoot: Promise<string> | null = null;
  ses.protocol.handle(APP_SCHEME, async (request) => {
    if (request.method !== "GET") return notFound();
    const target = resolveAppUrl(request.url, root);
    if (target === null) return notFound();
    try {
      realRoot ??= realpath(root);
      const base = await realRoot;
      // A link inside the build directory must not lead out of it.
      const real = await realpath(target.file);
      const inside = relative(base, real);
      if (inside.length === 0 || inside.startsWith("..") || inside.split(sep).includes("..")) return notFound();
      const body = await readFile(real);
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": target.type,
          "Content-Security-Policy": CONTENT_SECURITY_POLICY,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
        },
      });
    } catch {
      return notFound();
    }
  });
}
