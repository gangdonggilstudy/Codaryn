# V-26 — 앱 설정 넓히기 재확인

- 담당: codex-review, 독립 정확성·보안 검증. 높음 **0**, 중간 **0**, 낮음 **0**.
- 대상: `pm/unit-A7` = `87ddd92be4c55a4bff656418bee699d034ad4bda` 확인. 기준 main = `9d435c427212bdf1b90218fe0afcb796549902e1`.
- 사본·시험 자료: `.codaryn/codex-review-v26-87ddd92/{candidate,base}`. 두 판 모두 git archive로 추출. Node `v26.13.1`, Windows.
- 실제 앱 API 독립 시험 **203건** = 정상 변경 163 + 잘못된 k 21 + 확인 우회·낡은 제안 16 + 명령 규칙 충돌 3. writable 기준 판 대조 **507건**, 차이 **0**.

| 재현 입력·방법 | 결과·수치 |
|---|---|
| 설정·프로필 p·작업 종류 w 각각에서 읽기 제외 `['a','b']→['b']`, `['a']→[]`, 목록 삭제, `a→a/b`, `a→[a/b,c]` | `unreadable_path_removed`. 확인 false이면 `invalid_arguments`, 원래 파일 바이트 보존. true이면 실제 저장 및 다시 읽기 성공. |
| 같은 세 원천에서 읽기 제외 추가·신설, 대소문자·끝 구분자·역슬래시·순서 변경 | 총 **39건**의 읽기 제외 표. 추가·동등 철자는 읽기 제외 전용 넓히기 **없음**. 프로필·작업 종류는 기존 `profile_changed`·`workflow_changed`가 따로 남아 확인 필요. 설정 자체의 해당 좁히기·동등 변경은 미확인 적용 가능. |
| 읽기 제외 `a/b→a` | 세 원천 모두 보수적으로 넓히기. 링크의 대상까지 판단할 수 없는 설정 변경에서 기존 제한을 잃지 않도록 하는 기존 설계와 일치. |
| 세 원천에서 k `{없음,5,6,10,20}`의 모든 전후 조합 및 `5→1000` | **78건**. 실효 k 감소는 `min_group_size_lowered`, 확인 없이는 파일 보존. 증가와 기본값 5 삭제는 k 전용 넓히기 없음. |
| 세 원천에 k `{0,4,-1,5.5,1001,"4",null}` 제안; 확인 true로 직접 적용도 시도 | **21건**, 제안·적용 **42호출 모두 거부**, 파일 바이트 보존. k=5와 1000 정상 대조 포함. |
| 설정 제한을 프로필로 옮김, p 제한을 q로 옮김, w 제한을 v로 옮김 | 기존 원천의 제거를 각각 넓히기로 판정. 다른 프로필·정의의 항목으로 상쇄하지 않음. |
| 프로필의 동일 읽기 제외를 설정이 유지, 설정 k=20 아래에서 프로필 k=12→11, 설정 k=10→6을 프로필 k=20과 함께 변경 | 공통 설정이 유지하는 제한은 프로필 전용 경고 없음. 설정 자체 k 감소는 별도 경고 유지. 원천·실효 상한 비교 **7건** 통과. 프로필 변경의 포괄 경고도 유지. |
| 읽기 제외 `a→a/b`, k `10→5` 각각에 확인 `{생략,false,0,"true",{},[]}`; 좁히기 제안 뒤 next를 넓히기로 바꿈; 제안 뒤 원본 파일 변경 | **16건** 모두 거부·파일 바이트 보존. apply가 다시 판정하며 true 이외 값으로 통과하지 않음. 낡은 baseDigest는 `config_write_failed`. |
| writable 목록 없음·빈 목록·삭제·항목 추가/제거·상위/하위 접두사·다른 항목 동시 추가·동등 철자·순서 | 실제 앱 경로 **39건**. 목록 삭제는 무제한 경고, 새 빈 목록은 좁히기. `a→a/b`도 링크 때문에 기존처럼 보수적 넓히기. 별도 기준 판 대조는 세 원천 × 13개 목록 × 13개 목록 = **507건**, 경고 배열 전체 동일. |

정상 변경 163건 중 확인 필요 **122건**은 미확인 적용이 모두 거부됐고 파일이 바이트까지 같았다. 이어 확인 true 적용, 저장 다이제스트, 저장 JSON, readSettings 재해석을 검증했다. 나머지 **41건**은 확인 없이 정상 처리됐다(내용이 같은 경우 written=false 포함). V-17에서 unknown_field로 막혔던 새 필드의 제안·적용을 이번에는 실제 파서와 실제 원자적 파일 쓰기로 통과시켰다.

