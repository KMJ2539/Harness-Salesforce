# Library Catalog

Pattern catalog that `sf-design-library-reviewer` **must Read** when reviewing a design.md.
A set of if-then rules: "if pattern X is in the design and Y is not in the inventory → category recommendation enforced."

This file's role is to **mandate category-level recommendations**. Specific library names are mentioned only as "representative candidates" within a category; the user themselves confirms the 04t/git URL/npm name and then introduces it via `/sf-library-install` (Iron Law — no hallucination).

---

## Usage (reviewer side)

When applying the Step 3 rubric, walk through each entry in this catalog:

1. Does the `trigger-when` condition match the design.md?
2. If matched, is there an `inventory-marker` trace in the inventory?
3. No trace → **add 1-line category recommendation in `Category Recommendations` + record this artifact as `library-recommended: <category>` in `Library Verdict` (mandatory)**.
4. Trace present → record "already adopted, reuse" in `Reuse Opportunities` + `library-applied: <name>` in `Library Verdict`.
5. trigger-when itself doesn't match → record `library-not-applicable: <reason>` in `Library Verdict`.

The `Library Verdict` section requires every artifact to be classified into one of these three states — it prevents a "not reviewed" status from remaining in design.md (validate-design.js `--check-library-verdict` blocks it).

---

## Pattern list

### 1. trigger-framework

- **trigger-when**: design.md `## Artifacts` contains at least one artifact with `[type: apex]` whose subtype is one of `trigger`, `trigger-handler`, `trigger+handler`.
- **inventory-marker**: any of the following counts as "adopted":
  - `force-app/**/classes/TriggerHandler.cls` (kevinohara80 pattern)
  - `force-app/**/classes/fflib_SObjectDomain.cls` (fflib)
  - `force-app/**/classes/sfab_*.cls` (sfab)
  - Adoption record for the `trigger-framework` category in `.harness-sf/decisions.md`
- **Representative candidates** (only mention specific names when inventory is present; otherwise category only):
  - kevinohara80/sfdc-trigger-framework — low learning cost, single responsibility. Default for small/mid-size projects.
  - fflib-apex-common (Apex Enterprise Patterns) — full Domain/Selector/Service stack. For large scale + when pattern consistency matters.
  - sfab — lightweight base for context dispatch + before/after override.
- **Recommendation rationale (default wording)**: "One trigger per object + before/after branching + recursion guard + bypass pattern is the standard solution for the trigger framework category. If you start with your own static class, the cost of branching the pattern accumulates when introducing a second trigger."

### 2. selector-pattern

- **trigger-when**: design.md has 2+ `[type: apex]` artifacts as service/handler that author SOQL directly, or SOQL against the same object appears 3+ times in the design.
- **inventory-marker**: `force-app/**/classes/*Selector.cls`, `force-app/**/classes/fflib_SObjectSelector.cls`, `selector-pattern` record in decisions.md.
- **Representative candidates**:
  - fflib_SObjectSelector — selector base from Apex Enterprise Patterns.
  - Custom mini-selector (simple cases).
- **Recommendation rationale**: "Scattered SOQL increases the cost of verifying FLS/sharing consistency + cost of editing N classes simultaneously when adding fields. Concentrating into one Selector keeps change cost at O(1)."

### 3. unit-of-work

- **trigger-when**: design.md has `[type: apex]` artifacts that insert/update 3+ sObjects in a single transaction, or specify simultaneous insert of parent-child relationships (parent → external Id → child).
- **inventory-marker**: `fflib_SObjectUnitOfWork.cls`, `unit-of-work` record in decisions.md.
- **Representative candidates**:
  - fflib_SObjectUnitOfWork — DML batching + automatic dependency resolution.
- **Recommendation rationale**: "Manual DML ordering is the leading cause of cross-object dependency omissions + DML count governor violations. UoW resolves dependencies at commit time."

### 4. http-callout-mock

- **trigger-when**: design.md specifies `Database.AllowsCallouts` or `HttpRequest` or external API integration, and the Test Strategy assumes a hand-rolled `HttpCalloutMock` implementation.
- **inventory-marker**: `force-app/**/classes/*HttpMock*.cls`, `force-app/**/classes/*MultiMock*.cls`, `http-callout-mock` record in decisions.md.
- **Representative candidates**:
  - financialforcedev/MultiRequestMock pattern — per-endpoint branching mock.
  - Custom enum-based mock factory.
- **Recommendation rationale**: "Hand-rolling per-endpoint branching mocks in every test produces N×M boilerplate per retry/error/timeout scenario. Introducing a reusable mock factory once pays off long term."

### 5. test-data-factory

- **trigger-when**: design.md `## Artifacts` has a `[type: apex]` `[subtype: test]` artifact and TestSetup must produce 3+ sObject types (e.g. Account + Contact + Order + OrderItem).
- **inventory-marker**: `force-app/**/classes/TestDataFactory.cls`, `force-app/**/classes/*TestUtil.cls`, `test-data-factory` record in decisions.md.
- **Representative candidates**:
  - Custom TestDataFactory pattern (static methods / fluent builder).
  - sfdx-falcon test-utils.
- **Recommendation rationale**: "When test data setup is scattered across classes, adding a required field breaks N tests at once. Concentrating into one Factory keeps change cost at O(1)."

### 6. structured-logging

- **trigger-when**: design.md has batch / queueable / schedulable / @RestResource / external callout entry points, and the PROJECT.md `logging` section is unfilled (or specifies direct `System.debug` use).
- **inventory-marker**: Nebula Logger namespace `nebc__*`, `force-app/**/classes/Logger.cls` (custom), `force-app/**/classes/IF_Log*.cls`, `structured-logging` record in decisions.md, **or** PROJECT.md `logging.log_sobject` is specified (treated as a custom convention being established).
- **Representative candidates**:
  - jongpie/NebulaLogger — de facto standard OSS logger in the Salesforce community.
  - Custom log sObject + IF_Logger pattern.
- **Recommendation rationale**: "If you can't answer 'who/when/which payload' during an operational incident, tracing is impossible. System.debug evaporates after 7 days + isn't collected in production. Structured logging's per-incident time savings exceeds its adoption cost."

---

## Patterns outside the catalog

For patterns beyond these 6 (e.g. state machine, event bus, OAuth helper), reviewers make their own category recommendation when they appear explicitly in the design. The catalog only enforces inspection for **core patterns with a high omission rate**.

When adding a new pattern to the catalog:
1. The trigger-when condition must be **objectively determinable** by grep/glob (no subjective wording).
2. The inventory-marker must define both file pattern + decisions.md key.
3. The recommendation rationale must be expressed as business cost (incident cost / change cost) — no technology-preference vocabulary.
