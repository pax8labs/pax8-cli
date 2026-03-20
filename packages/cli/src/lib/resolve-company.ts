import type { CommandContext } from "./context.js";

/**
 * Resolve a company by ID or name. Supports exact match and fuzzy (substring) match.
 * Returns the company ID.
 */
export async function resolveCompanyId(ctx: CommandContext, idOrName: string): Promise<string> {
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrName);
  if (isUuid) return idOrName;

  const result = await ctx.api.companies.list({ size: 100 });
  const lower = idOrName.toLowerCase();

  // Exact match first
  const exact = result.content.find((c) => c.name.toLowerCase() === lower);
  if (exact) return exact.id;

  // Fuzzy (substring) match
  const fuzzy = result.content.filter((c) => c.name.toLowerCase().includes(lower));
  if (fuzzy.length === 1) return fuzzy[0].id;
  if (fuzzy.length > 1) {
    throw new Error(
      `Multiple companies match "${idOrName}": ${fuzzy.map((c) => c.name).join(", ")}. Use an exact name or ID.`,
    );
  }

  throw new Error(`Company not found: "${idOrName}". Run 'pax8 companies list' to see available companies.`);
}