명령 규칙 충돌 재현: `{executable:"node",argsPrefix:["--version"],allowExtraArgs:false}`를 유지한 채 `unreadablePaths:['hidden']`를 추가한다. 설정 원천은 넓히기 배열이 비어 **확인 없이 저장**된다. 프로필·정의는 포괄 변경 경고로 미확인 저장이 거부되지만 **확인 후 저장**된다. 저장한 세 설정을 각각 선택하여 `app.startRun`의 quick 입력으로 호출하면 모두 **invalid_config / unreadable_with_commands**. 제공자 생성 **0**, 엔진 시작 **0**, 네트워크 호출 **0**. 저장 단계는 실행 가능성까지 거부하지 않으며, 제안서 3.2 R-5가 지정한 해석 단계에서 차단한다. 이 동작은 넓히기 확인 우회로 세지 않았다.

재현 자료:

- [settings.mjs](codex-review-v26-87ddd92/settings.mjs): 원본 설정을 시험 폴더에 기록 → readSettings → proposeSettingsChange → 미확인 apply → 파일 비교 → 확인 apply → 다이제스트·JSON·readSettings 비교. 합성 환경 `env:{}`, 파일 읽기는 자체 fixture 안으로 제한, vars 파일 읽기 금지, 제공자·엔진·fetch는 호출 시 실패하도록 대체.
- [settings-results.json](codex-review-v26-87ddd92/settings-results.json): 203건 입력별 경고·거부·충돌 결과.
- [writable-diff.mjs](codex-review-v26-87ddd92/writable-diff.mjs), [writable-diff-results.json](codex-review-v26-87ddd92/writable-diff-results.json): 두 archive 판의 wideningOf 직접 대조.
- [run-units.mjs](codex-review-v26-87ddd92/run-units.mjs), [unit-tests.tap](codex-review-v26-87ddd92/unit-tests.tap): 관련 시험 8개 파일. **59 tests / 54 pass / 0 fail / 5 TODO / 0 skipped**, 실행 시간 **2060.4816 ms**. TODO 5개도 TAP상 모두 `ok`; 기존 TODO 표시는 수정하지 않음.

실행 명령(저장소 명령은 `D:/project/Codaryn`, 시험 명령은 자체 시험 폴더):

```powershell
Get-Content AGENTS.md -Encoding UTF8
git status --short
git branch --show-current
git rev-parse --show-toplevel
git rev-parse pm/unit-A7 main
git diff 9d435c42 87ddd92be4c55a4bff656418bee699d034ad4bda -- src/app src/contracts src/cli
git diff --no-ext-diff 9d435c42 87ddd92be4c55a4bff656418bee699d034ad4bda -- src/app/settings-change.ts
git archive --format=tar --output=D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-review-v26-87ddd92/candidate.tar 87ddd92be4c55a4bff656418bee699d034ad4bda
git archive --format=tar --output=D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-review-v26-87ddd92/base.tar 9d435c427212bdf1b90218fe0afcb796549902e1
tar -xf candidate.tar -C candidate
tar -xf base.tar -C base
# 각각 candidate, base를 작업 디렉터리로 지정: 두 번 모두 exit 0
node D:/project/Codaryn/node_modules/typescript/bin/tsc -p tsconfig.json --pretty false
node --import ./guard.mjs ./settings.mjs
node --import ./guard.mjs ./writable-diff.mjs
node ./run-units.mjs
```

관련 시험: `app/settings-change`, `app/settings-widening-precision`, `app/settings-workflow-rules`, `app/u183-writable-widening`, `app/u183-v8-writable-links`, `app/u204-unreadable-k-widening`, `app/u215-private-data-settings`, `cli/g-u210-unreadable-cli`의 `.test.js`만 실행. TEMP/TMP는 자체 `unit-temp`, 재귀 정리는 guard로 자체 시험 폴더 안만 허용했다.

시험 준비 오류: 첫 단위 실행은 Windows 절대 경로를 `--import`에 넘겨 ESM 로더 오류 8건으로 본문 실행 전 중단([초기 로그](codex-review-v26-87ddd92/unit-tests.initial-loader-error.tap)); 시험 실행기의 경로를 file URL로 바로잡은 뒤 위 수치로 완료. 첫 충돌 시험은 설치 폴더 안 작업 공간으로 먼저 차단돼, 자체 fixture 안의 형제 폴더로 분리한 뒤 `unreadable_with_commands`를 다시 확인했다. 두 경우 모두 제품 결함으로 세지 않았다. `git -C` 일부 조회는 dubious ownership으로 실패했으나, 지정 저장소를 명시적 cwd로 둔 동일 조회는 성공했다. 전역 git 설정·권한 변경 없음.

미실행: 전체 시험 묶음, 실제 GUI 대화상자 조작, Windows 외 플랫폼, 실제 API. 승인 입력은 앱 계약의 `confirmWidening`으로 검증했다. 저장소 추적 파일 수정·커밋·푸시·worktree 추가·외부 네트워크·실제 키 조회·권한 요청 **0**. 마지막 main과 codex-verify의 `git status --short` 출력 **0행**.
