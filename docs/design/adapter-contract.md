# 어댑터 계약 (엔진 쪽)

CLI, VS Code 확장, 독립 GUI가 엔진을 부르는 공통 계약을 설계한다. 실행 시작, 진행 이벤트 구독, 취소, 결과, 보고서, 되돌리기, 확인 질문, 오류 모델을 정하고, 현재 CLI를 이 계약으로 옮기는 순서를 적는다.

- 기준: main `b386166`(2026-11-12). 작업 지시: [단계 4·5 설계 작업 지시](../work-orders/phase-4-5-design.md) P5-A.
- 입력: [아키텍처](../architecture.md) 1·2·4·9절, [설계 결정](../decisions.md) M-2·M-9·M-11, [CLI 계약](../cli-contract.md) 2·8절, [UX 설계](ux-design.md) UX-D1·UX-D2, [사용성 개선 지시](../work-orders/phase-4-usability.md) N-5·N-7·N-11·N-13.
- 이 문서는 설계다. 코드, 시험, `src/contracts`는 바꾸지 않았다. 계약 변경은 제안이며 역할 1(계약 담당)이 PM 승인 뒤 만든다.
- 실제 API는 호출하지 않았다. 이 설계의 어떤 부분도 실행으로 검증하지 않았다.

표기
- 성격: **[확정]** 사용자 확정 요구, **[선택]** PM(관리자) 설계 선택, **[제안]** 이 문서의 안, **[미정]** 결정 전.
- 근거: **[코드]** 코드를 읽어 확인한 것(파일:줄은 이 브랜치의 main `b386166` 기준), **[추정]** 확인하지 않은 것.

## 1. 목표와 원칙

- [확정] 엔진은 하나이고 CLI·GUI·IDE는 어댑터다(decisions M-2, U-2). 단계 5 완료 기준: 두 어댑터가 CLI와 같은 엔진·정책·기록을 쓰고, 어댑터에 작업 논리가 없고, 확인 질문과 취소가 CLI와 같은 의미로 동작한다(roadmap 단계 5).
- [선택] GUI 전에 엔진 쪽 어댑터 계약(실행 시작, 이벤트 구독, 취소, 결과, 보고서, 되돌리기)을 정하고 CLI도 그 계약으로 옮긴다. VS Code 확장을 먼저 만든다. 로컬 웹 서버는 쓰지 않는다(N-13, UX-D1, UX-D2).
- [선택] 단일 프로세스. 서버, 큐, 데몬, 플러그인 런타임이 없다(architecture 1절, M-1).
- [제안] 계약의 원칙
  1. **어댑터는 입력과 표시만 한다.** 입력 해석, 보안 검사, 조립, 실행 수명, 결과 저장은 어댑터 아래의 공통 계층(이하 "앱 계층")이 한다.
  2. **CLI의 외부 계약은 그대로다.** stdout의 출력 하나(JSON 한 줄 또는 글), 오류 코드, 종료 코드, 실행 전 검사 순서를 바꾸지 않는다.
  3. **기록된 것만 알린다.** 진행 이벤트는 journal에 쓴 가림본 레코드다. 기록에 없는 내용을 이벤트로 내지 않는다.
  4. **권한은 사람의 설정에서만 온다.** 요청 객체에 키, API 주소, 정책·한도 확대 필드가 없다(C-1, C-5, M-9). 확인 질문의 답은 한 번의 호출만 허용하며 정책을 넓혀 저장하지 않는다.
  5. **같은 의미.** 취소와 확인 질문은 어느 어댑터에서든 같은 종료 상태, 같은 기록을 남긴다.

## 2. 현재 경계 (코드 근거)

