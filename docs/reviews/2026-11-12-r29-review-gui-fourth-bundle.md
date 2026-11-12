# R-29 병합 전 검토: GUI 변경 (w3:p4, 2026-11-12)

## 0. 대상과 방법

- 페르소나: 검증 엔지니어. 읽기 전용이며 파일 수정·커밋은 없다.
- **고정 판: `pm/bundle-4` = `700fa35`**: main `5701ebe`에 `claude/gui-design` `25ca5af`, `claude/adapter-gui-findings` `cf6d910`, `claude/revert-store` `1adb605`를 합친 판
- 범위(`git log main..pm/bundle-4 -- gui`): `25ca5af`, `e807a2e`, `e471c59`, `25343ec`, `d138e2e`, `5b9c469`, `a28956e`, `15748d2`, `2152501`
  - 중점 다섯 가지에 닿는 커밋을 깊게 읽었다.
    - `5b9c469`: 제공자 선택, 제공자마다 시험 전송
    - `e807a2e`: 소켓 감싸기, 거절 수
    - `d138e2e`: `API_KEY_ENVS` 가림
    - `25343ec`: 새 작업 화면의 제공자·모델
    - `e471c59`: 실행별 형식 기억
    - `25ca5af`: `provider_changed` 이름
    - `15748d2`: 설정 제안
  - `a28956e`(변경 보기), `2152501`(보고서 탭)은 이 다섯 중점에 닿는 곳만 읽었다.
- 사본: `.codaryn/r29/b`(`git archive 700fa35`)
  - 루트 `node_modules`는 내 작업 트리로, `gui/node_modules`는 이미 설치된 `.worktrees/claude-gui/gui/node_modules`(Electron 45.3.1)로 이은 정션이다.
  - 새로 내려받은 것은 없다.
  - 루트 `npm run build` 뒤 GUI 시험을 돌렸다.
- 실험 스크립트: `.codaryn/r29/r29t.mjs`(전송), `r29f.mjs`(fetch 경로), `r29s.mjs`(4a, 4b, 5). 로그는 `.codaryn/r29/*.log`.
  - 주소는 이 기계뿐이다.
    - 가드가 목록에 두지 않은 숫자 표기(`0:0:0:0:0:0:0:1`, `::ffff:127.0.0.1`)
    - 연결 전에 닫힌 것을 확인한 포트(9, 39917)
    - 그 밖에 127.0.0.1
  - 그래서 가드가 뚫렸더라도 바깥으로 나가거나 이름을 조회할 수 없다. 방어를 지우는 실험은 하지 않았다.

심각도: 높음, 중간(재현되는 결정 위반, 선행 조건 있음), 낮음, 정보.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 0 |
| 낮음 | 1 (R29-L1, 연기 시험의 흔들림 원인) |
| 정보 | 4 (R29-I1~I4) |

