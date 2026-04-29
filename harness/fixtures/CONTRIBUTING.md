# Fixture-addition procedure

When an incident occurs or a new anti-pattern is discovered:

1. Create the `sfdx-projects/{name}/` directory. Minimal structure: `sfdx-project.json`, `force-app/main/default/...`.
2. For a vulnerable-code fixture, set `"intentionallyVulnerable": true` in `expected.json` and add the standard header comment at the top of every Apex file:
   ```
   // INTENTIONALLY VULNERABLE — harness-sf test fixture only.
   // NOT for deployment. See expected.json `intentionallyVulnerable: true`.
   ```
3. Use the fake format for SF ID literals: `001FIXTURE000000001`, `012FIXTURE000000002`.
4. The `findings[].category` values in `expected.json` must use only the closed enum from `harness/contracts/expected.ts`. To add a new category, expand the enum in a separate PR.
5. `README.md`: 1–2 paragraphs — intent and rationale for the expected findings.
6. Security-scanner exclusion: confirm that the repo root `.gitleaks.toml` / `.trufflehog.yml` excludes `harness/fixtures/**`.
