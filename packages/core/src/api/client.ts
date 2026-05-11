// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { type ZodType } from "zod";
import { ApiError, RateLimitError } from "./errors.js";
import { PageSchema } from "./types.js";
import { FileCache } from "../services/cache.js";
import { validateBaseUrl } from "../security/validate-env.js";
import { redactDebugBody } from "../security/redact-debug.js";

export interface Pax8ClientOptions {
  tokenManager: { getToken(): Promise<string> };
  baseUrl?: string;
  timeout?: number;
  debug?: boolean;
  /** Cache TTL in ms for GET requests. 0 disables caching. Default: 3600000 (1 hour). */
  cacheTtlMs?: number;
  /**
   * Per-API base URL overrides (#321). Maps an API-key (e.g. `"webhooks"`) to
   * a fully-resolved base URL that replaces the project-wide default for
   * requests that opt in via `RequestOpts.api`.
   *
   * Most of the Pax8 partner API lives under a single `/v1` base, but some
   * surfaces live elsewhere — e.g. the Webhooks API is rooted at
   * `https://api.pax8.com/api/v2`, a different *prefix* (not just a swapped
   * version segment) that the per-call `apiVersion` substitution from #307
   * cannot represent. An API class that needs to talk to a different base
   * declares its key here and passes `{ api: "<key>" }` on every call; the
   * client routes the request against the override instead of `baseUrl`.
   *
   * Composition rules:
   * - `PAX8_API_BASE` overrides only the project-wide default (`baseUrl`).
   *   Per-API overrides apply on top of whichever default is in play, and
   *   are not affected by `PAX8_API_BASE`. Partners pointing at staging set
   *   `PAX8_API_BASE` and trust the per-API override to coexist; if they need
   *   to redirect a per-API override for staging, they can pass a custom
   *   `apiBaseOverrides` map directly into the client constructor.
   * - A request with `{ api: "<key>" }` resolves the base from this map; an
   *   unknown key silently falls back to `baseUrl` (so adding a new API
   *   class is a pure-addition change — old call sites won't crash).
   * - The per-call `apiVersion` substitution from #307 then applies on top
   *   of whichever base URL was selected.
   */
  apiBaseOverrides?: Record<string, string>;
}

/**
 * Per-call request options. Threaded through every public method on
 * `Pax8Client` to override defaults for a single request. All fields optional.
 */
export interface RequestOpts {
  /**
   * Override the version segment of the base URL for this call (e.g. `"v2"`).
   * Quotes are the only Pax8 partner surface that lives at `/v2`; everything
   * else uses `/v1` from the default base URL. `QuotesApi` passes
   * `{ apiVersion: "v2" }` on every call; other API classes leave it unset
   * and inherit the base URL's version segment unchanged. See #307.
   */
  apiVersion?: string;
  /**
   * Per-API base URL override key (#321). When set, the client looks up the
   * fully-resolved base URL in the `apiBaseOverrides` map passed at
   * construction time and routes this call against it instead of the
   * project-wide default. The `apiVersion` substitution (if any) is applied
   * on top of whichever base URL was selected.
   *
   * If the key isn't registered in `apiBaseOverrides`, the call silently
   * falls back to the default `baseUrl` — adding a new API class is a
   * pure-addition change.
   */
  api?: string;
}

const FALLBACK_BASE_URL = "https://api.pax8.com/v1";
const DEFAULT_TIMEOUT = 30_000;
/**
 * Upper bound on `PAX8_TIMEOUT_MS` — 5 minutes (#199). Higher values almost
 * certainly mean the partner is papering over an upstream regression rather
 * than tolerating legitimate slowness; capping forces them to escalate
 * instead of silently waiting forever for a request that will never return.
 * Values above the cap are clamped (not rejected) so a typo doesn't turn
 * every request into an `ERROR_INVALID_INPUT`.
 */
const MAX_TIMEOUT_MS = 300_000;
const MAX_RETRIES = 3;

/**
 * Substitute the trailing version segment of a base URL.
 *
 * The Pax8 partner API splits its surface across version prefixes — most
 * resources at `/v1`, quotes at `/v2`. The `baseUrl` carries the project-wide
 * default (`/v1`); individual API classes can override per call by passing
 * `RequestOpts.apiVersion`.
 *
 * Requires `baseUrl` to end with a `/vN` or `/vN.M` segment when `apiVersion`
 * is set. If the partner has set `PAX8_API_BASE` to a value without a version
 * suffix (e.g. `https://api-staging.pax8.com`), substitution would silently
 * produce a plausible-looking but wrong URL for the quote calls that opt in,
 * while leaving every non-quote call broken anyway (those expect `/v1/...`
 * paths that don't exist against the bare host). Better to fail loudly on
 * the first quote call than to mask a misconfiguration. The error message
 * tells the partner exactly what to fix.
 *
 * Exported so the substitution rule is unit-testable independent of the
 * surrounding request plumbing.
 */