| 과제 | 결과 |
| --- | --- |
| (1) GUI 유닛 | **`npm test`: 133건 중 133 통과**, 실패·건너뜀·todo 0. 빌드와 `check-lock` 포함 |
| (1) 연기 시험 3회 | **세 번 모두 129건 중 129 통과**, 앱 종료 0. `apiRequests`는 매번 `{models:2, messages:8, other:[], allFakeKey:true}`, `transportRefused`는 `{loopback-only, 0}`. 이번에는 흔들리지 않았다. 담당자가 본 실패의 유력한 원인은 R29-L1이다 |
| (2) loopback 전용 모드가 막는가 | **막고 센다.** 3절 표의 13가지가 모두 연결·조회 전에 거절되고 한 번씩 셌다(`fetch` 가드, 소켓 가드, 앱 fetch를 거치지 않는 전역 `fetch`). 허용 대상(127.0.0.1, `::1`, 로컬 파이프)은 그대로 지난다. UDP는 감싸지 않는다(R29-I1) |
| (2) 제품 시작 경로 | **켜지 않는다.** `src/main/main.ts:7`은 `startGui({ guiRoot })`만 부른다. 시험 선택지(`loopbackOnly`, `answerDialog`, `afterLoad`, `stateFile`, `userDataDir`, `showHostStderr`)는 `tests/smoke`의 진입점 셋만 넘긴다. 엔진 호스트는 인자가 정확히 `--engine-dir <절대 경로> --transport loopback-only` 꼴일 때만 시험 모드다(`src/engine-host/main.ts:108-113`). 그 인자는 본 프로세스가 고정해 넘기고, 환경 변수로 켜는 길은 없다(R29-I4) |
| (3) 키 값 | **렌더러에 닿는 값에 없다.** 연기 시험 결과 세 파일(화면에서 읽은 글, 각 약 18.7KB)에 두 제공자의 가짜 키 값이 0건이다. 엔진 호스트의 `hideAllKeys`는 `API_KEY_ENVS` 전체의 현재 값을 가리고, 16자 미만 자리표시자는 가리지 않는다(`keyValuesOf`). 엔진 호스트의 환경에는 키 변수가 들어간다. API를 부르는 곳이 호스트이므로 설계대로이고, 본 프로세스는 값을 읽지 않는다(`src/main/environment.ts`). 연기 시험의 글 검사 일부는 Anthropic 키만 본다(R29-I3) |
| (4) gui-state.json 조작 | **엉뚱한 계획은 적용되지 않는다.** 다음 셋으로 확인했다(4절). |
| | - 적용 토큰은 본 프로세스가 엔진 호스트의 계획 보기에서 받은 실행 id와 다이제스트에 묶인다(`src/main/ipc.ts:414-470`). |
| | - 다른 계획의 다이제스트로 적용하면 엔진이 `plan_not_approved`로 거부한다. |
| | - 상태 파일이 바꿀 수 있는 것은 형식(프로필·작업 종류)뿐이다(R29-I2). |
| (5) 제공자 변경 확인 건너뛰기 | **찾지 못했다.** 다음 경우 모두 써지지 않았다(5절). |
| | - 같은 토큰 두 번(연속 클릭) |
| | - 겹친 두 제안의 옛 쪽 |
| | - 제안 뒤 바깥에서 바뀐 파일 |
| | - 확인 없음 |
| | 대화상자는 `defaultId`·`cancelId`가 모두 "바꾸지 않음"이라 Esc나 닫기도 확인이 아니다(`src/main/app.ts:261-265`) |

## 2. 낮음

### R29-L1 연기 시험 `apiRequests`는 창을 닫는 실행의 모델 요청이 도착했는지 기다리지 않는다

- 위치
  - `gui/tests/smoke/smoke.ts:473-479`: "실행 중 창 닫기"는 취소 단추가 켜지기만 기다린 뒤 곧바로 `window.close()`를 한다.
  - `gui/scripts/build/smoke.mjs:263-266`: `apiRequests`는 `messages === 8`을 요구한다.
- 대본의 8번째 답(매달림)은 이 실행의 첫 모델 요청 몫이다.
  - 창이 닫혀 실행이 끝나기 전에 그 요청이 가짜 서버에 닿지 못하면 `messages`가 7이 되어 이 검사만 실패한다.
  - 실행이 시작되어 취소 단추가 켜지는 순간과 엔진이 요청을 보내는 순간 사이의 경합이다.
  - 앞의 "창에서 취소" 단계(`smoke.ts:193-197`)도 같은 조건만 기다린다. 다만 확인 클릭 하나가 더 있어 덜 드러난다.
- 이번 세 번은 모두 8건이었다. 부하가 큰 기계에서 담당자가 본 "병합 직후 1건 실패"와 맞는 원인이다.
  - 사본을 고쳐 재현하지는 않았다(수정 금지). 코드 읽기와 세 번의 값으로 낸 판단이다.
- 권고(GUI 담당): 창을 닫기 전에 그 실행의 요청이 서버에 닿았는지 기다린다. 예를 들어 실행 기록에 `model_request`가 보이고 가짜 서버의 요청 수가 늘 때까지 기다린다. 또는 이 검사를 "7 또는 8, 그리고 `other` 없음"으로 바꾼다.

## 3. loopback 전용 전송 실험(과제 2)

호스트와 똑같이 `guardSockets(net, refused)`와 `loopbackOnlyFetch(fetch, refused)`를 올렸다.

