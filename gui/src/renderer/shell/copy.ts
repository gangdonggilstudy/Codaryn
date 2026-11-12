/**
 * U-62 (docs/design/standalone-gui.md 6.4, 2 principle 4): a copy button and its status. The page
 * never writes the clipboard: it asks the main process, which checks the text (one line, length, no
 * control or invisible character) and has the engine host check it for key shapes and key values
 * before it copies. The status says copied, or the code of why not.
 */

import type { Texts } from "../i18n/catalog.js";
import { asCopy } from "../api.js";
import { button, el } from "./dom.js";

export function copyControl(t: Texts, label: string, copy: () => Promise<unknown>, attrs: Readonly<Record<string, string>>): HTMLElement {
  const status = el("span", undefined, { role: "status", class: "copy-status" });
  const control = button(
    label,
    () => {
      void (async () => {
        const reply = asCopy(await copy());
        status.textContent = reply.ok ? t.format("copy.done") : t.format("copy.failed", { code: reply.code });
        status.setAttribute("data-copied", reply.ok ? "ok" : reply.code);
      })();
    },
    { class: "copy", ...attrs },
  );
  const box = el("span", undefined, { class: "copy-box" });
  box.append(control, status);
  return box;
}
