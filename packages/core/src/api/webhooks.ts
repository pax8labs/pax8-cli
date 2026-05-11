// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Pax8Client, RequestOpts } from "./client.js";
import { z } from "zod";
import {
  WebhookSchema,
  WebhookLogSchema,
  TopicDefinitionSchema,
  type Webhook,
  type WebhookLog,
  type TopicDefinition,
  type CreateWebhookInput,
  type UpdateWebhookConfigurationInput,
} from "./types.js";

/**
 * Per-call routing options for `WebhooksApi`. Webhooks live at
 * `https://api.pax8.com/api/v2/webhooks/...` per the public webhooks OpenAPI
 * spec — a different *prefix* than the project-wide `/v1` default, not just a
 * swapped version segment. The `Pax8Client` accepts a `RequestOpts` argument
 * with `api` to opt into a per-API base URL override (#321); the call site
 * that constructs the client (e.g. `packages/cli/src/lib/context.ts`)
 * registers `webhooks → https://api.pax8.com/api/v2` in `apiBaseOverrides`.
 * Every method here passes `WEBHOOKS` so the resolved wire URL lands on the
 * documented endpoint. See #322.
 *
 * Body shapes for the write endpoints are tracked separately under #323 and
 * are intentionally not addressed in this layer — this hotfix is wire-path
 * only.
 */
const WEBHOOKS: RequestOpts = { api: "webhooks" };

export class WebhooksApi {
  constructor(private client: Pax8Client) {}

  async list(): Promise<Webhook[]> {
    const raw = await this.client.get<unknown>("/webhooks", undefined, WEBHOOKS);
    return z.array(WebhookSchema).parse(raw);
  }

  async create(data: CreateWebhookInput): Promise<Webhook> {
    const raw = await this.client.post<unknown>("/webhooks", data, WEBHOOKS);
    return WebhookSchema.parse(raw);
  }

  async get(id: string): Promise<Webhook> {
    const raw = await this.client.get<unknown>(`/webhooks/${id}`, undefined, WEBHOOKS);
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
      WEBHOOKS,
    );
    return WebhookSchema.parse(raw);
  }

  /**
   * Toggle the `active` flag on a webhook. Mirrors the `updateStatus`
   * operation (`POST /webhooks/{id}/status`) in webhook-manager v2/v2.1.
   * The wire body is `{ active: boolean }`; the response is the full webhook.
   */
  async setStatus(id: string, active: boolean): Promise<Webhook> {
    const raw = await this.client.post<unknown>(
      `/webhooks/${id}/status`,
      { active },
      WEBHOOKS,
    );
    return WebhookSchema.parse(raw);
  }

  async delete(id: string): Promise<void> {
    await this.client.delete(`/webhooks/${id}`, undefined, WEBHOOKS);
  }

  async test(id: string): Promise<unknown> {
    return this.client.post<unknown>(`/webhooks/${id}/test`, {}, WEBHOOKS);
  }

  /**
   * Send a topic-specific test delivery for a webhook subscription.
   *
   * Maps to `POST /webhooks/{id}/topics/{topic}/test`. Use this when you want
   * to exercise a single topic's payload shape rather than the generic
   * webhook-level `test()` ping.
   */
  async testTopic(id: string, topic: string): Promise<unknown> {
    return this.client.post<unknown>(
      `/webhooks/${id}/topics/${encodeURIComponent(topic)}/test`,
      {},
      WEBHOOKS,
    );
  }

  async getLogs(id: string): Promise<WebhookLog[]> {
    const raw = await this.client.get<unknown>(
      `/webhooks/${id}/logs`,
      undefined,
      WEBHOOKS,
    );
    return z.array(WebhookLogSchema).parse(raw);
  }

  async retryLog(id: string, logId: string): Promise<unknown> {
    return this.client.post<unknown>(
      `/webhooks/${id}/logs/${logId}/retry`,
      {},
      WEBHOOKS,
    );
  }

  /**
   * List all topic definitions the marketplace can deliver to a webhook.
   *
   * Maps to `GET /webhooks/topic-definitions`. The upstream API returns a
   * paginated `{ content, page, ... }` envelope; we follow the same pattern
   * as other CLI-facing list helpers and unwrap to the flat array of
   * `TopicDefinition` records, since the discovery surface is small and
   * agents/humans want a single sortable list.
   */
  async getTopicDefinitions(): Promise<TopicDefinition[]> {
    const raw = await this.client.get<unknown>(
      "/webhooks/topic-definitions",
      { size: 200 },
      WEBHOOKS,
    );
    // Defensive: real API returns a paged envelope, but tolerate a flat
    // array shape too (some staging deployments) so the CLI doesn't break
    // on parity drift.
    if (raw && typeof raw === "object" && "content" in (raw as object)) {
      const content = (raw as { content: unknown }).content;
      return z.array(TopicDefinitionSchema).parse(content);
    }
    return z.array(TopicDefinitionSchema).parse(raw);
  }
}
