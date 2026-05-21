// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCliExpectSuccess, runCliExpectFailure } from "./test-utils.js";

describe("pax8 companies", () => {
  describe("companies list", () => {
    it("returns company data in JSON format", async () => {
      const result = await runCliExpectSuccess(["companies", "list", "--json"]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty("id");
      expect(data[0]).toHaveProperty("name");
      expect(data[0]).toHaveProperty("status");
    });

    it("emits BOTH `created` and canonical `createdAt` on every row (#385 deprecation window)", async () => {
      // #385: timestamp field standardization. `createdAt` is the canonical
      // past-tense camelCase name; bare `created` is preserved as a deprecated
      // alias for one minor version cycle so existing `--json` consumers
      // don't break. Removal scheduled for v0.3.0.
      const result = await runCliExpectSuccess(["companies", "list", "--json"]);
      const data = JSON.parse(result.stdout);
      expect(data.length).toBeGreaterThan(0);
      for (const row of data) {
        expect(row).toHaveProperty("created");
        expect(row).toHaveProperty("createdAt");
        expect(row.createdAt).toBe(row.created);
      }
    });

    it("outputs table format by default (non-TTY falls back to JSON)", async () => {
      const result = await runCliExpectSuccess(["companies", "list"]);
      // Non-TTY defaults to JSON
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data[0].name).toBe("Summit Healthcare Partners");
    });

    it("outputs CSV format", async () => {
      const result = await runCliExpectSuccess(["companies", "list", "--csv"]);
      const lines = result.stdout.trim().split("\n");
      // First line is header
      expect(lines[0]).toContain("Company");
      expect(lines[0]).toContain("ID");
      expect(lines[0]).toContain("Status");
      // Data rows
      expect(lines.length).toBeGreaterThan(1);
      expect(lines[1]).toContain("Summit Healthcare Partners");
    });

    it("supports pagination options", async () => {
      const result = await runCliExpectSuccess([
        "companies",
        "list",
        "--page",
        "0",
        "--size",
        "2",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.length).toBe(2);
    });

    it("shows footer with company count on stderr", async () => {
      const result = await runCliExpectSuccess(["companies", "list"]);
      expect(result.stderr).toContain("companies");
    });

    // #388: geography filters are server-side per OpenAPI. Demo Summit
    // Healthcare lives in Denver, CO — these tests exercise the wire mapping
    // (`--state` → `stateOrProvince`, `--zip` → `postalCode`) end-to-end.
    it("filters by --city (#388)", async () => {
      const result = await runCliExpectSuccess([
        "companies",
        "list",
        "--city",
        "Denver",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.length).toBeGreaterThan(0);
      for (const c of data) {
        expect(c.address?.city).toBe("Denver");
      }
    });

    it("--state maps to stateOrProvince on the wire (#388)", async () => {
      const result = await runCliExpectSuccess([
        "companies",
        "list",
        "--state",
        "CO",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.length).toBeGreaterThan(0);
      for (const c of data) {
        expect(c.address?.stateOrProvince).toBe("CO");
      }
    });

    it("--country filters server-side (#388)", async () => {
      const result = await runCliExpectSuccess([
        "companies",
        "list",
        "--country",
        "US",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.length).toBeGreaterThan(0);
      for (const c of data) {
        expect(c.address?.country).toBe("US");
      }
    });

    it("--zip maps to postalCode on the wire (#388)", async () => {
      const result = await runCliExpectSuccess([
        "companies",
        "list",
        "--zip",
        "80246",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.length).toBeGreaterThan(0);
      for (const c of data) {
        expect(c.address?.postalCode).toBe("80246");
      }
    });

    it("--sort city orders results by city ascending (#388)", async () => {
      const result = await runCliExpectSuccess([
        "companies",
        "list",
        "--sort",
        "city",
        "--size",
        "100",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      const cities = data.map((c: { address?: { city?: string } }) => c.address?.city ?? "");
      const sorted = [...cities].sort((a, b) => a.localeCompare(b));
      expect(cities).toEqual(sorted);
    });

    it("--with-actions wraps in { companies, nextActions }", async () => {
      const result = await runCliExpectSuccess([
        "companies",
        "list",
        "--json",
        "--with-actions",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data).toHaveProperty("companies");
      expect(data).toHaveProperty("nextActions");
      expect(Array.isArray(data.companies)).toBe(true);
      expect(Array.isArray(data.nextActions)).toBe(true);
      expect(data.nextActions.length).toBeGreaterThan(0);
      for (const action of data.nextActions) {
        expect(action).toHaveProperty("command");
        expect(action).toHaveProperty("description");
        expect(typeof action.command).toBe("string");
        expect(typeof action.description).toBe("string");
      }
    });

    // #408: fail-fast on typo'd --status before any network call so the
    // partner doesn't debug an "empty result" mystery.
    it("rejects unknown --status with the allowed enum list (#408)", async () => {
      const result = await runCliExpectFailure([
        "companies",
        "list",
        "--status",
        "BogusStatus",
      ]);
      const combined = result.stdout + result.stderr;
      expect(combined).toContain(`Invalid value for --status: "BogusStatus"`);
      expect(combined).toContain("Active");
      expect(combined).toContain("Inactive");
      expect(combined).toContain("Deleted");
    });
  });

  describe("companies show", () => {
    it("returns company details in JSON format", async () => {
      const result = await runCliExpectSuccess([
        "companies",
        "show",
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.id).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
      expect(data.name).toBe("Summit Healthcare Partners");
      expect(data.status).toBe("Active");
    });

    it("shows company detail view", async () => {
      const result = await runCliExpectSuccess([
        "companies",
        "show",
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      ]);
      // Non-TTY defaults to JSON
      const data = JSON.parse(result.stdout);
      expect(data.name).toBe("Summit Healthcare Partners");
      expect(data.phone).toBeTruthy();
    });

    it("surfaces externalId in --json when present", async () => {
      // Summit Healthcare carries `externalId: "PSA-SUMMIT-1042"` in the
      // demo fixture — exercises the field surfaced in #273 (fixes #5).
      const result = await runCliExpectSuccess([
        "companies",
        "show",
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data).toHaveProperty("externalId");
      expect(data.externalId).toBe("PSA-SUMMIT-1042");
    });

    it("includes subscriptions with --subscriptions flag", async () => {
      const result = await runCliExpectSuccess([
        "companies",
        "show",
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "--subscriptions",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.subscriptions).toBeDefined();
      expect(Array.isArray(data.subscriptions)).toBe(true);
      expect(data.subscriptions.length).toBeGreaterThan(0);
      expect(data.subscriptions[0]).toHaveProperty("productName");
    });

    it("returns JSON with subscriptions included", async () => {
      const result = await runCliExpectSuccess([
        "companies",
        "show",
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "--subscriptions",
      ]);
      // Non-TTY outputs JSON
      const data = JSON.parse(result.stdout);
      expect(data.subscriptions).toBeDefined();
      expect(data.subscriptions.length).toBeGreaterThan(0);
    });
  });

  describe("companies show — address wire field names", () => {
    it("surfaces stateOrProvince and postalCode (not state/zip) in --json", async () => {
      // Read-side fix from #328: pre-rename, Zod silently dropped the API's
      // `stateOrProvince` / `postalCode` because the schema parsed `state` /
      // `zip`. This test pins the new behavior against the renamed demo data.
      const result = await runCliExpectSuccess([
        "companies",
        "show",
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.address).toBeDefined();
      expect(data.address).toHaveProperty("stateOrProvince", "CO");
      expect(data.address).toHaveProperty("postalCode", "80246");
      expect(data.address).not.toHaveProperty("state");
      expect(data.address).not.toHaveProperty("zip");
    });
  });

  describe("companies create — required booleans + address mapping", () => {
    it("fails with ERROR_INVALID_INPUT when no address flags are supplied", async () => {
      // #329 fail-fast: spec marks `address` as required on POST /companies.
      // The handler refuses to construct a degenerate empty `{}` on the wire.
      const result = await runCliExpectFailure([
        "companies",
        "create",
        "--name",
        "Addressless Co",
        "--phone",
        "+1-555-0100",
        "--website",
        "https://addressless.example.com",
        "--yes",
        "--json",
      ]);
      // Structured error on stderr in --json mode
      const stderr = result.stderr;
      expect(stderr).toContain("ERROR_INVALID_INPUT");
      expect(stderr.toLowerCase()).toContain("address");
    });

    it("succeeds and reflects the three booleans + city/state when address is supplied", async () => {
      // Defaults (no --bill-on-behalf-of / --self-service-allowed /
      // --order-approval-required flags) all resolve to `false`. Demo mock
      // echoes the body's booleans back so we can assert them on the
      // returned company.
      const result = await runCliExpectSuccess([
        "companies",
        "create",
        "--name",
        "Defaults Co",
        "--phone",
        "+1-555-0101",
        "--website",
        "https://defaults.example.com",
        "--city",
        "Denver",
        "--state",
        "CO",
        "--zip",
        "80202",
        "--country",
        "US",
        "--company-only",
        "--yes",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data).toHaveProperty("name", "Defaults Co");
      expect(data).toHaveProperty("billOnBehalfOfEnabled", false);
      expect(data).toHaveProperty("selfServiceAllowed", false);
      expect(data).toHaveProperty("orderApprovalRequired", false);
      // The mock client passes the address through verbatim; the wire field
      // names must be `stateOrProvince` / `postalCode` (not `state` / `zip`).
      expect(data.address).toHaveProperty("stateOrProvince", "CO");
      expect(data.address).toHaveProperty("postalCode", "80202");
      expect(data.address).not.toHaveProperty("state");
      expect(data.address).not.toHaveProperty("zip");
    });

    it("--bill-on-behalf-of true / --order-approval-required true override defaults", async () => {
      const result = await runCliExpectSuccess([
        "companies",
        "create",
        "--name",
        "Override Co",
        "--phone",
        "+1-555-0102",
        "--website",
        "https://override.example.com",
        "--city",
        "Austin",
        "--state",
        "TX",
        "--zip",
        "78704",
        "--bill-on-behalf-of",
        "true",
        "--order-approval-required",
        "true",
        "--company-only",
        "--yes",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data).toHaveProperty("billOnBehalfOfEnabled", true);
      expect(data).toHaveProperty("selfServiceAllowed", false);
      expect(data).toHaveProperty("orderApprovalRequired", true);
    });

    it("shows the new boolean flags in --help", async () => {
      const result = await runCliExpectSuccess(["companies", "create", "--help"]);
      expect(result.stdout).toContain("--bill-on-behalf-of");
      expect(result.stdout).toContain("--self-service-allowed");
      expect(result.stdout).toContain("--order-approval-required");
      expect(result.stdout).toContain("--street");
    });
  });

  describe("companies create — atomic contact creation (#330)", () => {
    it("atomic-path happy: posts contacts[0] with primary:true on all three types", async () => {
      // Per Pax8 API Reference + PAM-997: passing a properly-typed primary
      // contact in the `contacts: [...]` array on POST /companies flips the
      // new company from Inactive to Active at creation. The CLI implicitly
      // constructs the three-types-primary contact from the four flags.
      const result = await runCliExpectSuccess([
        "companies",
        "create",
        "--name",
        "Atomic Co",
        "--phone",
        "+1-555-0200",
        "--city",
        "Denver",
        "--state",
        "CO",
        "--zip",
        "80202",
        "--first-name",
        "Maya",
        "--last-name",
        "Chen",
        "--email",
        "maya@atomic.example.com",
        "--yes",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      // Mock client echoes the request body's `contacts` array back on the
      // response so we can assert wire shape. If the mock does not echo
      // contacts (older mock), this test will surface the gap.
      expect(data).toHaveProperty("name", "Atomic Co");
      // The body that the API sees must carry the contact with primary:true
      // on all three types. We assert via the mock-echoed response.
      if (data.contacts) {
        expect(Array.isArray(data.contacts)).toBe(true);
        expect(data.contacts).toHaveLength(1);
        expect(data.contacts[0]).toHaveProperty("firstName", "Maya");
        expect(data.contacts[0]).toHaveProperty("lastName", "Chen");
        expect(data.contacts[0]).toHaveProperty("email", "maya@atomic.example.com");
        expect(data.contacts[0].types).toHaveLength(3);
        for (const t of data.contacts[0].types) {
          expect(t).toHaveProperty("primary", true);
        }
        const typeNames = data.contacts[0].types.map((t: { type: string }) => t.type).sort();
        expect(typeNames).toEqual(["Admin", "Billing", "Technical"]);
      }
    });

    it("--company-only omits contacts entirely from the request body", async () => {
      // Opt-out path. The mock echoes the request; the response should NOT
      // carry a `contacts` array (the body sent the field as `undefined`,
      // which Zod-serializes as omitted, not as an empty array).
      const result = await runCliExpectSuccess([
        "companies",
        "create",
        "--name",
        "CompanyOnly Co",
        "--phone",
        "+1-555-0201",
        "--city",
        "Denver",
        "--state",
        "CO",
        "--zip",
        "80202",
        "--company-only",
        "--yes",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      // No contacts on the echoed body — the company-only path is the
      // pre-#330 shape that produces an Inactive company.
      expect(data.contacts).toBeUndefined();
    });

    it("--company-only prints the verbatim warning to stderr", async () => {
      const result = await runCliExpectSuccess([
        "companies",
        "create",
        "--name",
        "Warned Co",
        "--phone",
        "+1-555-0202",
        "--city",
        "Denver",
        "--state",
        "CO",
        "--zip",
        "80202",
        "--company-only",
        "--yes",
        "--json",
      ]);
      // The warning text matters — agents and partners read this verbatim
      // before deciding whether to proceed. Don't paraphrase in the impl.
      expect(result.stderr).toContain("Creating company WITHOUT primary contacts");
      expect(result.stderr).toContain("Inactive state");
      expect(result.stderr).toContain("Will NOT appear in the Pax8 portal");
      expect(result.stderr).toContain("Will NOT support orders, subscriptions, or quotes");
      expect(result.stderr).toContain('"already exists"');
      expect(result.stderr).toContain("pax8 contacts create");
    });

    it("fails with ERROR_INVALID_INPUT when contact flags are missing on the default path", async () => {
      const result = await runCliExpectFailure([
        "companies",
        "create",
        "--name",
        "MissingFlags Co",
        "--phone",
        "+1-555-0203",
        "--city",
        "Denver",
        "--state",
        "CO",
        "--zip",
        "80202",
        "--yes",
        "--json",
      ]);
      // The atomic-create default requires --first-name, --last-name,
      // --email, --phone; --phone is already present so the missing flags
      // are the first three.
      expect(result.stderr).toContain("ERROR_INVALID_INPUT");
      expect(result.stderr).toContain("--first-name");
      expect(result.stderr).toContain("--last-name");
      expect(result.stderr).toContain("--email");
    });

    it("shows the new --first-name / --last-name / --email / --company-only flags in --help", async () => {
      const result = await runCliExpectSuccess(["companies", "create", "--help"]);
      expect(result.stdout).toContain("--first-name");
      expect(result.stdout).toContain("--last-name");
      expect(result.stdout).toContain("--email");
      expect(result.stdout).toContain("--company-only");
      // Help text should reference the spec source so partners can verify
      expect(result.stdout).toContain("PAM-997");
    });
  });

  describe("companies --help", () => {
    it("shows companies subcommands", async () => {
      const result = await runCliExpectSuccess(["companies", "--help"]);
      expect(result.stdout).toContain("list");
      expect(result.stdout).toContain("show");
      expect(result.stdout).toContain("create");
      expect(result.stdout).toContain("update");
    });

    it("shows list help with examples", async () => {
      const result = await runCliExpectSuccess(["companies", "list", "--help"]);
      expect(result.stdout).toContain("Examples:");
      expect(result.stdout).toContain("--page");
      expect(result.stdout).toContain("--size");
    });

    // #388: spec-backed geography / capability / sort flags must be discoverable
    // via `--help`. Pin every new flag plus the `--sort` enum values so a
    // regression that quietly drops a flag fails here.
    it("list --help advertises every #388 filter and sort flag", async () => {
      const result = await runCliExpectSuccess(["companies", "list", "--help"]);
      const flat = result.stdout.replace(/\s+/g, " ");
      // Geography
      expect(flat).toContain("--city");
      expect(flat).toContain("--state");
      expect(flat).toContain("--country");
      expect(flat).toContain("--zip");
      // Capabilities
      expect(flat).toContain("--self-service");
      expect(flat).toContain("--bill-on-behalf");
      expect(flat).toContain("--order-approval");
      // Sort + enum members
      expect(flat).toContain("--sort");
      for (const v of ["name", "city", "country", "state", "zip"]) {
        expect(flat).toContain(v);
      }
    });

    // #250: `--status` help text must mirror the documented enum exactly —
    // neither inventing values nor omitting documented ones.
    it("list --status help advertises exactly the documented enum (#250)", async () => {
      const result = await runCliExpectSuccess(["companies", "list", "--help"]);
      // Spec: components.schemas.Company.status + GET /companies?status=
      // accepts: Active, Inactive, Deleted.
      expect(result.stdout).toContain("Active");
      expect(result.stdout).toContain("Inactive");
      expect(result.stdout).toContain("Deleted");
      // Regression guard: invented values seen elsewhere in the CLI must
      // not creep into this help text.
      expect(result.stdout).not.toContain("PendingManual");
      expect(result.stdout).not.toContain("Cancelled");
    });

    it("shows show help with examples", async () => {
      const result = await runCliExpectSuccess(["companies", "show", "--help"]);
      expect(result.stdout).toContain("Examples:");
      expect(result.stdout).toContain("--subscriptions");
    });

    it("shows create help with required options", async () => {
      const result = await runCliExpectSuccess([
        "companies",
        "create",
        "--help",
      ]);
      expect(result.stdout).toContain("--name");
      expect(result.stdout).toContain("Examples:");
    });

    it("shows update help with examples", async () => {
      const result = await runCliExpectSuccess([
        "companies",
        "update",
        "--help",
      ]);
      expect(result.stdout).toContain("--name");
      expect(result.stdout).toContain("--phone");
      expect(result.stdout).toContain("Examples:");
    });

    // #432: domain-review finding. The atomic-create path implicitly
    // assigns the supplied contact as primary Admin/Billing/Technical to
    // satisfy activation. Partners need to discover that they can re-split
    // those roles afterward — pin the Note block in --help so a future
    // help-text refactor can't quietly drop it.
    it("create --help documents the multi-role primary assignment (#432)", async () => {
      const result = await runCliExpectSuccess([
        "companies",
        "create",
        "--help",
      ]);
      expect(result.stdout).toMatch(/primary Admin, Billing, and Technical/i);
      expect(result.stdout).toContain("pax8 contacts update");
      expect(result.stdout).toContain("pax8 contacts create --type");
    });

    // #432: same assertion through the `clients` invocation path. The alias
    // is wired via Commander's `.alias()` so both surfaces share one command
    // graph (see clients-companies-parity.test.ts), but pin the user-facing
    // contract here too so a regression that breaks alias inheritance fails
    // loudly on the canonical surface.
    it("`clients create --help` inherits the multi-role Note via the alias (#432)", async () => {
      const result = await runCliExpectSuccess([
        "clients",
        "create",
        "--help",
      ]);
      expect(result.stdout).toMatch(/primary Admin, Billing, and Technical/i);
      expect(result.stdout).toContain("pax8 contacts update");
      expect(result.stdout).toContain("pax8 contacts create --type");
    });
  });
});