export function applyApiVersion(baseUrl: string, apiVersion?: string): string {
  if (!apiVersion) return baseUrl;
  const versionTail = /\/v\d+(?:\.\d+)?$/;
  if (versionTail.test(baseUrl)) {
    return baseUrl.replace(versionTail, `/${apiVersion}`);
  }
  throw new Error(
    `Cannot apply apiVersion="${apiVersion}" to base URL "${baseUrl}": ` +
      `the base URL must end with a version segment such as "/v1" for ` +
      `per-call version substitution to work. Set PAX8_API_BASE to a value ` +
      `like "https://api-staging.pax8.com/v1" (the production default is ` +
      `"https://api.pax8.com/v1"), or unset it to inherit the default. See ` +
      `https://github.com/pax8labs/pax8-cli/issues/307 for background.`,
  );
}

/**
 * Pure URL-resolution helper for the per-API base URL mechanism (#321).
 *
 * Resolution order:
 *   1. If `api` is set AND `apiBaseOverrides` has an entry for that key, use
 *      the override as the base. Otherwise, fall back to `defaultBaseUrl`.
 *   2. Apply `applyApiVersion(base, apiVersion)` on top — the per-call version
 *      substitution from #307 operates on whichever base URL was selected.
 *
 * An unknown `api` key silently falls back to `defaultBaseUrl` rather than
 * throwing. Rationale: API classes are added incrementally and registering
 * the override is the API class author's responsibility; downstream embedders
 * shouldn't crash if they instantiate `Pax8Client` without all overrides
 * configured (the default for most APIs is the project-wide base anyway).
 *
 * Exported so the resolution rule is unit-testable independent of the
 * surrounding request plumbing.
 */
export function resolveBaseUrl(
  defaultBaseUrl: string,
  apiBaseOverrides: Record<string, string> | undefined,
  api: string | undefined,
  apiVersion: string | undefined,
): string {
  const override = api && apiBaseOverrides ? apiBaseOverrides[api] : undefined;
  const base = override ?? defaultBaseUrl;
  return applyApiVersion(base, apiVersion);
}

/**
 * Resolve the API base URL. Honors `PAX8_API_BASE` so partners can point at
 * a non-prod environment without code changes; falls back to production.
 * Exported so the CLI can surface it in `pax8 doctor`.
 *
 * Security (#234): the env-var path is run through `validateBaseUrl` so an
 * `http://attacker.example.com` value is rejected before it can be used as
 * the destination for bearer-token-bearing requests. Localhost over http
 * is allowed for development; non-localhost http requires the explicit
 * `PAX8_ALLOW_INSECURE_BASE=1` opt-in. Wiring the validation here means
 * every caller — `Pax8Client` constructor, `TokenManager`, future call
 * sites — gets the check for free.
 */
export function getDefaultBaseUrl(): string {
  const fromEnv = process.env.PAX8_API_BASE;
  if (!fromEnv) return FALLBACK_BASE_URL;
  return validateBaseUrl(fromEnv);
}

/**
 * Resolve the per-request HTTP timeout. Honors `PAX8_TIMEOUT_MS` so partners
 * with slow connections — or against tenants where a particular Pax8 endpoint
 * is known to take a long time (e.g. `/orders` against large portfolios, see
 * #199) — can extend the 30s default without code changes.
 *
 * Validation:
 * - Non-numeric or non-positive values are ignored (fall back to default).
 *   A noisy throw here would mask whatever the user was actually trying to
 *   do; a silent fall-back is friendlier and the value is easy to verify
 *   via `pax8 doctor`.
 * - Values above `MAX_TIMEOUT_MS` are clamped, not rejected.
 *
 * Re-read on every call (no caching) so test harnesses that mutate the env
 * between client constructions see the new value. The pattern mirrors
 * `getDefaultBaseUrl` for consistency.
 */
export function getDefaultTimeout(): number {
  const fromEnv = process.env.PAX8_TIMEOUT_MS;
  if (!fromEnv) return DEFAULT_TIMEOUT;
  const parsed = Number(fromEnv);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT;
  return Math.min(Math.floor(parsed), MAX_TIMEOUT_MS);
}

/**
 * Detect whether an unknown error originated from a per-request abort fired
 * by `AbortController` after `this.timeout` ms elapsed. The thrown shape is
 * `ApiError(status=0, message="Request timed out after Nms")` — `statusCode`
 * 0 is what the client uses to mean "we never got a wire response" — so we
 * key on both the type/code and the message prefix to avoid mis-classifying
 * a genuine "everything was zero" downstream error.
 *
 * Exported so the CLI's error layer (and any embedder) can map this to the
 * `ERROR_API_TIMEOUT` code and surface an actionable hint without having to
 * rebuild the predicate.
 */
