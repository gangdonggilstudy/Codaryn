# 어댑터 계약 (엔진 쪽)

CLI, VS Code 확장, 독립 GUI가 엔진을 부르는 공통 계약을 설계한다. 다룰 것은 다음과 같다.
- 실행 시작, 진행 이벤트 구독, 취소, 결과, 보고서, 되돌리기
- 계획 확인·적용·사람 확인, 변경 비교
- 권한 확인 질문, 오류 모델
- 현재 CLI를 이 계약으로 옮기는 순서

- 기준: 설계는 main `b386166`(2026-11-12)에서 썼다. 작업 지시: [단계 4·5 설계 작업 지시](../work-orders/phase-4-5-design.md) P5-A.
- 이 판은 [설계 교차 검토 R-1](../reviews/2026-11-12-r1-review-stage-4-5-designs.md) 뒤 PM 결정 DR-1~DR-4, DR-7, DR-8(main `f39593f`)을 반영했다.
- 앱 계층 구현 A-1(`f1e796b`, `850626e`)의 상태도 반영했다.
- 입력: [아키텍처](../architecture.md) 1·2·4·9절, [설계 결정](../decisions.md) M-2·M-9·M-11, [CLI 계약](../cli-contract.md) 2·8절, [UX 설계](ux-design.md) UX-D1·UX-D2, [사용성 개선 지시](../work-orders/phase-4-usability.md) N-5·N-7·N-11·N-13, [범용 작업](general-tasks.md) 4·6·7·8절.
- `src/contracts`는 바꾸지 않았다. 계약 변경은 제안이며 역할 1(계약 담당)이 만든다. 앱 계층의 타입은 그때까지 `src/app/types.ts`에 둔다.
- 실제 API는 호출하지 않았다. A-1의 시험은 대본 모델과 가짜 값만 쓴다.

표기
- 성격: **[확정]** 사용자 확정 요구, **[선택]** PM 설계 선택(AC-D·DR 결정 포함), **[제안]** 이 문서의 안, **[미정]** 결정 전.
- 상태: **[구현 A-1]** `src/app`에 코드와 유닛 시험이 있다. **[가정 G-A]** 범용 작업 계약(G-A)이 아직 없어 형태를 가정했다. G-A 커밋이 나오면 병합해 그 타입으로 바꾼다.
- 근거: **[코드]** 코드를 읽어 확인한 것(파일:줄은 main `b386166`, R-1이 줄까지 대조함), **[추정]** 확인하지 않은 것.

## 1. 목표와 원칙

- [확정] 엔진은 하나이고 CLI·GUI·IDE는 어댑터다(decisions M-2, U-2). 단계 5 완료 기준은 다음과 같다(roadmap 단계 5).
  - 두 어댑터가 CLI와 같은 엔진·정책·기록을 쓴다.
  - 어댑터에 작업 논리가 없다.
  - 확인 질문과 취소가 CLI와 같은 의미로 동작한다.
- [선택] GUI 전에 엔진 쪽 어댑터 계약을 정하고 CLI도 그 계약으로 옮긴다. VS Code 확장을 먼저 만든다. 로컬 웹 서버는 쓰지 않는다(N-13, UX-D1, UX-D2).
- [선택] 단일 프로세스 원칙의 조건은 두 가지다(DR-8).
  - 듣는 소켓이 없다.
  - 어댑터보다 오래 사는 프로세스가 없다.
  - 프로세스 밖 어댑터는 실행마다 CLI 자식 하나를 쓴다.
- 계약의 원칙
  1. **어댑터는 입력과 표시만 한다.** 입력 해석, 보안 검사, 조립, 실행 수명, 결과 저장은 어댑터 아래의 공통 계층(이하 "앱 계층")이 한다.
  2. **CLI의 외부 계약은 그대로다.** stdout의 출력 하나(JSON 한 줄 또는 글), 오류 코드, 종료 코드, 실행 전 검사 순서를 바꾸지 않는다.
  3. **기록된 것만 알린다.** 진행 이벤트는 journal에 쓴 레코드다. 다만 기록이 가리지 않는 필드는 다시 가린다(5.2).
  4. **권한은 사람의 설정에서만 온다.**
     - 요청 객체에 키, API 주소, 정책·한도 확대 필드가 없다(C-1, C-5, M-9).
     - 권한 질문은 사용자 설정과 프로필만 만들 수 있다. 답은 한 번의 호출만 허용한다(DR-3).
  5. **같은 의미.** 취소와 질문은 어느 어댑터에서든 같은 종료 상태, 같은 기록을 남긴다.
  6. **어댑터는 저장 형식을 읽지 않는다.** 스냅샷, `plan.json`, 기록 파일의 형식은 앱 계층과 CLI만 안다. 어댑터는 앱 함수나 CLI 출력만 쓴다(DR-7).

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
| 환경 이름 조회 | `io.env[이름]`으로 직접 찾는다. Windows에서 대소문자를 무시하는 것은 `process.env`의 성질에 기댄 것이다(R-1 M-3) | `src/cli/run.ts:337`. 접어서 비교하는 곳은 S-4뿐(`src/cli/security/env.ts:51`) |
| 명령의 부모 환경 | 실행기는 `parentEnv`가 없으면 `process.env`를 쓴다. 조립은 넘기지 않는다(R-1 M-3) | `src/tools/command-runner.ts:263`, `src/cli/assemble.ts:145` |
| 진행 이벤트 | journal을 감싸 기록 뒤에 사람용 한 줄을 stderr에 쓴다. 줄 전체를 다시 가리고 모르는 도구 이름을 바꾼다 | `src/cli/progress.ts:18-20`, `:65-81`, `src/cli/run.ts:390-393` |
| 기록 형식 | `JournalEvent`, 저장 줄은 `seq`·`at`·`runId`를 더한 `JournalRecord`. `append`는 값을 돌려주지 않는다 | `src/contracts/journal.ts:31-124`, `src/store/index.ts:35-39` |
| 기록이 가리지 않는 필드 | 모델이 준 도구 이름과 호출 id(R-1 L-1). 다음 `model_request`의 메시지에도 그대로 들어간다 | `src/engine/index.ts:403-412`, `:573`, `src/contracts/journal.ts:65-66` |
| 취소 | `EngineDeps.signal` 하나. 출처는 SIGINT·SIGTERM과 취소 파일(100ms 폴링, 감시를 시작할 때 한 번 즉시 확인) | `src/contracts/engine.ts:233-234`, `src/cli/cancel.ts:20-45` |
| 취소 등록 시점 | 실행 전 검사와 모델 생성이 끝난 뒤에 신호 처리기를 단다 | `src/cli/run.ts:376` |
| runId | 조립 전에 만든다 | `src/cli/run.ts:375` |
| 결과 | `EngineResult`를 stdout JSON 한 줄과 result.json으로 낸다 | `src/contracts/engine.ts:151-177`, `src/cli/guard.ts:26-29` |
| 실행 단위 안내 | 모델 404일 때의 안내(Y-4)를 CLI가 journal을 엿보아 결과 notices에 더한다 | `src/cli/run.ts:118-137`, `:380-397` |
| 보고서 | 작업 공간의 result.json과 journal만 읽는다. 잠금 없음. 기록의 글은 인라인 코드·코드 블록 안에만 넣는다 | `src/cli/report.ts:464-524`, `:350-437`. 핵심 함수 `summarizeJournal :178`, `readResult :262` |
| 되돌리기 | 잠금을 잡고 `revertRun`을 부른다. 출력은 `RevertOutput` | `src/cli/assemble.ts:95-124`, `src/cli/revert.ts:34-75`, `src/contracts/changes.ts:51-113` |
| 스냅샷 | 형식은 store 안에만 있다. 읽는 함수는 내보내지 않는다 | `src/store/changes.ts:1-15`, `:81-122`, `:304-330` |
| 오류 | 실행 전 오류는 `CliErrorOutput`. 코드와 종료 코드 표가 계약에 있다. 최상위 예외는 문구 없이 `internal_error` | `src/contracts/engine.ts:86-117`, `:179-187`, `src/cli/guard.ts:41-47` |
| 확인 질문 | 없다. 정책 판정은 허용·거부 둘뿐이고 `network`·`destructive`는 `"deny"`만 있다 | `src/engine/index.ts:431-457`, `src/contracts/task.ts:72-75` |

