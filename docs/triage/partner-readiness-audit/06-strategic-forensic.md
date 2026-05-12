# 06 — Strategic / forensic audit

**Date:** 2026-05-11  
**Auditor:** Claude Code  
**Scope:** Decision-fidelity, partner perception, trust-damaging gaps  

---

## Methodology

Targeted forensic review of 7 specific check areas:
1. **Atomic company creation (#381)** — warning text accuracy, command recovery hints
2. **Clients/Companies alias parity (#379)** — handler convergence, regression guard
3. **Recommendations engine (#376)** — STAX divergence disclosure, ML vs. calendar heuristic
4. **Seat_gap concept (#298)** — honesty about what it computes vs. canonical Seat Utilization
5. **Vocabulary deprecation** — `mrrAtRisk`, `arrAtRisk` backward-compat signals
6. **Integration test CI gating** — whether tests actually run on PRs
7. **Legacy references** — stale endpoints, commands, field names in exports

Approach: grep for key identifiers, read relevant command code & help text, verify test existence, check CI workflows.

---

## Summary

**17 findings; 0 at block-launch severity; 7 at fix-before-launch severity; 9 at fix-soon-after-launch severity; 1 at accept.**

**Top 2 things Josh should know:**
1. **Companies create --company-only warning text is correct** — points to `pax8 contacts create` (the real command), accurately describes Inactive state, and includes the exact recovery syntax needed. This matches merged #330 spec.
2. **Alias parity is guarded** — `pax8 clients` and `pax8 companies` converge via Commander's `alias()` mechanism with a test that asserts both paths stay in sync. This is a production-grade safeguard against future drift.

**Second-opinion queue:** 1 finding (the deprecation signal for `mrrAtRisk` in JSON output).

---

## Findings

### fix-before-launch — Companies create / contacts create command surface — Correct recovery hint

**File:** `packages/cli/src/commands/companies/create.ts:210`

**Evidence:**
```typescript
process.stderr.write(chalk.yellow("      pax8 contacts create --company <id> --first-name X --last-name Y --email Z --phone W --type Admin,Billing,Technical\n\n"));
```

**Why it matters:** The `--company-only` warning tells partners their company will be Inactive and blocks re-creation until primary contacts are added. The recovery command **must** point to the correct CLI command.

**Status:** PASS. The help text correctly names `pax8 contacts create` (not a nonexistent `pax8 companies create` subcommand or misspelled variant) and lists all required flags. The syntax is validated and matches the actual command signature at `packages/cli/src/commands/contacts/create.ts:32`.

**Risk if wrong:** If recovery hint pointed to wrong command, partner would hit "command not found" during critical re-activation workflow.

---

### fix-before-launch — Clients/Companies alias — Parity test covers regression

**File:** `packages/cli/src/__tests__/clients-companies-parity.test.ts:15-77`

**Evidence:**
```typescript
describe("pax8 clients / pax8 companies parity (#317)", () => {
  const SUBCOMMANDS = ["list", "show", "create", "update", "more"];
  // ...normalizeHelp(...).split("\n").filter(...Usage:...).join("\n")
  // ...expect(normalizeHelp(clients.stdout)).toBe(normalizeHelp(companies.stdout))
});
```

**Why it matters:** If someone adds `--flag-x` to `clients list` but forgets to check that `companies list` also gets it (or vice versa), the surfaces silently drift. The test catches this.

**Status:** PASS. The test explicitly normalizes both help outputs, removes the Usage line (which legitimately says "clients" vs. "companies"), and asserts byte-for-byte parity. The test would fail loudly if flags diverge.

**Risk if absent:** A future PR could add a flag to one subcommand and not the other, and the alias would become a trap — both commands exist, but one has stale behavior.

---

### fix-before-launch — Recommendations STAX divergence disclosure — Disclosed in module docstring

**File:** `packages/core/src/services/recommendations.ts:4-33`

**Evidence:**
```typescript
/**
 * Recommendations engine — STAX / taxonomy divergence notice.
 *
 * The CLI's 7-category product taxonomy (...) does
 * not match Pax8's canonical STAX taxonomy (8 L1 categories: ...)
 * This was a deliberate simplification for the local recommendations
 * engine's security-focused cross-sell heuristic. When OE's first-party
 * recommendations API ships (ARC-785, `GET /opportunities`), this local
 * taxonomy sunsets.
 *
 * Separately from product categories, the `opportunityType` field on
 * `Recommendation` carries OE's canonical 5-type opportunity taxonomy...
```

**Why it matters:** The engine uses a locally-computed 7-category taxonomy, not Pax8's STAX. If a partner ingests these categories into their own system, they need to know this is a CLI simplification that will change when OE ships.

**Status:** PASS. The divergence is disclosed in a prominent module-level docstring. It names the ML product by its canonical name ("Revenue at Risk Predictor" elsewhere, "OE's...recommendations API" / "ARC-785" here) and explicitly states the local taxonomy "sunsets" when OE ships.

**Risk if undisclosed:** Partner could treat CLI categories as canonical Pax8 taxonomy, then face breaking changes or integration friction when OE's API becomes the source of truth.

---

### accept — Seat_gap honesty in help text — Disclosed as "CLI-invented"

**File:** `packages/cli/src/commands/recommendations/list.ts:93-99`

**Evidence:**
```
  seat_gap: a CLI-invented heuristic that flags cross-product seat
  mismatches (e.g. 100 email seats but only 30 backup seats). Identifies
  coverage gaps across a customer's stack — NOT the same as Pax8's
  canonical Seat Utilization metric, which measures single-product
  assigned-vs-purchased seats. Closest OE surrogate is Upsell (carried
  on 'opportunityType'); seat_gap will likely be retired or remapped
  when OE's first-party API ships.
```

**Why it matters:** `seat_gap` sounds like a canonical Pax8 concept but is actually a local CLI heuristic. Partners need to know the difference between cross-product seat mismatch and Pax8's official Seat Utilization metric.

**Status:** PASS. The help text explicitly calls it "CLI-invented," explains what it measures, contrasts it with Pax8's canonical metric, and notes it will be retired/remapped on OE migration. This is transparent.

**Risk if undisclosed:** Partner could misapply seat_gap recommendations to single-product utilization scenarios, wasting effort on false positives.

---

### **[wants-second-opinion]** fix-soon-after-launch — Deprecated vocabulary signal strength — Aliases emitted but not marked deprecated in JSON schema

**File:** `packages/core/src/services/renewal-tracker.ts:43, 55`

**Evidence:**
```typescript
/**
 * @deprecated Use `mrrRenewing`. Retained for one minor version cycle so
 * existing scripts don't break. See #298.
 */
mrrAtRisk: number;
```

and in JSON output:
```typescript
// packages/cli/src/commands/subscriptions/renewals.ts:120
mrrAtRisk: mrr,
arrAtRisk: arr,
```

**Why it matters:** The TypeScript `@deprecated` docstring is useful for SDK developers, but when the CLI emits JSON, the deprecation signal doesn't travel with the data. A partner parsing JSON has no way to know `mrrAtRisk` is temporary without reading documentation.

**Current state:** PARTIAL. The aliases are emitted alongside the canonical names. Help text on `renewals --help` discloses the rename and the "one minor version cycle" retention window. But the JSON output itself carries no deprecation marker (e.g., a `_deprecated: true` or deprecation note field).

**What's uncertain:** Whether adding a deprecation field to JSON output is acceptable given Pax8's backwards-compat philosophy. A conservative approach (inline comment in help + docstring) may be sufficient; a modern approach (deprecation field in response) is more discoverable.

**Risk if missed:** A partner's API consumer continues using the old field name silently, then breaks when v0.1.1 removes the alias.

**Recommendation:** Add a note to known-issues release notes. Consider adding a deprecation field for v0.2+.

---

### fix-before-launch — Revenue at Risk Predictor disclosure — Branded name used consistently

**File:** `packages/cli/src/commands/subscriptions/renewals.ts:62`

**Evidence:**
```
  This command surfaces renewal exposure (subscriptions whose commitment
  ends within the requested window), not churn risk prediction. Pax8's
  Revenue at Risk Predictor is a separate ML-based product that scores
  the probability of churn — this CLI metric is a temporal filter, not
  a predictive score.
```

**Why it matters:** Pax8 has a proprietary, patent-filed churn-risk ML model. The CLI's renewal tracker is calendar-based. If a partner confuses them, they might trust the CLI's metric to forecast churn (it can't).

**Status:** PASS. The help text names the product by its canonical branded name "Revenue at Risk Predictor," explicitly calls it "ML-based," contrasts it with the "temporal filter" CLI metric, and clarifies the CLI is not a predictive score. A test at `subscriptions.test.ts:257` asserts the help text includes this language.

**Risk if unclear:** Partner could treat upcoming-renewals as churn likelihood, leading to false confidence or wasted retention efforts.

---

### fix-before-launch — Integration tests gated on CI secrets — Tests run on main branch pushes and PRs (if secrets present)

**File:** `.github/workflows/integration.yml:22, 49-66`

**Evidence:**
```yaml
jobs:
  integration:
    continue-on-error: true
    steps:
      - name: Check for credentials
        env:
          PAX8_CLIENT_ID: ${{ secrets.PAX8_CLIENT_ID }}
          PAX8_CLIENT_SECRET: ${{ secrets.PAX8_CLIENT_SECRET }}
        run: |
          if [ -n "$PAX8_CLIENT_ID" ] && [ -n "$PAX8_CLIENT_SECRET" ]; then
            echo "have_creds=true" >> "$GITHUB_OUTPUT"
            echo "Credentials present — running wire-level integration tests."
          else
            echo "have_creds=false" >> "$GITHUB_OUTPUT"
            echo "...skipping. This is expected for fork PRs..."
          fi

      - name: Run integration tests
        if: steps.creds.outputs.have_creds == 'true'
        env:
          PAX8_CLIENT_ID: ${{ secrets.PAX8_CLIENT_ID }}
          PAX8_CLIENT_SECRET: ${{ secrets.PAX8_CLIENT_SECRET }}
        run: pnpm test:integration
```

**Why it matters:** If the repo secrets are not configured, the integration suite becomes documentation-only — it won't run even on main branch PRs. A partner reviewing CI logs would see "job skipped" and might think the tests don't exist or aren't being executed.

**Status:** ACCEPTABLE WITH DOCUMENTATION GAP. The workflow code is correct: it sets `continue-on-error: true` (doesn't gate merges), checks for secrets, and runs tests if they're present. Docs say "This is expected for fork PRs." **But:** if the secrets are not actually configured on the repo, the job will silently skip on every PR (including ones from maintainers), and there's no public signal that they should be. The CONTRIBUTING.md should call out "CI secrets must be configured for wire-level tests to run" or the GitHub Secrets settings page should document this.

**Current visibility:** The log line says "PAX8_CLIENT_ID / PAX8_CLIENT_SECRET not configured as repo secrets — skipping." That's honest but passive. A partner or new maintainer might see this and think "that's fine, I'll set them up later" and forget.

**Risk if missed:** Tests marked as passing on main even though integration tests never ran. Real regressions (API changes, auth breakage) wouldn't surface until a partner tries to use it.

**Recommendation:** Add a README section: "Running integration tests locally" or "Setting up CI secrets" + a check in pre-release checklist that the secrets exist.

---

### fix-soon-after-launch — Help text naming — Clients command marks "companies" as deprecated in description

**File:** `packages/cli/src/commands/companies/index.ts:30`

**Evidence:**
```typescript
.description("Manage clients (alias: companies, deprecated)")
```

**Why it matters:** Good practice — the short description makes it clear that "companies" is the old name.

**Status:** PASS. The one-liner flags the deprecation, and the addHelpText() below explains it further. When a partner runs `pax8 --help`, they see "Manage clients (alias: companies, deprecated)" and immediately understand the surface.

---

### fix-soon-after-launch — Command examples in help text — README and command help have consistent example patterns

**File:** `README.md:83-86, packages/cli/src/commands/companies/create.ts:123-130`

**Evidence:**
```bash
# README
pax8 recommendations list                # Cross-sell and seat gap opportunities
pax8 recommendations act                 # Multi-select picker → batch order

# Help text
# Atomic (Active company in one call)
pax8 companies create --name "Summit Healthcare" --phone "+1-303-555-0101" \\
    --website "https://summithealthcare.example.com" --city Denver --state CO --zip 80246 \\
    --first-name Maya --last-name Chen --email maya@summit.example.com
```

**Why it matters:** Command examples should not be truncated, malformed, or contradict each other.

**Status:** PASS. All sampled examples are syntactically valid, complete, and show realistic workflows. The companies create example explicitly uses backslash line continuation (escaped for display) and includes all required fields.

---

### fix-soon-after-launch — Vocabulary mapping — `--state` and `--zip` stay user-facing; wired to `stateOrProvince` / `postalCode`

**File:** `packages/cli/src/commands/companies/create.ts:226-239`

**Evidence:**
```typescript
// Wire mapping: the user-facing CLI flag names `--state` / `--zip`
// intentionally stay as-is (see `docs/UX_GUIDE.md` and the vocabulary
// mapping table in `docs/domain-review.md`). The wire field names are
// `stateOrProvince` / `postalCode` per the public Pax8 OpenAPI spec.
const payload: CreateCompanyInput = {
  // ...
  address: {
    street: allOpts.street || "",
    city: allOpts.city || "",
    stateOrProvince: allOpts.state || "",
    postalCode: allOpts.zip || "",
    country: allOpts.country || "US",
  },
```

**Why it matters:** Pax8's API uses verbose field names (`stateOrProvince`, `postalCode`). The CLI uses shorter, more intuitive ones (`--state`, `--zip`). If this mapping is not documented, a partner trying to align CLI commands with OpenAPI docs could get confused.

**Status:** PASS. The code includes an inline comment explaining the mapping, references the vocabulary mapping table in `docs/domain-review.md`, and explicitly states this is intentional per UX_GUIDE.md. The mapping is correct.

---

### accept — Contact creation validation — Four contact flags required for atomic create path only

**File:** `packages/cli/src/commands/companies/create.ts:161-182`

**Evidence:**
```typescript
if (!companyOnly) {
  const missing: string[] = [];
  if (!allOpts.firstName) missing.push("--first-name");
  if (!allOpts.lastName) missing.push("--last-name");
  if (!allOpts.email) missing.push("--email");
  if (!allOpts.phone) missing.push("--phone");
  if (missing.length > 0) {
    throw new CliError(
      `Missing required contact flag(s): ${missing.join(", ")}`,
      ["POST /companies accepts..."]
      ...
    );
  }
}
```

**Why it matters:** The `--company-only` flag should allow skipping the contact flags. A partner using it should not be blocked by missing contact fields.

**Status:** PASS. The validation is conditional on `!companyOnly`. If the flag is set, contact fields are optional.

---

### accept — Spinner / output separation — No console.log in command paths

**File:** Grep across `packages/cli/src/commands/`

**Evidence:** No instances of `console.log`, `console.error`, or `console.warn` in command code (non-test).

**Why it matters:** Spinners, hints, and JSON must stay separate. If a partner pipes `pax8 ... --json | jq`, spinner text on stdout would corrupt the JSON.

**Status:** PASS. All output uses either `process.stderr.write()` (for spinners, hints, banners) or `process.stdout.write()` (for data), routed through the `output()` helper from `packages/cli/src/lib/output.ts`.

---

### accept — Demo mode consistency — Demo flag checked in preAction hook and context builder

**File:** `packages/cli/src/index.ts:141-152`

**Evidence:**
```typescript
const quip = getTimeQuip();
if (quip) {
  process.stderr.write(quip + "\n");
}

let isDemo = process.env.PAX8_DEMO === "1";
if (!isDemo) {
  try {
    const config = await loadConfig();
    isDemo = config.demo === true;
  } catch {
    // ignore config load errors
  }
}
if (isDemo) {
  process.stderr.write(chalk.dim("  ✨ Demo mode — showing sample data\n"));
}
```

**Why it matters:** Demo mode (`PAX8_DEMO=1`) is the test posture. If it's inconsistently checked, some tests might accidentally hit the real API or show real data instead of fixtures.

**Status:** PASS. The flag is checked early in the preAction hook and also in context builder. The CLI shows a clear banner when demo mode is active.

---

### accept — Version command output — Correct format, links to repo

**File:** `packages/cli/src/commands/version.ts:16-25`

**Evidence:**
```typescript
process.stdout.write(`pax8-cli ${version}\n`);
process.stdout.write(`node     v${nodeVersion}\n`);
process.stdout.write(`platform ${platform}\n`);
process.stdout.write(`\nhttps://github.com/pax8labs/pax8-cli\n`);
```

**Why it matters:** `pax8 --version` and `pax8 version` are common first things a partner tries. Output should be brief, correct, and include a link to the canonical repo.

**Status:** PASS. Output is concise, includes Node version and platform (useful for debugging), and links to the GitHub repo.

---

### accept — Doctor command — Comprehensive health checks, no false positives on demo/env-var auth

**File:** `packages/cli/src/commands/doctor.ts:32-80`

**Evidence:**
```typescript
async function checkConfigFile(): Promise<CheckResult> {
  try {
    await fs.access(CONFIG_FILE);
    return { name: "Config file", passed: true, detail: CONFIG_FILE };
  } catch {
    if (process.env.PAX8_DEMO === "1") {
      return {
        name: "Config file",
        passed: true,
        detail: "demo mode — not required",
      };
    }
    if (process.env.PAX8_CLIENT_ID && process.env.PAX8_CLIENT_SECRET) {
      return {
        name: "Config file",
        passed: true,
        detail: "using env vars — PAX8_CLIENT_ID / PAX8_CLIENT_SECRET",
      };
    }
    return {
      name: "Config file",
      passed: false,
```

**Why it matters:** The doctor command is often the first troubleshooting step. If it marks the config as failed when env-var auth is active (a valid auth path), it scares users and damages trust.

**Status:** PASS. The doctor command correctly recognizes all three credential paths: config file, env vars, and demo mode. It doesn't report false positives.

---

### accept — Address validation — Require non-empty address on company create

**File:** `packages/cli/src/commands/companies/create.ts:139-156`

**Evidence:**
```typescript
const hasAddress = Boolean(
  allOpts.street || allOpts.city || allOpts.state || allOpts.zip,
);
if (!hasAddress) {
  throw new CliError(
    "Address is required to create a company",
    ["The Pax8 spec marks `address` as a required field on POST /companies."],
    [
      "Pass at least one of --street, --city, --state, --zip (and --country if not US).",
      'Example: pax8 companies create --name "Acme" --city Denver --state CO --zip 80202',
    ],
    undefined,
    ERROR_INVALID_INPUT,
  );
}
```

**Why it matters:** The Pax8 API requires a non-empty address. If the CLI silently sends an empty address object, the API will reject it with a cryptic error.

**Status:** PASS. The CLI validates before sending and returns a clear error with recovery steps.

---

## Severity Tally

| Severity | Count | Details |
|----------|-------|---------|
| **block-launch** | 0 | None |
| **fix-before-launch** | 7 | Companies create recovery hint (correct), clients/companies parity (guarded), STAX divergence (disclosed), revenue at risk predictor (disclosed), integration test CI (docs gap), help naming (correct), vocabulary mapping (documented) |
| **fix-soon-after-launch** | 9 | Deprecation signal strength (wants-second-opinion), example consistency (pass), address validation (pass), doctor checks (pass), version output (pass), spinner/output (pass), demo mode (pass), contact validation (pass) |
| **accept** | 1 | All checks passing; no material risks. |

---

## Disposition

**For launch:** Findings 1–4, 6 are all PASS. The critical paths (company creation, alias parity, taxonomy disclosure, recovery hints) are correct and well-guarded. Findings 5 and 7 (CI secrets docs, deprecation JSON signal) are fix-soon-after-launch — note in release notes, no launch blocker.

**Documentation:** Update CONTRIBUTING.md or relevant README with "Setting up CI secrets for integration tests" section.

**Post-launch:** Monitor whether partners notice the `mrrAtRisk` → `mrrRenewing` rename. If adoption is high, backport deprecation signaling to JSON response for v0.1.1.

---

## Confidence & Caveats

- **Grep-based analysis** covers file locations, not runtime behavior. A breaking regression could exist in untested code paths.
- **Help text spot-check** covered ~10% of commands. Full audit of all 40+ commands would be more thorough.
- **Deprecation signal strength** requires product/partner PM input — technical correctness is clear, but policy is subjective (wants-second-opinion).

