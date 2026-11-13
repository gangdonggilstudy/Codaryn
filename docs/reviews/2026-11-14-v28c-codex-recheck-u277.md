# V-28c — U-277 재검증

- 담당: codex-sec, 독립 보안·개인정보 검증.
- 대상: `pm/unit-P4`, `6aab897dc3b9dd692ac272476b5ae8cec26f87f8`.
- 기준: `18841332a28f6d5cec6742f277493c26851a0949`.
- 범위: `git diff 18841332 6aab897d -- src`, 5파일, +116/-65.
- **발견 건수: 높음 0, 중간 0, 낮음 0. V-28b 중간 재현은 차단됐다.** 검토한 코드 분기와 아래 실제 CLI 시험에서, describe와 허용 집계 및 명시된 Q-8 한계로 설명되지 않는 추가 응답 구별 경로를 찾지 못했다. 모든 가능한 입력의 무누출을 증명한 결과는 아니다.
- 사본: `D:/project/Codaryn/.worktrees/codex-verify/.codaryn/v28c/source`; 기준 판은 같은 `v28c/base-source`. git archive만 사용했다.

## 기존 재현의 바이트 대조

`v28c/cases/threshold-oracle-{a,b}-true`에 V-28b와 같은 두 합성 표를 만들었다. k=5, 전체 11행·숫자 6셀·비숫자 5셀이다. a는 A 숫자4/비숫자1, B 숫자2/비숫자3, 숨김 C 비숫자1; b는 A 숫자3/비숫자2, B 동일, 숨김 C 숫자1이다.

| 호출 | 두 응답의 UTF-8 길이 | 결과 |
|---|---:|---|
| describe | 각각 179 bytes | 바이트 완전 동일 |
| groupBy g, count(v) | 각각 211 bytes | 바이트 완전 동일 |
| groupBy g, sum(v), mean(v) | 각각 286 bytes | 바이트 완전 동일; A/B 모두 values=[null,null], fewCells=[0,1] |

SHA-256과 길이는 `v28c/checked.json`에 기록했다. 문자열 정규화 없이 도구 content의 실제 UTF-8 바이트를 비교했다. 변하는 실행 id/시각은 이 content에 없다. 위 세 응답뿐 아니라 전체 집계, 유효 커서 g0, 범위 밖 커서 g99까지 **6응답 모두 동일**했다. 세 응답을 TSV와 JSONL에서도 대조했으며 각 형식 안에서 동일했다.

`error-order-one/two`, `one-cell-type-number/text`도 각각 describe·그룹 count·그룹 sum/mean·전체 집계·g0·g99의 **6응답 모두 쌍별 완전 동일**했다. 두 열에 비숫자 5개씩 있는 표의 행 순서를 바꾼 `both-w-first/v-first`도 같았다.

모델행 확인은 journal의 tool_result만 읽는 데서 끝내지 않았다. 대상 판의 **346개 tool_result 모두** 후속 `model_request.newMessages`의 tool message에 같은 content로 전달되는 것을 확인했다.

관련 위치:

- `src/tools/query-table.ts:237`: 비공개 표를 `nonNumbers:"skip"`로 읽는다.
- `src/tabular/aggregate.ts:73`~84: count의 비어 있지 않은 셀 수와 sum/mean의 숫자 셀 수를 구분하며, skip에서는 비숫자를 오류로 저장하지 않는다.
- `src/tabular/query.ts:173`~176: 그룹 보관 상한을 넘은 행도 skip에서는 숫자 오류 검사를 하지 않는다. `:217`의 not_number 경로로 전달될 숫자 오류가 만들어지지 않는다.
- `src/tools/query-table.ts:185`, `:261`~267 및 `src/contracts/query.ts:285`: 그룹 선택 뒤 숫자 셀 수로 fewCells를 적용한다. V-28b의 비숫자 개수 임계값 분기는 없다.

## skip·fewCells와 Q-8 대조

