# Logging Convention (declarative)

Reference: Read when authoring/reviewing/testing Apex entry points (Batch/REST/Callout/Invocable/Schedulable/Queueable).

This rule is built on the premise that **the log object name differs per org**. Class/helper/superclass names are not hardcoded; the only fixed point is the **single log sObject API name** declared by the project in `.harness-sf/PROJECT.md`.

## Declaration location

The rule is activated when `.harness-sf/PROJECT.md` contains the following YAML-style block at the top level. If the block is missing or `log_sobject` is empty, the **rule is OFF** (zero false positives).

```yaml
logging:
  log_sobject: IF_Log__c            # differs per org (e.g. Application_Log__c, txn_log__c)
  required_fields:                  # fields that must be populated on insert (code review only checks existence)
    - ApexName__c
    - StatusCode__c
    - StartDatetime__c
  entry_points:                     # entry-point types to enforce
    - batch                         # implements Database.Batchable
    - rest_resource                 # @RestResource
    - callout                       # Http.send caller (outside of wrapper class)
    - invocable                     # @InvocableMethod
    - queueable                     # implements Queueable
    - schedulable                   # implements Schedulable
  enforcement:
    detection: behavioral           # 'behavioral' (reachability) | 'name' (name match) | 'marker' (interface/annotation)
    test_assertion: required        # 'required' | 'optional' — whether entry-point tests must assert log insertion
    callout_wrapper: IF_Callout     # (optional) when callout entry points are detected, exclude *inside* of this wrapper
```

**Parsing rule**: agents extract this block via line-wise grep (`logging:` header ~ next top-level header or EOF). Absent → rule disabled.

## Entry-point identification (detection: behavioral basis)

| `entry_points` value | Detection token |
|---|---|
| `batch` | `implements .*Database\.Batchable` |
| `queueable` | `implements .*Queueable` |
| `schedulable` | `implements .*Schedulable` |
| `rest_resource` | `@RestResource` (class annotation) |
| `callout` | `new Http()` + `\.send\(` in method body, or direct `HttpRequest` use |
| `invocable` | `@InvocableMethod` (method annotation) |

Test classes (`*Test.cls` / `*_Test.cls` / `Test*.cls`) are excluded from all rules.

## Core rule — "entry point → log_sobject DML reachability"

Within a class classified as an entry point, **a DML call (`insert` / `upsert` / `Database.insert` / `Database.upsert`) on the `{log_sobject}` SObject must be reachable**.

Reachability decision (regex heuristic):
1. **Direct**: in the same class, an sObject instance is created via `new {log_sobject}\b` or `{log_sobject}\b\s+\w+\s*=`, and `insert|upsert|Database\.(insert|upsert)` appears in the same file.
2. **Indirect**: somewhere in another method/class invoked by the entry-point method, condition 1 is satisfied. Call graph is traced only 1-hop (regex limit). 2+ hops are explicitly marked as out-of-visibility.
3. **Superclass delegation**: when class `extends X`, condition 1 satisfied inside `force-app/**/classes/X.cls` is treated as reachable.
4. **Wrapper delegation** (`callout` entry only): invoking a method on the class declared as `callout_wrapper` is treated as reachable (the wrapper is responsible for satisfying condition 1 *inside*).

If unreachable: 🔴 **logging convention violation — `{log_sobject}` insertion path not found in `{entry-point type}` `{ClassName}`**.

## Auxiliary rules

**Logging in catch blocks**
- If the entry-point method has a try/catch and the catch block exists but no `{log_sobject}` DML is visible in the block (or in methods it calls 1-hop), 🟡 (only success path is logged, failure path is missing).

**Callout bypass detection**
- When `callout` entry points are active: if the `new Http()` + `\.send\(` pattern is found outside of the class declared as `callout_wrapper` (e.g. `IF_Callout`), 🟡 ("wrapper bypass — logging automation not applied").
- When `callout_wrapper` is not declared, this rule is disabled.

**Field omission (optional)**
- Just before DML, grep for assignments to each `{required_fields}` field (`{var}\.{field}\s*=`). Missing fields are reported as 🟢 informational only (actual value validation is the test assertion's responsibility).

## Test assertion rule (`enforcement.test_assertion: required`)

The test class for an entry-point class must contain **at least one** of the following patterns:

```apex
// Pattern A — count assertion
Integer logCount = [SELECT COUNT() FROM IF_Log__c WHERE ApexName__c = 'MyClass'];
System.assert(logCount > 0, ...);

// Pattern B — record assertion
List<IF_Log__c> logs = [SELECT Id, StatusCode__c FROM IF_Log__c];
System.assertEquals('S', logs[0].StatusCode__c);
```

Detection: a test method contains both `[SELECT ... FROM {log_sobject}` SOQL + `System.assert(Equals)?`. Recommended **1 success path + 1 catch path** per entry point.

If missing, `sf-apex-test-author` augments automatically. If the user declines, the body explicitly notes that augmentation was skipped.

## Rule OFF cases (intentional)

The rule is disabled in:
- No `logging:` section in PROJECT.md → new org or project without an established convention.
- `log_sobject:` value is empty.
- Class matches the `*Test.cls` pattern (the test itself).
- Class contains a `// @no-log` comment line — intentional bypass marker. Reported as 🟢 informational, one line in the body.

## Agent responsibility split

| Agent | Step | Action |
|---|---|---|
| `sf-apex-code-reviewer` | Step 3 common checks + Step 4 per-category checks | reachability check, missing-catch check, bypass detection |
| `sf-deploy-validator` | Step 2 static analysis | duplicates the same regex rules as the reviewer (bypass blocking) |
| `sf-apex-test-author` | Step 3 case matrix | for entry points, automatically include log_sobject SOQL assertions |

All three agents Read the PROJECT.md `logging:` section once at the start of their step. Section absent → skip this rule.

## Limits (intentional restraint)

- Regex-based, so reflection / dynamic invocation bypasses are not detected. **Test assertions** (`enforcement.test_assertion`) catch those.
- Call graphs beyond 2-hop are not traced. Deep delegation is reported in the body as "reachability unverified — beyond 1-hop super/wrapper area".
- The rule is **existence verification**, not **quality verification**. Whether the log content is meaningful is the human reviewer's responsibility.
