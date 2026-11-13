# 사용자 정의 작업 종류 체험

설정 파일의 `workflows`에 작업 종류 하나(`release-notes`)를 정의하고, task가 그것을 고르는 예시다. API 키 없이 정해진 대본(scripted 모델)으로 돈다.

| 파일 | 내용 |
| --- | --- |
| `config.json` | 설정 파일. `workflows.release-notes`: 도구는 `read_file`과 `write_file`뿐, 지시문, `CHANGES.txt` 보호, 자기 검증기 `notes`(`RELEASE-NOTES.md`와 두 절 제목), 턴·도구 호출 한도 |
| `task.json` | `workflowRef: "release-notes"`. 자기 검증기는 없다(정의의 검증기가 늘 돈다) |
| `script.json` | 모델 대신 응답하는 대본. 정의에 없는 `search_files`를 한 번 부르고(거부됨), `CHANGES.txt`를 읽고, `RELEASE-NOTES.md`를 쓴다 |
| `workspace/CHANGES.txt` | 바뀐 점 세 줄(`add:`, `fix:`) |

실행 방법과 출력은 [사용 안내 18.10절](../../docs/usage.md#1810-사용자-정의-작업-종류-체험)에 있다.

- `run --task task.json --config config.json`으로 돈다. 작업 종류는 설정 파일에만 정의할 수 있으므로 `--config`가 없으면 `invalid_task`다.
- 이 폴더를 그대로 실행하지 말고 저장소 밖으로 복사해서 실행한다. 설정 파일과 task 파일은 작업 공간(`workspace/`) 밖에 있어야 한다.
- 키는 필요 없다.
