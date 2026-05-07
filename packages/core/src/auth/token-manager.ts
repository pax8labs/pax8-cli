// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { AuthError } from "../api/errors.js";
import { getDefaultBaseUrl } from "../api/client.js";

function getTokenUrl(): string {
  return getDefaultBaseUrl().replace(/\/+$/, "") + "/token";
}
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const REFRESH_BUFFER_MS = 1 * 60 * 60 * 1000; // 1 hour buffer — refresh at 23h
const REFRESH_AT_MS = TOKEN_TTL_MS - REFRESH_BUFFER_MS;

interface TokenManagerOptions {
  clientId: string;
  clientSecret: string;
}

interface CachedToken {
  accessToken: string;
  obtainedAt: number;
}

export class TokenManager {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private cachedToken: CachedToken | null = null;
  private pendingRequest: Promise<string> | null = null;

  constructor(options: TokenManagerOptions) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
  }

  async getToken(): Promise<string> {
    if (this.cachedToken && !this.isExpired()) {
      return this.cachedToken.accessToken;
    }

    // Deduplicate concurrent requests
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
    return this.cachedToken !== null && !this.isExpired();
  }

  clearToken(): void {
    this.cachedToken = null;
    this.pendingRequest = null;
  }

  private isExpired(): boolean {
    if (!this.cachedToken) return true;
    const elapsed = Date.now() - this.cachedToken.obtainedAt;
    return elapsed >= REFRESH_AT_MS;
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

    this.cachedToken = {
      accessToken,
      obtainedAt: Date.now(),
    };

    return accessToken;
  }
}
