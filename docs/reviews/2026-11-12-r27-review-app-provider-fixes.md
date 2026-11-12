# R-27 병합 전 검토: 앱 계층 수정 다섯 건 (w3:p4, 2026-11-12)

## 0. 대상과 방법

- 페르소나: 검증 엔지니어. 읽기 전용이며 파일 수정·커밋은 없다.
- **고정 판: `pm/bundle-3b` = `57ff974`**(main `434006b`에 세 번째 묶음과 그 수정을 합친 것)
- 범위(`git log main..pm/bundle-3b -- src/app`)

  | 커밋 | 내용 |
  | --- | --- |
  | `21498b6` | listModels·selectModel이 provider를 넘김 |
  | `fb1c934` | 설정과 실행 목록이 모든 제공자의 키를 다룸 |
  | `139746e` | providerDeps |
  | `7456abe` | 제공자·주소 변경을 넓히는 변경으로 판정 |
  | `982bfae` | 설정의 첫 정책·검증기가 작업 종류의 규칙을 대체할 때의 판정 |
  | `fe90728` | 병합 |

  - `bf56283`·`7e3d669`는 `21498b6`·`fb1c934`와 `src/app` 변경이 같다(`git diff` 0줄).
  - 병합으로 들어온 `dd017ff`(reportMarkdown)는 읽기만 했다(4절).
- 읽기: `git -C D:\project\Codaryn diff main...pm/bundle-3b -- src/app`, 관련 `src/cli/settings.ts`, `src/cli/task.ts`, `src/cli/models.ts`, `src/cli/run.ts`, `gui/src/engine-host/main.ts`
- 빌드 사본: `.codaryn/r27/b`(`git archive 57ff974`, `npm run build` 성공)
- 실험 스크립트: `.codaryn/r27/r27.mjs`(A, B, C, E, F, G), `.codaryn/r27/a2.mjs`. 로그는 `.codaryn/r27/*.log`.
  - 모두 실제 입력이다. 설정 파일을 쓰고 앱 API(`proposeSettingsChange`, `applySettingsChange`, `readSettings`, `listModels`, `selectModel`)와 CLI(`run`, `models`)로 돌렸다.
  - 주소는 127.0.0.1의 가짜 서버나 닫힌 포트 `127.0.0.1:9`뿐이다. CLI는 네트워크 울타리를 미리 올렸고 차단 기록 0건이다.
  - 가짜 키 값만 썼다. 키 모양 값은 조각을 이어 실행 중에만 만들었다.

심각도: 높음(지금 틀린 통과나 유출, 선행 조건 없음), 중간(재현되는 결정 위반, 선행 조건 있음), 낮음, 정보.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 0 |
| 낮음 | 1 (R27-L1) |
| 정보 | 5 (R27-I1~I5) |

| 중점 | 결과 |
| --- | --- |
| 넓히는 변경 판정을 빠져나가는 길 | **찾지 못했다.** 25가지 입력(2절)에서 실제 목적지나 제공자가 바뀌는 변경은 모두 넓힘으로 잡혔다. 확인 없는 적용은 거부되고, 두 번에 나눠 바꾸면 매번 확인을 요구한다 |
| 좁히는 변경의 오탐 | 명령 빼기, 한도 낮추기, 보호 경로 더하기, 작업 종류보다 좁은 설정 정책은 확인을 요구하지 않는다. 다만 목적지가 같은 변경 둘이 확인을 요구한다(R27-I1) |
| 키가 든 설정을 CLI와 앱이 똑같이 거부하는가 | **같다.** 8가지 모두 판정이 같고, 값은 어느 문구에도 없다(3절 B) |
| 문구·이벤트·기록에 키나 주소의 비밀스러운 부분 | **없다.** 넓힘 목록은 필드 경로만 싣는다. 사용자 정보·질의·조각이 든 주소는 고정 문구로 거부된다(3절 G) |
| providerDeps가 바깥으로 나갈 길을 여는가 | **열지 않는다.** 제품 경로(GUI 본 프로세스, CLI)는 주입점을 넘기지 않는다. 그러나 GUI 엔진 호스트의 시험용 루프백 전용 전송은 Anthropic에만 걸려, OpenAI 요청이 그 보호를 거치지 않는다(R27-L1) |
| 기존 Anthropic 경로 | **그대로다.** 다음을 확인했다(3절 F). |
| | - `models --provider anthropic` 출력이 플래그 없는 출력과 `provider` 필드만 다르다. |
| | - Anthropic의 `selectModel`은 최상위 `model`에 쓴다. |
| | - 고정 판에서 앱 유닛 107건, m01·m02·m03·y01·k02·n04·s01이 모두 통과한다. |

