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
  "openTask.title": "실행할 task 파일 고르기",
  "openVars.title": "변수 파일 고르기(취소하면 실행하지 않음)",
  "revert.message": "실행 {runId}의 변경을 되돌릴까요?",
  "revert.detail": "되돌릴 파일 {reverted}개, 건너뛸 파일 {skipped}개(미리보기 기준). 미리보기 뒤에 바뀐 파일은 건너뜁니다.",
  "revert.confirm": "되돌리기",
  "revert.keep": "되돌리지 않음",
  "apply.message": "이 계획을 적용할까요? 이동 {moves}개, 폐기 보관함으로 {discards}개 (다이제스트 {digest})",
  "apply.detail": "폐기하는 파일은 폐기 보관함(.codaryn/discarded/<적용 실행 id>/)으로 옮깁니다. 실행 기록을 정리해도 폐기 보관함은 지워지지 않습니다. 계획 뒤에 파일이 바뀌었으면 아무것도 옮기지 않습니다.",
  "apply.form": "적용할 형식: 프로필 {profile} · 작업 종류 {workflow}",
  "apply.formDefault": "(설정의 기본)",
  "cleanup.message": "정리할까요? 실행 기록 {runs}개({runSize}), 폐기 보관함 {discarded}개, 남은 폴더 {leftovers}개 (다이제스트 {digest})",
  "cleanup.detail": "미리보기에서 본 것만 지웁니다. 그사이 바뀐 항목은 남깁니다. 되돌리기가 제자리에 두지 못한 파일은 지우지 않습니다.",
  "cleanup.discardedLeft": "적용 실행 {count}개는 폐기 보관함에 파일이 있습니다. 같은 정리에서 그 파일도 함께 지우지 않으면 그 실행의 기록은 남깁니다. 파일의 원래 이름과 자리는 이 기록에만 있습니다.",
  "cleanup.confirm": "정리",
  "cleanup.keep": "정리하지 않음",
  "cleanup.notReverted.message": "되돌리지 않았거나, 일부만 되돌렸거나, 기록을 확인할 수 없는 실행 {count}개의 기록도 지울까요?",
  "cleanup.notReverted.detail": "이 기록을 지우면 그 실행이 바꾼 파일을 더는 되돌릴 수 없습니다. 기록을 확인할 수 없는 실행은 되돌렸는지 알 수 없어 같이 묻습니다. 남기면 나머지만 정리합니다.",
  "cleanup.notReverted.confirm": "그 기록도 지움",
  "cleanup.notReverted.keep": "그 기록은 남김",
  "cleanup.discarded.message": "폐기 보관함 {count}개(파일 {files}개, {size})도 지울까요?",
  "cleanup.discarded.detail": "폐기 보관함에는 계획 적용이 치워 둔 사람의 파일이 있습니다. 지우면 영구히 사라지고 되돌릴 수 없습니다.",
  "cleanup.discarded.left": "폐기 보관함을 남기면, 그 폐기 보관함이 딸린 적용 실행 {count}개의 기록은 남깁니다. 파일의 원래 이름과 자리는 그 기록에만 있습니다.",
  "notify.title": "Codaryn",
  "notify.done": "Codaryn 실행이 끝났습니다: {status}",
  "notify.unknown": "Codaryn 실행이 끝났습니다. 결과는 실행 목록에서 확인하세요.",
  "cleanup.discarded.confirm": "폐기 보관함도 지움",
  "cleanup.discarded.keep": "폐기 보관함은 남김",
  "apply.confirm": "이 계획 적용",
  "apply.keep": "적용 안 함",
  "consent.message": "이 드라이브는 하드 링크를 쓸 수 없습니다. 이번 적용 한 번에만 동의할까요? (다이제스트 {digest})",
  "consent.detail": "옮기는 도중 같은 이름의 파일이 새로 생기면 그 파일을 덮어쓸 수 있습니다. 동의하지 않으면 아무것도 옮기지 않습니다. 동의는 적용 기록에 남습니다.",
  "consent.agree": "이번 적용에 동의",
  "consent.keep": "동의하지 않음",
  "revertConsent.message": "이 드라이브는 하드 링크를 쓸 수 없어 파일 {count}개를 되돌리지 못했습니다. 이번 되돌리기 한 번에만 동의할까요? (실행 {runId})",
  "revertConsent.detail": "되돌리는 도중 원래 자리에 같은 이름의 파일이 새로 생기면 그 파일을 덮어쓸 수 있습니다. 동의하지 않으면 아무것도 바뀌지 않습니다. 동의는 되돌리기 기록에 남습니다.",
  // U-124 (3.6, DR-3): the in-run permission question, with the CLI's meaning (confirm.question.command).
  "permission.title": "권한 확인",
  "permission.message": "명령 하나를 이번 호출에만 허용할까요? 답하지 않으면 거부합니다.",
  "permission.detail": "보이는 것은 실행 파일 이름과 인자 개수({count}개)뿐이며, 인자 자체는 보이지 않습니다.\n실행 파일: {subject}",
  "permission.allowOnce": "이번 호출에만 허용",
  "permission.deny": "거부",
  "revertConsent.agree": "이번 되돌리기에 동의",
  "revertConsent.keep": "동의하지 않음",
  "widen.message": "이 설정 변경은 실행이 할 수 있는 일을 넓힙니다. 설정 파일에 쓸까요?",
  "widen.confirm": "쓰기",
  "widen.keep": "쓰지 않음",
} as const;