| 경계 | 현재 | 근거 [코드] |
| --- | --- | --- |
| 엔진 진입점 | `runTask(deps: EngineDeps) => Promise<EngineResult>` 하나 | `src/contracts/engine.ts:223-252`, `src/engine/index.ts:165` |
| 엔진의 의존 | `contracts`와 자기 파일만 import한다 | `src/engine/index.ts:26-65` |
| 실행 전 해석·보안 검사 | 인자, 변수 파일, 키 검사, 설정·task 해석, 작업 공간·설치 위치, 파일 위치, 비밀 등록, 모델 생성이 모두 CLI 안에 있다 | `src/cli/run.ts:172-373`(순서 주석 `:6-16`) |
| 조립 | 작업 공간 → 잠금 → 게이트 → 실행기 → 변경 기록기 → 도구 → 검증기 → journal → 무결성 | `src/cli/assemble.ts:126-188` |
| 결과 저장과 잠금 해제 | `finish(result)`가 result.json을 쓰고 잠금을 푼다 | `src/cli/assemble.ts:176-182`, `src/cli/run.ts:394-401` |
| 프로세스 사실의 주입 | env, cwd, 파일 읽기, 변수 파일 적재, 시계, 난수, 진행 출력, 취소 신호를 `CliEnvironment`로 받는다 | `src/cli/run.ts:62-99` |
| 프로세스 전역 사용 | `process.loadEnvFile`(process.env를 바꿈), SIGINT·SIGTERM 처리기, `import.meta.url`로 설치 위치, stderr·stdout·exitCode | `src/cli/main.ts:101`, `:129`, `:140-148`, `:68`, `:137-139`, `:153-155` |
| 진행 이벤트 | journal을 감싸 기록 뒤에 사람용 한 줄을 stderr에 쓴다. 실패는 무시한다 | `src/cli/progress.ts:65-81`, `src/cli/run.ts:390-393` |
| 기록 형식 | `JournalEvent`, 저장 줄은 `seq`·`at`·`runId`를 더한 `JournalRecord`. `append`는 값을 돌려주지 않는다 | `src/contracts/journal.ts:31-124`, `src/store/index.ts:35-39` |
| 취소 | `EngineDeps.signal` 하나. 출처는 SIGINT·SIGTERM과 취소 파일(100ms 폴링) | `src/contracts/engine.ts:233-234`, `src/cli/cancel.ts:20-45` |
| 취소 등록 시점 | 실행 전 검사와 모델 생성이 끝난 뒤에 신호 처리기를 단다 | `src/cli/run.ts:376` |
| runId | 조립 전에 만든다 | `src/cli/run.ts:375` |
| 결과 | `EngineResult`를 stdout JSON 한 줄과 result.json으로 낸다 | `src/contracts/engine.ts:151-177`, `src/cli/guard.ts:26-29` |
| 실행 단위 안내 | 모델 404일 때의 안내(Y-4)를 CLI가 journal을 엿보아 결과 notices에 더한다 | `src/cli/run.ts:118-137`, `:380-397` |
| 보고서 | 작업 공간의 result.json과 journal만 읽는다. 잠금 없음 | `src/cli/report.ts:464-524`. 핵심 함수 `summarizeJournal :178`, `readResult :262` |
| 되돌리기 | 잠금을 잡고 `revertRun`을 부른다. 출력은 `RevertOutput` | `src/cli/assemble.ts:95-124`, `src/cli/revert.ts:34-75`, `src/contracts/changes.ts:51-113` |
| 오류 | 실행 전 오류는 `CliErrorOutput`. 코드와 종료 코드 표가 계약에 있다. 최상위 예외는 문구 없이 `internal_error` | `src/contracts/engine.ts:86-117`, `:179-187`, `src/cli/guard.ts:41-47` |
| 확인 질문 | 없다. 정책 판정은 허용·거부 둘뿐이고 `network`·`destructive`는 `"deny"`만 있다 | `src/engine/index.ts:431-457`, `src/contracts/task.ts:72-75` |

관찰
- 엔진 자체는 이미 어댑터 중립이다. 어댑터가 공유해야 할 것(실행 전 검사, 조립, 수명, Y-4 안내)이 `src/cli`에 있어 VS Code나 GUI가 그대로 쓸 수 없다. 이것이 옮길 대상이다.
- `CliEnvironment`가 프로세스 사실을 이미 주입받는다(`run.ts:62-99`). 이 이음매를 그대로 앱 계층의 입력으로 쓸 수 있다.
- 실행 전 검사 도중의 Ctrl+C는 처리기가 아직 없어 Node 기본 동작으로 끝나고 stdout JSON이 나오지 않는다(`run.ts:376` 이전). 지금은 한계로 둔다(AC-D12).
- 엔진이 `run_started`를 기록하지 않고 끝나는 경로가 있다(가림 실패, `engine/index.ts:518-522`). 이때 기록은 `run_finished` 하나뿐이다(`engine/index.ts:781`). 어댑터가 `run_started`로 실행 시작을 알아채게 하면 안 된다. 시작 응답이 runId를 주어야 한다(5.1).

## 3. 계층 구조 [제안]

```
어댑터: CLI (src/cli) | VS Code 확장 | 독립 GUI
   │  StartRunRequest · RunObserver · cancel() · report · revert · runs · doctor
   ▼
앱 계층 (src/app, 신규 모듈)
   ├ 입력 해석과 실행 전 보안 검사 (지금의 cli/run.ts 1~8단계)
   ├ 조립 (지금의 cli/assemble.ts)
   └ 수명: 이벤트 전달, 취소, 확인 질문 중계, 결과 저장, 잠금 해제, 실행 단위 안내(Y-4)
   │  EngineDeps
   ▼
엔진 (src/engine): 반복, 한도, 가림 순서, 검증, 재수정, 무결성 — 바뀌지 않는다(확인 질문 연결만 단계 4에 추가)
```

- 앱 계층은 작업 논리를 갖지 않는다. 작업 논리는 엔진에 있다. 앱 계층은 "한 번의 실행을 안전하게 준비하고 끝내는 일"만 한다.
- 앱 계층은 어댑터의 프로세스 안에서 함수로 불린다. 소켓, 포트, 데몬, 자기 파일 채널을 만들지 않는다. 쓰는 파일은 지금 실행이 쓰는 것(`.codaryn/` 아래 잠금·기록·결과·스냅샷)뿐이다.
- 의존 방향: `cli` → `app` → (`engine`, `store`, `tools`, `policy`, `privacy`, `verify`, `workspace`, `model`) → `contracts`. 엔진은 계속 `contracts`만 import한다.
- 이름 `src/app`은 제안이다(AC-D1). VS Code의 "확장 호스트"와 헷갈리지 않게 "host"는 쓰지 않는다.

## 4. 앱 환경 [제안]

어댑터가 프로세스 사실을 넣는다. 앱 계층은 프로세스 전역(`process.env`, 신호, stdout)을 직접 만지지 않는다.

