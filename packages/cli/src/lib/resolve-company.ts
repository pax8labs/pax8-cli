// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { ERROR_COMPANY_NOT_FOUND, type Company } from "@pax8/core";
import type { CommandContext } from "./context.js";
import { CliError } from "./errors.js";
import { resolveFromLastList } from "./last-list.js";
import { replCmd } from "./confirm.js";

/**
 * Resolve a company by number (#), UUID, or name.
 * Returns the full Company object.
 *
 * Resolution order:
 *  1. Numeric string → look up from last-list cache, then fetch by ID
 *  2. UUID → fetch by ID directly
 *  3. Name → exact match (case-insensitive), then fuzzy substring match
 */
export async function resolveCompany(ctx: CommandContext, input: string): Promise<Company> {
  // 1. Number reference from last list
  const lastListMatch = await resolveFromLastList(input);
  if (lastListMatch) {
    return ctx.api.companies.get(lastListMatch.id);
  }

  // 2. UUID — fetch directly
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(input);
  if (isUuid) {
    return ctx.api.companies.get(input);
  }

  // 3. Name search
  const result = await ctx.api.companies.list({ size: 200 });
  const lower = input.toLowerCase();

  // Exact match first
  const exact = result.content.find((c) => c.name.toLowerCase() === lower);
  if (exact) return exact;

  // Fuzzy (substring) match
  const fuzzy = result.content.filter((c) => c.name.toLowerCase().includes(lower));
  if (fuzzy.length === 1) return fuzzy[0];
  if (fuzzy.length > 1) {
    // #520: when the user typed an ambiguous query, surfacing a truncated list
    // gives the wrong impression that those are the only candidates. List all
    // matches when ≤10; for larger result sets show the first 10 plus an
    // explicit "and N more" tail so the user knows the list isn't exhaustive.
    const MAX_INLINE = 10;
    const names = fuzzy.map((c) => c.name);
    const matchesLine =
      names.length <= MAX_INLINE
        ? `Matches: ${names.join(", ")}`
        : `Matches: ${names.slice(0, MAX_INLINE).join(", ")} … and ${names.length - MAX_INLINE} more (run ${replCmd(`pax8 companies list | grep "${input}"`)} to see all)`;
    throw new CliError(
      `Multiple companies match "${input}"`,
      [matchesLine],
      [`Use an exact name or ID. Run ${replCmd("pax8 companies list")} to see all companies.`],
      undefined,
      ERROR_COMPANY_NOT_FOUND,
    );
  }

  throw new CliError(
    `Company not found: "${input}"`,
    ["No active company matched the supplied name or ID."],
    [`Run ${replCmd("pax8 companies list")} to see available companies.`],
    undefined,
    ERROR_COMPANY_NOT_FOUND,
  );
}

/**
 * Resolve a company by number (#), UUID, or name. Returns just the company ID.
 */
export async function resolveCompanyId(ctx: CommandContext, idOrName: string): Promise<string> {
  return (await resolveCompany(ctx, idOrName)).id;
}
