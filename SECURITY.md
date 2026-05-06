# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 0.x     | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in pax8-cli, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please email **security@pax8.com** with:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You should receive a response within 48 hours. We will work with you to understand the issue and coordinate a fix before any public disclosure.

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

## Claude skill data flow

When a partner uses [`@pax8/claude-skill`](packages/claude-skill) via Claude Code, command output flows to Anthropic via Claude Code as part of the agent loop — i.e. whatever the CLI prints in response to a tool invocation becomes part of the model's context for that turn. This is the normal Claude Code data flow and is governed by Anthropic's policies. Pax8 does not receive or store skill conversations and is not involved in that data path.