```ts
// [제안] src/contracts/app.ts — 역할 1이 만든다. 이름과 필드는 PM 승인 뒤 확정한다.
export interface AppEnvironment {
  /** 환경 변수의 사본. 앱 계층은 이 객체를 바꾸지 않는다. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  /** U-3: 실행 중인 Codaryn 설치 위치. null이면 모든 실행을 거부한다. */
  readonly installDir: string | null;
  readonly readFile: (path: string) => Promise<string>;
  readonly isDirectory: (path: string) => Promise<boolean>;
  /** C-2: --vars-file을 읽어 이름→값을 돌려준다. process.env를 바꾸지 않는다. 이미 있는 이름이 이긴다는 규칙은 앱 계층이 적용한다. */
  readonly readVarsFile: (path: string) => Promise<Readonly<Record<string, string>>>;
  readonly clock: Clock;
  readonly randomBytes: (size: number) => Uint8Array;
}
```

- 변경점: 지금 CLI는 `process.loadEnvFile`로 프로세스 환경에 직접 적재한다(`main.ts:129`). 같은 프로세스에 다른 코드가 있는 어댑터(확장 호스트 안 실행 등)에서는 변수 파일의 값이 그 프로세스 전체에 퍼진다. 앱 계층은 사본 환경에 합친 결과만 쓴다. S-4(변수 파일이 새로 설정한 값을 비밀로 등록)는 "사본에 새로 생긴 이름"으로 같게 판정한다.
- CLI 어댑터는 `process.env` 사본과 Node의 env 파일 해석으로 `readVarsFile`을 만든다. 파일 형식의 해석 규칙이 지금(`process.loadEnvFile`)과 같아야 한다. 같은 함수를 쓰는 방법은 구현 때 확인한다 [미정].

## 5. 계약

### 5.1 실행 시작

```ts
export interface StartRunRequest {
  readonly input:
    | { readonly kind: "task"; readonly taskPath: string }
    | { readonly kind: "quick"; readonly workspace: string; readonly goal: string };
  /** --config. null이면 CODARYN_CONFIG, 그다음 기본 위치(N-1). */
  readonly configPath: string | null;
  /** --vars-file (C-2). */
  readonly varsFile: string | null;
  /** --profile (N-8). */
  readonly profile: string | null;
  /** --cancel-file (P-2). 작업 공간 밖이어야 한다(T-12). */
  readonly cancelFile: string | null;
}
// 키, API 주소, 정책·한도·보호 경로를 덮어쓰는 필드는 없다(C-1, C-5, M-9).

export type StartOutcome =
  | { readonly ok: true; readonly handle: RunHandle }
  | { readonly ok: false; readonly error: AppError };

export interface RunHandle {
  /** 조립 전에 정해진다(run.ts:375). 첫 이벤트보다 먼저 어댑터가 안다. */
  readonly runId: string;
  /** 작업 공간 루트의 실경로. report·revert에 그대로 쓴다. */
  readonly workspaceRoot: string;
  /** 여러 번 불러도 된다. 끝난 뒤에는 효과가 없다. */
  cancel(): void;
  /** 절대 reject하지 않는다. result.json 저장과 잠금 해제가 끝난 뒤에 풀린다. */
  readonly done: Promise<RunOutcome>;
}

export type RunOutcome =
  | { readonly ok: true; readonly result: EngineResult }
  | { readonly ok: false; readonly error: AppError }; // 실행 중 내부 예외: internal_error

export interface CodarynApp {
  startRun(request: StartRunRequest, observer?: RunObserver): Promise<StartOutcome>;
  // 5.4~5.6
}
export type CreateCodarynApp = (environment: AppEnvironment) => CodarynApp;
```

- `startRun`은 지금의 `runCli` 2~8단계와 조립을 같은 순서로 한다. 실패하면 아무것도 만들지 않고 `AppError`를 돌려준다(`engine.ts:86-88`의 "실행 전 오류에는 기록이 없다"를 유지).
- 성공은 잠금을 잡고 엔진을 시작한 뒤에 돌려준다. 엔진은 비동기로 계속된다.
- 한 작업 공간에 실행 하나(잠금, P-4)는 그대로다. 한 프로세스가 서로 다른 작업 공간의 실행 여럿을 가질 수는 있다(앱 계층에 프로세스 전역 상태가 없으므로). CLI는 프로세스당 하나만 쓴다.

### 5.2 진행 이벤트 구독

```ts
export type RunEvent =
  /** journal에 쓴 레코드 그대로(가림본). seq 순서. */
  | { readonly kind: "record"; readonly record: JournalRecord }
  /** 기록 밖의 실행 단위 안내(예: Y-4). 가림본이며 결과 notices에도 들어간다. */
  | { readonly kind: "notice"; readonly text: MaskedText };

export interface RunObserver {
  /** 동기 호출. 예외는 무시한다. 오래 걸리는 일을 하지 않는다. */
  onEvent?(event: RunEvent): void;
  /** 5.7. 없으면 모든 질문이 기본값(거부)으로 끝난다. */
  confirm?(request: ConfirmRequest, signal: AbortSignal): Promise<ConfirmAnswer>;
}
```