- config에만 k=5 또는 8을 지정했다. 숫자 셀 수를 0, 1, k-1, k로 바꾸고 각각에 비숫자 k+1개를 더한 8개 실행은 모두 sum/mean 요청을 받아들였다. 숫자가 k 미만이면 `[null,null]` 및 fewCells `[0,1]`, k개면 `[2*k,2]`였으며 비숫자 개수가 거부를 만들지 않았다.
- 전부 비숫자인 6행 그룹과 전부 빈 6행 그룹의 sum/mean은 동일한 null/fewCells였다. count와 describe는 비어 있지 않은 셀 수 차이를 보여 줬다. 이는 `src/contracts/query.ts:40`~42, `:48`~60에 명시된 차이다.
- 그룹 키가 비어 있는 행의 값을 비숫자/빈 셀로 바꿔도 그룹 집계·커서 응답은 같았다. 전체 집계와 describe는 그 행도 포함하므로 차이를 보일 수 있다. 이 역시 계약 `:55`~59의 범위다.
- 숫자 형식 시험에서 `0`, `-2`, `2e1`, `0.5`는 숫자 4개로, `1e309`, `+1`, 앞 공백, `NaN`, `Infinity`는 비숫자로 처리됐다. k=5의 sum/mean은 null/fewCells였고 not_number는 없었다. min/max는 여전히 op_not_allowed였다.
- 비공개 32시나리오의 도구 응답 216개에서 `table rejected: not_number` 및 원자료 행/줄 번호를 발견하지 못했다.

판정: 정상적으로 파싱된 표에서 공개할 그룹과 허용 집계/숫자 셀 수 조건이 같으면, 이 변경에 비숫자 수나 첫 오류 행을 따로 출력하는 분기가 남아 있지 않다. fewCells의 범위 정보, count와 sum/mean의 차분, 전체 describe와 그룹 집계의 차분은 현재 Q-8 설명에 포함된다. 이번 시험에서 관찰한 차이는 그 설명 안에 있었다.

## 오류 우선순위

합성 표에 고유 그룹 10,000개/10,001개를 만들었다. v와 w 각각 비숫자 한 개가 있는 두 행의 순서를 뒤집은 쌍을 사용했고, 10,001개 그룹 뒤에 닫히지 않은 따옴표를 붙인 파손 표도 따로 만들었다. 각 표에 count, sum/mean, 유효/무효 커서, 없는 열, 중복 groupBy, min/max, 전체 집계를 요청했다.

| 조건 | 실제 응답 |
|---|---|
| 정상 표, 그룹 10,001개, count 또는 sum/mean | too_many_groups; 숫자 여부·첫 비숫자 행은 오류를 바꾸지 않음 |
| 위 조건 + 형식이 맞는 after=g0 | too_many_groups가 범위 판정보다 먼저 |
| 그룹 정확히 10,000개, 모두 k 미만 | groups=[], suppressedGroups=10000; 정상 반환 |
| 위 조건 + after=g0 | 공개 그룹이 없으므로 after_not_found |
| 파손 표 + 그룹 초과/없는 열/중복 groupBy/유효 after | not_table (unterminated_quote)가 먼저; describe도 같은 파싱 오류 |
| after=bad | 파일을 읽기 전에 after_not_found; 정상/파손/그룹 초과 표에서 동일 |
| 비공개 표의 min 또는 max | 파일을 읽기 전에 op_not_allowed; 정상/파손 표에서 동일 |
| 파싱 성공 + 없는 열/중복 groupBy + 그룹 초과 | unknown_column/duplicate_column이 먼저 |

관련 위치: `src/tools/query-table.ts:221`~226(연산·커서 문법), `src/tabular/query.ts:194`~218(파싱·열·그룹 상한), `src/tools/query-table.ts:259`~267(오류 반환·공개 그룹 커서 범위). 파손/그룹 초과의 행 순서 대조 쌍은 각 10응답 전부 바이트가 같았다.

추가로 공개 그룹 201개를 만들고 각 그룹 내부의 비숫자 위치를 처음/마지막으로 바꿨다. 200개 첫 페이지의 next=g200, 다음 페이지 1개, g201의 after_not_found가 일치했다. 모든 sum/mean이 fewCells로 null인 경우도 그룹 자체는 페이지에서 없어지지 않았으며 숫자 여부가 커서 유효성을 바꾸지 않았다.

**문구 해석의 범위:** `src/contracts/query.ts:38`의 거부가 셀 내용에 좌우되지 않는다는 표현을 모든 오류에 대한 전면적인 내용 독립성으로 읽을 수는 없다. 파싱 오류는 파일 형식에, too_many_groups는 그룹 키의 종류 수에, 유효 커서의 범위 오류는 공개 그룹 수에 여전히 좌우된다. 이들은 각각 describe가 보이는 파싱 결과, Q-5의 그룹 상한(`src/contracts/query.ts:126`~127), 허용된 그룹 목록/개수에 관한 기존 판정이다. 이번 수정에서 확인한 보장은 **숫자/비숫자 여부와 그 행 순서를 이유로 한 not_number 거부 제거**다. 위 오류들을 그 보장과 혼동하지 않았고, 별도 새 결함으로 세지 않았다.

