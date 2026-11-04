# Homebrew distribution

This directory automates publishing a Homebrew formula so partners can install
and upgrade the CLI with `brew`:

```bash
brew install pax8labs/tap/pax8
brew upgrade pax8
```

`pax8 upgrade` detects a Homebrew install and runs `brew upgrade pax8` for you.

## How it works

- **`generate-formula.mjs`** — fetches a published `@pax8/cli` version's tarball
  from the npm registry, computes its sha256, and writes `pax8.rb`. Zero
  dependencies. Run `node packaging/homebrew/generate-formula.mjs [version]`
  (defaults to the `latest` dist-tag).
- **`pax8.rb`** — the generated formula, checked in as a reference so it can be
  `brew audit`-ed in review. The authoritative copy lives in the tap repo; this
  one is regenerated on every release.
- **`.github/workflows/homebrew.yml`** — on each `@pax8/cli@<version>` tag push
  (the tag changesets creates when it publishes to npm), regenerates the formula
  and commits it to the tap repo.

The formula is Node-based (`depends_on "node"`, installs the npm package into
`libexec`). This matches how the CLI is already distributed. A future option is
a standalone compiled binary (e.g. `node --experimental-sea` or `bun build
--compile`) with a bottle per platform — more work, no Node dependency for the
end user. Not done here.

## One-time bootstrap (required before `brew install` works)

1. **Create the tap repo** `pax8labs/homebrew-tap` (public). Homebrew maps
   `brew install pax8labs/tap/pax8` to the `homebrew-tap` repo's
   `Formula/pax8.rb`.

2. **Seed the first formula** so the tap installs before the next release:

   ```bash
   node packaging/homebrew/generate-formula.mjs            # writes pax8.rb for latest
   # copy pax8.rb → homebrew-tap/Formula/pax8.rb, commit, push
   ```

3. **Add the `HOMEBREW_TAP_TOKEN` secret** to this repo (Settings → Secrets →
   Actions). Use a fine-grained PAT scoped to `pax8labs/homebrew-tap` with
   **Contents: read and write**. The release workflow uses it to push the
   updated formula on each version.

4. **Audit before announcing:**

   ```bash
   brew install --build-from-source ./packaging/homebrew/pax8.rb
   brew audit --strict --formula pax8labs/tap/pax8
   pax8 version
   ```

After bootstrap, every release auto-updates the tap and no manual step is
needed.
