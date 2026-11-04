// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, afterEach } from "vitest";
import {
  classifyInstallPath,
  getInstallInfo,
  type InstallMethod,
} from "./install-method.js";

describe("classifyInstallPath", () => {
  const cases: Array<[string, InstallMethod]> = [
    // Homebrew — both Intel and Apple-silicon prefixes contain /Cellar/.
    ["/usr/local/Cellar/pax8/0.1.6/libexec/dist/index.js", "homebrew"],
    ["/opt/homebrew/Cellar/pax8/0.1.6/libexec/dist/index.js", "homebrew"],
    ["/home/linuxbrew/.linuxbrew/bin/pax8", "homebrew"],
    // npx one-shot cache.
    ["/Users/x/.npm/_npx/abc123/node_modules/@pax8/cli/dist/index.js", "npx"],
    // pnpm global store.
    ["/Users/x/Library/pnpm/global/5/node_modules/@pax8/cli/dist/index.js", "pnpm-global"],
    ["/Users/x/.local/share/pnpm/global/5/.pnpm/@pax8+cli/node_modules/@pax8/cli/dist/index.js", "pnpm-global"],
    // yarn global.
    ["/Users/x/.yarn/global/node_modules/@pax8/cli/dist/index.js", "yarn-global"],
    // Plain npm global.
    ["/usr/local/lib/node_modules/@pax8/cli/dist/index.js", "npm-global"],
    ["/Users/x/.nvm/versions/node/v20.0.0/lib/node_modules/@pax8/cli/dist/index.js", "npm-global"],
    // Windows-style npm global (backslashes normalized).
    ["C:\\Users\\x\\AppData\\Roaming\\npm\\node_modules\\@pax8\\cli\\dist\\index.js", "npm-global"],
    // No recognizable marker.
    ["/some/random/checkout/packages/cli/dist/index.js", "unknown"],
    ["", "unknown"],
  ];

  for (const [input, expected] of cases) {
    it(`classifies ${input || "(empty)"} as ${expected}`, () => {
      expect(classifyInstallPath(input)).toBe(expected);
    });
  }
});

describe("getInstallInfo", () => {
  const original = process.env.PAX8_UPGRADE_METHOD;
  afterEach(() => {
    if (original === undefined) delete process.env.PAX8_UPGRADE_METHOD;
    else process.env.PAX8_UPGRADE_METHOD = original;
  });

  it("honors the PAX8_UPGRADE_METHOD seam and builds an auto-runnable npm command", () => {
    process.env.PAX8_UPGRADE_METHOD = "npm-global";
    const info = getInstallInfo();
    expect(info.method).toBe("npm-global");
    expect(info.manager).toBe("npm");
    expect(info.upgradeArgs).toEqual(["npm", "i", "-g", "@pax8/cli@latest"]);
    expect(info.upgradeCommand).toBe("npm i -g @pax8/cli@latest");
  });

  it("uses `brew upgrade` for a Homebrew install", () => {
    process.env.PAX8_UPGRADE_METHOD = "homebrew";
    const info = getInstallInfo();
    expect(info.upgradeArgs).toEqual(["brew", "upgrade", "pax8"]);
  });

  it("refuses to auto-run for npx and unknown installs", () => {
    process.env.PAX8_UPGRADE_METHOD = "npx";
    expect(getInstallInfo().upgradeArgs).toBeNull();
    process.env.PAX8_UPGRADE_METHOD = "unknown";
    const unknown = getInstallInfo();
    expect(unknown.upgradeArgs).toBeNull();
    // still offers best-effort human guidance
    expect(unknown.upgradeCommand).toContain("@pax8/cli");
  });
});
