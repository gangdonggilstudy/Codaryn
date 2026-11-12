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
