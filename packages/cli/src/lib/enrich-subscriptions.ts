import type { CommandContext } from "./context.js";

/**
 * Enrich subscriptions with product names when the API only returns productId.
 * Fetches the product catalog once and resolves names in place.
 */
export async function enrichProductNames(
  ctx: CommandContext,
  subs: Record<string, unknown>[],
): Promise<void> {
  // Check if any subs are missing product names
  const needsEnrichment = subs.some(
    (s) => !s.productName || String(s.productName).startsWith("Product ")
  );
  if (!needsEnrichment) return;

  try {
    const products = await ctx.api.products.list({ size: 200 });
    const nameMap = new Map<string, string>();
    for (const p of products.content) {
      nameMap.set(p.id, p.name);
    }

    for (const sub of subs) {
      if (!sub.productName || String(sub.productName).startsWith("Product ")) {
        const name = nameMap.get(String(sub.productId));
        if (name) sub.productName = name;
      }
    }
  } catch {
    // Best-effort — if products fetch fails, keep the IDs
  }
}
