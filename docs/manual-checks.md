# 사람이 직접 하는 점검

이 문서는 개발 환경에서 확인하지 못해 **사람이 직접 해 봐야 하는 것**의 점검표다. 그대로 따라 할 수 있게 적었다.

**개발 환경과 한계**
- Windows 11 x64다. 실제 API와 외부 네트워크는 쓰지 않았다.
- 터미널은 시험에서 흉내 냈다. 미리 읽는 모듈이 `isTTY`를 참으로 둔 것이다.
- OS 대화상자는 시험이 대신 답했다.
- 심볼릭 링크를 만들 권한이 없다.
- 다른 OS 기계가 없다.

**기준과 출처**
- 기준은 main `cd1cace`(2026-11-13)다.
  - 처음 판은 `845ba8c`에서 썼다.
  - 다음 단위 뒤의 기대 결과로 고쳤다.
    - U-141: 질문이 줄 없이 끝나면 그 줄을 끝낸다.
    - U-137: 질문에서 끝난 실행도 그 호출의 거부를 기록한다.
    - U-136: 거부 요약 문구를 줄였다.
  - GUI의 권한 대화상자(U-124)는 아직 main에 없어 넣지 않았다.
- 출처
  - `docs/reviews/2026-11-13-*.md`의 '검사하지 않은 범위'와 'PM 판단' 절
  - `docs/pm-status.md`의 '확인하지 않은 범위'
  - [사용 안내](usage.md) 16절 "알려진 한계"
  - [CLI 계약](cli-contract.md) 18.17
  - [독립 GUI 설계](design/standalone-gui.md) 9·10·13절
- 각 항목의 '관련' 줄에 단위(U-), 검토(R-), 결정(DR-), 외부 사실(E-) 번호를 적었다.

## 0. 공통 준비와 결과 알리기

**판과 빌드**: 저장소 루트의 PowerShell에서 한다. Node 26 이상이 필요하다.

```powershell
git rev-parse --short HEAD          # 점검한 판. 결과와 함께 알린다
node --version                      # v26 이상
npm ci
npm run build
```

- CLI는 [사용 안내](usage.md)와 같은 꼴로 저장소 루트에서 `node dist/src/cli/main.js …`로 부른다.
- 점검용 폴더는 저장소 밖에 하나 만든다. 작업 공간과 설정 파일이 저장소 안이면 `workspace_is_install_dir`나 `invalid_config`로 거부된다.

```powershell
$m = "$HOME\codaryn-manual"
New-Item -ItemType Directory -Force $m | Out-Null
# 다 끝나면: Remove-Item -Recurse -Force $m
```

**키**
- 키가 필요한 항목은 제목에 **(키 필요)**라고 적었다. 그 밖의 항목은 키 없이 한다.
- 키는 사용자 환경 변수로만 준다.
  - `rundll32 sysdm.cpl,EditEnvironmentVariables`로 창을 열어 `ANTHROPIC_API_KEY`(또는 `OPENAI_API_KEY`)를 더한다.
  - 그 뒤 **새 터미널 창**을 연다.
  - 키 값을 명령줄, 파일, 채팅, 결과 보고에 적지 않는다.
- 키 없는 항목은 그 터미널에서만 키 변수를 지우고 한다. 키가 있으면 `init`이 실제 API에 모델 목록을 요청하기 때문이다(토큰은 쓰지 않는다).

```powershell
Remove-Item Env:ANTHROPIC_API_KEY, Env:OPENAI_API_KEY -ErrorAction SilentlyContinue   # 이 터미널에서만. 사용자 변수는 그대로
```

**종료 코드 보기**: PowerShell은 `$LASTEXITCODE`, 명령 프롬프트는 `echo %ERRORLEVEL%`, Git Bash는 `echo $?`다.

**결과 알리기**: 항목마다 PM에게 다음을 보낸다.
- 항목 번호와 판(`git rev-parse --short HEAD`)
- OS와 판, 터미널 이름
- 기대와 같았는지
- 달랐으면 화면 글을 그대로 보낸다. 키 값과 개인 경로는 지운다.

### 점검 목록

| 번호 | 확인할 것 | 키 | 장치·권한 | 관련 |
| --- | --- | --- | --- | --- |
| M-1.1 | `apply` 질문의 y·n·Enter·Ctrl+C·Ctrl+D·Ctrl+Z | 없음 | — | U-36, R-85, R-88, U-141 |
| M-1.2 | `init` 질문과 Ctrl+C·Ctrl+D·Ctrl+Z | 없음 | — | U-26, R-88, U-141 |
| M-1.3 | 터미널의 JSON 줄 숨김, stderr만 돌렸을 때, 한국어 표시 | 없음 | — | DR-56, U-45, R-58 |
| M-1.4 | Git Bash(mintty)에서의 출력과 질문 | 없음 | Git for Windows | R-58 R58-I5 |
| M-1.5 | `run`의 권한 질문 | **필요** | — | U-109, U-110, R-85, R-88, R-88b, U-137, U-141 |
| M-1.6 | `models`의 표와 번호 질문 | **필요** | — | U-35, U-141, 사용 안내 4절 |
| M-2.1 | 실제 Anthropic 점검(`tests/live`) | **필요** | — | U-101, 설계 조사 A-4 |
| M-2.2 | 실제 OpenAI 점검(`tests/live`) | **필요** | — | U-101, 사실 C-11 |
| M-3.1 | GUI 창 띄우기와 기본 흐름, OS 알림 | 없음 | — | GU-1~GU-6, U-63 |
| M-3.2 | GUI의 OS 대화상자 기본 단추·포커스·Esc | 없음 | — | DR-25, U-13, U-22, GU-6 |
| M-3.3 | GUI 키보드만 쓰기 | 없음 | — | U-67, 설계 10절 |
| M-3.4 | 화면 낭독기(내레이터, NVDA) | 없음 | NVDA는 선택 | E-5, G-a11y |
| M-3.5 | 고대비 | 없음 | — | E-5, 설계 10절 |
| M-3.6 | 200% 배율과 글자 크기, 창 위치 | 없음 | 모니터 둘은 선택 | 설계 10절, R-90 |
| M-3.7 | 어두운 테마 | 없음 | — | U-69 |
| M-3.8 | 새로 등록한 사용자 환경 변수를 GUI가 받는지 | 없음 | — | E-8, GUI-D7 |
| M-3.9 | 렌더러가 클립보드에 직접 쓸 수 있는지 | 없음 | — | R-73 I1, R-77 I2 |
| M-3.10 | GUI의 실제 실행 | **필요** | — | GU-3, U-63 |
| M-4.1 | FAT32·exFAT에서 적용·되돌리기 동의(CLI) | 없음 | 빈 USB 메모리 또는 VHD | DR-21, DR-25, U-119 |
| M-4.2 | FAT32·exFAT에서 동의(GUI) | 없음 | 위와 같음 | DR-25, U-119 |
| M-4.3 | 두 볼륨 사이 이동 | 없음 | 두 번째 볼륨 | 설계 조사 5.4 |
| M-4.4 | 심볼릭 링크 | 없음 | 개발자 모드 또는 관리자 | R-78, R-82 |
| M-4.5 | OneDrive 자리표시 파일, 매핑한 네트워크 드라이브(참고) | 없음 | OneDrive 또는 공유 폴더 | R-78 |
| M-5.1 | macOS·Linux의 빌드와 자동 시험 | 없음 | 그 OS의 기계 | 설계 9절 |
| M-5.2 | macOS·Linux의 기본 설정 위치와 `init` | 없음 | 위와 같음 | N-1 |
| M-5.3 | macOS·Linux의 키 없는 체험 | 없음 | 위와 같음 | 사용 안내 3·18절 |
| M-5.4 | macOS·Linux의 OS 언어 판단 | 없음 | 위와 같음 | 사용 안내 16절 |
| M-5.5 | macOS·Linux의 작업 공간 잠금 | 없음 | 위와 같음 | 사용 안내 16절 |
| M-5.6 | macOS·Linux의 명령 실행과 프로세스 그룹 | 없음 | 위와 같음 | T-2, R-85 |
| M-5.7 | macOS의 대소문자를 가리지 않는 파일 시스템과 보호 경로 | 없음 | macOS | 설계 조사 5.4 |
| M-6.1 | 실제 `npm`(`.cmd`)으로 명령과 검증기 실행 | 없음 | — | 사용 안내 13절 |
| M-6.2 | 탐색기 주소창의 `%APPDATA%` 표기 | 없음 | — | UXM-20 |

---

## 1. 실제 터미널

**공통 사항**
- 모든 시험과 검토는 터미널을 흉내 냈다(CLI 계약 18.17 "실제 터미널로는 확인하지 못했다").
- 실제 콘솔 창에서 키를 쳐서 확인한다.
- 할 수 있으면 두 곳에서 한다.
  - Windows 터미널(PowerShell)
  - 옛 콘솔 창(`Win+R` → `cmd`)
- 터미널마다 결과를 따로 적는다.

### M-1.1 `apply` 질문 (키 없음)

**확인할 것**
- 계획 적용의 터미널 질문 `Apply this plan? [y/N]`에 실제로 친 답이 정해진 대로 처리되는지
- 질문을 닫은 뒤 프로세스가 곧 끝나는지

**여기서 못 한 까닭**
- 질문은 stdin과 stderr가 터미널일 때만 나온다.
- 시험은 파이프에 바이트를 넣었다(Ctrl+C는 0x03, Ctrl+D는 0x04). 실제 콘솔의 키 입력, Windows의 Ctrl+Z, 한글 입력기의 `예`·`네`는 재현하지 않았다.
- 질문이 줄 없이 끝날 때 그 줄을 끝내는 것(U-141)도 흉내 낸 터미널로만 시험했다(`tests/unit/cli/g-u141-question-newline.test.ts`).

**준비**: 키 없는 파일 정리 예시를 복사해 계획 실행을 만든다([사용 안내](usage.md) 18.2).

```powershell
$org = "$HOME\codaryn-organize-demo"          # 아직 없는 폴더
Copy-Item -Recurse examples\organize-demo $org
node dist/src/cli/main.js run --task $org\task.json
# 끝 요약의 "Run id:" 값을 적어 둔다
$plan = "<계획 실행 id>"
```

**순서**
- 같은 명령을 여러 번 친다. 질문이 나올 때마다 아래 답을 하나씩 준다.
- 적용하지 않는 답을 먼저 하고, 적용하는 답(`y`)은 맨 마지막에 한다.
- 계획은 적용하면 다시 쓸 수 없다.

```powershell
node dist/src/cli/main.js apply --task $org\task.json --run $plan    # --digest 없이
$LASTEXITCODE
Get-ChildItem $org\workspace\inbox | Select-Object Name                # 파일 셋이 그대로인지
```

1. Enter만 친다.
2. `n`을 치고 Enter를 친다.
3. Ctrl+D를 친다(빈 줄에서).
4. Ctrl+Z를 치고 Enter를 친다(Windows).
5. Ctrl+C를 친다.
6. 한국어 질문과 한글 답
   - `$env:CODARYN_LANG = "ko"`로 바꾼 뒤 다시 친다.
   - 질문 글을 본다. 한글 입력기로 `예`를 치고 Enter를 친다.
   - 이 답은 적용한다. 다른 답을 더 보려면 이 단계 전에 한다.
   - 끝나면 `Remove-Item Env:CODARYN_LANG`로 되돌린다.

