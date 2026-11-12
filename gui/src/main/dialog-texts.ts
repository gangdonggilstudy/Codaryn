/**
 * Texts of the main process's own OS dialogs (docs/design/standalone-gui.md 3.6, 3.8, 3.9, 6.6),
 * in the window's language. The window's catalog lives in the renderer, which the main process
 * does not load; these few dialogs are the main process's to show, so their words are here.
 * Values put in (`{name}`) are counts, run ids and digest prefixes only, never a path or a goal.
 */

export type DialogLanguage = "ko" | "en";

const KO = {
  "closeRun.title": "Codaryn",
  "closeRun.message": "실행 중입니다. 실행을 취소하고 닫을까요?",
  "closeRun.detail": "취소해도 이미 한 변경은 남습니다. 다음에 열 때 실행 목록에서 되돌릴 수 있습니다.",
  "closeRun.cancelAndClose": "취소하고 닫기",
  "closeRun.keep": "계속 실행",
  "closeRun.unknown": "실행이 10초 안에 끝나지 않았습니다. 결과를 알 수 없습니다. 다음에 열 때 실행 목록에서 확인하세요.",
  "ok": "확인",
  "revert.message": "실행 {runId}의 변경을 되돌릴까요?",
  "revert.detail": "되돌릴 파일 {reverted}개, 건너뛸 파일 {skipped}개(미리보기 기준). 미리보기 뒤에 바뀐 파일은 건너뜁니다.",
  "revert.confirm": "되돌리기",
  "revert.keep": "되돌리지 않음",
  "apply.message": "이 계획을 적용할까요? 이동 {moves}개, 보관함으로 {discards}개 (다이제스트 {digest})",
  "apply.detail": "폐기하는 파일은 .codaryn/discarded/<적용 실행 id>/ 보관함으로 옮깁니다. 실행 기록을 정리해도 보관함은 지워지지 않습니다. 계획 뒤에 파일이 바뀌었으면 아무것도 옮기지 않습니다.",
  "apply.confirm": "이 계획 적용",
  "apply.keep": "적용 안 함",
  "consent.message": "이 드라이브는 하드 링크를 쓸 수 없습니다. 이번 적용 한 번에만 동의할까요? (다이제스트 {digest})",
  "consent.detail": "옮기는 도중 같은 이름의 파일이 새로 생기면 그 파일을 덮어쓸 수 있습니다. 동의하지 않으면 아무것도 옮기지 않습니다. 동의는 적용 기록에 남습니다.",
  "consent.agree": "이번 적용에 동의",
  "consent.keep": "동의하지 않음",
} as const;

const EN: { readonly [K in keyof typeof KO]: string } = {
  "closeRun.title": "Codaryn",
  "closeRun.message": "A run is going on. Cancel it and close?",
  "closeRun.detail": "Changes already made stay after a cancel. Next time, the run list can revert them.",
  "closeRun.cancelAndClose": "Cancel and close",
  "closeRun.keep": "Keep running",
  "closeRun.unknown": "The run did not end within 10 seconds. Its result is not known. Check the run list next time.",
  "ok": "OK",
  "revert.message": "Revert the changes of run {runId}?",
  "revert.detail": "{reverted} files to revert, {skipped} to skip (as previewed). Files changed after the preview are skipped.",
  "revert.confirm": "Revert",
  "revert.keep": "Do not revert",
  "apply.message": "Apply this plan? {moves} moves, {discards} to the discard box (digest {digest})",
  "apply.detail": "Discarded files are moved to the discard box .codaryn/discarded/<apply run id>/. Cleaning up the run records does not remove the discard box. If files changed after the plan, nothing is moved.",
  "apply.confirm": "Apply this plan",
  "apply.keep": "Do not apply",
  "consent.message": "This drive cannot use hard links. Agree for this one apply only? (digest {digest})",
  "consent.detail": "If a file with the same name appears while files are moved, it could be replaced. Without your agreement nothing is moved. The agreement is kept in the apply's record.",
  "consent.agree": "Agree for this apply",
  "consent.keep": "Do not agree",
};

export type DialogTextId = keyof typeof KO;

/** The text for `id` in `language`, with `{name}` replaced by the given values. */
export function dialogText(language: DialogLanguage, id: DialogTextId, values: Readonly<Record<string, string | number>> = {}): string {
  const template: string = language === "ko" ? KO[id] : EN[id];
  return template.replace(/\{([a-zA-Z]+)\}/g, (whole, name: string) => (Object.hasOwn(values, name) ? String(values[name]) : whole));
}

export const DIALOG_TEXT_IDS = Object.keys(KO) as DialogTextId[];
export const DIALOG_TEXTS = { ko: KO, en: EN } as const;
