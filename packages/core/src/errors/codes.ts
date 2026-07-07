// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Machine-readable error codes for pax8-cli.
 *
 * Codes are stable identifiers carried on `CliError` instances and surfaced in
 * the structured `--json` error envelope. They let agents (and humans writing
 * scripts) decide whether to retry, re-auth, or escalate without regex-matching
 * English error strings.
 *
 * **Append-only.** Never repurpose an existing code, even for a "near-match"
 * failure mode. If you need a new code, add a new constant.
 */

export const ERROR_AUTH_EXPIRED = "ERROR_AUTH_EXPIRED";
export const ERROR_AUTH_MISSING = "ERROR_AUTH_MISSING";
export const ERROR_COMPANY_NOT_FOUND = "ERROR_COMPANY_NOT_FOUND";
export const ERROR_PRODUCT_NOT_FOUND = "ERROR_PRODUCT_NOT_FOUND";
export const ERROR_SUBSCRIPTION_NOT_FOUND = "ERROR_SUBSCRIPTION_NOT_FOUND";
export const ERROR_RATE_LIMITED = "ERROR_RATE_LIMITED";
export const ERROR_API_TIMEOUT = "ERROR_API_TIMEOUT";
export const ERROR_API_VALIDATION = "ERROR_API_VALIDATION";
export const ERROR_INVALID_INPUT = "ERROR_INVALID_INPUT";
export const ERROR_NOT_AUTHORIZED = "ERROR_NOT_AUTHORIZED";
export const ERROR_NOT_FOUND = "ERROR_NOT_FOUND";
export const ERROR_INTERNAL = "ERROR_INTERNAL";
export const ERROR_QUOTE_LINE_ITEM_NOT_FOUND = "ERROR_QUOTE_LINE_ITEM_NOT_FOUND";
/**
 * The user interrupted the command (Ctrl+C / SIGINT) before it completed.
 * Carried on the synthetic `command_executed` event emitted by the SIGINT
 * handler so the telemetry stream distinguishes user-cancellations from
 * real failures.
 */
export const ERROR_CANCELLED = "ERROR_CANCELLED";
/**
 * `pax8 explain <term>` was passed a term that is not in the built-in
 * glossary. The error envelope carries the original input and up to
 * three fuzzy-matched suggestions so agents can either retry with the
 * suggested slug or escalate.
 */
export const ERROR_TERM_NOT_FOUND = "ERROR_TERM_NOT_FOUND";

/**
 * Union of all known Pax8 CLI error codes. Use this for exhaustive switch
 * statements in agent-facing consumers.
 */
export type Pax8ErrorCode =
  | typeof ERROR_AUTH_EXPIRED
  | typeof ERROR_AUTH_MISSING
  | typeof ERROR_COMPANY_NOT_FOUND
  | typeof ERROR_PRODUCT_NOT_FOUND
  | typeof ERROR_SUBSCRIPTION_NOT_FOUND
  | typeof ERROR_RATE_LIMITED
  | typeof ERROR_API_TIMEOUT
  | typeof ERROR_API_VALIDATION
  | typeof ERROR_INVALID_INPUT
  | typeof ERROR_NOT_AUTHORIZED
  | typeof ERROR_NOT_FOUND
  | typeof ERROR_INTERNAL
  | typeof ERROR_QUOTE_LINE_ITEM_NOT_FOUND
  | typeof ERROR_CANCELLED
  | typeof ERROR_TERM_NOT_FOUND;