export function isApiTimeoutError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.statusCode !== 0) return false;
  return /timed out/i.test(error.message);
}

export class Pax8Client {
  private readonly tokenManager: { getToken(): Promise<string> };
  private readonly baseUrl: string;
  private readonly apiBaseOverrides: Record<string, string> | undefined;
  private readonly timeout: number;
  private readonly debug: boolean;
  private readonly cache: FileCache | null;
  private readonly cacheTtlMs: number;

  constructor(options: Pax8ClientOptions) {
    this.tokenManager = options.tokenManager;
    this.baseUrl = (options.baseUrl ?? getDefaultBaseUrl()).replace(/\/+$/, "");
    // Normalize per-API overrides the same way as the default baseUrl so the
    // composition is symmetric — trailing slashes don't leak through to
    // `buildUrl`, regardless of which dimension supplied the base.
    if (options.apiBaseOverrides) {
      const normalized: Record<string, string> = {};
      for (const [key, value] of Object.entries(options.apiBaseOverrides)) {
        normalized[key] = value.replace(/\/+$/, "");
      }
      this.apiBaseOverrides = normalized;
    } else {
      this.apiBaseOverrides = undefined;
    }
    // Resolution order for the per-request HTTP timeout:
    //   1. explicit `options.timeout` (test harnesses, embedders that already
    //      know what they want)
    //   2. `PAX8_TIMEOUT_MS` env var (partners extending the default; #199)
    //   3. `DEFAULT_TIMEOUT` (30s)
    // The env var is the on-ramp documented in `CLAUDE.md` / `docs/UX_GUIDE.md`;
    // the constructor argument exists for tests and downstream embedders that
    // want to bypass the env entirely.
    this.timeout = options.timeout ?? getDefaultTimeout();
    this.debug = options.debug ?? false;
    this.cacheTtlMs = options.cacheTtlMs ?? 3_600_000; // 1 hour default
    this.cache = this.cacheTtlMs > 0 ? new FileCache() : null;
  }

  async get<T>(
    path: string,
    params?: Record<string, string | number | undefined>,
    opts?: RequestOpts,
  ): Promise<T> {
    if (this.cache) {
      const cacheKey = this.buildCacheKey(path, params, opts?.apiVersion, opts?.api);
      const cached = await this.cache.get<T>(cacheKey);
      if (cached !== null) {
        if (this.debug) {
          process.stderr.write(`[pax8] CACHE HIT ${path}\n`);
        }
        return cached;
      }
      const result = await this.request<T>("GET", path, undefined, params, opts);
      await this.cache.set(cacheKey, result, this.cacheTtlMs).catch((err) => {
        if (this.debug) process.stderr.write(`[pax8] cache write failed for ${path}: ${err}\n`);
      });
      return result;
    }
    return this.request<T>("GET", path, undefined, params, opts);
  }

