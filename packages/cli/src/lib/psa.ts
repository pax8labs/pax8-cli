// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs/promises";
import path from "node:path";
import {
  classifyWithPsa,
  ConnectWiseProvider,
  createEmptyMappings,
  DemoConnectWiseProvider,
  type PsaClassifiableDiscrepancy,
  type PsaMappingsFile,
  type PsaProvider,
  type PsaProviderName,
  requiredConnectWiseCredentialNames,
} from "@pax8/psa";
import { getConfigDir } from "@pax8/core";
import type { CommandContext } from "./context.js";

export const PSA_MAPPINGS_FILE = "psa-mappings.json";

export function resolvePsaProviderName(
  input: string | true | undefined,
): PsaProviderName | undefined {
  if (input === undefined) return undefined;
  if (input === true || input === "connectwise") return "connectwise";
  throw new Error(`Unsupported PSA provider: ${input}. Supported providers: connectwise`);
}

export function getPsaMappingsPath(): string {
  return path.join(getConfigDir(), PSA_MAPPINGS_FILE);
}

export async function loadPsaMappings(): Promise<PsaMappingsFile> {
  try {
    const raw = await fs.readFile(getPsaMappingsPath(), "utf8");
    const parsed = JSON.parse(raw) as PsaMappingsFile;
    if (parsed.version === "1.0" && Array.isArray(parsed.mappings)) return parsed;
  } catch {
    // Missing or invalid mappings should not break a read-only audit; unmapped
    // output is the useful setup worklist.
  }
  return createEmptyMappings();
}

export async function savePsaMappings(mappings: PsaMappingsFile): Promise<void> {
  const file = getPsaMappingsPath();
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, JSON.stringify(mappings, null, 2) + "\n", { mode: 0o600 });
}

export function buildPsaProvider(
  ctx: CommandContext,
  providerName: PsaProviderName,
  discrepancies: PsaClassifiableDiscrepancy[],
): PsaProvider {
  if (providerName !== "connectwise") throw new Error(`Unsupported PSA provider: ${providerName}`);
  if (ctx.isDemo) {
    return new DemoConnectWiseProvider(
      discrepancies.slice(0, 3).map((d, i) => ({
        agreementId: `demo-agreement-${i + 1}`,
        additionRef: `demo-addition-${i + 1}`,
        quantity:
          i === 0
            ? d.invoicedQuantity
            : i === 1
              ? d.activeQuantity
              : d.activeQuantity + d.invoicedQuantity + 7,
        unitPrice: Math.abs(d.dollarImpact / (d.delta || 1)) || 1,
        currency: "USD",
      })),
    );
  }

  return new ConnectWiseProvider(resolveConnectWiseCredentials(ctx));
}

export function resolveConnectWiseCredentials(ctx: CommandContext): {
  baseUrl?: string;
  companyId?: string;
  publicKey?: string;
  privateKey?: string;
  clientId?: string;
} {
  const cfg = ctx.config.psa?.connectwise;
  // Environment variables intentionally win over persisted config so CI,
  // one-off runs, and secret managers can override `~/.pax8/config.json`
  // without mutating local state. Missing PSA config is fine for every
  // non-PSA command; credentials are validated only when a PSA provider is used.
  return {
    baseUrl: process.env.PAX8_PSA_CONNECTWISE_BASE_URL ?? cfg?.baseUrl,
    companyId: process.env.PAX8_PSA_CONNECTWISE_COMPANY_ID ?? cfg?.companyId,
    publicKey: process.env.PAX8_PSA_CONNECTWISE_PUBLIC_KEY ?? cfg?.publicKey,
    privateKey: process.env.PAX8_PSA_CONNECTWISE_PRIVATE_KEY ?? cfg?.privateKey,
    clientId: process.env.PAX8_PSA_CONNECTWISE_CLIENT_ID ?? cfg?.clientId,
  };
}

export function buildDemoMappings(discrepancies: PsaClassifiableDiscrepancy[]): PsaMappingsFile {
  return {
    version: "1.0",
    mappings: discrepancies.slice(0, 3).map((d, i) => ({
      pax8CompanyId: d.companyId,
      pax8ProductName: d.productName,
      agreementId: `demo-agreement-${i + 1}`,
      additionRef: `demo-addition-${i + 1}`,
    })),
  };
}

export async function classifyAuditDiscrepanciesWithPsa(
  ctx: CommandContext,
  providerName: PsaProviderName,
  discrepancies: PsaClassifiableDiscrepancy[],
): Promise<Awaited<ReturnType<typeof classifyWithPsa>>> {
  const mappings = ctx.isDemo ? buildDemoMappings(discrepancies) : await loadPsaMappings();
  const provider = buildPsaProvider(ctx, providerName, discrepancies);
  return classifyWithPsa(provider, discrepancies, mappings, { currency: "USD" });
}

export function describeConnectWiseCredentialHelp(): string[] {
  return requiredConnectWiseCredentialNames().map(
    (name) => `PAX8_PSA_CONNECTWISE_${name.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`,
  );
}
