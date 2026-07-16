# @pax8/psa

Read-only PSA reconciliation helpers for the Pax8 CLI.

This package is an integration scaffold for `pax8 invoices audit --psa connectwise`. It defines the provider interface, local mapping shape, demo provider, and classification/summary logic used by the CLI. Live ConnectWise fetching is intentionally not implemented yet; `ConnectWiseProvider.getAddition()` validates credentials and then throws until the live read-only API adapter is wired in.

## Safety contract

- Read-only only: no PSA write commands or mutation helpers live here.
- Local-only mappings: Pax8 company/product IDs are joined to PSA agreement/addition refs through the local mappings file used by the CLI.
- Missing mappings are surfaced as `unmapped` with dollar impact instead of being silently skipped.

## ConnectWise credentials

The CLI reads ConnectWise credentials from persisted config and environment variables. Environment variables win so CI, secret managers, and one-off runs can override local config without editing `~/.pax8/config.json`:

- `PAX8_PSA_CONNECTWISE_BASE_URL`
- `PAX8_PSA_CONNECTWISE_COMPANY_ID`
- `PAX8_PSA_CONNECTWISE_PUBLIC_KEY`
- `PAX8_PSA_CONNECTWISE_PRIVATE_KEY`
- `PAX8_PSA_CONNECTWISE_CLIENT_ID`

Non-PSA commands do not require this config. Credentials are validated only when a PSA provider is selected.
