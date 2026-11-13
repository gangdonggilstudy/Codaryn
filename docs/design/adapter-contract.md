# 어댑터 계약 (엔진 쪽)

CLI와 독립 GUI가 엔진을 부르는 공통 계약을 설계한다. 다룰 것은 다음과 같다.

> **DR-20(사용자 결정, 2026-11-12): VS Code 확장은 개발하지 않는다.** 독립 GUI 하나만 만들고(Electron, Windows 11 64비트 먼저), 플러그인과 같은 편의성을 그 GUI가 갖는다. GUI는 Electron의 **엔진 전용 프로세스가 앱 계층 함수를 직접 부르는 형태**가 기준이다(standalone-gui 5.1). 그래서 이 문서의 VS Code 확장과 프로세스 밖 줄 프로토콜(6절, AC-D7~D9) 서술은 **추진하지 않는다**. 내용은 참고용으로 남긴다. 이미 커밋된 `src/cli/protocol/`(`3c09b58`)와 `vscode/src/core`(`11d5676`)는 DR-20 때는 남겨 두었다가, 사용자 결정 DR-66(2026-11-13)으로 그 코드와 그 시험을 지웠다(U-81, 설계 차이 조사 [D-1](../reviews/2026-11-13-adapter-design-gap-survey.md)).
- 실행 시작, 진행 이벤트 구독, 취소, 결과, 보고서, 되돌리기
- 계획 확인·적용·사람 확인, 변경 비교
- 권한 확인 질문, 오류 모델
- 현재 CLI를 이 계약으로 옮기는 순서

- 기준: 설계는 main `b386166`(2026-11-12)에서 썼다. 작업 지시: [단계 4·5 설계 작업 지시](../work-orders/phase-4-5-design.md) P5-A.
- 이 판은 [설계 교차 검토 R-1](../reviews/2026-11-12-r1-review-stage-4-5-designs.md) 뒤 PM 결정 DR-1~DR-4, DR-7, DR-8(main `f39593f`)과 DR-10, DR-12(main `2fcc85b`)를 반영했다.
- 앱 계층 구현 A-1(`f1e796b`, `850626e`)과 R-4 뒤 결정 DR-15(이벤트), DR-17(task 형식과 G-A 타입), DR-14(실행 목록·`latest`·되돌리기 미리보기·`changes` 명령)의 구현(`1c86ec6`, `9235368`, `ebf3a64`, `0bc6bad`) 상태도 반영했다.
- 입력: [아키텍처](../architecture.md) 1·2·4·9절, [설계 결정](../decisions.md) M-2·M-9·M-11, [CLI 계약](../cli-contract.md) 2·8절, [UX 설계](ux-design.md) UX-D1·UX-D2, [사용성 개선 지시](../work-orders/phase-4-usability.md) N-5·N-7·N-11·N-13, [범용 작업](general-tasks.md) 4·6·7·8절.
- 위 세 줄은 설계를 쓸 때의 기록이다. 그 뒤의 단위(U-1~U-72)가 바꾼 것은 각 절에 적었다.
  - 이 문서와 지금 앱 계층의 대조는 [설계 차이 조사](../reviews/2026-11-13-adapter-design-gap-survey.md)(main 86a9470)에 있다.
  - 이 판은 그 조사의 낡은 곳을 고쳤다(U-72).
- 계약(`src/contracts`)은 그 뒤 여러 단위가 바꾸었다. 계약 변경은 역할 1(계약 담당)이 만든다.
  - 앱 계층의 요청·응답 타입은 `src/contracts/app.ts`에 있다(7.2 이행 1a, U-254). `src/app/types.ts`는 다시 내보내기만 한다.
  - 남은 이행(1b~5)은 사용자 결정 DR-65로 한다. 기능 뒤에 직렬로 한다(7.2).
- 실제 API는 호출하지 않았다. 앱 계층의 시험은 대본 모델과 가짜 값만 쓴다.

표기
- 성격: **[확정]** 사용자 확정 요구, **[선택]** PM 설계 선택(AC-D·DR 결정 포함), **[제안]** 이 문서의 안, **[미정]** 결정 전.
- 상태: **[구현 A-1]** `src/app`에 코드와 유닛 시험이 있다. **[가정 G-A]** 범용 작업 계약(G-A)이 아직 없어 형태를 가정했다. G-A 커밋이 나오면 병합해 그 타입으로 바꾼다.
- 근거: **[코드]** 코드를 읽어 확인한 것, **[추정]** 확인하지 않은 것.
  - 2절의 파일:줄은 설계 당시의 main `b386166`이다(R-1이 줄까지 대조함). 다른 절에서 따로 적지 않은 파일:줄도 그 판이다. 지금 판의 근거는 위 조사를 본다.

## 1. 목표와 원칙

- [확정] 엔진은 하나이고 CLI·GUI·IDE는 어댑터다(decisions M-2, U-2). 단계 5 완료 기준은 다음과 같다(roadmap 단계 5).
  - 두 어댑터가 CLI와 같은 엔진·정책·기록을 쓴다.
  - 어댑터에 작업 논리가 없다.
  - 확인 질문과 취소가 CLI와 같은 의미로 동작한다.
- [선택] GUI 전에 엔진 쪽 어댑터 계약을 정하고 CLI도 그 계약으로 옮긴다. ~~VS Code 확장을 먼저 만든다~~(DR-20으로 추진하지 않음: 독립 GUI 하나). 로컬 웹 서버는 쓰지 않는다(N-13, UX-D1, UX-D2).
- [선택] 단일 프로세스 원칙의 조건은 두 가지다(DR-8).
  - 듣는 소켓이 없다.
  - 어댑터보다 오래 사는 프로세스가 없다.
  - 프로세스 밖 어댑터는 실행마다 CLI 자식 하나를 쓴다(DR-20으로 추진하지 않음. GUI의 엔진 전용 프로세스는 앱 계층 함수를 직접 부른다).
- 계약의 원칙
  1. **어댑터는 입력과 표시만 한다.** 입력 해석, 보안 검사, 조립, 실행 수명, 결과 저장은 어댑터 아래의 공통 계층(이하 "앱 계층")이 한다.
  2. **CLI의 외부 계약은 그대로다.** stdout의 출력 하나(JSON 한 줄 또는 글), 오류 코드, 종료 코드, 실행 전 검사 순서를 바꾸지 않는다.
  3. **기록된 것만 알린다.** 진행 이벤트는 journal에 쓴 레코드다. 다만 기록이 가리지 않는 필드는 다시 가린다(5.2).
  4. **권한은 사람의 설정에서만 온다.**
     - 요청 객체에 키, API 주소, 정책·한도 확대 필드가 없다(C-1, C-5, M-9).
     - 권한 질문은 사용자 설정과 프로필만 만들 수 있다. 답은 한 번의 호출만 허용한다(DR-3).
  5. **같은 의미.** 취소와 질문은 어느 어댑터에서든 같은 종료 상태, 같은 기록을 남긴다.
  6. **어댑터는 저장 형식을 읽지 않는다.** 스냅샷, `plan.json`, 기록 파일의 형식은 앱 계층과 CLI만 안다. 어댑터는 앱 함수나 CLI 출력만 쓴다(DR-7).

## 2. 설계 당시의 경계 (코드 근거, main `b386166`)

- 이 표는 설계를 쓸 때(main `b386166`)의 경계다. 이행을 정한 근거로 남긴다.
- 그 뒤에 바뀐 것: 앱 계층이 생겼고(`src/app`), 실행 단위 안내(Y-4)는 앱 계층의 `notice` 이벤트로도 온다. 확인 질문이 "없다"는 지금도 같다(5.9).
- 지금의 경계와 남은 이행은 3절과 7.2를 본다.

| 경계 | 설계 당시 | 근거 [코드] |
| --- | --- | --- |
| 엔진 진입점 | `runTask(deps: EngineDeps) => Promise<EngineResult>` 하나 | `src/contracts/engine.ts:223-252`, `src/engine/index.ts:165` |
| 엔진의 의존 | `contracts`와 자기 파일만 import한다 | `src/engine/index.ts:26-65` |
| 실행 전 해석·보안 검사 | 인자, 변수 파일, 키 검사, 설정·task 해석, 작업 공간·설치 위치, 파일 위치, 비밀 등록, 모델 생성이 모두 CLI 안에 있다 | `src/cli/run.ts:172-373`(순서 주석 `:6-16`) |
| 조립 | 작업 공간 → 잠금 → 게이트 → 실행기 → 변경 기록기 → 도구 → 검증기 → journal → 무결성 | `src/cli/assemble.ts:126-188` |
| 결과 저장과 잠금 해제 | `finish(result)`가 result.json을 쓰고 잠금을 푼다 | `src/cli/assemble.ts:176-182`, `src/cli/run.ts:394-401` |
| 프로세스 사실의 주입 | env, cwd, 파일 읽기, 변수 파일 적재, 시계, 난수, 진행 출력, 취소 신호를 `CliEnvironment`로 받는다 | `src/cli/run.ts:62-99` |
| 프로세스 전역 사용 | `process.loadEnvFile`(process.env를 바꿈), SIGINT·SIGTERM 처리기, `import.meta.url`로 설치 위치, stderr·stdout·exitCode | `src/cli/main.ts:101`, `:129`, `:140-148`, `:68`, `:137-139`, `:153-155` |
| 환경 이름 조회 | `io.env[이름]`으로 직접 찾는다. Windows에서 대소문자를 무시하는 것은 `process.env`의 성질에 기댄 것이다(R-1 M-3) | `src/cli/run.ts:337`. 접어서 비교하는 곳은 S-4뿐(`src/cli/security/env.ts:51`. 지금은 `src/app/input/security/env.ts`의 `fold`, 이행 C-3a) |
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
어댑터: CLI (src/cli) | 독립 GUI(Electron 엔진 전용 프로세스, DR-20)   [VS Code 확장: DR-20으로 추진하지 않음]
   │  startRun · RunObserver · cancel() · report · revert · changes · plan · applyPlan · review · doctor
   ▼
앱 계층 (src/app)
   ├ 입력 해석과 실행 전 보안 검사 (지금은 CLI의 runCli를 부른다. 이행 2에서 옮겨 온다)
   ├ 조립 (A-1부터 앱 계층의 것. 명령의 부모 환경은 실행의 환경 사본, DR-4.
   │       DR-38: journal·변경 기록기·계획 기록기는 store의 createRunRecorders로 만들고 그 stateGuard를 엔진에 넘긴다.
   │       적용 실행은 CLI의 runApply가 조립한다)
   ├ 수명: 이벤트 전달(다시 가림), 취소, 질문 중계, 결과 저장, 잠금 해제, 실행 단위 안내(Y-4)
   └ 읽기: 보고서, 변경 비교(다시 가림), 계획 보기
   │  EngineDeps
   ▼
엔진 (src/engine): 반복, 한도, 가림 순서, 검증, 재수정, 무결성 — 바뀌지 않는다
   (권한 질문 연결은 단계 5 시작, 계획·적용은 G-B 이후)