  private buildCacheKey(
    path: string,
    params?: Record<string, string | number | undefined>,
    apiVersion?: string,
    api?: string,
  ): string {
    const normalized = path.replace(/^\/+/, "");
    const paramStr = params
      ? Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}=${v}`)
          .join("&")
      : "";
    // Per-API base and per-call apiVersion both shift the resolved wire URL,
    // so cache entries must be partitioned by both — otherwise a `/v1/foo`
    // response could be served to a `/v2/foo` or `/api/v2/foo` caller (#321).
    const apiPrefix = api ? `${api}:` : "";
    const versionPrefix = apiVersion ? `${apiVersion}:` : "";
    return `${apiPrefix}${versionPrefix}${normalized}${paramStr ? "_" + paramStr : ""}`;
  }

  async post<T>(path: string, body: unknown, opts?: RequestOpts): Promise<T> {
    return this.request<T>("POST", path, body, undefined, opts);
  }

  async put<T>(path: string, body: unknown, opts?: RequestOpts): Promise<T> {
    return this.request<T>("PUT", path, body, undefined, opts);
  }

  async patch<T>(path: string, body: unknown, opts?: RequestOpts): Promise<T> {
    return this.request<T>("PATCH", path, body, undefined, opts);
  }

  async delete(
    path: string,
    params?: Record<string, string | number | undefined>,
    opts?: RequestOpts,
  ): Promise<void> {
    await this.request<void>("DELETE", path, undefined, params, opts);
  }

  async *getPaginated<T>(
    path: string,
    params?: Record<string, string | number | undefined>,
    schema?: ZodType,
    opts?: RequestOpts,
  ): AsyncIterableIterator<T[]> {
    let page = 0;
    let totalPages = 1;

    while (page < totalPages) {
      const mergedParams = { ...params, page: String(page), size: params?.size ?? "50" };
      const response = await this.get<{ page: { number: number; totalPages: number }; content: T[] }>(
        path,
        mergedParams as Record<string, string | number | undefined>,
        opts,
      );

      const pageInfo = PageSchema.parse(response.page);
      totalPages = pageInfo.totalPages;

      let content = response.content;
      if (schema) {
        content = content.map((item) => schema.parse(item));
      }

      yield content;
      page = pageInfo.number + 1;
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    params?: Record<string, string | number | undefined>,
    opts?: RequestOpts,
  ): Promise<T> {
    const url = this.buildUrl(path, params, opts?.apiVersion, opts?.api);
    const token = await this.tokenManager.getToken();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    const init: RequestInit & { signal?: AbortSignal } = {
      method,
      headers,
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    let lastError: Error | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), this.timeout);
        init.signal = controller.signal;

        try {
          if (this.debug) {
            process.stderr.write(`[pax8] ${method} ${path}\n`);
            // #308: emit the resolved absolute URL so wire-level integration
            // tests can assert which API version each call actually hits. The
            // relative `path` above is preserved as the human-readable summary;
            // the `url=` line is the machine-parseable form. Query strings are
            // safe here (no bearer tokens are ever placed in URL params).
            process.stderr.write(`[pax8] ${method} url=${url.toString()}\n`);
          }

          const response = await fetch(url.toString(), init);

          if (this.debug) {
            process.stderr.write(`[pax8] ${method} ${path} → ${response.status}\n`);
          }

          if (response.status === 429) {
            clearTimeout(timeoutId);
            if (attempt === MAX_RETRIES) {
              throw new RateLimitError("Rate limit exceeded", path, (parseRetryAfter(response) ?? 60) * 1000);
            }
            const retryAfter = parseRetryAfter(response) ?? (attempt + 1);
            await sleep(retryAfter * 1000);
            continue;
          }

          if (response.status >= 500) {
            clearTimeout(timeoutId);
            if (attempt === MAX_RETRIES) {
              const errorBody = await safeJson(response);
              throw new ApiError(
                `Server error: ${response.status} ${response.statusText}`,
                response.status,
                path,
                method,
                errorBody,
              );
            }
            const backoff = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
            await sleep(backoff);
            continue;
          }

          if (!response.ok) {
            const errorBody = await safeJson(response);
            if (this.debug && errorBody) {
              // #263: error response bodies can echo bearer tokens, JWTs, or
              // client_secrets if the upstream API ever surfaces them. Run
              // through the debug-body redactor before printing. Setting
              // `PAX8_DEBUG_RAW=1` opts back into the unredacted form for
              // genuine debugging — not the default `--verbose` path.
              const rendered = redactDebugBody(JSON.stringify(errorBody, null, 2));
              process.stderr.write(`[pax8] ${method} ${path} error body: ${rendered}\n`);
            }
            throw new ApiError(
              `${response.status} ${response.statusText}`,
              response.status,
              path,
              method,
              errorBody,
            );
          }

          // DELETE returns no body
          if (response.status === 204 || method === "DELETE") {
            return undefined as T;
          }

          const data = await response.json();
          return data as T;
        } catch (error) {
          clearTimeout(timeoutId);
          if (error instanceof ApiError || error instanceof RateLimitError) {
            throw error;
          }
          if (error instanceof DOMException && error.name === "AbortError") {
            if (attempt === MAX_RETRIES) {
              throw new ApiError(`Request timed out after ${this.timeout}ms`, 0, path, method);
            }
            lastError = error as Error;
            const backoff = Math.pow(2, attempt) * 1000;
            await sleep(backoff);
            continue;
          }
          lastError = error as Error;
          if (attempt === MAX_RETRIES) {
            throw new ApiError(
              `Network error: ${(error as Error).message}`,
              0,
              path,
              method,
            );
          }
          const backoff = Math.pow(2, attempt) * 1000;
          await sleep(backoff);
        }
      }

      throw lastError ?? new Error("Unexpected error");
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private buildUrl(
    path: string,
    params?: Record<string, string | number | undefined>,
    apiVersion?: string,
    api?: string,
  ): URL {
    const base = resolveBaseUrl(this.baseUrl, this.apiBaseOverrides, api, apiVersion);
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${base}${normalizedPath}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url;
  }
}

function parseRetryAfter(response: Response): number | undefined {
  const header = response.headers.get("Retry-After");
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isNaN(seconds) ? undefined : seconds;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
