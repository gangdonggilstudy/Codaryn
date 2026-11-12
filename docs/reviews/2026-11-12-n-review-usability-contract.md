# N-A 계약 검토 — 9735b5f

- 이해 확인: 검증 엔지니어(주), 보안·개인정보 검토자(보조). 목적은 N-1~N-9 대조, 기존 계약 호환성 및 출력 값 유출 경계 검토다.
- 작업 worktree: `D:\project\Codaryn\.worktrees\codex-verify`, 분리 HEAD `688a9186e3632f58426990e54e3e5dcb3facbff5`. 시작 시 추적 파일 변경 없음.
- 대상: `claude/workspace-policy`, `9735b5f9a745bf4c6ab773be90ae9734afac042f`; 부모 `b3861669199bc5a2f7c48cb04b6cb5730bc3c9a7`. 줄 번호는 대상 커밋 기준이다.
- 소유 산출물: 이 보고서 하나. 제품·테스트·관리 문서 수정, 커밋, 병합, 설치, 실제 API, 키 파일 조회를 하지 않았다.
- 완료 기준: 결정과 계약을 대조하고, 확인 사실과 추측을 구분하여 파일:줄·영향·보완안을 보고한다.
- 결과: **높음 1건 / 중간 3건 / 낮음 1건**. 계약 검토 결과이며 실제 유출이나 되돌리기 오동작을 재현했다는 뜻은 아니다.

## 높음

### H1. 문구 매개변수의 안전한 종류가 실제 타입에 연결되지 않는다

- 위치: `src/contracts/human.ts:195`, `src/contracts/human.ts:198`, `src/contracts/human.ts:204`. 관련: 같은 파일 `:59`, `:99`, `:219`; `src/contracts/config.ts:140`; `src/contracts/commands.ts:213`.
- 근거: N-4는 파일·환경의 값을 문구에 넣지 않도록 한다. 새 계약은 `MessageParamKind`로 종류를 나누지만, 실제 `MessageParams`는 임의 키의 `string | number`이고 `format`은 id와 매개변수의 이름·종류를 연결하지 않는다. 주석상 런타임 검사는 누락·추가 매개변수뿐이며, 값은 그대로 치환한다. `RawText`도 string의 하위 타입이므로 이 경계를 통과할 수 있다. 기존 `src/contracts/text.ts:16`의 `MaskedText` 경계가 적용되지 않는다.
- 합성 입력 예: `catalog.format('summary.changes', { count: 'SYNTHETIC_PRIVATE_VALUE' })`, `catalog.format('error.detail', { detail: 'SYNTHETIC_PRIVATE_VALUE' })`. 후자는 매개변수 이름도 맞으므로 주석에 명시된 누락·추가 검사로 차단할 수 없다. 코드·필드·다른 카탈로그 문구의 자리에도 같은 문제가 있다. 이 예의 타입 허용 여부는 선언을 대조한 정적 판단이며 컴파일 실행으로 확인하지 못했다.
- 별도로 `DefaultConfigLocation.display`, `RunSummaryContext.configDefaultDisplay`, `InitOutput.config.display`도 모두 string이다. 실제 경로를 표시용 값에 넣어도 선언으로 구분되지 않는다. 특히 `InitOutput`의 JSON은 렌더링 후 stderr 마스킹으로 보호할 수 없다.
- 기존 계약과의 구체적 충돌: `human.ts:59`는 verifier id가 패턴으로 제한된다고 전제하지만, `src/contracts/verify.ts:10`, `:30`은 string이고 `src/cli/task.ts:305`, `:319`는 비어 있지 않은 문자열만 검사한다. 기존 유효한 verifier id `customer private memo`를 새 `progress.verifier`에 넣으면 파일의 값이 문구 매개변수가 된다. 이를 신규 정규식으로 거부하면 기존 설정 호환성을 깨므로, 출력에서 고정 위치/번호로 바꾸거나 명시적인 마스킹 경계가 필요하다.
- 영향 **[추측: 구현 의존]**: N-B/N-C가 이 계약대로 값을 그대로 치환하면 미등록 민감값이나 실제 환경 경로가 출력될 수 있다. 게이트가 있을 때만 사후 마스킹한다는 `human.ts:231`은 값 유입 금지와 같지 않으며, 시작 전 오류·init·runs에 게이트가 항상 있다는 보장도 없다.
- 보완: 메시지 id별 매개변수 타입을 연결하고 숫자·고정 코드·스키마 필드 위치·검증된 표시 문자열을 구분한다. 표시 위치는 `typeof DEFAULT_CONFIG_DISPLAY[keyof typeof DEFAULT_CONFIG_DISPLAY]` 등으로 좁힌다. 파일에서 온 자유 텍스트가 필요한 예외는 N-4와의 관계 및 출력 직전 검증/마스킹 책임을 명시한다.

## 중간

### M1. N-6의 오류 필드·JSON 줄/열 전달 계약이 빠져 있다

