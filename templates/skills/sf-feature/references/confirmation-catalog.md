# Step 3.5 — design.md confirmation catalog

Reference for `/sf-feature` Step 3.5. The orchestrator counter-questions items in the design.md draft via AskUserQuestion using these recommendations.

## Question format

```
[Item]: what decision is needed
[Candidates]: list every reasonable option with [default]/[recommend] tags
[Recommend reasoning — business-first]: one sentence. Not technical detail.
[Technical reasoning]: (one-line aside if any)
```

## Recommend perspective (business-first)

- What reduces **incident cost / rollback cost / loss of trust**?
- What reduces **user confusion / operational complexity**?
- What balances **speed-to-launch vs regret cost**?
- When technical best practice conflicts with business reasoning, business wins.

## Confirmation categories

Only ask those that apply, based on Why/What/How/Artifacts of design.md.

### 1. Phasing — all artifacts vs phase split
- **Recommend**: with 5+ artifacts or clearly phased intent, **"Phase 1 first"**.
- **Reason**: "Cost of reversing a wrong decision exceeds the cost of fast full launch. Decide Phase 2 after watching usage for 6 months."

### 2. Sharing model consistency (when sObject involved) — Private / Public Read Only / Public Read/Write
- **Recommend**: typically **`Private`**.
- **Reason**: "Data-exposure incidents have customer-trust + compliance cost; a single incident dwarfs operational convenience ('visible to all')."

### 3. Permission Set strategy — single PS / per-persona split (e.g. Sales PS / Admin PS)
- **Recommend**: with 2+ personas explicitly listed, **"split"**.
- **Reason**: "Starting with a single PS leaves no way to narrow blast radius on permission incidents. Splitting later costs more than splitting from day one."

### 4. UI exposure scope (when LWC involved) — internal users / partner community / external customers
- **Recommend**: if unspecified, **"internal users only (Phase 1)"**.
- **Reason**: "External exposure has different security/UX requirements. Validate internally first to minimize external-incident cost."

### 5. External API exposure (when Apex involved) — @AuraEnabled / @RestResource / not exposed
- **Recommend**: if the feature does not state external integration, **"not exposed"**.
- **Reason**: "More exposure surface means more security review + version management. Adding it later is cheaper than exposing prematurely."

### 6. Data retention policy (when sObject involved) — hard delete / soft delete (Status=Deleted) / archive
- **Recommend**: business data (orders/contracts, etc.) → **"soft delete"**; transient data → **"hard delete"**.
- **Reason**: "Recovery requests for deleted business data almost always come (audit/dispute/mistake recovery). Retention cost < irrecoverable cost."

### 7. Audit / Field History Tracking (sObject) — on / off
- **Recommend**: for money/contract/state-transition fields, **"on (those fields only)"**.
- **Reason**: "If 'who changed what when' cannot be answered during disputes/audits, operational cost explodes. Cost of enabling is negligible."

### 8. Migration / handling of existing data (modify mode or replacement system exists) — migration script / new system only / parallel run
- **Recommend**: if existing data is stated, **"parallel run (Phase 1)"**.
- **Reason**: "Cutover migration is unrollback-able on incident. Parallel-run cost < data-loss cost."

## Application rules

- design.md draft already has a clear answer → short confirmation `"X declared in design.md, confirm? [Y/edit]"` instead of a full question.
- Ambiguous or empty items → full question in the format above.
- Recommend is not forced — record reason in design.md `## Decisions` if user picks differently (the reviewer references it later).
- Bundle 1–3 questions at a time — manage user fatigue.

Reflect results in design.md (update sharing modifier in `## Artifacts`, add a `## Phasing` section, etc.) before proceeding to Step 3.9.
