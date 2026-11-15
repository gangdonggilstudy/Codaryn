/**
 * Applies the security settings (docs/design/standalone-gui.md 6.2, 6.3): every permission is
 * refused, every request outside `app://codaryn/` is cancelled, no navigation, no new window, no
 * webview, no download, no spellchecker. Applied to the default session too, which no window uses
 * but which Chromium starts anyway.
 */

import type { Session, WebContents } from "electron";
import { isAppUrl } from "./app-url.js";

export function secureSession(ses: Session): void {
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  // Chromium's spellchecker downloads dictionaries from a remote server: Electron 45.3.1 fetched an
  // 11 MB Korean dictionary for a plain window (seen 2026-11-12). Off, no languages, and a download
  // address that can never load (the app protocol serves no .bdic).
  ses.setSpellCheckerEnabled(false);
  try {
    ses.setSpellCheckerLanguages([]);
  } catch {
    // Not supported on this platform; the checker stays off.
  }
  ses.setSpellCheckerDictionaryDownloadURL("app://codaryn/no-dictionaries/");
  ses.webRequest.onBeforeRequest((details, callback) => {
    // devtools:// is the development tools' own page; the tools are off in packaged builds.
    callback({ cancel: !(isAppUrl(details.url) || details.url.startsWith("devtools://")) });
  });
  ses.on("will-download", (event) => event.preventDefault());
}

/** For every web contents the app creates (`web-contents-created`). */
export function guardContents(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => event.preventDefault());
  // loadURL does not ask; navigation the page or a person starts in any frame is refused.
  contents.on("will-frame-navigate", (event) => event.preventDefault());
  contents.on("will-redirect", (event) => event.preventDefault());
  contents.on("will-attach-webview", (event) => event.preventDefault());
}