| 시도 | 결과 | 셈 |
| --- | --- | --- |
| 앱의 fetch `http://[::ffff:127.0.0.1]:39917` | 거절(TypeError, 시험 전송 문구) | +1 |
| 전역 fetch(앱 fetch 아님) `http://[::ffff:127.0.0.1]:39917` | 소켓 가드가 거절(`CODARYN_TEST_TRANSPORT`) | +1 |
| 전역 fetch `https://[::ffff:127.0.0.1]:39917` | 거절 | +1 |
| `node:http` request `hostname: 0:0:0:0:0:0:0:1` | 거절 | +1 |
| `node:http` request `host: ::ffff:127.0.0.1` | 거절 | +1 |
| `node:https` get | 거절 | +1 |
| `net.connect({host, port})` | 거절 | +1 |
| `net.connect(port, host)` | 거절 | +1 |
| `net.createConnection({..., family: 6})` | 거절 | +1 |
| `tls.connect` | 거절 | +1 |
| `new net.Socket().connect(...)` | 거절 | +1 |
| 앱 fetch `http://127.0.0.1:39917` | 통과 → `ECONNREFUSED` | 0 |
| 전역 fetch `http://[::1]:39917` | 통과 → `ECONNREFUSED` | 0 |
| `net.connect` 127.0.0.1:9 | 통과 → `ECONNREFUSED` | 0 |
| 로컬 파이프 | 통과 → `ENOENT` | 0 |
| UDP datagram `[0:0:0:0:0:0:0:1]:9` | 보내짐(감싸지 않음, R29-I1) | 0 |

- 덧붙여 확인한 것
  - fetch의 포트 9는 Node `fetch` 자체가 "bad port"로 막는다. 그래서 fetch 경로는 높은 닫힌 포트로 다시 쟀다.
  - URL 단계에서 `[0:0:0:0:0:0:0:1]`은 `[::1]`로 정규화되어 허용된다. 실제로 이 기계이므로 맞다.

## 4. gui-state.json(과제 4)

- **4a 읽기**(`parseGuiState`)
  - 다음은 빈 상태가 된다: 깨진 JSON, `schemaVersion` 2, 256KB 초과
  - 다음 항목은 버려진다: 네트워크 경로, 상대 경로, `runs`가 목록이 아님, 실행 id 모양이 아님, 형식이 문자열이 아님, 제어 문자
  - 같은 실행 id가 두 번이면 앞의 것만 남는다.
  - 모양만 맞으면 **다른 실행 id에 다른 형식을 붙인 항목도 남는다**. 실험에서는 A 작업 공간 아래의 B 실행 id에 프로필 `wide`를 붙였다.
- **4b 다이제스트 묶음**: organize 예시로 계획 실행 A와 B를 만들었다.
  - A를 B의 다이제스트로 적용하면 `plan_not_approved`(종료 2)이고 파일은 그대로다.
  - A의 다이제스트로는 `done`이다.
- **GUI 경로**
  - 계획 보기 요청은 렌더러가 보낸 작업 공간 핸들, 실행 id, 형식으로 연다.
  - 본 프로세스는 엔진 호스트가 돌려준 보기에서 실행 id를 다시 확인한다(`ipc.ts:425`).
  - 토큰에는 그 다이제스트를 묶는다.
  - 적용은 토큰 값만 쓴다.
  - 그래서 상태 파일은 어떤 계획이 적용되는지를 바꿀 수 없다. 형식만 바꿀 수 있다(R29-I2).

## 5. 제공자 변경 확인(과제 5)

| 경우 | 결과 |
| --- | --- |
| 같은 제안 토큰을 두 번 씀(연속 클릭) | 두 번째 `take`가 `null` → `unknown_proposal` |
| provider 제안과 좁히는 제안이 겹침, 좁히는 쪽을 먼저 적용 | 옛 provider 제안은 확인을 받아도 `config_write_failed`(기준 다이제스트 불일치) |
| 제안 뒤 설정 파일을 바깥에서 고침 | `config_write_failed`, 쓰지 않음 |
| 넓힘을 확인 없이 적용(대화상자 취소·Esc·닫기와 같음) | 앱 계층이 `invalid_arguments`로 거부 |
| 끝의 디스크 | provider 없음(anthropic) 그대로 |