const EN: { readonly [K in keyof typeof KO]: string } = {
  "closeRun.title": "Codaryn",
  "closeRun.message": "A run is going on. Cancel it and close?",
  "closeRun.detail": "Changes already made stay after a cancel. Next time, the run list can revert them.",
  "closeRun.cancelAndClose": "Cancel and close",
  "closeRun.keep": "Keep running",
  "closeRun.unknown": "The run did not end within 10 seconds. Its result is not known. Check the run list next time.",
  "ok": "OK",
  "openTask.title": "Choose the task file to run",
  "openVars.title": "Choose the variables file (cancel: no run)",
  "revert.message": "Revert the changes of run {runId}?",
  "revert.detail": "{reverted} files to revert, {skipped} to skip (as previewed). Files changed after the preview are skipped.",
  "revert.confirm": "Revert",
  "revert.keep": "Do not revert",
  "apply.message": "Apply this plan? {moves} moves, {discards} to the discarded files (digest {digest})",
  "apply.detail": "Discarded files are moved to the discarded-files folder .codaryn/discarded/<apply run id>/. Cleaning up the run records does not remove them. If files changed after the plan, nothing is moved.",
  "apply.form": "Applied with: profile {profile} · task type {workflow}",
  "apply.formDefault": "(the config's default)",
  "cleanup.message": "Clean up? {runs} run records ({runSize}), {discarded} discarded-files folders, {leftovers} leftover folders (digest {digest})",
  "cleanup.detail": "Only what the preview showed is removed; anything that changed since is kept. Files a revert could not put back are never removed.",
  "cleanup.discardedLeft": "{count} apply runs have discarded files. Their records are kept unless those discarded files are deleted in this cleanup too: only the records say what each file was called and where it was.",
  "cleanup.confirm": "Clean up",
  "cleanup.keep": "Do not clean up",
  "cleanup.notReverted.message": "Also remove the records of {count} runs that were not reverted, only partly, or whose records cannot be checked?",
  "cleanup.notReverted.detail": "Without these records the files those runs changed can no longer be reverted. A run whose records cannot be checked may not have been reverted, so it is asked about here too. If you keep them, only the rest is cleaned up.",
  "cleanup.notReverted.confirm": "Remove those records too",
  "cleanup.notReverted.keep": "Keep those records",
  "cleanup.discarded.message": "Also delete {count} discarded-files folders ({files} files, {size})?",
  "cleanup.discarded.detail": "The discarded files are people's files that a plan's apply set aside. Deleted, they are gone for good and cannot be reverted.",
  "cleanup.discarded.left": "If you keep them, the records of the {count} apply runs they belong to are kept too, since only those records say what each file was called and where it was.",
  "notify.title": "Codaryn",
  "notify.done": "A Codaryn run ended: {status}",
  "notify.unknown": "A Codaryn run ended. See the run list for its result.",
  "cleanup.discarded.confirm": "Delete the discarded files too",
  "cleanup.discarded.keep": "Keep the discarded files",
  "apply.confirm": "Apply this plan",
  "apply.keep": "Do not apply",
  "consent.message": "This drive cannot use hard links. Agree for this one apply only? (digest {digest})",
  "consent.detail": "If a file with the same name appears while files are moved, it could be replaced. Without your agreement nothing is moved. The agreement is kept in the apply's record.",
  "consent.agree": "Agree for this apply",
  "consent.keep": "Do not agree",
  "revertConsent.message": "This drive cannot use hard links, so {count} files were not put back. Agree for this one revert only? (run {runId})",
  "revertConsent.detail": "If a file with the same name appears at the original place meanwhile, it could be replaced. Without your agreement nothing changes. The agreement is kept in the revert's record.",
  "permission.title": "Permission question",
  "permission.message": "Allow a command for this one call? With no answer it is denied.",
  "permission.detail": "Only its executable and its number of arguments ({count}) are shown, not the arguments themselves.\nExecutable: {subject}",
  "permission.allowOnce": "Allow this call only",
  "permission.deny": "Deny",
  "revertConsent.agree": "Agree for this revert",
  "revertConsent.keep": "Do not agree",
  "widen.message": "This settings change lets runs do more. Write it to the config file?",
  "widen.confirm": "Write",
  "widen.keep": "Do not write",
};

