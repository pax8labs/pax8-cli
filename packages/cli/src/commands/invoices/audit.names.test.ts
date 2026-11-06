// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from "vitest";
import { fillCompanyNames } from "./audit.js";
import type { CommandContext } from "../../lib/context.js";

// #756: live subscriptions carry only companyId, so `missing` rows built from
// them had a blank company. Demo subscriptions carry names, so no subprocess
// test reaches this path.
function makeCtx() {
  const list = vi.fn().mockResolvedValue({
    content: [
      { id: "c1", name: "Acme Corp" },
      { id: "c2", name: "Globex" },
    ],
    page: { size: 1000, number: 0, totalElements: 2, totalPages: 1 },
  });
  return { ctx: { api: { companies: { list } } } as unknown as CommandContext, list };
}

describe("fillCompanyNames", () => {
  it("fills blank names from clients list and leaves named rows alone", async () => {
    const { ctx } = makeCtx();
    const rows = [
      { companyId: "c1", companyName: "" },
      { companyId: "c2", companyName: "Invoice-side Name" },
    ];
    await fillCompanyNames(ctx, rows, { quiet: true });
    expect(rows.map((r) => r.companyName)).toEqual(["Acme Corp", "Invoice-side Name"]);
  });

  it("makes no request when every row already has a name", async () => {
    const { ctx, list } = makeCtx();
    await fillCompanyNames(ctx, [{ companyId: "c1", companyName: "Acme Corp" }]);
    expect(list).not.toHaveBeenCalled();
  });
});
