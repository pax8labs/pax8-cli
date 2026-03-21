import type { CommandContext } from "./context.js";

/**
 * Enrich subscriptions with product names when the API only returns productId.
 * Fetches all products in one bulk call instead of per-product lookups.
 */
export async function enrichProductNames(
  ctx: CommandContext,
  subs: Record<string, unknown>[],
): Promise<void> {
  // Collect unique product IDs that need names
  const missing = new Set<string>();
  for (const s of subs) {
    if (!s.productName || String(s.productName).startsWith("Product ")) {
      const pid = String(s.productId ?? "");
      if (pid) missing.add(pid);
    }
  }
  if (missing.size === 0) return;

  // Bulk-fetch all products in one call and build a name map
  const nameMap = new Map<string, string>();
  try {
    const result = await ctx.api.products.list({ size: 500 });
    for (const product of result.content) {
      if (missing.has(product.id)) {
        nameMap.set(product.id, product.name);
      }
    }
  } catch {
    // Fall back to individual lookups if bulk fetch fails
    await Promise.all(
      [...missing].map(async (pid) => {
        try {
          const product = await ctx.api.products.get(pid);
          if (product?.name) nameMap.set(pid, product.name);
        } catch {
          // Product not found or error — skip
        }
      })
    );
  }

  // Apply names
  for (const sub of subs) {
    if (!sub.productName || String(sub.productName).startsWith("Product ")) {
      const name = nameMap.get(String(sub.productId));
      if (name) sub.productName = name;
    }
  }
}
