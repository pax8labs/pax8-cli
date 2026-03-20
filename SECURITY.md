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
