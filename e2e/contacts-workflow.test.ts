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
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    const first = data[0];
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
    const companyIds = new Set(data.map((c: { companyId: string }) => c.companyId));
    expect(companyIds.size).toBe(1);
  });

  it("pax8 contacts show returns a single contact as JSON array", async () => {
    const list = await runCliExpectSuccess([
      "contacts",
      "list",
      "--company",
      "Summit Healthcare Partners",
      "--json",
    ]);
    const id = JSON.parse(list.stdout)[0].id;

    const result = await runCliExpectSuccess(["contacts", "show", id, "--json"]);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe(id);
  });

  it("pax8 contacts show fails for unknown id", async () => {
    const result = await runCliExpectFailure([
      "contacts",
      "show",
      "definitely-not-a-real-contact-id",
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
    expect(data[0].types).toEqual(["Technical"]);
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
    const id = JSON.parse(list.stdout)[0].id;

    const result = await runCliExpectSuccess([
      "contacts",
      "update",
      id,
      "--email",
      "renamed@example.com",
      "--yes",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data[0].id).toBe(id);
    expect(data[0].email).toBe("renamed@example.com");
  });

  it("pax8 contacts update fails when no fields are provided", async () => {
    const list = await runCliExpectSuccess([
      "contacts",
      "list",
      "--company",
      "Summit Healthcare Partners",
      "--json",
    ]);
    const id = JSON.parse(list.stdout)[0].id;

    const result = await runCliExpectFailure(["contacts", "update", id, "--yes"]);
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
    const id = JSON.parse(list.stdout)[0].id;

    const result = await runCliExpectSuccess([
      "contacts",
      "delete",
      id,
      "--yes",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data[0].id).toBe(id);
    expect(data[0].status).toBe("Deleted");
  });
});
