// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Pax8Client } from "./client.js";
import { z } from "zod";
import {
  ProductSchema,
  ProductPricingResponseSchema,
  ProvisioningDetailResponseSchema,
  ProductDependencySchema,
  PaginatedResponseSchema,
  type Product,
  type ProductPricing,
  type ProvisioningDetail,
  type ProductDependency,
  type PaginatedResponse,
} from "./types.js";

const PaginatedProductSchema = PaginatedResponseSchema(ProductSchema);

export class ProductsApi {
  constructor(private client: Pax8Client) {}

  async list(params?: {
    page?: number;
    size?: number;
    vendorName?: string;
    search?: string;
  }): Promise<PaginatedResponse<Product>> {
    const raw = await this.client.get<unknown>("/products", params as Record<string, string | number | undefined>);
    return PaginatedProductSchema.parse(raw);
  }

  /**
   * Search products by free-text query. Convenience wrapper over `list()`
   * that mirrors the upstream API's single-keyword behavior: passes the
   * longest token to the upstream `search` param and lets the caller
   * filter the rest client-side if needed.
   */
  async search(query: string, params?: {
    page?: number;
    size?: number;
    vendorName?: string;
  }): Promise<PaginatedResponse<Product>> {
    const tokens = query.split(/\s+/).filter(Boolean);
    const apiKeyword = tokens.reduce(
      (best, t) => (t.length >= best.length ? t : best),
      "",
    );
    return this.list({
      ...params,
      search: apiKeyword || undefined,
    });
  }

  async get(id: string): Promise<Product> {
    const raw = await this.client.get<unknown>(`/products/${id}`);
    return ProductSchema.parse(raw);
  }

  async getPricing(id: string): Promise<ProductPricing> {
    const raw = await this.client.get<unknown>(`/products/${id}/pricing`);
    const parsed = ProductPricingResponseSchema.parse(raw);
    return parsed.content;
  }


  async getProvisioningDetails(id: string): Promise<ProvisioningDetail[]> {
    const raw = await this.client.get<unknown>(`/products/${id}/provision-details`);
    const parsed = ProvisioningDetailResponseSchema.parse(raw);
    return parsed.content;
  }

  async getDependencies(id: string): Promise<ProductDependency[]> {
    const raw = await this.client.get<unknown>(`/products/${id}/dependencies`);
    return z.array(ProductDependencySchema).parse(raw);
  }
}
