// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

export const ConfigSchema = z.object({
  version: z.literal("1.0"),
  demo: z.boolean().optional(),
  auth: z
    .object({
      client_id: z.string().optional(),
    })
    .optional(),
  defaults: z
    .object({
      output_format: z.enum(["table", "json", "csv"]).default("table"),
      page_size: z.number().min(1).max(100).default(50),
      confirm_destructive: z.boolean().default(true),
    })
    .prefault({}),
  cache: z
    .object({
      enabled: z.boolean().default(false),
      ttl_hours: z.number().default(24),
    })
    .prefault({}),
  telemetry: z
    .object({
      enabled: z.boolean().default(false),
      // True once the partner has answered the first-run consent prompt
      // (or run `telemetry enable|disable`). Distinguishes "chose no" from
      // "never asked" — both have `enabled: false`.
      asked: z.boolean().default(false),
    })
    .prefault({}),
});

export type Config = z.infer<typeof ConfigSchema>;
