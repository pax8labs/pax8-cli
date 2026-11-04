// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { ConfigSchema } from "./schema.js";

describe("ConfigSchema", () => {
  it("populates nested defaults when config sections are missing", () => {
    expect(ConfigSchema.parse({ version: "1.0" })).toEqual({
      version: "1.0",
      defaults: { output_format: "table", page_size: 50, confirm_destructive: true },
      cache: { enabled: false, ttl_hours: 24 },
      telemetry: { enabled: false },
    });
  });

  it("preserves user settings while filling omitted nested settings", () => {
    const config = ConfigSchema.parse({
      version: "1.0",
      defaults: { output_format: "json" },
      cache: { enabled: true },
    });
    expect(config.defaults).toEqual({ output_format: "json", page_size: 50, confirm_destructive: true });
    expect(config.cache).toEqual({ enabled: true, ttl_hours: 24 });
  });
});
