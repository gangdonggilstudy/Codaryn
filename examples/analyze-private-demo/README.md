# 키 없이 체험하기: 개인정보 표의 집계 분석 (`analyze-private`)

API 키 없이 `analyze-private` 작업 종류를 끝까지 보는 예시다. 자료는 모두 합성이다. `name` 열의 값은 `member-n1` 같은 표지이고 실제 사람이 아니다.

- 개인정보가 든 표 `workspace/private/members.csv`는 설정 파일의 읽기 제외 경로(`policy.unreadablePaths: ["private"]`) 아래에 있다. 모델은 그 표를 읽지도, 목록으로 보지도, 바꾸지도 못한다.
- 모델 대신 정해진 대본(scripted 모델)이 `query_table`로 표의 집계만 받아 결과 표 `summary.csv`와 보고서 `report.md`를 쓴다.
- 읽기 제외 아래 표에서 모델이 받는 것은 열 이름, 5행 이상인 묶음의 키와 행 수, 5칸 이상으로 만든 count·sum·mean 값, 숨긴 묶음의 개수뿐이다. 무엇이 가고 무엇이 가지 않는지는 [민감정보 처리 15절](../../docs/privacy.md#15-범용-작업-자료-분석과-파일-정리)의 "개인정보 표"에 있다.
- 검증을 통과해도 `done`이 되지 않는다. 사람이 결과를 보고 `review`로 판정을 기록한다. 확인 항목에 "한 사람을 알아볼 수 있는 값이 없다"가 있다.

| 파일 | 내용 |
| --- | --- |
| `config.json` | 설정 파일 예. 정책에 읽기 제외 경로 `private` 하나를 둔다. 모델과 키 설정은 없다(대본 모델은 키가 필요 없다) |
| `task.json` | 작업 정의. `workflowRef: "analyze-private"`. 읽기 제외는 task에 두지 않고 설정 파일의 것을 쓴다. 설정 파일의 항목은 task 파일로 실행해도 걸리고, task 파일로 뺄 수 없다. 검증기는 `data_checks`(결과 표의 열·행 수와 지역별 합계)와 `file_rules`(보고서) 둘이다 |
| `script.json` | 모델 대신 응답하는 대본. 표를 읽으려다 거부되고, `query_table`로 표의 꼴(`describe`), 지역별 합계, 지역·팀별 합계를 묻고, 읽기 제외 표에서 받지 않는 연산(max)을 물어 거부되고, `summary.csv`와 `report.md`를 쓴다 |
| `workspace/private/members.csv` | 합성 표 18줄(`region`, `team`, `amount`, `bonus`, `name`). 지역별로는 north 6, south 5, east 7행이다. 지역과 팀으로 나누면 5행 미만인 묶음이 넷이다. `bonus`는 north의 세 칸에만 있다 |

## 실행

```powershell
# 저장소 루트에서, 빌드(npm run build)를 마친 뒤. 복사본은 저장소 밖이어야 한다
$ap = "$HOME\codaryn-analyze-private-demo"
Copy-Item -Recurse examples\analyze-private-demo $ap
node dist/src/cli/main.js doctor --task $ap\task.json --config $ap\config.json
node dist/src/cli/main.js run --task $ap\task.json --config $ap\config.json
node dist/src/cli/main.js report --workspace $ap\workspace --run latest
node dist/src/cli/main.js review --task $ap\task.json --config $ap\config.json --run latest --accept --note checked-by-hand
node dist/src/cli/main.js runs --workspace $ap\workspace
```

- main `1f0eb85`에서 대본 모델로 이 순서를 돌려 확인했다(키 없음).
  - `doctor`는 `ok`와 `skipped`뿐이고 종료 0이다.
  - `run`은 사람 확인을 기다리며 종료 3으로 끝나고, 검증기 둘은 통과한다. 표를 읽으려던 호출 하나는 거부되고, max를 물은 호출 하나는 실패한다. 끝 요약은 읽기 제외 때문에 거부된 호출 수와, 5행 미만 묶음이나 5칸 미만 값을 뺀 결과의 수를 센다.
  - `review`는 확인 항목 셋을 보이고 판정을 기록한다.
- `--config`를 빼고 돌리면(기본 위치에도 설정 파일이 없을 때) 실행의 읽기 제외가 비어 `analyze-private`가 시작하지 않는다. 기록도 모델 요청도 없이 `invalid_task`(종료 2)이고, `doctor`도 task 파일 항목을 실패로 알린다.
- 이 폴더를 그대로 실행하지 말고 저장소 밖으로 복사해서 실행한다. 저장소 안에서는 `workspace_is_install_dir`로 거부된다.
- 키는 필요 없다.

## 알아 둘 것

- 보장은 "행을 보내지 않는다"뿐이다. 여러 질의의 차로 작은 묶음의 값을 알아낼 수 있다. 이 대본의 결과만으로도 north의 합(800)에서 north·team-alpha의 합(500)을 빼면 north·team-beta 한 사람의 금액(300)이 나온다. 질의 횟수에는 한도가 없다.
- 목표와 지시문은 그대로 모델에 간다. 실제 모델로 돌릴 때 목표에 개인정보를 적지 않는다.
- 묶음으로 비교하는 `data_checks`(`aggregate_match`의 `groupBy`)는 원본의 모든 묶음에 결과 행이 있어야 맞는다. 5행 미만 묶음이 있는 열로 묶으면 모델이 그 묶음을 모르므로 통과할 수 없다. 이 예시는 모든 지역이 5행 이상이다.
- 사람이 보는 화면(변경 보기, GUI의 파일 보기)에는 읽기 제외 아래 파일도 보인다. 막는 것은 모델로 가는 것이다.
- 읽기 제외가 걸린 확인은 대본 모델과 127.0.0.1의 모의 API(Anthropic, OpenAI)뿐이다. 실제 API로는 확인하지 않았다. 그 밖의 한계는 [민감정보 처리 13절](../../docs/privacy.md#13-알려진-한계)에 있다.