## 기준 판 일치와 수치

| 항목 | 결과 |
|---|---|
| 대상/기준 npm ci --offline 및 build | 모두 종료 0 |
| 관련 기존 시험 | 47/47 통과, 실패 0, 생략 0, 240.8447 ms |
| 독립 실제 CLI | 대상 50 + 기준 50 = 100회; 전부 모델·검증기까지 실행 |
| 대상 모델 요청 | 396회, 도구 응답 346개; 전부 scripted |
| 비공개 표 시험 | 32시나리오, 도구 응답 216개 |
| unreadablePaths 없는 대조 | 18시나리오의 종료 코드·상태·모든 verifier result 및 tool result 객체가 기준 판과 완전 일치 |
| 독립 사후 대조 | 16개 확인 통과; `v28c/check-v28c.mjs`, `checked.log`, `checked.json` |

보호되지 않는 표의 기존 숫자 오류는 첫 오류 행과 그 연산을 그대로 지목한다. 파손/그룹 상한/커서와 함께 발생하는 경우도 기준 판과 같았다. 범위 밖 전체 시험은 돌리지 않았다.

## 실행 명령과 재현 자료

관리용 저장소에서 AGENTS.md를 먼저 읽고 상태·브랜치·루트를 확인했다. 시작/종료의 `git status --short` 출력은 없었으며 main, `D:/project/Codaryn`이었다. 추적 파일 수정·커밋·푸시·git worktree add는 하지 않았다. 아래 `<v28c>`는 `D:/project/Codaryn/.worktrees/codex-verify/.codaryn/v28c`다.

```powershell
# cwd: D:/project/Codaryn
git diff 18841332 6aab897d -- src
git archive --format=tar --output=<v28c>/snapshot.tar 6aab897dc3b9dd692ac272476b5ae8cec26f87f8
tar -xf <v28c>/snapshot.tar -C <v28c>/source
git archive --format=tar --output=<v28c>/base-snapshot.tar 18841332
tar -xf <v28c>/base-snapshot.tar -C <v28c>/base-source

# cwd: <v28c>/source
node seed-cache.mjs
$env:npm_config_cache='<v28c>/source/npm-cache'
$env:npm_config_userconfig='<v28c>/source/empty.npmrc'
$env:npm_config_globalconfig='<v28c>/source/empty-global.npmrc'
$env:npm_config_audit='false'
$env:npm_config_fund='false'
npm.cmd ci --offline
npm.cmd run build
# base-source에서도 같은 환경으로 ci --offline / run build

# cwd: <v28c>/source, TEMP/TMP=<v28c>/test-tmp
node --test dist/tests/unit/tools/u277-unreadable-not-number.test.js dist/tests/unit/tools/u261-query-table-hints.test.js dist/tests/unit/tools/u208-query-table.test.js dist/tests/unit/tabular/aggregate.test.js

# cwd: <v28c>
node probe-v28c.mjs
node probe-v28c.mjs --base
node check-v28c.mjs
```

캐시는 lockfile에 맞는 공개 패키지 4개, 10,655,176 bytes만 로컬에서 사본 안으로 복사했다. 사용자 npm 설정 대신 빈 설정 파일을 지정했다. 이전 검증의 harness/캐시 준비 스크립트는 이번 폴더로 복사해 사용했으며 이전 폴더를 수정하지 않았다.

각 실제 CLI 호출은 `node <v28c>/source/dist/src/cli/main.js run --task <case>/task.json --config <case>/config.json --json`이다. 기준 판은 base-source를 사용한다. 합성 데이터·설정·대본·stdout/stderr·audit.json·원래 journal은 `v28c/cases`와 `v28c/base-cases`에 남겼다. 설치/빌드/시험 로그도 v28c 아래에 있다.

실제 API·외부 네트워크 호출, 키 파일 조회/출력, 권한 요청은 모두 0이다. GUI·실제 제공자·시간/자원 측정 부채널·파일 교체 경주·64 MiB 크기 상한은 이번에 시험하지 않았다. 이는 표 응답과 해당 오류 우선순위에 한정한 재검증이다.