관찰
- 엔진 자체는 이미 어댑터 중립이다. 어댑터가 공유해야 할 것(실행 전 검사, 조립, 수명, Y-4 안내)이 `src/cli`에 있어 VS Code나 GUI가 그대로 쓸 수 없다. 이것이 옮길 대상이다.
- `CliEnvironment`가 프로세스 사실을 이미 주입받는다(`run.ts:62-99`). 앱 계층은 이 이음매로 CLI의 검사를 그대로 부른다(7절 이행 2 전까지).
- 실행 전 검사 도중의 Ctrl+C는 처리기가 아직 없다(`run.ts:376` 이전). Node 기본 동작으로 끝나고 stdout JSON이 나오지 않는다(AC-D12, 한계로 기록).
- 엔진이 `run_started`를 기록하지 않고 끝나는 경로가 있다(가림 실패, `engine/index.ts:518-522`).
  - 이때 기록은 `run_finished` 하나뿐이다(`engine/index.ts:781`).
  - 어댑터는 `run_started`로 실행 시작을 알아채면 안 된다. 시작 응답이 runId를 준다(5.1).

## 3. 계층 구조

```
어댑터: CLI (src/cli) | VS Code 확장 | 독립 GUI
   │  startRun · RunObserver · cancel() · report · revert · changes · plan · applyPlan · review · doctor
   ▼
앱 계층 (src/app)
   ├ 입력 해석과 실행 전 보안 검사 (지금은 CLI의 runCli를 부른다. 이행 2에서 옮겨 온다)
   ├ 조립 (A-1부터 앱 계층의 것. 명령의 부모 환경은 실행의 환경 사본, DR-4)
   ├ 수명: 이벤트 전달(다시 가림), 취소, 질문 중계, 결과 저장, 잠금 해제, 실행 단위 안내(Y-4)
   └ 읽기: 보고서, 변경 비교(다시 가림), 계획 보기
   │  EngineDeps
   ▼
엔진 (src/engine): 반복, 한도, 가림 순서, 검증, 재수정, 무결성 — 바뀌지 않는다
   (권한 질문 연결은 단계 5 시작, 계획·적용은 G-B 이후)
```

- 앱 계층은 작업 논리를 갖지 않는다. "한 번의 실행을 안전하게 준비하고 끝내는 일"과 기록을 읽는 일만 한다.
- 앱 계층은 어댑터의 프로세스 안에서 함수로 불린다. 소켓, 포트, 데몬, 자기 파일 채널을 만들지 않는다.
- 쓰는 파일은 지금 실행이 쓰는 것뿐이다(`.codaryn/` 아래 잠금·기록·결과·스냅샷).
- 의존 방향
  - 목표: `cli` → `app` → (`engine`, `store`, `tools`, `policy`, `privacy`, `verify`, `workspace`, `model`) → `contracts`.
  - A-1의 지금: `app` → `cli`. 검사를 복사하지 않으려고 그렇게 했다. 이행 2에서 뒤집힌다(7절).
- 이름은 `src/app`이다(AC-D1 채택).

## 4. 앱 환경 [구현 A-1]

어댑터가 프로세스 사실을 넣는다. 앱 계층은 프로세스 전역(`process.env`, 신호, stdout)을 직접 만지지 않는다.

```ts
// src/app/types.ts (이행 1에서 src/contracts/app.ts로 옮긴다)
export interface AppEnvironment {
  /** 환경 변수. 호출마다 복사한다. 이 객체는 바꾸지 않는다. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  /** U-3: 실행 중인 Codaryn 설치 위치. null이면 모든 실행을 거부한다. */
  readonly installDir: string | null;
  readonly nodeVersion: string;                       // doctor
  readonly readFile: (file: string) => Promise<string>;
  readonly isDirectory: (dir: string) => Promise<boolean>;
  readonly isFile: (file: string) => Promise<boolean>;  // doctor
  /** C-2: --vars-file의 이름→값. process.env를 바꾸지 않는다. 동기(실행의 적재 단계가 동기라서). */
  readonly readVarsFile: (file: string) => Readonly<Record<string, string>>;
  readonly clock: Clock;
  readonly randomBytes: (size: number) => Uint8Array;
  readonly platform?: NodeJS.Platform;               // 기본 process.platform
}
```

