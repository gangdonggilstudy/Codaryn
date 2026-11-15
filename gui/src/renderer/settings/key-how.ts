/**
 * U-271 (C-23, UXM-13): how to register the key of the provider in use on the operating system the app
 * runs on, as the CLI's init and doctor say it for a terminal (init.key_hint_windows, init.key_hint_posix),
 * for an app that is started again. No value is asked or shown, and no program is started from here.
 */

import type { Texts } from "../i18n/catalog.js";
import { el } from "../shell/dom.js";
import type { SettingsView } from "../../shared/ipc.js";

/** The provider in use (or the default one), its key variable and whether that variable is set. */
export function keyOf(view: SettingsView): { readonly provider: string; readonly keyEnv: string; readonly keySet: boolean } {
  const provider = view.provider ?? view.defaultProvider ?? "-";
  const entry = view.apiProviders.find((item) => item.name === provider);
  return { provider, keyEnv: entry?.keyEnv ?? "-", keySet: entry?.keySet ?? view.keyAvailable };
}

/** The steps for this OS when the key is not set; nothing when it is set or the OS is not known. */
export function keyHowLine(t: Texts, view: SettingsView, id: string): HTMLElement | null {
  const key = keyOf(view);
  const os = view.env.os;
  if (key.keySet || os === undefined) return null;
  return el("p", t.format(os === "windows" ? "key.how.windows" : "key.how.posix", { env: key.keyEnv }), { class: "notice", id, "data-os": os });
}