**기대 결과**
- 질문 전에 계획(동작 3개, 다이제스트)이 보이고, 마지막 줄에 `Apply this plan? [y/N]`이 나온다.
  - 한국어면 `이 계획을 적용할까요? [y/N] (y·예·네: 예, Enter: 아니오)`다.
  - 글자가 깨지지 않는다.
- 1·2: 아무것도 옮기지 않는다. `plan_not_approved`, 종료 2다. `inbox`의 파일 셋은 그대로다.
- 3: 답 없음으로 1과 같다. 종료 2, 아무것도 옮기지 않는다.
- 4: 코드를 읽어 낸 기대다(R-88 I3).
  - readline은 터미널 방식의 Windows에서 Ctrl+Z를 무시한다. 그래서 Enter는 빈 줄이고, 1과 같다(종료 2).
  - 실제 콘솔에서는 확인하지 않았다.
- 5: stderr에 `Stopped with Ctrl+C. Nothing more was changed.` 한 줄, 종료 5다. 아무것도 옮기지 않는다.
- 6: 적용한다. 끝 요약에 동작 3개 모두 적용됐다고 나오고 종료 0이다. `inbox`에는 파일이 남지 않는다.
- 3·5(줄 없이 닫은 질문): 다음 글은 질문 줄 끝에 붙지 않고 새 줄에서 시작한다(U-141). 3이면 오류 설명, 5이면 `Stopped with Ctrl+C. …`다.
  - 1·2·4·6은 친 줄이 질문 줄을 끝낸다.
- 모든 경우
  - 명령이 끝나면 프롬프트가 바로 돌아온다. 키를 한 번 더 누를 필요가 없다(R-88 L1 수정).
  - 콘솔에서는 결과 JSON 줄이 나오지 않는다(M-1.3).

**다르면 볼 곳**
- 질문과 답 읽기, 줄 없이 끝난 질문의 줄 끝: `src/cli/terminal.ts`(`askLine`)
- 적용 승인: `src/cli/plan-commands.ts`
- 문구: `src/i18n/en.ts`·`ko.ts`(`apply.question`, `prompt.interrupted`)
- 계약: [CLI 계약](cli-contract.md) 18.17

**관련**: U-36, R-85, R-88(M2·L1·L2·I3), R-88b(I1), U-141

### M-1.2 `init` 질문 (키 없음)

**확인할 것**: 처음 설정의 질문들에 실제 키 입력이 정해진 대로 처리되는지
- 만들지 묻기 `[Y/n]` → 제공자 → 모델 → 언어 순서다.

**여기서 못 한 까닭**: M-1.1과 같다. 흉내 낸 터미널로만 확인했다.

**준비**
- 진짜 기본 설정을 건드리지 않게 `--config`로 시험용 파일을 준다.
- 키 변수는 지운다(0절). 키가 있으면 모델 질문에서 실제 API에 목록을 요청한다.

```powershell
$cfg = "$m\init-test.json"
```

**순서**: 매번 아래 명령으로 시작한다.

```powershell
node dist/src/cli/main.js init --config $cfg
$LASTEXITCODE
Test-Path $cfg
```

1. 첫 질문(`Create the config file there? [Y/n]`)에서 Ctrl+D를 친다.
2. 첫 질문에서 Ctrl+C를 친다.
3. 첫 질문에서 `n`을 치고 Enter를 친다.
4. 첫 질문은 Enter를 친다. 제공자 질문에서 Ctrl+C를 친다.
5. 첫 질문은 Enter를 친다. 제공자 질문에서 Ctrl+D를 친다. 남은 질문은 모두 Enter를 친다.
   - 끝나면 `Remove-Item $cfg`로 지운다.
6. 첫 질문에서 Ctrl+Z를 치고 Enter를 친다(Windows).
   - 만들어졌으면 `Remove-Item $cfg`로 지운다.

**기대 결과**
- 1: `Nothing was created.`, 종료 3, 파일 없음
- 2: `Stopped with Ctrl+C. Nothing more was changed.`, 종료 5, 파일 없음
- 3: `Nothing was created.`, 종료 3, 파일 없음
- 4: 2와 같다. 종료 5이고 설정을 쓰지 않는다(CLI 계약 18.17).
- 5: 제공자 질문은 기본값(anthropic)으로 넘어간다. 질문을 끝까지 마치면 파일을 만들고 종료 0이다(R-88 I2).
  - 모델은 자리표시자(`<model id>`)다. stdout의 키 안내는 `ANTHROPIC_API_KEY`를 말한다.
- 6: 코드를 읽어 낸 기대다. Ctrl+Z가 무시되면 Enter, 곧 첫 질문의 기본값 "예"로 진행한다.
- 1·2·4·5(줄 없이 닫은 질문): 다음 글은 질문 줄 끝에 붙지 않고 새 줄에서 시작한다(U-141).
  - 1은 `Nothing was created.`, 2·4는 `Stopped with Ctrl+C. …`, 5는 다음 질문이다.
- 모든 경우 명령이 끝나면 프롬프트가 바로 돌아온다.

**다르면 볼 곳**
- `src/cli/init.ts`
- `src/cli/terminal.ts`(줄 없이 끝난 질문의 줄 끝)
- 문구: `src/i18n/en.ts`(`init.confirm_create`, `init.declined`)

**관련**: U-26, R-74, R-88(I2·I3), U-141

### M-1.3 터미널의 JSON 줄 숨김과 stderr만 돌렸을 때 (키 없음)

**확인할 것**
- 실제 콘솔(stdout과 stderr가 둘 다 터미널)에서 `run`·`apply`·`revert`의 결과 JSON 줄과 오류 JSON 줄이 숨는지
- stderr만 파일로 돌리면 그 JSON 줄이 화면에 나오는지
- 한국어가 깨지지 않는지

**여기서 못 한 까닭**: [사용 안내](usage.md) 10절 "터미널에서"의 표는 `isTTY`를 참으로 둔 흉내로 쟀다. 실제 콘솔 창은 쓰지 않았다.

**준비**: 키 없는 체험을 한 번 돌려 둔다([사용 안내](usage.md) 3절).

```powershell
$demo = "$HOME\codaryn-demo"                  # 아직 없는 폴더
Copy-Item -Recurse examples\demo $demo
node dist/src/cli/main.js run --task $demo\task.json
```

**순서**

```powershell
# 1. 콘솔 그대로
node dist/src/cli/main.js revert --workspace $demo\workspace --run latest --dry-run
# 2. stderr만 파일로
node dist/src/cli/main.js revert --workspace $demo\workspace --run latest --dry-run 2> $m\stderr.txt
Get-Content $m\stderr.txt -Encoding UTF8
# 3. --json
node dist/src/cli/main.js revert --workspace $demo\workspace --run latest --dry-run --json
# 4. 오류(없는 실행 id)
node dist/src/cli/main.js report --workspace $demo\workspace --run 20990101T000000Z-00000000
$LASTEXITCODE
# 5. 인자 없이
node dist/src/cli/main.js
$LASTEXITCODE
# 6. 한국어
$env:CODARYN_LANG = "ko"
node dist/src/cli/main.js revert --workspace $demo\workspace --run latest --dry-run
node dist/src/cli/main.js doctor --task $demo\task.json
Remove-Item Env:CODARYN_LANG
```

**기대 결과**
- 1: 사람용 요약만 나오고, `{`로 시작하는 줄은 없다.
- 2: 화면에 JSON 한 줄(`{"schemaVersion":1,…`)이 나오고, 파일에 사람용 요약이 있다.
- 3: JSON 한 줄과 사람용 요약이 둘 다 나온다.
- 4: stderr에 오류 설명(`run_not_found`)만 나오고 JSON 줄은 없다. 종료 2다.
- 5: 도움말이 나오고 종료 0이다.
- 6: 한국어 글이 깨지지 않는다.
  - 명령 프롬프트 창(코드 페이지 949)과 Windows 터미널 모두에서 본다.
  - `doctor` 표의 열 어긋남은 이미 알려진 한계다(사용 안내 16절).

**다르면 볼 곳**
- `src/cli/main.ts`, `src/cli/run.ts`, `src/cli/revert.ts`(터미널 판정)
- [사용 안내](usage.md) 10절 "터미널에서"

**관련**: DR-49, DR-56, U-23, U-45, R-58

### M-1.4 Git Bash(mintty) (키 없음)

**확인할 것**: Git Bash를 winpty 없이 쓸 때 CLI가 터미널을 어떻게 보는지
- JSON 줄이 나오는지
- 질문이 나오는지

**여기서 못 한 까닭**: 이 환경에는 mintty 창이 없다. R58-I5는 "stdout이 파이프로 보여 JSON 줄이 나올 것"이라고 추정만 했다.

**준비**
- Git for Windows의 Git Bash를 연다. 판(`git --version`)과 `echo $MSYS`의 값을 적어 둔다.
- 저장소 루트로 간다. M-1.1과 M-1.3의 준비를 먼저 해 둔다.

**순서**(Git Bash에서)

```bash
# Node가 보는 터미널 여부(true면 터미널, undefined면 아님)
node -p "[process.stdin.isTTY, process.stdout.isTTY, process.stderr.isTTY].join(' ')"
node dist/src/cli/main.js revert --workspace "$HOME/codaryn-demo/workspace" --run latest --dry-run
node dist/src/cli/main.js init --config "$HOME/codaryn-manual/init-mintty.json"; echo "exit $?"
rm -f "$HOME/codaryn-manual/init-mintty.json"
# winpty가 있으면 같은 명령을 winpty로
winpty node -p "[process.stdin.isTTY, process.stdout.isTTY, process.stderr.isTTY].join(' ')"
winpty node dist/src/cli/main.js revert --workspace "$HOME/codaryn-demo/workspace" --run latest --dry-run
```

M-1.1에서 쓰지 않은 계획이 남아 있으면 질문도 본다.

```bash
node dist/src/cli/main.js apply --task "$HOME/codaryn-organize-demo/task.json" --run <계획 실행 id>; echo "exit $?"
```

**기대 결과**
- 이것은 코드를 읽어 낸 기대다. 어느 쪽이 나오든 적는다.
- `isTTY`가 `undefined`로 나오면(파이프)
  - `revert --dry-run`은 JSON 줄과 요약을 함께 낸다.
  - `init`은 묻지 않는다. `Not a terminal: nothing was asked and only the defaults were written.`을 내고 파일을 만든다(종료 0).
  - `apply`는 묻지 않고 `plan_not_approved`(종료 2)로 끝나며, 아무것도 옮기지 않는다.
- `winpty`나 ConPTY(`MSYS`에 `enable_pcon`)로 `true`가 나오면 M-1.1·M-1.3과 같다.
- 한국어 글이 깨지지 않는다.

**다르면 볼 곳**
- 위의 `isTTY` 세 값이 판정의 입력이다.
- [사용 안내](usage.md) 10절 "터미널에서"

**관련**: R-58 R58-I5, DR-56

### M-1.5 `run`의 권한 질문 (키 필요)

**확인할 것**: 묻는 규칙(`confirm: true`)에 맞는 명령을 모델이 부를 때의 동작
- 실제 터미널에서 묻는지
- y·Enter·Ctrl+D·Ctrl+C·Ctrl+Z에 맞게 허용·거부·취소하는지
- 끝 요약이 누가 거부했는지 맞게 말하는지

**여기서 못 한 까닭**
- `confirm`은 설정 파일이나 프로필의 정책에서만 받는다. 설정의 제공자는 API 제공자뿐이라 키 없는 대본 모델로는 이 질문을 만들 수 없다(CLI 계약 18.16).
- 시험은 루프백 가짜 서버와 흉내 낸 터미널로만 했다.