## 2. 넓히는 변경 판정(`7456abe`, `982bfae`): 입력과 결과

`proposeSettingsChange`에 실제 설정 파일(앞)과 새 설정(뒤)을 줬다. "주소 X"는 127.0.0.1의 닫힌 포트다.

| 변경 | 넓힘 |
| --- | --- |
| Anthropic 최상위 주소 X → Y | `api_base_url_changed@apiBaseUrl` |
| 간편 실행은 Anthropic인데 OpenAI 주소만 추가 | `api_base_url_changed@providers.openai.apiBaseUrl` |
| 호스트 대소문자만 / 끝 슬래시만 / `:443` 명시 | 없음. 저장되는 주소가 같다(정규화 확인: 저장 값이 모두 `https://api.example.com`), 목적지가 같다 |
| 다른 포트(`:8443`) | `api_base_url_changed` |
| 기본 주소를 명시(Anthropic / OpenAI) | `api_base_url_changed`(R27-I1) |
| `providers.openai` 블록 삭제(사용자 주소 → 기본) | `api_base_url_changed@providers.openai.apiBaseUrl` |
| 주소 없는 `providers.openai` 블록 삭제 | 없음 |
| 최상위 주소를 같은 값 그대로 `providers.anthropic`으로 옮김 | `api_base_url_changed@apiBaseUrl`(R27-I1) |
| `provider` anthropic → openai, openai → 생략 | `provider_changed` |
| `provider: "anthropic"` 명시 → 생략 | 없음(같은 제공자) |
| 프로필에 `provider: "openai"` 추가 | `profile_changed`(R27-I4) |
| 두 번에 나눔: OpenAI 주소 추가, 그다음 provider openai | 각각 `api_base_url_changed`, `provider_changed` |
| OpenAI 모델만 바꿈 | 없음 |
| 좁힘: 명령 빼기, 한도 낮추기, 보호 경로 더하기 | 없음 |
| F-5: 작업 종류보다 좁은 설정 정책 추가 | 없음 |
| F-5: 설정 정책 삭제(작업 종류 자신의 규칙으로) | `plan_action_allowed@workflows.organize.policy.planActions`, 설정 정의 작업 종류면 `command_added@workflows.w1.policy.commands[0]`도 |
| F-5: 설정 검증기 추가(설정 정의 작업 종류의 자기 검증기가 대체됨) | `verifier_removed@workflows.w1.verifiers` |
| F-5: 설정 검증기 삭제 | `verifier_removed@verifiers` |
| 변경 없음 | 없음 |
| 넓히는 변경을 `confirmWidening: false`로 적용 | `invalid_arguments`, 쓰지 않음 |

- 환경 변수(`CODARYN_API_BASE_URL`, `CODARYN_OPENAI_API_BASE_URL`)와 변수 파일로 바꾸는 주소는 설정 파일 판정 밖이다(R27-I3).

## 3. 다른 실험

**B. 키가 든 설정: 앱 `proposeSettingsChange` 대 CLI `run --config`**(값은 `providers.openai.model`에 넣음)

| 값 | 앱 | CLI | 값 노출 |
| --- | --- | --- | --- |
| `OPENAI_API_KEY`의 현재 값(28자) | `key_in_file` | `key_in_file`(2) | 없음 |
| 같은 경우 18자 | `key_in_file` | `key_in_file` | 없음 |
| 같은 경우 12자 | 받음 | 받음(실행은 닫힌 포트로 `model_error`) | 없음 |
| `ANTHROPIC_API_KEY`의 현재 값(28자) | `key_in_file` | `key_in_file` | 없음 |
| OpenAI 좁은 모양(`sk-` 뒤 40자, 숫자·대문자 포함) | `key_in_file` | `key_in_file` | 없음 |
| OpenAI 느슨한 모양만(소문자 40자) | 받음 | 받음(키 없어 `provider_not_configured`) | 없음 |
| OpenAI 접두 모양(`sk-` `proj-` 뒤 20자 이상) | `key_in_file` | `key_in_file` | 없음 |
| Anthropic 좁은 모양 | `key_in_file` | `key_in_file` | 없음 |

