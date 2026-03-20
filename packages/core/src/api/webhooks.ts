import type { Pax8Client } from "./client.js";
import { z } from "zod";
import {
  WebhookSchema,
  WebhookLogSchema,
  type Webhook,
  type WebhookLog,
  type CreateWebhookInput,
  type UpdateWebhookInput,
} from "./types.js";

export class WebhooksApi {
  constructor(private client: Pax8Client) {}

  async list(): Promise<Webhook[]> {
    const raw = await this.client.get<unknown>("/webhooks");
    return z.array(WebhookSchema).parse(raw);
  }

  async create(data: CreateWebhookInput): Promise<Webhook> {
    const raw = await this.client.post<unknown>("/webhooks", data);
    return WebhookSchema.parse(raw);
  }

  async get(id: string): Promise<Webhook> {
    const raw = await this.client.get<unknown>(`/webhooks/${id}`);
    return WebhookSchema.parse(raw);
  }

  async update(id: string, data: UpdateWebhookInput): Promise<Webhook> {
    const raw = await this.client.put<unknown>(`/webhooks/${id}`, data);
    return WebhookSchema.parse(raw);
  }

  async updateStatus(id: string, status: string): Promise<Webhook> {
    const raw = await this.client.patch<unknown>(`/webhooks/${id}`, { status });
    return WebhookSchema.parse(raw);
  }

  async delete(id: string): Promise<void> {
    await this.client.delete(`/webhooks/${id}`);
  }

  async test(id: string): Promise<unknown> {
    return this.client.post<unknown>(`/webhooks/${id}/test`, {});
  }

  async getLogs(id: string): Promise<WebhookLog[]> {
    const raw = await this.client.get<unknown>(`/webhooks/${id}/logs`);
    return z.array(WebhookLogSchema).parse(raw);
  }

  async retryLog(id: string, logId: string): Promise<unknown> {
    return this.client.post<unknown>(`/webhooks/${id}/logs/${logId}/retry`, {});
  }
}
