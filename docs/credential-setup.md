# Pax8 API Credential Setup Guide

This guide walks you through getting API credentials from Pax8 and configuring the CLI.

## Prerequisites

- A Pax8 partner account
- API access enabled on your account (contact your Pax8 account manager if unsure)
- Node.js 18+ and the CLI installed (`npm install -g @pax8/cli`)

## Step 1: Get your API credentials

1. Log in to the Pax8 Command Console at [https://app.pax8.com](https://app.pax8.com)
2. Navigate to **Developer** > **Integrations Hub**
3. Click **Create Integration** (or **New Application**)
4. Give your integration a name (e.g., "pax8-cli")
5. After creation, you will see two values:
   - **Client ID** — a long alphanumeric string
   - **Client Secret** — shown once at creation; copy it immediately

> **Important:** The Client Secret is only displayed once. If you lose it, you will need to generate a new one.

## Step 2: Configure the CLI

Choose one of three methods depending on your use case.

### Option A: Interactive login (recommended for local use)

```bash
pax8 auth login --client-id <your-client-id> --client-secret <your-client-secret>
```

This validates your credentials against the Pax8 API and stores them locally in `~/.pax8/credentials.json` with restricted file permissions (owner read/write only).

### Option B: Environment variables (recommended for CI/CD and scripts)

```bash
export PAX8_CLIENT_ID=your-client-id
export PAX8_CLIENT_SECRET=your-client-secret
```

Then run any command normally:

```bash
pax8 auth login    # validates and saves
pax8 status        # works directly — env vars are checked first
```

Environment variables take priority over the stored credentials file, so you can use them to temporarily override saved credentials. A copy-pasteable starter for these (and the optional `PAX8_API_BASE` / `PAX8_DEMO` toggles) is in [`.env.example`](../.env.example) at the repo root.

To point the CLI at a sandbox or staging environment, also set `PAX8_API_BASE`:

```bash
export PAX8_API_BASE=https://staging-api.pax8.com/v1/
pax8 doctor   # surfaces the active API base in its output
```

**PowerShell:**

```powershell
$env:PAX8_CLIENT_ID = "your-client-id"
$env:PAX8_CLIENT_SECRET = "your-client-secret"
pax8 status
```

### Option C: Direct file (advanced)

Manually create `~/.pax8/credentials.json`:

```json
{
  "clientId": "your-client-id",
  "clientSecret": "your-client-secret"
}
```

Make sure to restrict permissions:

```bash
chmod 600 ~/.pax8/credentials.json
```

## Step 3: Verify your setup

Run the auth status check:

```bash
pax8 auth status
```

You should see:

```
  ✓ Authenticated
  Client ID: abcd…wxyz
  Secret: ••••••••
```

Then run the full diagnostics:

```bash
pax8 doctor
```

This checks your Node.js version, authentication, API connectivity (all 5 endpoints), cache, and more.

## Troubleshooting

### "Missing credentials" or "Both --client-id and --client-secret are required"

You need to provide both the Client ID and Client Secret. Double-check that:
- Both values are provided (not just one)
- There are no extra spaces or line breaks in the values
- If using env vars, they are exported in the current shell session

### "Authentication failed" or "Invalid client credentials"

- Verify the Client ID and Client Secret are correct (copy-paste from the Integrations Hub)
- Confirm API access is enabled on your Pax8 partner account
- Check that the integration has not been deactivated in the Integrations Hub

### "Failed to connect to Pax8 auth server"

- Check your internet connection
- Verify that `https://api.pax8.com` is reachable from your network
- If behind a corporate proxy, ensure it allows outbound HTTPS to `api.pax8.com`

### Token expiration

Tokens are cached for up to 23 hours and refreshed automatically. If you encounter auth errors after a long period, simply run any command again and the CLI will fetch a new token. If problems persist:

```bash
pax8 auth logout
pax8 auth login --client-id <id> --client-secret <secret>
```

### Rate limiting

The Pax8 API allows 1,000 requests per minute. Under normal CLI usage you will not hit this limit. If you are scripting bulk operations, add small delays between calls.

## Security best practices

- **Never commit credentials** to version control. Add `credentials.json` to your `.gitignore`.
- **Use environment variables in CI/CD** rather than storing secrets in files on shared runners.
- **Restrict file permissions** on `~/.pax8/credentials.json`. The CLI sets `chmod 600` automatically when saving, but verify if you create the file manually.
- **Rotate secrets periodically** by generating a new Client Secret in the Integrations Hub and re-running `pax8 auth login`.
- **Use `pax8 auth logout`** to clear stored credentials when you no longer need them on a machine.

## Credential lookup order

The CLI checks for credentials in this order:

1. **Environment variables** (`PAX8_CLIENT_ID` + `PAX8_CLIENT_SECRET`)
2. **Credentials file** (`~/.pax8/credentials.json`)

The first source that provides both values wins.
