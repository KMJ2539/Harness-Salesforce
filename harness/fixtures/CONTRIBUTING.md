# Fixture 추가 절차

incident 발생 또는 새 anti-pattern 발견 시:

1. `sfdx-projects/{name}/` 디렉터리 생성. `sfdx-project.json`, `force-app/main/default/...` 최소 구조.
2. 취약 코드 fixture 라면 `expected.json` 에 `"intentionallyVulnerable": true` 박제 + 모든 Apex 파일 상단에 표준 헤더 주석:
   ```
   // INTENTIONALLY VULNERABLE — harness-sf test fixture only.
   // NOT for deployment. See expected.json `intentionallyVulnerable: true`.
   ```
3. SF ID literal 은 가짜 형식 사용: `001FIXTURE000000001`, `012FIXTURE000000002`.
4. `expected.json` 의 `findings[].category` 는 `harness/contracts/expected.ts` 의 closed enum 만 사용. 새 카테고리 필요 시 별도 PR 로 enum 확장.
5. `README.md` 1~2 문단 — 의도와 expected findings 의 근거.
6. 보안 스캐너 제외 규칙: repo 루트 `.gitleaks.toml`/`.trufflehog.yml` 가 `harness/fixtures/**` 를 제외하는지 확인.
