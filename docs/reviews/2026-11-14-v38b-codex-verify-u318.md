# V-38b — U-318 통합 판 재확인

- 검증자: **codex-probe**. PM codex-review 배정. Windows / Node v26.13.1.
- 통합 후보: **`91d98b64d38c1e927e9fb8616b0825d9dc171a39`**.
- 기준: `e7229c030d10f333e42c64ee72a55017ebac7557`. 후보의 두 부모가 이 기준과 U-318 `818e58fb91e4be7fedbf3d798b4aa135db7d1fd3`임을 확인했다. 두 조상 검사 모두 종료 0.
- **높음 0 / 중간 0 / 낮음 0. 통합으로 인한 회귀를 발견하지 못했다.**
- 새 archive 위치: `.worktrees/codex-verify/.codaryn/codex-probe-v38b-91d98b64/compare/{base,head}`. V-38 사본을 재사용하지 않고 두 지정 커밋을 새로 추출·빌드했다.

| 검사 | 기준 main | 정확한 통합 후보 |
| --- | ---: | ---: |
| 실제 엔진 호스트 IPC 원문 노출, preview·revert | 2/2 | **0/2** |
| 실제 메인 핸들러 보기 응답 원문 노출 | 2/2 | **0/2** |
| RunHistory 보관 상태 원문 노출, 두 시점 | 0 | **0** |
| 한·영 전체 runs 화면 원문 노출, preview·result | 4/4 | **0/4** |
| missing_record 표시 | 원문 경로 | `?: no record` / `?: 기록 없음`, 설명 각 1개 |
| 다른 6사유 × 2언어 × 2화면 | 기준값 24개 | **24쌍 차이 0** |
| null 경로 검사 7사유 | 모두 거부 | missing_record만 허용 |
| 잘못된 경로 타입 5종 × 7사유 | 35/35 거부 | 35/35 거부 |
| 독립 시험 | 2/2 통과, 기존 노출 재현 포함 | **2/2 통과** |
| 기존 U-318 시험 파일 | 미실행 | **2/2 통과**, 실패·건너뜀 0 |

후보에서 기존 U-318 2개와 독립 시험 2개, **총 4개 시험이 통과**했다. 사유별 화면·형식 검사 수는 위 표의 세부 단언 수이며 별도 node:test 개수로 더하지 않았다. 기준의 독립 시험 2개는 대조군이다.

V-38의 동일한 입력·검사 틀을 실행했다. 실제 앱의 대본 실행이 합성 등록값을 포함한 파일을 만들고, 앱 preview의 missing_record에는 원문이 있음을 먼저 확인했다. 별도 Node 호스트 프로세스의 실제 stdout 응답을 수집한 뒤, 그 응답을 실제 메인 IPC 핸들러에 재투입했다. 실제 RunHistory·토큰 흐름과 전체 runsScreen의 버튼 동작을 검사했다. 후보는 옛 호스트처럼 원문 경로를 보내는 입력에서도 메인 보기에서 경로를 null로 버렸다.

확인 위치: 후보 `gui/src/engine-host/history.ts:108`의 전송 전 제거, `gui/src/shared/ipc.ts:1730`의 재검사·제거, `gui/src/renderer/runs/runs-screen.ts:62`·`:64`의 `?`와 설명. main의 preview/revert 경로는 `gui/src/main/ipc.ts:640`·`:660`에서 같은 검사 함수를 거쳤다. 다른 사유의 경로·번역·설명 부재도 유지됐다.

## 빌드·명령·원문

| 실행 | 기준 / 후보 |
| --- | --- |
| 루트 tsc 빌드 | 종료 0 / 0; 1,525ms / 1,472ms |
| 정식 GUI build 스크립트 | 종료 0 / 0; 1,244ms / 1,072ms |
| 독립 시험 프로세스 | 종료 0 / 0; 576ms / 965ms |
| 후보 기존 U-318 시험 | 종료 0; 시험 279ms |

cwd는 `D:/project/Codaryn`. R은 `.worktrees/codex-verify/.codaryn/codex-probe-v38b-91d98b64`이다.

```text
git show -s --format="%H %P %s" 91d98b64d38c1e927e9fb8616b0825d9dc171a39
git diff --stat e7229c03 91d98b64d38c1e927e9fb8616b0825d9dc171a39 -- src gui
node R/setup.mjs
node R/gui-build.mjs
node R/test-runner.mjs
node R/run-probe.mjs
node R/validate-results.mjs
git merge-base --is-ancestor e7229c030d10f333e42c64ee72a55017ebac7557 91d98b64d38c1e927e9fb8616b0825d9dc171a39
git merge-base --is-ancestor 818e58fb91e4be7fedbf3d798b4aa135db7d1fd3 91d98b64d38c1e927e9fb8616b0825d9dc171a39
```

집계: [codex-probe-v38b-91d98b64/validated-results.json](codex-probe-v38b-91d98b64/validated-results.json). 정확한 archive·빌드·시험 인자는 같은 폴더의 `setup-results.json`, `gui-build-results.json`, `test-command.json`, `probe-commands.json`; 원문은 `unit-tests.tap`, `probe-{base,head}.tap/.json`, `wire-{base,head}.json`이다. 기존 시험 러너는 후보의 `gui/build/tests/unit/u318-revert-hidden-path.test.js`만 실행했다.

범위: Electron API와 DOM은 시험 대역이며 실제 Electron 창·OS 대화상자는 확인하지 않았다. 전체 GUI 시험과 smoke는 PM 담당으로 **미실행**이다. 실제 API·외부 네트워크·키 파일 조회·소스 수정·커밋·푸시·새 worktree 생성 없음. 기존 로컬 의존성만 읽기 참조했고, 호스트는 `--transport loopback-only`, 모델은 scripted였다. Claude 세션에는 작업을 보내지 않았다. 시작·종료 시 관리용 저장소 `git status --short`는 비어 있었다.
