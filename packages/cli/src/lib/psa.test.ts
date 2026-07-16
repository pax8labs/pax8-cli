// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it } from "vitest";
import { resolveConnectWiseCredentials, resolvePsaProviderName } from "./psa.js";
import type { CommandContext } from "./context.js";

const ENV_KEYS = [
  "PAX8_PSA_CONNECTWISE_BASE_URL",
  "PAX8_PSA_CONNECTWISE_COMPANY_ID",
  "PAX8_PSA_CONNECTWISE_PUBLIC_KEY",
  "PAX8_PSA_CONNECTWISE_PRIVATE_KEY",
  "PAX8_PSA_CONNECTWISE_CLIENT_ID",
] as const;

function ctx(config: CommandContext["config"]): CommandContext {
  return { config } as CommandContext;
}

describe("PSA CLI helpers", () => {
  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it("defaults --psa to connectwise and lists supported providers on errors", () => {
    expect(resolvePsaProviderName(undefined)).toBeUndefined();
    expect(resolvePsaProviderName(true)).toBe("connectwise");
    expect(resolvePsaProviderName("connectwise")).toBe("connectwise");
    expect(() => resolvePsaProviderName("autotask")).toThrow(/Supported providers: connectwise/);
  });

  it("lets ConnectWise environment variables override persisted config", () => {
    process.env.PAX8_PSA_CONNECTWISE_BASE_URL = "https://env.example.test";
    process.env.PAX8_PSA_CONNECTWISE_PRIVATE_KEY = "env-private";

    expect(
      resolveConnectWiseCredentials(
        ctx({
          psa: {
            connectwise: {
              baseUrl: "https://config.example.test",
              companyId: "config-company",
              publicKey: "config-public",
              privateKey: "config-private",
              clientId: "config-client",
            },
          },
        }),
      ),
    ).toEqual({
      baseUrl: "https://env.example.test",
      companyId: "config-company",
      publicKey: "config-public",
      privateKey: "env-private",
      clientId: "config-client",
    });
  });

  it("does not require PSA config when no PSA provider is used", () => {
    expect(resolveConnectWiseCredentials(ctx({}))).toEqual({
      baseUrl: undefined,
      companyId: undefined,
      publicKey: undefined,
      privateKey: undefined,
      clientId: undefined,
    });
  });
});
