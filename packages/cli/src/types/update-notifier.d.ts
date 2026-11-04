// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Minimal ambient typings for `update-notifier@7`. The upstream
 * `@types/update-notifier` (DefinitelyTyped) is pinned at v6 and doesn't
 * track the v7 ESM rewrite (no `Options` import, removed CallbackResult,
 * different `pkg` shape). We only need the surface this repo touches —
 * see `lib/update-check.ts`.
 */
declare module "update-notifier" {
  export interface UpdateInfo {
    latest: string;
    current: string;
    type: "latest" | "major" | "minor" | "patch" | "prerelease" | "build" | string;
    name: string;
  }

  export interface UpdateNotifierOptions {
    pkg: {
      name: string;
      version: string;
    };
    updateCheckInterval?: number;
    shouldNotifyInNpmScript?: boolean;
    distTag?: string;
  }

  export interface UpdateNotifierInstance {
    update?: UpdateInfo;
    config?: {
      path: string;
      get(key: string): unknown;
      set(key: string, value: unknown): void;
    };
    notify(options?: {
      defer?: boolean;
      message?: string;
      isGlobal?: boolean;
      boxenOptions?: Record<string, unknown>;
    }): UpdateNotifierInstance;
    fetchInfo(): Promise<UpdateInfo>;
  }

  export default function updateNotifier(
    options: UpdateNotifierOptions,
  ): UpdateNotifierInstance;
}