- **사본 환경.** 변수 파일은 호출마다 만든 사본에만 적재한다. 이미 있는 이름은 그 값을 유지한다(`process.loadEnvFile`과 같음).
  - S-4(변수 파일이 새로 설정한 값을 비밀로 등록)는 그대로다.
  - 해석기는 `util.parseEnv`다(`doctor`가 이미 쓰는 것). 따옴표, `export`, 주석, 여러 줄, 기존 값 유지가 `process.loadEnvFile`과 같은 결과임을 Node 26.13.1에서 시험으로 확인했다.
  - `createNodeAppEnvironment()`가 지금 프로세스의 사실(환경 스냅샷, cwd, 설치 위치)로 환경을 만든다.
- **대소문자 무시 조회(DR-4).** 지금 CLI는 Windows에서 `process.env`의 대소문자 무시 성질에 기댄다(2절). 보통 객체 사본은 그 성질을 잃는다(R-1 M-3 재현: 소문자 `secretEnv` 이름이 `done`에서 `secret_env_missing`으로 바뀜).
  - 앱 계층의 사본은 `platform`이 `win32`이면 이름을 접어 찾는 객체다. 처음 쓴 철자는 유지한다.
  - 어떤 환경 객체에서든 같은 규칙으로 찾는 `lookupEnv(env, name, platform)`도 낸다.
- **명령의 부모 환경(DR-4).** 실행기의 `parentEnv`는 실행의 사본(변수 파일 적재 뒤)이다.
  - 지금 CLI는 변수 파일을 `process.env`에 적재하므로 허용 목록 변수(`PATH`, `TEMP`, `LANG` 등)가 자식 명령에 그 값으로 간다. 사본으로 옮겨도 같은 결과가 나오게 넘긴다.
  - 같은 프로세스 어댑터에서는 호스트의 환경이 자식에 새지 않는다.
  - 이를 위해 A-1은 조립을 앱 계층에 두었다(`src/app/assemble.ts`). CLI의 `assembleRun`과 순서가 같고 `parentEnv`만 다르다.

## 5. 계약

### 5.1 실행 시작 [구현 A-1]

```ts
export interface StartRunRequest {
  readonly input:
    | { readonly kind: "task"; readonly taskPath: string }
    | { readonly kind: "quick"; readonly workspace: string; readonly goal: string };
  readonly configPath: string | null;   // --config. null: CODARYN_CONFIG, 그다음 기본 위치(N-1)
  readonly varsFile: string | null;     // --vars-file (C-2)
  readonly profile: string | null;      // --profile (N-8)
  readonly workflowRef: string | null;  // --workflow (DR-2, GT 4.2) [가정 G-A]
  readonly cancelFile: string | null;   // --cancel-file (P-2). 작업 공간 밖(T-12)
}
// 키, API 주소, 정책·한도·보호 경로를 덮어쓰는 필드는 없다(C-1, C-5, M-9).

export interface RunHandle {
  readonly runId: string;          // 엔진 시작과 첫 이벤트보다 먼저 정해진다
  readonly workspaceRoot: string;  // 작업 공간 루트의 실경로
  cancel(): void;                  // 여러 번 불러도 된다. 끝난 뒤에는 효과가 없다
  readonly done: Promise<RunOutcome>;  // reject하지 않는다. result.json 저장과 잠금 해제 뒤에 풀린다
}
export type RunOutcome = { ok: true; result: EngineResult } | { ok: false; error: AppError };  // 시작 뒤 내부 예외만 오류
export type StartOutcome = { ok: true; handle: RunHandle } | { ok: false; error: AppError };
```

- `startRun`은 `codaryn run`의 실행 전 검사를 같은 순서·코드·문구로 한다. A-1은 CLI의 `runCli`를 요청으로 만든 인자 목록으로 부른다.
- 실패하면 아무것도 만들지 않고 `AppError`를 돌려준다(`engine.ts:86-88`의 "실행 전 오류에는 기록이 없다").
- 성공은 잠금을 잡은 뒤에 돌려준다. 엔진은 핸들을 돌려준 뒤(다음 매크로태스크)에 시작한다.
  - 시험이 엔진 시작 시점을 직접 확인한다.
  - 관문이 없어도 처음 시험은 journal I/O 순서 때문에 통과했다. 그래서 시점 시험을 따로 두었다.
- `workflowRef`는 간편 형식의 `--workflow`로 넘긴다. task 파일은 자기 `workflowRef`를 쓴다. CLI가 범용 작업 명령을 연결하기 전에는 값이 있으면 `invalid_arguments`다.
- 한 작업 공간에 실행 하나(잠금, P-4)는 그대로다. 한 프로세스가 서로 다른 작업 공간의 실행 여럿을 가질 수 있다(시험함).

### 5.2 진행 이벤트 구독 [구현 A-1]

```ts
export type RunEvent =
  | { readonly kind: "record"; readonly record: JournalRecord }   // 저장된 레코드, seq 순서
  | { readonly kind: "notice"; readonly text: MaskedText };       // 기록 밖 안내(Y-4). 결과 notices에도 있다

export interface RunObserver {
  onEvent?(event: RunEvent): void;                                   // 동기. 예외는 무시
  confirm?(request: ConfirmRequest, signal: AbortSignal): Promise<ConfirmAnswer>;  // 5.9, 단계 5
}
```

보장
1. 레코드 이벤트는 그 줄을 운영체제에 넘긴 뒤에 보낸다(`Journal.append` 계약). 받은 이벤트는 모두 journal에 있다.
2. `seq`는 1부터 하나씩 커진다. 빠진 번호로 유실을 알 수 있다.
3. 엔진이 끝까지 가면 마지막 레코드는 `run_finished`이고, `done`은 그 뒤에 풀린다.
   - 첫 레코드가 `run_started`라는 보장은 없다(2절).
   - 시작은 `handle.runId`로, 끝은 `done`으로 안다. `run_finished`를 끝으로 쓰지 않는다. 그 직후에는 result.json이 아직 없을 수 있다(R-1 L-3).
4. 관찰자의 예외와 느림은 실행 결과를 바꾸지 않는다.
5. **기록이 가리지 않는 필드는 다시 가린다(R-1 L-1).** 모델이 준 도구 이름과 호출 id는 기록에 그대로 있다.
   - 이벤트로 내기 전에 내장 도구가 아닌 이름은 `(unknown tool)`로 바꾸고, 호출 id는 실행의 가림 게이트로 다시 가린다. CLI 진행 줄과 같은 규칙이다.
   - 대상: `tool_decision`, `tool_result`, `file_changed`, `model_response`, 그리고 `model_request` 안의 이전 호출·결과.
   - 그 밖의 필드는 저장된 그대로다. 근본 수정(기록할 때 가림)은 엔진·계약 변경이다(10절 AC-D15).
