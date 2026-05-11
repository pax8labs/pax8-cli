// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import {
  AuthError,
  RateLimitError,
  ValidationError,
  ApiError,
  ERROR_AUTH_EXPIRED,
  ERROR_RATE_LIMITED,
  ERROR_API_VALIDATION,
  ERROR_API_TIMEOUT,
  ERROR_NOT_FOUND,
  ERROR_INTERNAL,
  isApiTimeoutError,
  type Pax8ErrorCode,
} from "@pax8/core";
import { CliError } from "./errors.js";

/**
 * Map an arbitrary thrown value to a canonical `Pax8ErrorCode`. The README's
 * Telemetry table promises `error_code` is one of the `ERROR_*` constants from
 * `@pax8/core`; this is the function that keeps that promise.
 *
 * If the error is already a `CliError` carrying a code, prefer that — it's
 * the authoritative value set at the throw site.
 */
export function classifyError(error: unknown): Pax8ErrorCode {
  if (error instanceof CliError && error.code) return error.code;
  if (error instanceof AuthError) return ERROR_AUTH_EXPIRED;
  if (error instanceof RateLimitError) return ERROR_RATE_LIMITED;
  if (error instanceof ValidationError) return ERROR_API_VALIDATION;
  if (error instanceof ApiError) {
    // #199: client-side AbortController timeout also classifies as
    // ERROR_API_TIMEOUT (status === 0 with "timed out" in the message).
    if (isApiTimeoutError(error)) return ERROR_API_TIMEOUT;
    if (error.statusCode === 408) return ERROR_API_TIMEOUT;
    if (error.statusCode === 401 || error.statusCode === 403) {
      return ERROR_AUTH_EXPIRED;
    }
    if (error.statusCode === 404) return ERROR_NOT_FOUND;
    if (error.statusCode === 429) return ERROR_RATE_LIMITED;
    return ERROR_INTERNAL;
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes("econnrefused") ||
      msg.includes("enotfound") ||
      msg.includes("etimedout") ||
      msg.includes("fetch failed") ||
      msg.includes("network")
    ) {
      return ERROR_API_TIMEOUT;
    }
  }
  return ERROR_INTERNAL;
}

