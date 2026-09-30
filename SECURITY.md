# Security Policy

## Reporting Security Issues

If you discover a potential vulnerability or security concern in VibeCommit:

1. **Do NOT report real credentials, private tokens, or actual API keys in public GitHub issues or discussions.**
2. When submitting a report or reproduction, use only synthetic, clearly fake placeholder data (e.g. `sk-fake-placeholder`, `ghp_fakeExampleOnly`).
3. Describe the vulnerability, reproduction steps, observed behavior, and expected behavior.
4. Reports can be submitted via GitHub Issues using the issue tracker.

## Privacy Boundary & Redaction Disclaimer

VibeCommit includes a multi-layered local sanitization pipeline:

- **Path-based content policy**: High-risk files (`.env`, private keys), lockfiles, generated assets, and binaries are withheld or summarized.
- **Pattern-based secret redaction**: Regular-expression matching masks common token and credential assignments before diff budgeting.
- **Diff budgeting**: Strict length limits bound the amount of staged text processed.

**Important**: Pattern-based redaction is a heuristic risk-reduction control, not an absolute guarantee. It cannot detect all possible sensitive values, customized formats, or novel credential types. Developers remain responsible for inspecting staged changes before committing and should never rely solely on automated sanitization.

## Credential Compromise & Rotation

If you believe a real credential was accidentally exposed or sent to an external service:

- **Rotate the credential immediately** at the issuing service (e.g. OpenAI, GitHub, AWS).
- Revoke existing tokens and check service access logs for unauthorized activity.
- Do not wait for tool fixes or issue resolution before rotating compromised secrets.

## Response Expectations

VibeCommit is an open-source project provided as-is without a formal service-level agreement (SLA) or guaranteed response timeline for security disclosures. Reports will be investigated on a best-effort basis.