보장
1. 레코드 이벤트는 그 줄을 운영체제에 넘긴 뒤에(`Journal.append` 계약, `journal.ts:120-122`) 보낸다. 받은 이벤트는 모두 journal에 있다.
2. `seq`는 1부터 하나씩 커진다. 어댑터는 빠진 번호로 유실을 알 수 있다.
3. 엔진이 끝까지 가면 마지막 레코드는 `run_finished`이고 `done`은 그 뒤에 풀린다. 첫 레코드가 `run_started`라는 보장은 없다(2절 관찰). 기록 도중 내부 예외로 끝나면 `run_finished`도 없을 수 있다. 어댑터는 `handle.runId`로 시작을, `done`으로 끝을 안다.
4. 관찰자의 예외와 느림은 실행 결과를 바꾸지 않는다(지금 진행 표시와 같다, `progress.ts:73-77`). 화면 갱신이 느린 어댑터는 자기 쪽에서 모아 그린다.
5. 이벤트의 글은 가림본이지만 제어 문자가 있을 수 있다. 화면에 내기 전에 `cleanText`와 같은 정리를 한다(`src/cli/text-safety.ts:25`). 이 함수는 앱 계층 공용으로 옮긴다.
6. 사람용 문장은 이벤트에 없다. 문장은 어댑터가 N-4 문구 카탈로그로 만든다. CLI의 진행 줄은 이 이벤트를 받아 지금과 같은 줄을 쓰는 관찰자가 된다.

- 계약 변경 제안: `Journal.append`가 저장한 `JournalRecord`를 돌려준다(AC-D3). 지금은 `seq`·`at`를 store 안에서만 매기고(`store/index.ts:35-39`) 감싸는 쪽은 `JournalEvent`만 본다.
- 이벤트 내용 전체(모델 요청·응답·도구 결과 포함)를 보낸다. 같은 내용이 이미 작업 공간의 journal에 있다. 무엇을 보여 줄지는 어댑터가 고른다.

### 5.3 취소

- `handle.cancel()`은 엔진에 넘긴 `AbortSignal`을 끊는다. CLI의 SIGINT·SIGTERM·취소 파일은 모두 이 함수를 부르는 출처가 된다(지금의 `cancel.ts:22-45`와 같은 하나의 신호).
- 의미는 지금과 같다(architecture 9절, M-11).
  - 진행 중인 모델 요청을 끊고 자식 명령 트리를 끝낸다.
  - 상태는 `cancelled`/`cancelled`, 종료 코드 5다.
  - 이미 적용된 변경은 남는다. 되돌리기는 `revert`로 한다.
  - 확인 질문을 기다리던 중이면 그 질문의 `signal`이 끊기고, 답은 `cancelled`로 기록되며 실행은 `cancelled`로 끝난다(5.7).
- 끝난 뒤의 `cancel()`은 아무 일도 하지 않는다. 결과는 바뀌지 않는다.
- `startRun`이 응답하기 전(실행 전 검사 중)에는 취소 대상이 없다. CLI의 실행 전 Ctrl+C 처리는 AC-D12.

### 5.4 결과와 보고서

- 결과는 지금의 `EngineResult` 그대로다(`engine.ts:151-177`). 어댑터마다 다른 결과 형식을 만들지 않는다.
- 보고서는 지금처럼 작업 공간의 기록만 읽는다.

```ts
export interface CodarynApp {
  report(request: { readonly workspace: string; readonly runId: string | "latest" }): Promise<
    { readonly ok: true; readonly report: ReportOutput } | { readonly ok: false; readonly error: AppError }>;
  listRuns(request: { readonly workspace: string }): Promise<
    { readonly ok: true; readonly runs: RunsOutput } | { readonly ok: false; readonly error: AppError }>;
}
```

- `ReportOutput`(`commands.ts:62-71`)을 돌려준다. Markdown 글은 어댑터의 표시 몫이다. CLI는 지금처럼 `renderReport`로 글을 만든다(`report.ts:347`).
- `"latest"`와 `RunsOutput`은 N-7(N-C 담당)의 출력 객체를 따른다. 실행 목록 조회의 핵심은 `src/store`에 두기로 되어 있으므로(phase-4-usability 작업 표) 앱 계층은 그것을 부르기만 한다.
- 실행 중에 부른 보고서는 지금처럼 `incomplete`(종료 3)이다.

### 5.5 되돌리기

```ts
export interface CodarynApp {
  revert(request: { readonly workspace: string; readonly runId: string | "latest"; readonly dryRun: boolean }): Promise<
    { readonly ok: true; readonly output: RevertOutput } | { readonly ok: false; readonly error: AppError }>;
}
```

- 지금의 `createRevertCommand`(`assemble.ts:95-124`)와 `runRevert`(`revert.ts:34-75`)의 일을 앱 계층으로 옮긴다. 잠금, 해시가 같은 파일만 되돌림(R-7), `partial` 판정은 그대로다.
- `dryRun`은 N-7 결정이다(아무것도 바꾸지 않고 무엇을 되돌릴지만 보임). 출력 형식은 N-C가 정한다. GUI의 미리보기와 확인(UX-D4)은 `dryRun: true` → 사람 확인 → `dryRun: false` 두 번 호출이다. 두 호출 사이에 파일이 바뀌면 두 번째 호출이 해시 비교로 건너뛴다. 미리보기는 약속이 아니다.

### 5.6 점검과 모델 목록

- `doctor`(네트워크 없음)는 같은 방식으로 앱 계층 함수가 된다. 출력은 `DoctorOutput`(`commands.ts:117-126`).
- `models`는 실제 API에 접속한다(Y-2). 어댑터는 사람이 명시적으로 고른 경우에만 부른다. 확장이 켜질 때 자동으로 부르지 않는다. 이전 순서는 마지막(6절 이행 5)이다.

