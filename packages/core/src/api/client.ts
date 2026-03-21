import { type ZodType } from "zod";
import { ApiError, RateLimitError } from "./errors.js";
import { PageSchema } from "./types.js";
import { FileCache } from "../services/cache.js";

export interface Pax8ClientOptions {
  tokenManager: { getToken(): Promise<string> };
  baseUrl?: string;
  timeout?: number;
  debug?: boolean;
  /** Cache TTL in ms for GET requests. 0 disables caching. Default: 3600000 (1 hour). */
  cacheTtlMs?: number;
}

const DEFAULT_BASE_URL = "https://api.pax8.com/v1";
const DEFAULT_TIMEOUT = 30_000;
const MAX_RETRIES = 3;

export class Pax8Client {
  private readonly tokenManager: { getToken(): Promise<string> };
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly debug: boolean;
  private readonly cache: FileCache | null;
  private readonly cacheTtlMs: number;

  constructor(options: Pax8ClientOptions) {
    this.tokenManager = options.tokenManager;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.debug = options.debug ?? false;
    this.cacheTtlMs = options.cacheTtlMs ?? 3_600_000; // 1 hour default
    this.cache = this.cacheTtlMs > 0 ? new FileCache() : null;
  }

  async get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    if (this.cache) {
      const cacheKey = this.buildCacheKey(path, params);
      const cached = await this.cache.get<T>(cacheKey);
      if (cached !== null) {
        if (this.debug) {
          process.stderr.write(`[pax8] CACHE HIT ${path}\n`);
        }
        return cached;
      }
      const result = await this.request<T>("GET", path, undefined, params);
      await this.cache.set(cacheKey, result, this.cacheTtlMs).catch(() => {});
      return result;
    }
    return this.request<T>("GET", path, undefined, params);
  }

  private buildCacheKey(path: string, params?: Record<string, string | number | undefined>): string {
    const normalized = path.replace(/^\/+/, "");
    const paramStr = params
      ? Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}=${v}`)
          .join("&")
      : "";
    return `${normalized}${paramStr ? "_" + paramStr : ""}`;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body);
  }

  async delete(path: string): Promise<void> {
    await this.request<void>("DELETE", path);
  }

  async *getPaginated<T>(
    path: string,
    params?: Record<string, string | number | undefined>,
    schema?: ZodType,
  ): AsyncIterableIterator<T[]> {
    let page = 0;
    let totalPages = 1;

    while (page < totalPages) {
      const mergedParams = { ...params, page: String(page), size: params?.size ?? "50" };
      const response = await this.get<{ page: { number: number; totalPages: number }; content: T[] }>(
        path,
        mergedParams as Record<string, string | number | undefined>,
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
  ): Promise<T> {
    const url = this.buildUrl(path, params);
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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    init.signal = controller.signal;

    let lastError: Error | undefined;

    try {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          if (this.debug) {
            process.stderr.write(`[pax8] ${method} ${path}\n`);
          }

          const response = await fetch(url.toString(), init);

          if (this.debug) {
            process.stderr.write(`[pax8] ${method} ${path} → ${response.status}\n`);
          }

          if (response.status === 429) {
            if (attempt === MAX_RETRIES) {
              throw new RateLimitError("Rate limit exceeded", path, (parseRetryAfter(response) ?? 60) * 1000);
            }
            const retryAfter = parseRetryAfter(response) ?? (attempt + 1);
            await sleep(retryAfter * 1000);
            continue;
          }

          if (response.status >= 500) {
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
          if (error instanceof ApiError || error instanceof RateLimitError) {
            throw error;
          }
          if (error instanceof DOMException && error.name === "AbortError") {
            throw new ApiError(`Request timed out after ${this.timeout}ms`, 0, path, method);
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

  private buildUrl(path: string, params?: Record<string, string | number | undefined>): URL {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);
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
