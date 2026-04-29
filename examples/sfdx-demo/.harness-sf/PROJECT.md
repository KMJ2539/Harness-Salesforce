# PROJECT.md — harness-sf demo

Team-shared, committed conventions for this project.

## Conventions

- **Sharing default**: `with sharing` for all new Apex classes.
- **Naming**: handlers `<Object>Handler`, services `<Domain>Service`, batch `<Domain>Batch`.
- **API version floor**: 60.0.

## Forbidden patterns

- Direct profile edits — use Permission Sets only.
- Hardcoded record IDs in Apex / LWC.
- Unescaped dynamic SOQL.

## Permission strategy

- One Permission Set per persona (`PS_OrderOps`, `PS_OrderViewer`).
- No profile-level permissions.

## Coverage

- coverage_target_percent: 80
