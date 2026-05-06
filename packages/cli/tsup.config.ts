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
});
