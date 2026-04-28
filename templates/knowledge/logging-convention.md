# Logging Convention (선언형)

레퍼런스: Apex 진입점(배치/REST/Callout/Invocable/Schedulable/Queueable) 작성·리뷰·테스트 시 Read.

이 룰은 **org마다 로그 객체 이름이 다르다**는 전제 위에 있다. 클래스명/헬퍼명/슈퍼클래스명을 박아두지 않고, 프로젝트가 `.harness-sf/PROJECT.md`에 선언한 **로그 sObject API name 1개**만 고정점으로 삼는다.

## 선언 위치

`.harness-sf/PROJECT.md` 최상위에 다음 YAML-style 블록이 있으면 룰이 활성화된다. 블록이 없거나 `log_sobject`가 비어있으면 **룰 OFF** (false positive 0).

```yaml
logging:
  log_sobject: IF_Log__c            # org별로 다름 (예: Application_Log__c, txn_log__c)
  required_fields:                  # 적재 시 채워야 할 필드 (코드 리뷰 단계에서는 존재만 확인)
    - ApexName__c
    - StatusCode__c
    - StartDatetime__c
  entry_points:                     # 강제할 진입점 종류
    - batch                         # implements Database.Batchable
    - rest_resource                 # @RestResource
    - callout                       # Http.send 호출자 (래퍼 클래스 외부)
    - invocable                     # @InvocableMethod
    - queueable                     # implements Queueable
    - schedulable                   # implements Schedulable
  enforcement:
    detection: behavioral           # 'behavioral' (도달성) | 'name' (이름 매칭) | 'marker' (인터페이스/어노테이션)
    test_assertion: required        # 'required' | 'optional' — 진입점 테스트에서 로그 적재 단언 강제 여부
    callout_wrapper: IF_Callout     # (선택) callout 진입점 검출 시 이 래퍼 *내부*는 검사 제외
```

**파싱 규칙**: agent들은 위 블록을 라인 단위 grep으로 추출한다 (`logging:` 헤더 ~ 다음 최상위 헤더 또는 EOF). 없으면 룰 비활성화.

## 진입점 식별 (detection: behavioral 기준)

| `entry_points` 값 | 검출 토큰 |
|---|---|
| `batch` | `implements .*Database\.Batchable` |
| `queueable` | `implements .*Queueable` |
| `schedulable` | `implements .*Schedulable` |
| `rest_resource` | `@RestResource` (클래스 어노테이션) |
| `callout` | 메서드 본문 내 `new Http()` + `\.send\(` 또는 `HttpRequest` 직접 사용 |
| `invocable` | `@InvocableMethod` (메서드 어노테이션) |

테스트 클래스(`*Test.cls` / `*_Test.cls` / `Test*.cls`)는 모든 룰에서 제외.

## 핵심 룰 — "진입점 → log_sobject DML 도달성"

진입점으로 분류된 클래스 안에서, **`{log_sobject}` SObject에 대한 `insert` / `upsert` / `Database.insert` / `Database.upsert` DML 호출이 도달 가능**해야 한다.

도달 판정 (정규식 휴리스틱):
1. **직접**: 같은 클래스 안에서 `new {log_sobject}\b` 또는 `{log_sobject}\b\s+\w+\s*=` 같이 sObject 인스턴스를 만들고 `insert|upsert|Database\.(insert|upsert)` 가 같은 파일에 등장.
2. **간접**: 진입점 메서드가 호출하는 다른 메서드/클래스 어디선가 1번을 만족. 호출 그래프를 1-hop 까지만 탐색 (정규식 한계). 2-hop 이상은 불가시 영역으로 명시.
3. **슈퍼클래스 위임**: 클래스가 `extends X` 일 때 `force-app/**/classes/X.cls` 안에서 1번 만족 시 도달로 간주.
4. **래퍼 위임** (`callout` 진입점 한정): `callout_wrapper`로 선언된 클래스의 메서드를 호출하면 도달로 간주 (그 래퍼 *안*에서 1번을 만족할 책임).

