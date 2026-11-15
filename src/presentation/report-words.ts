/** Markdown-specific templates: unlike the single-line catalog, values already carry safe Markdown. */
import type { MessageLanguage } from "../contracts/index.js";
import { KO_MESSAGES } from "../i18n/ko.js";

const KO: Readonly<Record<string, string>> = {
  "none": "없음", "yes": "예", "no": "아니요",
  "at run start": "실행 시작 때", "before verification": "검증 전", "after verification": "검증 후",
  "the run": "실행", "the apply": "적용 실행",
  "# Codaryn run report": "# Codaryn 실행 보고서",
  "# Codaryn apply run report": "# Codaryn 적용 실행 보고서",
  "- Run: {0}": "- 실행: {0}",
  "- Run: {0} (an apply run: no model takes part)": "- 실행: {0} (적용 실행, 모델이 참여하지 않음)",
  "- Task: {0} (task type {1})": "- 작업: {0} (작업 종류 {1})",
  "- Task: {0}": "- 작업: {0}",
  "- Provider: {0}{1}": "- 제공자: {0}{1}",
  " (scripted model; no API was called)": " (대본 모델, API 호출 없음)",
  "- Result: {0} / {1}, exit code {2}": "- 결과: {0} / {1}, 종료 코드 {2}",
  "- Plan run: {0}, digest {1} (this run carried out its approved plan)": "- 계획 실행: {0}, 다이제스트 {1} (이 실행이 승인된 계획을 수행함)",
  "- Result: none. The run has no result.json: it is still running, or it stopped without writing one.": "- 결과: 없음. 실행의 result.json이 없습니다. 아직 실행 중이거나 결과를 쓰지 않고 멈췄습니다.",
  "- Result: none. The apply run has no result.json: it is still running, or it stopped without writing one.": "- 결과: 없음. 적용 실행의 result.json이 없습니다. 아직 실행 중이거나 결과를 쓰지 않고 멈췄습니다.",
  "- The journal has no end record.": "- 실행 기록에 끝 기록이 없습니다.",
  "- The journal's end record: {0} / {1}": "- 실행 기록의 끝 기록: {0} / {1}",
  "- Report: {0} ({1} journal records)": "- 보고서: {0} (실행 기록 {1}건)",
  "This run has a records-changed mark: something other than the run changed its records, so this report may not match what happened.": KO_MESSAGES["report.records_changed"],
  "Repairs started: {0}.": "재수정 시작: {0}회.",
  "## Review checklist": "## 검토 항목",
  "The run waits for a person's verdict ({0}).": "실행이 사람의 판정을 기다립니다({0}).",
  "No verdict yet.": "사람의 판정이 없습니다.",
  "Verdict: **{0}** ({1}){2}": "판정: **{0}** ({1}){2}",
  ", note: {0}": ", 메모: {0}",
  "A later review replaces it: {0}.": "나중의 검토가 이 판정을 바꿉니다: {0}.",
  "## Changes ({0})": "## 변경 ({0}개)",
  "No file tool write was recorded.": "파일 도구가 쓴 기록이 없습니다.",
  "- {0} created ({1})": "- {0} 만듦 ({1})",
  "- {0} changed ({1} -> {2})": "- {0} 바꿈 ({1} -> {2})",
  "## The agent's last message": "## 에이전트의 마지막 답",
  "The agent's last message. These are the agent's own words, not a verified fact.": KO_MESSAGES["report.final_message"],
  "(cut: only the first {0} characters are shown)": "(잘림: 앞 {0}자만 보입니다)",
  "## Usage": "## 사용량",
  "- Model turns: {0} of {1}": "- 모델 턴: {0} / {1}",
  ", failed: {0}": ", 실패: {0}",
  "- Tool calls: {0} of {1} (denied: {2}{3})": "- 도구 호출: {0} / {1} (거부: {2}{3})",
  "not reported by every response": "모든 응답이 알리지는 않음",
  "input {0}, output {1}": "입력 {0}, 출력 {1}",
  "- Tokens: {0} (limit: {1})": "- 토큰: {0} (한도: {1})",
  "- Duration: {0} ms of {1} ms": "- 소요 시간: {0} ms / {1} ms",
  "- Duration limit: {0} ms": "- 시간 한도: {0} ms",
  "- Model requests recorded: {0} (limit {1})": "- 기록된 모델 요청: {0} (한도 {1})",
  "- Denied tool calls: {0}": "- 거부된 도구 호출: {0}",
  "- Failed tool calls: {0}": "- 실패한 도구 호출: {0}",
  "- Repairs: {0}{1}": "- 재수정: {0}{1}", " of {0}": " / {0}",
  "## Not checked": "## 확인하지 않은 범위",
  "- verifier {0}: {1}": "- 검증기 {0}: {1}",
  "## Notices": "## 알림",
  "- Plan: {0} action(s) waiting for approval, digest {1}. See it with {2}.": "- 계획: 동작 {0}개가 승인을 기다립니다. 다이제스트 {1}. {2}로 보세요.",
  "(its report: {0})": "(해당 보고서: {0})",
  "- Plan: {0} action(s), applied by run {1} {2}.": "- 계획: 동작 {0}개를 실행 {1}가 적용했습니다 {2}.",
  "- Plan: {0} action(s); its apply by run {1} did not finish{2} {3}.": "- 계획: 동작 {0}개. 실행 {1}의 적용이 끝나지 않았습니다{2} {3}.",
  "- Plan: {0} action(s); being applied by run {1}, or that apply stopped without a result.": "- 계획: 동작 {0}개. 실행 {1}가 적용 중이거나 결과 없이 멈췄습니다.",
  "- Plan: {0} action(s), applied by run {1}, then reverted {2}.": "- 계획: 동작 {0}개를 실행 {1}가 적용한 뒤 되돌렸습니다 {2}.",
  "- Plan: {0} action(s); taken up by run {1}, whose records cannot be read (removed, or they cannot be checked).": "- 계획: 동작 {0}개. 실행 {1}가 맡았으나 기록을 읽을 수 없습니다(삭제됐거나 확인할 수 없음).",
  "- Plan: {0} file(s) to write, waiting for approval, digest {1}. See it with {2}.": "- 계획: 쓸 파일 {0}개가 승인을 기다립니다. 다이제스트 {1}. {2}로 보세요.",
  "- Plan: {0} file(s) to write, carried out by run {1} {2}.": "- 계획: 파일 {0}개 쓰기를 실행 {1}가 수행했습니다 {2}.",
  "- Plan: {0} file(s) to write; carried out by run {1}, which ended as {2} {3}.": "- 계획: 파일 {0}개 쓰기를 실행 {1}가 수행했고 {2}로 끝났습니다 {3}.",
  "other than done": "완료 이외의 상태",
  "- Plan: {0} file(s) to write; being carried out by run {1}, or that run stopped without a result.": "- 계획: 쓸 파일 {0}개. 실행 {1}가 수행 중이거나 결과 없이 멈췄습니다.",
  "- Plan: {0} file(s) to write, carried out by run {1}, then reverted {2}.": "- 계획: 파일 {0}개 쓰기를 실행 {1}가 수행한 뒤 되돌렸습니다 {2}.",
  "- Plan: {0} file(s) to write; taken up by run {1}, whose records cannot be read (removed, or they cannot be checked).": "- 계획: 쓸 파일 {0}개. 실행 {1}가 맡았으나 기록을 읽을 수 없습니다(삭제됐거나 확인할 수 없음).",
  "- Plan run: {0}, digest {1}": "- 계획 실행: {0}, 다이제스트 {1}",
  "- Approval: {0}; consent to unsafe moves: {1}": "- 승인 경로: {0}; 덮어쓸 위험이 있는 이동에 대한 동의: {1}",
  "## Preflight": "## 사전 확인",
  "The journal has no preflight record: nothing was checked or moved.": "사전 확인 기록이 없습니다. 확인하거나 옮긴 것이 없습니다.",
  "- Actions that could not be applied: {0}": "- 적용할 수 없었던 동작: {0}개",
  "- Workspace too large to check: {0}": "- 작업 공간이 너무 커 확인하지 못함: {0}",
  "- Moves that could only be made without the guarantee (no hard links): {0}": "- 보장 없이만 할 수 있었던 이동(하드 링크 없음): {0}개",
  "move {0} -> {1}{2}": "이동 {0} -> {1}{2}",
  " (moved without the guarantee, with consent)": " (동의를 받아 보장 없이 옮김)",
  "discard {0} (kept as {1})": "폐기 {0} ({1}로 보관)",
  "## Actions ({0} of {1} done)": "## 동작 ({1}개 중 {0}개 완료)",
  "No action was applied.": "적용된 동작이 없습니다.",
  "- action {0}: {1}": "- 동작 {0}: {1}", "- action {0} failed: {1}": "- 동작 {0} 실패: {1}",
  "- {0} action(s) were started with no record that they were done or failed; the revert handles them.": "- 동작 {0}개가 시작됐으나 완료나 실패 기록이 없습니다. 되돌리기에서 처리합니다.",
  "## Undo": "## 되돌리기", "Revert this apply with {0}.": "{0}로 이 적용을 되돌리세요.",
  "## Verification": "## 검증",
  "No verifier result was recorded for the last round.": "마지막 검증 회차의 검증기 결과가 기록되지 않았습니다.",
  "- verifier {0} ({1}): **{2}**": "- 검증기 {0} ({1}): **{2}**",
  "  - checked: {0}": "  - 확인한 것: {0}",
  "## Protected material": "## 보호 대상",
  "Not checked: {0} had no integrity check (nothing was protected, or it ran without the check).": "확인하지 않음: {0}에 무결성 확인이 없었습니다(보호 대상이 없었거나 확인 없이 실행됨).",
  "Checked {0} time(s){1}.": "{0}회 확인했습니다{1}.",
  "No protected path changed since {0} started.": "{0} 시작 뒤 바뀐 보호 경로가 없습니다.",
  "Changed since {0} started, or not checkable:": "{0} 시작 뒤 바뀌었거나 확인할 수 없는 경로:",
  "A pass means the configured verifiers passed. It is not a review of the change.": "통과는 지정한 검증기가 통과했다는 뜻입니다. 변경 내용을 검토했다는 뜻은 아닙니다.",
  "The change list holds file tool writes only. Commands allowed by the policy may have changed other files.": "변경 목록은 파일 도구가 쓴 것만 담습니다. 권한 규칙이 허용한 명령이 다른 파일을 바꿨을 수 있습니다.",
  "There is no OS isolation: allowed commands ran with the user's rights and could reach the network.": "OS 격리가 없습니다. 허용한 명령은 사용자의 권한으로 실행됐으며 네트워크에 접근할 수 있었습니다.",
  "This report reads the run's own records. Commands allowed during the run could have changed them.": "이 보고서는 실행 자체의 기록을 읽습니다. 실행 중 허용한 명령이 그 기록을 바꿨을 수 있습니다.",
  "Masking hides only the values registered for this run and the forms of them it looks for. A secret that was not registered, another form of a value or text in another encoding (such as UTF-16) is not masked.": "가림은 이 실행에 등록한 값과 가림 기능이 찾는 변형만 가립니다. 등록하지 않은 비밀값, 그 밖의 변형, 다른 인코딩(예: UTF-16)의 글은 가리지 않습니다.",
  "A pass means the inventory check and the configured verifiers passed. It is not a review of the plan.": "통과는 파일 목록 확인과 지정한 검증기가 통과했다는 뜻입니다. 계획을 검토했다는 뜻은 아닙니다.",
  "There is no OS isolation: command verifiers ran with the user's rights and could reach the network.": "OS 격리가 없습니다. 명령 검증기는 사용자의 권한으로 실행됐으며 네트워크에 접근할 수 있었습니다.",
  "This report reads the apply run's own records. Commands allowed in other runs could have changed them.": "이 보고서는 적용 실행 자체의 기록을 읽습니다. 다른 실행에서 허용한 명령이 그 기록을 바꿨을 수 있습니다.",
};

