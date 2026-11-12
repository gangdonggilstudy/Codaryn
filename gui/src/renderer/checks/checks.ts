/**
 * The checks screen: the engine's `doctor` for the open workspace (or none), as GU-1 showed it.
 * Status words come first; check names and status words come from the shared catalog when it
 * has them (labels), else from the GUI's own words.
 */

import type { Texts } from "../i18n/catalog.js";
import { errorText } from "../i18n/catalog.js";
import { asDoctor } from "../api.js";
import type { CodarynApi, Workspace } from "../api.js";
import type { DoctorReply } from "../../shared/ipc.js";
import { button, el } from "../shell/dom.js";
import type { Screen } from "../shell/shell.js";

export interface ChecksDeps {
  readonly texts: Texts;
  readonly api: CodarynApi;
  readonly current: () => Workspace | null;
  readonly announce: (text: string) => void;
}

export function checksScreen(deps: ChecksDeps): Screen {
  const { texts: t, api } = deps;
  return {
    id: "checks",
    title: "nav.checks",
    show(root) {
      const results = el("section", undefined, { "aria-labelledby": "checks-title", id: "checks" });
      const run = async (): Promise<void> => {
        results.removeAttribute("data-doctor-ready");
        results.replaceChildren(el("p", t.format("checks.checking")));
        const workspace = deps.current();
        const reply = asDoctor(await api.doctor(workspace?.handle ?? null));
        if (!reply.ok) {
          const box = el("div", undefined, { role: "alert", class: "error", "data-error": reply.code });
          box.append(el("h3", t.format("error.title")), el("p", errorText(t, reply.code)), el("p", t.format("error.code", { code: reply.code }), { class: "code", lang: "en" }));
          results.replaceChildren(box);
          results.setAttribute("data-doctor-ready", "error");
          deps.announce(t.format("error.title"));
          return;
        }
        const [scope, overall, list] = doctorParts(t, reply);
        results.replaceChildren(scope, overall, list);
        results.setAttribute("data-doctor-ready", "ok");
        deps.announce(overall.textContent ?? "");
      };
      const head = el("div", undefined, { class: "screen-head" });
      head.append(el("h2", t.format("checks.title"), { id: "checks-title" }), button(t.format("checks.again"), () => void run(), { id: "checks-again" }));
      root.replaceChildren(head, results);
      void run();
    },
  };
}

/** The checks as the window shows them: the scope, the overall status in words, one line per check. Also the first-run guide's last page. */
export function doctorParts(t: Texts, reply: Extract<DoctorReply, { ok: true }>): [HTMLElement, HTMLElement, HTMLElement] {
  const word = (status: string): string => {
    const shared = reply.labels[`doctor.status.${status}`];
    if (shared !== undefined) return shared;
    const own = `status.${status}`;
    return t.has(own) ? t.format(own) : status;
  };
  const scope = el("p", reply.workspaceName === null ? t.format("checks.noWorkspace") : t.format("checks.workspace", { name: reply.workspaceName }));
  const overall = el("p", t.format("checks.overall", { status: word(reply.view.status) }), { class: "overall", "data-status": reply.view.status });
  const list = el("ul", undefined, { class: "checks" });
  for (const check of reply.view.checks) {
    const item = el("li", undefined, { "data-status": check.status, "data-check": check.id });
    item.append(
      el("span", word(check.status), { class: "status" }),
      el("span", reply.labels[`doctor.check.${check.id}`] ?? check.id, { class: "label" }),
      el("span", check.message, { class: "detail", lang: "en", title: t.format("checks.detailInEnglish") }),
    );
    list.append(item);
  }
  return [scope, overall, list];
}
