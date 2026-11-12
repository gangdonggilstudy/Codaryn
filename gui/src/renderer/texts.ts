/**
 * GUI-only texts (docs/design/standalone-gui.md 11, GUI-D21). Texts with the same meaning as the
 * CLI's (check names, status words) come from the shared catalog through the engine host; these
 * are the window's own words. Fixed text only: no value is put into a text.
 */

export type Language = "ko" | "en";

export interface GuiTexts {
  readonly appTitle: string;
  readonly openWorkspace: string;
  readonly workspaceNone: string;
  readonly workspaceLabel: string;
  readonly checksTitle: string;
  readonly checking: string;
  readonly overall: string;
  readonly detailInEnglish: string;
  readonly statusFallback: Readonly<Record<string, string>>;
  readonly errorTitle: string;
  readonly errors: Readonly<Record<string, string>>;
  readonly errorDefault: string;
}

const KO: GuiTexts = {
  appTitle: "Codaryn",
  openWorkspace: "작업 공간 열기…",
  workspaceNone: "작업 공간을 열지 않았습니다. 설정과 환경만 점검합니다.",
  workspaceLabel: "작업 공간",
  checksTitle: "점검",
  checking: "점검 중…",
  overall: "전체 상태",
  detailInEnglish: "세부(영어)",
  statusFallback: { ok: "정상", warn: "주의", fail: "실패", skipped: "건너뜀" },
  errorTitle: "점검을 보여 줄 수 없습니다",
  errors: {
    node_not_found: "Node 26 이상을 찾지 못했습니다. Node 26 이상을 설치한 뒤 앱을 다시 시작하세요.",
    node_too_old: "엔진은 Node 26 이상에서만 실행됩니다. Node를 새 판으로 바꾼 뒤 앱을 다시 시작하세요.",
    engine_not_built: "엔진이 빌드되지 않았습니다. 저장소 루트에서 npm run build를 실행하세요.",
    host_not_started: "엔진 프로세스를 시작하지 못했습니다.",
    ready_timeout: "엔진 프로세스가 제시간에 준비되지 않았습니다.",
    protocol_violation: "엔진 프로세스와의 통신 형식이 맞지 않아 멈췄습니다.",
    host_exited: "엔진 프로세스가 끝났습니다. 앱을 다시 시작하세요.",
    adapter_host_exited: "엔진 프로세스가 끝났습니다. 앱을 다시 시작하세요.",
    adapter_timeout: "엔진 프로세스가 제시간에 답하지 않았습니다.",
    unknown_workspace: "작업 공간을 다시 여세요.",
  },
  errorDefault: "점검을 실행하지 못했습니다.",
};

const EN: GuiTexts = {
  appTitle: "Codaryn",
  openWorkspace: "Open workspace…",
  workspaceNone: "No workspace is open. Only the settings and the environment are checked.",
  workspaceLabel: "Workspace",
  checksTitle: "Checks",
  checking: "Checking…",
  overall: "Overall",
  detailInEnglish: "Detail (English)",
  statusFallback: { ok: "OK", warn: "Warning", fail: "Failed", skipped: "Skipped" },
  errorTitle: "The checks cannot be shown",
  errors: {
    node_not_found: "Node 26 or later was not found. Install Node 26 or later and start the app again.",
    node_too_old: "The engine runs on Node 26 or later only. Update Node and start the app again.",
    engine_not_built: "The engine is not built. Run npm run build in the repository root.",
    host_not_started: "The engine process could not be started.",
    ready_timeout: "The engine process was not ready in time.",
    protocol_violation: "The engine process broke the message format and was stopped.",
    host_exited: "The engine process has ended. Start the app again.",
    adapter_host_exited: "The engine process has ended. Start the app again.",
    adapter_timeout: "The engine process did not answer in time.",
    unknown_workspace: "Open the workspace again.",
  },
  errorDefault: "The checks could not be run.",
};

export function textsFor(language: Language): GuiTexts {
  return language === "ko" ? KO : EN;
}
