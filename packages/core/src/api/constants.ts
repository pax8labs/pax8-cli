// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Page size used by commands that need to fetch "all" subscriptions
 * across an entire portfolio (status, audit, recommendations, MRR
 * reports, renewals, etc.).
 *
 * Per-company subscription fetches should use a smaller, appropriate
 * page size — this constant is only for portfolio-wide pulls.
 */
export const ALL_SUBS_PAGE_SIZE = 1000;
