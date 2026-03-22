import type { Product } from "@pax8/core";
import type { CommandContext } from "./context.js";
import { replCmd } from "./confirm.js";

/**
 * Resolve a product by ID or name. Supports exact match and fuzzy (substring) match.
 * Returns the full product object.
 */
export async function resolveProduct(ctx: CommandContext, input: string): Promise<Product> {
  // Try direct ID lookup first (UUID or any ID format)
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(input);
  if (isUuid) return ctx.api.products.get(input);

  // If it looks like an ID (contains dashes but isn't a UUID, e.g. "prod-m365-biz-prem-0001"),
  // try a direct get before falling back to name search
  if (input.includes("-")) {
    try {
      return await ctx.api.products.get(input);
    } catch { /* not found by ID, try name search */ }
  }

  const result = await ctx.api.products.list({ size: 200 });
  const lower = input.toLowerCase();

  // Exact match first
  const exact = result.content.find((p) => p.name.toLowerCase() === lower);
  if (exact) return exact;

  // Fuzzy (substring) match
  const fuzzy = result.content.filter((p) => p.name.toLowerCase().includes(lower));
  if (fuzzy.length === 1) return fuzzy[0];
  if (fuzzy.length > 1) {
    const names = fuzzy
      .slice(0, 5)
      .map((p) => p.name)
      .join(", ");
    throw new Error(
      `Multiple products match "${input}": ${names}. Use an exact name or product ID.`,
    );
  }

  throw new Error(
    `Product not found: "${input}". Try '${replCmd("pax8 products search")} "${input}"' to browse the catalog.`,
  );
}