### 5.7 확인 질문 [제안, 단계 4에 구현]

계획 확인(파일 정리 등, P4-G)과 실행 중 권한 확인(N-11로 단계 4 이후로 미룸)을 같은 통로로 다룬다. 이 절은 통로와 의미만 정한다. 계획의 형식과 어느 동작에 묻는지는 P4-G 설계([범용 작업 워크플로](general-tasks.md), 이 문서 작성 시점에 아직 커밋 전)가 정한다.

```ts
export type ConfirmRequest =
  | {
      readonly kind: "permission";
      readonly id: string;
      readonly callId: string;
      readonly tool: ToolName;
      readonly permission: PermissionKind;
      /** 실효 인자의 가림본 요약. 고정 문구와 가린 값만. */
      readonly subject: MaskedText;
    }
  | {
      readonly kind: "plan";
      readonly id: string;
      /** 계획 본문의 해시. 승인은 이 해시에 묶인다. */
      readonly planHash: ContentHash;
      /** 가림본 단계 목록. 형식은 P4-G. */
      readonly steps: readonly MaskedText[];
    };

export type ConfirmAnswer =
  | { readonly decision: "allow_once" }                                   // permission
  | { readonly decision: "approve"; readonly planHash: ContentHash }      // plan
  | { readonly decision: "deny" };                                        // 둘 다
```

의미 (어댑터 공통)
1. **묻는 조건은 사람의 설정이 정한다.** 사용자 설정(또는 프로필)에서 그 권한을 "확인 후 허용"으로 둔 경우에만 묻는다. 설정이 거부한 것은 묻지 않고 거부한다. 모델 출력이나 task 파일이 질문을 만들 수 없다(M-9, 검토 A12의 위험).
2. **기본값은 거부다.** `confirm`이 없거나, 터미널이 아니거나, 답할 수 없는 어댑터면 묻지 않고 거부한다(UX 7절 "입력이 터미널이 아니면 묻지 않는다. 기본값은 항상 바꾸지 않음").
3. **답은 그 한 번에만 쓴다.** `allow_once`는 그 호출 하나를 허용한다. "항상 허용"은 없다. 늘 허용하려면 사람이 설정 파일을 고친다.
4. **답 뒤에도 같은 검사를 한다.** 허용된 호출도 2차 정책 판정(`engine/index.ts:456`)과 실행 전 검사를 그대로 지난다. 확인은 판정 단계 하나("확인 후 허용")를 푸는 것이지 다른 검사를 건너뛰지 않는다.
5. **계획 승인은 해시에 묶인다.** 실행이 승인한 계획과 다른 이동·삭제를 하려 하면 거부한다(세부는 P4-G).
6. **시간.** 기다리는 시간도 실행 시간 한도(`maxDurationMs`)에 든다. 엔진의 실시간 타이머(`engine/index.ts:198-202`)가 그대로 적용되어, 한도에 닿으면 질문이 끊기고 `budget-exhausted`/`max_duration`이다.
7. **취소.** 기다리는 중 취소면 답은 `cancelled`로 기록하고 실행은 `cancelled`다.
8. **기록.** 질문과 답을 journal에 남긴다(계약 추가 제안).

```ts
// [제안] JournalEvent 추가
| { readonly type: "confirmation_requested"; readonly id: string; readonly kind: "permission" | "plan"; readonly subject: MaskedText }
| { readonly type: "confirmation_answered"; readonly id: string;
    readonly decision: "allow_once" | "approve" | "deny";
    /** user: 사람이 답함. default: 물을 수 없어 기본값. cancelled: 취소·시간 한도로 끊김. */
    readonly by: "user" | "default" | "cancelled" }
```

- 엔진 연결 위치: 권한 확인은 정책 2차 판정 결과가 "확인 필요"일 때, 실행(`engine/index.ts:468-469`) 전에 `EngineDeps.confirm`(선택 필드 제안)을 부른다. 정책 판정에 "확인 필요"를 더하는 것은 `PolicyDecision`과 `PolicyConfig`의 변경이다(P4-G와 함께 정한다).
- 질문 글은 가림본이다. 화면에 경로·명령이 토큰으로 보일 수 있다. 원문을 보여 주려면 복원이 필요하고 그것은 화면 출력으로의 복원이므로 하지 않는다.

### 5.8 오류 모델

| 층 | 언제 | 표현 | 종료 코드(CLI) |
| --- | --- | --- | --- |
| 실행 전 오류 | `startRun`·`report`·`revert`·`doctor`가 아무것도 바꾸기 전에 멈춤 | `AppError { code: CliErrorCode; message }`. 기록 없음 | `CLI_ERROR_EXIT_CODES[code]`(`engine.ts:90-117`) |
| 실행 결과 | 엔진이 끝까지 감 | `EngineResult`의 `status`·`reason`. 오류가 아니다 | `RUN_EXIT_CODES`(`engine.ts:78-84`) |
| 실행 중 내부 예외 | 시작 뒤 앱 계층이나 엔진이 던짐 | `RunOutcome { ok: false, error: { code: "internal_error" } }`. 예외 문구·스택은 버린다(S-6). 잠금은 푼다 | 70 |
| 어댑터 전송 오류 | 프로세스 밖 어댑터만: 자식 실행 실패, 출력이 계약과 다름, 자식이 결과 없이 끝남 | 어댑터 쪽 코드(예: `adapter_spawn_failed`, `adapter_protocol_error`). CLI 오류 코드 표에 넣지 않는다 | 해당 없음 |