- 위치: `src/contracts/human.ts:73`, `src/contracts/human.ts:236`; 관련: `src/contracts/engine.ts:204`, `docs/cli-contract.md:604`, `:667`.
- 근거: N-6은 설정·task 오류의 필드와 JSON 문법 오류의 줄·열을 요구한다. 신규 연결 표는 N-6 전달 계약을 정의하지 않으며, `HumanOutput.error`는 기존 `CliErrorOutput.message: string`만 받는다. 별도 진단 위치 필드도, 줄·열을 전달하는 문구 id/규칙도 없다. 필드 종류 `field`를 선언했지만 실제 `FIXED_MESSAGES`에서는 오류 위치 인자로 사용하지 않는다.
- 기존 상태 확인: `src/cli/run.ts:148`의 JSON 파서는 위치 없이 `{ ok: false }`를 반환하고, `src/cli/doctor.ts:94` 부근은 고정된 JSON 읽기 실패 문구를 만든다. 계약만 추가하는 단계이므로 미구현 자체를 결함으로 세지 않았지만, 구현자 사이에 N-6의 정보를 넘길 계약이 없는 점은 보완이 필요하다.
- 합성 재현 조건: 여러 줄의 config에서 `"limits": ,`처럼 문법 오류를 만든 경우. 현재 정의만 따르면 N-A가 위치를 버려도 N-C는 이를 복구할 수 없다. 영어 `message`에 위치를 붙이는 방식도 가능하지만, 두 언어의 표현 방법·위치 단위·안전한 필드 경로 규칙이 합의되어 있지 않다.
- 영향 **[추측: 구현 의존]**: 줄·열 누락 또는 원래 JSON 파서 예외 메시지를 그대로 출력하는 보완으로 이어질 수 있다. 후자는 원문 조각을 포함할 수 있어 S-6와 충돌한다.
- 보완: 기존 message를 보존하면서 선택적 구조화 진단(고정 진단 코드, 안전한 필드 위치, 숫자 line/column)을 추가하거나 동등한 명시적 계약을 정한다. 임의 프로필 이름·알 수 없는 JSON 키를 필드 위치라는 이유로 그대로 출력하지 않도록 한다.

### M2. 실행 목록은 기록을 신뢰하기 전에 확인할 계약이 부족하다

- 위치: `src/contracts/commands.ts:248`, `:252`, `:254`, `:261`, `:269`, `:281`; 관련: `src/contracts/human.ts:250`, `src/contracts/engine.ts:242`.
- 근거: `ListRuns`는 링크인 실행 디렉터리와 읽기/파싱 실패를 건너뛴다고만 정의한다. 첫 기록이 `run_started`이고 해당 runId·seq인지, result/revert 기록이 같은 실행의 것인지, 날짜가 실제 UTC 시각인지, 출력 문자열을 검증·가림 처리하는지는 정하지 않는다. `RunListEntry`의 taskId·시각과 `revertedBefore.at`은 일반 string이며 JSON 출력에도 그대로 사용 가능한 형태다.
- 기존 경계와 비교: 같은 `commands.ts:24`는 기존 report가 다른 실행의 기록을 `invalid_run_record`로 거부한다고 명시한다. `docs/cli-contract.md:490`도 실행 귀속과 사용 필드 검증, 확인한 필드만으로 결과 재구성을 요구한다. `src/cli/report.ts:1`의 구현 설명은 허용된 명령이 기록을 바꿀 수 있으므로 제어 문자와 키 모양 문자열도 출력에서 처리한다고 명시한다. 새 계약의 "Text is masked as recorded"만으로 이 전제를 대체할 수 없다.
- 합성 검증 조건: 실행 A 디렉터리의 첫 journal 기록을 runId B로 바꾸거나, taskId/at에 `SYNTHETIC_PRIVATE_VALUE`를 넣고 `runs --json` 및 `revert --run latest`를 수행한다. 기록은 JSON 파싱에는 성공한다.
- 영향 **[추측: 구현 미제공]**: 계약에 없는 검증을 구현자가 추가하지 않으면 위조된 문자열이 JSON/표에 출력되고 시각 정렬 및 latest 선택에 영향을 줄 수 있다. 실제 목록 구현을 실행한 유출 재현은 아니다.
- 보완: 기존 report에 준하는 실행 귀속·스키마·상태/이유 조합·날짜 검증과 출력 정제 책임을 명시한다. result/revert 파일 부재, 손상, 읽기 실패를 구분하고 손상된 기록이 latest 선택에 미치는 정책도 정한다.

### M3. 실행 요약이 요구하는 거부 호출 수를 전달할 필드가 없다