**준비**
- 키를 사용자 환경 변수에 둔다(0절).
- 모델 ID는 `node dist/src/cli/main.js models`로 확인한다(M-1.6).
- 아래 설정 파일과 작업 공간을 만든다.
  - `[IO.File]::WriteAllText`는 BOM 없는 UTF-8로 쓴다. BOM이 있으면 `invalid_config`다.
  - `<모델 ID>`는 실제 ID로 바꾼다.

```powershell
$ws = "$m\confirm-ws"
New-Item -ItemType Directory -Force $ws | Out-Null
[IO.File]::WriteAllText("$ws\README.md", "# 권한 질문 점검`n")
$cfg = "$m\confirm-config.json"
[IO.File]::WriteAllText($cfg, @'
{
  "schemaVersion": 1,
  "model": "<모델 ID>",
  "maxOutputTokens": 1024,
  "limits": { "maxModelTurns": 4, "maxToolCalls": 4, "maxTotalTokens": 30000, "maxDurationMs": 180000 },
  "policy": {
    "commands": [{ "executable": "node", "argsPrefix": ["--version"], "allowExtraArgs": false, "confirm": true }],
    "network": "deny", "destructive": "deny", "restorePathTokens": false
  }
}
'@)
node dist/src/cli/main.js doctor --config $cfg --workspace $ws
```

**순서**
- 같은 실행을 답마다 한 번씩 한다. 한 번에 모델 턴 4번, 토큰 30,000 이하다.
- 적어도 1~4는 한다.

```powershell
node dist/src/cli/main.js run --config $cfg --workspace $ws --goal "명령 node --version을 정확히 이 인자로 한 번 실행하고, 그 출력을 한 줄로 알려라. 파일은 바꾸지 않는다."
$LASTEXITCODE
```

1. 질문에 `y`를 치고 Enter를 친다.
2. Enter만 친다.
3. Ctrl+D를 친다.
4. Ctrl+C를 친다.
5. Ctrl+Z를 치고 Enter를 친다(Windows).
6. 끝에 `--quiet`을 붙여 다시 실행한다.
7. (선택, 3분 걸림) 질문에 답하지 않고 설정의 시간 한도(`maxDurationMs` 180000)가 지나기를 기다린다.

4와 7 뒤에는 보고서도 본다.

```powershell
node dist/src/cli/main.js report --workspace $ws --run latest | Select-String "Tool calls|Denied"
```

**기대 결과**
- 질문은 stderr에 한 줄이다. 영어면 끝이 `… Executable: node [y/N]`이다. 인자 자체는 보이지 않고 인자 개수(1)만 글에 든다.
- 1: 진행 줄 `permission question — allowed by the person, for this call only`가 나오고 명령이 돈다.
- 2: 진행 줄 `permission question — denied by the person`이 나온다.
  - 끝 요약에 `Denied by the person: 1 call(s) whose rule asks first.`가 있다.
  - 그 호출에 대해 '규칙을 더하라'는 안내는 없다.
- 3: 진행 줄 `permission question — denied by default (…)`가 나온다.
  - 끝 요약에 `Denied with no answer: 1 call(s) whose rule asks first (…)`가 있다.
  - 그 진행 줄은 질문 줄 끝에 붙지 않고 새 줄에서 시작한다(U-141).
- 4: 진행 줄 `permission question — denied: the run was cancelled while it waited`가 새 줄에서 나온다(U-141).
  - 실행은 `cancelled`, 종료 5다. 모델을 다시 부르지 않는다.
  - 끝 요약에 `Denied because the run was cancelled while it waited: 1 call(s) whose rule asks first.`가 있다.
  - 실행이 질문에서 끝났어도 그 호출의 거부가 기록된다(U-137). 그래서 끝 요약에 `Denied calls: 1`이 있다. 보고서의 `Tool calls:` 줄도 `(denied: 1…)`이다.
- 5: 코드를 읽어 낸 기대다(R-88 I3). 2와 같다(`denied by the person`).
- 6: 묻지 않는다. stdout에 JSON 한 줄만 나오고, 그 호출은 묻지 못한 거부다.
- 7: 실행은 `budget-exhausted`/`max_duration`, 종료 4다.
  - 진행 줄은 `permission question — denied by default (…)`다.
  - 끝 요약에 `Denied with no answer: 1 call(s) whose rule asks first (the input ended or time ran out).`가 있다.
  - 4와 같이 그 호출의 거부가 기록되어 `Denied calls: 1`이다(U-137).
- 모든 경우
  - 실행이 끝나면 프롬프트가 바로 돌아온다.
  - 키 값이 화면이나 `report`에 나오지 않는다.
- 모델이 명령을 부르지 않았거나 다른 인자로 불렀으면 이 점검은 판정할 수 없다.
  - 다른 인자면 묻지 않고 `command_not_allowed`로 거부된다.
  - 다시 실행하고, 그런 일이 있었다고 적는다.

**다르면 볼 곳**
- 질문 통로: `src/cli/confirm.ts`
- 한 줄 읽기와 줄 끝: `src/cli/terminal.ts`
- 취소: `src/cli/cancel.ts`
- 질문에서 끝난 실행의 거부 기록: `src/engine/index.ts`(U-137)
- 문구: `src/i18n/en.ts`(`confirm.question.command`, `progress.confirmation_*`, `summary.confirm_denied.*`)
- 계약: [CLI 계약](cli-contract.md) 18.16·18.17

**관련**: U-74, U-109, U-110, R-79, R-85(M1), R-88(M2·L1·I3), R-88b(I1·L1), U-136, U-137, U-141

### M-1.6 `models`의 표와 번호 질문 (키 필요)

**확인할 것**
- 실제 API의 모델 표(영어, 한국어)
- 터미널에서 `--use` 없이 칠 때 나오는 번호 질문의 Enter·번호·Ctrl+C

**여기서 못 한 까닭**
- 실제 API로는 실행하지 않았다. 로컬 가짜 서버만 썼다.
- 터미널 대화는 확인하지 않았다(사용 안내 4절).
- 한국어 표는 다시 재지 못했다(사용 안내 16절).

**준비**: M-1.5의 `$cfg`를 쓴다. 진짜 기본 설정은 바뀌지 않는다.

**순서**

```powershell
node dist/src/cli/main.js models --config $cfg
# 번호 질문에서 Enter → 다음 줄로 설정의 model이 그대로인지 본다
Select-String -Path $cfg -Pattern '"model"'
node dist/src/cli/main.js models --config $cfg      # 이번에는 Ctrl+C
$LASTEXITCODE
$env:CODARYN_LANG = "ko"
node dist/src/cli/main.js models --config $cfg      # 한국어 표. 번호를 하나 친다
Remove-Item Env:CODARYN_LANG
Select-String -Path $cfg -Pattern '"model"'
```

**기대 결과**
- 표에 번호, id, 이름, 입력·출력 토큰 상한이 있다. 지금 쓰는 모델에 `*`가 붙는다.
- Enter: 아무것도 쓰지 않는다.
- Ctrl+C: `Stopped with Ctrl+C. Nothing more was changed.`, 종료 5다. 그 줄은 질문 줄 끝에 붙지 않고 새 줄에서 시작한다(U-141).
- 번호: 설정의 `model` 한 곳만 그 id로 바뀐다.
- 한국어 표의 머리와 안내가 한국어다(예전 판에서는 영어였다). 어느 쪽이었는지 적는다.

**다르면 볼 곳**
- `src/cli/models.ts`
- [사용 안내](usage.md) 4절 "모델 고르기"

**관련**: U-35, R-75, 사용 안내 16절 "출력 언어"

---

## 2. 실제 API

**공통 사항**
- 이 두 점검은 이 저장소에서 **한 번도 실제 API로 실행된 적이 없다**.
- 작업자는 키 없이 "변수가 없으면 건너뛴다"만 확인했다.
- 자세한 하는 일, 드는 것, 입증하지 않는 것은 [tests/live/README.md](../tests/live/README.md)에 있다.
- 다른 키 필요 항목: M-1.5, M-1.6, M-3.10

### M-2.1 실제 Anthropic 점검 (키 필요)

**확인할 것**
- 실제 Anthropic API로 문서 작업과 코드 작업이 `done`까지 가는지
- 코드 작업에서 검증기가 `pass`이고, 보호 파일이 그대로인지
- 키가 출력과 기록에 남지 않는지

**여기서 못 한 까닭**: 실제 API와 외부 네트워크를 쓰지 않는 환경이다. 실제 API 호출은 지시되지 않았다.

**준비**
- `ANTHROPIC_API_KEY`를 사용자 환경 변수에 두고 새 터미널을 연다.
- 모델 ID는 M-1.6의 표에서 고른다.
- 드는 것: 요청은 최대 16건, 토큰은 최대 60,000이다.

**순서**

```powershell
npm run build
$env:CODARYN_LIVE = "1"
$env:CODARYN_MODEL = "<모델 ID>"
node --test dist/tests/live/anthropic-live.js
Remove-Item Env:CODARYN_LIVE, Env:CODARYN_MODEL
```

**기대 결과**
- 끝의 집계에 `fail 0`, `skipped 0`이 나온다.
- 진단 줄에 두 작업의 상태 `done`, 턴 수, 토큰 수가 있다.
- 키 원문이나 변형을 찾았다는 줄이 없다.
- `skipped`면 세 변수(`CODARYN_LIVE`, `ANTHROPIC_API_KEY`, `CODARYN_MODEL`) 가운데 하나가 없었다. 아무것도 보내지 않은 것이다.

**다르면 볼 곳**
- 실패한 시험의 진단 줄(상태, 이유)
- 제공자 오류: [사용 안내](usage.md) 17절
- `tests/live/anthropic-live.ts`, `src/model/`

**관련**: U-101, 설계 조사 A-4·P-3, 단계 1b

### M-2.2 실제 OpenAI 점검 (키 필요)

**확인할 것**
- `models --provider openai`의 목록
- 도구 한 바퀴의 `done`
- 추론 항목을 다시 보낸 요청이 받아들여지는지([사실 C-11](design/second-provider-facts.md))

**여기서 못 한 까닭**: M-2.1과 같다. OpenAI 어댑터는 공식 문서의 서술과 가짜 서버로만 확인했다.

**준비**
- `OPENAI_API_KEY`를 사용자 환경 변수에 두고 새 터미널을 연다.
- 점검 3을 보려면 추론 모델을 고른다.
- 드는 것: 요청은 최대 10건, 토큰은 최대 40,000이다.

**순서**

```powershell
npm run build
$env:CODARYN_LIVE = "1"
$env:CODARYN_OPENAI_MODEL = "<모델 ID>"
node --test dist/tests/live/openai-live.js
Remove-Item Env:CODARYN_LIVE, Env:CODARYN_OPENAI_MODEL
```

**기대 결과**
- `fail 0`이다.
- 점검 3은 모델이 추론 항목을 돌려주지 않으면 "건너뜀"이고 까닭이 적힌다. 그때는 C-11이 확인되지 않은 것이다. 추론 모델로 다시 돌린다.

**다르면 볼 곳**
- `tests/live/openai-live.ts`
- `src/model/openai/`
- [민감정보 처리](privacy.md) "OpenAI 제공자"

**관련**: U-101, 사실 C-10·C-11, 사용 안내 16절 "OpenAI 제공자"

---

## 3. GUI (Windows 11)

**공통 사항**
- 시험은 실제 Electron과 실제 엔진 호스트로 했다(연기 시험).
- 다음은 시험이 대신하거나 보지 못했다.
  - OS 대화상자의 답
  - 클립보드
  - 파일 관리자
  - OS 알림
  - 낭독기, 고대비, 배율

**준비**: 루트를 빌드한 뒤 GUI를 빌드하고 띄운다. GUI는 루트의 `dist/src`를 쓴다.

```powershell
npm run build                     # 저장소 루트
Set-Location gui
npm ci                            # 처음 한 번. Electron 실행 파일은 처음 띄울 때 내려받는다
npm run build
npm start
```

**시험용 설정**
- 진짜 기본 설정(`%APPDATA%\Codaryn\config.json`)을 바꾸고 싶지 않으면 `npm start` 전에 시험용 설정을 준다.
- GUI의 설정 바꾸기는 `CODARYN_CONFIG`의 파일에 쓴다.
- 첫 실행 안내의 "설정 파일 만들기"는 기본 위치에 만든다.

```powershell
node ..\dist\src\cli\main.js init --config $m\gui-config.json     # gui 폴더에서. 질문에는 Enter
$env:CODARYN_CONFIG = "$m\gui-config.json"
npm start
```

**오래 걸리는 시험 작업**
- 창 닫기 확인(M-3.2)과 OS 알림(M-3.1)에 쓴다.
- 대본 모델이 루프백 주소에 `ping`을 30번 하고 끝난다(약 30초). 키가 필요 없다.

```powershell
$slow = "$m\slow"
New-Item -ItemType Directory -Force "$slow\workspace" | Out-Null
[IO.File]::WriteAllText("$slow\workspace\a.txt", "a`n")
[IO.File]::WriteAllText("$slow\task.json", @'
{
  "schemaVersion": 1,
  "id": "manual-slow",
  "goal": "wait for a while",
  "workflow": "document",
  "workspaceRoot": "./workspace",
  "model": { "provider": "scripted", "scriptPath": "./script.json" },
  "policy": {
    "commands": [{ "executable": "ping", "argsPrefix": ["-n", "30", "127.0.0.1"], "allowExtraArgs": false }],
    "network": "deny", "destructive": "deny", "restorePathTokens": false
  },
  "privacy": { "secretEnv": [] },
  "limits": { "maxModelTurns": 3, "maxToolCalls": 3, "maxTotalTokens": 1000, "maxDurationMs": 120000 },
  "verifiers": []
}
'@)
[IO.File]::WriteAllText("$slow\script.json", @'
{
  "schemaVersion": 1,
  "steps": [
    { "toolCalls": [{ "name": "run_command", "args": { "executable": "ping", "args": ["-n", "30", "127.0.0.1"] } }], "usage": { "inputTokens": 0, "outputTokens": 0 } },
    { "text": "waited", "usage": { "inputTokens": 0, "outputTokens": 0 } }
  ]
}
'@)
```

### M-3.1 창 띄우기와 기본 흐름 (키 없음)

**확인할 것**
- 개발 실행(`npm start`)으로 창이 뜨는지
- 작업 공간 열기 → 점검 → 트리 → task 파일 실행 → 결과 → 실행 목록 → 되돌리기가 실제 창에서 되는지
- 창이 앞에 없을 때 실행이 끝나면 OS 알림이 뜨는지

**여기서 못 한 까닭**
- 연기 시험은 창을 화면에 보이지 않고 스크립트로 눌렀다.
- 파일 대화상자, 파일 관리자 열기, OS 알림은 시험이 기록만 하고 실제로 띄우지 않았다.

**준비**: 3절 준비와 시험 작업을 마친다. 체험 예시를 GUI용으로 하나 더 복사한다.

```powershell
$gdemo = "$HOME\codaryn-demo-gui"
Copy-Item -Recurse examples\demo $gdemo        # 저장소 루트에서
```

**순서**
1. `npm start`로 창을 띄운다. 창 언어가 OS 언어(또는 `CODARYN_LANG`)인지 본다.
2. Ctrl+O(작업 공간 열기)로 `$gdemo\workspace`를 고른다. 작업 공간 점검 카드와 파일 트리(`notes.md`)를 본다.
3. 새 작업 화면에서 "task 파일 고르고 실행…"을 누르고 `$gdemo\task.json`을 고른다.
   - 실행 화면의 진행, 끝, 결과를 본다.
   - 변경 비교와 보고서를 연다.
4. 트리에서 `summary.md`를 고르고 "탐색기에서 보기"를 누른다.
5. 실행 목록에서 그 실행의 되돌리기 미리보기를 연다. 되돌리기 대화상자는 M-3.2에서 본다.
6. 다시 Ctrl+O로 `$slow\workspace`를 열고, `$slow\task.json`을 실행한다.
   - 곧바로 다른 창을 앞으로 가져오거나 Codaryn 창을 최소화한다.
   - 30초쯤 뒤 끝날 때를 본다.

**기대 결과**
- 1~3
  - 창이 뜨고, 개발자 도구는 열리지 않는다.
  - 실행이 끝나면 결과 화면이 보인다. 체험은 재수정 1회 뒤 `done`이다(사용 안내 3절과 같은 흐름).
- 4: 파일 관리자가 열리고 `summary.md`가 선택된다.
- 5: 미리보기에 되돌릴 파일 수와 건너뛸 파일 수가 보인다.
- 6: Windows 알림 `Codaryn 실행이 끝났습니다: …`(영어면 `A Codaryn run ended: …`)가 뜬다. 창이 앞에 있었으면 뜨지 않는다.

**다르면 볼 곳**
- 개발자 도구를 켜고 다시 본다(`$env:CODARYN_GUI_DEVTOOLS = "1"`).
- 주 프로세스: `gui/src/main/app.ts`, `gui/src/main/ipc.ts`
- 알림: `gui/src/main/dialog-texts.ts`(`endNotice`)
- 설계: [독립 GUI 설계](design/standalone-gui.md) 3절

**관련**: GU-1~GU-6, U-63, U-64, U-66

### M-3.2 OS 대화상자의 기본 단추·포커스·Esc (키 없음)

**확인할 것**
- 확인 대화상자마다 다음을 본다.
  - 처음 포커스가 안전한 쪽(두 번째) 단추에 있는지
  - Enter와 Esc가 아무것도 바꾸지 않는지
  - 글이 창 언어인지
- 하드 링크 동의 대화상자는 M-4.2에서 본다.

**여기서 못 한 까닭**: 연기 시험은 대화상자를 띄우지 않고 정해진 답을 돌려줬다. 실제 OS 대화상자의 포커스와 키는 보지 못했다.

**준비**: M-3.1을 마친 창. 파일 정리 예시를 GUI용으로 복사한다.

```powershell
$gorg = "$HOME\codaryn-organize-gui"
Copy-Item -Recurse examples\organize-demo $gorg    # 저장소 루트에서
```

**순서와 기대 결과**
- 각 대화상자에서 다음 순서로 본다.
  1. 처음 포커스가 어디인지 본다.
  2. Enter를 친다.
  3. 다시 열어 Esc를 친다.
  4. 다시 열어 Tab으로 단추를 옮겨 본다.
- 표의 기본 단추가 Enter와 Esc의 결과다. 단추 이름은 한국어 창의 것이다.

| 대화상자 | 여는 법 | 단추 | 기본(Enter·Esc) |
| --- | --- | --- | --- |
| 되돌리기 확인 | 실행 목록 → 체험 실행 → 되돌리기 미리보기 → 되돌리기 | 되돌리기 / **되돌리지 않음** | 되돌리지 않음: 파일이 그대로다 |
| 계획 적용 확인 | `$gorg\workspace`를 열고 `$gorg\task.json`을 실행 → 계획 화면 → 적용 | 이 계획 적용 / **적용 안 함** | 적용 안 함: `inbox` 그대로 |
| 정리 확인 | 실행 목록 → 정리 → 미리보기 → 정리 | 정리 / **정리하지 않음** | 정리하지 않음 |
| 되돌리지 않은 기록 | 위 정리에서 되돌리지 않은 실행이 있을 때 | 그 기록도 지움 / **그 기록은 남김** | 그 기록은 남김 |
| 폐기 보관함 | 계획을 적용한 뒤의 정리 | 폐기 보관함도 지움 / **폐기 보관함은 남김** | 폐기 보관함은 남김 |
| 넓히는 설정 | 설정 → 명령 규칙 더하기(예: `node`, 인자 `--test`) → 제안 → 쓰기 | 쓰기 / **쓰지 않음** | 쓰지 않음: 설정 파일 그대로 |
| 실행 중 창 닫기 | 시험 작업(`$slow`) 실행 중 창 닫기(X 또는 Alt+F4) | 취소하고 닫기 / **계속 실행** | 계속 실행: 창과 실행이 그대로 |

- 끝으로 실행 중 창 닫기에서 "취소하고 닫기"를 고른다.
  - 창이 10초 안에 닫힌다.
  - 다시 띄우면 실행 목록에 그 실행이 `cancelled`로 있다.
- 모든 대화상자는 Codaryn 창에 묶여(모달) 뜨고, 글과 단추가 창 언어다.

**다르면 볼 곳**
- `gui/src/main/app.ts`(각 대화상자의 `defaultId`·`cancelId`)
- `gui/src/main/dialog-texts.ts`

**관련**: DR-25, U-13, U-22, U-62, GU-6, 설계 조사 5.4 "대화상자 기본 단추와 포커스"

### M-3.3 키보드만 쓰기 (키 없음)

**확인할 것**: 마우스 없이 모든 동작을 할 수 있는지
- 포커스가 늘 보이는지
- 포커스가 갇히는 곳이 없는지

**여기서 못 한 까닭**: 단위 시험은 가짜 DOM에서 키 사건을 보냈다. 실제 창의 포커스 표시와 Tab 순서는 사람이 봐야 한다.

**준비**: M-3.1의 창. 마우스를 치운다.

**순서**
1. Tab과 Shift+Tab으로 화면을 한 바퀴 돈다.
2. F6으로 영역(파일 트리, 작업 영역, 상태 줄)을 옮긴다.
3. Ctrl+Shift+P로 명령 찾기를 연다.
   - "실행"을 치고 위·아래 화살표로 고른 뒤 Enter를 친다.
   - 다시 열어 Esc를 친다.
4. Ctrl+N(새 작업), Ctrl+쉼표(설정), Ctrl+O(작업 공간 열기), F5(다시 읽기)를 친다.
5. 트리에서 화살표, Home, End, 첫 글자(예: `s`)를 쓴다.
6. 변경 비교에서 F7과 Shift+F7을 쓴다.
7. 새 작업의 목표 칸에서 Ctrl+Enter를 친다(실행).

**기대 결과**
- 포커스 순서가 보이는 순서와 같고, 포커스 테두리가 늘 보인다.
- 명령 찾기를 Esc로 닫으면 포커스가 원래 자리로 돌아간다.
- 단축키가 [독립 GUI 설계](design/standalone-gui.md) 3.13대로 동작한다.
- 취소에는 단일 키가 없다.
- 키보드로 빠져나올 수 없는 곳이 없다.

**다르면 볼 곳**
- `gui/src/renderer/shell/shell.ts`, `palette.ts`
- `gui/src/renderer/workspace/tree-view.ts`
- 설계 3.13·10절

**관련**: U-67, U-65, 설계 10절

### M-3.4 화면 낭독기 (키 없음)

**확인할 것**: 내레이터(와 NVDA)가 다음을 맞게 읽는지
- 트리의 역할·펼침 상태
- 실행 상태의 바뀜(시작, 검증 중, 끝)
- 변경 비교의 "지움"·"더함"
- OS 대화상자

**여기서 못 한 까닭**: 낭독기는 사람이 들어야 한다. Windows UIA 연결은 확인하지 않은 외부 사실이다(E-5).

**준비**
- 내레이터: Ctrl+Win+Enter로 켜고 끈다.
- NVDA는 선택이다(설치는 사람이 정한다).
- M-3.1의 창과 시험 작업을 쓴다.

**순서**
1. 트리로 가서 폴더를 펼치고 접는다. 가려진 이름이나 링크가 있으면 그 줄도 읽힌다.
2. 시험 작업을 실행하고 끝까지 듣는다.
3. 체험 실행의 변경 비교를 연다. 줄을 위·아래로 옮긴다.
4. M-3.2의 대화상자 하나를 연다.
5. 창 언어를 한국어와 영어로 바꿔(설정 → 언어) 1을 다시 한다.

**기대 결과**
- 1: "트리", "펼침/접힘", 항목 이름을 읽는다. 가려진 것과 링크는 그 낱말("가린 이름", "링크, 따라가지 않음")도 읽는다.
- 2: 시작과 끝은 바로 읽고, 진행은 묶어 조용히 읽는다.
- 3: 줄마다 "지움"·"더함"을 글로 읽는다.
- 4: 메시지와 단추를 읽는다.
- 5: 한국어 창은 한국어로, 영어 창은 영어로 읽는다(`lang` 속성).

**다르면 볼 곳**
- 화면의 `role`·`aria-*`(`gui/src/renderer/**`)
- 설계 10절 표 "화면 낭독기"

**관련**: E-5, G-a11y, 설계 10절, GUI 조사 E-5

### M-3.5 고대비 (키 없음)

**확인할 것**: OS 고대비(forced-colors)에서 다음이 보이는지
- 글과 단추
- 포커스 테두리
- 비교의 더함·지움
- 꺼진 단추
- 트리 표시

**여기서 못 한 까닭**: 화면을 사람이 봐야 한다. 자동 검사 도구는 승인 전이다(설계 7절).

**준비**: 설정 → 접근성 → 대비 테마에서 하나를 고른다(예: 야간 하늘, 사막).

**순서**: 창을 띄운 채 테마를 바꾼다. 작업 공간, 트리, 새 작업, 실행, 변경 비교, 설정, 명령 찾기를 차례로 연다. 다른 대비 테마로 한 번 더 본다.

**기대 결과**
- 모든 글과 단추 테두리가 보인다. 포커스 테두리가 보인다.
- 더함·지움은 색 말고 낱말로도 구별된다.
- 꺼진 단추는 켜진 단추와 구별된다.

**다르면 볼 곳**
- `gui/src/renderer/styles.css`(`forced-colors`)
- 설계 10절 "색"

**관련**: E-5, 설계 10절

### M-3.6 200% 배율, 글자 크기, 창 위치 (키 없음)

**확인할 것**
- OS 배율 200%와 글자 크기 확대에서 잘림이나 겹침이 없는지
- 경로와 실행 id가 줄바꿈되는지
- 창 위치가 화면 밖으로 가지 않는지

**여기서 못 한 까닭**: 화면을 사람이 봐야 한다. 모니터 구성을 바꾸는 시험도 할 수 없었다.

**준비**: 설정 → 시스템 → 디스플레이 → 배율 200%. 설정 → 접근성 → 텍스트 크기 150%.

**순서**
1. 창을 띄워 M-3.5와 같은 화면을 차례로 연다. 파일 트리 구분선을 키보드(←·→)와 마우스로 옮긴다.
2. 창을 화면 오른쪽 아래로 반쯤 밀어 놓고 닫았다가 다시 띄운다.
3. (모니터 둘) 창을 둘째 모니터에 두고 닫는다. 둘째 모니터를 뗀 뒤 다시 띄운다.

**기대 결과**
- 1: 잘린 글, 겹친 단추, 가로 스크롤이 생긴 대화상자가 없다. 구분선이 움직이고 너비가 다음에도 유지된다.
- 2: 같은 자리와 크기로 다시 뜬다.
- 3: 제목 표시줄이 보이는 화면 안에 있어야 한다.
  - R-90 L1(제목 표시줄이 화면 밖으로 나간 위치를 그대로 쓴다)이 실제로 생기는지 적는다.
  - 창이 안 보이면 작업 표시줄에서 창을 고르고 Alt+Space → 이동으로 되찾는다.

**다르면 볼 곳**
- `gui/src/main/gui-state.ts`
- `gui/src/renderer/styles.css`
- 설계 4.5·10절

**관련**: U-70, R-90 L1, 설계 10절 "크기"

### M-3.7 어두운 테마 (키 없음)

**확인할 것**
- OS가 어두운 모드일 때 창이 어두운 색으로 열리는지(흰 깜빡임 없이)
- 비교, 줄 번호, 테두리, 초점 선, 명령 찾기가 읽히는지

**여기서 못 한 까닭**: 화면을 사람이 봐야 한다.

**준비**: 설정 → 개인 설정 → 색 → 모드 선택 → 어둡게.

**순서**
1. 창을 띄운다.
2. 작업 공간, 변경 비교, 명령 찾기, 설정을 연다.
3. 창을 띄운 채 모드를 밝게로 바꾼다.

**기대 결과**
- 1: 창 배경이 처음부터 어둡다.
- 2: 글이 배경과 대비되고, 더함·지움 배경이 구별된다.
- 3: 창이 곧바로 밝게 바뀌는지, 다시 띄워야 바뀌는지 적는다. 설계는 OS 설정을 따른다고만 정했다.

**다르면 볼 곳**
- `gui/src/renderer/styles.css`(`color-scheme`, `prefers-color-scheme`)
- `gui/src/main/app.ts`(창 배경)

**관련**: U-69, 설계 10절 "색"

### M-3.8 새로 등록한 사용자 환경 변수를 GUI가 받는지 (키 없음)

**확인할 것**: Windows 사용자 환경 변수를 등록한 뒤 새로 띄운 앱이 그 값을 받는지
- 키 등록 안내가 맞는지가 이것에 달렸다.

**여기서 못 한 까닭**: 확인하지 않은 외부 사실이다(E-8). 사용자 변수를 바꾸는 일은 이 환경에서 하지 않았다.

**준비**
- 키 대신 시험용 변수 이름을 쓴다. 값은 비밀이 아닌 아무 글이다.
- GUI 설정의 가릴 값(`secretEnv`)에 이름을 더하면, 그 변수가 설정됐는지 보인다.

**순서**
1. 시험용 설정(3절 준비의 `CODARYN_CONFIG`)으로 GUI를 띄운다.
   - 설정 → 가릴 값에 `CODARYN_MANUAL_CHECK`를 더한다.
   - 그 이름이 "지금 설정 안 됨"으로 보이는지 보고 창을 닫는다.
2. `rundll32 sysdm.cpl,EditEnvironmentVariables`에서 사용자 변수 `CODARYN_MANUAL_CHECK`를 더한다(값: `manual-check-value`).
3. **2 전에 열어 둔** 터미널에서 GUI를 다시 띄우고 그 이름을 본다.
4. 시작 메뉴로 **새 터미널 창**을 열어(기존 창의 새 탭이 아니라) GUI를 띄우고 본다.
5. 기존 Windows 터미널 창에 새 탭을 열어 GUI를 띄우고 본다.
6. 끝나면 사용자 변수 `CODARYN_MANUAL_CHECK`를 지우고, 설정에서 그 이름을 뺀다.

**기대 결과**
- 3: "지금 설정 안 됨"이다. 열려 있던 터미널은 옛 환경을 갖고 있다.
- 4: "지금 설정됨"이다.
- 5: Windows 터미널 판에 따라 다를 수 있다. 결과와 Windows 터미널 판을 적는다.

**다르면 볼 곳**
- `gui/src/main/environment.ts`(엔진 호스트에 넘기는 환경)
- 설계 3.10, GUI-D7

**관련**: E-8, GUI-D7, 설계 9절

### M-3.9 렌더러가 클립보드에 직접 쓸 수 있는지 (키 없음)

**확인할 것**: 샌드박스 렌더러가 주 프로세스를 거치지 않고 클립보드에 쓸 수 있는지(`document.execCommand('copy')`, `navigator.clipboard.writeText`)
- 설계는 실행 id, 다이제스트 앞부분, 트리 경로만 주 프로세스가 복사한다고 정했다(U-62, U-103).

**여기서 못 한 까닭**: 시험은 OS 클립보드를 건드리지 않았다(R-73 I1, R-77 I2).

**준비**
- 개발자 도구를 켜서 띄운다. 이 점검에만 켠다.
- Chromium 개발자 도구는 붙여 넣기 전에 `allow pasting`을 치라고 할 수 있다.

```powershell
$env:CODARYN_GUI_DEVTOOLS = "1"
npm start
```

**순서**: 개발자 도구의 Console에서 다음을 친다. 그 뒤 메모장에 붙여 넣는다.

```js
const t = document.createElement("textarea"); t.value = "codaryn-copy-probe"; document.body.append(t); t.select(); document.execCommand("copy")
```

```js
navigator.clipboard.writeText("codaryn-clipboard-probe").then(() => "written", (e) => String(e))
```

끝나면 `Remove-Item Env:CODARYN_GUI_DEVTOOLS`로 되돌린다.

**기대 결과**
- `navigator.clipboard.writeText`는 거부된다. 권한 확인을 모두 거부하기 때문이다.
- `execCommand('copy')`는 결과가 정해지지 않았다.
  - `true`이고 메모장에 `codaryn-copy-probe`가 붙으면, 주 프로세스를 거치지 않는 쓰기 통로가 있는 것이다. 결과를 그대로 알린다(R-77 I2가 GS-2·GS-4에서 보라고 권했다).
- 사람이 창의 글을 골라 Ctrl+C로 복사하는 것은 이 점검과 따로다. 되는지 적는다.

**다르면 볼 곳**
- `gui/src/main/security-policy.ts`
- `gui/src/main/app.ts`(권한 처리기)
- 설계 6.2·6.9

**관련**: R-73 I1, R-77 I2, U-62

### M-3.10 GUI의 실제 실행 (키 필요)

**확인할 것**
- 새 작업 화면의 목표로 실제 API 실행이 시작되는지
- 진행, 취소, 결과, 변경 비교가 되는지
- 설정의 모델 고르기가 실제 목록을 받는지

**여기서 못 한 까닭**: GUI 시험은 대본 모델과 가짜 서버만 썼다.

**준비**
- 키를 사용자 환경 변수에 두고, 새 터미널 창에서 GUI를 띄운다(M-3.8).
- 시험용 설정의 모델을 실제 ID로 둔다(설정 → 모델에서 고르거나 M-1.6).
- 작업 공간은 연습용 사본을 쓴다.

**순서**
1. 연습용 작업 공간을 연다.
   - 새 작업에서 목표(예: "README.md 끝에 '## 점검' 절을 더한다")를 적는다.
   - 낮은 한도로 실행한다.
2. 한 번 더 실행하고, 진행 중에 실행 화면의 취소 단추를 누른다. 확인 창의 기본은 "계속 실행"이다.
3. 설정 → 모델에서 목록을 받는다.

**기대 결과**
- 1: 실행이 끝나고 결과, 변경 비교, 보고서가 보인다. 키 값은 화면 어디에도 없다.
- 2: 취소를 확인하면 실행이 `cancelled`로 끝난다.
- 3: 표가 보이고, 고른 모델이 설정 파일에 쓰인다.
- GUI 실행의 끝 요약은 묻는 규칙의 거부를 아직 따로 말하지 않는다(CLI 계약 18.17, 선택 필드). 이것은 알려진 차이다.

**다르면 볼 곳**
- 실행 화면의 오류 카드 코드
- [사용 안내](usage.md) 17절
- `gui/src/main/ipc.ts`

**관련**: GU-3, GU-6, U-63, U-64

---

## 4. 파일 시스템

### M-4.1 FAT32·exFAT에서 적용과 되돌리기의 동의 (CLI, 키 없음)

**확인할 것**: 하드 링크가 없는 실제 드라이브에서 다음이 되는지
- 적용이 아무것도 옮기지 않고 `consent_required`로 멈추는지
- 동의(`--allow-unsafe-move` 또는 터미널의 `[y/N]`)로 옮기는지
- 되돌리기도 같은지
- 한국어 동의 질문

**여기서 못 한 까닭**
- 하드 링크 만들기가 실패하도록 흉내 낸 프로세스에서만 확인했다(사용 안내 16절).
- 실제 exFAT·FAT32가 돌려주는 오류 코드는 모른다.
  - 그 코드가 예상한 것(`EPERM`, `EXDEV`, `ENOTSUP` 등)이 아니면 `consent_required` 대신 다른 오류로 끝날 수 있다.
  - 이것이 이 점검의 핵심이다.

**준비**: 아래 둘 가운데 하나를 쓴다.
- **빈 USB 메모리**를 FAT32나 exFAT으로 포맷한다. 포맷하면 그 안의 것이 모두 지워진다.
- 관리자로 디스크 관리(`diskmgmt.msc`)에서 VHD를 만든다. 동작 → VHD 만들기 → 초기화 → 새 단순 볼륨 → exFAT.

```powershell
$d = "E:"                                          # 그 드라이브 문자
fsutil fsinfo volumeinfo $d | Select-String "File System Name"
$org = "$d\codaryn-organize-demo"
Copy-Item -Recurse examples\organize-demo $org     # 저장소 루트에서
node dist/src/cli/main.js run --task $org\task.json
$plan = "<계획 실행 id>"; $digest = "<다이제스트 앞 12자>"
```

**순서**

```powershell
# 1. 동의 없이(터미널에서). 끝난 직후 [y/N]을 한 번 묻는다. Enter로 답한다
node dist/src/cli/main.js apply --task $org\task.json --run $plan --digest $digest
$LASTEXITCODE
Get-ChildItem $org\workspace\inbox | Select-Object Name
# 2. 인자로 동의
node dist/src/cli/main.js apply --task $org\task.json --run $plan --digest $digest --allow-unsafe-move --json
$LASTEXITCODE
# 3. 되돌리기 미리보기와 동의 없는 되돌리기(묻는 [y/N]에 Enter)
node dist/src/cli/main.js revert --workspace $org\workspace --run latest --dry-run
node dist/src/cli/main.js revert --workspace $org\workspace --run latest
$LASTEXITCODE
# 4. 동의한 되돌리기
node dist/src/cli/main.js revert --workspace $org\workspace --run latest --allow-unsafe-move
Get-ChildItem $org\workspace\inbox | Select-Object Name
# 5. 미리보기와 동의는 함께 줄 수 없다
node dist/src/cli/main.js revert --workspace $org\workspace --run latest --dry-run --allow-unsafe-move
$LASTEXITCODE
```

6. 터미널 질문의 "예"와 한국어도 본다.
   - 새 사본(`$d\codaryn-organize-demo2`)으로 계획 실행을 다시 만든다.
   - `$env:CODARYN_LANG = "ko"`를 둔다.
   - 1을 하되 동의 질문에 `y`를 친다.
   - 끝나면 `Remove-Item Env:CODARYN_LANG`.

**기대 결과**
- 1: 아무것도 옮기지 않는다.
  - `needs-input`/`consent_required`, 종료 3이다. `inbox`의 파일 셋은 그대로다.
  - 끝 요약에 `Not applied: moves that could replace a file: 3. Nothing was moved.`와 동의 명령이 있다.
  - Enter로 답하면 더 하지 않는다.
- 2: 동작 셋을 적용하고 종료 0이다.
  - 진행 줄에 `consent to moves that could replace a file — approved by a command-line argument`가 있다.
  - JSON 줄의 `applied` 항목에 `"unsafe":true`가 있다.
- 3
  - 미리보기는 드라이브를 판정하지 않으므로 되돌릴 수 있다고 보인다.
  - 실제 되돌리기는 파일들을 `unsafe_move`로 건너뛴다(`partial`, 종료 3). 동의 명령을 알려 준다.
- 4: `Files moved back with your consent in a way that could replace a file: 3`이 나온다. `inbox`에 파일 셋이 돌아온다.
- 5: `invalid_arguments`, 종료 2다.
- 6: 동의 질문이 한국어로 나온다. 예라고 답하면 동의를 붙인 적용 실행이 하나 더 생기고 적용된다.
  - 이 한국어 글은 다시 재지 못한 것이다(사용 안내 16절). 글을 그대로 적는다.
- 1에서 `consent_required` 대신 다른 결과(예: `io_error`, 다른 실패)가 나오면 이 점검의 주된 발견이다.
  - 그 끝 요약과 `fsutil` 결과(파일 시스템 이름)를 알린다.

**다르면 볼 곳**
- 링크 실패 코드 목록: `src/store/common.ts`(`LINK_UNSUPPORTED`)
- 이동: `src/tools/plan-files.ts`
- [사용 안내](usage.md) 18.5

**관련**: DR-18 b, DR-21, DR-25, DR-59, R-5, R-9, 설계 조사 5.4, PM 질문 Q-8

### M-4.2 FAT32·exFAT에서의 동의 (GUI, 키 없음)

**확인할 것**
- GUI 계획 화면이 하드 링크를 쓸 수 없는 이동의 수를 알리는지
- 적용·되돌리기의 동의 대화상자 기본이 "동의하지 않음"인지

**여기서 못 한 까닭**: M-4.1과 같다. 연기 시험은 흉내 낸 드라이브와 대신 답한 대화상자였다.

**준비**
- M-4.1의 드라이브에 새 사본을 만든다.

```powershell
Copy-Item -Recurse examples\organize-demo $d\codaryn-organize-gui
```

**순서**
1. GUI에서 `$d\codaryn-organize-gui\workspace`를 열고, `$d\codaryn-organize-gui\task.json`을 task 파일로 실행한다.
2. 계획 화면을 읽는다. 적용 → 적용 확인에서 "이 계획 적용"을 고른다.
3. 동의 대화상자에서 Enter를 친다. 다시 적용해 이번에는 "이번 적용에 동의"를 고른다.
4. 실행 목록에서 그 적용을 되돌린다. 동의 대화상자에서 Enter를 친다. 다시 되돌려 "이번 되돌리기에 동의"를 고른다.

**기대 결과**
- 2: 계획 화면에 "하드 링크를 쓸 수 없는 드라이브의 이동이 3개"라는 뜻의 줄이 있다.
- 3
  - 동의 대화상자는 `이 드라이브는 하드 링크를 쓸 수 없습니다. 이번 적용 한 번에만 동의할까요?`다.
  - 단추는 이번 적용에 동의 / **동의하지 않음**이고, 기본은 "동의하지 않음"이다.
  - Enter면 아무것도 옮기지 않는다. 동의하면 적용된다.
- 4
  - 되돌리기 동의 대화상자의 기본도 "동의하지 않음"이다.
  - Enter면 아무것도 바뀌지 않는다. 동의하면 파일이 돌아온다.

**다르면 볼 곳**
- `gui/src/main/app.ts`(`consent.message`, `revertConsent.message`)
- `gui/src/renderer/plan/`

**관련**: DR-25, U-119, R-92

### M-4.3 두 볼륨 사이 이동 (키 없음)

**확인할 것**: 계획의 이동 대상이 다른 볼륨을 가리킬 때 복사하지 않고 멈추는지
- 원본을 지우지 않는지

**여기서 못 한 까닭**
- 이 환경에는 두 번째 볼륨이 없었다.
- 실제 `EXDEV`는 확인하지 못했다(설계 조사 5.4). 시험은 주입한 오류뿐이다.

**준비**
- 두 번째 볼륨(USB 메모리, 다른 디스크, M-4.1의 VHD)을 `E:`로 둔다.
- 작업 공간 안에 그 볼륨을 가리키는 정션을 만든다. 정션은 관리자 권한이 필요 없다.
- 대본의 이동 하나를 그 정션 아래로 바꾼다.
  - PowerShell 5.1의 `Get-Content`는 BOM 없는 UTF-8을 잘못 읽는다. 그래서 .NET으로 읽고 쓴다.

```powershell
$org = "$HOME\codaryn-organize-xvol"
Copy-Item -Recurse examples\organize-demo $org      # 저장소 루트에서
New-Item -ItemType Directory -Force E:\codaryn-other | Out-Null
cmd /c mklink /J "$org\workspace\other" "E:\codaryn-other"
$s = [IO.File]::ReadAllText("$org\script.json")
[IO.File]::WriteAllText("$org\script.json", $s.Replace("photos/2025/beach-2025.jpg", "other/beach-2025.jpg"))
```

**순서**

```powershell
node dist/src/cli/main.js run --task $org\task.json
node dist/src/cli/main.js plan --task $org\task.json --run latest
# 계획이 만들어졌으면 적용한다
node dist/src/cli/main.js apply --task $org\task.json --run <계획 실행 id> --digest <다이제스트 앞 12자>
Get-ChildItem $org\workspace\inbox, E:\codaryn-other | Select-Object FullName
```

관리자 권한이 있으면 정션 대신 디스크 관리의 "빈 NTFS 폴더에 탑재"로 같은 것을 한 번 더 본다.

**기대 결과**
- 어느 단계에서 멈추든 다음이 지켜져야 한다.
  - `beach-2025.jpg`가 복사되지 않는다(`E:\codaryn-other`는 비어 있다).
  - 원본이 `inbox`에 남는다.
- 정션은 링크다. 그래서 계획을 만들 때나 적용 전 점검에서 링크 경로로 거부될 것이다(코드 기준).
- 이름 바꾸기까지 갔다면 문제 코드는 `cross_device`(`다른 볼륨으로 옮겨야 함(복사하지 않음)`)다.
- 어느 쪽이었는지, 그리고 나온 코드를 적는다.

**다르면 볼 곳**
- `src/tools/plan-files.ts`(`cross_device`)
- `src/store/common.ts`
- [범용 작업 설계](design/general-tasks.md) "다른 볼륨으로의 이동"

**관련**: 설계 조사 5.4, R-5, R-9

### M-4.4 심볼릭 링크 (키 없음)

**확인할 것**
- 작업 공간 안의 심볼릭 링크(파일, 폴더)가 GUI 트리에서 링크로만 보이고 열리지 않는지
- 실행이 링크를 따라 작업 공간 밖을 읽지 않는지

**여기서 못 한 까닭**: 이 환경은 심볼릭 링크를 만들 권한이 없었다(`EPERM`). 정션만 확인했다(R-78, R-82).

**준비**: 설정 → 시스템 → 개발자용 → 개발자 모드를 켠다. 또는 관리자 PowerShell을 쓴다.

```powershell
$sl = "$HOME\codaryn-symlink"
Copy-Item -Recurse examples\demo $sl                # 저장소 루트에서
New-Item -ItemType Directory -Force "$m\outside-dir" | Out-Null
[IO.File]::WriteAllText("$m\outside-notes.md", "# 바깥 파일`nOUTSIDE-MARKER`n")
New-Item -ItemType SymbolicLink -Path "$sl\workspace\sdir" -Target "$m\outside-dir"
Remove-Item "$sl\workspace\notes.md"
New-Item -ItemType SymbolicLink -Path "$sl\workspace\notes.md" -Target "$m\outside-notes.md"
```

**순서**
1. GUI에서 `$sl\workspace`를 연다. 트리의 `sdir`와 `notes.md`를 본다(펼치기, 열기, 탐색기에서 보기, 경로 복사).
2. CLI로 체험을 실행하고 보고서를 본다.

```powershell
node dist/src/cli/main.js run --task $sl\task.json
node dist/src/cli/main.js report --workspace $sl\workspace --run latest | Select-String "OUTSIDE-MARKER"
```

**기대 결과**
- 1: 두 항목 모두 "링크"로 보인다. 펼치거나 열 수 없고, 탐색기에서 보기와 경로 복사 id가 없다.
- 2
  - 대본의 `notes.md` 읽기가 링크 때문에 거부된다(작업 공간 밖을 가리키는 링크).
  - 보고서와 실행 기록에 `OUTSIDE-MARKER`가 없다(`Select-String` 결과 없음).
  - 실행 결과(상태)는 적어 둔다.

**다르면 볼 곳**
- 앱 계층의 목록: `src/app/` 아래 `listWorkspaceDir`
- 파일 도구의 경로 검사: `src/cli/security/`, `src/tools/`
- [CLI 계약](cli-contract.md) 경로 규칙

**관련**: R-78, R-82, U-89, U-103

### M-4.5 OneDrive 자리표시 파일과 매핑한 네트워크 드라이브 (참고)

**확인할 것**: 두 가지를 본다. 둘 다 설계에 정한 동작이 없다(R-78 "검사하지 않은 범위").
- OneDrive "필요할 때 다운로드" 자리표시 파일이 있는 폴더를 작업 공간으로 열 때의 트리와 실행
- 드라이브 문자로 매핑한 공유 폴더(UNC가 아님)를 작업 공간으로 쓸 때

**여기서 못 한 까닭**: 이 환경에는 OneDrive와 공유 폴더가 없다.

**준비**: OneDrive 폴더 안의 연습용 폴더. 또는 `net use Z: \\<서버>\<공유>`로 매핑한 드라이브의 연습용 폴더.

**순서**

```powershell
node dist/src/cli/main.js doctor --workspace "<그 폴더>"
```

그 폴더를 GUI로 열고 트리를 펼친다. M-1.3처럼 체험 사본을 그 안에 두고 실행해 본다.

**기대 결과**: 정해진 기대가 없다. 다음을 적는다.
- `doctor`의 결과
- 트리에 자리표시 파일이 어떻게 보이는지(링크·보통 파일)
- 트리를 펼치기만 했는데 파일이 내려받아지는지(OneDrive 아이콘)
- 매핑 드라이브가 거부되는지(UNC는 거부한다, 사용 안내 5절)

**다르면 볼 곳**: PM이 결과를 보고 정한다.

**관련**: R-78

---

## 5. 다른 OS (macOS, Linux)

**공통 사항**
- 첫 지원 OS는 Windows 11 x64다(DR-20). macOS(arm64)와 Linux(x64)는 2차다.
- CLI 통합 시험이 그 OS에서 통과해야 GUI로 넘어간다(설계 9절).
- 이 묶음은 CLI만 다룬다. GUI의 macOS·Linux 점검(GUI-D18 단일 인스턴스, E-9)은 2차 GUI 때 한다.

**준비**: 그 OS의 기계에 Node 26 이상과 Git을 둔다.

```bash
git clone <저장소 주소> codaryn && cd codaryn
git rev-parse --short HEAD
node --version
npm ci
npm run build
```

### M-5.1 빌드와 자동 시험

**확인할 것**: 타입 검사와 유닛·통합 시험이 그 OS에서 통과하는지

**여기서 못 한 까닭**: 다른 OS의 기계가 없다.

**순서**

```bash
npm run typecheck
npm run test:unit
npm run test:integration
```

**기대 결과**
- 실패가 0이다.
- Windows 전용 시험은 건너뛰는 것으로 나올 수 있다. 건너뜀 수도 적는다.
- 통과·실패·건너뜀 수를 판 해시와 함께 알린다.

**다르면 볼 곳**: 실패한 시험 이름과 그 출력. 경로 구분자, 대소문자, 프로세스 종료를 다루는 시험이 먼저 의심된다.

**관련**: 설계 조사 5.4, 설계 9절

### M-5.2 기본 설정 위치와 `init`

**확인할 것**: 기본 설정 파일이 `$XDG_CONFIG_HOME/codaryn/config.json`(없으면 `~/.config/codaryn/config.json`)에 만들어지는지
- macOS도 이 위치다.
- 안내 글이 그 OS에 맞는지

**여기서 못 한 까닭**: 다른 OS의 기계가 없다.

**준비**: 진짜 설정을 건드리지 않게 임시 위치를 준다.

**순서**

```bash
export XDG_CONFIG_HOME="$(mktemp -d)"
node dist/src/cli/main.js init            # 터미널에서. 질문에는 Enter
echo "exit $?"
ls -l "$XDG_CONFIG_HOME/codaryn/config.json"
node dist/src/cli/main.js doctor --workspace "$(mktemp -d)"
unset XDG_CONFIG_HOME
```

**기대 결과**
- 파일이 `$XDG_CONFIG_HOME/codaryn/config.json`에 생기고 종료 0이다.
- 출력은 펼친 경로 대신 고정 표기(`$XDG_CONFIG_HOME/codaryn/config.json` 꼴)를 쓴다.
- 키 안내가 Windows 전용 문장(`rundll32 …`)만 말하는지, 그 OS의 방법을 말하는지 적는다.

**다르면 볼 곳**
- `src/cli/settings.ts`, `src/cli/init.ts`
- [사용 안내](usage.md) 4절

**관련**: N-1, 설계 조사 5.4

### M-5.3 키 없는 체험 셋

**확인할 것**: 키 없는 예시 셋이 Windows와 같은 흐름으로 끝나는지
- 문서 요약, 파일 정리, 자료 분석

**여기서 못 한 까닭**: 다른 OS의 기계가 없다.

**순서**

```bash
demo="$HOME/codaryn-demo"; cp -R examples/demo "$demo"
node dist/src/cli/main.js run --task "$demo/task.json"; echo "exit $?"
node dist/src/cli/main.js revert --workspace "$demo/workspace" --run latest; echo "exit $?"
org="$HOME/codaryn-organize-demo"; cp -R examples/organize-demo "$org"
node dist/src/cli/main.js run --task "$org/task.json"
node dist/src/cli/main.js apply --task "$org/task.json" --run <계획 실행 id> --digest <다이제스트 앞 12자>; echo "exit $?"
node dist/src/cli/main.js revert --workspace "$org/workspace" --run latest; echo "exit $?"
ana="$HOME/codaryn-analyze-demo"; cp -R examples/analyze-demo "$ana"
node dist/src/cli/main.js run --task "$ana/task.json"; echo "exit $?"
```

**기대 결과**: [사용 안내](usage.md) 3절, 18.2절, 18.9절의 출력과 같은 흐름과 종료 코드다.
- 체험은 거부 1, 검증 실패 뒤 재수정으로 `done`, 종료 0이다.
- 파일 정리는 적용이 종료 0이고, 되돌리면 `inbox`가 돌아온다.
- 경로 표기만 다를 수 있다.

**다르면 볼 곳**: 끝 요약의 이유 코드와 [사용 안내](usage.md) 17절

**관련**: 사용 안내 3·18절

### M-5.4 OS 언어 판단

**확인할 것**: `CODARYN_LANG`과 설정의 `language`가 없을 때 OS 로캘로 한국어·영어를 고르는지

**여기서 못 한 까닭**: Linux·macOS에서 확인하지 않았다(사용 안내 16절 "OS 언어 판단").

**순서**

```bash
LANG=ko_KR.UTF-8 LC_ALL=ko_KR.UTF-8 node dist/src/cli/main.js doctor --workspace "$HOME/codaryn-demo/workspace"
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 node dist/src/cli/main.js doctor --workspace "$HOME/codaryn-demo/workspace"
CODARYN_LANG=en LANG=ko_KR.UTF-8 LC_ALL=ko_KR.UTF-8 node dist/src/cli/main.js doctor --workspace "$HOME/codaryn-demo/workspace"
```

macOS는 시스템 설정 → 일반 → 언어 및 지역도 바꿔 본다(환경 변수 없이).

**기대 결과**
- 첫째는 한국어, 둘째는 영어, 셋째는 영어(`CODARYN_LANG`이 이긴다)다.
- 로캘이 설치돼 있지 않으면 결과가 다를 수 있다. `locale -a` 결과도 적는다.

**다르면 볼 곳**: `src/i18n/`의 언어 선택(`selectMessageLanguage`)

**관련**: N-4, 사용 안내 8·16절

### M-5.5 작업 공간 잠금

**확인할 것**
- 같은 작업 공간의 두 번째 실행이 `workspace_locked`(종료 6)로 막히는지
- 강제로 끝난 실행의 잠금을 `doctor`가 죽은 잠금으로 보고 다음 실행이 거두는지

**여기서 못 한 까닭**
- 잠금을 쥔 프로세스가 같은 프로세스인지는 시작 시각으로도 확인한다.
- 그 시작 시각을 읽는 법이 OS마다 다르다. Linux는 `/proc`, macOS는 `ps`다.
- Windows(PowerShell 조회)만 확인했다.

**준비**: `sleep 20`을 부르는 대본 작업을 만든다(키 없음).

```bash
slow="$HOME/codaryn-slow"; mkdir -p "$slow/workspace"; echo a > "$slow/workspace/a.txt"
cat > "$slow/task.json" <<'EOF'
{
  "schemaVersion": 1, "id": "manual-slow", "goal": "wait", "workflow": "document", "workspaceRoot": "./workspace",
  "model": { "provider": "scripted", "scriptPath": "./script.json" },
  "policy": { "commands": [{ "executable": "sleep", "argsPrefix": ["20"], "allowExtraArgs": false }], "network": "deny", "destructive": "deny", "restorePathTokens": false },
  "privacy": { "secretEnv": [] },
  "limits": { "maxModelTurns": 3, "maxToolCalls": 3, "maxTotalTokens": 1000, "maxDurationMs": 120000 },
  "verifiers": []
}
EOF
cat > "$slow/script.json" <<'EOF'
{ "schemaVersion": 1, "steps": [
  { "toolCalls": [{ "name": "run_command", "args": { "executable": "sleep", "args": ["20"] } }], "usage": { "inputTokens": 0, "outputTokens": 0 } },
  { "text": "waited", "usage": { "inputTokens": 0, "outputTokens": 0 } } ] }
EOF
```

**순서**
1. 터미널 A에서 `node dist/src/cli/main.js run --task "$slow/task.json"`을 실행한다.
2. 20초 안에 터미널 B에서 다음을 친다.

```bash
node dist/src/cli/main.js run --task "$slow/task.json"; echo "exit $?"
node dist/src/cli/main.js doctor --task "$slow/task.json"
```

3. A를 다시 실행하고, 도는 중에 **A의 터미널 창을 그냥 닫는다**. 또는 다른 터미널에서 `kill -9 <A의 node pid>`를 친다.
4. B에서 `doctor --task "$slow/task.json"`을 다시 치고, 이어서 `run --task "$slow/task.json"`을 친다.

**기대 결과**
- 2: 두 번째 실행은 `workspace_locked`, 종료 6이다. `doctor`의 작업 공간 잠금 항목은 다른 실행이 쥐고 있다는 경고다.
- 4: `doctor`는 죽은 잠금(stale)이라고 알리고, 아무것도 지우지 않는다. 다음 `run`은 그 잠금을 거두고 실행한다.
- 컴퓨터가 몹시 바쁘면 시작 시각 조회가 늦어 '쥐고 있음'으로 볼 수 있다. 이것은 안전한 쪽이다(사용 안내 16절).

**다르면 볼 곳**
- `src/store/lock.ts`
- [사용 안내](usage.md) 16절 "잠금 판정", 17절 "멈춘 실행의 잠금이 남아 막힐 때"

**관련**: 사용 안내 16절, R-87(Windows 잠금 확인)

### M-5.6 명령 실행과 프로세스 그룹

**확인할 것**
- 허용한 명령이 시간 한도에 걸리면, 그 명령이 띄운 자손 프로세스까지 끝나는지(POSIX 프로세스 그룹)
- 작업 공간 안의 실행 파일을 거부하는지

**여기서 못 한 까닭**
- 프로세스 트리 종료는 Windows(`taskkill /T /F`)만 확인했다(T-2).
- 실행 파일 규칙은 [사용 안내](usage.md) 13절에 Windows 것만 있다.
- R-85는 Linux·macOS의 실행 파일 경로 표기를 확인하지 않은 범위로 적었다.

**준비**: 명령이 `sh -c "sleep 60 & sleep 60"`이고 그 호출의 시간 한도가 3초인 대본 작업이다.

```bash
pg="$HOME/codaryn-pgroup"; mkdir -p "$pg/workspace"; echo a > "$pg/workspace/a.txt"
printf '#!/bin/sh\necho inside\n' > "$pg/workspace/tool.sh"; chmod +x "$pg/workspace/tool.sh"
cat > "$pg/task.json" <<'EOF'
{
  "schemaVersion": 1, "id": "manual-pgroup", "goal": "run two commands", "workflow": "document", "workspaceRoot": "./workspace",
  "model": { "provider": "scripted", "scriptPath": "./script.json" },
  "policy": { "commands": [
    { "executable": "sh", "argsPrefix": ["-c", "sleep 60 & sleep 60"], "allowExtraArgs": false },
    { "executable": "./tool.sh", "argsPrefix": [], "allowExtraArgs": false } ],
    "network": "deny", "destructive": "deny", "restorePathTokens": false },
  "privacy": { "secretEnv": [] },
  "limits": { "maxModelTurns": 4, "maxToolCalls": 4, "maxTotalTokens": 1000, "maxDurationMs": 120000 },
  "verifiers": []
}
EOF
cat > "$pg/script.json" <<'EOF'
{ "schemaVersion": 1, "steps": [
  { "toolCalls": [{ "name": "run_command", "args": { "executable": "sh", "args": ["-c", "sleep 60 & sleep 60"], "timeoutMs": 3000 } }], "usage": { "inputTokens": 0, "outputTokens": 0 } },
  { "toolCalls": [{ "name": "run_command", "args": { "executable": "./tool.sh", "args": [] } }], "usage": { "inputTokens": 0, "outputTokens": 0 } },
  { "text": "done", "usage": { "inputTokens": 0, "outputTokens": 0 } } ] }
EOF
```

**순서**

```bash
node dist/src/cli/main.js run --task "$pg/task.json"; echo "exit $?"
ps -ef | grep "[s]leep 60"
node dist/src/cli/main.js report --workspace "$pg/workspace" --run latest
```

**기대 결과**
- 첫 호출은 3초 시간 한도로 끝난다.
- 실행이 끝난 뒤 `ps`에 `sleep 60`이 하나도 없다. 같은 그룹의 자손까지 끝냈다는 뜻이다.
  - `setsid`처럼 그룹을 떠난 자손은 남을 수 있다. 이것은 알려진 한계다(사용 안내 16절).
- 둘째 호출(작업 공간 안의 `./tool.sh`)은 결과가 정해지지 않았다.
  - Windows는 작업 공간 안으로 풀리는 실행 파일을 거부한다(`executable_refused`). POSIX에서도 그런지, 보고서의 그 호출 결과를 그대로 적는다.

**다르면 볼 곳**
- `src/tools/command-runner.ts`
- [아키텍처](architecture.md) "시간 한도·취소 시에는 … POSIX 프로세스 그룹"

**관련**: T-2, R-85, 설계 조사 5.4

### M-5.7 macOS의 대소문자를 가리지 않는 파일 시스템과 보호 경로

**확인할 것**: macOS 기본 APFS는 대소문자를 가리지 않는다. 이름의 대소문자만 바꾼 쓰기가 보호 경로를 비켜 가지 못하는지 본다.
- 보호 경로는 Windows에서만 대소문자를 무시한다고 적혀 있다(사용 안내 13절).
- 그래서 macOS에서 `NOTES.md` 쓰기가 보호 경로 `notes.md`에 걸리지 않을 수 있다.

**여기서 못 한 까닭**: macOS 기계가 없다. 시험은 주입한 오류뿐이다(설계 조사 5.4 "macOS·Linux 대소문자").

**준비**: 체험 사본의 대본이 `summary.md` 대신 `NOTES.md`에 쓰게 바꾼다. 체험은 `notes.md`를 보호한다.

```bash
cs="$HOME/codaryn-case"; cp -R examples/demo "$cs"
sed -i.bak 's/"path": "summary.md"/"path": "NOTES.md"/' "$cs/script.json"
grep -c '"NOTES.md"' "$cs/script.json"     # 2
shasum -a 256 "$cs/workspace/notes.md"
```

**순서**

```bash
node dist/src/cli/main.js run --task "$cs/task.json"; echo "exit $?"
shasum -a 256 "$cs/workspace/notes.md"
ls "$cs/workspace"
node dist/src/cli/main.js report --workspace "$cs/workspace" --run latest
```

**기대 결과**
- 안전한 결과는 둘 가운데 하나다.
  - `NOTES.md` 쓰기가 보호 경로로 거부된다(`protected_path`). `notes.md`의 해시가 그대로다.
  - 또는 쓰기가 되었더라도 무결성 확인이 `needs-input`/`protected_changed`(종료 3)로 알린다.
- `notes.md`가 바뀌었는데 실행이 `done`이면, 보호가 비켜 간 것이다. 그 보고서를 알린다.
- Linux(대소문자를 가리는 ext4)에서는 `NOTES.md`가 다른 파일이다. 그래서 쓰기가 되고 `notes.md`는 그대로인 것이 정상이다.

**다르면 볼 곳**
- 보호 경로 비교: `src/cli/security/`, `src/policy/`
- [사용 안내](usage.md) 13절 "보호 경로"

**관련**: 설계 조사 5.4, 사용 안내 13절

---

## 6. 그 밖

### M-6.1 실제 `npm`(`.cmd`)으로 명령과 검증기 실행 (키 없음)

**확인할 것**: 도구 명령과 검증기가 실제 `npm`을 찾아 실행하는지
- `npm`은 `PATH`·`PATHEXT`로 `npm.cmd`를 찾고, `cmd.exe /d /s /c`로 돈다.

**여기서 못 한 까닭**: Windows 실행 규칙은 가짜 `.cmd`로 검증했다. 실제 `npm` 실행은 점검하지 않았다(사용 안내 13절).

**준비**

```powershell
$np = "$m\npm-check"
New-Item -ItemType Directory -Force "$np\workspace" | Out-Null
[IO.File]::WriteAllText("$np\workspace\package.json", '{ "name": "manual-npm", "private": true, "scripts": { "test": "node --version" } }')
[IO.File]::WriteAllText("$np\task.json", @'
{
  "schemaVersion": 1, "id": "manual-npm", "goal": "run npm test", "workflow": "document", "workspaceRoot": "./workspace",
  "model": { "provider": "scripted", "scriptPath": "./script.json" },
  "policy": { "commands": [{ "executable": "npm", "argsPrefix": ["test"], "allowExtraArgs": false }], "network": "deny", "destructive": "deny", "restorePathTokens": false },
  "privacy": { "secretEnv": [] },
  "limits": { "maxModelTurns": 3, "maxToolCalls": 3, "maxTotalTokens": 1000, "maxDurationMs": 120000 },
  "verifiers": [{ "id": "npm-test", "kind": "command", "executable": "npm", "args": ["test"] }]
}
'@)
[IO.File]::WriteAllText("$np\script.json", @'
{ "schemaVersion": 1, "steps": [
  { "toolCalls": [{ "name": "run_command", "args": { "executable": "npm", "args": ["test"] } }], "usage": { "inputTokens": 0, "outputTokens": 0 } },
  { "text": "npm test ran", "usage": { "inputTokens": 0, "outputTokens": 0 } } ] }
'@)
(Get-Command npm).Source
```

**순서**

```powershell
node dist/src/cli/main.js run --task $np\task.json
$LASTEXITCODE
node dist/src/cli/main.js report --workspace $np\workspace --run latest
```

**기대 결과**
- 명령 호출이 허용되어 돈다. 결과에 `npm test`의 출력(`node --version`의 판)이 있다.
- 검증기 `npm-test`가 `pass`이고, 실행은 `done`, 종료 0이다.
- `npm.cmd`의 실경로에 괄호 같은 글자가 있으면 `script_refused`로 거부된다(예: `Program Files (x86)`). 이것은 규칙대로다. 그 경로를 적는다.

**다르면 볼 곳**
- `src/tools/windows-launch.ts`
- [사용 안내](usage.md) 13절 "Windows 실행 규칙"

**관련**: 사용 안내 13절

### M-6.2 탐색기 주소창의 `%APPDATA%` 표기 (키 없음)

**확인할 것**: `init`과 문구가 쓰는 고정 표기 `%APPDATA%\Codaryn\config.json`을 탐색기 주소창에 붙이면 열리는지

**여기서 못 한 까닭**: 명령 프롬프트와 PowerShell에서는 확인했다. 탐색기 화면으로는 확인하지 않았다(UXM-20).

**순서**
1. 탐색기를 연다(Win+E).
2. 주소창에 `%APPDATA%\Codaryn`을 붙이고 Enter를 친다.

**기대 결과**
- 기본 설정 폴더가 열린다.
- `init`을 한 적이 없으면 폴더가 없다는 알림이 나온다. 그것도 표기가 풀린 것이다.

**다르면 볼 곳**: [사용 안내](usage.md) 4절 "기본 설정 만들기"

**관련**: UXM-20

---

## 이 문서에 넣지 않은 것

- **GUI 꾸러미, 코드 서명, SmartScreen, 설치 크기**(GU-9, E-4, E-6): 꾸러미 만들기가 아직 없다(`npm run package` 없음). 만들어지면 이 문서에 더한다.
- **WCAG 2.2 AA 자동 검사**: 도구 설치에 승인이 필요하다(설계 7절). M-3.3~M-3.7은 사람이 보는 몫이다.
- **Windows arm64**: 지원이 미정이다(설계 9절).