- `AppError`는 지금의 `CliErrorOutput`에서 `schemaVersion`·`kind`·`exitCode`를 뺀 것이다. CLI는 `cliError`(`run.ts:106-112`)로 같은 JSON을 만든다. 코드 이름과 종료 코드 대응은 바꾸지 않는다.
- `message`는 지금 규칙 그대로다. 고정 문구, 필드 위치, 개수만 쓰고 파일·환경의 값은 넣지 않는다(S-3, S-6, N-6). 사람용 문장(무엇이, 고치는 법)은 어댑터가 코드로 N-4 카탈로그를 찾아 만든다(N-5).
- 앱 계층이 새 실행 전 오류를 만들면 `CliErrorCode`에 더하는 계약 변경이다(역할 1). 어댑터별 코드를 만들지 않는다.
- 어댑터 전송 오류는 실행 상태를 모르는 경우다. 어댑터는 "실행 결과를 알 수 없음, 보고서로 확인"이라고 보이고 `report`(`incomplete` 가능)를 안내한다.

## 6. 프로세스 밖 어댑터용 줄 프로토콜 [제안]

VS Code 확장이 CLI를 자식 프로세스로 부르는 경우([VS Code 확장 설계](vscode-extension.md) 2절 권고)와 독립 GUI가 같은 방식을 고를 경우에 쓴다. 같은 프로세스 어댑터는 5절 함수를 직접 쓴다.

- `run`에 선택 옵션 두 개를 더한다.
  - `--events jsonl`: stderr에 사람용 줄 대신 JSON 한 줄씩 이벤트를 쓴다.
  - `--confirm stdio`: 확인 질문을 stderr 이벤트로 내고 답을 stdin에서 한 줄씩 읽는다. `--events jsonl`이 있어야 한다.
- stdout은 바뀌지 않는다. 끝에 `CliOutput` JSON 한 줄이다. 종료 코드도 같다.
- stderr 줄 형식(한 줄에 객체 하나, UTF-8, LF)

```
{"schemaVersion":1,"kind":"started","runId":"<runId>"}                      ← startRun 성공 직후 한 번
{"schemaVersion":1,"kind":"event","event":{"kind":"record","record":{…}}}   ← 5.2의 RunEvent
{"schemaVersion":1,"kind":"confirm","request":{…}}                          ← 5.7의 ConfirmRequest
```

- stdin 줄 형식: `{"schemaVersion":1,"kind":"answer","id":"<질문 id>","answer":{…}}`. 형식이 틀린 줄, 모르는 id, 이미 답한 id는 무시한다. 기다리던 질문은 계속 기다린다. stdin이 끝나면(EOF) 남은 질문과 이후 질문은 기본값(거부, `by: "default"`)이다.
- 실행 전 오류이면 `started`가 나오지 않고 stdout의 오류 JSON 한 줄로 끝난다.
- 취소는 지금의 `--cancel-file`을 쓴다(P-2, 구현·시험됨). Windows에서 부모가 보낸 SIGINT는 자식의 처리기를 거치지 않고 강제 종료가 된다고 알려져 있다 [추정, 이번에 확인하지 않음]. 그러면 결과 JSON과 result.json이 남지 않으므로 파일 방식이 어댑터 공통으로 맞다. stdin의 `{"kind":"cancel"}`은 AC-D9로 둔다.
- 이 프로토콜은 로컬 웹 서버가 아니다. 듣는 소켓이 없고, 자식은 실행 하나가 끝나면 끝난다. 통신은 부모가 만든 표준 입출력 파이프뿐이다.

## 7. CLI 이행 계획 (N-13, UX-D2)

### 7.1 바꾸지 않는 것

- stdout: `run`·`revert`·오류는 JSON 한 줄, `report`·`doctor`·`models`·도움말·버전은 글(`--json`이면 JSON 한 줄). 기존 통합 시험의 출력과 바이트 단위로 같아야 한다.
- 종료 코드 표 다섯 개: `RUN_EXIT_CODES`, `CLI_ERROR_EXIT_CODES`, `REVERT_EXIT_CODES`, `REPORT_EXIT_CODES`, `DOCTOR_EXIT_CODES`.
- 실행 전 검사의 순서와 오류 코드·문구(`run.ts:6-16`의 1~8단계). 먼저 걸리는 검사가 바뀌면 같은 입력의 오류 코드가 바뀐다.
- stderr 진행 줄(N-C가 자기 결정으로 바꾸는 것은 예외).

### 7.2 단계

