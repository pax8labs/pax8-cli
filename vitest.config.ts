import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/*/src/**/*.test.ts", "e2e/**/*.test.ts"],
    // #262: tests routinely point PAX8_CONFIG_DIR at `os.tmpdir()` (which
    // resolves outside `os.homedir()` on macOS / Linux) for isolation. The
    // new validateConfigDir() guard would reject those by default, so opt
    // every test worker (and every subprocess spawned by `runCli`) into
    // the explicit escape hatch. Production users without this var get
    // the strict default.
    env: {
      PAX8_ALLOW_NON_HOME_CONFIG: "1",
    },
    // Sets NODE_V8_COVERAGE on the parent so child processes spawned by
    // `runCli()` deposit their v8 profiles into a known directory, which the
    // custom coverage provider then merges into the final report.
    globalSetup: ["./vitest.coverage-setup.ts"],
    coverage: {
      // Custom provider wraps the standard v8 provider and additionally
      // ingests subprocess coverage profiles. See vitest.coverage-provider.ts.
      provider: "custom",
      customProviderModule: "./vitest.coverage-provider.ts",
      // dist/**/*.js is included so subprocess v8 profiles (which point at
      // the built CLI) survive the pre-remap include filter; their coverage
      // is then remapped through the bundle's source map onto the original
      // .ts files. excludeAfterRemap then re-runs the include/exclude check
      // post-remap so the dist files don't appear in the final report.
      include: ["packages/*/src/**/*.ts", "packages/*/dist/**/*.js"],
      exclude: [
        "**/*.test.ts",
        "**/__tests__/**",
        "**/node_modules/**",
        // claude-skill is a Claude Code skill manifest package, not runtime
        // code shipped in the CLI; it has no tests by design.
        "packages/claude-skill/**",
      ],
      excludeAfterRemap: true,
      // Honest coverage thresholds for v0.1.0. Tests run via runCli() spawn
      // the built CLI in a subprocess; child v8 profiles are merged via the
      // custom provider, so these numbers reflect end-to-end execution.
      // Set at "current floor minus ~2 points" to lock in the current bar
      // with a small headroom for normal run-to-run variation. Raise these
      // as additional command tests land.
      thresholds: {
        statements: 60,
        branches: 42,
        functions: 65,
        lines: 60,
      },
    },
    testTimeout: 30000,
    passWithNoTests: true,
  },
});