- 위치: `src/contracts/human.ts:238`, `:241`; 관련: 같은 파일 `:82`, `:216`; `src/contracts/engine.ts:176`.
- 근거: `runSummary`는 거부된 호출과 안내를 요약한다고 정의하고 `summary.denied`는 count를 요구한다. 그러나 입력인 `EngineResult`와 `RunSummaryContext`에는 거부 횟수가 없다. `usage.toolCalls`는 전체 호출 수이고 거부 횟수가 아니다. HumanOutput은 `:230`에서 아무것도 읽지 않는다고도 규정한다.
- 검증 조건: 같은 도구 호출 수·최종 결과를 가진 두 실행에서 하나만 policy 거부를 한 번 기록한다. `runSummary`의 계약상 입력만으로 두 실행을 구별할 수 없다. `progressLine`을 이용한 내부 누적 상태는 계약에 없고, 진행 출력을 생략하거나 renderer를 재사용하는 경우의 수명 규칙도 없다.
- 영향: N-C는 거부 횟수를 빠뜨리거나, 입력 계약 밖의 숨은 상태에 의존해야 한다. N-5 자체가 거부 횟수를 필수로 요구하는 것은 아니지만, 이번 커밋이 추가한 요약 계약은 현재 시그니처로 충족할 수 없다.
- 보완: `RunSummaryContext`에 검증된 `deniedToolCalls` 집계를 전달하거나 해당 요약 요구를 제거한다. 기존 `ReportJournalSummary.deniedToolCalls`와 집계 의미를 맞춘다.

## 낮음

### L1. latest 별칭으로 기존에 유효했던 같은 이름의 실행을 직접 선택할 수 없게 된다

- 위치: `src/contracts/commands.ts:242`; 관련: `docs/cli-contract.md:44`, `:652`.
- 근거: 기존 runId 입력 계약은 영숫자로 시작하는 1~128자이고 `latest`도 허용한다. 새 계약은 `--run latest`를 첫 실행으로 해석하고 이름이 latest인 디렉터리를 직접 선택할 수 없다고 명시한다. 따라서 문자열을 그대로 사용하는 기존 호출의 의미가 바뀐다.
- 조건: 유효한 기록을 가진 `runs/latest`와 그보다 최신인 다른 실행이 있을 때 기존 `revert --run latest` 호출은 대상이 달라진다. **[추측: 조건부 영향]** 실제로 이 이름의 기록을 가진 사용자가 있는지는 확인하지 않았다. 기본 `createRunId`는 시각+난수 형식이므로 일반 생성 경로에서는 충돌하지 않아 낮음으로 분류했다.
- 보완: literal runId를 선택할 별도 방법 또는 이름 충돌 시 명시적 오류를 정한다. 별칭 추가 자체는 N-7 결정이므로 그 결정을 취소할 사안은 아니다.

## 대조 완료 및 한계

- N-1: 우선순위, OS별 기본 위치, 실경로의 작업 공간 내부 거부가 명시되어 있다. 표시용 타입의 누출 여지는 H1에 포함했다.
- N-2: 배타 생성, 터미널 질문, 키 비수집, 모델 선택/자리표시자, 한도·명령·보호 경로·언어 설정의 계약을 확인했다.
- N-3: 빈 값 및 `<...>` 자리표시자를 각 모델 우선순위에서 미설정으로 취급하는 규칙을 확인했다.
- N-4~N-6: 언어 우선순위, JSON 코드 유지, stderr 요약, quiet, 진행 줄 코드 위치는 문서화되어 있다. H1·M1·M3를 제외하고 이 검토에서 추가 확정 결함은 세지 않았다.
- N-7: 목록, latest, dry-run 무변경, 되돌리기 기록과 이전 상태 필드는 있다. M2·L1을 보완해야 한다.
- N-8: profiles의 policy/verifiers/limits, 사용자 설정 한정, 모든 프로필의 상한 검사 및 task 실행 시 limits만 적용하는 규칙을 확인했다.
- N-9: cwd 사용, 설치 위치 겹침 거부, 목표의 키 검사와 기존 출력 계약이 명시되어 있다.
- 기존 RevertOutput의 새 필드는 선택적이고, 기존 상태·종료 코드를 제거하지 않는다. RUN_REASONS와 RevertSkipReason의 상수화에서 기존 값 삭제는 발견하지 않았다.
- 실행한 검증: `git show 9735b5f`의 7개 파일 diff, 대상 커밋의 관련 계약·CLI 소스, N-1~N-9 결정표 및 기존 report/오류/검증기 계약을 정적으로 대조했다. 대상 브랜치 HEAD와 해시 일치를 확인했다.
- 타입 실험: 디스크 파일 생성 없이 메모리상의 대상 계약과 합성 입력을 TypeScript compiler API로 검사하려고 했으나, 설치된 `typescript`가 `lib/version.cjs`의 버전 정보만 export하여 `ts.ScriptTarget.ES2022` 접근 단계에서 실패했다. **타입 검사 통과로 기록하지 않는다.** 패키지를 변경하거나 설치하지 않았다.
- 유닛·통합·실제 CLI 재현: 미실행. 실제 API·네트워크·키 파일 조회: 미실행. 새 기능 구현은 대상 커밋에 없으므로 실제 동작과 유출 여부를 보증하지 않는다.
- 관리자 판단 요청: H1과 M1~M3의 계약 보완을 N-B/N-C 연결 전에 배정하고, L1의 충돌 처리 정책을 확정한다. 수정·통합은 수행하지 않았다.
