// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { AuthError } from "../api/errors.js";
import { getDefaultBaseUrl } from "../api/client.js";
import {
  TokenCacheStore,
  computeCacheIdentity,
  type TokenCacheFile,
} from "./token-cache-store.js";

function getTokenBaseUrl(): string {
  return getDefaultBaseUrl().replace(/\/+$/, "");
}

function getTokenUrl(): string {
  return getTokenBaseUrl() + "/token";
}

/**
 * Fallback TTL applied when the `/token` response is missing `expires_in`.
 * Pax8's production endpoint returns `expires_in: 86400` (24h); this floor
 * is what the previous (in-memory-only) cache assumed.
 */
const DEFAULT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Refresh-skew buffer used by the cache freshness check. We refresh the
 * token early so that a request issued *just* before the wire-side expiry
 * doesn't race the server's clock — the network round trip plus the API
 * call could easily land after `expiresAt` if we cut it to zero.
 *
 * Old (#233) constant: a flat 1h buffer, regardless of TTL. That inverted
 * behavior for any TTL under 1h — every call would refresh-on-every-call,
 * defeating the cache entirely. The new policy: 60 s OR 10 % of the TTL,
 * whichever is *smaller*. For Pax8's 24 h tokens this is 60 s. For a
 * hypothetical 5-minute test token it becomes 30 s (10 %), still leaving
 * 4.5 minutes of usable cache.
 */
function refreshBufferForTtl(ttlMs: number): number {
  return Math.min(60_000, Math.floor(ttlMs * 0.1));
}

interface TokenManagerOptions {
  clientId: string;
  clientSecret: string;
  /**
   * Optional injectable on-disk cache store. Defaults to a fresh
   * `TokenCacheStore`. Exposed for tests that want to assert on
   * `save` / `load` / `clear` call shape without touching the
   * real filesystem.
   */
  cacheStore?: TokenCacheStore;
}

interface CachedToken {
  accessToken: string;
  /** Absolute expiry in ms since epoch; matches the on-disk shape. */
  expiresAt: number;
  /** Original lifetime in ms (i.e. `expires_in * 1000`). Drives the refresh buffer. */
  ttlMs: number;
}

export class TokenManager {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly cacheStore: TokenCacheStore;
  private cachedToken: CachedToken | null = null;
  private pendingRequest: Promise<string> | null = null;
  /**
   * If true, the next `getToken()` call skips the in-memory + on-disk caches
   * and fetches a fresh token. Set by `clearCache()` (e.g. on a 401 from a
   * downstream API call). Re-armed automatically after a successful refetch.
   */
  private forceRefetch = false;

  constructor(options: TokenManagerOptions) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.cacheStore = options.cacheStore ?? new TokenCacheStore();
  }

  async getToken(): Promise<string> {
    // 1. In-memory fast path.
    if (!this.forceRefetch && this.cachedToken && !this.isExpired(this.cachedToken)) {
      return this.cachedToken.accessToken;
    }

    // 2. On-disk cache. Hydrate the in-memory cache from a fresh-enough
    //    entry so subsequent calls within this process hit path (1).
    if (!this.forceRefetch) {
      const fromDisk = this.loadFromDisk();
      if (fromDisk) {
        this.cachedToken = {
          accessToken: fromDisk.accessToken,
          expiresAt: fromDisk.expiresAt,
          ttlMs: fromDisk.ttlMs,
        };
        return fromDisk.accessToken;
      }
    }

    // 3. Network. Deduplicate concurrent requests so parallel callers
    //    (subscriptions+invoices+orders fired in parallel by `pax8 today`)
    //    share a single token exchange.
    if (this.pendingRequest) {
      return this.pendingRequest;
    }

    this.pendingRequest = this.fetchToken();
    try {
      const token = await this.pendingRequest;
      return token;
    } finally {
      this.pendingRequest = null;
    }
  }

  isAuthenticated(): boolean {
    return this.cachedToken !== null && !this.isExpired(this.cachedToken);
  }

  /**
   * Clear the in-memory cached token. Backwards-compatible alias for the
   * pre-#233 surface; does NOT touch the on-disk cache. Use `clearCache()`
   * for the full wipe (in-memory + disk).
   */
  clearToken(): void {
    this.cachedToken = null;
    this.pendingRequest = null;
  }

  /**
   * Full cache wipe: drop the in-memory entry AND delete the on-disk file.
   * Called from `Pax8Client` on a 401 response so a server-side token
   * revocation doesn't hang the CLI for the rest of the TTL, and from
   * `CredentialStore.clearCredentials` so `pax8 auth logout` doesn't leave
   * a stale token paired with the wiped credentials.
   *
   * The next `getToken()` call after this is guaranteed to re-fetch from
   * the network — the on-disk file is gone AND `forceRefetch` is set, so
   * even a concurrent invocation that writes a new cache mid-call won't
   * shortcut us back to a stale token.
   */
  clearCache(): void {
    this.cachedToken = null;
    this.pendingRequest = null;
    this.forceRefetch = true;
    try {
      this.cacheStore.clear();
    } catch {
      // Best-effort: a permission error on disk shouldn't fail the calling
      // command. The in-memory clear already happened.
    }
  }

  private isExpired(entry: CachedToken): boolean {
    const remaining = entry.expiresAt - Date.now();
    if (remaining <= 0) return true;
    // The buffer is keyed to the token's *original* lifetime (`ttlMs`), not
    // its remaining time, so the cache stays usable for most of the token's
    // life and only flips to "refresh me" near the end. For a 24 h Pax8
    // token: `min(60s, 10% of 24h)` = 60 s. For a hypothetical 5-minute
    // test token: `min(60s, 30s)` = 30 s.
    const buffer = refreshBufferForTtl(entry.ttlMs);
    return remaining <= buffer;
  }

  private loadFromDisk(): TokenCacheFile | null {
    const apiBaseUrl = getTokenBaseUrl();
    const entry = this.cacheStore.load({ clientId: this.clientId, apiBaseUrl });
    if (!entry) return null;
    // Apply the same freshness check we use for in-memory entries. A cache
    // file that's older than the skew buffer is treated as a miss; the
    // caller will refetch and overwrite.
    if (
      this.isExpired({
        accessToken: entry.accessToken,
        expiresAt: entry.expiresAt,
        ttlMs: entry.ttlMs,
      })
    ) {
      return null;
    }
    return entry;
  }

  private async fetchToken(): Promise<string> {
    // Resolve the token URL outside the network try/catch. getTokenUrl()
    // can throw Pax8SecurityError (#234) when PAX8_API_BASE is rejected,
    // and that should propagate as-is — wrapping it in AuthError ("Failed
    // to connect…") would obscure the security error and lose the
    // actionable recovery steps.
    const tokenUrl = getTokenUrl();
    let response: Response;
    try {
      response = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: "client_credentials",
          audience: "https://api.pax8.com",
        }),
      });
    } catch (err) {
      throw new AuthError(
        `Failed to connect to Pax8 auth server: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (!response.ok) {
      let errorMessage = `Authentication failed (HTTP ${response.status})`;
      try {
        const body = (await response.json()) as Record<string, unknown>;
        if (body.error_description) {
          errorMessage = `Authentication failed: ${body.error_description}`;
        } else if (body.error) {
          errorMessage = `Authentication failed: ${body.error}`;
        } else if (body.message) {
          errorMessage = `Authentication failed: ${body.message}`;
        }
      } catch {
        // Ignore JSON parse errors — use default message
      }
      throw new AuthError(errorMessage, response.status);
    }

    let body: Record<string, unknown>;
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new AuthError("Invalid response from Pax8 auth server: could not parse JSON");
    }

    const accessToken = body.access_token;
    if (typeof accessToken !== "string" || !accessToken) {
      throw new AuthError("Invalid response from Pax8 auth server: missing access_token");
    }

    // Honor `expires_in` from the response (seconds, per OAuth2). Production
    // returns 86400. A missing / non-numeric / non-positive value falls back
    // to the 24 h default so we never end up with a token cached at a
    // negative or zero TTL.
    const expiresInSec =
      typeof body.expires_in === "number" && Number.isFinite(body.expires_in) && body.expires_in > 0
        ? body.expires_in
        : DEFAULT_TOKEN_TTL_MS / 1000;
    const ttlMs = expiresInSec * 1000;
    const expiresAt = Date.now() + ttlMs;

    this.cachedToken = { accessToken, expiresAt, ttlMs };
    this.forceRefetch = false;

    // Persist asynchronously. We don't await because the in-memory token is
    // already returnable; the write is purely a hint for the next process.
    const identity = computeCacheIdentity({
      clientId: this.clientId,
      apiBaseUrl: getTokenBaseUrl(),
    });
    void this.cacheStore.save({
      accessToken,
      expiresAt,
      ttlMs,
      clientIdHash: identity.clientIdHash,
      apiBaseHash: identity.apiBaseHash,
    });

    return accessToken;
  }
}
