# Codaryn

Codaryn은 로컬에서 실행하는 범용 작업 에이전트 CLI다. 코딩과 문서 작업을 처리하며, 작업 공간 하나 안에서 파일을 읽고 고치고 허용한 명령을 실행한다. 모든 작업은 정해진 권한 정책 안에서 이루어진다. 등록한 가릴 값은 모델에 보내기 전에 가리고, 성공 여부는 검증기가 판정한다. 검증에 실패하면 근거를 모델에 돌려보내 다시 고치게 할 수 있고, 실행이 바꾼 파일은 `revert`로 되돌릴 수 있다. 모델 제공자는 Anthropic API(기본)와 OpenAI API(Responses API) 둘이다([사용 안내 4절](docs/usage.md#두-번째-제공자-openai)).

**현재 상태:** 재수정 반복, 보호 경로와 무결성 확인, 스냅샷과 되돌리기, 실행 전 점검(`doctor`), 실행 보고서(`report`), 모델 목록(`models`)에 더해 사용성 기능까지 구현했다: 기본 설정 만들기(`init`)와 기본 설정 위치, 실행 목록(`runs`)과 `--run latest`, 되돌리기 미리보기(`revert --dry-run`), 프로필(`--profile`), 한 줄 실행(`run "<목표>"`), 한국어·영어 사람용 출력(진행 줄, 끝 요약, 오류 설명과 위치). 범용 작업도 쓸 수 있다: 작업 종류 고르기(`workflowRef`), 파일 정리의 계획 확인 → 승인과 적용 → 되돌리기(`plan`, `apply`), 자료 분석의 사람 확인(`review`)([사용 안내 18절](docs/usage.md#18-범용-작업-작업-종류-계획-확인-사람-확인)). 오프라인 검증(유닛, 프로세스 통합)과 로컬 가짜 서버를 쓴 모의 API 검증을 통과했다. 실제 Anthropic API와 실제 OpenAI API로는 아직 검증하지 않았으므로 실제 작업 전에 [실제 호출 점검](docs/usage.md#14-실제-호출-점검)부터 한다(Anthropic용만 있다). OS 수준 격리는 없다([알려진 한계](docs/usage.md#16-알려진-한계)).

**아직 없는 것:**
- 독립 데스크톱 GUI(`gui/`)는 만드는 중이다. 설정, 새 작업과 진행, 결과, 실행 목록과 되돌리기, 계획 승인, 변경 보기 화면이 있지만 설치 패키지가 없어 개발 환경에서만 띄울 수 있다. 이 문서는 CLI 사용만 다룬다. VS Code 확장은 만들지 않는다.
- OpenAI 제공자는 실제 API로 점검하지 않았다(가짜 서버로만 확인). OpenAI 실행도 `runs`·`report`·`changes`·`revert`로 다룬다([4절](docs/usage.md#두-번째-제공자-openai)).
- `init`은 Anthropic 설정만 만든다. OpenAI 설정은 설정 파일에 직접 더한다.
- 개인정보가 든 표는 읽기 제외 경로 아래에 두고 `analyze-private`로 다룬다. 모델은 행 대신 집계만 받는다([18.12절](docs/usage.md#1812-개인정보-표의-집계-분석-analyze-private-query_table)). 보장은 행을 보내지 않는다는 것뿐이다([18.7절](docs/usage.md#187-개인정보가-든-자료-읽기-제외와-analyze-private)).

## 키 없이 체험하기 (PowerShell)

API 키와 네트워크 없이 정해진 대본으로 실행 → 실행 목록 → 보고서 → 되돌리기를 본다. 출력 예시와 설명은 [사용 안내 3절](docs/usage.md#3-키-없이-체험하기). 파일 정리의 계획 확인 → 적용 → 되돌리기는 `examples\organize-demo`로 같은 방식으로 본다([18.2절](docs/usage.md#182-키-없이-체험하기-파일-정리)).

```powershell
npm ci; npm run build
$demo = "$HOME\codaryn-demo"                         # 저장소 밖의 새 폴더
Copy-Item -Recurse examples\demo $demo
node dist/src/cli/main.js doctor --task $demo\task.json
node dist/src/cli/main.js run --task $demo\task.json
node dist/src/cli/main.js runs --workspace $demo\workspace
node dist/src/cli/main.js report --workspace $demo\workspace --run latest
node dist/src/cli/main.js revert --workspace $demo\workspace --run latest --dry-run
node dist/src/cli/main.js revert --workspace $demo\workspace --run latest
```

## 실제 작업 시작 (PowerShell)

```powershell
node dist/src/cli/main.js init                 # %APPDATA%\Codaryn\config.json 을 만든다. 키는 묻지 않는다
# 키를 사용자 환경 변수 ANTHROPIC_API_KEY로 등록하고 새 터미널을 연다 (init이 방법을 알려 준다)
node dist/src/cli/main.js models               # 키로 쓸 수 있는 모델 목록(실제 API 요청)
node dist/src/cli/main.js models --use <번호>   # 기본 설정 파일의 model에 쓴다
node dist/src/cli/main.js doctor --workspace D:\work\notes
node dist/src/cli/main.js run --workspace D:\work\notes --goal "README에 설치 절을 추가한다"
node dist/src/cli/main.js runs --workspace D:\work\notes
node dist/src/cli/main.js report --workspace D:\work\notes --run latest
node dist/src/cli/main.js revert --workspace D:\work\notes --run latest --dry-run   # 필요하면 --dry-run 없이 되돌린다
```

- 설정 파일은 `--config` → `CODARYN_CONFIG` → 기본 위치 순서로 찾으므로, `init` 뒤에는 `--config`를 줄 필요가 없다([4절](docs/usage.md#4-처음-설정-init-키-모델)).
- `npm link`를 하면 `node dist/src/cli/main.js` 대신 `codaryn`으로 쓸 수 있고, 작업 폴더에서 `codaryn run "<목표>"`로 한 줄 실행을 할 수 있다([2절](docs/usage.md#2-설치와-빌드), [8절](docs/usage.md#8-실행)).
- 작업 공간(`D:\work\notes`)은 Git 커밋이나 사본으로 보존한다. `revert`는 파일 도구의 변경과 파일 정리의 이동·폐기만 되돌린다.
- `.codaryn\`의 실행 기록과 폐기 보관함은 `node dist/src/cli/main.js cleanup --workspace D:\work\notes --older-than 30`으로 미리 본 뒤 `--confirm <digest>`로 지운다. 되돌리지 않은 실행의 기록(`--include-not-reverted`)과 폐기한 사람의 파일(`--delete-discarded`)은 따로 확인해야 지워진다([11절](docs/usage.md#11-되돌리기), [18.8절](docs/usage.md#188-기록-폴더와-폐기-보관함-정리-cleanup)).
- 사람이 읽는 글은 한국어·영어다. `$env:CODARYN_LANG = "en"` 또는 `"ko"`로 고른다. stdout의 JSON과 오류 코드는 영어다.
- 변수 파일을 쓸 때는 `--vars-file`로 준다. `--env-file`은 Node가 먼저 가로채므로 쓰지 않는다.

## 문서

- [사용 안내](docs/usage.md): 설치, 키 없는 체험, `init`과 키·모델, 두 번째 제공자(OpenAI), 설정과 프로필, 점검(`doctor`), 실행(한 줄 실행, 사람용 출력, 언어), 재수정 반복, 결과(`runs`, `report`, `--run latest`, 에이전트의 마지막 답), 되돌리기(`--dry-run`), 기록 정리(`cleanup`), 가릴 값, 정책, 점검표, 한계, 문제 해결(멈춘 실행의 잠금이 남아 막힐 때 포함), 범용 작업(작업 종류, `plan`·`apply`·`review`, 하드 링크 없는 드라이브의 동의, 기록 폴더와 폐기 보관함 정리)
- [CLI·공통 계약](docs/cli-contract.md)
- [문서 안내](docs/README.md)
- [공통 개발 지침](AGENTS.md), [Claude 작업 지침](CLAUDE.md)