도달 불가 시: 🔴 **logging convention 위반 — `{진입점 종류}` `{ClassName}` 에서 `{log_sobject}` 적재 경로 미발견**.

## 부가 룰

**catch 블록의 로그 적재**
- 진입점 메서드의 try/catch 구조에서 catch 블록이 존재하는데 그 블록(또는 그 블록이 호출하는 메서드 1-hop)에서 `{log_sobject}` DML이 보이지 않으면 🟡 (성공 path만 로깅, 실패 path 누락).

**Callout 우회 검출**
- `callout` 진입점 활성 시: `IF_Callout` 등 `callout_wrapper`로 선언된 클래스 외부에서 `new Http()` + `\.send\(` 패턴이 발견되면 🟡 ("래퍼 우회 — 로깅 자동화 미적용").
- `callout_wrapper` 미선언 시 본 룰 비활성.

**필드 누락 (선택, optional)**
- DML 직전에 `{required_fields}` 각 필드에 대한 대입(`{var}\.{field}\s*=`)이 보이는지 grep. 누락 필드는 🟢 정보로만 보고 (실제 값 검증은 테스트 단언이 책임짐).

## 테스트 단언 룰 (`enforcement.test_assertion: required`)

진입점 클래스의 테스트 클래스에 다음 패턴 중 **하나 이상** 존재해야 한다:

```apex
// 패턴 A — count 단언
Integer logCount = [SELECT COUNT() FROM IF_Log__c WHERE ApexName__c = 'MyClass'];
System.assert(logCount > 0, ...);

// 패턴 B — 레코드 단언
List<IF_Log__c> logs = [SELECT Id, StatusCode__c FROM IF_Log__c];
System.assertEquals('S', logs[0].StatusCode__c);
```

검출: 테스트 메서드 안에 `[SELECT ... FROM {log_sobject}` SOQL + `System.assert(Equals)?` 동시 출현. 진입점별로 **정상 path 1건 + catch path 1건** 권장.

누락 시 `sf-apex-test-author` 가 자동 보강. 사용자가 거부하면 본문에 미보강 명시.

## 룰 OFF 케이스 (의도적)

다음은 룰 비활성:
- PROJECT.md에 `logging:` 섹션 없음 → 신규 org 또는 컨벤션 미수립 프로젝트.
- `log_sobject:` 값이 비어있음.
- 클래스가 `*Test.cls` 패턴 (테스트 자체).
- 클래스에 `// @no-log` 주석 라인 존재 — 의도적 우회 표식. 본문에는 🟢 정보로 1줄 보고.

## Agent 책임 분담

| Agent | 단계 | 행동 |
|---|---|---|
| `sf-apex-code-reviewer` | Step 3 공통 점검 + Step 4 분류별 점검 | 도달성 검사, catch 누락 검사, 우회 검출 |
| `sf-deploy-validator` | Step 2 정적 분석 | Reviewer와 동일 룰 정규식 이중화 (우회 차단) |
| `sf-apex-test-author` | Step 3 케이스 매트릭스 | 진입점이면 log_sobject SOQL 단언 자동 포함 |

세 agent 모두 PROJECT.md `logging:` 섹션을 Step 시작 직후 1회 Read. 섹션 없음 → 본 룰 skip.

## 한계 (의도적 절제)

- 정규식 기반이므로 reflection / dynamic invocation 우회 불가. 그건 **테스트 단언**(`enforcement.test_assertion`)이 잡는다.
- 호출 그래프 2-hop 이상은 추적 안 함. 깊은 위임은 본문에 "도달성 미확인 — 슈퍼/래퍼 1-hop 외 영역" 으로 보고.
- 룰은 **존재 검증**이지 **품질 검증**이 아니다. 로그 내용이 의미 있는지는 사람의 코드 리뷰 책임.
