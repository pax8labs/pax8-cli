import type { Pax8Client } from "./client.js";
import { z } from "zod";
import {
  ProductSchema,
  ProductPricingResponseSchema,
  ProvisioningDetailSchema,
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

  async get(id: string): Promise<Product> {
    const raw = await this.client.get<unknown>(`/products/${id}`);
    return ProductSchema.parse(raw);
  }

  async getPricing(id: string): Promise<ProductPricing> {
    const raw = await this.client.get<unknown>(`/products/${id}/pricing`);
    const parsed = ProductPricingResponseSchema.parse(raw);
    return parsed.content;
  }


  async getProvisioningDetails(id: string): Promise<ProvisioningDetail> {
    const raw = await this.client.get<unknown>(`/products/${id}/provisioning-details`);
    return ProvisioningDetailSchema.parse(raw);
  }

  async getDependencies(id: string): Promise<ProductDependency[]> {
    const raw = await this.client.get<unknown>(`/products/${id}/dependencies`);
    return z.array(ProductDependencySchema).parse(raw);
  }
}
