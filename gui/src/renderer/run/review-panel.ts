/**
 * GU-5 (docs/design/standalone-gui.md 3.7, GT-D6), U-79: the review panel of a run that waits for a
 * person's review. The same panel on the run's result and, later, on the report's review tab:
 * - no default button: the person picks accept or reject; the window asks once more before
 *   recording (a verdict changes no file, so the main process does not ask);
 * - the note is optional and the app layer checks it (S-8);
 * - the app layer's `review` gets the run's own task form (profile, task type).
 */

import type { Texts } from "../i18n/catalog.js";
import { errorText } from "../i18n/catalog.js";
import { asReview } from "../api.js";
import type { CodarynApi, Workspace } from "../api.js";
import { button, el } from "../shell/dom.js";

/** The longest note, in characters (the app layer checks it as well). */
export const MAX_REVIEW_NOTE = 500;

export interface ReviewPanelDeps {
  readonly texts: Texts;
  readonly api: CodarynApi;
  readonly workspace: Workspace;
  readonly runId: string;
  readonly profile: string | null;
  readonly workflow: string | null;
  readonly announce?: (text: string) => void;
}

export function reviewPanel(deps: ReviewPanelDeps, ids: { readonly panel: string; readonly title: string }): HTMLElement {
  const { texts: t, api, workspace, runId } = deps;
  const panel = el("section", undefined, { id: ids.panel, "aria-labelledby": ids.title });
  const note = el("textarea", undefined, { id: "review-note", rows: "3", maxlength: String(MAX_REVIEW_NOTE) });
  const confirm = el("div", undefined, { id: "review-confirm", hidden: "", role: "alertdialog", "aria-labelledby": "review-confirm-text" });
  const outcome = el("div", undefined, { id: "review-outcome", role: "status" });
  let decision: "accept" | "reject" = "accept";
  const confirmText = el("p", "", { id: "review-confirm-text" });
  const keep = button(t.format("review.back"), () => confirm.setAttribute("hidden", ""), { id: "review-back" });
  const ask = (chosen: "accept" | "reject"): void => {
    decision = chosen;
    confirmText.textContent = t.format(chosen === "accept" ? "review.confirmAccept" : "review.confirmReject");
    confirm.removeAttribute("hidden");
    keep.focus();
  };
  const record = button(t.format("review.record"), () => {
    confirm.setAttribute("hidden", "");
    void (async () => {
      const text = note.value.trim();
      const reply = asReview(await api.review(workspace.handle, runId, deps.profile, deps.workflow, decision, text === "" ? null : text));
      if (!reply.ok) {
        outcome.replaceChildren(el("p", `${errorText(t, reply.code)} ${t.format("error.code", { code: reply.code })}`, { "data-error": reply.code }));
        return;
      }
      outcome.replaceChildren(el("p", t.format(reply.verdict === "accepted" ? "review.accepted" : "review.rejected")));
      outcome.setAttribute("data-verdict", reply.verdict);
      deps.announce?.(t.format(reply.verdict === "accepted" ? "review.accepted" : "review.rejected"));
    })();
  }, { id: "review-record" });
  confirm.append(confirmText, keep, record);
  panel.append(
    el("h4", t.format("review.title"), { id: ids.title }),
    el("p", t.format("review.text")),
    el("label", t.format("review.note"), { for: "review-note" }),
    note,
    button(t.format("review.accept"), () => ask("accept"), { id: "review-accept" }),
    button(t.format("review.reject"), () => ask("reject"), { id: "review-reject" }),
    confirm,
    outcome,
  );
  return panel;
}
