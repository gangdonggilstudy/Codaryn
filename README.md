# Codaryn

Codaryn은 로컬에서 실행하는 범용 작업 에이전트 CLI다. 코딩과 문서 작업을 처리하며, 작업 공간 하나 안에서 파일을 읽고 고치고 허용한 명령을 실행한다. 모든 작업은 정해진 권한 정책 안에서 이루어진다. 등록한 비밀은 모델에 보내기 전에 가리고, 성공 여부는 검증기가 판정한다. 검증에 실패하면 근거를 모델에 돌려보내 다시 고치게 할 수 있고, 실행이 바꾼 파일은 `revert`로 되돌릴 수 있다. 모델은 Anthropic API를 쓴다.

**현재 상태:** 재수정 반복, 보호 경로와 무결성 확인, 스냅샷과 되돌리기, 실행 전 점검(`doctor`), 실행 보고서(`report`), 모델 목록(`models`)까지 구현했다. 오프라인 검증(유닛, 프로세스 통합)과 로컬 가짜 서버를 쓴 모의 API 검증을 통과했다. 실제 Anthropic API로는 아직 검증하지 않았으므로 실제 작업 전에 [실제 호출 점검](docs/usage.md#14-실제-호출-점검)부터 한다. OS 수준 격리는 없다([알려진 한계](docs/usage.md#16-알려진-한계)).

## 키 없이 체험하기 (PowerShell)

API 키와 네트워크 없이 정해진 대본으로 실행 → 보고서 → 되돌리기를 본다. 자세한 설명은 [사용 안내 3절](docs/usage.md#3-키-없이-체험하기).

```powershell
npm ci; npm run build
[Console]::OutputEncoding = [Text.Encoding]::UTF8   # 결과 JSON을 변수로 받기 위해
$demo = "$HOME\codaryn-demo"                         # 저장소 밖의 새 폴더
Copy-Item -Recurse examples\demo $demo
node dist/src/cli/main.js doctor --task $demo\task.json
$r = node dist/src/cli/main.js run --task $demo\task.json | ConvertFrom-Json
node dist/src/cli/main.js report --workspace $demo\workspace --run $r.runId
node dist/src/cli/main.js revert --workspace $demo\workspace --run $r.runId
```

## 실제 작업 시작 (PowerShell)

```powershell
New-Item -ItemType Directory -Force D:\codaryn-settings | Out-Null
Copy-Item .env.example D:\codaryn-settings\.env
Copy-Item examples\config.example.json D:\codaryn-settings\config.json
# .env를 편집기로 열어 키를 채우고 BOM 없는 UTF-8로 저장한다. 설정은 작업 공간 밖에 둔다
node dist/src/cli/main.js models --vars-file D:\codaryn-settings\.env --config D:\codaryn-settings\config.json
node dist/src/cli/main.js models --vars-file D:\codaryn-settings\.env --config D:\codaryn-settings\config.json --use <번호>
node dist/src/cli/main.js doctor --vars-file D:\codaryn-settings\.env --config D:\codaryn-settings\config.json `
  --workspace D:\work\notes
node dist/src/cli/main.js run --workspace D:\work\notes --goal "README에 설치 절을 추가한다" `
  --vars-file D:\codaryn-settings\.env --config D:\codaryn-settings\config.json
# 결과 JSON의 runId로 보고서를 보고, 필요하면 되돌린다
node dist/src/cli/main.js report --workspace D:\work\notes --run <runId>
node dist/src/cli/main.js revert --workspace D:\work\notes --run <runId>
```

- `models`는 실제 API에 목록을 요청한다. `--use <번호>`는 목록의 그 모델을 설정 파일의 `model`에 쓰고 다른 필드는 그대로 둔다([4절](docs/usage.md#모델-고르기-models)).
- 작업 공간(`D:\work\notes`)은 Git 커밋이나 사본으로 보존한다. `revert`는 파일 도구의 변경만 되돌린다.
- 변수 파일은 `--vars-file`로 준다. `--env-file`은 Node가 먼저 가로채므로 쓰지 않는다.
- `npm link`를 하면 `node dist/src/cli/main.js` 대신 `codaryn`으로 쓸 수 있다([2절](docs/usage.md#2-설치와-빌드)).

## 문서

- [사용 안내](docs/usage.md): 설치, 키 없는 체험, 키와 모델(`models`), 설정, 점검(`doctor`), 실행과 진행 표시, 재수정 반복, 결과와 보고서(`report`), 되돌리기, 비밀, 정책, 점검표, 한계, 문제 해결
- [CLI·공통 계약](docs/cli-contract.md)
- [문서 안내](docs/README.md)
- [공통 개발 지침](AGENTS.md), [Claude 작업 지침](CLAUDE.md)