6. 글에는 제어 문자가 있을 수 있다. 화면에 내기 전에 어댑터가 정리한다(`src/cli/text-safety.ts:25`와 같은 규칙).
7. 사람용 문장은 이벤트에 없다. 어댑터가 N-4 문구 카탈로그로 만든다.

- 지금은 `Journal.append`가 레코드를 돌려주지 않는다(AC-D3 미구현). 그래서 앱 계층은 append가 끝난 뒤 journal 파일에 새로 붙은 줄을 읽어 이벤트를 만든다. 저장된 줄과 같지만 이벤트마다 읽기가 한 번 든다.
- 이벤트 내용 전체(모델 요청·응답·도구 결과 포함)를 보낸다. 무엇을 보여 줄지는 어댑터가 고른다.

### 5.3 취소 [구현 A-1]

- `handle.cancel()`은 엔진에 넘긴 신호를 끊는다. CLI의 SIGINT·SIGTERM·취소 파일과 같은 취소 출처(`cancel.ts`)를 쓴다. 앱 계층은 프로세스 신호 처리기를 달지 않는다.
- 의미는 지금과 같다(architecture 9절, M-11).
  - 진행 중인 모델 요청을 끊고 자식 명령 트리를 끝낸다.
  - 상태는 `cancelled`/`cancelled`, 종료 코드 5다.
  - 적용된 변경은 남는다. 되돌리기는 `revert`로 한다.
- 끝난 뒤의 `cancel()`은 아무 일도 하지 않는다.
- **시작 전 취소(R-1 L-2).** `startRun`이 응답하기 전(실행 전 검사 중)에는 취소 대상이 없다.
  - 모든 어댑터는 시작을 알기 전에는 취소를 받지 않는다. GUI와 VS Code는 취소 단추를 그때까지 끈다.
  - 프로세스 밖 어댑터는 `started` 줄(6절)을 받은 뒤에만 취소 파일을 만든다. 취소 파일 감시는 시작할 때 한 번 즉시 확인하므로(`cancel.ts:30-33`), 미리 만들어 두면 시작하자마자 `cancelled` 실행이 생긴다.
  - CLI의 실행 전 Ctrl+C는 AC-D12(한계)로 남는다.

### 5.4 결과와 보고서 [구현 A-1]

- 실행 결과는 `EngineResult` 그대로다(`engine.ts:151-177`). 적용 결과는 범용 작업의 `ApplyResult`다(5.6). 어댑터마다 다른 결과 형식은 만들지 않는다.
- `report({ workspace, runId })` → `ReportOutput`(`commands.ts:62-71`). 작업 공간의 기록만 읽고 잠금을 잡지 않는다. 실행 중이면 `incomplete`(종료 3)다.
- Markdown 글은 어댑터의 표시 몫이다. CLI의 `renderReport`는 기록에서 온 글을 모두 인라인 코드나 코드 블록에 넣는다(`report.ts:350-437`).
  - 그래서 Markdown으로 열어도 원격 이미지 같은 주입이 없다(R-1 I-6).
  - VS Code가 보고서를 Markdown 문서로 여는 근거이므로, 이 성질을 바꾸지 않는다.
- 실행 목록(`listRuns`), `"latest"`는 N-7(N-C) 병합 뒤 더한다.

### 5.5 되돌리기 [구현 A-1]

- `revert({ workspace, runId })` → `RevertOutput`. 잠금, 해시가 같은 파일만 되돌림(R-7), `partial` 판정은 지금과 같다.
- `dryRun`(N-7)은 N-C 병합 뒤 더한다. 사람 확인은 두 번 호출이다: `dryRun: true` → 사람 확인 → `dryRun: false`. 두 호출 사이에 파일이 바뀌면 두 번째 호출이 해시 비교로 건너뛴다. 미리보기는 약속이 아니다.
- 적용 실행의 되돌리기(이동 되돌림, 보관함 복원)는 같은 함수가 적용 runId로 한다(GT 6.4절 7, DR-9).

### 5.6 계획 확인·적용·사람 확인 [가정 G-A] (DR-1, DR-2)

계획 승인은 실행 사이의 확인 하나다(GT-D4, DR-1). 실행 중 질문(5.9)으로 묻지 않는다.

```ts
// CodarynApp의 선택 함수. 범용 작업 명령이 생기면 채운다. 어댑터는 있는지 보고 화면을 연다.
plan?(request: { workspace: string; runId: string }): Promise<AppCallOutcome<PlanView>>;
applyPlan?(request: ApplyPlanRequest, observer?: RunObserver): Promise<{ ok: true; handle: ApplyHandle } | { ok: false; error: AppError }>;
review?(request: ReviewRequest): Promise<AppCallOutcome<ReviewOutputView>>;

interface PlanView { kind: "plan"; runId: string; digest: string; actions: readonly MaskedText[] }
interface ApplyPlanRequest { settings: StartRunRequest; planRunId: string; digest: string }  // 다이제스트 또는 앞 12자 이상
interface ApplyHandle { runId: string; cancel(): void; done: Promise<AppCallOutcome<ApplyResultView>> }
interface ReviewRequest { workspace: string; runId: string; decision: "accept" | "reject"; note: string | null }
```

흐름
1. 실행이 `needs-input`/`plan_pending`(종료 3)으로 끝난다. 작업 공간은 바뀌지 않는다.
2. 어댑터는 `plan`으로 계획 화면을 연다(이동 표, 개수, 폐기 목록, 다이제스트).
   - 계획 글은 `plan.json`을 앱 계층·CLI가 다시 가려 보여 준 것이다(DR-5).
   - 어댑터는 `plan.json`을 직접 읽지 않는다.
3. 사람이 승인하면 `applyPlan(settings, planRunId, digest)`를 부른다.
   - 해시는 GT의 다이제스트(`plan.json` 바이트의 SHA-256) 하나다(DR-1).
   - 적용 때의 정책·검증기는 그때의 사용자 설정과 task에서 읽는다(DR-5). 그래서 요청에 실행 설정(`settings`)을 담는다.
