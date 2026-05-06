import { ERROR_PRODUCT_NOT_FOUND, type Product } from "@pax8/core";
import type { CommandContext } from "./context.js";
import { CliError } from "./errors.js";
import { replCmd } from "./confirm.js";

// Vendors common in the Pax8 catalog. Used to detect a vendor prefix in
// user input ("Microsoft 365 Business Premium" → vendorName=Microsoft) so
// we can narrow the API search dramatically. Not exhaustive — unknown
// vendors fall back to a keyword-only search, which still returns ≤200
// results for any reasonable single keyword.
const KNOWN_VENDORS = [
  "Microsoft",
  "AvePoint",
  "Acronis",
  "Bitdefender",
  "CrowdStrike",
  "Datto",
  "Dropsuite",
  "ConnectWise",
  "Kaseya",
  "Mimecast",
  "N-able",
  "Proofpoint",
  "SentinelOne",
  "Sophos",
  "Veeam",
  "Webroot",
  "Keeper",
  "Duo",
  "Cisco",
  "Adobe",
  "Google",
  "Dropbox",
  "Box",
  "Zoom",
  "Slack",
];

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "of", "to", "in", "by", "with",
]);

function detectVendor(input: string): string | undefined {
  const lower = input.toLowerCase();
  return KNOWN_VENDORS.find((v) => lower.startsWith(v.toLowerCase()));
}

// Pick the most discriminating single keyword for the API's `search` param.
// The Pax8 API only honors single-word values, so we must pick one. Prefer
// longer non-stopword tokens — "Premium" (7) beats "Business" (8) only
// because length is the proxy for specificity, but ties go to the later
// token (more likely to be the SKU-distinguishing one).
function pickKeyword(tokens: string[]): string | undefined {
  const candidates = tokens.filter(
    (t) => t.length >= 4 && !STOPWORDS.has(t.toLowerCase())
  );
  if (candidates.length === 0) return undefined;
  return candidates.reduce((best, t) => (t.length >= best.length ? t : best));
}

/**
 * Resolve a product by ID or name. Supports exact match and fuzzy (substring) match.
 * Returns the full product object.
 */
export async function resolveProduct(ctx: CommandContext, input: string): Promise<Product> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(input);
  if (isUuid) return ctx.api.products.get(input);

  // If it looks like an ID (contains dashes but isn't a UUID, e.g. "prod-m365-biz-prem-0001"),
  // try a direct get before falling back to name search
  if (input.includes("-")) {
    try {
      return await ctx.api.products.get(input);
    } catch { /* not found by ID, try name search */ }
  }

  const vendor = detectVendor(input);
  const remaining = vendor
    ? input.slice(vendor.length).trim()
    : input;
  const tokens = remaining.split(/\s+/).filter(Boolean);
  const keyword = pickKeyword(tokens) ?? tokens[0];

  const result = await ctx.api.products.list({
    vendorName: vendor,
    search: keyword,
    size: 200,
  });
  const lower = input.toLowerCase();

  const exact = result.content.find((p) => p.name.toLowerCase() === lower);
  if (exact) return exact;

  const fuzzy = result.content.filter((p) => p.name.toLowerCase().includes(lower));
  if (fuzzy.length === 1) return fuzzy[0];
  if (fuzzy.length > 1) {
    const names = fuzzy
      .slice(0, 5)
      .map((p) => p.name)
      .join(", ");
    throw new CliError(
      `Multiple products match "${input}"`,
      [`Matches: ${names}`],
      ["Use an exact name or product ID."],
      undefined,
      ERROR_PRODUCT_NOT_FOUND,
    );
  }

  // Fall back to multi-token client-side match: every input token appears
  // in the product name. Catches cases where "Microsoft 365 Business
  // Premium" doesn't appear as a contiguous substring but each word does.
  const inputTokens = input.toLowerCase().split(/\s+/).filter(Boolean);
  const tokenMatches = result.content.filter((p) => {
    const name = p.name.toLowerCase();
    return inputTokens.every((t) => name.includes(t));
  });
  if (tokenMatches.length === 1) return tokenMatches[0];
  if (tokenMatches.length > 1) {
    const names = tokenMatches
      .slice(0, 5)
      .map((p) => p.name)
      .join(", ");
    throw new CliError(
      `Multiple products match "${input}"`,
      [`Matches: ${names}`],
      ["Use an exact name or product ID."],
      undefined,
      ERROR_PRODUCT_NOT_FOUND,
    );
  }

  throw new CliError(
    `Product not found: "${input}"`,
    ["No product in the catalog matched the supplied name or ID."],
    [`Try ${replCmd("pax8 products search")} "${input}" to browse the catalog.`],
    undefined,
    ERROR_PRODUCT_NOT_FOUND,
  );
}