- 설정 파일을 바깥에서 고쳐 provider를 바꾸고 다시 읽는 경우는 확인을 묻지 않는다. 사람이 직접 고친 파일이므로 설계대로다.
- 새 작업 화면은 쓸 제공자와 모델을 보여 준다(`25343ec`). 연기 시험의 `providerText` 검사가 이를 확인한다.
- 창을 닫을 때 대화상자의 반환값은 Electron 동작에 기댄다. 대화상자를 실제로 닫아 보는 실험은 하지 않았다.

## 6. 정보

- **R29-I1 시험 전송은 엔진 호스트 프로세스의 TCP만 감싼다.**
  - UDP는 감싸지 않는다. 엔진과 GUI 코드는 `dgram`, `dns.resolve`, 워커 스레드를 쓰지 않는다(검색 0건).
  - 허용 명령(`run_command`)과 명령형 검증기는 자식 프로세스라 감싸지지 않는다.
  - 머리말의 "a test can never reach a real API, whatever a config file says"는 API 요청에 대해서는 맞다. 다만 시험이 바깥을 향하는 허용 명령을 두면 그 명령은 막히지 않는다.
- **R29-I2 상태 파일로 실행에 붙인 형식은 적용 시점의 규칙을 정한다.** 그런데 OS 적용 대화상자는 형식을 보이지 않는다.
  - `apply.message`는 이동 수, 폐기 수, 다이제스트 앞 12자만 보인다.
  - 고친 상태 파일로 다른 프로필을 붙이면, 같은 계획이 그 프로필의 정책과 검증기로 적용된다.
  - 적용 때 정책이 행동을 다시 판정하므로 계획에 없던 행동은 생기지 않는다. 형식이 안 맞으면 `run_not_plan`이나 `plan_secrets_differ`다.
  - 다만 검증기가 다를 수 있다.
  - 상태 파일을 고칠 수 있는 프로그램은 같은 폴더의 `config.json`도 고칠 수 있으니 위협 크기는 작다.
  - 대화상자에 형식을 보이면 사람이 알아챈다.
- **R29-I3 연기 시험의 글 검사 일부가 Anthropic 가짜 키만 찾는다.**
  - 해당 검사: `settingsText`, `settingsChangeText`, `runText`, `reportText`(`smoke.mjs:217, 248, 271, 341`)
  - 이번 세 결과 파일을 직접 훑으니 OpenAI 가짜 키도 0건이었다. 그러나 검사는 그것을 잡지 못한다.
  - `providerText`는 두 키를 다 본다. 나머지에도 `FAKE_OPENAI_KEY`를 더하면 좋다.
- **R29-I4 시험 진입점이 OS 대화상자에 자동으로 답한다.**
  - `tests/smoke/*-entry`가 `answerDialog`로 그렇게 한다. 이 진입점은 `build/tests`에 있고 제품 경로(`package.json`의 `main` = `build/src/main/main.js`)가 아니다.
  - 나중에 앱을 꾸릴 때 `build/tests`를 꾸러미에서 빼야 한다.
  - 개발용 `CODARYN_GUI_DEVTOOLS=1`은 꾸리지 않은 앱에서만 동작한다(`app.ts:291`).

## 7. 검사하지 않은 범위

- 실제 대화상자를 사람이 닫는 동작, 창을 닫는 순간의 대화상자 반환값(Electron 동작)
- macOS·Linux의 GUI
- 꾸린(packaged) 앱. 아직 꾸리기 설정이 없다.
- 연기 시험의 흔들림을 사본 수정으로 재현하는 것(수정 금지라 하지 않았다)
- `a28956e`·`2152501`의 화면 전체 동작(연기 시험이 다루는 범위만)

## 8. PM 판단 필요

- **Q-1(R29-L1)**: 연기 시험의 창 닫기 단계를 요청 도착까지 기다리게 하거나 `apiRequests`를 7~8로 받게 할지, GUI 담당에게 맡길지.
- **Q-2(R29-I2)**: 적용 대화상자에 프로필·작업 종류를 보일지.

사용자에게 물을 질문은 없다.
