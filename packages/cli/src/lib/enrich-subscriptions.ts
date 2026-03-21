import type { CommandContext } from "./context.js";

/**
 * Enrich subscriptions with product names when the API only returns productId.
 * Tries bulk catalog first, then individual lookups for any still missing.
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

  const nameMap = new Map<string, string>();

  // Step 1: bulk fetch from catalog
  try {
    const result = await ctx.api.products.list({ size: 500 });
    for (const product of result.content) {
      if (missing.has(product.id)) {
        nameMap.set(product.id, product.name);
      }
    }
  } catch { /* continue to individual lookups */ }

  // Step 2: individual lookups for any still unresolved
  const stillMissing = [...missing].filter((pid) => !nameMap.has(pid));
  if (stillMissing.length > 0) {
    await Promise.all(
      stillMissing.map(async (pid) => {
        try {
          const product = await ctx.api.products.get(pid);
          if (product?.name) nameMap.set(pid, product.name);
        } catch {
          // Product not found — skip
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