4. 적용은 새 실행이다. 실행과 같은 이벤트와 취소 통로를 갖는다(DR-2): 핸들의 `cancel()`과 관찰자의 이벤트. 프로세스 밖 어댑터는 `apply`에 `--events jsonl`, `--cancel-file`을 쓴다(6절).
   - 적용 취소의 끝 상태(`cancelled`와 그때까지 옮긴 목록, `revert` 안내)는 G-A가 정한다(R-1 L-7).
5. 실행이 `needs-input`/`awaiting_review`로 끝나면 어댑터는 확인 목록과 승인·반려를 보여 주고 `review`를 부른다(GT-D6). 판정은 `review.json`에 남고 결과의 끝 상태는 바꾸지 않는다.

- A-1에는 이 세 함수가 없다. CLI의 `plan`, `apply`, `review` 명령과 엔진(G-B~G-E)이 아직 없기 때문이다. 타입만 `src/app/types.ts`에 가정으로 두었다.

### 5.7 변경 비교 [구현 A-1] (DR-7)

두 어댑터 모두 **다시 가린 비교만** 보여 준다. 비교 내용은 앱 함수(그리고 CLI 명령, 9절)가 내준다. 어댑터는 스냅샷을 직접 읽지 않는다.

```ts
changes(request: { run: StartRunRequest; runId: string }): Promise<AppCallOutcome<ChangesOutput>>;

interface ChangesOutput { kind: "changes"; runId: string; masking: "current_secrets"; files: readonly ChangedFileView[] }
interface ChangedFileView {
  path: MaskedText;                    // 기록의 경로
  created: boolean;                    // 실행이 만든 파일(원본 없음)
  state: "as_run_left" | "changed_since_run" | "missing" | "unknown";
  before: MaskedText | null;           // 원본, 다시 가림
  after: MaskedText | null;            // 지금 내용, 다시 가림
  unavailable: null | "masked_path" | "snapshot_missing" | "not_text" | "too_large" | "unreadable" | "mask_failed";
}
```

- **무엇으로 가리나.** 같은 설정으로 실행하면 지금 등록될 비밀이다(GUI-D6 (a)).
  - 등록되는 것: task·설정의 `secretEnv`, 지금의 키, 변수 파일이 설정한 값.
  - 실행의 대응표는 실행이 끝나면 없다. 그래서 토큰 모양은 실행 때와 다를 수 있다.
  - 지금 등록하지 않은 값은 가려지지 않는다. 어댑터는 화면에 "현재 등록한 가릴 값 기준"이라고 쓴다.
- **비밀을 정하는 곳.** 앱 계층이 따로 정하지 않는다. CLI의 실행 전 단계 1~8을 그대로 돌리고, 조립 대신 멈춘다. 그래서 잠금·기록·파일을 만들지 않고 아무것도 보내지 않는다(시험함).
  - 설정이 지금 풀리지 않으면 그 오류(예: `secret_env_missing`)를 돌려주고 내용은 보이지 않는다.
  - 어댑터는 그때 결과의 `changes` 목록(경로만)으로 내려간다(GUI-D6 (b)).
- **원본.** 실행의 스냅샷이다. 경로마다 그 경로의 첫 `previousHash`와 해시가 같은 원본만 쓴다(`revertRun`과 같은 규칙). UTF-8 글만, `MAX_READ_BYTES` 이하만 보인다.
  - 기록의 경로에 토큰이 있으면 파일을 찾을 수 없어 `masked_path`다.
- **지금 파일.** 작업 공간 계층으로 읽는다(링크 해석, 루트·상태 디렉터리 검사). 해시로 `as_run_left`·`changed_since_run`을 가른다.
- 가림이 하나라도 실패하면 그 파일의 글을 내지 않는다(`mask_failed`). 경로를 가릴 수 없으면 호출 전체가 `internal_error`다.
- A-1의 스냅샷 읽기는 store가 문서로 밝힌 형식을 같은 규칙으로 읽는 임시 구현이다. store가 읽기 함수를 내보내면 바꾼다(7절 이행 4).

### 5.8 점검과 모델 목록

- `doctor({ configPath, varsFile, taskPath, workspace })` → `DoctorOutput` [구현 A-1]. 네트워크 없음.
- `models`는 실제 API에 접속한다(Y-2). 사람이 고를 때만 부른다. 앱 계층에는 아직 없다(이행 5).

### 5.9 권한 확인 질문 [제안, 단계 5 시작에 구현] (DR-1, DR-3)

실행 중 질문은 **권한 확인 하나**다. 계획 승인은 5.6이다.

```ts
export interface ConfirmRequest {
  readonly kind: "permission";
  readonly id: string;
  readonly callId: string;
  readonly tool: ToolName;
  readonly permission: PermissionKind;
  readonly subject: MaskedText;   // 실효 인자의 가림본 요약. 고정 문구와 가린 값만
}
export type ConfirmAnswer =
  | { readonly decision: "allow_once" }
  | { readonly decision: "deny" }
  | { readonly decision: "dismissed" };  // 답하지 않고 닫음: 기본값(거부)으로 기록
```

의미 (어댑터 공통, DR-3)
1. **질문을 만들 수 있는 것은 사용자 설정과 프로필뿐이다.**
   - task 파일은 질문을 만들 수 없다(M-9). task 형식은 자기 `policy`를 가지므로(`src/contracts/config.ts:32`) 이를 구분해야 한다.
   - "확인 후 허용" 표시(GT의 `confirm: true` 등)는 사용자 설정·프로필에서 온 규칙에만 붙을 수 있다. 설정이 거부한 것은 묻지 않고 거부한다.
2. **물을 수 없으면 거부다.** `confirm`이 없거나, 터미널이 아니거나, 답할 수 없으면 묻지 않고 거부하고 `by: "default"`로 기록한다.
3. **답은 그 한 번에만 쓴다.** `allow_once`는 그 호출 하나를 허용한다. "항상 허용"은 없다.
4. **답을 받은 뒤 실효 인자 검사를 다시 한다.** 기다리는 동안 작업 공간이 바뀔 수 있다(남은 자손 프로세스가 링크를 바꾸는 등). 그래서 정책 2차 판정(`engine/index.ts:456`)을 답 뒤에 다시 하고 통과해야 실행한다.
5. **시간.** 기다리는 시간도 `maxDurationMs`에 든다(AC-D6). 한도에 닿으면 질문이 끊기고 `budget-exhausted`/`max_duration`이다.
6. **취소.** 기다리는 중 취소면 `by: "cancelled"`, 실행은 `cancelled`다.
7. **기록.** 새 사건 두 개로 남긴다(DR-3).
   - `confirmation_requested { id, kind: "permission", subject }`
   - `confirmation_answered { id, decision, by: "user" | "default" | "cancelled" }`
   - `dismissed`는 `decision: "deny", by: "default"`로 기록한다.
