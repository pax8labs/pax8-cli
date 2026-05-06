/**
 * Custom Vitest coverage provider that aggregates v8 coverage from spawned
 * subprocesses (e.g. the built CLI invoked via `runCli()` in the test suite)
 * alongside the in-process coverage that the standard `@vitest/coverage-v8`
 * provider already collects.
 *
 * How it works
 * ------------
 * 1. `globalSetup` (vitest.coverage-setup.ts) sets `process.env.NODE_V8_COVERAGE`
 *    on the parent vitest process to a known directory before any tests run.
 *    Since `runCli()` inherits `process.env`, every spawned child also writes
 *    its v8 coverage profile into that directory on exit.
 * 2. We wrap `generateCoverage` to slurp every `coverage-*.json` file from
 *    that directory and feed it back into the provider's existing coverage
 *    queue via `onAfterSuiteRun`. The standard provider then runs each
 *    profile through its source-map-aware `convertCoverage` pipeline.
 * 3. coverage.include in vitest.config.ts also matches packages dist
 *    output, so subprocess profiles (which reference the bundled CLI) survive
 *    the pre-remap include filter. We override `getSources` so vitest can
 *    read sibling `.map` files for those bundles, then
 *    `excludeAfterRemap: true` re-applies the filter against the remapped
 *    source paths so dist files don't appear in the final report.
 *
 * The bundled CLI emits source maps (see tsup configs); without those, the
 * dist coverage cannot be remapped back to the .ts sources.
 */
import { existsSync, promises as fs, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import V8Provider from "@vitest/coverage-v8";
import type { CoverageProviderModule } from "vitest/node";

function getSubprocessCoverageDir(): string | undefined {
  return process.env.PAX8_SUBPROCESS_COVERAGE_DIR;
}

function isSubprocessCoverageFile(name: string): boolean {
  return name.startsWith("coverage-") && name.endsWith(".json");
}

interface ScriptCoverageEntry {
  url?: string;
  scriptId?: string;
  functions?: unknown[];
}

const mod: CoverageProviderModule = {
  ...V8Provider,
  async getProvider() {
    const provider = await V8Provider.getProvider();

    // -- Override getSources -------------------------------------------------
    // The base implementation only knows how to fetch a source map via vite's
    // transform pipeline. Subprocess coverage references the bundled CLI on
    // disk, which vite doesn't transform — so we need to load the sibling
    // ".map" file ourselves. If vite does return a transform result we keep
    // it (inline maps, etc.); otherwise we fall back to the .map file.
    const providerAny = provider as unknown as {
      getSources?: (
        url: string,
        onTransform: (filepath: string) => Promise<unknown>,
        functions?: unknown[]
      ) => Promise<{ code: string; map?: unknown }>;
    };
    const originalGetSources = providerAny.getSources?.bind(provider);
    if (originalGetSources) {
      providerAny.getSources = async function (url, onTransform, functions) {
        const result = await originalGetSources(url, onTransform, functions);
        if (result?.map || !url.startsWith("file://")) return result;
        // Try to load a sibling .map file from disk.
        try {
          const filePath = fileURLToPath(url);
          const mapPath = `${filePath}.map`;
          if (existsSync(mapPath)) {
            const mapJson = await fs.readFile(mapPath, "utf-8");
            const map = JSON.parse(mapJson);
            return { code: result.code, map };
          }
        } catch {
          // fall through and return the un-mapped result
        }
        return result;
      };
    }

    // -- Override generateCoverage ------------------------------------------
    const originalGenerate =
      provider.generateCoverage?.bind(provider) ?? (async () => undefined);

    provider.generateCoverage = async function (
      this: typeof provider,
      ctx: Parameters<typeof originalGenerate>[0]
    ) {
      const dir = getSubprocessCoverageDir();
      if (dir && existsSync(dir)) {
        const entries = readdirSync(dir).filter(isSubprocessCoverageFile);
        let merged = 0;
        for (const entry of entries) {
          const filePath = join(dir, entry);
          try {
            const stat = await fs.stat(filePath);
            // Skip zero-byte files. These are produced when a subprocess is
            // killed (e.g. SIGINT/SIGTERM tests) mid-write; the v8 profile
            // never landed.
            if (stat.size === 0) continue;
            const raw = await fs.readFile(filePath, "utf-8");
            const parsed = JSON.parse(raw) as {
              result?: ScriptCoverageEntry[];
            };
            if (!parsed?.result || parsed.result.length === 0) continue;
            // Filter out entries that would crash convertCoverage (empty/
            // missing url, node: builtins, node_modules) before we hand the
            // profile to the base provider.
            parsed.result = parsed.result.filter(
              (r) =>
                typeof r?.url === "string" &&
                r.url.startsWith("file://") &&
                !r.url.includes("/node_modules/")
            );
            if (parsed.result.length === 0) continue;
            // Re-use vitest's per-suite hook to register the coverage data;
            // each subprocess profile is treated as one synthetic "suite".
            (
              this as { onAfterSuiteRun?: (arg: unknown) => void }
            ).onAfterSuiteRun?.({
              coverage: parsed,
              environment: "node",
              projectName: undefined,
              testFiles: [`__subprocess__/${entry}`],
            });
            merged++;
          } catch (error) {
            // Don't fail the whole coverage run on a malformed profile.
            // eslint-disable-next-line no-console
            console.warn(
              `[subprocess-coverage] Skipping ${entry}:`,
              (error as Error).message
            );
          }
        }
        if (merged > 0) {
          // eslint-disable-next-line no-console
          console.log(
            `[subprocess-coverage] Merged ${merged} subprocess v8 profile(s) from ${dir}`
          );
        }
      }
      return originalGenerate(ctx);
    } as typeof provider.generateCoverage;

    return provider;
  },
};

export default mod;
