# Metadata / Deploy Rules

레퍼런스: deploy-validator, sf-sobject, sf-field 작성/리뷰 시 Read.

## sObject sharingModel

| 값 | 의미 |
|---|---|
| `Private` | OWD private. sharing rule/manual sharing으로만 접근. |
| `Read` | OWD Read. 모두 read, owner만 edit. |
| `ReadWrite` | OWD Read/Write. 모두 read/edit. |
| `ControlledByParent` | master-detail 부모 따라감. |

**변경 시 위험**: `ReadWrite → Private`은 데이터 노출 축소 — 기존 사용자 영향. 강한 경고.

## Field 변경 안전성

| 변경 | 안전성 | 이유 |
|---|---|---|
| label, description, help text | 🟢 안전 | 데이터 무영향 |
| length 확장 (Text 80 → 255) | 🟢 안전 | 기존 데이터 fits |
| picklist value 추가 | 🟢 안전 | 기존 record 무영향 |
| picklist value 삭제 | 🟡 위험 | 기존 record 값이 inactive picklist 됨 |
| length 축소 | 🔴 위험 | truncation 또는 deploy 실패 |
| type 변경 (Text → Number) | 🔴 위험 | 데이터 손실 |
| required: false → true | 🔴 위험 | 기존 null record가 update 시 실패 |
| unique 추가 | 🔴 위험 | 기존 중복 시 실패 |
| field 삭제 | 🔴 매우 위험 | 데이터 영구 손실, 15일 grace |

## Permission

- profile 직접 수정 금지. Permission Set만.
- Field 추가 시 PermSet 업데이트 필수 (안 하면 보이지 않음).
- `Modify All Data`, `View All Data` 부여는 보안 검토 대상.

## Deploy 전략

| 명령 | 용도 |
|---|---|
| `sf project deploy validate` | check-only, 데이터 변경 없음 |
| `sf project deploy start` | 실제 deploy |
| `sf project deploy quick --job-id <id>` | validated deploy 실행 (test 재실행 skip) |
| `sf project deploy report --job-id <id>` | 진행 상태 |

## Production deploy 게이트

- **반드시 validate 먼저**.
- Production org 감지: `sf data query -q "SELECT IsSandbox FROM Organization LIMIT 1"`.
- IsSandbox=false → `--test-level RunLocalTests` 또는 `RunSpecifiedTests` 강제.
- coverage <75% → BLOCKED.
- destructive changes 포함 시 강한 확인.

## destructiveChanges.xml

- `<Package>` 안에 삭제할 컴포넌트 명시.
- field 삭제는 데이터 손실. 15일 내 복구 가능 (recycle bin).
- object 삭제는 즉시 영구 (관련 fields/records 모두).

## API version 관리

- `sfdx-project.json`의 `sourceApiVersion`이 기본.
- 메타 파일별 `<apiVersion>` 명시 가능.
- 새 기능 사용 시 60.0+ 필요 (USER_MODE 등).

## 관련 토픽

- sharing-fls-crud.md
- soql-anti-patterns.md