- 같은 이유: 두 쪽 모두 `knownKeyValues`(`src/cli/settings.ts:43`)와 16자 기준(`keyValuesOf`)을 쓴다.

**C. `readSettings().keyAvailable`(`fb1c934`)**

| 설정·키 | 결과 |
| --- | --- |
| provider openai + Anthropic 키만 | false |
| provider openai + OpenAI 키 | true |
| provider 없음 + OpenAI 키만 | false |
| provider 없음 + Anthropic 키 | true |

- 어느 출력에도 키 값이 없다.

**E. providerDeps(`139746e`)**: 가짜 Anthropic·OpenAI 서버, 두 키, `listModels`를 제공자마다 불렀다.

| 넘긴 hooks | 주입한 fetch가 본 요청 |
| --- | --- |
| GUI 호스트처럼 `anthropicDeps`만 | Anthropic 요청뿐. OpenAI 요청은 서버에 닿았지만 주입 fetch를 거치지 않았다(R27-L1) |
| `providerDeps.openai` | OpenAI 요청만. Anthropic은 전역 fetch |
| `providerDeps.anthropic`과 `anthropicDeps` 함께 | `providerDeps.anthropic`만(우선함) |

- OpenAI 요청에는 `x-api-key`가 없고, Anthropic 요청에는 `authorization`이 없다.

**F. Anthropic 경로와 모델 선택(`21498b6`)**

| 확인 | 결과 |
| --- | --- |
| `selectModel(anthropic)` | 최상위 `model`에 쓰고 `providers.anthropic`을 만들지 않는다 |
| `selectModel(openai)` | `providers.openai.model`만 바꾸고 다른 필드는 그대로다 |
| `models --provider anthropic --json` 대 플래그 없음(Anthropic 설정) | 종료 0/0, `provider` 필드 말고 같다 |
| 목록에 없는 제공자 | 읽기 전에 `invalid_arguments` |

- 고정 판 사본에서 통과한 시험: 앱 유닛 107건, m01 16, m02 28, m03 11, y01 36, k02 32, n04 18, s01 55, o01 4, o02 5, o04 4

**G. 주소의 비밀스러운 부분**: `providers.openai.apiBaseUrl`에 다음을 넣었다.
- 사용자 정보, 질의, 조각, 엔드포인트 경로, 루프백이 아닌 http
- 모두 `invalid_config`이고 고정 문구(`... must be an https URL ... without user info, query, fragment ...`)다. 표지 문자열(사용자명, 비밀번호, 질의 값, 호스트)은 문구·오류 값 어디에도 없다.

## 4. 낮음

### R27-L1 GUI 엔진 호스트의 시험용 루프백 전송이 Anthropic에만 걸린다: OpenAI 요청은 그 보호를 거치지 않는다

- 위치: `gui/src/engine-host/main.ts:148-149`
  - `loopbackOnly` 모드에서 `{ anthropicDeps: { fetch: loopbackOnlyFetch(...) } }`만 넘긴다.
  - `139746e`가 `providerDeps`(제공자마다 주입점)를 더했는데, 호스트는 아직 쓰지 않는다.
- 재현(3절 E 첫 줄): 호스트와 같은 hooks로 `listModels({ provider: "openai" })`를 불렀다.
  - 요청은 가짜 OpenAI 서버에 닿았다.
  - 주입한 fetch는 Anthropic 요청만 봤다.
  - 실행 경로도 같다. `src/cli/run.ts:691`은 `providerDeps?.[provider] ?? (anthropic일 때만 anthropicDeps)`를 쓴다.
