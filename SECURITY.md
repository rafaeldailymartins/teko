# Security Policy

Tekó is an open-source RAG assistant over Brazilian tax legislation. It handles user accounts,
questions that may contain personal data, and calls to third-party LLM providers, so we take
security reports seriously and appreciate coordinated disclosure.

## Reporting a vulnerability

**Do not open a public issue, discussion or pull request for a security problem.**

Report it privately through GitHub's
[private vulnerability reporting](https://github.com/rafaeldailymartins/teko/security/advisories/new)
(repository **Security** tab → **Report a vulnerability**). This is the only supported channel;
the project has no security mailbox.

Please include:

- the affected component (`apps/web`, `apps/api`, `packages/shared`, `infra/`, CI workflows,
  the published corpus) and the version, commit SHA or URL;
- a description of the issue and its impact;
- step-by-step reproduction, a proof of concept, or the exact prompt/document for LLM issues;
- any suggested mitigation.

## Supported versions

Only the **latest minor release** receives security fixes. Older minors are not patched; upgrade
to the latest release instead.

| Version             | Supported                                                   |
| ------------------- | ----------------------------------------------------------- |
| latest `0.x` minor  | yes                                                         |
| any older release   | no                                                          |
| `develop` / staging | fixes land here first, then ship to production via a hotfix |

The project is in early development (phase F1) and has no tagged release yet. Until `v0.1.0`,
reports are handled against the `develop` branch.

## Response targets

| Step                                   | Target                   |
| -------------------------------------- | ------------------------ |
| Acknowledgement                        | within 72 hours          |
| Triage (severity, scope, validity)     | within 7 days            |
| Fix released for **critical** severity | within 14 days of triage |
| Fix released for **high** severity     | within 30 days of triage |
| Medium / low                           | next regular release     |

Severity follows CVSS v4. Fixes for production reach `main` through a `hotfix/vX.Y.Z` branch, and
a GitHub Security Advisory (with a CVE when applicable) is published once the fix is live.

## Scope

In scope:

- **Application security** of `apps/web`, `apps/api` and `packages/shared`: authentication and
  sessions (OAuth, passkeys), authorization, CSRF, XSS (including Markdown/HTML rendering of model
  output), SSRF in the ingestion fetcher, injection, rate-limit or quota bypass.
- **Trust boundaries**: bypassing the signed proxy (`x-nf-sign`), forging or replaying stream
  tickets, spoofing client IP headers, reaching evaluation/test routes outside CI.
- **LLM-specific issues**: direct and indirect **prompt injection** (including instructions planted
  in corpus documents), **data exfiltration via RAG** (leaking other users' data, system prompts,
  secrets or unredacted PII through answers, citations or links), bypass of the PII redactor before
  data reaches LLM or observability providers, and citation spoofing that makes an answer look
  sourced when it is not.
- **Privacy**: anything that breaks the data-retention, export or deletion guarantees described in
  the privacy policy (LGPD).
- **Supply chain and CI**: workflow injection, token over-permission, dependency confusion, tampering
  with release artifacts or attestations.

Out of scope:

- vulnerabilities in third-party services themselves (Netlify, Vercel, Render, Neon, Google, Groq,
  Cloudflare, Langfuse, Sentry, PostHog, GitHub). Report those to the vendor. Misconfiguration of
  those services by this project (for example a Vercel firewall rule or Deployment Protection
  setting that can be bypassed) is in scope;
- the local development stack (`infra/local/`), which uses throwaway secrets and binds to
  `127.0.0.1` only;
- volumetric denial of service, spam, or findings that only consume free-tier quotas;
- reports produced only by automated scanners without a demonstrated impact;
- missing hardening headers or best practices with no exploitable consequence;
- incorrect or outdated legal answers that do not involve an attack. Report those as a corpus error
  issue instead;
- social engineering of maintainers or users, and physical attacks.

**Known limitation:** Trusted Types runs in report-only mode until `v0.2.0`. A report that only
states "Trusted Types is not enforced" is expected behavior; a working DOM XSS is still in scope.

## Testing guidelines

- Prefer the reproducible local stack (see [CONTRIBUTING.md](CONTRIBUTING.md)) for any active
  testing. Do not run automated scanners, load tests or fuzzers against production or staging: the
  project runs on free tiers with hard quotas, and exhausting them takes the service down for
  everyone.
- Use only accounts you own. Never access, modify or delete other users' data; if you reach it by
  accident, stop, do not keep a copy, and tell us in the report.
- Do not exfiltrate secrets beyond what is needed to prove the issue.

## Safe harbor

We will not pursue or support legal action against anyone who, in good faith, follows this policy:
reports privately, avoids privacy violations, data destruction and service disruption, and gives us
reasonable time to fix the issue. If a third party takes legal action against you for research done
under this policy, we will make it known that your activity was authorized by us.

## Coordinated disclosure

We ask for **90 days** from the acknowledgement before public disclosure, or less if a fix ships
earlier. We will coordinate the disclosure date with you and credit you in the advisory unless you
prefer to stay anonymous.
