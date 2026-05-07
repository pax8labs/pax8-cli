// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Pax8Client } from "./client.js";
import { z } from "zod";
import {
  WebhookSchema,
  WebhookLogSchema,
  type Webhook,
  type WebhookLog,
  type CreateWebhookInput,
  type UpdateWebhookInput,
  type UpdateWebhookConfigurationInput,
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

  /**
   * Update mutable configuration fields on a webhook. Mirrors the
   * `updateConfiguration` operation (`POST /webhooks/{id}/configuration`) in
   * webhook-manager v2/v2.1.
   */
  async updateConfiguration(
    id: string,
    data: UpdateWebhookConfigurationInput,
  ): Promise<Webhook> {
    const raw = await this.client.post<unknown>(
      `/webhooks/${id}/configuration`,
      data,
    );
    return WebhookSchema.parse(raw);
  }

  /**
   * Toggle the `active` flag on a webhook. Mirrors the `updateStatus`
   * operation (`POST /webhooks/{id}/status`) in webhook-manager v2/v2.1.
   * The wire body is `{ active: boolean }`; the response is the full webhook.
   */
  async setStatus(id: string, active: boolean): Promise<Webhook> {
    const raw = await this.client.post<unknown>(`/webhooks/${id}/status`, { active });
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
