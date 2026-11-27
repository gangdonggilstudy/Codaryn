# Codaryn

Codaryn은 로컬에서 실행하는 범용 작업 에이전트 CLI다. 코딩과 문서 작업을 처리하며, 작업 공간 하나 안에서 파일을 읽고 고치고 허용한 명령을 실행한다. 모든 작업은 정해진 권한 정책 안에서 이루어진다. 등록한 가릴 값은 모델에 보내기 전에 가리고, 성공 여부는 검증기가 판정한다. 검증에 실패하면 근거를 모델에 돌려보내 다시 고치게 할 수 있고, 실행이 바꾼 파일은 `revert`로 되돌릴 수 있다. 모델 제공자는 Anthropic API(기본)와 OpenAI API(Responses API) 둘이다([사용 안내 4절](docs/usage.md#두-번째-제공자-openai)).

**현재 상태:** 재수정 반복, 보호 경로와 무결성 확인, 스냅샷과 되돌리기, 실행 전 점검(`doctor`), 실행 보고서(`report`), 모델 목록(`models`)에 더해 사용성 기능까지 구현했다: 기본 설정 만들기(`init`)와 기본 설정 위치, 실행 목록(`runs`)과 `--run latest`, 되돌리기 미리보기(`revert --dry-run`), 프로필(`--profile`), 한 줄 실행(`run "<목표>"`), 한국어·영어 사람용 출력(진행 줄, 끝 요약, 오류 설명과 위치). 범용 작업도 쓸 수 있다: 작업 종류 고르기(`workflowRef`), 파일 정리의 계획 확인 → 승인과 적용 → 되돌리기(`plan`, `apply`), 자료 분석의 사람 확인(`review`)([사용 안내 18절](docs/usage.md#18-범용-작업-작업-종류-계획-확인-사람-확인)). 오프라인 검증(유닛, 프로세스 통합)과 로컬 가짜 서버를 쓴 모의 API 검증을 통과했다. 실제 Anthropic API와 실제 OpenAI API로는 아직 검증하지 않았으므로 실제 작업 전에 [실제 호출 점검](docs/usage.md#14-실제-호출-점검)부터 한다(Anthropic용과 OpenAI용이 있다). OS 수준 격리는 없다([알려진 한계](docs/usage.md#16-알려진-한계)).

**아직 없는 것:**
- 독립 데스크톱 GUI(`gui/`)는 만드는 중이다. 설정, 새 작업과 진행, 결과, 실행 목록과 되돌리기, 계획 승인, 변경 보기 화면이 있다. 개발 환경에서 띄우거나, 이 PC에서 만든 로컬 zip 꾸러미(Windows x64)로 띄울 수 있다([사용 안내 2절](docs/usage.md#2-설치와-빌드) 끝 "GUI 꾸러미 만들기", CP-64). 코드 서명·설치 파일·외부 게시는 승인 전이다(GUI-D9, DR-67). 이 문서는 CLI 사용만 다룬다. VS Code 확장은 만들지 않는다.
- OpenAI 제공자는 실제 API로 점검하지 않았다(가짜 서버로만 확인). OpenAI 실행도 `runs`·`report`·`changes`·`revert`로 다룬다([4절](docs/usage.md#두-번째-제공자-openai)).
- `init`은 Anthropic 설정만 만든다. OpenAI 설정은 설정 파일에 직접 더한다.
- 개인정보가 든 표는 읽기 제외 경로 아래에 두고 `analyze-private`로 다룬다. 모델은 행 대신 집계만 받는다([18.12절](docs/usage.md#1812-개인정보-표의-집계-분석-analyze-private-query_table)). 보장은 행을 보내지 않는다는 것뿐이다([18.7절](docs/usage.md#187-개인정보가-든-자료-읽기-제외와-analyze-private)).

## 키 없이 체험하기 (PowerShell)

소스 배포에는 **Node.js 26 이상**이 필요하다(`package.json`의 `engines`). 저장소 루트에서 아래 준비 블록을 통째로 실행한다. 설치는 빌드와 다르며, 어느 단계든 실패하거나 확인할 수 없으면 다음 블록으로 넘어가지 않는다. Windows PowerShell에서는 실행 정책을 바꾸지 않고 `npm.cmd`를 쓴다.

```powershell
& {
    $ErrorActionPreference = 'Stop'  # 이 준비 블록 안에만 적용
    $nodeVersion = node --version
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v([0-9]+)\.[0-9]+\.[0-9]+$' -or [int]$Matches[1] -lt 26) { throw 'Node.js 26 이상인지 확인하세요.' }
    npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw '의존성 설치 실패: 빌드로 넘어가지 않습니다.' }
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'CLI 빌드 실패: 실행으로 넘어가지 않습니다.' }
    if (-not (Test-Path -LiteralPath '.\dist\src\cli\main.js' -PathType Leaf)) { throw 'CLI 진입 파일이 없습니다.' }
    node dist/src/cli/main.js --version
    if ($LASTEXITCODE -ne 0) { throw 'CLI 실행을 확인하지 못했습니다.' }
}
```

파일 존재는 실행 성공이나 소스 판본 일치의 증거가 아니다. 준비 단계별 확인 범위와 선택적인 링크 설치는 [사용 안내 2절](docs/usage.md#2-설치와-빌드)에 있다.

다음은 새 사본에서 **실행 → 같은 실행 ID의 보고 → 되돌리기 미리보기**까지 보는 예시다. scripted 모델은 제공자 API에 요청하지 않는다. 기존 대본은 허용되지 않은 명령을 요청해 거부되는 예시이며, 파일 검증 실패 뒤 재수정도 보여 준다. 아래 블록은 통째로 실행하고, 실패·불명 결과에서는 후속 단계로 넘어가지 않는다. `. { ... }`는 같은 PowerShell 세션에 사본 경로와 실행 ID를 남긴다.

```powershell
. {
    $demoRunId = $null; $demoPreview = $null
    $demo = Join-Path $HOME ('codaryn-demo-' + [Guid]::NewGuid().ToString('N'))
    if (Test-Path -LiteralPath $demo) { throw '기존 사본은 쓰지 않습니다. 새 경로를 고르세요.' }
    Copy-Item -LiteralPath '.\examples\demo' -Destination $demo -Recurse -ErrorAction Stop
    $demoWorkspace = Join-Path $demo 'workspace'
    $demoTask = Join-Path $demo 'task.json'
    $demoConfig = Join-Path $demo 'demo-config.json'
    '{"schemaVersion":1}' | Set-Content -LiteralPath $demoConfig -Encoding ascii -ErrorAction Stop
    $demoRun = node dist/src/cli/main.js run --task $demoTask --config $demoConfig --json | ConvertFrom-Json -ErrorAction Stop
    $demoRunExit = $LASTEXITCODE
    $demoRun | ConvertTo-Json -Depth 20
    if ($demoRunExit -ne 0 -or $demoRun -isnot [pscustomobject] -or $demoRun.schemaVersion -ne 1 -or $demoRun.kind -ne 'run' -or $demoRun.status -ne 'done' -or $demoRun.reason -ne 'verified' -or $demoRun.exitCode -ne 0 -or $demoRun.runId -notmatch '^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$') { throw '실행 결과를 확인하지 못했습니다. 후속 명령을 실행하지 않습니다.' }
    $demoRunId = $demoRun.runId
    $demoReport = node dist/src/cli/main.js report --workspace $demoWorkspace --run $demoRunId --json | ConvertFrom-Json -ErrorAction Stop
    $demoReportExit = $LASTEXITCODE
    $demoReport | ConvertTo-Json -Depth 20
    if ($demoReportExit -ne 0 -or $demoReport -isnot [pscustomobject] -or $demoReport.schemaVersion -ne 1 -or $demoReport.kind -ne 'report' -or $demoReport.status -ne 'complete' -or $demoReport.exitCode -ne 0 -or $demoReport.runId -ne $demoRunId -or $demoReport.result.runId -ne $demoRunId -or $demoReport.result.status -ne 'done' -or $demoReport.result.reason -ne 'verified' -or $demoReport.recordsChanged -eq $true) { throw '보고서를 확인하지 못했습니다. 후속 명령을 실행하지 않습니다.' }
    $demoPreview = node dist/src/cli/main.js revert --workspace $demoWorkspace --run $demoRunId --dry-run --json | ConvertFrom-Json -ErrorAction Stop
    $demoPreviewExit = $LASTEXITCODE
    $demoPreview | ConvertTo-Json -Depth 20
    if ($demoPreviewExit -ne 0 -or $demoPreview -isnot [pscustomobject] -or $demoPreview.schemaVersion -ne 1 -or $demoPreview.kind -ne 'revert' -or $demoPreview.runId -ne $demoRunId -or $demoPreview.status -ne 'complete' -or $demoPreview.exitCode -ne 0 -or $demoPreview.dryRun -ne $true -or $demoPreview.recordsChanged -eq $true) { throw '미리보기의 실패·불명 결과와 skipped를 확인하세요.' }
}
```

`done/verified`는 지정 검증이 통과했다는 뜻이다. `no_verifier`·`usage_unknown`은 성공이 아니며, 미리보기의 `complete`·`dryRun=true`도 실제 복구 성공을 뜻하지 않는다. 다시 체험할 때는 위 블록으로 새 사본을 만들고 기존 사본은 덮거나 지우지 않는다. 실제 되돌리기는 [사용 안내 3절의 별도 단계](docs/usage.md#체험의-실제-되돌리기)에서 설명한다.

체험은 새 사본에 만든 설정 파일을 사용한다. scripted도 입력 검사·가림 등록을 위해 알려진 키 환경값을 읽을 수 있다. 등록값을 가린 출력·저널과 로컬 원본 스냅샷은 다르다([가림](docs/usage.md#12-가릴-값-등록과-가려지는-범위), [되돌리기·원본 보관](docs/usage.md#11-되돌리기)). 일반 작업에서는 명령 도구와 명령 검증기를 모두 살핀다. OS 격리와 후손 수거 보장은 없으며, 로컬 토큰·시간 한도는 원격 요금 제한이 아니다([실행 경계와 결과 읽기](docs/usage.md#3-키-없이-체험하기), [알려진 한계](docs/usage.md#16-알려진-한계)).

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

## 라이선스

Codaryn은 Apache License 2.0으로 제공됩니다. 전문은 [LICENSE](LICENSE), 자체 고지는 [NOTICE](NOTICE)를 참조하세요.

Copyright 2026 gangdonggil

포함되거나 함께 쓰는 제3자 구성 요소(Electron과 그 안의 Chromium 등)는 각자의 라이선스를 따릅니다. [라이선스 확인 절차](docs/development-workflow.md#라이선스와-외부-자료-dr-75)는 별도로 적용합니다.