```

- 앱 계층은 작업 논리를 갖지 않는다. "한 번의 실행을 안전하게 준비하고 끝내는 일"과 기록을 읽는 일만 한다.
- 앱 계층은 어댑터의 프로세스 안에서 함수로 불린다. 소켓, 포트, 데몬, 자기 파일 채널을 만들지 않는다.
- 쓰는 파일
  - 실행이 쓰는 것(`.codaryn/` 아래 잠금·기록·결과·스냅샷).
  - 사람이 확인한 설정 파일: `createSettings`, `applySettingsChange`, `selectModel`(5.11, 5.8).
  - 사람이 확인한 정리가 지우는 상태 디렉터리의 항목(5.4).
  - 그 밖의 파일은 쓰지 않는다.
- 의존 방향
  - 목표: `cli` → `app` → (`engine`, `store`, `tools`, `policy`, `privacy`, `verify`, `workspace`, `model`) → `contracts`.
  - 지금(이행 C-4 뒤, U-285. U-272가 main 6ef6e3a의 코드에서 센 수에서 C-3a~C-4가 옮긴 것을 뺐다): 두 방향이다.
    - `app` → `cli`: 앱 계층의 8파일이 CLI 모듈 15개를 부른다. 검사를 복사하지 않으려고 그렇게 했다(AC-D16). 실행의 조립(`createAssemble` 한 벌, U-237, 4절)은 C-4부터 `src/app/assembly.ts`에 있다. 앱의 감싸개(`src/app/assemble.ts`)는 아직 옛 자리 `src/cli/assemble.ts`의 다시 내보내기로 그것을 부르고, 그 파일에는 되돌리기 명령(`createRevertCommand`, C-9a)이 남아 있어 15개에 그대로 든다. 입력 층은 `src/app/input/`에 있다: 보안 검사·글 정리·설치 확인·실행 id·모델 글 꼴(C-3a), task·설정·설정 파일 위치·제공자 설정 해석, 쓰기 목록, 읽기 제외와 k, `runGuards`(C-3b). 옛 자리(`src/cli/security/index.ts`, `src/cli/settings.ts` 등)는 시험과 고정 파일, GUI가 경로로 부르는 곳을 위한 다시 내보내기다.
    - `cli` → `app`: `src/cli/changes.ts`와 `main.ts` 두 파일이 앱 계층의 명령을 부른다. 전에 있던 `protocol/*`는 DR-66으로 지웠다(U-81). C-3a 뒤로는 CLI의 다른 모듈도 `src/app/input/`과 `src/app/model-text.ts`를 가져온다(목표 방향).
  - 목표로 가는 이행 1~5(7.2)는 사용자 결정 DR-65로 한다. 기능 뒤에 직렬로 한다. 그때까지 AC-D16이 그대로 유효하다.
- 이름은 `src/app`이다(AC-D1 채택).

## 4. 앱 환경 [구현 A-1]

어댑터가 프로세스 사실을 넣는다. 앱 계층은 프로세스 전역(`process.env`, 신호, stdout)을 직접 만지지 않는다.

```ts
// src/contracts/app.ts (7.2 이행 1a, U-254. src/app/types.ts가 다시 내보낸다)
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
  readonly homeDir?: string | null;                  // N-1: 설정 파일의 기본 위치. 없거나 null이면 기본 위치 없음
  readonly osLocale?: string | null;                 // N-4, N-20: doctor의 언어 점검. 없으면 모름
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
  - 지금 CLI는 변수 파일을 `process.env`에 적재하고, 실행기는 거기서 허용 목록 변수를 자식 명령에 넘긴다. 사본으로 옮겨도 같은 결과가 나오게 넘긴다.
  - 실제로 자식에 가는 것은 값이 8자 미만인 허용 목록 변수뿐이다(R-4 I-1). 변수 파일이 새로 설정한 8자 이상 값은 비밀로 등록되고(S-4), 실행기는 등록 비밀이 든 변수를 자식 환경에서 뺀다(T-1). 그래서 변수 파일의 긴 `PATH`·`TEMP`는 CLI에서도 앱 계층에서도 자식에 가지 않는다.
  - 같은 프로세스 어댑터에서는 호스트의 환경이 자식에 새지 않는다.
  - 이를 위해 A-1은 조립을 앱 계층에 두었다(`src/app/assemble.ts`). CLI의 `assembleRun`과 순서가 같고 `parentEnv`만 다르다.
  - U-237(p4g의 R-108 H-2, na-core의 U-210과 함께): 조립은 한 벌이다. 앱의 실행은 CLI의 조립(`createAssemble`)에 앱의 고리(`parentEnv`, `platform`, `onAssembled`)를 주어 만든다. 앱이 따로 두던 사본은 같은 꼴로 두 번 뒤처졌다(U-186 앞의 쓰기 목록, U-210의 읽기 제외와 k). 이제 관문, 도구 실행기, 검증기, 무결성 대상, 수행하는 계획의 관문(`approvedPlan.policyFor`)이 모두 CLI와 같은 한 곳(`runGuards`)에서 실행의 읽기 제외 목록(모든 원천을 합친 것)과 k를 받는다. 풀지 못한 잠금은 CLI의 `finish`가 주는 표시(U-220)를 보고 `onLockLeft`로 알린다(U-193).
    - 시험 `tests/unit/app/u237-app-unreadable.test.ts`: 앱으로 실행하면 설정 파일의 목록 아래 읽기가 `unreadable_path`로 거부되고, 검색과 `query_table`이 그 아래를 빼며, 모델로 간 것과 기록 어디에도 표지(행, 이름, k보다 작은 묶음의 키)가 없다(`tests/support/private-canary.ts`). task 파일의 목록도 같다.

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
export type RunOutcome = { ok: true; result: EngineResult; lockLeft?: true } | { ok: false; error: AppError };  // 시작 뒤 내부 예외만 오류
export type StartOutcome = { ok: true; handle: RunHandle } | { ok: false; error: AppError };
```

- `startRun`은 `codaryn run`의 실행 전 검사를 같은 순서·코드·문구로 한다. A-1은 CLI의 `runCli`를 요청으로 만든 인자 목록으로 부른다.
- 실패하면 아무것도 만들지 않고 `AppError`를 돌려준다(`engine.ts:86-88`의 "실행 전 오류에는 기록이 없다").
- 성공은 잠금을 잡은 뒤에 돌려준다. 엔진은 핸들을 돌려준 뒤(다음 매크로태스크)에 시작한다.
  - 시험이 엔진 시작 시점을 직접 확인한다.
  - 관문이 없어도 처음 시험은 journal I/O 순서 때문에 통과했다. 그래서 시점 시험을 따로 두었다.
- `workflowRef`는 간편 형식의 `--workflow`로 넘긴다. task 파일은 자기 `workflowRef`를 쓰고, 둘을 함께 주면 CLI가 거부한다(R-14 I-4로 고침: 묶음 병합 뒤 CLI가 `--workflow`를 받는다).
- 한 작업 공간에 실행 하나(잠금, P-4)는 그대로다. 한 프로세스가 서로 다른 작업 공간의 실행 여럿을 가질 수 있다(시험함).
- U-186(DR-69 B-4, U-182 뒤): 앱 계층의 실행 조립(`src/app/assemble.ts`)도 task의 쓰기 경로 목록(`ResolvedTaskSpec.writablePathSets`, CLI의 `prepareTask`가 만듦)을 정책 관문에 준다. CLI의 실행과 같다. 그래서 GUI 실행에서도 목록 밖의 파일 도구 쓰기는 `path/path_not_writable`로 거부된다. task 파일의 목록과, task 파일 실행에 걸리는 설정 파일의 목록이 모두 그렇다(시험 `tests/unit/app/u186-writable-paths-app.test.ts`).
- U-193(U-176 뒤): 실행 끝에 잠금을 풀지 못하면(store의 짧은 다시 시도 뒤 던짐, 또는 `false`) 실행 결과는 그대로이고, `done`의 `RunOutcome`에 `lockLeft: true`가 붙는다.
  - 결과는 먼저 `result.json`에 쓴 그것이다. 결과 JSON의 기존 필드는 바뀌지 않는다.
  - 전에는 이 경우 결과가 있는데도 `internal_error`였다.
  - 잠금은 이 프로세스가 사는 동안 남는다. GUI는 엔진이 같은 프로세스라, 앱을 닫을 때까지 이 작업 공간의 다음 시작이 `workspace_locked`다. 앱이 끝나면 다른 프로세스의 다음 실행이 오래된 잠금으로 거둔다.
  - 앱은 풀지 못한 잠금을 나중에 다시 풀어 보지 않는다. 알리기(`lockLeft`)만 한다.
    - U-211이 넣으려던 "몇 초 뒤 다시 풀기"는 뺐다(PM 결정, Codex V-17 H-1과 V-17b). store의 풀기는 "잠금을 읽어 이 프로세스와 그 id인지 확인한다"와 "파일을 지운다"가 한 걸음이 아니다. 그래서 나중의 풀기가 확인한 뒤 지우기 전에 같은 잠금을 다른 길(store를 바로 부르는 풀기, 또는 사람이나 다른 프로그램이 지움)로 지우고 다음 실행이 잡으면, 나중의 풀기가 다음 소유자의 잠금을 지울 수 있다. 앱 안의 줄 세우기로는 앱 밖의 길을 막지 못한다. 안전이 먼저라 다시 풀기를 하지 않는다.
    - 그래서 GUI 글에도 "곧 다시 풀어 봅니다" 같은 약속을 넣지 않는다.
  - 사람용 글은 `lock.release_failed`(문구 id 초안, nc-human의 제안 글)다.
  - U-229(nc-human의 U-220 뒤): CLI의 조립 약속(`AssemblyOutcome.finish`)이 바뀌었다. 잠금을 풀지 못하면 `finish`는 던지지 않고 `{ lockLeft: true }`로 끝나고, 아무것도 주지 않으면 풀었다는 뜻이다. 앱의 조립도 그 표시를 준다. 앱의 답(`RunOutcome.lockLeft`)은 그대로이고, 표시는 CLI가 자기 끝 요약을 쓸 때 읽는다(시험 `tests/unit/app/u229-finish-lock-left.test.ts`).
    - 이동 계획의 적용은 CLI의 `runApply`가 잠금을 직접 잡고 푼다. U-220 뒤로는 풀지 못해도 적용 결과가 남지만(전에는 `internal_error`), 잠금이 남았다는 것은 CLI의 끝 요약에만 있고 `runApply`의 답에는 없다. 그래서 앱은 그것을 알지 못하고 `ApplyOutcome`에 `lockLeft`가 없다. CLI가 답에 실어 주면(nc-human에 바람) 앱이 실행처럼 알린다.
    - 되돌리기는 다르다. CLI의 답(`RevertCliOutcome.lockLeft`, U-220)에 실리므로 앱이 `revert`의 답에 `lockLeft: true`로 옮긴다(5.5, R-106 L-1).
    - R-106 I-5: 앱의 조립이 잠금을 잡은 뒤 실패하고 그 뒤의 풀기마저 던지면, 전에는 풀기의 오류가 조립 자신의 오류를 덮었다. 이제는 조립의 오류를 그대로 던진다(U-220 뒤 CLI의 조립과 같음). 잠금은 남는다. 시험 `tests/unit/app/u229-r106-lock-left.test.ts`.

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
1. **이벤트는 엔진이 기록에 넘긴 메모리의 사건으로 만든다(DR-15, R-4 H-1).** journal 파일을 다시 읽지 않는다.
   - 실행 중 허용된 명령(검증기 포함)은 상태 디렉터리의 journal 파일에 줄을 더할 수 있다. 그런 줄은 이벤트가 되지 않는다. 재현 시험이 있다(`tests/unit/app/r4-events.test.ts`).
   - 이벤트는 그 기록을 journal이 저장한 뒤(`append`가 끝난 뒤)에만 보낸다.
2. `seq`는 앱 계층이 1부터 센다. 새 실행의 journal을 store가 매기는 번호와 같다. `at`은 같은 시계로 읽는다(store의 줄과 몇 ms 다를 수 있다). 빠진 번호는 가릴 수 없어 보내지 않은 기록이다.
3. 엔진이 끝까지 가면 마지막 레코드는 `run_finished`이고, `done`은 그 뒤에 풀린다.
   - 첫 레코드가 `run_started`라는 보장은 없다(2절).
   - 시작은 `handle.runId`로, 끝은 `done`으로 안다. `run_finished`를 끝으로 쓰지 않는다. 그 직후에는 result.json이 아직 없을 수 있다(R-1 L-3).
4. 관찰자의 예외와 느림은 실행 결과를 바꾸지 않는다.
5. **모든 글 필드를 실행의 게이트로 다시 가린다(DR-15).** 같은 게이트로 이미 가린 글은 그대로 남는다(멱등).
   - 그 전에 어느 도구 목록에도 없는 이름은 `(unknown tool)`로 바꾼다(R-1 L-1). 대상은 `tool_decision`, `tool_result`, `model_response`와 `model_request` 안의 이전 호출·결과다.
   - U-250(이행 계획 P-2, R-80 I-1): 그 목록은 실행에 줄 수 있는 모든 도구다(`ALL_TOOL_NAMES`: 내장 넷과 작업 종류 도구 `inspect_files`, `propose_plan`, `propose_changes`, `query_table`). CLI의 진행 줄이 이름을 보이는 것과 같다. 전에는 내장 넷만 남겨 작업 종류 도구가 `(unknown tool)`로 보였다. 목록에 없는 이름(대소문자나 공백이 다른 것 포함)과 가릴 값은 그대로다. 지난 실행의 이벤트 쪽(`listRunEvents`)도 같은 함수(`sanitizeRecord`)를 쓴다. 시험 `tests/unit/app/u250-event-tool-names.test.ts`.
   - 가릴 수 없는 글이 하나라도 있으면 그 이벤트는 보내지 않는다(`seq`가 비어 보인다).
   - 엔진도 목록 밖 도구 이름과 안전하지 않은 호출 id를 기록할 때 바꾼다(AC-D15, G-A 브랜치 `0824dde`). 앱 계층의 다시 가림은 그 뒤에도 남긴다(DR-13).
6. 글에는 제어 문자가 있을 수 있다. 화면에 내기 전에 어댑터가 정리한다(`src/app/input/text-safety.ts`의 `cleanText`와 같은 규칙).
7. 사람용 문장은 이벤트에 없다. 어댑터가 N-4 문구 카탈로그로 만든다.

- 첫 판(A-1 `f1e796b`~`6aa3f44`)은 append 뒤 journal 파일에 새로 붙은 줄을 읽어 이벤트를 만들었다. 끼워 넣은 줄이 가리지 않은 채 관찰자에게 갔다(R-4 H-1, 재현됨). `1c86ec6`에서 위 1·2·5로 고쳤다.
- AC-D3(`append`가 저장한 기록을 돌려줌)가 생기면 `seq`·`at`을 그 값으로 바꾼다. 다시 가림은 그대로 둔다.
- 이벤트 내용 전체(모델 요청·응답·도구 결과 포함)를 보낸다. 무엇을 보여 줄지는 어댑터가 고른다.

### 5.3 취소 [구현 A-1]

- `handle.cancel()`은 엔진에 넘긴 신호를 끊는다. CLI의 SIGINT·SIGTERM·취소 파일과 같은 취소 출처(`cancel.ts`)를 쓴다. 앱 계층은 프로세스 신호 처리기를 달지 않는다.
- 의미는 지금과 같다(architecture 9절, M-11).
  - 진행 중인 모델 요청을 끊고 자식 명령 트리를 끝낸다.
  - 상태는 `cancelled`/`cancelled`, 종료 코드 5다.
  - 적용된 변경은 남는다. 되돌리기는 `revert`로 한다.
- 끝난 뒤의 `cancel()`은 아무 일도 하지 않는다.
- **시작 전 취소(R-1 L-2).** `startRun`이 응답하기 전(실행 전 검사 중)에는 취소 대상이 없다.
  - 모든 어댑터는 시작을 알기 전에는 취소를 받지 않는다. GUI는 취소 단추를 그때까지 끈다.
  - 프로세스 밖 어댑터는 `started` 줄(6절)을 받은 뒤에만 취소 파일을 만든다. 취소 파일 감시는 시작할 때 한 번 즉시 확인하므로(`cancel.ts:30-33`), 미리 만들어 두면 시작하자마자 `cancelled` 실행이 생긴다.
  - CLI의 실행 전 Ctrl+C는 AC-D12(한계)로 남는다.

### 5.4 결과와 보고서 [구현 A-1]

- 실행 결과는 `EngineResult` 그대로다(`engine.ts:151-177`). 적용 결과는 범용 작업의 `ApplyResult`다(5.6). 어댑터마다 다른 결과 형식은 만들지 않는다.
  - U-25 (DR-52): 가리기가 됐는지는 `EngineResult.masking { registeredValues, maskedPlaces }`(개수만)으로 `done`의 결과에 그대로 실린다. 가릴 값이 하나도 없으면 이 필드가 없다. 앱 계층은 실행의 게이트웨이를 `createPrivacyGateway`로 만들어 그대로 엔진에 넘기고(`assemble.ts`), 결과를 고르지 않고 넘긴다. `report`의 `result`에도 result.json에 적힌 같은 값이 실린다(CLI의 report가 그 필드를 지닌다).
  - U-55 (AXM-9): 모델 오류로 끝난 실행의 `EngineResult.modelError { kind, turn, retryable? }`도 `done`의 결과에 그대로 실린다. `retryable`을 알 수 없으면 빠진 채로 간다(`tests/unit/app/u55-error-facts.test.ts`). `report`의 `result`에 실리는지는 CLI의 report가 그 필드를 지니는지에 달렸다(CLI 몫).
- `report({ workspace, runId })` → `ReportOutput`(`commands.ts:62-71`). 작업 공간의 기록만 읽고 잠금을 잡지 않는다. 실행 중이면 `incomplete`(종료 3)다.
- `reportMarkdown({ workspace, runId })` → `{ kind: "report_markdown", markdown, exitCode }`(GU-3 보고서 저장).
  - `codaryn report`를 `--json` 없이 부른 글 그대로다. Markdown이고 모든 API 제공자의 키 값을 가린다.
  - 메인이 사람이 고른 파일에 쓰는 데만 쓴다. 창은 구조화된 `report`를 그린다. 이 글을 HTML로 그리지 않는다.
  - `-`로 시작하는 작업 공간이나 run id는 아무것도 읽기 전에 `invalid_arguments`다(깃발로 읽히지 않게).
- Markdown 글은 어댑터의 표시 몫이다. CLI의 `renderReport`는 기록에서 온 글을 모두 인라인 코드나 코드 블록에 넣는다(`report.ts:350-437`).
  - 그래서 Markdown으로 열어도 원격 이미지 같은 주입이 없다(R-1 I-6).
  - 어댑터(GUI)가 보고서를 Markdown으로 그려도 되는 근거이므로, 이 성질을 바꾸지 않는다.
- 모델이 쓴 글의 표시(U-42, R-59 I-1): `modelTextRows(text, { maxRows?, keys? })`와 `MODEL_TEXT_MAX_ROWS`(`src/app/model-text.ts`, 공개 표면 `src/app/index.ts`).
  - CLI `plan` 화면이 같은 글(계획의 `summary`)에 그리는 줄 그대로다(`renderPlan`). 순서는 이렇다.
    - 먼저 `keys`로 받은 키 값을 가린다. CLI가 지금 설정된 키 값을 가리듯이다.
    - 그다음 `quoteModelText`를 터미널이 아닐 때의 폭(`MODEL_TEXT_COLUMNS`)으로 부른다. 이 함수는 키 모양 가림, 공백 한 칸, 보이지 않는 글자 `?`, 제어 문자 바꿈, 공백에서 접기를 한다.
  - CLI의 따옴표 머리(`MODEL_TEXT_PREFIX`)는 뺀다. 창이 "에이전트의 말" 머리말 아래에 자기 모양으로 그린다.
  - 글 줄은 `maxRows`(기본 `MODEL_TEXT_MAX_ROWS` = CLI의 `FINAL_MESSAGE_MAX_LINES`, 20)까지이고, 나머지는 마지막 `… (+N)` 줄 하나로 센다. 그래서 많아야 `maxRows + 1`줄이다. 보일 것이 없으면 줄이 없다.
  - 그리기만 하고 등록 값은 가리지 않는다. 받는 글은 이미 가린 것(`PlanOutput.summary`처럼)이어야 한다.
  - 시험(`tests/unit/app/u42-model-text-rows.test.ts`)이 앱 계층으로 만든 실제 계획의 요약과 긴 글·키 값에서 CLI `renderPlan`의 줄과 같음을 고정한다.
  - GUI는 빌드의 `cli/human/format.js`를 경로로 읽는 대신 이것을 쓸 수 있다. 그 자리는 이행 C-3a 뒤로 `src/app/input/format.ts`를 다시 내보내는 옛 자리다. 그 전환은 GUI 담당의 몫이다.
- `report`와 `revert`의 run id 자리에 `"latest"`를 쓸 수 있다(N-7). 보고서는 CLI의 `runReport`가 store의 `listRuns`로 고른다.
- `listRuns({ workspace, limit? })` → `RunsOutput`, `resolveRun({ workspace, run })` → `{ runId, latest, startedAt, damaged }` [구현 DR-14].
  - 어떤 실행이 손상인지, `latest`가 어느 실행인지는 store와 CLI(`listRuns`, `latestRunId`, `resolveRunRef`)가 정한다(N-18, N-23, N-26). 앱 계층은 고르지 않는다.
  - `resolveRun`은 `--run latest`가 고른 실행과 시작 시각을 행동 전에 보이게 한다(N-23 b).
  - `runs --json`처럼 키 모양과 지금 키를 가린다(N-23 a).
- 상태 디렉터리 보기와 정리(DR-39, GU-4) [구현]. store의 `summarizeState`·`planCleanup`·`applyCleanup`을 앱 계층의 검사와 함께 낸다(`src/app/cleanup.ts`).
  - `stateSummary({ workspace })` → `{ kind: "state_summary", summary }`: 실행 id·종류·상태·시작 시각과 크기, 폐기 보관함과 parked 파일의 수와 크기. 사람의 파일 이름은 없다.
  - `previewCleanup({ workspace, selection })` → `{ kind: "cleanup_preview", now, plan }`: 무엇을 지울지(항목과 경고, 막힌 항목, 합계, 정리하지 않는 parked, 다이제스트). 아무것도 지우지 않는다. `now`는 `olderThanDays`를 센 때이고, 적용에 그대로 돌려준다.
  - `applyCleanup({ workspace, selection, now, confirmation: { digest, discarded, includeNotReverted } })` → `{ kind: "cleanup_applied", outcome }`
    - store가 잠금 아래에서 계획을 다시 만들고, 다이제스트가 확인한 것과 같을 때만 지운다. 아니면 `plan_changed`다.
    - 폐기 보관함(사람의 파일)은 `discarded: true`일 때만 지운다. 아니면 `not_confirmed`로 남는다.
    - DR-44 (a): 되돌리지 않았거나 일부만 되돌린 실행의 기록은 `includeNotReverted: true`일 때만 지운다. 아니면 `not_reverted_not_confirmed`로 남는다. 막지는 않는다. 미리보기의 `plan.totals.runs.notReverted`가 그 수다.
    - DR-44 (b)~(d): store의 경고(`partly_reverted`, 보관함이 남을 수 있을 때의 `discarded_left`, `leftover`), 남은 폴더 항목(target `leftover`, `leftoverId`), 남긴 까닭(`partly_removed`, `used_by_kept_apply`)을 그대로 넘긴다. 다 지우지 못한 것은 지웠다고 하지 않는다.
    - R-34b P-1: 기록을 확인할 수 없는(손상된) 실행은 `records_unreadable`이고, 되돌리지 않은 실행과 같이 `includeNotReverted`가 있어야 지운다.
    - U-193(U-176 뒤): 계약 `CleanupOutcome`의 ok 쪽에 `lockLeft?: boolean`이 있다(이 단위가 초안, p4g 확인). 정리는 끝났지만 잠금을 풀지 못했으면 `true`이고 상태는 바뀌지 않는다. 앱은 store가 준 값을 그대로 넘긴다. store가 채우는 일(지금의 `.catch(() => false)` 대신)은 nc-human 몫이라, 그 전에는 나오지 않는다(시험은 todo로 둠). 사람용 글은 `lock.release_failed`.
    - R-34b P-2: 정리가 남긴 표지(`cleanup-leftover.json`)가 없는 `cleanup-<16 hex>` 폴더는 지울 항목이 아니다. 요약의 `unknownFolders`로 보이기만 한다.
    - U-13 (UXM-1): 폐기 보관함에 파일이 남아 있는 적용 실행의 기록은, 그 보관함을 함께 지우기로 확인하지 않는 한(`discarded: true`이고 그 보관함도 고른 경우) 지우지 않는다. 그 실행은 `kept`에 `discarded_left`로 남고, 그 계획 실행은 `used_by_kept_apply`로 남는다. 나머지는 지운다. 앱 계층은 이 결과를 그대로 넘긴다.
    - U-22 (DR-48, AXM-3): 실행한 정리의 결과는 `status`(계약의 `cleanupStatusOf`: `removed`, `nothing_removed`, `partly_failed`)를 갖고, `outcome.ok`는 CLI의 JSON처럼 `removed`일 때만 참이다. 확인한 다이제스트가 계획의 것이 아니면 `cleanup_plan_changed`, 다른 작업이 잠금을 잡고 있으면 `workspace_locked`이고, 둘 다 결과가 아니라 호출 오류다. 거꾸로, 아무것도 지우지 못한 정리(`nothing_removed`)와 일부 실패한 정리(`partly_failed`)는 호출 오류가 아니라 결과다(호출은 `ok: true`, `outcome.ok`만 거짓이며 `removed`·`kept`와 이유가 있다, R-51 M-1). 어댑터는 `status`를 읽는다.
    - U-22 (DR-48, AXM-8): `report`·`changes`·`revert`의 `latest`는 가장 새 실행이다. 그 실행이 아직 돌고 있으면 앞에 끝난 실행이 있어도 CLI가 `run_in_progress`로 답한다(PM 결정, CLI 1de5b8a). 실행 id를 직접 주면 그 실행을 보인다. 앱 계층은 그 코드를 그대로 넘긴다. 앱의 `changes`(그리고 그것을 부르는 CLI `changes`)와 `resolveRun`도 같은 규칙이다(R-51 M-2: `runIdOf`가 CLI의 `resolveRunReference`를 쓴다).
    - 사람에게 묻는 것은 GUI 메인 프로세스다.
  - 인자는 읽기 전에 검사한다. 실행 디렉터리 이름 그대로(`isStoredRunId`), 0 이상의 정수 일수, `reverted: true`만, 모르는 필드 없음, 계약의 시각 꼴, 64자리 16진수 다이제스트, 참·거짓인 `discarded`와 `includeNotReverted`(둘 다 꼭 있어야 한다. 빼는 것은 동의가 아니다). 아니면 `invalid_arguments`다.

### 5.5 되돌리기 [구현 A-1]

- `revert({ workspace, runId, dryRun?, unsafeMoveConsent? })` → `RevertOutput` [구현 DR-14, DR-25 `ec1914d`]. CLI의 `runRevert`와 `createRevertCommand`를 `main.ts`와 같은 선택(미리보기, `latest`, 한 실행 판정 N-26·N-27 (a), 잠금 안의 되돌리기 기록)으로 부른다. 앱 계층에 되돌리기 규칙의 사본은 없다.
- U-229(R-106 L-1, U-220 뒤): 답은 `RevertCallOutcome`이다. 되돌리기를 마쳤는데 잠금을 풀지 못했으면 `output` 옆에 `lockLeft: true`가 붙는다. 출력은 풀었을 때와 같다. 전에는(U-220 앞) 이 경우가 `internal_error`였고, U-220 뒤 U-229 앞에는 아무 말 없이 성공이었다. 잠금은 이 프로세스가 사는 동안 남는다(5.1).
- DR-25: 하드 링크가 없는 드라이브에서 되돌릴 파일이 `unsafe_move`로 건너뛰어지면, GUI가 사람에게 따로 동의를 받는다. 동의하면 `unsafeMoveConsent: { runId }`로 다시 부른다.
  - 앱 계층은 CLI의 `AdapterRevert`로 `adapter` 경로의 동의만 넘긴다(`revertConsentOf`).
  - 미리보기와 함께, `latest`로, 다른 실행 id로 온 동의는 실행 전에 `invalid_arguments`다.
  - 되돌리기 기록(`revert.json`)에 경로 `adapter`가 남는다. 앱 계층의 되돌리기에는 터미널 질문이 없다.
- 사람 확인은 두 번 호출이다: `dryRun: true` → 사람 확인 → `dryRun: false`. 미리보기는 잠금도 기록도 만들지 않는다. 두 호출 사이에 파일이 바뀌면 두 번째 호출이 해시 비교로 건너뛴다. 미리보기는 약속이 아니다.
- 적용 실행의 되돌리기(이동 되돌림, 보관함 복원)는 같은 함수가 적용 runId로 한다(GT 6.4절 7, DR-9).

### 5.6 계획 확인·적용·사람 확인 [구현: 적용 `ec1914d`, 계획 보기·사람 확인 `64ecaee`] (DR-1, DR-2)

계획 승인은 실행 사이의 확인 하나다(GT-D4, DR-1). 실행 중 질문(5.9)으로 묻지 않는다.

```ts
// DR-17: plan·apply·review·changes는 G-A의 task 형식을 받는다(목표와 모델이 필요 없다)
interface TaskForm {
  input: { kind: "task"; taskPath: string } | { kind: "workspace"; workspace: string };
  configPath: string | null; varsFile: string | null; profile: string | null;
  workflowRef: string | null;   // R-14 L-3 (52400ab): 간편 형식의 --workflow. task 파일과 함께 주면 CLI가 거부한다
}
// CodarynApp의 필수 함수(PM 결정, A-5 질문 1). 범용 작업 명령이 main에 들어온 뒤 언제나 있다.
plan(request: { settings: TaskForm; runId: string }): Promise<AppCallOutcome<AnyPlanOutput>>;  // U-196: PlanOutput | ChangesPlanOutput
applyPlan(request: { settings: TaskForm; planRunId: string; digest: string; cancelFile: string | null;
                     unsafeMoveConsent: { digest: string } | null },   // DR-21, 59dc39a
          observer?: ApplyObserver): Promise<{ ok: true; handle: ApplyHandle } | { ok: false; error: AppError }>;
review(request: { settings: TaskForm; runId: string; decision: "accept" | "reject"; note: string | null }): Promise<AppCallOutcome<ReviewOutput>>;

// PlanOutput, ApplyResult, ApplyJournalRecord, ReviewOutput은 G-A 계약의 타입 그대로다(DR-17)
type ApplyEvent = { kind: "record"; record: ApplyJournalRecord } | { kind: "notice"; text: MaskedText };
interface ApplyHandle { runId: string; cancel(): void; done: Promise<ApplyOutcome> }   // U-218
type ApplyOutcome =
  | { ok: true; output: ApplyResult }                              // 이동 계획(plan "apply")
  | { ok: true; output: EngineResult; lockLeft?: true }            // U-218: 실행 계획(plan "run")을 수행한 실행
  | { ok: false; error: AppError };
interface ApplyObserver {
  onEvent?(event: ApplyEvent): void;                               // 이동 계획의 적용 기록
  onRunEvent?(event: RunEvent): void;                              // U-218: 실행 계획을 수행하는 실행의 이벤트
  confirm?(request: ConfirmRequest, signal: AbortSignal): Promise<ConfirmAnswer>;   // U-218: 그 실행의 권한 질문
}
```

- 계획 보기도 task 형식을 받아, 실행과 같은 비밀(task·설정의 `secretEnv`, 키, 변수 파일 값)로 `plan.json`을 다시 가린다(DR-17, R-4 M-3). 사람 확인의 메모도 같은 비밀로 가려 저장된다(R-4 L-4, G-A `720aa5a`).
- U-196(DR-69 B-3, B-4): `plan`은 이제 `AnyPlanOutput`을 준다. 실행 계획(`plan.json`의 `kind: "changes"`, store의 `loadAnyPlan`)은 `ChangesPlanOutput`(`planKind: "changes"`)이다. 적용 계획은 지금처럼 `PlanOutput`이다.
  - 실행 계획 보기는 nc-human의 `changesPlanOutput`(U-191)을 쓴다(`src/app/changes-plan.ts`).
    - 계획 파일마다 지금 등록한 비밀로 다시 가리고, 계획 실행 때의 보이는 조각과 다르면 `plan_secrets_differ`이며 아무것도 보이지 않는다(DR-28).
    - 요약, 다이제스트, `pending`·`applied`(`applied.json`), 기록 변경 표시를 준다.
    - R-103 M-1: 요약은 출력 객체 자체에 가린 꼴로 든다. 앱은 지금 설정된 모든 API 키 값(`knownKeyValues`, 앱의 환경 사본에서)을 `changesPlanOutput`의 `currentKey`로 넘긴다. 그래서 등록 비밀에 더해 현재 키·키 모양·제어 문자가 가려지고 앞뒤 공백이 잘린다. 적용 계획의 요약(R-49 R49-M1)과 같고, GUI와 승인 화면이 같은 글을 받는다. 시험은 `tests/unit/app/u196-r103-summary-keys.test.ts`다.
  - 계획 모드는 묻지 않는다(보기는 비밀과 작업 공간만 정한다, DR-17). `latest`도 다른 계획처럼 푼다.
  - PM (가), AC-D16: CLI의 `plan`·`apply`가 종류로 나누는 것은 na-core의 U-195다. CLI의 `plan`이 실행 계획을 보이게 되면 앱은 그것을 받아 쓰고 이 보기는 없앤다.
  - 저장 꼴에는 얇게 기댄다(Codex V-11의 고침으로 바뀔 수 있음): `kind`, 관문용 파일 경로, 그리고 읽은 계획을 통째로 `changesPlanOutput`에 넘기는 것뿐이다.
- U-218(DR-69 B-4, U-195 뒤): `applyPlan`이 실행 계획을 수행한다. CLI의 `runApply`가 과제의 plan 설정으로 나눈다(AC-D16). 앱은 나누지 않고 두 길의 고리를 다 넘긴다.
  - plan "run": CLI의 `applyChangesPlan`이 승인(`--digest`, 앱이면 `adapter`)을 보고, 계획을 만든 실행의 goal로 모델 실행을 돌린다(`runPrepared`, 승인된 계획). 그 goal을 읽을 수 없으면 시작하지 않는다(PM, DR-74).
  - 앱은 그 `run` 환경에 `startRun`과 같은 고리를 준다(`appRunHooks`, `startRun`과 함께 쓴다).
    - 조립(`createAppAssemble`): 기록에서 만든 이벤트(DR-15)는 `observer.onRunEvent`로, 권한 질문(U-108)은 `observer.confirm`으로 간다. 풀지 못한 잠금은 `lockLeft`(U-193)로 알린다.
    - 승인된 계획의 부품(`approvedPlan`)을 CLI의 조립(U-195)과 같게 준다: 쓰기 목록을 받는 관문, 계획 차지(`markApplied`), 계획 파일 살피기, 계획 실행 기록에 대한 store의 두 물음. 없으면 CLI가 수행을 거부한다.
    - 시작 게이트: 핸들(수행하는 새 실행의 id)이 첫 이벤트와 엔진 시작보다 먼저다. 취소는 `handle.cancel()` 하나다.
    - 환경은 적용의 사본 그대로다. 그래서 변수 파일 값이 그 실행의 명령과 검증기에 간다(DR-4, U-71과 같음).
  - 결과(`ApplyOutcome`)는 그 실행의 `EngineResult`다(`kind: "run"`, `planRunId`, `planDigest`). 실행의 `run_started` 기록에 `approval: "adapter"`가 남는다.
  - 이동 동의(`unsafeMoveConsent`)는 이동 계획의 것이라, 실행 계획에 주면 CLI가 `invalid_arguments`로 거부한다. plan "run"으로 풀리지 않는 과제 형식은 `run_not_plan`이고, 다이제스트가 다르면 `plan_not_approved`, 이미 수행했으면 `plan_already_applied`다.
  - 이동 계획(plan "apply")은 전과 같다. 이벤트는 `observer.onEvent`로 간다.
  - 시험은 `tests/unit/app/u218-run-plan-apply.test.ts`(11건)다. 이동 계획만 다루는 기존 시험은 `done`을 이동 계획의 꼴로 좁혔다.
  - U-237(Codex V-24 M-3): 앱의 조립이 CLI의 것이 되어, 수행하는 실행도 관문·도구·검증기·무결성 대상을 `runGuards`에서 받는다. 그래서 설정 파일이나 프로필의 읽기 제외 아래 읽기는 `unreadable_path`로 거부되고, 검색은 그 아래를 빼며, 그 내용은 모델·기록·실행 이벤트 어디에도 없다. 시험 `tests/unit/app/u237-v24-carry-and-view.test.ts`.
  - 게이트를 빼는 변이는 시험이 가르지 못한다. CLI가 조립과 엔진 사이에 파일을 읽으므로(계획 실행의 기록 변경 표시 등), 게이트가 없어도 핸들이 먼저 나간다. `startRun`의 게이트도 같다.
- G-A 타입: 계약 기준(`claude/general-tasks` b89ee16)을 받은 뒤 `src/app/general-tasks.ts`는 계약 타입의 re-export만 한다(`ec1914d`).
  - G-A는 N-B의 문구와 한 묶음으로 main에 들어간다(DR-12). 혼자서는 main 위에서 typecheck가 통과하지 않는다.

흐름
1. 실행이 `needs-input`/`plan_pending`(종료 3)으로 끝난다. 작업 공간은 바뀌지 않는다.
2. 어댑터는 `plan`으로 계획 화면을 연다(이동 표, 개수, 폐기 목록, 다이제스트).
   - 계획 글은 `plan.json`을 앱 계층·CLI가 다시 가려 보여 준 것이다(DR-5).
   - 어댑터는 `plan.json`을 직접 읽지 않는다.
3. 사람이 승인하면 `applyPlan(settings, planRunId, digest)`를 부른다.
   - 해시는 GT의 다이제스트(`plan.json` 바이트의 SHA-256) 하나다(DR-1).
   - 적용 때의 정책·검증기는 그때의 사용자 설정과 task에서 읽는다(DR-5). 적용도 task(또는 간편 형식과 프로필)를 받는다(DR-12). 그래서 요청에 실행 설정(`settings`)을 담는다.
   - 적용 실행의 첫 기록은 `apply_started`다(DR-12). 어댑터는 이벤트의 첫 레코드 종류로 실행과 적용을 가르지 않는다. 자기가 부른 함수로 안다.
4. 적용은 새 실행이다. 실행과 같은 이벤트와 취소 통로를 갖는다(DR-2): 핸들의 `cancel()`과 관찰자의 이벤트. 프로세스 밖 어댑터는 `apply`에 `--events jsonl`, `--cancel-file`을 쓴다(6절).
   - 적용 취소의 끝 상태(`cancelled`와 그때까지 옮긴 목록, `revert` 안내)는 G-A가 정한다(R-1 L-7).
5. 하드 링크가 없는 드라이브(DR-21). 적용 전 점검이 안전하게 옮길 수 없는 항목을 찾으면(`plan_checked.unsafeMoves`) 적용은 아무것도 옮기지 않고 `needs-input`/`consent_required`로 끝난다.
   - GUI는 그 항목과 위험(옮기는 사이에 생긴 같은 이름의 파일을 덮을 수 있음)을 보여 주고 따로 동의를 받는다.
   - 동의하면 같은 계획으로 `applyPlan`을 다시 부르고 `unsafeMoveConsent: { digest }`에 그 계획의 전체 다이제스트를 넣는다. 그 적용 한 번에만 유효하다.
   - 앱 계층이 이것을 G-A의 `UnsafeMoveConsent`로 바꾼다(`unsafeMoveConsentOf`, `src/app/consent.ts`).
     - 경로는 언제나 `adapter`다. GUI가 다른 경로(`cli-tty`, `cli-flag`)를 댈 수 없다.
     - 다이제스트가 64자리 소문자 16진수가 아니거나, 적용하는 계획(`digest`, 12자 이상 앞부분)과 다르면 실행 전에 `invalid_arguments`로 거부한다. 엔진도 다른 계획의 동의를 없는 것으로 본다.
   - task·설정·프로필·계획·모델은 동의를 줄 수 없다. 요청의 이 필드 말고 다른 통로는 없다.
   - PM 결정(A-4 질문 1): CLI의 적용 함수에 `adapter` 승인 경로와 DR-21 동의를 주입받는 자리(`AdapterApply`)를 두고, 앱 계층은 그 CLI 함수를 부른다(AC-D16).
   - 구현(`ec1914d`): `applyPlan`은 `runApply`를 `AdapterApply`와 함께 부른다. 기록되는 승인은 `adapter`이고, 동의는 요청의 것만 쓴다.
   - 엔진 함수는 같은 `applyPlan`이다. 그 기록만 감싸 이벤트를 만든다.
     - 핸들이 첫 이벤트보다 먼저 온다.
     - `seq`는 저장된 줄 번호와 같다.
     - `plan_item_started`(R-9 I-4)는 저장되지만 이벤트로 보내지 않는다. 그 번호는 비어 있다.
6. 실행이 `needs-input`/`awaiting_review`로 끝나면 어댑터는 확인 목록과 승인·반려를 보여 주고 `review`를 부른다(GT-D6). 판정은 `review.json`에 남고 결과의 끝 상태는 바꾸지 않는다.

- `plan`·`review`(`64ecaee`): CLI의 `runPlan`·`runReview`를 task 형식과 `--json`으로 부른다.
  - 계획은 그 task 형식이 등록하는 비밀로 다시 가려 보인다.
  - 사람 확인의 메모는 저장 전에 가린다(R-4 L-4).
  - 메모가 `--`로 시작하면 CLI 인자로 읽힐 수 없어 앱 계층이 따로 거부한다. 빈 메모는 메모 없음이다.
- DR-28(R-11 M-1, 계약 `bed4d81`, 이 브랜치 `470bdab`): 계획 보기·적용은 지금 등록된 비밀로 다시 가린 결과가 계획 실행 때의 가린 표기와 같을 때만 진행한다. 다르면 `plan_secrets_differ`다.
  - 비교는 CLI·store가 한다. 앱 계층은 그 오류를 그대로 넘긴다.
  - 앱 경유 시험(`tests/unit/app/plan-review.test.ts`의 DR-28)은 CLI·store가 구현한 뒤 켜졌다. 처음 재현(`c85fd8c`)은 todo였다.
- DR-4는 적용에서도 지켜진다.
  - 앱 계층의 `applyPlan`은 실행의 환경 사본(변수 파일을 적재한 것)을 `env`로 CLI `runApply`에 넘긴다(`planCommandEnvironment`).
  - `runApply`는 검증기 명령 실행기를 `io.parentEnv ?? io.env`로 만든다(`src/cli/plan-commands.ts`).
  - U-71 시험이 고정한다(`tests/unit/app/u71-apply-parent-env.test.ts`): 변수 파일의 짧은 `LANG`이 적용의 명령 검증기에 가고, 호출자의 env와 `process.env`는 바뀌지 않는다.
  - 예전의 "남은 차이(`parentEnv` 없음)"는 고쳐졌다.
- (DR-20으로 추진하지 않음) VS Code 확장 코어는 이 세 명령의 인자를 G-A의 task 형식으로 만들어 두었다(`vscode/src/core/args.ts`). U-81(DR-66)로 지웠다.

### 5.7 변경 비교 [구현 A-1] (DR-7)

두 어댑터 모두 **다시 가린 비교만** 보여 준다. 비교 내용은 앱 함수(그리고 CLI 명령, 9절)가 내준다. 어댑터는 스냅샷을 직접 읽지 않는다.

- **가릴 값과 작업 공간(U-17, DR-46)**: `settings`로 실행을 시작했다면 지금 등록될 가릴 값으로 다시 가린다(DR-17). 앱은 그 값을 CLI의 1~7단계(`prepareTask`)를 읽기 명령으로(`readOnly`) 돌려 얻는다. 그래서 간편 형식(`workspace`)은 키·모델·실행 한도를 요구하지 않는다(설정 파일이 없어도 된다). 잠금, 기록, 파일을 만들지 않고 아무것도 보내지 않는다. task 파일 형식은 지금처럼 그 파일을 검사한다.

```ts
changes(request: { settings: TaskForm; runId: string }, options?: ChangesOptions): Promise<AppCallOutcome<ChangesOutput>>;  // runId: id 또는 "latest"
// U-234 (ne-verify의 R-107 O-1): 비교를 그만둘 때의 신호. 현재 파일을 읽을 때마다 넘긴다. U-213 뒤로 변경이 몰아치는 중의 읽기는
//   시도 사이를 기다리는데(GUARD_PAUSES_MS, 파일마다 가장 길게 750 ms), 신호가 끊기면 그 기다림이 곧 끝나고 다음 시도를 하지 않는다.
//   아직 바뀌고 있던 파일은 시도가 다한 때처럼 unreadable이다. 없으면 지금처럼 기다린다. GUI는 화면을 떠나거나 요청을 거둘 때 끊으면 된다.
interface ChangesOptions { signal?: AbortSignal }

interface ChangesOutput { schemaVersion: 1; kind: "changes"; runId: string; exitCode: 0; masking: "current_secrets"; files: readonly ChangedFileView[]; applyRun?: ChangesApplyRun; recordsChanged?: true }
// U-16 (UXM-4): 적용 실행일 때만. 그 실행이 적용한 계획 실행과 적용한 동작 수(실행 목록의 판정). 이동·폐기는 계획의 동작이라 files는 비어 있다. 결과가 아직 없으면 없다.
// U-43 (DR-38): 기록 변경 표시가 있는 실행일 때만 true. store의 hasRecordsChangedMark(report·revert와 같은 판정)로 정하고, 확인하지 못한 표시도 표시로 센다(fail closed).
//   그런 실행은 store가 shown 기록을 주지 않으므로 파일 글 없이 경로와 상태만 있다(masking_unverified). 표시가 그 까닭을 알린다. CLI changes --json은 이 출력을 그대로 찍는다.
interface ChangesApplyRun { planRunId: RunId; actions: number }
interface ChangedFileView {
  path: MaskedText;                    // 기록의 경로
  created: boolean;                    // 실행이 만든 파일(원본 없음)
  state: "as_run_left" | "changed_since_run" | "missing" | "unknown";
  before: MaskedText | null;           // 원본, 다시 가림
  after: MaskedText | null;            // 지금 내용, 다시 가림
  unavailable: null | "masked_path" | "snapshot_missing" | "not_text" | "too_large" | "unreadable" | "mask_failed" | "masking_unverified";
}
```

- **R-11, DR-28 원칙(`8639d50`)**: 파일 글은 지금 등록된 비밀로 다시 가린 결과가 실행 때 가린 것과 같을 때만 보인다. 다르면 글 없이 경로와 상태만 준다(AC-D13).
  - 재현: 실행 때 비밀을 등록하고, `changes`는 그 `secretEnv`가 없는 다른 task 파일로 불렀다. 원본과 지금 파일에서 비밀 값이 평문으로 나왔다.
  - 실행 기록은 바뀐 파일의 **경로**를 어떻게 가렸는지(`file_changed.path`)만 남긴다. **글**을 어떻게 가렸는지는 남기지 않는다(스냅샷 색인에도 내용 없음).
  - 그래서 처음(`8639d50`)에는 어느 task 형식으로 불러도 글을 내지 않았다(`masking_unverified`).
- **DR-29, DR-32 (c) 구현(`89692ac`)**
  - 실행은 바뀐 파일마다 가린 표기의 다이제스트를 스냅샷 옆에 남긴다(`shown-<n>.json`, 쓰기 도구가 `saveOriginal`·`saveNext`로 넘긴다).
    - 원본과 실행이 남긴 글 각각에 SHA-256(maskedPartsEncoding(maskedParts(가린 글)))을 둔다.
    - 실행이 남긴 글에는 그 글의 SHA-256도 둔다.
  - 앱 계층은 store의 `readRunOriginals`로 원본과 기록을 받는다.
  - 지금 등록된 비밀로 원본과 지금 파일을 가리고, 같은 방식으로 다이제스트를 만들어 `changeShownMatches`에 넘긴다. 참일 때만 지금 가린 글을 보인다.
  - 아니면 글 없이 경로·상태만 주고, 글이 있었을 자리에는 `masking_unverified`를 둔다. 해당하는 경우는 다음과 같다.
    - 실행 때와 다른 비밀
    - 실행 뒤 바뀐 파일
    - 기록이 없는 옛 실행
    - store 검사를 지나지 못한 기록
  - 기록은 쓰기 도구가 다이제스트를 넘겨야 생긴다. 도구 연결 전에는 시험이 기록을 직접 만들어 확인했다.
  - 도구 연결(묶음 `pm/bundle-2`) 뒤로는 시험이 도구가 남긴 기록을 쓴다(`tests/unit/app/dr29-changes.test.ts`). 먼저 그 기록을 실행의 비밀로 따로 계산한 다이제스트와 맞춰 본다.
    - 같은 비밀이면 가린 글이 나온다.
    - 다른 비밀이면 보이는 글이 달라지는 파일에는 글이 없다.
    - 실행 뒤 바뀐 파일, 기록을 지운 옛 실행, 맞지 않는 기록에도 글이 없다.
- **무엇으로 가리나.** 같은 설정으로 실행하면 지금 등록될 비밀이다(GUI-D6 (a)).
  - 등록되는 것: task·설정의 `secretEnv`, 지금의 키, 변수 파일이 설정한 값.
  - 실행의 대응표는 실행이 끝나면 없다. 그래서 토큰 모양은 실행 때와 다를 수 있다.
  - 지금 등록하지 않은 값은 가려지지 않는다. 어댑터는 화면에 "현재 등록한 가릴 값 기준"이라고 쓴다.
- **실행 판정(R-14 L-1, `0363b69`).** 먼저 store의 `inspectRun`으로 실행 목록·`report`·`revert`와 같이 판정한다. 정확히 그 이름의 항목이 없으면 `run_not_found`(N-27 (a)), 손상이면 `invalid_run_record`(N-26)이고 아무것도 보이지 않는다.
- **비밀을 정하는 곳.** 앱 계층이 따로 정하지 않는다. CLI의 실행 전 단계 1~8을 그대로 돌리고, 조립 대신 멈춘다. 그래서 잠금·기록·파일을 만들지 않고 아무것도 보내지 않는다(시험함).
  - 설정이 지금 풀리지 않으면 그 오류(예: `secret_env_missing`)를 돌려주고 내용은 보이지 않는다.
  - 어댑터는 그때 결과의 `changes` 목록(경로만)으로 내려간다(GUI-D6 (b)).
- **원본.** 실행의 스냅샷이다. 경로마다 그 경로의 첫 `previousHash`와 해시가 같은 원본만 쓴다(`revertRun`과 같은 규칙). UTF-8 글만, `MAX_READ_BYTES` 이하만 보인다.
  - 기록의 경로에 토큰이 있으면 파일을 찾을 수 없어 `masked_path`다.
- **지금 파일.** 작업 공간 계층으로 읽는다(링크 해석, 루트·상태 디렉터리 검사). 해시로 `as_run_left`·`changed_since_run`을 가른다.
- 가림이 하나라도 실패하면 그 파일의 글을 내지 않는다(`mask_failed`). 경로를 가릴 수 없으면 호출 전체가 `internal_error`다.
- 스냅샷 파일이 일반 파일이 아니면(링크 등) 따라가지 않고 `snapshot_missing`이다(R-4 L-3).
- 원본과 기록은 store의 `readRunOriginals`(DR-14)로 읽는다(`89692ac`). A-1의 스냅샷 직접 읽기는 없앴다.
- 요청은 task 형식이다(DR-17). 작업 공간 형식이면 앱 계층이 고정 문구 목표(`PROBE_GOAL`)로 CLI의 간편 형식을 부른다. 목표는 비밀을 정하지 않는다.
- **읽기 제외와 이 보기(U-237, Codex V-24 M-2, PM 결정).** 읽기 제외(`unreadablePaths`)는 모델로 가는 것을 막는다. 변경 보기와 파일 보기는 사람이 자기 파일을 보는 화면이라 읽기 제외 아래 파일도 그대로 보인다. 실행 뒤에 읽기 제외가 된 파일의 이전 원문(`before`)도 그렇다. 가릴 값 규칙(DR-28, DR-29)은 그대로 걸린다.
  - 그 글은 모델 요청이나 실행 기록으로 가지 않는다. 보기는 아무것도 쓰지 않는다. 그 뒤의 실행은 그 파일도, 상태 폴더에 둔 실행의 원본도 읽지 못한다(`unreadable_path`, 상태 폴더 거부). 시험 `tests/unit/app/u237-v24-carry-and-view.test.ts`.
- 예전의 한계 R-4 L-3(anthropic task는 키·모델·출력 상한이 풀려야 함)은 U-17(DR-46)로 없어졌다.
  - 앱 계층은 CLI의 1~7단계(`prepareTask`, 읽기 명령)만 돌린다. 8단계(모델)는 돌리지 않는다.
  - 그래서 비교에 제공자 설정이 필요 없다(`tests/unit/app/u17-read-changes.test.ts`).
- CLI 명령 `codaryn changes (--task <f> | --workspace <d> [--profile <p>]) [--config] [--vars-file] --run <id|latest> [--json]`이 이 함수를 부른다(`src/cli/changes.ts`, DR-14).
  - `--json`은 `ChangesOutput` 한 줄이다. 글 형식은 파일마다 상태와 바뀐 구간(`-`/`+`)이다.
  - `main.ts`가 연결하고, 사람의 문구 카탈로그를 넘긴다(U-36, R-66 R66-M1). 도움말과 cli-contract에도 있다.

### 5.8 점검과 모델 목록

- `doctor({ configPath, varsFile, taskPath, workspace })` → `DoctorOutput` [구현 A-1]. 네트워크 없음.
- `listModels({ provider, configPath, varsFile })`, `selectModel({ …, model })` → `ModelsOutput` [구현 `4f7c0a7`]. CLI의 `runModels`(`--json`, `--use`)를 `main.ts`와 같은 규칙(설정 파일 출처, 키, 원자적 쓰기)으로 부른다. 터미널 질문은 하지 않는다.
  - 목록은 실제 API에 접속한다(Y-2). 사람이 고를 때만 부른다. 앱이 켜질 때나 실행 전에 부르지 않는다.
  - 요청에 제공자 이름을 둔다(DR-22).
    - API 제공자(`API_PROVIDER_NAMES`: `anthropic`, `openai`)만 받는다. 다른 이름은 아무것도 읽기 전에 `invalid_arguments`다.
    - 앱 계층은 그 이름을 `--provider`로 넘긴다(SP-6). 설정 파일의 `provider`와 관계없이 그 제공자의 키·주소·목록 함수를 쓴다.
    - `CONNECTED_MODEL_PROVIDERS`는 이 목록과 같다. GUI 엔진 호스트가 이것으로 고를 수 있는 제공자를 정한다.
  - 고르기는 목록에 있는 id만 그 제공자의 모델 자리에 쓰고 다른 필드는 바꾸지 않는다. anthropic은 최상위 `model`(설정에 `providers.anthropic`이 있으면 그곳), 다른 제공자는 `providers.<이름>.model`이다.
  - 실행은 요청에 제공자를 두지 않는다. CLI `run`과 같이 task의 `model.provider`, 아니면 설정의 `provider`를 따른다(시험: `tests/unit/app/provider.test.ts`).

### 5.9 권한 확인 질문 [구현: 계약·정책·엔진 U-74, 엔진 견고함 U-106, 앱 계층 U-108] (DR-1, DR-3)

실행 중 질문은 **권한 확인 하나**다. 계획 승인은 5.6이다. 타입은 계약의 것이다(`src/contracts/policy.ts`). 앱 계층은 다시 내보낸다(`src/app/types.ts`). 앱 계층의 중계는 `src/app/permission.ts`, 시험은 `tests/unit/app/u108-confirm-relay.test.ts`다.

```ts
export interface ConfirmRequest {              // 계약 U-74
  readonly kind: "permission";
  readonly id: string;                         // q1, q2, ... (CONFIRM_ID_PATTERN_SOURCE)
  readonly callId: string;
  readonly tool: ToolName;
  readonly permission: PermissionKind;
  readonly subject: MaskedText;                // 호출의 실행 파일, 가리고 화면에 안전하게(U-106)
  readonly argumentCount: number;              // 인자 수. 인자 글은 담지 않는다
}
export type ConfirmAnswer = { readonly decision: "allow_once" | "deny" | "dismissed" };
// RunObserver
confirm?(request: ConfirmRequest, signal: AbortSignal): Promise<ConfirmAnswer>;
```

의미 (어댑터 공통, DR-3)
1. **질문을 만들 수 있는 것은 사용자 설정과 프로필뿐이다.**
   - `confirm: true`는 설정 파일과 프로필의 명령 규칙에만 있다(`ConfirmableCommandRule`, U-74). task 파일과 작업 종류 정의의 규칙에는 그 필드가 없어 스키마가 거부한다(M-9).
   - 정책 관문은 `confirm` 없는 규칙 하나라도 그 호출을 허용하면 묻지 않고 허용한다. `confirm` 규칙만 허용할 때 2차 판정이 표시를 준다. 설정이 거부한 것은 묻지 않고 거부한다.
   - 아직 설정 파일은 `confirm`을 받지 않는다(U-74). 넓히기 판정은 이미 `confirm_removed`를 안다(U-107, 5.11).
2. **앱 계층의 중계(U-108).** `startRun`의 조립이 `EngineDeps.confirm`을 관찰자의 `confirm`에 잇는다.
   - 요청은 엔진이 만든 계약의 `ConfirmRequest` 그대로다. 실행의 `signal`도 그대로 넘긴다. 실행이 취소되거나 시간이 다하면 끊기고, 엔진은 그때 기다림을 멈춘다(엔진이 신호와 경주한다).
   - **답이 아닌 것은 모두 `dismissed`다.**
     - 관찰자가 없거나 `confirm`이 없다.
     - `confirm`이 바로 던지거나 나중에 거부된다.
     - 답이 객체가 아니다.
     - `decision`이 자기 데이터 속성이 아니다(getter, 프로토타입).
     - `decision`이 `allow_once`·`deny`·`dismissed`가 아니다.
   - `decision`은 한 번만 읽고 getter는 부르지 않는다. 엔진에는 앱 계층이 새로 만든 객체를 넘긴다. 엔진도 다시 한 번만 읽는다(U-106).
3. **물을 수 없으면 거부다.** `dismissed`는 `deny`이고 `by: "default"`로 기록한다. 그래서 사람이 고른 거부(`by: "user"`)와 구분된다(DR-10).
   - 어댑터가 물을 수 없어 거부할 때는 `deny`가 아니라 `dismissed`로 답한다.
4. **답은 그 한 번에만 쓴다.** `allow_once`는 그 호출 하나를 허용한다. "항상 허용"은 없다.
5. **답을 받은 뒤 실효 인자 검사를 다시 한다.** 기다리는 동안 작업 공간이 바뀔 수 있다. 그래서 엔진이 정책 2차 판정을 답 뒤에 다시 하고, 허용이나 같은 표시일 때만 실행한다.
6. **시간.** 기다리는 시간도 `maxDurationMs`에 든다(AC-D6). 한도에 닿으면 질문이 끊기고 `by: "default"`, 실행은 `budget-exhausted`/`max_duration`이다.
7. **취소.** 기다리는 중 취소면 `by: "cancelled"`, 실행은 `cancelled`다. `confirm`이 받은 신호도 끊긴다(시험).
8. **기록과 이벤트.** 새 사건 두 개로 남긴다(DR-3).
   - `confirmation_requested { id, kind: "permission", callId, tool, permission, subject, argumentCount }`는 묻기 전에 남긴다.
   - `confirmation_answered { id, decision: "allow_once" | "deny", by: "user" | "default" | "cancelled" }`
   - 둘 다 실행 이벤트로 관찰자에게 간다(DR-15). 순서는 `confirmation_requested` 이벤트 → `confirm` 부름 → `confirmation_answered` 이벤트다(시험).
   - 질문의 `tool`도 `tool_decision`처럼 어느 도구 목록에도 없는 이름이면 `(unknown tool)`이다(U-250).
- 질문 글은 가림본이다. 화면을 위해 복원하지 않는다. `subject`는 엔진이 이미 제어·보이지 않는 문자를 빼고 키 모양을 가렸다(U-106). 실행 사건 목록(5.13)은 그래도 다른 글처럼 다시 가리고 정리한다.
- 두 단위는 끝났다: B-5 CLI 터미널 질문은 U-110(병합 `15e49a4`), B-6 GUI 대화상자는 U-124(병합 `aa723d2`, 메인 프로세스의 OS 대화상자, 기본과 Esc는 거부, [독립 GUI 설계](standalone-gui.md) 3.6)다. "기다리는 동안 프로세스가 산다"(R-79 I-1: 엔진의 시간 한도 타이머는 `unref()`다)는 CLI 쪽 시험 `tests/unit/cli/g-u110-terminal-line.test.ts`가 본다. GUI의 연기 시험은 대화상자 대신 답한다(사람 점검은 [수동 점검](../manual-checks.md) M-3.11).

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
  - U-55 (AXM-9): `toCliError`는 계약의 `cliErrorFacts(code)`인 `category`(input·state·environment·internal)와 `retryable`(같은 명령을 그대로 다시 하면 될 수 있는지)을 붙인다.
    - CLI 자신의 오류에서 온 `AppError`가 이미 그 값을 지니면(`fromCliError`가 남긴다) 그것을 쓴다. 예: 목록의 모델 오류로 정한 `model_list_failed`의 `retryable`.
    - `retryable`은 알 수 없을 때만 빠진다. 모델 오류 없는 `model_list_failed`가 그렇다. 빠진 것은 모름이지 거짓이 아니다.
    - 종료 코드와 다른 필드는 그대로다. 시험은 `tests/unit/app/u55-error-facts.test.ts`다.
- `message`는 고정 문구, 필드 위치, 개수만 쓴다(S-3, S-6, N-6). 사람용 문장은 어댑터가 코드로 N-4 카탈로그에서 찾는다(N-5).
- 앱 계층이 새 실행 전 오류를 만들면 `CliErrorCode`에 더하는 계약 변경이다(역할 1).
- `AppError`에는 선택 필드 `diagnostic`(N-6: 설정·task 파일의 필드 위치, 줄과 열)이 있다. 값은 넣지 않는다.

### 5.11 설정: 읽기, 만들기, 제안, 바꾸기 [구현 A-4] (standalone-gui 3.2, 3.6, 5.2)

GUI의 첫 실행 마법사와 설정 화면이 쓴다. 파일을 고르는 규칙과 검사는 CLI의 것을 그대로 쓴다.

```ts
readSettings({ configPath }) → SettingsView               // a86cd12
  // file: 출처(argument·environment·default), 경로, 표시 이름, 있는지 / config / profiles / workflows / keyAvailable / policyNarrowings(DR-41)
  // builtinWorkflows: G-A BUILTIN_WORKFLOW_IDS (설정 파일 없이도) / profileWorkflows: 프로필마다 { profile, workflowRef | null }   // 59dc39a
  // privateData: { unreadablePaths, minGroupSize: { configured | null, effective, min, max } }   // U-215, 묶음 A
createSettings({ configPath, workspace }) → InitOutput     // b015c9f, `init --json` 그대로(질문 없음)
settingsSuggestions({ workspace }) → { commands: { shown, rule }[], protectedPaths }   // b015c9f
proposeSettingsChange({ configPath, next }) → { baseDigest, digest, changes, widening, policyNarrowings, config }   // c1957d8, DR-41
applySettingsChange({ configPath, next, baseDigest, confirmWidening }) → { written, digest, changes, widening }
```

- **고르기와 검사.** `run.ts`와 같은 순서로 CLI 함수를 부른다. 앱 계층이 값을 따로 판정하지 않는다. CLI에 공용 "설정 파일 읽기" 함수가 생기면 그것 하나로 바꾼다.
  1. `chooseConfigFile`: `--config` → `CODARYN_CONFIG` → N-1 기본 위치(S-5).
  2. 읽기: 없는 파일은 기본 위치일 때만 "설정 없음"이다.
  3. 원문 키 검사(C-1, S-6). 그 앞에 CLI와 같은 크기 상한을 둔다(DR-42 (d), DR-40 (b)).
     - BOM을 뺀 글이 `MAX_INPUT_FILE_BYTES`(1 MiB, UTF-8 바이트)를 넘으면 CLI의 고정 문구로 `invalid_config`다. 다른 검사는 그 글을 읽지 않는다.
     - 설정 변경 제안·적용도 쓸 글에 같은 상한을 둔다. CLI가 거부할 파일을 쓰지 않는다.
  4. JSON 해석. 문법 오류면 줄과 열을 준다.
  5. 값 키 검사(깊이 64).
  6. `parseConfig`. 필드 위치를 준다(N-6).
  - 키 검사(3, 5)는 지금 설정된 모든 API 제공자의 키 값으로 한다(SP-2, CLI의 `knownKeyValues`). 그래서 OpenAI 키 값이 든 설정 파일도 읽기와 변경 제안·적용에서 `key_in_file`로 거부된다.
  - `keyAvailable`은 간편 실행이 쓸 제공자(설정의 `provider`, 없으면 anthropic)의 키가 있는지다. 값은 주지 않는다.
  - U-215(DR-69 묶음 A): `privateData`는 설정 화면이 읽기 제외 경로와 묶음 최소 크기 k를 보이고 고치는 데 쓴다(`privateDataOf`).
    - `unreadablePaths`는 설정의 `policy.unreadablePaths`를 파일 순서 그대로 준다. 없으면 빈 목록이다.
    - `minGroupSize`의 `configured`는 설정의 값이고 없으면 null이다. `effective`는 설정만으로 실행이 받는 k다(`effectiveMinGroupSize`, 5 아래 없음). 프로필·정의·과제 파일은 이것을 올릴 수 있다. `min`·`max`는 어느 출처든 둘 수 있는 값(`MIN_GROUP_SIZE_LIMITS`, 정수)이다. 그래서 창이 계약의 수를 베껴 둘 필요가 없다.
    - 설정의 정책만 본다. 프로필·정의·과제 파일의 자기 항목과 k는 여기 없다.
    - GUI는 보호 경로처럼 고친다. 편집을 설정에 적용한 뒤 새 설정 전체로 제안을 받는다. 판정은 U-204다: 항목을 더하거나 k를 올리면 좁히기라 묻지 않고 쓴다. 항목을 빼거나 k를 내리면 넓히기라 사람이 확인해야 쓴다.
    - 파서는 두 필드를 na-core의 U-210까지 거부한다. 그래서 두 필드를 담은 설정 파일을 읽고 쓰는 시험은 그때까지 todo다(`tests/unit/app/u215-private-data-settings.test.ts`). U-210과 합친 임시 판에서는 모두 통과했다.
  - `listRuns`의 출력도 모든 API 제공자의 키 값을 가린다(CLI `runs`와 같다). 시험은 `tests/unit/app/provider-keys.test.ts`다.
- **만들기.**
  - CLI `init`을 `--json`, 질문 없이 부른다. 그래서 기본값만 쓴다: 모델 자리표시자, 기본 한도, 모두 거부하는 정책.
  - 이미 있으면 `config_exists`이고 덮어쓰지 않는다. 작업 공간 안이면 거부한다(S-1). 키는 받지도 쓰지도 않는다(C-1).
  - 사람이 고른 값은 이어서 `selectModel`과 설정 바꾸기로 쓴다.
- **제안.** `init`이 물을 고정 후보만 이름으로 준다: 목록에 있는 `package.json` 스크립트, 있는 보호 경로. 파일의 다른 내용은 가져오지 않는다.
- **바꾸기.** GUI가 만든 새 설정 전체를 받는다.
  - 제안은 쓰지 않는다. 같은 검사를 거친 뒤 바뀌는 필드와 **권한을 넓히는 변경**을 준다(UX 7, M-9).
    - 명령 추가, 추가 인자 허용
      - 묻는 규칙(U-74 `confirm: true`)을 새로 더해도 명령 추가다. 사람이 허락하면 전에 못 하던 호출을 하게 된다.
    - U-107(R-79 F-1): 묻던 명령을 묻지 않고 허용(`confirm_removed`). 규칙에서 `confirm`을 빼거나, 묻는 규칙과 같은 호출을 맞추는 `confirm` 없는 규칙을 더한 경우다. 정책 관문은 `confirm` 없는 규칙 하나라도 맞으면 묻지 않고 허용하기 때문이다.
      - 규칙이 묻게 되는 변경은 좁히기다.
      - 프로필의 규칙도 같다. `profile_changed`에 더해 그 프로필 안의 항목(`profiles.<이름>.policy.commands[i]`)을 준다.
        - U-117(R-85 L1): 바뀐 뒤 자기 정책을 가진 프로필은, 그 프로필의 실행이 전에 쓰던 명령과 견준다. 전에 자기 정책이 있었으면 그것이고, 없었으면 설정의 정책이다(정책 없는 프로필은 설정의 정책으로 돈다).
        - 묻던 명령이 묻지 않게 되면 `confirm_removed`, 새 명령이면 `command_added`(추가 인자면 `extra_args_allowed`도)다.
        - 바뀐 뒤 자기 정책이 없는 프로필(설정의 정책으로 돌게 됨)은 `profile_changed`만 준다.
      - 작업 종류의 합친 규칙은 설정 규칙의 `confirm`을 이어받으므로, 설정 쪽 항목 하나로 말한다.
    - 한도 올림·없앰
    - 보호 경로·무결성 경로·가릴 변수·검증기 제거
    - 명령 검증기 추가·변경(R-14 L-2, `b30bbce`): 실행마다 사람의 권한으로 돈다. 파일 규칙 검증기 추가는 넓히기가 아니다
    - 경로 토큰 복원, 계획 동작 허용
    - U-183(DR-69 B-4): 쓸 수 있는 경로(`writablePaths`)를 넓힌다. 없으면 한정이 없고, 목록은 허용 목록이다(항목이 자기와 그 아래를 덮음). 설정·프로필·작업 종류 정의의 목록은 따로따로이고, 실행의 쓰기는 모든 목록에 들어야 한다. 그래서 목록마다 그 자리에서 판정한다.
      - 목록이 없어짐(한정 없음으로 돌아감): `writable_paths_unlimited`(`policy.writablePaths`, `profiles.<이름>.policy.writablePaths`, `workflows.<id>.policy.writablePaths`). 프로필의 정책이 없어져도 그 프로필의 목록이 없어진 것이다.
      - 예전 항목에 없던 항목: `writable_path_added`(그 항목 `…writablePaths[i]`). 항목을 더함, 더 넓은 접두사로 바꿈, 뿌리(`.`), 빈 목록(쓰기 없음)에 항목을 둠이 여기에 든다.
      - V-8 M-1: 예전 항목 **안**의 항목(`a` → `a/b`)도 넓히기다.
        - 관문은 허용 항목을 실경로로도 풀어 본다. 그래서 `a/b`가 다른 곳을 가리키는 링크나 정션이면, 글자로는 좁힌 변경이 실제로는 새 범위를 연다(V-8이 정션으로 재현).
        - 설정·프로필·정의의 목록은 그 사람의 모든 작업 공간에서 쓰인다. 링크는 작업 공간마다 다르므로, 설정을 바꾸는 때에는 새 항목이 링크를 지나지 않는지 확인할 수 없다. 한 작업 공간을 풀어 봐도 다른 곳은 모른다. 확인할 수 없으면 넓히기다.
      - 같은 항목인지는 정책 관문의 판정(`compilePathSet`의 `exact`: 조각 단위, Windows에서 대소문자 무시와 `\`, 끝의 `/`와 `./`는 없는 것)으로 본다. 쓸 수 없는 예전 목록은 어느 항목과도 같지 않다.
      - 좁히기: 항목을 뺌, 같은 항목을 다른 순서나 표기로, 목록이 없던 자리에 새로 둠(한정 없음보다 어디서나 좁다), 빈 목록.
      - 처음 판(ba7cec7)은 글자로 더 덮는 항목만 넓히기로 보았다. 예전 항목 안의 항목을 좁히기로 본 것을 V-8로 고쳤다.
      - 설정 파서는 U-182(병합 `a1d5c65`)부터 이 필드를 받는다(설정 파일, 프로필, 작업 종류 정의의 `policy.writablePaths`). U-183이 쓰일 때는 판정이 파서보다 먼저였다. 시험은 `tests/unit/app/u183-writable-widening.test.ts`와 `u183-v8-writable-links.test.ts`다. GUI의 설정 화면에는 이 필드를 고치는 편집이 없고, 넓히기 확인 대화상자는 두 종류에 이름을 붙인다(U-192, 병합 `111e25d`).
    - U-204(DR-69 묶음 A, A-7, R-7): 읽기 제외 경로(`unreadablePaths`)를 빼는 것과 묶음 최소 크기 k(`minGroupSize`)를 낮추는 것.
      - 읽기 제외 목록은 거부 목록이고 더하기만 한다. 설정·적용한 프로필·작업 종류 정의·과제 파일의 항목이 합집합으로 걸린다(계약 `PolicyConfig.unreadablePaths`, `mergeWorkflowPolicy`). 관문은 항목을 글자와 실경로 둘 다로 본다(보호 경로의 규칙).
      - 예전 항목이 새 목록에 없으면 `unreadable_path_removed`다. 필드는 그 목록(`policy.unreadablePaths`, `profiles.<이름>.policy.unreadablePaths`, `workflows.<id>.policy.unreadablePaths`)이고 한 번만 준다. 항목을 뺌, 목록을 비움, 목록이나 프로필의 정책이 없어짐이 여기에 든다.
        - 같은 항목인지는 글자 그대로이거나 관문의 판정(`compilePathSet`의 `exact`)으로 본다. 그래서 `data/private`와 `data/private/`는 같다.
        - 더 넓은 항목으로 바꾼 것(`data/private` → `data`)도 넓히기다. 관문은 거부 항목을 실경로로도 풀어 보므로, `data/private`가 다른 곳을 가리키는 링크나 정션이면 그 대상을 막고 있었다. `data`는 그 대상을 덮지 않는다. 목록은 모든 작업 공간에서 쓰이므로 설정을 바꾸는 때 확인할 수 없고, 확인할 수 없으면 넓히기다(V-8 M-1과 같은 까닭).
        - 프로필이나 정의의 목록에서 뺀 항목을 설정의 **새** 목록이 아직 갖고 있으면 넓히기가 아니다. 그 실행은 설정의 항목을 그대로 받는다. 적용할 프로필은 설정을 바꾸는 때 알 수 없으므로, 정의의 목록은 설정의 목록만 빼고 본다.
      - k는 5 아래로 내려가지 않는다(DR-70, U-197의 V-12 M-1 고침). 실행의 k는 5와 설정·프로필·정의·과제 파일의 값 가운데 가장 큰 것이다(`effectiveMinGroupSize`). 그래서 어느 출처도 올리기만 한다.
        - 설정의 k가 실제로 낮아지면 `min_group_size_lowered`(`policy.minGroupSize`)다. 5보다 큰 값을 지운 것(5로 돌아감)도 든다. 5 아래 값(파서가 거부함)은 5로 센다.
        - 프로필이나 정의 자기 k(`profiles.<이름>.policy.minGroupSize`, `workflows.<id>.policy.minGroupSize`)는 전과 후를 모두 설정의 **새** 값과 함께 견준다. 그래서 설정의 k가 바뀐 것은 설정 자리에서 한 번만 말한다. 설정의 값(또는 5) 이하이던 값은 아무것도 올리지 않았으므로 지워도 넓히기가 아니다.
      - 좁히기: 항목을 더함, 목록을 새로 둠, 같은 항목을 다른 순서나 표기로, k를 올림.
      - 아직 파서는 두 필드를 받지 않는다(A-6까지). 판정이 먼저 안다. GUI는 모르는 넓히기 종류가 든 제안을 `unknown_widening`으로 거부하므로, GUI가 두 종류를 알기 전까지도 열리지 않고 닫힌다. 시험은 `tests/unit/app/u204-unreadable-k-widening.test.ts`다.
    - API 주소 변경, 프로필·워크플로 정의 변경
    - 제공자의 주소 변경(`providers.<이름>.apiBaseUrl`, 실행이 읽는 대로)과 간편 실행의 제공자 변경(`provider_changed`). 작업 공간의 글과 그 제공자의 키가 다른 곳으로 간다(GUI F-3). 모델·출력 상한 변경은 넓히기가 아니다
      - 주소는 실행이 보내는 곳으로 비교한다(R-27 I1). 설정의 주소가 없으면 그 제공자의 기본 주소다(CLI `resolveConnection`).
        - 기본 주소를 적기만 한 변경이나, 최상위 주소를 같은 값 그대로 `providers.anthropic`으로 옮긴 변경은 넓히기가 아니다.
        - `providers.anthropic`이 있으면 실행이 최상위 주소를 읽지 않으므로 그것만 바꾼 변경도 아니다.
        - 환경 변수의 주소는 설정 파일 밖이다(R-27 I3).
      - 프로필의 제공자(SP-D10)가 그 프로필의 간편 실행을 다른 제공자로 보내면 `provider_changed`(`profiles.<이름>.provider`)도 준다(R-27 I4).
    - 작업 종류 자기 규칙(GUI F-5, DR-41)
      - DR-41부터 작업 종류의 `policy`는 설정의 것과 합쳐진다(계약 `mergeWorkflowPolicy`: 보호 경로는 합집합, 명령과 계획 동작은 양쪽이 모두 허용한 것만). 그래서 자기 정책을 가진 작업 종류(내장 `organize`, 설정의 작업 종류)마다, 무엇이 바뀌었든, 합친 정책을 전과 후로 비교한다.
      - 설정의 첫 정책이 보호 경로만 더하면 작업 종류의 보호 경로는 남으므로 넓히기가 아니다. 설정이 `planActions`를 적지 않게 되거나 정책을 지우면, `organize`가 좁혀졌던 계획 동작을 되찾으므로 넓히기다.
      - 필드는 `workflows.<id>.policy.planActions`처럼 작업 종류를 이름에 담는다. 설정 쪽 항목과 같은 종류·같은 필드(작업 종류 앞부분과 목록 번호를 뺀 것)를 되풀이하는 항목은 빼고, 작업 종류의 실행이 다르게 넓어질 때만 준다.
      - `verifiers`도 DR-43 (a)부터 합친다(계약 `mergeWorkflowVerifiers`). 작업 종류의 검증기가 먼저 늘 돌고, 설정의 것은 id가 겹치지 않으면 더해진다. 빈 목록은 아무것도 지우지 못한다. 그래서 자기 검증기를 가진 작업 종류마다 합친 목록을 전과 후로 비교한다. 설정의 첫 검증기는 작업 종류의 검사를 대체하지 않으므로 넓히기가 아니다.
      - 좁히기는 확인 대상이 아니다. 대신 무엇이 빠지는지 알린다(아래 `policyNarrowings`).
    - `policyNarrowings`(DR-41, DR-43 (a), 계약 `workflowPolicyNarrowings`·`workflowVerifierNarrowings`)
      - `readSettings`의 보기와 변경 제안에 있다. 작업 종류마다, 자기 규칙이 설정의 정책과 검증기에서 빼는 것을 `{ workflow, kind, count }`로 준다.
      - 종류는 `commands_dropped`, `commands_narrowed`, `plan_actions_dropped`, `restore_path_tokens_off`, `verifiers_dropped`(작업 종류의 것과 id가 겹치는 다른 검사)이다. 규칙·명령·경로·검사 내용은 담지 않는다.
      - 예: 설정에 명령을 더하면 `organize`는 그것을 빼므로 `{ workflow: "organize", kind: "commands_dropped", count: 1 }`이다.
      - 프로필의 정책은 여기서 보지 않는다.
  - 적용은 검사를 다시 한다. 파일이 제안 때와 같아야 한다(`baseDigest`). 넓히는 변경은 `confirmWidening: true`일 때만 쓴다. 사람에게 묻는 것은 GUI 메인 프로세스다.
  - 쓰기는 CLI의 `writeConfigAtomic`(`models --use`와 같은 함수)이다. 바꾸는 순간에 파일이 달라졌으면 다시 거부한다.
  - 쓴 파일은 정해진 형식의 JSON이며, 원래 파일의 들여쓰기·순서는 남지 않는다.

### 5.12 작업 공간 목록 [구현 U-89, U-102] (standalone-gui 3.3)

GUI의 파일 나무가 쓴다. 작업 공간의 한 디렉터리를 한 단계만 준다. 읽기만 한다: 잠금·기록·실행 디렉터리를 만들지 않고 아무것도 보내지 않는다. 코드는 `src/app/workspace-dir.ts`, 시험은 `tests/unit/app/u89-workspace-dir.test.ts`와 `u102-workspace-dir-protected-invisible.test.ts`다.

```ts
listWorkspaceDir({ settings: TaskForm, dir, offset, limit? }) → WorkspaceDirListing
  // { kind: "workspace_dir", status: "listed", masking: "current_secrets", entries, total, offset, nextOffset }
  // 또는 { kind: "workspace_dir", status: "refused" | "not_found" | "not_dir" | "too_large" | "unreadable" }
  // entries: { name: string | null, shown, kind: "dir" | "file" | "link" | "state" | "other", masked, protected }[]
```

- **설정.** `changes`(5.7)와 같은 읽기 준비(`prepareTask`의 1~7단계, 실행하지 않는 명령)로 작업 공간, 지금 등록한 비밀, 효력 있는 정책의 보호 경로를 얻는다. 설정이 풀리지 않으면 그 오류(예: `secret_env_missing`)이고 아무것도 읽지 않는다.
- **인자.** 맞지 않으면 아무것도 읽기 전에 `invalid_arguments`다.
  - `dir`: 뿌리는 `""`, 그 밖은 `/`로 이은 상대 조각. 빈 조각, `.`, `..`, `\`, `:`, 제어 문자(C0, DEL, C1)는 안 된다. 조각마다 255자, 깊이 64까지다.
    - U-102: 줄·문단 구분 문자(U+2028, U+2029)와 기본 무시 문자(`\p{Default_Ignorable_Code_Point}`)도 안 된다. 그런 이름은 모양 때문에 가린 항목이므로 펼칠 수 없다.
  - `offset`: 0 이상의 정수. 앞 쪽의 `nextOffset`을 넘긴다.
  - `limit`: 1~500(`WORKSPACE_PAGE_SIZE`). 없으면 500이다.
- **링크를 따라가지 않는다.**
  - 경로는 먼저 엔진의 작업 공간 규칙(`Workspace.resolve`)을 거친다. 뿌리 밖, 상태 디렉터리(`.codaryn`), 규칙이 거부하는 이름은 `refused`다.
  - 이어서 경로의 조각마다 `lstat`으로 본다. 도중에 링크나 junction이 있으면 `refused`다. 그 안의 경로도 마찬가지다.
  - 항목은 자기 종류로 읽는다(`readdir`의 `withFileTypes`, 링크를 따라가지 않음). 링크·junction은 `link`, 뿌리의 `.codaryn`은 `state`이고 둘 다 다시 펼치지 않는다.
- **이름은 가려서 준다.**
  - 제어 문자(C0, DEL, C1)가 든 이름은 아예 보이지 않는다(`shown: ""`).
  - 그 밖은 키 모양과 지금 설정된 모든 API 키 값(`hideKeys`, `knownKeyValues`), 지금 등록한 값(게이트웨이의 `mask`, AC-D14) 순서로 가린다. 둘 다 이름을 있는 그대로 보므로, 보이지 않는 문자로 끊은 값도 찾는다. 가리기가 실패하면 `""`이다.
  - 그다음 `cleanText`(양방향 제어 등을 `?`로)를 거친다.
  - U-102(R-78 L-2): 기본 무시 문자도 하나하나 `?`로 보인다. 영폭 공백·연결자, BOM, 소프트 하이픈, 한글 채움 문자, 이체 선택자 등이다. 그래서 두 이름이 같아 보일 수 없고, 그런 항목은 `masked`다.
    - 순서가 중요하다. `?`로 먼저 바꾸면 끊긴 키 값이나 키 모양이 더는 키로 보이지 않아 일부가 드러난다. 그래서 가린 뒤에 바꾼다(시험이 본다).
  - `shown`이 원래 이름과 다르면 `masked: true`이고 `name`은 `null`이다. **가린 항목의 원래 이름은 앱 계층 밖으로 나가지 않는다.** 그래서 어댑터는 그 항목을 열거나 고를 수 없다.
  - `name`은 어댑터가 아래 경로를 만들 때만 쓴다. 보여 줄 때는 `shown`을 쓴다.
- **보호.** U-102(R-78 L-1): `protected`는 정책 관문이 그 경로에 쓰기를 보호 경로로 막는지다. 정책의 `compileProtectedPaths`를 그대로 쓴다.
  - 먼저 글자 기준(`covers`, `checkRequested`와 같음), 다음 실경로 기준(`coversEffective`, `checkEffective`와 같음)이다.
  - 그래서 보호 경로인 링크의 대상, 보호 폴더를 가리키는 링크, 짧은 이름(8.3)으로 부른 보호 폴더의 항목도 보호로 나온다. 시험이 모든 항목을 정책 관문의 쓰기 판정과 비교한다.
  - 파일·디렉터리 항목의 실경로는 나열한 디렉터리의 실경로와 그 이름이다. 링크와 그 밖의 항목은 쓰기처럼 풀어 본다. 작업 공간이 거부하는 쓰기(뿌리 밖, 상태 디렉터리)는 보호가 아니다.
  - 작업 공간의 경로 풀이는 한 번의 목록 동안 기억한다. 정책의 판정은 보호 항목마다 풀이를 하기 때문이다. 판정하지 못하면 보호로 보인다.
  - 이 기계에서 항목 20,000개, 보호 경로 셋인 디렉터리를 나열하는 데 약 150 ms였다.
- **U-102 시험**(8절 표의 5.12 행에 더해): 보호 링크의 대상·보호 폴더로 가는 링크·짧은 이름의 보호 폴더가 보호, 모든 항목이 정책 관문의 쓰기 판정과 같음, 보이지 않는 문자가 든 이름이 `?`로 보이고 가린 항목, 그런 `dir`은 `invalid_arguments`, 보이지 않는 문자로 끊은 등록 값·키 값·키 모양이 가려짐.
- **크기와 순서.**
  - 항목이 `MAX_WORKSPACE_DIR_ENTRIES`(100,000)를 넘으면 `too_large`다. 일부만 주지 않는다.
  - 디렉터리(`dir`, `state`)가 먼저, 그다음 나머지다. 각 묶음은 숫자를 아는 정렬(`Intl.Collator("en", { numeric, sensitivity: "base" })`) 뒤 코드 포인트 순서로 정한다. 같은 디렉터리는 같은 순서다.
  - 쪽은 `offset`부터 `limit`개다. `total`은 디렉터리 전체 수, 끝 쪽의 `nextOffset`은 `null`이다. 끝을 넘은 `offset`은 빈 쪽이다.
- **읽기 결과는 호출 오류가 아니다.** `not_found`(없음, 또는 도중이 파일), `not_dir`(마지막이 파일), `unreadable`(그 밖의 읽기 오류)은 `ok: true`의 상태다. 작업 공간 자체가 없으면 `workspace_not_found`다.
- **한계.** 읽는 동안 디렉터리가 바뀌면 쪽 사이에 항목이 빠지거나 겹칠 수 있다. 쪽은 매번 새로 읽는다.

### 5.13 실행 사건 목록 [구현 U-90, R-80 반영] (standalone-gui 3.7 "기록" 탭)

끝난 실행이나 도는 중인 실행의 저장된 레코드를 쪽으로 준다. 읽기만 한다: 잠금·기록을 만들지 않고 아무것도 보내지 않는다. 코드는 `src/app/run-events.ts`, 시험은 `tests/unit/app/u90-run-events.test.ts`와 `r80-run-events.test.ts`다.

```ts
listRunEvents({ settings: TaskForm, runId, offset, limit?, types? }) → RunEventsPage
  // { kind: "run_events", runId, runKind: "run" | "apply", status: "complete" | "incomplete" | "damaged", recordsChanged?: true,
  //   masking: "current_secrets", records: StoredRunRecord[], total, skipped, missing, offset, nextOffset }
  // StoredRunRecord: { seq, at, runId, type: RunEventType, [field]: unknown }
```

- **설정.** `changes`(5.7)와 같은 읽기 준비로 작업 공간과 지금 등록한 비밀을 얻는다. 설정이 풀리지 않으면 그 오류이고 아무것도 읽지 않는다.
- **인자.** 맞지 않으면 아무것도 읽기 전에 `invalid_arguments`다.
  - `runId`: 실행 id 꼴. `"latest"`는 받지 않는다(실행 목록의 id를 쓴다).
  - `offset`: 0 이상의 정수. 검사를 지난 레코드 사이의 자리이고 `seq`가 아니다.
  - `limit`: 1~1,000(`MAX_RUN_EVENTS_PAGE`). 없으면 200(`RUN_EVENTS_PAGE_SIZE`)이다.
  - `types`: 비지 않은 목록, `RUN_EVENT_TYPES`의 이름만. 없으면 모든 종류다.
- **실행 판정이 먼저다.** store의 `inspectRun`으로 실행 목록·`report`·`changes`와 같이 판정한다(R-14 L-1).
  - 정확히 그 이름의 항목이 없으면 `run_not_found`다.
  - 손상이면 `invalid_run_record`이고 아무것도 보이지 않는다.
  - journal이나 result.json이 일반 파일이 아니거나 `MAX_REPORT_FILE_BYTES`를 넘어도 `invalid_run_record`다.
- **줄은 번호로 본다.** 실행 중 허용된 명령이 journal에 줄을 더할 수 있다(R-4 H-1). 줄 하나가 빠져도 그 뒤의 진짜 레코드를 잃지 않게, 각 줄을 번호로 판정한다(R-80 M-1, PM 결정 가·나·다).
  - **이 실행의 줄**은 JSON 객체(배열 아님)이고, `runId`가 그 실행이고, `seq`가 1 이상의 정수다. 아닌 줄(깨진 줄, 다른 실행의 줄, 번호 없는 줄)은 `skipped`로 세고 journal이 손상이다.
  - **같은 번호를 두 줄 이상이 주면** 어느 쪽도 진짜로 고르지 않는다. 모두 빼고(`skipped`) 그 번호를 빠짐(`missing`)으로 센다. journal은 손상이다. 그래서 꼴이 맞는 위조 줄이 진짜 줄을 밀어내지 못한다.
  - **제자리의 줄**(기대하는 번호)은 주든 안 주든 번호를 센다(가). 그래서 그 뒤의 레코드가 이어진다. 다음을 모두 만족하면 주고, 아니면 `skipped`로 센다(손상은 아니다).
    - `at`이 실제 시각이다(store의 `isRunTimestamp`).
    - `type`이 그 실행 종류의 것이다. 모델 실행은 `JournalEventType`, 적용은 `ApplyJournalEventType`이다(DR-12, 첫 레코드로 가름). U-111: 목록은 계약의 것(`JOURNAL_EVENT_TYPES`, `APPLY_JOURNAL_EVENT_TYPES`, U-105)을 그대로 쓴다.
      - U-74의 실행 중 질문과 답(`confirmation_requested`, `confirmation_answered`)도 모델 실행의 종류다. 질문의 `subject`는 엔진이 이미 안전하게 만든 글이지만(U-106) 다른 글과 같이 가리고 정리한다. 질문의 `tool`도 `tool_decision`처럼 내장 도구 이름이 아니면 `(unknown tool)`이다(실행 이벤트도 같다).
    - 모든 단계의 필드 이름이 낙타 꼴의 평범한 낱말이고 가리기가 바꾸지 않는다. 깊이는 64까지다. 그래서 비밀을 필드 이름에 담은 줄, 그리고 필드 이름과 같은 값을 지금 등록했을 때(`text`, `turn` 등) 그 필드가 든 레코드가 빠진다. 그 뒤는 이어진다.
    - 가릴 수 있다.
  - **기대보다 큰 번호**를 만나면 거기서 다시 맞춘다(나). 그 사이 번호는 빠짐이고 journal은 손상이다. **기대보다 작은 번호**(순서가 뒤바뀐 줄)는 빼고 손상으로 본다.
  - 종류마다의 필드는 하나하나 검사하지 않는다. 대신 모든 글을 가리고 정리한다. 어댑터는 필드를 바깥 자료처럼 읽는다(`StoredRunRecord`의 다른 필드는 `unknown`). 번호 자리에 맞는 위조 줄(진짜 줄이 없는 번호)은 가린 채 보일 수 있다. 실행 중에 바뀐 것은 보통 기록 변경 표시가 있다(아래).
- **적용의 시작 레코드.** `plan_item_started`(R-9 I-4)는 받되(번호를 셈) 주지 않는다. 적용 이벤트와 같다.
- **다시 가림.** 이벤트와 같다(DR-15).
  - 모델 실행은 `sanitizeRecord`(도구 이름 제한 `(unknown tool)`)를, 적용은 `maskStrings`를 지금 등록한 값의 게이트웨이로 거친다.
  - 그다음 키 모양과 지금 설정된 모든 키 값을 가린다(`hideKeysInStrings`, `knownKeyValues`).
  - 가릴 수 없는 레코드는 빼고 `skipped`로 센다. 토큰은 복원하지 않는다. 실행 때 등록하지 않았던 값도 지금 등록했으면 가려진다.
- **글을 정리한다**(R-80 L-1). 가린 뒤에 모든 문자열을 정리해 준다. 계약이 모르는 필드의 값도 같다(필드 이름은 이미 평범한 낱말이다).
  - CR LF는 LF로 바꾼다.
  - 제어 문자와 양방향 문자는 `cleanText`로 `?`가 된다. 줄바꿈(LF)과 탭은 남는다.
  - 기본 무시 문자(`\p{Default_Ignorable_Code_Point}`: 영폭 공백·연결자, BOM, 소프트 하이픈, 이체 선택자 등)도 `?`가 된다. 그래서 이모지의 연결자와 이체 선택자도 `?`로 보인다.
  - 가린 뒤에 정리하므로, 그런 문자로 끊긴 값이나 키도 먼저 찾는다(5.12와 같은 순서).
  - **JSON 글의 안쪽**(U-121, R-80b L-1). 도구 결과의 `content`와 도구 호출의 `argsJson`은 JSON 글이다(어느 깊이든: `tool_result.result`, `model_request`의 도구·어시스턴트 메시지, `model_response.toolCalls`).
    - 그런 문자열은 풀어서, 안쪽의 모든 문자열과 필드 이름을 같은 게이트웨이로 가리고, 키 모양과 지금의 키 값을 가리고, 위와 같이 정리한 뒤 JSON으로 다시 쓴다. 그래서 풀어 보이는 어댑터도 정리된 글을 받는다.
    - JSON 이스케이프(`\uXXXX`)로 등록 값을 적은 글은 바깥 글에서 가리기가 보지 못한다. 안쪽에서 다시 가리므로 응답에 나오지 않는다(시험).
    - JSON이 아닌 글(실패한 도구 결과의 문구 등)은 정리한 문자열 그대로다. 안쪽을 가릴 수 없는 레코드는 빼고 `skipped`로 센다.
    - 다시 쓴 JSON은 엔진이 쓴 압축 꼴과 같다(실행 이벤트와 같음을 보는 시험이 그대로 통과한다). 다만 들여쓰기가 있던 JSON 글은 압축 꼴이 된다.
- **상태.**
  - `damaged`(R-80 M-1 다): 위에서 journal이 손상이거나, `report`의 읽기(`summarizeJournal`·`readResult`, 적용은 `summarizeApplyJournal`·`readApplyResult`)가 journal이나 result.json을 거부했다. 받은 레코드와 `missing`을 함께 준다.
    - 그래서 `report`가 `invalid_run_record`로 거부하는 사본에서 이 함수가 `complete`라고 하지 않는다(시험이 같은 사본에 `report`를 불러 본다).
    - 끝난 실행의 끝나지 않은 마지막 줄도 손상이다(`report`와 같다).
  - `missing`: 어느 한 줄도 주지 않는 번호의 수다(빈 번호, 두 줄이 준 번호). 손상이 아니면 0이다.
  - result.json이 없으면 `incomplete`다(도는 중이거나 그것 없이 멈춤). 이때 끝나지 않은 마지막 줄은 세지 않고 뺀다. 그 밖의 손상은 `incomplete`보다 `damaged`가 먼저다.
  - 둘 다 아니면 `complete`다. 제자리 줄을 거른 것만으로는 손상이 아니다. 빠진 수는 `skipped`가 말한다.
  - 기록 변경 표시가 있으면 `recordsChanged: true`다(store의 `hasRecordsChangedMark`, 확인하지 못해도 표시로 셈, DR-38). 레코드는 그래도 준다(`report`와 같음).
- **쪽.** 검사와 필터를 지난 레코드에서 `offset`부터 `limit`개를 주되, 레코드 JSON이 2 MiB(`MAX_RUN_EVENTS_PAGE_BYTES`, UTF-8)에 이르기 전에 끊는다. 그보다 큰 레코드는 혼자 한 쪽이 되므로 쪽은 늘 나아간다. `total`과 `skipped`는 쪽마다 journal 전체로 센다.
- **한계.**
  - 쪽마다 journal 전체를 다시 읽고 가린다. 이 기계에서 가리기는 MiB당 약 0.1초, 키 가리기는 약 0.2초였다. 큰 journal이면 쪽마다 그만큼 걸린다. R-80 검토에서 40 MiB journal은 쪽마다 약 6.3초였다.
  - 기대보다 훨씬 큰 번호를 단 위조 줄이 앞에 있으면, 그 뒤의 진짜 줄은 작은 번호라 빠진다. 이때 상태는 `damaged`이고 `missing`이 그만큼 크다. 조용히 일부만 주지는 않는다.
  - `total`은 같은 `types` 거름에서 쪽마다 같다(R-80 I-4).
  - 등록 값 가리기의 한계는 5.7과 같다(지금 등록한 값만 가린다).

### 5.14 적용 전 점검 [구현 U-91] (standalone-gui 3.9, DR-21)

계획 화면이 첫 적용 전에 "적용할 수 없는 행동"과 "동의가 필요한 이동"을 보이게 한다. 지금은 첫 적용이 `consent_required`로 끝난 뒤에야 안다. 아무것도 옮기거나 기록하지 않는다. 코드는 `src/app/check-apply.ts`, 시험은 `tests/unit/app/u91-check-apply.test.ts`다.

```ts
checkApply({ settings: TaskForm, planRunId, digest }) → PlanCheck
  // { kind: "plan_check", planRunId, digest, checkedAt, problems: { index, problem }[], unsafeMoves: number[],
  //   inventoryLimitReached, probesLeft, probesRemoved, lockLeft }
```

- **인자.** 맞지 않으면 아무것도 읽기 전에 `invalid_arguments`다.
  - `planRunId`: 실행 id 꼴, `"latest"`는 받지 않는다(보인 계획의 id).
  - `digest`: 보인 계획의 다이제스트나 그 앞 12자(`MIN_PLAN_DIGEST_PREFIX`) 이상, 소문자 16진.
- **거부는 적용의 것이다.** 아래 순서로 본다. 여러 개에 걸리면 적용과 코드가 다를 수 있다(적용은 실행 판정을 작업 종류보다 먼저 본다).
  1. 설정(`readingSecrets`)과 그 오류
  2. 적용 task가 `plan: "apply"`로 풀리지 않으면 `run_not_plan`
  3. 계획 보기(`plan`, CLI의 runPlan)의 오류: `run_not_found`, `invalid_run_record`, `run_not_plan`, `plan_run_missing`, `plan_secrets_differ`(DR-28)
  4. 이미 적용됨 `plan_already_applied`, 기록 변경 표시 `plan_records_changed`, 다이제스트가 다르면 `plan_not_approved`
  5. store의 `loadPlan`으로 계획을 다시 읽어 경로를 얻는다. 보기가 판정한 계획(같은 다이제스트, 적용 안 됨)이어야 한다.
  6. 잠금. 다른 작업이 잡고 있으면 `workspace_locked`다(재시도 가능).
- **판정은 적용 사전 점검의 것이다.** U-111: 엔진의 `preflightPlan`(U-105)을 그대로 부른다. `applyPlan`이 부르는 바로 그 고리라 판정을 복사하지 않는다. 적용 task의 설정으로 행동마다 본다.
  - 적용 task의 `planActions`와 정책 관문(`createPolicyGate`, `PLAN_ACTION_DESCRIPTORS`, 경로를 풀기 전과 후). 아니면 `denied`다.
    - U-186: 관문은 적용 task의 쓰기 경로 목록(`writablePathSets`)도 받는다. 적용(CLI `runApply`의 관문, U-182)과 같다. 그래서 목록 밖의 동작은 점검에서도 `denied`다.
  - 그다음 tools의 `createPlanExecutor`의 `check`: 원본, 해시, 목적지, DR-21의 하드 링크 시험. `unsafe_move`는 `unsafeMoves`로, 다른 문제는 `problems`로 간다.
  - 시험이 실제 적용의 `plan_checked` 기록과 행동마다 같음을 본다.
  - 인벤토리 상한(DR-6)은 계획 보기가 센 것이다(같은 `createInventoryChecker`).
- **잠금과 시험 링크를 거둔다.**
  - 하드 링크 시험은 원본 파일의 두 번째 이름을 잠깐 만든다. 같은 볼륨이면 상태 디렉터리 안에, 아니면 원본 옆에 만든다. 그래서 점검하는 동안 작업 공간 잠금을 잡는다.
  - 끝나기 전에, 실행기가 거두지 못한 이 프로세스의 시험 링크를 찾아 지운다. 대상은 점검 전에 없던 이름이고, 일반 파일만이다.
  - 그래도 남은 시험 링크의 수는 `probesLeft`, 풀지 못한 잠금은 `lockLeft: true`로 알린다. 숨기지 않는다. 잠금 풀기는 한 번 더 해 본다.
    - U-193: store가 `false`(이미 이 점검의 잠금이 아님)를 주는 풀기도 풀지 못한 것으로 친다(V-1 L-1과 같은 규칙). 점검이 ok여도 `lockLeft`는 결과에 늘 있다.
  - R-81 L1: 점검하기 전에, 잠금 아래에서 상태 디렉터리와 계획의 원본 폴더에 있는 시험 링크 이름(`.codaryn-link-probe-<pid>-…`, 어느 프로세스의 것이든)을 모두 지운다. 일반 파일만이다.
    - 점검과 적용은 이 잠금을 쥐어야 시험 링크를 만든다. 그래서 그런 이름은 만들고 지우기 사이에 끝난 프로세스가 남긴 것이거나, 앞선 점검이 남았다고 알린 것이다.
    - 시험 링크는 언제나 다른 파일의 두 번째 이름이다. 그래서 하드 링크 수(nlink)가 2 이상인 일반 파일만 지운다. 그 이름의 유일한 파일(nlink 1)은 지우면 내용이 사라지므로 지우지 않고 `probesLeft`로 센다. **점검은 사람의 파일 내용을 없애지 않는다**(시험).
    - 지운 수는 `probesRemoved`로 알리고, 지우지 못한 것은 `probesLeft`에 더한다.
  - 점검이 도중에 실패하면 `internal_error`이고, 남긴 것이 있으면 문구가 그렇다고 말한다.
- **남기지 않는다.** 실행 디렉터리, journal, `plan_checked` 기록, 적용 표시(`markApplied`)를 만들지 않는다. 계획은 그대로 다음 적용을 기다린다.
- **글이 없다.** 응답은 순번, 코드, 수, 다이제스트뿐이다. 경로는 계획 보기(가림본)의 순번으로 짝짓는다.
- **동의도 약속도 아니다.** 점검 결과는 DR-21 동의를 만들지 않는다. 동의는 지금처럼 사람의 입력으로만 만들어 `applyPlan`의 `unsafeMoveConsent`로 간다. 적용은 사전 점검을 다시 하므로, 그 사이에 파일이 바뀌면 `plan_stale`로 끝난다.
- **읽을 수 없는 계획(R-103 L-1).** 종류를 가르기 전에 store의 `loadAnyPlan`으로 계획을 읽는다(`storedPlanKindOf`). 읽을 수 없으면 그 코드(`run_not_found`, `run_not_plan`, `plan_run_missing`, `invalid_run_record`, 읽다가 예외면 `internal_error`)를 먼저 주고 아무것도 점검하지 않는다.
  - 계획 보기도 같은 store로 읽어 같은 코드를 준다. 그래서 적용 task의 결과는 전과 같다.
  - 고치기 전에는 읽을 수 없는 계획을 적용 계획으로 여겼다. 그래서 `plan: "apply"`로 풀리지 않는 task는 원인 대신 task에 관한 `run_not_plan`을 받았다. 시험은 `tests/unit/app/u196-r103-l1-plan-kind.test.ts`다.
- **실행 계획(U-196, DR-69 B-3, B-4).** `plan.json`이 `kind: "changes"`이면 다음처럼 본다(`src/app/changes-plan.ts`).
  - 점검 task가 `plan: "run"`으로 풀려야 한다. 아니면 `run_not_plan`이고 문구가 그렇게 말한다. B-4가 열기 전에는 어떤 설정도 그렇게 풀리지 않는다(U-177).
  - 그다음 보기의 거부를 적용 계획과 같게 본다: DR-28 `plan_secrets_differ`, 이미 수행됨 `plan_already_applied`, 기록 변경 표시, 다이제스트.
  - 계획 파일마다, 그 계획을 수행할 실행의 관문이 쓰기로 거부하는지 본다(`checkChangesPlanFiles`).
    - 관문은 task의 정책·쓰기 경로 목록에 계획 파일 목록을 하나 더한 것이다(`approvedPlanWritablePathSets`와 같음). `PLANNED_FILE_DESCRIPTOR`로 글자와 실경로를 모두 본다.
    - 이는 엔진이 첫 모델 요청 전에 하는 판정이다. 거부된 파일은 그 순번으로 `problems`에 `denied`로 담긴다.
    - U-237(R-108 H-2, U-219, Codex V-21): 관문은 수행하는 실행이 받는 그것(`approvedPlan.policyFor`)과 같게 `runGuards`로 만든다. 그래서 실행의 읽기 제외 목록(모든 원천을 합친 것) 아래 파일도 거부된다. 판정은 엔진 자신의 `judgePlannedFile`을 부른다(이 모듈의 따로 쓴 줄이 아니다).
  - U-237: 이동 계획의 점검도 관문을 `runGuards`로 만든다(CLI의 이동 계획 적용과 같다). 그래서 읽기 제외 아래로 옮기거나 버리는 동작은 적용처럼 점검에서도 문제로 나온다. 전에는 점검이 아무 말 없이 지나고 적용만 거부했다. 시험 `tests/unit/app/u237-app-checks-unreadable.test.ts`.
  - 파일이 계획 때와 같은지(낡음, `plannedFileStale`)는 엔진이 실행 직전에 읽어 본다. 여기서 보면 그 사이에 바뀔 수 있는 것을 말할 뿐이라 보지 않는다(PM).
  - 잠금, 시험 링크, 이동이 없다. 결과에는 `planKind: "changes"`가 붙고 `unsafeMoves` `[]`, `inventoryLimitReached` false, `probesLeft`·`probesRemoved` 0, `lockLeft` false다. 기존 `PlanCheck` 꼴에 표지 하나만 더했다.

### 5.15 작업 공간 텍스트 파일 읽기·쓰기 [구현 U-172] (DR-72 (나), text-editing-ux 5)

GUI에서 사람이 작업 공간의 텍스트 파일을 열어 보고, 가릴 것이 없는 파일만 고치게 한다. 첫 판의 범위는 DR-72다. 코드는 `src/app/workspace-text.ts`, 시험은 `tests/unit/app/u172-workspace-text.test.ts`다.

```ts
readWorkspaceText({ settings: TaskForm, path }) → WorkspaceText
  // { kind: "workspace_text", status: "opened", path, text, masking: "current_secrets", masked, protected,
  //   lineEnding: "lf" | "crlf" | "none" | "mixed", bom, digest, bytes, editable, readOnlyReasons }
  // 또는 { kind: "workspace_text", status: "not_found" | "not_file" | "refused" | "too_large" | "not_text" | "unreadable" | "mask_failed", path }
writeWorkspaceText({ settings: TaskForm, path, text, baseDigest }) → WorkspaceTextWritten
  // { kind: "workspace_text_write", status, path, digest, readOnlyReasons, textProblems, lockLeft }
  // status: written | unchanged | conflict | workspace_locked | not_editable | text_refused | path_changed
  //       | not_found | not_file | refused | too_large | not_text | unreadable | mask_failed | write_failed
```

- **설정.** 5.12와 같은 읽기 준비로 작업 공간, 지금 등록한 비밀, 키 값, 보호 경로를 얻는다. 설정이 이름한 설정·task·변수 파일의 경로도 함께 얻는다(설정 파일은 `prepareTask`와 같은 순서: `--config` → `CODARYN_CONFIG` → 기본 위치).
- **인자.** 맞지 않으면 아무것도 읽거나 잠그기 전에 `invalid_arguments`다.
  - `path`: 5.12의 `dir`과 같은 상대 조각이고, 뿌리(`""`)는 안 된다.
  - 쓰기의 `text`: 문자열이고 UTF-16으로 온전해야 한다(짝 없는 대리 문자 안 됨). `baseDigest`: 64자 소문자 16진.
- **파일 열기**(읽기와 쓰기가 같다).
  - 뿌리의 `.codaryn`(대소문자 무관)은 `refused`다. 이어서 엔진의 작업 공간 규칙(`Workspace.resolve`)을 거친다. 뿌리 밖, 상태 디렉터리, 규칙이 거부하는 이름(Windows 장치 이름 등)은 `refused`다.
  - 조각마다 `lstat`으로 본다. 뿌리, 모든 폴더, 파일 어디에 링크나 junction이 있어도 `refused`다. 작업 공간 안을 가리키는 junction도 따라가지 않는다(시험). 일반 파일만 연다(`not_file`).
  - **검사 뒤 바꿔치기**(V-1 H-1, R-100 L-1). 검사한 뒤 부모 폴더를 junction으로 바꾸면, 경로 문자열로 다시 여는 쪽은 그것을 따라간다. 그래서 다음 순서로 연다.
    1. 순회에서 각 대상의 신원(장치, 파일 id. 64비트라 bigint로)을 기억한다.
    2. 파일을 연다. 열린 손잡이의 신원(`fstat`)이 순회한 파일과 같아야 한다.
    3. 경로를 다시 순회해 모든 신원이 같아야 한다.
    4. 그다음에야 그 손잡이로 바이트를 읽는다.
    - 열기 전의 바꿔치기는 손잡이가 다른 파일이 되어서 잡힌다. 1차 순회 도중이나 열린 뒤의 바꿔치기는 2차 순회가 달라져서 잡힌다. 어느 쪽이든 `refused`이고, 바꿔친 경로로 읽은 것은 주지 않는다.
    - Windows에서는 파일이 열려 있는 동안 그 폴더의 이름을 바꿀 수 없다. 그래서 열린 뒤의 바꿔치기는 아예 되지 않는다(시험: 그때는 `unreadable`).
  - 읽기 판정은 엔진 `readText`와 같다. `MAX_READ_BYTES`(256 KiB)를 넘으면 `too_large`, UTF-8이 아니거나 NUL이 있으면 `not_text`다. 열지 못한 파일은 글을 주지 않는다.
- **보이는 글.** BOM을 떼고 CRLF를 LF로 바꾼 뒤, 5.12의 이름과 같은 순서로 가린다. 키 모양과 지금의 키 값(`hideKeys`), 지금 등록한 값(게이트웨이의 `mask`)을 글 그대로에서 찾는다. 그다음 `cleanText`(LF와 TAB은 남김)를 거친다.
  - `masked`: 가리기가 글을 바꿨다.
  - 편집할 수 있는 파일의 `text`는 파일 글 그대로다(BOM과 CRLF만 다름). 그래서 어댑터가 한 번 더 `cleanText`·키 숨김을 해도 바뀌지 않는다.
- **편집할 수 있는 조건.** 아래 까닭이 하나도 없을 때만 `editable: true`다. 까닭은 이 순서로 `readOnlyReasons`에 모두 담긴다.
  - `masked`: 등록 값, 키 값, 키 모양이 들어 있다. 보이는 글이 파일 글이 아니다(DR-72: 가리면 달라지는 파일은 읽기만).
  - `control_characters`: 제어 문자, 줄·문단 구분 문자, 양방향 제어 문자가 `?`로 보인다.
  - `mixed_line_endings`: CRLF와 LF가 섞였거나 CR만 있는 줄이 있다. 입력란은 모든 줄을 LF로 주므로 줄 끝 하나로 되돌릴 수 없다.
  - `protected`: 효력 있는 정책의 보호 경로다. 5.12와 같은 판정(글자 기준, 실경로 기준)이고, 판정하지 못하면 보호로 본다(첫 판은 읽기만).
  - `settings_file`: 설정이 이름한 설정·task·변수 파일이다. 지금 규칙으로는 그런 파일이 작업 공간 안에 있으면 설정 자체가 거부된다(`input_inside_workspace`, S-1). 그래서 앱으로는 나올 수 없지만 겹 방어로 둔다(시험은 `readWorkspaceTextIn`으로 본다).
  - `read_only`: 파일 자체를 쓸 수 없다(읽기 전용 속성, 권한).
  - `hard_link`: 이름이 둘 이상이다. 원자적 쓰기(이름 바꾸기)는 두 이름을 갈라 놓으므로 쓰지 않는다.
  - `workspace_locked`: 지금 실행·적용·되돌리기가 이 작업 공간을 잡고 있다(`inspectLock`, 이 프로세스나 다른 프로세스).
- **읽기는 잠그지 않고 아무것도 만들지 않는다.** 상태 디렉터리도 만들지 않는다. `digest`는 읽은 바이트의 SHA-256이고, 쓰기의 기준이다.
- **쓰기**(창을 믿지 않는다).
  1. 작업 공간 잠금(실행이 잡는 것)을 잡는다. 잡혀 있으면 `workspace_locked`이고 아무것도 판정하거나 쓰지 않는다. 상태 디렉터리가 없으면 잠금이 만든다(실행과 같다).
  2. 잠금 아래에서 파일을 위처럼 열고, 지금의 설정으로 다시 판정한다. 바이트가 `baseDigest`가 아니면 `conflict`, 편집할 수 없으면 `not_editable`과 그 까닭이다. 열지 못하면 읽기의 상태(`not_found` 등)다.
  3. 새 글을 본다(`textProblems`). 보이면 달라질 글은 쓰지 않는다: 줄 끝과 BOM을 되돌린 뒤 256 KiB 초과(`too_large`), CR이나 다른 제어·구분·양방향 문자(`control_characters`), 가리기가 바꿀 값(`masked`, 사람이 키를 붙여 넣은 경우). 그러면 `text_refused`다.
  4. 줄 끝을 되돌린다. CRLF 파일이면 LF마다 CRLF, 그 밖(`lf`, `none`)은 LF다. BOM이 있던 파일은 BOM을 붙인다.
  5. 파일과 같은 글이면 `unchanged`이고 쓰지 않는다.
  6. 원자적으로 쓴다(V-1 H-1: 엔진 `writeText` 대신 단계마다 확인하는 자기 쓰기).
     - 폴더들의 신원이 열 때와 같은지 본다. 다르면 `refused`다. 파일이 바뀌었으면(신원이 다르면) `conflict`다.
     - 그 폴더에 새 임시 파일을 만든다(배타 생성이라 있는 파일을 덮지 않는다).
     - 다시 본다: 폴더 신원과, 임시 파일이 그 자리에 있는지. 다르면 `refused`이고 임시 파일을 지운다.
     - 대상을 연 신원의 손잡이로 다시 읽어 해시를 본다. 제자리에서 고쳐졌으면 `conflict`다.
     - 이름을 바꾼다.
     - 바꾼 직후 폴더 신원을 다시 보고, 그 자리의 파일이 임시 파일인지 본다. 아니면 `path_changed`다.
     - 쓰지 못하면 `write_failed`다. 쓰면 `written`과 새 `digest`(다음 저장의 기준)다.
     - 첫 확인, 임시 파일 자리 확인, 다시 읽은 해시는 겹으로 막는다. 남아 있는 바꿔치기는 셋 중 하나만 있어도 막힌다. 시험은 셋을 함께 없앤 변이로 본다.
  7. 잠금을 푼다(한 번 더 해 본다). 풀기가 실패하거나 store가 `false`(이미 이 호출의 잠금이 아님)를 주면 `lockLeft: true`로 알린다(V-1 L-1).
- **닫을 수 없는 틈**(정직하게 적는다).
  - Node에는 폴더 손잡이 기준의 이름 바꾸기가 없다(POSIX의 `renameat`, Windows의 손잡이 이름 바꾸기). 그래서 마지막 확인과 이름 바꾸기 사이의 순간은 경로로 지나간다.
  - 그 순간에 폴더를 junction으로 바꾸고 임시 파일까지 그리로 옮기는 행위자가 있으면, 이름 바꾸기가 그쪽 파일을 바꾼다. 바로 뒤의 확인이 그것을 보고 `path_changed`로 알린다. 막지는 못하고 알린다(시험이 이 경우를 그대로 고정한다).
  - 이때 쓰인 글은 사람이 쓴 글이다. 등록 값이나 키는 `text_refused`가 막으므로 들어 있지 않다.
  - 첫 확인과 임시 파일 만들기 사이의 순간에 바꿔치면, 임시 파일이 그쪽에 생길 수 있다(배타 생성이라 덮지는 않는다). 다음 확인이 찾아 지운다. 그 사이에 다시 되돌렸다면 남을 수 있다.
  - 이런 행위자는 같은 사용자 권한으로 같은 때에 작업 공간 폴더를 바꾸는 프로그램이다. 쓰는 동안은 실행이 잠금으로 막혀 있다.
- **R-100의 정보 반영.**
  - I-2: 가림 토큰처럼 생긴 글(`[[CODARYN_SECRET:…]]`)은 새 글로 쓸 수 없다(`text_refused`, `masked`). 게이트가 그 꼴을 바꾸기 때문이다. 의도다.
  - I-5, L-2: 쓰기의 잠금 id는 실행 id 꼴(`createRunId`)이다. 쓰는 동안이나 잠금이 남았을 때 `doctor`와 `--run latest`는 그것을 실행 중으로 말한다. 풀지 못한 잠금(`lockLeft`)은 주인 pid가 이 프로세스라 앱이 살아 있는 동안 "살아 있는 주인"으로 남는다. 그 거둠은 store의 U-176 몫이다.
- **실행 기록에 넣지 않는다.** 실행 디렉터리, journal, 스냅숏을 만들지 않는다. 그래서 Codaryn의 되돌리기는 이 저장을 되돌리지 않고, 실행이 바꾼 파일을 사람이 고쳤으면 그 실행의 되돌리기가 이 파일을 건너뛴다(`changed_since_run`). 저장 전에 알리는 것은 GUI 몫이다(DR-72).
- **한계.** 이름 바꾸기로 쓰므로 POSIX에서 파일 권한은 기본값이 된다. 에이전트의 쓰기(엔진 `writeText`)와 같다. 첫 판은 파일 감시가 없다. 검사 뒤 바꿔치기의 막음은 Windows에서만 시험했다(POSIX의 `O_NOFOLLOW`·`O_NONBLOCK` 열기, 열린 뒤 바꿔치기는 시험하지 못함).
- **계약 층 형식.** 새로 필요한 것이 없어 앱 계층 형식(`src/app/types.ts`)만 두었다. `MaskedText`, `ContentHash`, `MAX_READ_BYTES`는 계약 층의 것을 쓴다.

## 6. 프로세스 밖 어댑터용 줄 프로토콜 [DR-20으로 추진하지 않음 — 참고용]

> 사용자 결정 DR-20으로 이 절은 추진하지 않는다. GUI는 같은 프로세스 어댑터(엔진 전용 프로세스)로 5절 함수를 직접 부른다. 아래는 결정 전의 설계와 구현 기록으로 남긴다.
>
> 남은 코드(`src/cli/protocol/**`, `vscode/src/core/**`와 그 시험, 합계 12파일 1,451줄)는 사용자 결정 DR-66으로 지웠다(U-81, 설계 차이 조사 D-1). 아래의 "구현 상태"는 지운 코드의 기록이다(`3c09b58`).

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

구현 상태 [지운 코드의 기록: A-3 `3c09b58`, 연결 전에 DR-66으로 지움(U-81)]
- CLI 쪽은 `src/cli/protocol/`에 있다(`3c09b58`).
  - 줄 만들기: `startedLine`, `eventLine`, `confirmLine`.
  - 답 읽기: `parseAnswerLine`, `AnswerBook`, `readAnswers`. 위의 무시 규칙, EOF 규칙, 취소 우선을 지킨다.
  - 질문 하나: `askOverProtocol`. 답 없음은 `dismissed`, 취소는 거부(reject)다.
  - 이벤트 줄: `protocolJournal`이 앱 계층의 DR-15 래퍼(`journalWithEvents`)를 쓴다. 엔진이 기록에 넘긴 사건을 다시 가린 것만 쓰고, journal 파일은 읽지 않는다.
  - 옵션: `takeProtocolOptions`가 `--events jsonl`·`--confirm stdio`를 명령줄에서 떼어 낸다(`apply`에 `--confirm`은 거부).
- `main.ts`·`run.ts`·`args.ts`·계약·cli-contract 연결은 CLI 담당 몫이다(A-3 보고서의 연결 목록).
  - `--events jsonl`이면 stderr에는 프로토콜 줄만 쓴다(진행 줄·끝 요약·사람용 오류 없음).
  - 실행이 끝나면 stdin 읽기를 멈춰야 프로세스가 기다리지 않고 끝난다.
- VS Code 코어(`vscode/src/core`)와의 왕복을 시험했다: CLI 쪽이 쓴 줄을 코어가 같은 사건과 상태로 읽고, 코어의 답 줄을 CLI 쪽이 같은 답으로 읽는다(`tests/unit/cli/protocol/round-trip.test.ts`).
- 적용의 기록은 `ApplyJournal`(G-A)이라 `protocolJournal`이 아직 받지 못한다. G-A 병합 뒤 같은 래퍼를 적용 기록에도 연다.

## 7. CLI 이행 계획 (N-13, UX-D2)

### 7.1 바꾸지 않는 것 (완료 기준: 같은 입력에 같은 결과)

- stdout: `run`·`revert`·오류는 JSON 한 줄, `report`·`doctor`·`models`·도움말·버전은 글(`--json`이면 JSON 한 줄). 기존 통합 시험의 출력과 바이트 단위로 같아야 한다.
- 종료 코드 표 다섯 개: `RUN_EXIT_CODES`, `CLI_ERROR_EXIT_CODES`, `REVERT_EXIT_CODES`, `REPORT_EXIT_CODES`, `DOCTOR_EXIT_CODES`.
- 실행 전 검사의 순서와 오류 코드·문구(`run.ts:6-16`의 1~8단계).
- stderr 진행 줄(N-C가 자기 결정으로 바꾸는 것은 예외).
- **DR-4의 두 경우를 시험으로 지킨다.** A-1에 유닛이 있다. 이행 2 이후 CLI 경로에서도 같은 시험을 둔다.
  1. Windows에서 `secretEnv`의 이름이 환경 변수와 대소문자만 다를 때 지금처럼 찾고 가린다.
  2. 변수 파일이 설정한 허용 목록 변수 중 8자 미만 값(`LANG` 등)이 자식 명령에 그 값으로 간다. 8자 이상 값은 비밀로 등록되어 빠진다(R-4 I-1).

### 7.2 단계와 지금의 상태

- 상태 열은 main 6ef6e3a 기준이다(U-272가 코드로 다시 확인. 처음은 설계 차이 조사의 main 86a9470).
- 이행 1~5는 동작을 바꾸지 않는 구조 이동이다. 사용자 결정 DR-65(2026-11-13)로 한다.
  - 기능(실행 중 권한 확인 질문 5.9, GUI 남은 항목, 사용성 지적) 뒤에 직렬로 한다.
  - 이행 단위마다 고정 출력(sp0, 통합 시험)이 글자까지 같아야 병합한다(7.1).
- 이행 6은 DR-20으로 추진하지 않는다. 남은 코드는 사용자 결정 DR-66으로 지웠다(U-81).
- 이행 8(권한 질문)은 구현됐다(5.9, 아래 표).

| 이행 | 내용 | 바뀌는 파일 | 지금의 상태 |
| --- | --- | --- | --- |
| 1 계약 | `src/contracts/app.ts`(4·5절 타입), `Journal.append` 반환값(AC-D3), 질문 사건 타입 | `src/contracts/**`, `docs/cli-contract.md`(역할 1) | 일부. 4·5절 타입은 `src/contracts/app.ts`에 있다(1a, U-254). `src/app/types.ts`는 다시 내보내기만 한다. 질문 사건 타입은 계약에 있다(U-74). 남은 것: `Journal.append`는 아직 `Promise<void>`다(1b, AC-D3. 앱 계층이 `seq`를 스스로 센다) |
| 2 앱 계층 추출 | `run.ts`의 2~8단계를 `src/app`으로. `runCli`는 인자 → `startRun` → 출력만 | `src/app/**`, `src/cli/run.ts`, `src/cli/assemble.ts`, 관련 유닛의 import | 일부. 입력 층이 `src/app/input/`에 있다: 보안 검사, 글 정리, 설치 확인, 실행 id, 모델 글 꼴(C-3a, U-280), task·설정·설정 파일 위치·제공자 설정 해석, 쓰기 목록, 읽기 제외와 k, `runGuards`(C-3b, U-282). 조립은 `createAssemble` 한 벌이고(U-237), C-4(U-285)부터 `src/app/assembly.ts`에 있다. 앱 계층은 그것에 DR-4의 환경 사본 등 앱의 고리를 주어 감싸고, CLI의 실행은 고리 없이 부른다(부모 환경은 `process.env`). `prepareTask`(C-5)와 실행 수명(C-6a)은 아직 CLI다. 실행 전 검사는 아직 `runCli` 호출이다 |
| 3 이벤트와 취소 | CLI 진행 줄을 관찰자로, Y-4 안내를 앱 계층 `notice`로, 신호·취소 파일을 `handle.cancel()`로 | `src/cli/progress.ts`, `src/cli/cancel.ts`, `src/cli/main.ts` | 일부. 앱 계층 쪽은 됐다(이벤트, 다시 가림, notice, cancel). CLI는 아직 쓰지 않는다. DR-65: 기능 뒤 |
| 4 읽기 명령 | `report`, `revert`, `runs`(+`dryRun`, `latest`), `changes`(새 CLI 명령)를 앱 계층 함수로. store가 스냅샷 읽기를 내보냄 | `src/cli/report.ts`, `src/cli/revert.ts`, `src/cli/runs.ts`, `src/store/**`, `src/app/**` | 일부. 앱 함수는 모두 있다: `report`, `revert`(미리보기·`latest`·되돌리기 기록은 CLI의 명령 그대로), `listRuns`, `resolveRun`, `changes`. CLI 명령 가운데 앱 함수를 부르는 것은 `changes`뿐이다(`main.ts`가 연결). 나머지는 거꾸로 앱이 CLI를 감싼다. store의 스냅샷 읽기는 `readRunOriginals`로 있다. DR-65: 기능 뒤 |
| 5 점검·모델 | `doctor`, `models`를 앱 계층으로 | `src/cli/doctor.ts`, `src/cli/models.ts` | 일부. 앱 계층이 CLI의 `runDoctor`·`runModels`를 감싼다(`doctor`, `listModels`, `selectModel`). DR-65: 기능 뒤 |
| 6 줄 프로토콜 (DR-20으로 추진하지 않음) | `run`·`apply`의 `--events jsonl`, `run`의 `--confirm stdio`, `apply`의 `--cancel-file` | `src/cli/protocol/**`(신규, A-3), `src/cli/main.ts`, `src/cli/run.ts`, `src/cli/args.ts`, `src/contracts/**` | 추진 안 함. 연결되지 않은 채 남아 있던 CLI 쪽 모듈과 VS Code 코어 왕복 시험(`3c09b58`)은 DR-66으로 지웠다(U-81). `src/cli/protocol/`과 `vscode/`는 없다 |
| 7 범용 작업 연결 | `plan`, `applyPlan`, `review`를 앱 계층에(5.6) | `src/app/**`, G-E의 CLI | 구현됨. `plan`, `applyPlan`, `review`가 있다(5.6). 타입은 G-A의 것이다(DR-17). 앱 계층은 계약에서 바로 다시 내보낸다(U-254, `src/app/general-tasks.ts` 없앰) |
| 8 권한 질문 | 정책 "확인 필요", `EngineDeps.confirm`, 답 뒤 재판정, 질문 사건, CLI 터미널 질문(stderr에 묻고 stdin에서 읽음) | `src/engine/**`, `src/policy/**`, `src/contracts/**`, `src/cli/**` | 구현됨(5.9). 정책의 `confirm: true` 규칙과 `confirmation_required`(U-74), `EngineDeps.confirm`(U-74, 견고함 U-106), 질문 사건 `confirmation_requested`·`confirmation_answered`, 앱 계층의 전달(U-108), CLI의 터미널 질문 `src/cli/confirm.ts`(U-110) |

- 순서 제약(설계 당시): 이행 2는 N-A(`src/cli/run.ts`) 병합 뒤에 시작한다. N-A는 병합됐다.
- 각 이행은 따로 병합한다. 이행 2는 동작을 바꾸지 않는 이동만 한다.

## 8. 시험 계획

유닛(대본 모델과 임시 디렉터리) [구현]

- 수는 main 6ef6e3a 기준이다(U-272, 원본의 `test(` 호출을 셈. 되풀이 안에서 만드는 시험은 하나로 센다).
  - `tests/unit/app/`: 파일 70개, test() 358개
  - `tests/unit/cli/changes.test.ts`: 18개
  - VS Code 코어 시험(`tests/unit/vscode/core.test.ts`)은 DR-66으로 지웠다(U-81).
- 설계 당시는 38·7·11건이었다. 그 뒤 main feabd56에서는 37파일·177개, 19개였다.

| 대상 | 시험 |
| --- | --- |
| 시작 | 핸들이 첫 이벤트·엔진 시작보다 먼저 온다. 실행 전 오류는 이벤트도 실행 디렉터리도 없다. 잠긴 작업 공간은 `workspace_locked`, 다른 작업 공간은 병행 |
| 이벤트 | 엔진의 기록과 같다(`at` 제외, 순서·내용). 실행 중 명령이 journal에 끼워 넣은 줄(등록 비밀 원문, 위조한 `run_finished`)은 이벤트가 되지 않는다(DR-15, 고치기 전 실패 확인). 던지는 관찰자는 결과를 바꾸지 않는다. 모델이 준 이름·id에 든 비밀이 이벤트에 없고 모르는 도구는 `(unknown tool)`이다(L-1). Y-4 안내는 마지막 레코드 뒤 `notice` |
| 실행 목록·latest·되돌리기(DR-14) | store가 고른 `latest`와 시작 시각, 목록 순서와 한도, `latest` 이름의 디렉터리면 모호함, 미리보기는 아무것도 바꾸지 않고 기록도 없음, 되돌리기는 기록을 남기고 목록에 표시, 다시 되돌리면 `revertedBefore`, 잠긴 작업 공간에서 되돌리기 거부·미리보기 허용 |
| 취소 | `cancelled`·종료 5·변경 유지, 끝난 뒤 무효, 요청의 취소 파일 |
| 결과·오류 | `done`이 풀리면 result.json이 있고 잠금이 없다. 시작 뒤 내부 예외는 `internal_error`와 잠금 해제(예외 문구 미노출). 모든 오류 코드의 종료 코드·형태와 양방향 변환 |
| 환경(DR-4) | 사본·`lookupEnv`의 대소문자 규칙, 변수 파일 해석이 `process.loadEnvFile`과 같음, 호출자의 env와 `process.env`가 바뀌지 않음, 소문자 `secretEnv`가 Windows 규칙에서 찾아지고 가려짐(다른 OS 규칙에서는 `secret_env_missing`), 변수 파일의 `LANG`이 자식 명령에 감 |
| 비교(DR-7) | 원본·지금 내용이 지금 등록한 비밀로 가려짐, 나중 편집·삭제의 상태, 실행·잠금을 만들지 않음, 설정이 풀리지 않으면 그 오류 |
| 조립 | 보호 경로가 있으면 무결성 점검 사건이 그대로 온다 |
| 읽기 명령 | `report`(complete, `run_not_found`), `revert`, `doctor`(점검 id마다 하나: 지금 14개, `DOCTOR_CHECK_IDS`(`src/contracts/commands.ts`). 설계 당시 12개, W-5) |
| 작업 공간 목록(5.12) | 종류·순서·보호·`state`, 등록 값·키 모양·제어 문자 이름이 가려지고 `name: null`, 링크·junction과 그 안의 경로는 `refused`, `not_found`·`not_dir`, 맞지 않는 인자, 500개씩의 쪽과 숫자 순서, 상한을 넘으면 `too_large`, 상태 디렉터리를 만들지 않음, 설정 오류 |
| 실행 사건 목록(5.13) | 끝난 실행의 레코드가 그 실행의 이벤트와 같음(`at` 제외), 꼴이 맞지 않는 줄(JSON 아님, 배열, 다른 실행, 다음 번호 아님, 시각 아님, 모르는 종류, 다른 실행 종류의 종류, 비밀을 담은 필드 이름, 끝나지 않은 꼬리)이 빠지고 셈, 그 뒤 맞는 줄은 가려서 줌, 지금 등록한 값과 키 모양을 가림, 적용 실행(시작 레코드 빠짐, 번호 유지), 기록 변경 표시, 도는 중(`incomplete`), 없음·손상·맞지 않는 인자, 종류 필터와 쪽, 2 MiB 끊기와 큰 레코드 혼자, 잠금 없음·journal 그대로, 설정 오류 |
| 적용 전 점검(5.14) | 적용할 수 있는 계획에서 아무것도 남거나 바뀌지 않고(작업 공간 전체 비교) 그 뒤 적용이 됨, 실제 적용의 `plan_checked`와 행동마다 같음(`source_changed`, `destination_exists`, `denied`), 하드 링크 없음의 `unsafeMoves`, 실행기가 거두지 못한 시험 링크를 거둠, 거두지 못한 것은 `probesLeft`, 점검 중 잠금과 잡힌 잠금의 `workspace_locked`, 풀지 못한 잠금은 `lockLeft`, 적용의 거부(인자, 다이제스트, 없음, 작업 종류, DR-28, 기록 변경, 이미 적용, 적용 실행), 설정 오류 |
| 텍스트 파일 읽기·쓰기(5.15) | LF·CRLF+BOM 파일의 글·줄 끝·BOM·다이제스트, 등록 값·키 모양이 가려지고 `masked`, 제어·양방향 문자와 섞인 줄 끝, 보호·읽기 전용 속성·하드 링크·잡힌 잠금은 각 까닭으로 읽기만, 설정 파일(앱으로는 설정 거부, 판정은 `settings_file`), 링크·안쪽 junction·상태 디렉터리·장치 이름은 `refused`, `not_found`·`not_file`·`too_large`·`not_text`, 맞지 않는 인자, 읽기는 상태 디렉터리를 만들지 않음. 쓰기: 쓰고 새 다이제스트, CRLF와 BOM 되돌림, 바뀐 파일은 `conflict`, 잡힌 잠금은 `workspace_locked`, 가린·보호 파일은 자기 다이제스트로도 `not_editable`, 새 글의 등록 값·키 모양·CR·제어 문자·크기는 `text_refused`, 같은 글은 `unchanged`, 링크 너머 파일은 그대로, 풀지 못한 잠금은 `lockLeft`, 실행 기록·임시 파일·잠금이 남지 않음. V-1(`u172-v1-races.test.ts`): 검사 뒤 폴더를 junction으로 바꿔치면(1차 순회 도중, 열기 전, 열린 뒤, 판정 뒤, 임시 파일 전) 읽기는 바깥·상태 디렉터리 글 없이 `refused`, 쓰기는 바깥 파일을 바꾸지 않고 `refused`, 바꿔쳤다 되돌린 경우는 손잡이 신원이 거부, 이름 바꾸기 직전의 바꿔치기는 `write_failed`, 임시 파일까지 옮긴 경우는 `path_changed`(남는 틈), `false`를 준 잠금 풀기는 `lockLeft` |

- 시험의 힘을 변이로 확인했다. 아래 셋은 각각 관련 시험이 실패했고, 되돌린 뒤 통과했다.
  - 변수 파일을 사본 대신 호출자 env에 적재
  - 엔진 시작 관문 제거
  - `parentEnv` 제거
- 통합: 줄 프로토콜(이행 6)의 실제 CLI 프로세스 시험은 하지 않는다. DR-20으로 추진하지 않고 그 코드는 DR-66으로 지웠다(U-81).

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
- [VS Code 확장](vscode-extension.md): DR-20으로 추진하지 않는다(그 문서 머리에 표시). 참고용으로 남는다.
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
| AC-D7 | 프로세스 밖 이벤트는 `--events jsonl`로 stderr | DR-20으로 추진하지 않음(채택했던 것) |
| AC-D8 | 프로세스 밖 질문 답은 `--confirm stdio`, EOF면 거부 | DR-20으로 추진하지 않음(채택했던 것). `dismissed`와 EOF 때의 취소 확인(R-1 L-2)의 의미는 GUI 질문에도 그대로 쓴다 |
| AC-D9 | 프로세스 밖 취소는 기존 `--cancel-file` | DR-20으로 추진하지 않음. GUI는 `handle.cancel()` |
| AC-D10 | CLI 터미널 질문은 stderr에 묻고 stdin에서 읽음 | 채택(이행 8) |
| AC-D11 | 실행마다 CLI 자식 하나는 단일 프로세스 원칙 안 | DR-8로 문장 변경: 듣는 소켓 없음, 어댑터보다 오래 사는 프로세스 없음 |
| AC-D12 | CLI 실행 전 Ctrl+C는 한계로 기록 | 채택. 다른 어댑터는 시작 전 취소를 받지 않음(5.3) |
| DR-4 | 대소문자 무시 조회와 명령의 부모 환경 | A-1 구현, 7.1 완료 기준 |
| DR-7 | 비교는 다시 가린 것만, 내용은 앱·CLI 함수가 | A-1에 앱 함수. CLI 명령은 이행 4 |
| DR-10 | 물을 수 없어 거부하면 앱 계층이 `by: "default"`로 기록. 답 형식으로 사람의 답과 구분 | 5.9 의미 2, 6절 `dismissed`. 구현은 이행 8 |
| DR-12 | 적용도 task(또는 간편 형식과 프로필)를 받음. 적용의 첫 기록은 `apply_started` | 5.6 |
| AC-D13 | 비교에서 설정이 지금 풀리지 않으면 오류를 돌려주고 어댑터가 경로 목록으로 내려감((a)) | 구현됨(A-1, 5.7). 10.2에서 옮김(U-72) |
| AC-D14 | 비교의 비밀 출처는 같은 설정으로 실행하면 지금 등록될 값((a)) | 구현됨(5.7, U-17). 10.2에서 옮김(U-72) |
| AC-D15 | 모델이 준 도구 이름·호출 id는 엔진이 기록할 때 제한하고((b)), 앱 계층의 다시 가림((a))도 남김 | 구현됨(엔진 `recordableCalls`, 앱 `events.ts`). 10.2에서 옮김(U-72) |

### 10.2 결정 필요

| 번호 | 선택지 | 권고 | 근거 |
| --- | --- | --- | --- |
| AC-D16 | 앱 계층이 CLI 함수를 부르는 임시 의존(`app` → `cli`) | 이행 2까지 허용. 이행 1~5는 DR-65로 기능 뒤에 하므로 그때까지 유효 | 보안 검사를 복사하면 두 벌이 갈라진다 |
