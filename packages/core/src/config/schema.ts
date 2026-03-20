import { z } from "zod";

export const ConfigSchema = z.object({
  version: z.literal("1.0"),
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
    .default({}),
  cache: z
    .object({
      enabled: z.boolean().default(true),
      ttl_hours: z.number().default(24),
    })
    .default({}),
  telemetry: z
    .object({
      enabled: z.boolean().default(false),
    })
    .default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