- 질문 글은 가림본이다. 화면을 위해 복원하지 않는다.
- 구현은 단계 5 시작이다(DR-3). G-A는 `ask`, `EngineDeps.confirm`을 지금 넣지 않는다. A-1의 `RunObserver.confirm`은 타입만 있고 불리지 않는다.

### 5.10 오류 모델 [구현 A-1]

| 층 | 언제 | 표현 | 종료 코드(CLI) |
| --- | --- | --- | --- |
| 실행 전 오류 | `startRun`·`report`·`revert`·`changes`·`doctor`가 아무것도 바꾸기 전에 멈춤 | `AppError { code: CliErrorCode; message }`. 기록 없음 | `CLI_ERROR_EXIT_CODES[code]`(`engine.ts:90-117`) |
| 실행 결과 | 엔진이 끝까지 감 | `EngineResult`의 `status`·`reason`. 오류가 아니다 | `RUN_EXIT_CODES`(`engine.ts:78-84`) |
| 실행 중 내부 예외 | 시작 뒤 앱 계층이나 엔진이 던짐 | `RunOutcome { ok: false, error: { code: "internal_error" } }`. 예외 문구·스택은 버린다(S-6). 잠금은 푼다(시험함) | 70 |
| 어댑터 전송 오류 | 프로세스 밖 어댑터만: 자식 실행 실패, 출력이 계약과 다름, 자식이 결과 없이 끝남 | 어댑터 쪽 코드(예: `adapter_spawn_failed`, `adapter_protocol_error`). CLI 오류 코드 표에 넣지 않는다 | 해당 없음 |

- `AppError`는 CLI의 `CliErrorOutput`에서 봉투(`schemaVersion`·`kind`·`exitCode`)만 뺀 것이다.
  - 봉투 밖의 필드는 그대로 둔다. N-A가 더하는 입력 진단(`diagnostic`, N-6)도 잃지 않는다.
  - `toCliError`/`fromCliError`로 양방향 변환한다. 코드 이름과 종료 코드 대응은 바꾸지 않는다(모든 코드를 시험함).
- `message`는 고정 문구, 필드 위치, 개수만 쓴다(S-3, S-6, N-6). 사람용 문장은 어댑터가 코드로 N-4 카탈로그에서 찾는다(N-5).
- 앱 계층이 새 실행 전 오류를 만들면 `CliErrorCode`에 더하는 계약 변경이다(역할 1).

## 6. 프로세스 밖 어댑터용 줄 프로토콜 [제안]

VS Code 확장(VX-D1 B)과, 독립 GUI가 같은 방식을 고를 경우에 쓴다. 같은 프로세스 어댑터는 5절 함수를 직접 쓴다.

- 선택 옵션
  - `--events jsonl`: stderr에 사람용 줄 대신 JSON 한 줄씩 이벤트를 쓴다. `run`과 `apply`가 받는다(DR-2).
  - `--confirm stdio`: 권한 질문을 stderr 이벤트로 내고 답을 stdin에서 한 줄씩 읽는다. `run`만 받는다(적용에는 모델이 없다). `--events jsonl`이 있어야 한다.
  - `--cancel-file`: 지금처럼 `run`이 받고, `apply`도 받는다(DR-2).
- stdout은 바뀌지 않는다. 끝에 결과 JSON 한 줄이다(`run`은 `CliOutput`, `apply`는 G-A의 출력). 종료 코드도 같다.
- stderr 줄 형식(한 줄에 객체 하나, UTF-8, LF)

```
{"schemaVersion":1,"kind":"started","runId":"<runId>"}                      ← 시작 직후 한 번
{"schemaVersion":1,"kind":"event","event":{"kind":"record","record":{…}}}   ← 5.2의 RunEvent(다시 가린 것)
{"schemaVersion":1,"kind":"confirm","request":{…}}                          ← 5.9의 ConfirmRequest
```

- stdin 줄 형식: `{"schemaVersion":1,"kind":"answer","id":"<질문 id>","answer":{"decision":"allow_once"|"deny"|"dismissed"}}`.
  - 형식이 틀린 줄, 모르는 id, 이미 답한 id는 무시한다. 기다리던 질문은 계속 기다린다.
  - `dismissed`는 사람이 답하지 않고 닫았다는 뜻이고 `by: "default"` 거부로 기록한다(R-1 L-2: 답 줄로 "기본값"을 표현할 수 있게 함).
- stdin이 끝나면(EOF) 남은 질문과 이후 질문은 답이 없는 것이다(R-1 L-2).
  - CLI는 그 질문을 기록하기 전에 취소 출처를 한 번 확인한다.
  - 취소가 와 있으면 `by: "cancelled"`(실행은 `cancelled`), 아니면 `by: "default"` 거부다.
- 어댑터가 실행 중에 꺼질 때는 **취소 파일을 먼저 만들고 그 뒤에 stdin을 닫는다.** 그러면 창 닫기가 어느 어댑터에서든 `cancelled`로 기록된다.
- 실행 전 오류이면 `started`가 나오지 않고 stdout의 오류 JSON 한 줄로 끝난다. 어댑터는 `started`를 받은 뒤에만 취소 파일을 만든다(5.3).
- Windows에서 부모가 보낸 SIGINT는 자식의 처리기를 거치지 않고 강제 종료가 된다고 알려져 있다 [추정, 확인하지 않음]. 그래서 취소는 파일 방식이다(AC-D9).
- 이 프로토콜은 로컬 웹 서버가 아니다. 듣는 소켓이 없고, 자식은 실행 하나가 끝나면 끝나며, 부모(어댑터)보다 오래 살지 않는다(DR-8).

## 7. CLI 이행 계획 (N-13, UX-D2)

### 7.1 바꾸지 않는 것 (완료 기준: 같은 입력에 같은 결과)

