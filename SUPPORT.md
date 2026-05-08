# Support

Looking for help with `pax8-cli`? Here's where to start.

## Try first

- **`pax8 doctor`** — runs diagnostics on your setup (Node version, credentials, API reachability, config file)
- **`pax8 <command> --help`** — every command documents its flags and gives runnable examples
- **`pax8 --verbose <command>`** — prints the API path and method to stderr; helpful for troubleshooting

## Bug reports and feature requests

File an issue: https://github.com/pax8labs/pax8-cli/issues

The CLI itself can pre-fill a sanitized bug report from the most recent failure:

```bash
pax8 report-bug
```

This redacts UUIDs, emails, paths, and tokens before opening the issue draft.

## Security issues

Don't file public issues for security vulnerabilities. See [SECURITY.md](SECURITY.md) for the disclosure path (security@pax8.com, 48-hour acknowledgment).

## Questions, ideas, troubleshooting

GitHub Discussions: https://github.com/pax8labs/pax8-cli/discussions

(If Discussions isn't enabled yet, file a question-tagged issue and we'll route it.)

## Pax8 marketplace API itself

Bugs in the Pax8 API (not the CLI) belong with the Pax8 developer team. The CLI's `pax8 doctor` will flag if your token can't reach the API at all; for everything else, file with Pax8 support.
