// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from "vitest";
import { resolveCommitmentTermId } from "./resolve-commitment.js";
import type { CommandContext } from "./context.js";

const COMPANY_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const PRODUCT_A = "f0000000-0000-0000-0000-000000000001";
const PRODUCT_B = "f0000000-0000-0000-0000-000000000002";

interface SubFixture {
  id?: string;
  productId: string;
  commitment?: { id: string; term?: string };
}

function makeMockCtx(subs: SubFixture[]) {
  const list = vi.fn().mockResolvedValue({ content: subs });
  return {
    api: {
      subscriptions: { list },
    },
    isDemo: true,
    outputFormat: "json",
  } as unknown as CommandContext;
}

describe("resolveCommitmentTermId", () => {
  it("returns the commitment id+term of a matching active subscription", async () => {
    const ctx = makeMockCtx([
      {
        id: "sub-1",
        productId: PRODUCT_A,
        commitment: { id: "commit-aaaa", term: "1-Year" },
      },
    ]);

    const result = await resolveCommitmentTermId(ctx, COMPANY_ID, PRODUCT_A);
    expect(result).toEqual({ id: "commit-aaaa", term: "1-Year" });
  });

  it("returns null when no subscription matches the productId", async () => {
    const ctx = makeMockCtx([
      {
        id: "sub-1",
        productId: PRODUCT_B,
        commitment: { id: "commit-other", term: "Monthly" },
      },
    ]);

    const result = await resolveCommitmentTermId(ctx, COMPANY_ID, PRODUCT_A);
    expect(result).toBeNull();
  });

  it("returns null when matching subscription has no commitment.id", async () => {
    const ctx = makeMockCtx([
      { id: "sub-1", productId: PRODUCT_A /* no commitment */ },
    ]);

    const result = await resolveCommitmentTermId(ctx, COMPANY_ID, PRODUCT_A);
    expect(result).toBeNull();
  });

  it("with multiple matches and no preferredTerm: picks the first", async () => {
    const ctx = makeMockCtx([
      {
        id: "sub-1",
        productId: PRODUCT_A,
        commitment: { id: "commit-first", term: "Monthly" },
      },
      {
        id: "sub-2",
        productId: PRODUCT_A,
        commitment: { id: "commit-second", term: "1-Year" },
      },
    ]);

    const result = await resolveCommitmentTermId(ctx, COMPANY_ID, PRODUCT_A);
    expect(result).toEqual({ id: "commit-first", term: "Monthly" });
  });

  it("with preferredTerm: prefers a sub whose commitment.term matches", async () => {
    const ctx = makeMockCtx([
      {
        id: "sub-1",
        productId: PRODUCT_A,
        commitment: { id: "commit-monthly", term: "Monthly" },
      },
      {
        id: "sub-2",
        productId: PRODUCT_A,
        commitment: { id: "commit-annual", term: "1-Year" },
      },
    ]);

    const result = await resolveCommitmentTermId(ctx, COMPANY_ID, PRODUCT_A, "1-Year");
    expect(result).toEqual({ id: "commit-annual", term: "1-Year" });
  });

  it("with preferredTerm but no exact term match: falls back to first product match", async () => {
    const ctx = makeMockCtx([
      {
        id: "sub-1",
        productId: PRODUCT_A,
        commitment: { id: "commit-monthly", term: "Monthly" },
      },
    ]);

    const result = await resolveCommitmentTermId(ctx, COMPANY_ID, PRODUCT_A, "3-Year");
    expect(result).toEqual({ id: "commit-monthly", term: "Monthly" });
  });

  it("passes companyId + status:Active to the SubscriptionsApi", async () => {
    const ctx = makeMockCtx([
      {
        productId: PRODUCT_A,
        commitment: { id: "commit-x", term: "Monthly" },
      },
    ]);

    await resolveCommitmentTermId(ctx, COMPANY_ID, PRODUCT_A);
    expect(ctx.api.subscriptions.list).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      status: "Active",
    });
  });

  it("returns null on API error (best-effort)", async () => {
    const ctx = {
      api: {
        subscriptions: {
          list: vi.fn().mockRejectedValue(new Error("network down")),
        },
      },
      isDemo: true,
      outputFormat: "json",
    } as unknown as CommandContext;

    const result = await resolveCommitmentTermId(ctx, COMPANY_ID, PRODUCT_A);
    expect(result).toBeNull();
  });
});