export interface ReportWords {
  (parts: TemplateStringsArray, ...values: readonly string[]): string;
  limit(text: string): string;
}

/** Unknown names and non-string entries are never supplied by the object's prototype. */
function ownText(table: object, key: string): string | undefined {
  if (!Object.hasOwn(table, key)) return undefined;
  const value: unknown = (table as Readonly<Record<string, unknown>>)[key];
  return typeof value === "string" ? value : undefined;
}

function labeled(value: string, prefix: "status" | "reason"): string {
  const code = /^`([a-z_-]+)`$/.exec(value)?.[1];
  const id = `${prefix}.${code}`;
  const label = code === undefined ? undefined : ownText(KO_MESSAGES, id);
  return label === undefined ? value : `${label} (${value})`;
}

export function reportWords(language: MessageLanguage): ReportWords {
  return Object.assign((parts: TemplateStringsArray, ...values: readonly string[]): string => {
    const key = parts.reduce((s, part, i) => s + (i === 0 ? "" : `{${i - 1}}`) + part, "");
    if (language === "en") return parts.reduce((s, part, i) => s + (i === 0 ? "" : values[i - 1]) + part, "");
    const shown = [...values];
    if (key === "- Result: {0} / {1}, exit code {2}" || key === "- The journal's end record: {0} / {1}") {
      shown[0] = labeled(shown[0]!, "status"); shown[1] = labeled(shown[1]!, "reason");
    }
    if (key === "- Report: {0} ({1} journal records)") shown[0] = ownText({ complete: "완전 (complete)", incomplete: "불완전 (incomplete)" }, shown[0]!) ?? shown[0]!;
    if (key === "Verdict: **{0}** ({1}){2}") shown[0] = ownText({ accepted: "수락 (accepted)", rejected: "거절 (rejected)" }, shown[0]!) ?? shown[0]!;
    if (key === "- verifier {0} ({1}): **{2}**") shown[2] = ownText({ pass: "통과 (pass)", fail: "실패 (fail)", inconclusive: "판단 불가 (inconclusive)" }, shown[2]!) ?? shown[2]!;
    // Only the fixed template is substituted; inserted model/file text is never reprocessed.
    return (ownText(KO, key) ?? key).replace(/\{(\d+)\}/g, (_match, index: string) => shown[Number(index)]!);
  }, { limit: (text: string) => language === "ko" ? ownText(KO, text) ?? text : text });
}