| 이행 | 내용 | 바뀌는 파일 | 완료 기준 |
| --- | --- | --- | --- |
| 1 계약 | `src/contracts/app.ts`(4·5절 타입), `Journal.append` 반환값, 확인 질문 레코드 타입만 추가. 동작 변경 없음 | `src/contracts/**`, `docs/cli-contract.md`(역할 1) | typecheck, 계약 유닛 |
| 2 앱 계층 추출 | `run.ts`의 2~8단계와 `assemble.ts`를 `src/app`으로 옮긴다. `runCli`는 인자 해석 → `startRun` → 출력만 한다. 변수 파일은 사본 환경으로 | `src/app/**`(신규), `src/cli/run.ts`, `src/cli/assemble.ts` | 유닛·통합 전부 통과, stdout 바이트 동일 |
| 3 이벤트와 취소 | 진행 줄을 `RunObserver` 관찰자로, Y-4 안내를 앱 계층 `notice`로, 신호·취소 파일을 `handle.cancel()`로 | `src/cli/progress.ts`, `src/cli/cancel.ts`, `src/cli/main.ts`, `src/app/**` | 진행 줄 동일(통합 `k02`), 취소 시험(`a08`, `p01`) 통과 |
| 4 보고서·되돌리기·목록 | `report`, `revert`(+`dryRun`), `runs`를 앱 계층 함수로. CLI는 렌더링만 | `src/cli/report.ts`, `src/cli/revert.ts`, `src/cli/runs.ts`, `src/app/**` | `k02`, `p04`, N-7 시험 통과 |
| 5 점검·모델 목록 | `doctor`, `models`를 앱 계층으로 | `src/cli/doctor.ts`, `src/cli/models.ts`, `src/app/**` | 기존 시험 통과 |
| 6 줄 프로토콜 | `--events jsonl`, `--confirm stdio`(확인 질문은 단계 4 구현 뒤 연결) | `src/cli/args.ts`, `src/cli/run.ts`, `src/contracts/**`(옵션·줄 타입) | 새 유닛·통합: 줄 형식, stdout 불변, EOF 기본값 |
| 7 확인 질문 | 엔진·정책에 "확인 필요"와 `EngineDeps.confirm`, CLI의 터미널 질문(stderr에 묻고 stdin에서 읽음, stdout은 그대로) | `src/engine/**`, `src/policy/**`, `src/cli/**` | 단계 4 P4-G 결정 뒤. 5.7의 의미 1~8을 시험으로 |

- 순서 제약: N-A(`claude/workspace-policy`)가 지금 `src/cli/run.ts`를 고치고 있다(N-1, N-8, N-9). 이행 2는 N-A가 main에 병합된 뒤 시작한다. 그 전에 시작하면 같은 파일에서 충돌한다.
- 각 이행은 따로 병합한다. 이행 2가 가장 크고 위험하다. 동작을 바꾸지 않는 이동만 하고, 개선은 다음 이행으로 미룬다.
- 앱 계층 추출 뒤에도 `src/cli/assemble.ts`를 import하는 기존 유닛(`cli/assemble`, `cli/sc-wire` 등)은 새 위치를 따라가야 한다. 시험 파일 이동은 같은 이행의 소유 범위에 넣는다.

## 8. 시험 계획

유닛 P0 (`tests/unit/app/`, 대본 모델과 임시 디렉터리)
- `startRun`이 runId를 첫 이벤트보다 먼저 준다. 실행 전 오류에는 이벤트도 실행 디렉터리도 없다.
- 받은 레코드 이벤트가 journal 파일의 줄과 순서·내용이 같다(`seq` 연속).
- 관찰자가 예외를 던져도 결과가 같다.
- `cancel()`이 SIGINT 경로와 같은 결과(`cancelled`, 종료 5, 변경 유지)를 낸다. 끝난 뒤의 `cancel()`은 결과를 바꾸지 않는다.
- `done`은 reject하지 않고, 풀렸을 때 result.json이 있고 잠금이 없다.
- 변수 파일을 읽어도 `AppEnvironment.env`로 준 객체와 `process.env`가 바뀌지 않는다. S-4 비밀 등록은 지금과 같다.
- `AppError` 코드와 CLI 종료 코드의 대응이 계약 표와 같다.
- 확인 질문(이행 7): `confirm`이 없으면 묻지 않고 거부하고 `by: "default"`로 기록한다. 설정이 거부한 권한은 묻지 않는다. `allow_once`는 그 호출 하나만 허용한다. 기다리는 중 취소·시간 한도의 결과.

통합
- 기존 통합 전체가 바뀌지 않고 통과한다(이행 2~5의 회귀 기준).
- 줄 프로토콜: 실제 CLI 프로세스를 대본 모델로 실행해 `started` → 이벤트 → stdout 결과 한 줄을 확인한다. stdin을 닫은 상태에서 확인 질문이 기본값으로 끝난다.

## 9. 다른 문서와 맞출 점

P4-G(`general-tasks.md`)와 P5-U(`standalone-gui.md`)는 이 문서를 커밋할 때 main에 없었다. 링크는 작업 지시서의 파일 이름을 따랐고 내용은 읽지 않았다.