- 영향
  - GUI 시험이 OpenAI 설정을 쓰면, "이 기계 밖으로는 보내지 않는다"는 시험 전송의 보장(`gui/src/engine-host/transport.ts`의 머리말)이 지켜지지 않는다. 기본 주소면 실제 OpenAI 주소로 나간다.
  - 제품 경로는 영향이 없다. 본 실행은 주입점을 넘기지 않는다.
  - providerDeps 자체는 바깥 길을 열지 않는다. hooks는 앱을 만드는 쪽 코드만 넘기고, 렌더러는 함수를 넘길 수 없다.
- 범위: `src/app`이 아니라 GUI 호스트다. F-2가 겨냥한 R21b-I-1의 마무리가 빠진 것이다.
- 권고(GUI 담당): `loopbackOnly`일 때 `providerDeps`에 모든 API 제공자(`API_PROVIDER_NAMES`)의 `fetch`를 같은 `loopbackOnlyFetch`로 넘긴다. 호스트 시험에 OpenAI 경우를 더한다.

## 5. 정보

- **R27-I1 목적지가 같은 변경이 확인을 요구한다(오탐 둘).**
  - 기본 주소를 명시만 하는 변경: Anthropic `https://api.anthropic.com`, OpenAI `https://api.openai.com/v1`
  - 최상위 주소를 같은 값 그대로 `providers.anthropic`으로 옮기는 변경: 옛 최상위 비교(`settings-change.ts`의 `same(before.apiBaseUrl, after.apiBaseUrl)`)가 남아 있어서다.
  - 확인을 한 번 더 받을 뿐 해는 없다. 줄이려면 제공자마다 실제로 읽히는 주소를 표의 기본값까지 펼쳐 비교하고, 옛 최상위 비교를 뺀다.
- **R27-I2 주소 정규화 덕에 대소문자·끝 슬래시·`:443` 차이는 넓힘이 아니다.** 저장 값이 같아 목적지가 같으므로 맞는 판정이다. 다른 포트·경로는 잡힌다.
- **R27-I3 환경 변수와 변수 파일의 주소는 설정 판정 밖이고, 설정 화면 값(`SettingsView`)에도 드러나지 않는다.**
  - 사람이 정한 입력이라 설계대로다(R-20 I-3).
  - 다만 GUI 설정 화면만 보는 사람은 덮어쓴 주소를 모른다. `doctor`는 `sends_to_env`로 알린다.
  - 설정 화면에도 같은 알림을 두는 것을 고려할 만하다.
- **R27-I4 프로필의 `provider` 변경은 `profile_changed`로 잡힌다.** 확인은 요구되지만 종류 이름이 제공자 변경을 말하지 않는다. 화면 문구가 "프로필이 바뀜"이면 무엇이 넓어지는지 덜 드러난다.
- **R27-I5 `dd017ff`(reportMarkdown)는 읽기만 했다.**
  - `-`로 시작하는 작업 공간·실행 id를 거부한다.
  - CLI `runReport`를 같은 env 복사로 부르므로 출력 정리(모든 키 값 가림)는 CLI와 같다.
  - 실행으로 확인하지는 않았다.

## 6. 검사하지 않은 범위

- 실제 GUI 창과 렌더러에서의 확인 흐름
- `startRun`을 OpenAI로 끝까지 돌리는 앱 경로. 목록·선택·설정만 앱으로 돌렸고, 실행은 CLI 통합 o01~o03이 다룬다.
- `listRuns`의 키 가림(`fb1c934` runs.ts): 기록에 키가 남는 실행을 만들 수 없어(실행 전에 거부됨) 실험하지 않았다. 코드상 CLI `runs`와 같은 `knownKeyValues`를 쓴다.
- macOS·Linux

## 7. PM 판단 필요

- **Q-1(R27-L1)**: GUI 호스트가 `providerDeps`로 모든 제공자에 시험 전송을 걸도록 GUI 담당에게 맡길지. 이번 병합과 함께 할지 뒤로 둘지.
- **Q-2(R27-I1, I4)**: 목적지가 같은 변경의 오탐을 줄일지, 프로필의 제공자 변경을 별도 종류로 보일지.

사용자에게 물을 질문은 없다.