- stdout: `run`·`revert`·오류는 JSON 한 줄, `report`·`doctor`·`models`·도움말·버전은 글(`--json`이면 JSON 한 줄). 기존 통합 시험의 출력과 바이트 단위로 같아야 한다.
- 종료 코드 표 다섯 개: `RUN_EXIT_CODES`, `CLI_ERROR_EXIT_CODES`, `REVERT_EXIT_CODES`, `REPORT_EXIT_CODES`, `DOCTOR_EXIT_CODES`.
- 실행 전 검사의 순서와 오류 코드·문구(`run.ts:6-16`의 1~8단계).
- stderr 진행 줄(N-C가 자기 결정으로 바꾸는 것은 예외).
- **DR-4의 두 경우를 시험으로 지킨다.** A-1에 유닛이 있다. 이행 2 이후 CLI 경로에서도 같은 시험을 둔다.
  1. Windows에서 `secretEnv`의 이름이 환경 변수와 대소문자만 다를 때 지금처럼 찾고 가린다.
  2. 변수 파일이 설정한 허용 목록 변수(`LANG` 등)가 자식 명령에 그 값으로 간다.

### 7.2 단계와 A-1의 상태

| 이행 | 내용 | 바뀌는 파일 | A-1의 상태 |
| --- | --- | --- | --- |
| 1 계약 | `src/contracts/app.ts`(4·5절 타입), `Journal.append` 반환값(AC-D3), 질문 사건 타입 | `src/contracts/**`, `docs/cli-contract.md`(역할 1) | 타입이 `src/app/types.ts`에 있다. 옮기기는 역할 1 몫 |
| 2 앱 계층 추출 | `run.ts`의 2~8단계를 `src/app`으로. `runCli`는 인자 → `startRun` → 출력만 | `src/app/**`, `src/cli/run.ts`, `src/cli/assemble.ts`, 관련 유닛의 import | 조립은 앱 계층의 것이 생겼다(DR-4). 실행 전 검사는 아직 `runCli` 호출 |
| 3 이벤트와 취소 | CLI 진행 줄을 관찰자로, Y-4 안내를 앱 계층 `notice`로, 신호·취소 파일을 `handle.cancel()`로 | `src/cli/progress.ts`, `src/cli/cancel.ts`, `src/cli/main.ts` | 앱 계층 쪽은 됨(이벤트, 다시 가림, notice, cancel). CLI는 아직 쓰지 않음 |
| 4 읽기 명령 | `report`, `revert`, `runs`(+`dryRun`, `latest`), `changes`(새 CLI 명령)를 앱 계층 함수로. store가 스냅샷 읽기를 내보냄 | `src/cli/report.ts`, `src/cli/revert.ts`, `src/cli/runs.ts`, `src/store/**`, `src/app/**` | `report`, `revert`, `changes`는 앱 함수가 있다. N-7 항목은 병합 뒤 |
| 5 점검·모델 | `doctor`, `models`를 앱 계층으로 | `src/cli/doctor.ts`, `src/cli/models.ts` | `doctor` 감싸기만 있다 |
| 6 줄 프로토콜 | `run`·`apply`의 `--events jsonl`, `run`의 `--confirm stdio`, `apply`의 `--cancel-file` | `src/cli/args.ts`, `src/cli/run.ts`, `src/cli/events.ts`(신규), `src/contracts/**` | 없음 |
| 7 범용 작업 연결 | `plan`, `applyPlan`, `review`를 앱 계층에(5.6) | `src/app/**`, G-E의 CLI | 타입만(가정 G-A) |
| 8 권한 질문 | 정책 "확인 필요", `EngineDeps.confirm`, 답 뒤 재판정, 질문 사건, CLI 터미널 질문(stderr에 묻고 stdin에서 읽음) | `src/engine/**`, `src/policy/**`, `src/contracts/**`, `src/cli/**` | 단계 5 시작(DR-3) |

- 순서 제약: N-A(`claude/workspace-policy`)가 `src/cli/run.ts`를 고치는 중이다. 이행 2는 N-A 병합 뒤에 시작한다.
- 각 이행은 따로 병합한다. 이행 2는 동작을 바꾸지 않는 이동만 한다.

## 8. 시험 계획

유닛(`tests/unit/app/`, 대본 모델과 임시 디렉터리) [구현 A-1, 29건]

| 대상 | 시험 |
| --- | --- |
| 시작 | 핸들이 첫 이벤트·엔진 시작보다 먼저 온다. 실행 전 오류는 이벤트도 실행 디렉터리도 없다. 잠긴 작업 공간은 `workspace_locked`, 다른 작업 공간은 병행 |
| 이벤트 | 레코드 이벤트 = journal 줄(순서·내용). 던지는 관찰자는 결과를 바꾸지 않는다. 모델이 준 이름·id에 든 비밀이 이벤트에 없고 모르는 도구는 `(unknown tool)`이다(L-1). Y-4 안내는 마지막 레코드 뒤 `notice` |
| 취소 | `cancelled`·종료 5·변경 유지, 끝난 뒤 무효, 요청의 취소 파일 |
| 결과·오류 | `done`이 풀리면 result.json이 있고 잠금이 없다. 시작 뒤 내부 예외는 `internal_error`와 잠금 해제(예외 문구 미노출). 모든 오류 코드의 종료 코드·형태와 양방향 변환 |
| 환경(DR-4) | 사본·`lookupEnv`의 대소문자 규칙, 변수 파일 해석이 `process.loadEnvFile`과 같음, 호출자의 env와 `process.env`가 바뀌지 않음, 소문자 `secretEnv`가 Windows 규칙에서 찾아지고 가려짐(다른 OS 규칙에서는 `secret_env_missing`), 변수 파일의 `LANG`이 자식 명령에 감 |
| 비교(DR-7) | 원본·지금 내용이 지금 등록한 비밀로 가려짐, 나중 편집·삭제의 상태, 실행·잠금을 만들지 않음, 설정이 풀리지 않으면 그 오류 |
| 조립 | 보호 경로가 있으면 무결성 점검 사건이 그대로 온다 |
| 읽기 명령 | `report`(complete, `run_not_found`), `revert`, `doctor`(12개 항목, W-5) |

- 시험의 힘을 변이로 확인했다. 아래 셋은 각각 관련 시험이 실패했고, 되돌린 뒤 통과했다.
  - 변수 파일을 사본 대신 호출자 env에 적재
  - 엔진 시작 관문 제거
  - `parentEnv` 제거
