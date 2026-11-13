# V-19b U-208 재확인

- 담당: codex-check, 보안·개인정보 검토자.
- **높음 0건 / 중간 0건 / 낮음 0건. V-19 높음 1건은 확인 범위에서 닫힘.**
- 대상: `unit/U-208-p4g-general` `21d049c1297533059e124d753fc05ec2d2a43313`.
- 분기점: `d7e4b1467be496f5436ccb310e08d24246b09d59`. 수정 전 동작 비교판: V-19의 `cf54cc92357d79541d0d568f4bdf0e802fb15d42`.
- 사본 루트: `D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-check-v19b-u208-1794576884005`; head와 base를 각각 git archive로 풀었다.
- AGENTS.md를 먼저 읽고 main 상태·브랜치·루트를 확인했다. 저장소 소스 수정·커밋·푸시·worktree 추가 없음. 실제 API·외부 네트워크·키 조회·권한 요청 없음. 합성 표와 관련 시험만 사용했다.

## 재현 방법과 결과

실제 createWorkspace·createPrivacyGateway·createToolRunner를 사용했다. unreadablePaths=["private"], 지정 k를 주고, 실제 인자 검사 후 executeWorkflowTool을 직접 호출했다. 일반 표는 public 아래에 두었다.

| 확인 | 재현 | 수치·결과 |
| --- | --- | --- |
| 종전 여섯 재현 | CSV·TSV·JSONL × k=5·10. 같은 키를 가진 k행 중 v에는 887766.125 한 개, 나머지는 빈 칸. count/sum/mean 동시 질의 | 수정 전 **6/6**에서 [1,887766.125,887766.125]. 수정 후 **6/6**에서 [null,null,null], fewCells=[0,1,2]. 원시 결과와 실제 가림 결과에 표지 숫자 없음 |
| 기여 칸 경계 | 세 형식 × k=5·10 × 칸 수 0/1/k−1/k/k+1 × groupBy 유무. 행 수는 k+2. 여러 열·중복 연산을 섞은 8연산 | **60/60** 기대값 일치. k 미만의 count/sum/mean은 null, k 이상은 정확한 수 유지. 다른 열의 충분한 기여 수가 적은 열을 공개시키지 않음 |
| 전체 집계 | 위 60사례 중 groupBy 없는 30사례 | **30/30** 동일한 기여 칸 기준 적용. 키 없는 전체 그룹도 우회 없음 |
| describe | 경계표 30개 + 숫자 칸 0/1/4/5개에 텍스트 칸 하나를 더한 표 4개 | **34/34** 기대값 일치. nonEmpty와 numeric을 각각 검사: 한쪽이 k 이상이어도 다른 쪽이 k 미만이면 null. 0도 null. k 이상인 수와 전체 행 수는 유지 |
| 합친 ‘그 밖’ 줄 | 세 형식 × 공개 그룹 유무. 숨긴 그룹 1행+4행은 합치면 기여 칸 5개. 선택적으로 6행/숫자 칸 1개인 공개 그룹 추가 | **6/6**에서 숨긴 그룹의 키·값·행 수 없음. 별도 ‘그 밖’ 집계 행 자체가 없고 suppressedGroups=2만 반환. 공개 그룹이 있으면 그 그룹의 세 값도 null |
| 페이지 경계 | 공개 그룹 201개, 각 5행. 홀짝으로 숫자 칸 1개/5개를 번갈아 배치하고 숨긴 1행 그룹 추가 | **2/2** 페이지 검증. 200개 후 1개, next=g200 후 null. 적은 칸의 값은 계속 null, 충분한 칸의 값은 [15,3,5]. 내부 추가 count가 결과 값 목록에 끼어들지 않음 |
| 일반 표 수정 전후 | 세 형식의 정상·희소·빈 칸·±0·큰 수·상쇄 합계 7종에 describe/그룹/전체 질의 63개; 잘못된 숫자 8종의 describe/count/mean 72개; 페이지·끝 커서 3개 | **138/138** 원시 객체 및 JSON 완전 일치. 원시 객체 비교에는 -0도 포함. fewCells 추가 없음. run k=1000을 주어도 공개 표 k=1과 기존 결과 유지 |

JSONL의 빈 칸은 필드 누락·null·빈 문자열을 번갈아 사용했다. 경계 시험에서 요청한 연산 8개만 결과에 남는 것도 확인했다.

수정 근거: `src/tools/query-table.ts:166`의 withCellCounts가 연산별 기여 칸 수를 구하고, `:182`의 shownGroup과 `src/contracts/query.ts:228`의 shownValues가 k 미만 값을 null로 바꾼다. describe는 `src/contracts/query.ts:242`에서 각 count를 따로 숨긴다.

fewCells/null이 붙은 사실로 그 열의 기여 칸이 k 미만임을 알 수 있는 한계는 요청대로 건수에 넣지 않았다.

여러 질의를 빼서 숨긴 그룹을 추론하는 한계도 기존 Q-8 범위로 두고 건수에서 제외했다.

## 돌린 명령과 수치

```powershell
git log --oneline cf54cc9..21d049c1297533059e124d753fc05ec2d2a43313 -- src
git diff d7e4b1467be496f5436ccb310e08d24246b09d59 21d049c1297533059e124d753fc05ec2d2a43313 -- src
git diff cf54cc9 21d049c1297533059e124d753fc05ec2d2a43313 -- src/tools/query-table.ts src/tabular/query.ts src/contracts/query.ts
git archive --format=tar --output=<사본 루트>/head.tar 21d049c1297533059e124d753fc05ec2d2a43313
tar -xf <사본 루트>/head.tar -C <사본 루트>/head
git archive --format=tar --output=<사본 루트>/base.tar cf54cc9
tar -xf <사본 루트>/base.tar -C <사본 루트>/base
```

head/base 각각 기존 로컬 TypeScript로 빌드:

```powershell
node D:/project/Codaryn/node_modules/typescript/bin/tsc -p tsconfig.json --pretty false
```

**2회 모두 종료 0**, 의존성 설치 없음.

head에서 TEMP/TMP를 사본 루트의 test-tmp로 지정하고 관련 시험 실행:

```powershell
node --test --test-timeout=30000 dist/tests/unit/tools/u208-v19-few-cells.test.js dist/tests/unit/tools/u208-query-table.test.js dist/tests/unit/engine/u208-query-table-canary.test.js dist/tests/unit/contracts/g-u197-bundle-a-contract.test.js
```

**62 test / 13 suite / 통과 62 / 실패·취소·건너뜀·todo 0 / 200.8748ms / 종료 0**. 카나리의 모델은 대본 모델이다.

사본 루트에서 독립 재현:

```powershell
node --test --test-timeout=30000 probe-v19b.mjs
```

**6 test / 통과 6 / 실패·취소·건너뜀·todo 0 / 694.1902ms / 종료 0**. 실제 runner 호출은 head **246회**, base **144회**, 합계 **390회**. 표의 세부 사례 수는 이 6개 시험 안에서 센 수다.

자료: 사본 루트의 `probe-v19b.mjs`, `probe-results.json`, `probe-tests.log`, `related-tests.log`, `head-build.log`, `base-build.log`, `src-diff.txt`, `fix-log.txt`. 실제 표는 `fixtures-jxOeap`에 보관했다.

CLI 연결·실제 모델 전송·전체 시험·통합 시험·파일 교체 경주는 이번에 실행하지 않았다.

