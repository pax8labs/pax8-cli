import type { CommandContext } from "./context.js";

/**
 * Enrich subscriptions with product names when the API only returns productId.
 * Looks up each unique product by ID (cached, so fast on repeat calls).
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

  // Look up each product by ID (these GET calls are cached)
  const nameMap = new Map<string, string>();
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

  // Apply names
  for (const sub of subs) {
    if (!sub.productName || String(sub.productName).startsWith("Product ")) {
      const name = nameMap.get(String(sub.productId));
      if (name) sub.productName = name;
    }
  }
}