- 통합(남은 것): 줄 프로토콜(이행 6)은 실제 CLI 프로세스를 대본 모델로 실행해 `started` → 이벤트 → stdout 결과 한 줄, stdin EOF와 취소의 `by` 값을 확인한다.

## 9. 다른 문서와 맞출 점

- [architecture.md](../architecture.md): 2절 모듈 표에 `app`을 더한다. 1절에 DR-8의 단일 프로세스 조건을 적는다(D3 담당).
- [cli-contract.md](../cli-contract.md)(N-A 소유) — 새 명령·옵션:
  - `--workflow`(DR-2), `--events jsonl`·`--confirm stdio`(6절), `apply`의 `--cancel-file`
  - `changes` 명령(DR-7): 인자는 `run`과 같은 설정, `--run <id>`, `--json`. 출력은 `ChangesOutput`
  - 질문 사건(5.9)
  - 종료 코드 절은 바뀌지 않는다.
- [범용 작업](general-tasks.md)(P4-G):
  - 7.3절의 GT-D9를 DR-3에 맞춘다. 기록은 새 사건 둘, 거부는 `by: "default"`, `confirm: true`는 사용자 설정·프로필의 규칙에만, 답 뒤 재판정, 단계 5 시작.
  - `plan`·`apply`·`review`의 출력 객체가 정해지면 5.6의 가정 타입을 바꾼다.
  - `ApplyResult`의 취소 끝 상태(R-1 L-7).
- [독립 GUI](standalone-gui.md)(P5-U):
  - 끝은 `run_finished`가 아니라 `done`으로 안다(R-1 L-3, 5.2 보장 3).
  - 비교는 `changes`, 계획은 5.6, 시작 전 취소 비활성(5.3), 창 닫기는 취소 뒤 EOF(6절).
- [VS Code 확장](vscode-extension.md): 이 판과 같은 날 함께 고쳤다(DR-1, DR-2, DR-7, L-2, L-4).
- [privacy.md](../privacy.md):
  - 이벤트는 기록을 다시 가린 것이다(5.2 보장 5).
  - 비교는 "지금 등록한 비밀"로 다시 가린다. 실행 뒤에 등록하지 않은 값은 가려지지 않는다는 한계가 있다(5.7).
  - 질문 글은 복원하지 않는다.
- 엔진·계약 담당: 기록할 때 모델이 준 이름·id를 가리거나 제한한다(AC-D15). 엔진은 이 값을 다음 모델 요청에도 그대로 보낸다(`model_request`의 메시지).
- N-C(`src/store`): 스냅샷 읽기 함수를 내보내면 앱 계층의 임시 읽기를 없앤다(5.7).

## 10. 결정

### 10.1 채택된 결정 (PM, R-1 반영)

| 번호 | 내용 | 비고 |
| --- | --- | --- |
| AC-D1 | 앱 계층은 새 모듈 `src/app` | 채택. A-1 구현 |
| AC-D2 | 이벤트는 가림본 `JournalRecord` | 채택. R-1 L-1로 모델이 준 필드만 다시 가림(5.2) |
| AC-D3 | `Journal.append`가 저장한 레코드를 돌려줌 | 채택. 이행 1. 그 전에는 파일 다시 읽기 |
| AC-D4 | 확인 질문 타입을 먼저 정함 | DR-1로 바뀜: 권한 질문만. 계획은 5.6 |
| AC-D5 | 권한 질문은 사용자 설정이 둔 것만, 한 번만, 저장 없음 | DR-3로 구체화: task 파일 제외, 답 뒤 재판정, 새 사건 둘, 단계 5 시작 |
| AC-D6 | 대기 시간은 실행 시간 한도에 듦 | 채택 |
| AC-D7 | 프로세스 밖 이벤트는 `--events jsonl`로 stderr | 채택. DR-2로 `apply`에도 |
| AC-D8 | 프로세스 밖 질문 답은 `--confirm stdio`, EOF면 거부 | 채택. R-1 L-2로 `dismissed`와 EOF 때의 취소 확인을 더함(6절) |
| AC-D9 | 프로세스 밖 취소는 기존 `--cancel-file` | 채택. DR-2로 `apply`에도 |
| AC-D10 | CLI 터미널 질문은 stderr에 묻고 stdin에서 읽음 | 채택(이행 8) |
| AC-D11 | 실행마다 CLI 자식 하나는 단일 프로세스 원칙 안 | DR-8로 문장 변경: 듣는 소켓 없음, 어댑터보다 오래 사는 프로세스 없음 |
| AC-D12 | CLI 실행 전 Ctrl+C는 한계로 기록 | 채택. 다른 어댑터는 시작 전 취소를 받지 않음(5.3) |
| DR-4 | 대소문자 무시 조회와 명령의 부모 환경 | A-1 구현, 7.1 완료 기준 |
| DR-7 | 비교는 다시 가린 것만, 내용은 앱·CLI 함수가 | A-1에 앱 함수. CLI 명령은 이행 4 |

### 10.2 결정 필요

| 번호 | 선택지 | 권고 | 근거 |
| --- | --- | --- | --- |
| AC-D13 | 비교에서 설정이 지금 풀리지 않을 때: (a) 오류를 돌려주고 어댑터가 경로 목록으로 내려감 (b) 가리지 않은 글을 줌 | (a) | 가림본만 보인다는 원칙. GUI-D6의 내려가기와 같다. A-1이 (a)로 구현했다 |
| AC-D14 | 비교의 비밀 출처: (a) 같은 설정으로 실행하면 지금 등록될 값 (b) 실행 때의 값을 따로 저장 | (a) | (b)는 비밀 값을 디스크에 남긴다. 대응표는 실행 단위 메모리라는 원칙(privacy) |
| AC-D15 | 모델이 준 도구 이름·호출 id: (a) 앱 계층이 이벤트에서 다시 가림(지금) (b) 엔진이 기록할 때 가리거나 제한 | (b)로 고치고 (a)는 남김 | 기록·보고서·모델 요청 모두에 그 값이 남는다. (a)는 이벤트만 막는다 |
| AC-D16 | 앱 계층이 CLI 함수를 부르는 임시 의존(`app` → `cli`) | 이행 2까지 허용 | 보안 검사를 복사하면 두 벌이 갈라진다 |
