/**
 * The security settings as values (docs/design/standalone-gui.md 6.2, 6.3, 6.7). Kept apart from
 * the Electron calls so unit tests check them without Electron. Names were checked against the
 * type definitions shipped with electron 45.3.1 (electron.d.ts).
 */

/** The window's web preferences. `preload` is the built preload file. */
export function secureWebPreferences(preload: string, devTools: boolean) {
  return {
    preload,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webviewTag: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    spellcheck: false,
    devTools,
    // Not "persist:": the renderer's storage and cache stay in memory.
    partition: SESSION_PARTITION,
  } as const;
}

/** An in-memory session for the window (no `persist:` prefix). */
export const SESSION_PARTITION = "codaryn-gui";

/** Sent with every page and repeated in index.html. */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * Command line switches that open a debugging port or attach an inspector. The app ends at start
 * when it sees one (6.7): Chromium switches are not covered by the fuses.
 */
export const FORBIDDEN_SWITCHES: readonly string[] = [
  "remote-debugging-port",
  "remote-debugging-pipe",
  "remote-debugging-address",
  "remote-allow-origins",
  "inspect",
  "inspect-brk",
  "inspect-port",
  "inspect-publish-uid",
  "debug",
  "debug-brk",
];

/** The first forbidden switch in `argv` (`--name` or `--name=value`, any case), or null. */
export function forbiddenSwitch(argv: readonly string[]): string | null {
  for (const arg of argv) {
    const match = /^--?([A-Za-z-]+)(?:=.*)?$/s.exec(arg);
    if (match === null) continue;
    const name = (match[1] as string).toLowerCase();
    if (FORBIDDEN_SWITCHES.includes(name)) return name;
  }
  return null;
}

/**
 * R-10 L-1: whether debugging was asked for, by a switch on the command line, by NODE_OPTIONS
 * (which Electron's Node reads before any app code), or already happened (the inspector is open).
 * The app ends at its start check when this is not null. Limits: Node opens the inspector port
 * before the check can run, so the port exists for a moment; `--inspect-brk` stops Node before any
 * app code, so only the fuses (6.7, GU-9) refuse it.
 */
export function debuggingRequested(input: {
  readonly argv: readonly string[];
  readonly nodeOptions: string | undefined;
  readonly inspectorUrl: string | undefined;
  readonly hasSwitch: (name: string) => boolean;
}): string | null {
  return (
    forbiddenSwitch(input.argv) ??
    forbiddenSwitch((input.nodeOptions ?? "").split(/\s+/).filter((part) => part.length > 0)) ??
    (input.inspectorUrl !== undefined ? "inspector" : null) ??
    FORBIDDEN_SWITCHES.find((name) => input.hasSwitch(name)) ??
    null
  );
}