export type DialogTextId = keyof typeof KO;

/** The text for `id` in `language`, with `{name}` replaced by the given values. */
export function dialogText(language: DialogLanguage, id: DialogTextId, values: Readonly<Record<string, string | number>> = {}): string {
  const template: string = language === "ko" ? KO[id] : EN[id];
  return template.replace(/\{([a-zA-Z]+)\}/g, (whole, name: string) => (Object.hasOwn(values, name) ? String(values[name]) : whole));
}

export const DIALOG_TEXT_IDS = Object.keys(KO) as DialogTextId[];
export const DIALOG_TEXTS = { ko: KO, en: EN } as const;

/** GU-6: the app layer's widening kinds (SettingsWidening), named in the widening dialog. */
export const WIDENING_KINDS = [
  "command_added",
  "extra_args_allowed",
  "limit_raised",
  "protected_path_removed",
  "integrity_path_removed",
  "secret_env_removed",
  "verifier_removed",
  "verifier_command_added",
  "restore_path_tokens_enabled",
  "plan_action_allowed",
  "api_base_url_changed",
  "provider_changed",
  "profile_changed",
  "workflow_changed",
  "confirm_removed",
  "other",
] as const;

/**
 * U-124: the widening kinds the app layer gives (SettingsWidening) that the dialog can name. A
 * proposal with any other kind is not written: the person could not be told what it widens.
 */
export const KNOWN_WIDENING_KINDS: readonly string[] = WIDENING_KINDS.filter((kind) => kind !== "other");

/** U-124: whether a proposal names a widening the dialog cannot name (then it is not written). */
export function unnamedWidening(widening: readonly { readonly kind: string }[]): boolean {
  return widening.some((item) => !KNOWN_WIDENING_KINDS.includes(item.kind));
}

/**
 * U-124 (3.6, DR-3): the OS dialog of a permission question: the CLI's meaning, the engine's masked
 * executable and the number of arguments only. Deny is the default button and what Esc gives.
 */
export function permissionDialogOptions(
  language: DialogLanguage,
  question: { readonly subject: string; readonly argumentCount: number },
): { readonly type: "question"; readonly title: string; readonly message: string; readonly detail: string; readonly buttons: string[]; readonly defaultId: number; readonly cancelId: number; readonly noLink: true } {
  const deny = 1;
  return {
    type: "question",
    title: dialogText(language, "permission.title"),
    message: dialogText(language, "permission.message"),
    detail: dialogText(language, "permission.detail", { count: question.argumentCount, subject: question.subject }),
    buttons: [dialogText(language, "permission.allowOnce"), dialogText(language, "permission.deny")],
    defaultId: deny,
    cancelId: deny,
    noLink: true,
  };
}

