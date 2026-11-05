// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * `User-Agent` sent on every request to the Pax8 API (including the OAuth
 * token exchange), so Pax8's API logs can attribute traffic to this client.
 *
 * Before this existed, requests went out as Node's default `node`, and a
 * third-party tool's hard-coded `pax8-cli/1.0.0` got mistaken for ours in
 * monolith error logs. Product tokens are therefore prefixed `pax8labs-`,
 * which nothing else uses.
 *
 * Embedders name themselves once at startup with {@link setUserAgentProduct}
 * (the CLI sends `pax8labs-cli/<version>`); otherwise the core library
 * identifies itself. Only runtime facts are appended — never credentials,
 * hostnames, or user data.
 */
const CORE_PRODUCT = "pax8labs-core";

let product: string | null = null;

/**
 * Name the embedding application, e.g. `"pax8labs-cli/0.4.0"`. Must be a
 * single RFC 9110 product token (`name/version`, no spaces); anything else
 * is ignored so a bad value can't corrupt the header.
 */
export function setUserAgentProduct(value: string): void {
  if (/^[A-Za-z0-9!#$%&'*+.^_`|~-]+(\/[A-Za-z0-9!#$%&'*+.^_`|~-]+)?$/.test(value)) {
    product = value;
  }
}

/** The full header value, e.g. `pax8labs-cli/0.4.0 pax8labs-core node/22.23.2 (darwin)`. */
export function getUserAgent(): string {
  const runtime = `node/${process.versions.node} (${process.platform})`;
  return [product, CORE_PRODUCT, runtime].filter(Boolean).join(" ");
}

/** Test seam: forget any product set by {@link setUserAgentProduct}. */
export function resetUserAgentProduct(): void {
  product = null;
}
