/**
 * U-271 (docs/design/standalone-gui.md 3.12): an error card whose fix is done on another screen gets a
 * button to that screen. The screens are fixed by the error's code (the ones its text names); none comes
 * from a reply's words, and a card shown on that screen already gets none for it.
 */

import type { Texts } from "../i18n/catalog.js";
import { button } from "./dom.js";

/** The screens each error's text sends the person to, in the order it names them. */
export const ERROR_MOVES: Readonly<Record<string, readonly string[]>> = {
  settings_unreadable: ["checks"],
  invalid_task: ["checks"],
  provider_not_configured: ["setup", "checks"],
  key_in_file: ["settings"],
  secret_env_missing: ["settings"],
  provider_not_implemented: ["settings"],
  config_exists: ["settings"],
  plan_already_applied: ["runs"],
  plan_not_approved: ["plan"],
};

/** `card` with a button to each screen its error's fix names; none without `show`, or to `here`. */
export function withMoves<E extends HTMLElement>(card: E, t: Texts, code: string, show: ((screen: string) => void) | undefined, here: string): E {
  if (show === undefined || !Object.hasOwn(ERROR_MOVES, code)) return card;
  for (const screen of ERROR_MOVES[code] ?? []) {
    const name = `nav.${screen}`;
    if (screen === here || !t.has(name)) continue;
    card.append(" ", button(t.format("move.toScreen", { screen: t.format(name) }), () => show(screen), { class: "error-move", "data-move": screen }));
  }
  return card;
}