const WIDEN_KO: { readonly [K in (typeof WIDENING_KINDS)[number]]: string } = {
  command_added: "허용 명령 추가",
  extra_args_allowed: "명령 인자를 더 붙이도록 허용",
  limit_raised: "한도 올림",
  protected_path_removed: "보호 경로 뺌",
  integrity_path_removed: "보호 대상 경로 뺌",
  secret_env_removed: "가릴 값 이름 뺌",
  verifier_removed: "검증 뺌",
  verifier_command_added: "명령 검증 추가",
  restore_path_tokens_enabled: "경로의 가린 값 되살리기 켬",
  plan_action_allowed: "계획 동작 허용",
  api_base_url_changed: "API 주소 바꿈",
  provider_changed: "제공자 바꿈(작업 내용이 다른 API로 감)",
  profile_changed: "프로필 바꿈",
  workflow_changed: "작업 종류 정의 바꿈",
  confirm_removed: "묻던 명령을 묻지 않고 허용",
  other: "그 밖의 넓히기",
};

const WIDEN_EN: { readonly [K in (typeof WIDENING_KINDS)[number]]: string } = {
  command_added: "a command allowed",
  extra_args_allowed: "more command arguments allowed",
  limit_raised: "a limit raised",
  protected_path_removed: "a protected path removed",
  integrity_path_removed: "an integrity path removed",
  secret_env_removed: "a secret name removed",
  verifier_removed: "a check removed",
  verifier_command_added: "a command check added",
  restore_path_tokens_enabled: "path tokens restored",
  plan_action_allowed: "a plan action allowed",
  api_base_url_changed: "the API address changed",
  provider_changed: "the provider changed (work goes to another API)",
  profile_changed: "a profile changed",
  workflow_changed: "a task type definition changed",
  confirm_removed: "a command that was asked about runs without asking",
  other: "another widening",
};

/** One widening as the dialog lists it: its kind in words and the field path (never a value). */
export function widenText(language: DialogLanguage, kind: string, field: string): string {
  const table = language === "ko" ? WIDEN_KO : WIDEN_EN;
  const words = Object.hasOwn(table, kind) ? table[kind as keyof typeof table] : table.other;
  return `- ${words} (${field.replace(/[\u0000-\u001f\u007f]/g, "?").slice(0, 200)})`;
}

/**
 * R29-I2: the task form an apply runs with (its policy and checks), from the approval token, as
 * the apply dialog's first detail line. Names are config names; control characters are replaced.
 */
export function applyFormText(language: DialogLanguage, profile: string | null, workflow: string | null): string {
  const name = (value: string | null): string => (value === null ? dialogText(language, "apply.formDefault") : value.replace(/[\u0000-\u001f\u007f]/g, "?").slice(0, 200));
  return dialogText(language, "apply.form", { profile: name(profile), workflow: name(workflow) });
}

/** A size for a dialog: bytes, KB, MB or GB (1024), one decimal above bytes. */
export function formatBytes(language: DialogLanguage, bytes: number): string {
  const units = language === "ko" ? ["바이트", "KB", "MB", "GB"] : ["bytes", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${bytes} ${units[0]}` : `${value.toFixed(1)} ${units[unit]}`;
}

/**
 * R33b-I1: the third cleanup dialog (the discarded files): what deleting means, and, when the plan has
 * apply runs with discarded files (U-13, DR-53), that keeping them (the default) keeps those runs'
 * records too.
 */
export function cleanupDiscardedDetail(language: DialogLanguage, discardedLeft: number): string {
  const lines = [dialogText(language, "cleanup.discarded.detail")];
  if (discardedLeft > 0) lines.push(dialogText(language, "cleanup.discarded.left", { count: discardedLeft }));
  return lines.join("\n");
}

/**
 * 3.6: the end of a run as the OS is told: nothing while the window is active (the window announces
 * it), else one notification with the fixed text and the status word only (6.9: no goal, path or
 * file name). `status` is the shared catalog's word, or null when the end is not known.
 */
export function endNotice(language: DialogLanguage, active: boolean, status: string | null): { readonly title: string; readonly body: string } | null {
  if (active) return null;
  const word = status === null ? null : status.replace(/[\u0000-\u001f\u007f]/g, "?").slice(0, 40);
  return { title: dialogText(language, "notify.title"), body: word === null ? dialogText(language, "notify.unknown") : dialogText(language, "notify.done", { status: word }) };
}