- [architecture.md](../architecture.md) 2절 모듈 표에 `app`을 더한다. 1절 "단일 프로세스"에 "프로세스 밖 어댑터는 실행마다 CLI 자식 하나를 표준 입출력으로 부른다. 듣는 소켓과 상주 프로세스는 없다"를 더할지 정한다(AC-D11).
- [cli-contract.md](../cli-contract.md): `--events`, `--confirm` 옵션과 줄 형식, 확인 질문 레코드. 종료 코드 절은 바뀌지 않는다.
- [ux-design.md](ux-design.md) 4.6절은 "실행 중에 사람이 허용하는 확인 창은 두지 않는다(검토 D-5)"이다. N-11로 단계 4 이후로 미룬 것과 같다. 5.7을 채택하면 4.6과 7절을 고쳐야 한다.
- P4-G [범용 작업 워크플로](general-tasks.md): 계획의 형식과 해시, "확인 후 허용"을 둘 권한 종류(네트워크, 파괴적 동작, 이동·삭제), 비대화형 실행에서 계획을 미리 승인하는 방법(예: 승인한 계획 해시를 인자로 줌). 이 문서는 통로만 정했다.
- P5-U [독립 GUI](standalone-gui.md): 5절 함수를 같은 프로세스로 부를지, 6절 줄 프로토콜로 CLI를 부를지. 데스크톱 셸이 Node 기반이면 같은 프로세스도 가능하지만 셸의 Node 버전과 프로세스 전역 공유 문제(4절)를 같이 본다.
- N-C(사람용 출력, `src/cli/human/**`): 끝 요약과 사람용 오류를 `EngineResult`·`AppError`만으로 만드는 순수 함수로 두면 VS Code와 GUI가 같은 문장을 쓸 수 있다. 실행 목록 조회의 핵심은 `src/store`에 둔다.
- N-B(문구 카탈로그, `src/i18n/**`): 어댑터들이 오류 코드·상태·이유로 문장을 찾는다. 카탈로그가 CLI 전용 모듈에 의존하지 않아야 한다.
- [privacy.md](../privacy.md): 이벤트는 가림본이고 화면 정리는 어댑터 몫이라는 점, 확인 질문 글은 복원하지 않는다는 점.
- 계약 주석 `src/contracts/integrity.ts`의 링크 서술(architecture A-3)은 이 문서와 무관하다.

## 10. 결정 필요

| 번호 | 선택지 | 권고 | 근거 |
| --- | --- | --- | --- |
| AC-D1 | 앱 계층의 위치: (a) 새 모듈 `src/app` (b) `src/cli`에 두고 export (c) `src/engine`에 넣음 | (a) | (b)는 다른 어댑터가 CLI 모듈에 의존한다. (c)는 엔진이 파일 시스템·잠금·제공자를 알게 되어 architecture 2절의 "엔진이 알지 못해야 하는 것"을 깬다 |
| AC-D2 | 이벤트 내용: (a) 가림본 `JournalRecord` 그대로 (b) 화면용으로 줄인 별도 형식 | (a) | 기록이 하나의 원천이다. report가 이미 같은 레코드를 해석한다(`report.ts:178`). (b)는 두 형식의 불일치를 만든다 |
| AC-D3 | `seq`·`at`을 이벤트에 싣는 방법: (a) `Journal.append`가 저장한 레코드를 돌려줌 (b) 앱 계층이 따로 번호를 매김 | (a) | 번호가 하나여야 이벤트와 journal을 맞춰 볼 수 있다. 계약 변경은 반환형 하나다 |
| AC-D4 | 확인 질문 계약을 (a) 지금 타입만 정하고 단계 4에 구현 (b) 단계 4 설계 뒤에 정함 | (a) | 어댑터(VS Code, GUI)가 질문 화면을 처음부터 같은 의미로 설계할 수 있다. 엔진 변경은 P4-G 결정 뒤다 |
| AC-D5 | 권한 확인의 범위: 사용자 설정이 "확인 후 허용"으로 둔 권한만, 한 번만, 저장 없음 | 그렇게 한다 | 검토 A12의 위험(실행 중 정책 확대, 모델이 만든 질문)을 줄인다. M-9 유지 |
| AC-D6 | 확인 대기 시간을 실행 시간 한도에 넣음 | 넣는다 | 한도 없이 멈춰 있는 실행이 잠금을 쥐는 것을 막는다. 엔진의 실시간 타이머를 그대로 쓴다 |
| AC-D7 | 프로세스 밖 어댑터의 이벤트 통로: (a) `--events jsonl`로 stderr에 JSON 줄 (b) 추가 파이프(fd 3) (c) journal 파일 감시 | (a) | 모든 OS에서 같다. (b)는 Windows 동작을 확인하지 않았다 [추정]. (c)는 runId를 늦게 알고 파일 감시가 불안정하다 |
| AC-D8 | 프로세스 밖 확인 답: `--confirm stdio`로 stdin JSON 줄, EOF면 거부 | 그렇게 한다 | 비대화형 기본값(거부)과 같은 의미다 |
| AC-D9 | 프로세스 밖 취소: (a) 기존 `--cancel-file` (b) stdin `cancel` 줄 추가 | (a)로 시작 | 구현·시험되어 있다(P-2, T-12). (b)는 `--confirm stdio` 구현 때 같이 검토한다 |
| AC-D10 | CLI의 터미널 확인 질문 위치 | stderr에 묻고 stdin에서 읽는다. stdout은 JSON 한 줄 그대로 | stdout 계약 유지. 터미널이 아니면 묻지 않는다 |
| AC-D11 | 실행마다 CLI 자식 하나를 표준 입출력으로 부르는 것이 단일 프로세스 원칙과 맞는지 | 맞는 것으로 정하고 architecture 1절에 조건(듣는 소켓 없음, 상주 없음, 실행 하나에 자식 하나)을 적는다 | 엔진은 여전히 한 프로세스에서 돈다. 사람이 터미널에서 CLI를 부르는 것과 같다 |
| AC-D12 | 실행 전 검사 중 Ctrl+C(`run.ts:376` 전에는 처리기가 없어 JSON 없이 끝남) | 지금은 한계로 기록한다. 이행 3에서 처리기를 먼저 달고, 시작 전 취소를 새 오류 코드로 낼지는 그때 정한다 | 실행 전 검사는 짧고 아무것도 만들지 않는다. 새 오류 코드는 계약 변경이다 |
