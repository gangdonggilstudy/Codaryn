# Codaryn

Codaryn은 로컬에서 실행하는 범용 작업 에이전트 CLI다. 코딩과 문서 작업을 처리하며, 작업 공간 하나 안에서 파일을 읽고 고치고 허용한 명령을 실행한다. 모든 작업은 정해진 권한 정책 안에서 이루어진다. 등록한 비밀은 모델에 보내기 전에 가리고, 성공 여부는 검증기가 판정한다. 모델은 Anthropic API를 쓴다.

**현재 상태:** 오프라인 검증(유닛·프로세스 통합)과 모의 API 검증을 통과했다. 실제 API로는 아직 검증하지 않았다.

## 빠른 시작 (PowerShell)

```powershell
npm ci; npm run build
New-Item -ItemType Directory -Force D:\codaryn-settings | Out-Null; Copy-Item .env.example D:\codaryn-settings\.env
# 위 .env를 편집기로 열어 키와 CODARYN_MODEL을 채우고 BOM 없는 UTF-8로 저장한다. 설정은 작업 공간 밖에 둔다
Copy-Item -Recurse examples D:\codaryn-examples   # 모델이 파일을 고치므로 예시는 사본에서 실행한다
node dist/src/cli/main.js run --task D:\codaryn-examples\doc-task.json `
  --config D:\codaryn-examples\config.example.json --env-file D:\codaryn-settings\.env
```

## 문서

- [사용 안내](docs/usage.md): 설정, 실행, 결과, 비밀, 정책, 점검표, 한계, 문제 해결
- [CLI·공통 계약](docs/cli-contract.md)
- [문서 안내](docs/README.md)
- [공통 개발 지침](AGENTS.md), [Claude 작업 지침](CLAUDE.md)
