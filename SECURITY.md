# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 0.x     | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in pax8-cli, please report it responsibly through Pax8's Vulnerability Disclosure Program:

**<https://www.pax8.com/en-us/about/vulnerability-disclosure-program/>**

**Do not open a public GitHub issue for security vulnerabilities.**

When submitting, please include:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will work with you to understand the issue and coordinate a fix before any public disclosure.

## Scope

This policy covers the `pax8-cli` tool and its packages (`@pax8/core`, `@pax8/cli`, `@pax8/claude-skill`).

Vulnerabilities in the Pax8 API itself should be reported to Pax8 directly at https://www.pax8.com/en-us/security/.

## Credential Handling

- The CLI stores API credentials in `~/.pax8/credentials.json` with `0600` permissions
- Credentials are never logged, displayed in output, or included in telemetry
- Tokens are cached in memory only and never written to disk
- The `--verbose` flag logs API request URLs and status codes but never request/response bodies

## OAuth scope

Pax8 API credentials carry the full set of permissions associated with the issuing partner account — there is currently no per-scope or read-only credential type at the API level. Treat them as account-equivalent and store them only on machines you trust. To revoke credentials, see <https://app.pax8.com> (Integrations Hub → API Credentials).

## Bulk-export aggregation

Read commands return individual records that are individually low-to-medium
sensitivity, but bulk iteration (e.g., `contacts list` × `companies list`,
`invoices items` × `orders show` across the partner's full book) can compose
a higher-sensitivity dataset (Tier 3 PII + Tier 2 transaction history). This
is inherent to the public Pax8 API, not a CLI-specific concern, but partners
aggregating output should treat stored CLI output (logs, scripts, dashboards)
accordingly.

## Webhook secrets

The webhook HMAC signing secret (`secret` field, `whsec_…` prefix) is the
key partners use to verify the authenticity of incoming webhook payloads.
It is classified Tier 0 (Existential) under Pax8's Marketplace & Platform
Data Risk Tiering standard.

Following the industry-standard pattern (Stripe, GitHub, Twilio), the CLI
displays the secret **exactly once**, on `pax8 webhooks create`, accompanied
by a "save this now" warning. Read-path commands (`webhooks show`,
`webhooks list`, `webhooks logs`) strip the field from output even if the
upstream API returns it. Partners who lose the secret should rotate via the
webhook update flow rather than relying on the read path.

## Claude skill data flow

When a partner uses [`@pax8/claude-skill`](packages/claude-skill) via Claude Code, command output flows to Anthropic via Claude Code as part of the agent loop — i.e. whatever the CLI prints in response to a tool invocation becomes part of the model's context for that turn. This is the normal Claude Code data flow and is governed by Anthropic's policies. Pax8 does not receive or store skill conversations and is not involved in that data path.
