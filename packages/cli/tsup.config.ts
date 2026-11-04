import { defineConfig } from "tsup";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  clean: true,
  // Source maps are required so v8 subprocess coverage (collected via
  // NODE_V8_COVERAGE while running the bundled dist/index.js) can be
  // remapped back to the original .ts sources during test:coverage.
  sourcemap: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
  define: {
    __CLI_VERSION__: JSON.stringify(pkg.version),
  },
  // #720: `pax8 skill install` reads the Claude skill out of the package
  // at runtime, so the canonical `packages/claude-skill/skill.md` has to
  // land in `dist/` (which is what `files` packs). See scripts/bundle-skill.mjs.
  onSuccess: "node scripts/bundle-skill.mjs",
});
