// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCliExpectSuccess, runCliExpectFailure } from "./test-utils.js";

describe("E2E: Contacts workflow — list, show, write commands", () => {
  it("pax8 contacts list requires --company", async () => {
    const result = await runCliExpectFailure(["contacts", "list"]);
    expect(result.stderr).toContain("--company");
  });

  it("pax8 contacts list --company returns JSON when piped", async () => {
    const result = await runCliExpectSuccess([
      "contacts",
      "list",
      "--company",
      "Summit Healthcare Partners",
    ]);
    // #483: wrapped envelope { contacts, page }.
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data.contacts)).toBe(true);
    expect(data.contacts.length).toBeGreaterThan(0);
    const first = data.contacts[0];
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("firstName");
    expect(first).toHaveProperty("lastName");
    expect(first).toHaveProperty("email");
    expect(first).toHaveProperty("types");
    expect(Array.isArray(first.types)).toBe(true);
  });

  it("pax8 contacts list --company filters by company", async () => {
    const result = await runCliExpectSuccess([
      "contacts",
      "list",
      "--company",
      "Summit Healthcare Partners",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    // All returned contacts should share the same companyId
    const companyIds = new Set(
      data.contacts.map((c: { companyId: string }) => c.companyId),
    );
    expect(companyIds.size).toBe(1);
  });

  it("pax8 contacts show returns a single contact object", async () => {
    const list = await runCliExpectSuccess([
      "contacts",
      "list",
      "--company",
      "Summit Healthcare Partners",
      "--json",
    ]);
    const id = JSON.parse(list.stdout).contacts[0].id;

    const result = await runCliExpectSuccess([
      "contacts",
      "show",
      id,
      "--company",
      "Summit Healthcare Partners",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    // `show` returns a single object, not an array (#208)
    expect(Array.isArray(data)).toBe(false);
    expect(data.id).toBe(id);
  });

  it("pax8 contacts show requires --company (nested wire path, #324)", async () => {
    const result = await runCliExpectFailure([
      "contacts",
      "show",
      "contact-summit-001",
    ]);
    expect(result.stderr).toContain("--company");
  });

  it("pax8 contacts show fails for unknown id", async () => {
    const result = await runCliExpectFailure([
      "contacts",
      "show",
      "definitely-not-a-real-contact-id",
      "--company",
      "Summit Healthcare Partners",
    ]);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it("pax8 contacts list --ids-only emits one ID per line", async () => {
    const result = await runCliExpectSuccess([
      "contacts",
      "list",
      "--company",
      "Summit Healthcare Partners",
      "--ids-only",
    ]);
    const lines = result.stdout.trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/^\S+$/);
    }
  });

  it("pax8 contacts list --csv includes the expected columns", async () => {
    const result = await runCliExpectSuccess([
      "contacts",
      "list",
      "--company",
      "Summit Healthcare Partners",
      "--csv",
    ]);
    const header = result.stdout.split("\n")[0].toLowerCase();
    expect(header).toContain("email");
    expect(header).toContain("types");
  });

  it("pax8 contacts create with --yes skips confirmation and returns the new contact", async () => {
    const result = await runCliExpectSuccess([
      "contacts",
      "create",
      "--company",
      "Summit Healthcare Partners",
      "--email",
      "newcontact@example.com",
      "--first-name",
      "New",
      "--last-name",
      "Contact",
      "--phone",
      "555-0123",
      "--type",
      "Technical",
      "--yes",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].firstName).toBe("New");
    expect(data[0].lastName).toBe("Contact");
    expect(data[0].email).toBe("newcontact@example.com");
    // Wire shape per the public spec (#325): array of `{type, primary}` objects.
    expect(data[0].types).toEqual([{ type: "Technical", primary: false }]);
  });

  it("pax8 contacts create rejects an invalid --type", async () => {
    const result = await runCliExpectFailure([
      "contacts",
      "create",
      "--company",
      "Summit Healthcare Partners",
      "--email",
      "x@example.com",
      "--first-name",
      "X",
      "--last-name",
      "Y",
      "--phone",
      "555-0100",
      "--type",
      "Bogus",
      "--yes",
    ]);
    expect(result.stderr.toLowerCase()).toContain("type");
  });

  it("pax8 contacts update with --yes returns the updated contact", async () => {
    const list = await runCliExpectSuccess([
      "contacts",
      "list",
      "--company",
      "Summit Healthcare Partners",
      "--json",
    ]);
    const id = JSON.parse(list.stdout).contacts[0].id;

    const result = await runCliExpectSuccess([
      "contacts",
      "update",
      id,
      "--company",
      "Summit Healthcare Partners",
      "--email",
      "renamed@example.com",
      "--yes",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data[0].id).toBe(id);
    expect(data[0].email).toBe("renamed@example.com");
  });

  it("pax8 contacts update requires --company (nested wire path, #324)", async () => {
    const result = await runCliExpectFailure([
      "contacts",
      "update",
      "contact-summit-001",
      "--email",
      "x@example.com",
      "--yes",
    ]);
    expect(result.stderr).toContain("--company");
  });

  it("pax8 contacts update fails when no fields are provided", async () => {
    const list = await runCliExpectSuccess([
      "contacts",
      "list",
      "--company",
      "Summit Healthcare Partners",
      "--json",
    ]);
    const id = JSON.parse(list.stdout).contacts[0].id;

    const result = await runCliExpectFailure([
      "contacts",
      "update",
      id,
      "--company",
      "Summit Healthcare Partners",
      "--yes",
    ]);
    expect(result.stderr.toLowerCase()).toContain("update");
  });

  it("pax8 contacts delete with --yes confirms by destructive keyword via PAX8_YES", async () => {
    const list = await runCliExpectSuccess([
      "contacts",
      "list",
      "--company",
      "Summit Healthcare Partners",
      "--json",
    ]);
    const id = JSON.parse(list.stdout).contacts[0].id;

    const result = await runCliExpectSuccess([
      "contacts",
      "delete",
      id,
      "--company",
      "Summit Healthcare Partners",
      "--yes",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data[0].id).toBe(id);
    expect(data[0].status).toBe("Deleted");
  });

  it("pax8 contacts delete requires --company (nested wire path, #324)", async () => {
    const result = await runCliExpectFailure([
      "contacts",
      "delete",
      "contact-summit-001",
      "--yes",
    ]);
    expect(result.stderr).toContain("--company");
  });
});
