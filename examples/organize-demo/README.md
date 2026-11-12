# 키 없이 체험하기: 파일 정리 (계획 확인 → 적용 → 되돌리기)

API 키 없이 `organize` 워크플로의 흐름을 보는 예시다.

- 모델 대신 정해진 대본(scripted 모델)이 폴더를 살펴보고 계획 하나를 제안한다.
- 사람이 그 계획을 보고 승인하면, 적용기가 계획대로 파일을 옮긴다. 모델은 적용에 관여하지 않는다.

| 파일 | 내용 |
| --- | --- |
| `task.json` | 작업 정의. `workflowRef: "organize"`. 계획 행동은 이동과 폐기, 명령은 없다. 적용 뒤 확인할 `file_rules` 검증기가 있다 |
| `script.json` | 모델 대신 응답하는 대본. `inspect_files`로 `inbox`를 보고, `propose_plan`으로 계획을 제안한다 |
| `workspace/inbox/` | 정리할 파일 세 개. 사진·영수증 이름의 가짜 파일과 임시 파일이다 |

계획의 행동:

1. `inbox/beach-2025.jpg` → `photos/2025/beach-2025.jpg` (이동)
2. `inbox/receipt-2026.pdf` → `documents/2026/receipt-2026.pdf` (이동)
3. `inbox/old-draft.tmp` 폐기: 지우지 않고 `.codaryn/discarded/<적용 실행 id>/`로 옮긴다.

실행 방법과 출력은 [사용 안내 18.2절](../../docs/usage.md#182-키-없이-체험하기-파일-정리)에 있다.

- 순서는 `run`(계획 실행) → `plan` → `apply --digest` → `runs` → `revert --dry-run` → `revert`다.
- 이 폴더를 그대로 실행하지 말고 저장소 밖으로 복사해서 실행한다. 저장소 안에서는 `workspace_is_install_dir`로 거부된다.
- 키도 설정 파일도 필요 없다.
