# CP54 키 없는 Windows 수동 인수

현재 인계 기준은 `c00ce7d0a30a855afda3111ebf83b969509ef222`다. C11·문서 현행화·한 대본의 실제 CLI/별도 host 저장물 비교는 채택됐다. 이번 인계 조사에서 새로 착수할 근거가 있는 승인된 오프라인 코드 단위는 확인하지 못했다. 제품 전체나 실제 API·수동 UI 검증이 완료됐다는 뜻은 아니다.

## 준비된 로컬 패킷

이 작업 공간에 다음 폴더를 만들었다. 다른 PC로 복제하거나 임시 폴더가 정리됐다면 PM이 패킷을 다시 준비한다.

`C:/Users/gangd/AppData/Local/Temp/codaryn-manual-cp54-vlZX3f`

- `packet.md`: 유한한 점검 순서와 기존 점검표의 경로 대응.
- `launch.mjs`: 운영자가 명시한 `cli` 또는 `gui` 모드에서만 자식을 시작하는 실행기. 기본 `info`는 정보만 출력한다.
- `packet.json`: CP53에서 독립 검증한 root/GUI 출력 2,056파일과 기존 Node/Electron 실행 파일의 SHA256. 실행기는 시작 전에 핀을 확인한다.
- `results.tsv`: 12개 항목의 기록표. 현재 전부 **NOT_RUN**이다.
- CLI/GUI용 체험·정리 예시 별도 복사본, 원래 점검표의 느린 대본, LF/CRLF+BOM 편집 연습 파일, 개인 설정·사용자 데이터·임시 폴더.

기존 Electron 45.3.1과 Node 26.13.1을 사용하며 새 설치·내려받기는 하지 않았다. 실행기는 자식에게 정적 환경과 패킷 안의 private HOME/config/user-data만 준다. 개발자의 API 키·기존 설정을 전달하거나 원래 터미널 환경을 지우지 않는다. 이는 OS 보안 샌드박스가 아니다. 패킷 준비와 `info` 확인만 수행했으며 **실제 제품 CLI·GUI는 시작하지 않았다**.

## 운영자가 시작할 명령

실제 PowerShell 창에서 실행한다. 모델이 흉내 낸 터미널이나 대화상자로 수동 항목을 통과 처리하지 않는다.

```powershell
$packet = 'C:/Users/gangd/AppData/Local/Temp/codaryn-manual-cp54-vlZX3f'
node "$packet/launch.mjs" info
node "$packet/launch.mjs" cli init --config "$packet/gui-config.json"
node "$packet/launch.mjs" gui
```

`init`은 아래 M-1.2에 따라 관찰한다. GUI가 Node 경로를 요구하면 `C:/Program Files/nodejs/node.exe`를 선택한다. API 키는 입력하지 않는다. 같은 파일을 반복 초기화하지 말고 원래 점검표가 요구하는 각 별도 연습 설정 파일을 쓴다.

GUI 체험 task는 `$packet/gui/demo/task.json`, 작업 공간은 `$packet/gui/demo/workspace`다. 정리는 `$packet/gui/organize-demo`, 편집은 `$packet/editor`, 느린 작업은 `$packet/slow/task.json`이다. CLI용 예시는 `$packet/cli` 아래 별도로 있다. 자세한 변수 대응과 명령 치환은 `packet.md`에 적었다. 원본 자료·개발 설치·실제 업무 파일을 연습 대상으로 쓰지 않는다.

## 이번에 확인할 항목

번호별 정확한 조작과 기대는 [기존 수동 점검표](../manual-checks.md)의 같은 제목을 따른다. 새 gate나 새 기능을 추가한 목록이 아니다.

| 기존 항목 | 실제 관찰 |
| --- | --- |
| M-1.1 | 합성 계획의 `apply` 질문에서 Enter·EOF·Ctrl+C의 기본 거부·줄마침·파일 불변 |
| M-1.2 | `init` 질문의 Enter·EOF·Ctrl+C·한국어·줄마침 |
| M-1.3 | JSON 전체 줄과 stderr만 리다이렉트했을 때의 표시·종료 코드 |
| M-1.4 | 이미 있는 Git Bash/mintty에서 같은 동작. 없으면 NOT_RUN |
| M-3.2 | OS 대화상자의 초기 포커스·Enter·Esc·안전한 기본 거부. 합성 예시만 사용 |
| M-3.13 | 첫 저장의 기본 거부·명시 저장, CRLF/BOM 보존, 다시 열면 재확인 |
| M-3.3·M-3.17 | 키보드 이동·초점 표시/복귀·파일 보기 역할/이름/상태 낭독 |
| M-3.4·M-3.5·M-3.6 | 기존 Narrator·고대비·200%와 글자 확대의 가독성/초점. 표시 설정은 끝난 뒤 원래대로 복구 |
| M-3.15 | 실제 Microsoft 한국어 IME 조합 중 Ctrl+S는 저장하지 않고, 조합 완료 후 저장한 파일에 ‘가’가 있음 |

준비되지 않은 장비·항목은 NOT_RUN으로 둔다. 실패가 나오면 기대와 실제를 기록하고 반복 클릭이나 자동 대역으로 통과시키지 않는다. 새 보조 도구를 설치하거나 권한을 높이지 않는다.

## 결과와 남은 경계

`results.tsv`에 항목별 PASS/FAIL/NOT_RUN, 기대/실제, Windows·터미널·IME 판과 비밀 없는 증거 경로를 적어 PM에게 인계한다. 창과 자식이 끝나기 전에는 패킷 폴더를 정리하지 않는다. 자동 삭제는 없다. 키 값·실제 자료·개인 설정 원문을 결과나 채팅에 넣지 않는다.

- 키가 필요한 M-1.5/1.6·M-3.10/3.11, 실제 API/model 자기 개발은 이 패킷에서 실행하지 않는다.
- 다른 OS·실볼륨, 설치 패키지·서명·외부 배포는 별도 범위다. GU-9/DR-67의 미승인 결정은 그대로다. 승인 질문 전 버전·체크섬·URL·명령·산출·비용 등이 있는 구체적 제안이 먼저 필요하다.
- U333 최초 u22 원인, U321 경쟁 경계, 과거 JSON narrow-pin scope는 미해결 한계로 유지한다.
- 이번 패킷은 실제 TTY·OS dialog·IME·낭독기 관찰을 만들어 내지 않았다. 전체 단계 1b/2/3/5 완료로 올리지 않는다.

근거: [CP53 및 최신 PM 상태](../pm-status.md), [인계 조사 원문](../reviews/2026-11-15-offline-acceptance-handoff.md), [요구별 원문 행렬](../reviews/2026-11-15-offline-acceptance-matrix.md). 원문 행렬의 `evidence/` 상대 링크는 담당 세션의 동결 job 폴더를 기준으로 한다. 로컬 원본은 `.worktrees/claude-store/.codaryn/session-comms/offline-acceptance-handoff-check-01/`에 보존돼 있다.
