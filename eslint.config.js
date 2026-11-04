import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import security from "eslint-plugin-security";

// L-9 — `eslint-plugin-security` augments CodeQL's `security-extended` suite
// (which runs at PR time in CI) with lint-time pattern checks that catch
// classes of issue ESLint can flag without dataflow analysis: `eval`,
// `child_process.exec` with non-literal args, regex DoS / unsafe regex,
// non-literal `fs.*` filenames, etc. Many of its rules are necessarily
// heuristic and produce false positives on legitimate code (e.g. dynamic
// fs reads where the path comes from a validated CLI flag). Local
// `// eslint-disable-next-line security/<rule>` comments with a one-line
// justification are the documented escape hatch.
export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  security.configs.recommended,
  {
    files: ["packages/*/src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          // Allow `const { foo, ...rest } = obj` for explicit field omission.
          ignoreRestSiblings: true,
        },
      ],
      "no-console": ["error", { allow: ["error", "warn"] }],
      "no-undef": "off",
      // L-9 — disable noisy security rules that don't carry their weight
      // for a CLI codebase. Each disable is annotated below; if a real
      // issue is suspected in one of these categories, run the rule
      // ad-hoc rather than re-enable it globally.
      //
      // `detect-object-injection`: triggers on any computed property
      // access (`obj[key]`) regardless of whether `key` is attacker-
      // controlled. Pure noise in a TypeScript codebase that types its
      // object shapes. The CodeQL suite covers the real prototype-
      // pollution / injection patterns.
      "security/detect-object-injection": "off",
      // `detect-non-literal-fs-filename`: every fs.* call in the CLI
      // operates on paths derived from user CLI args or the validated
      // config dir. The validated-input invariant is enforced by the
      // separate `local-state-writers.test.ts` policy gate and the
      // `validate-env.ts` home-rooted-path check. Re-flagging every
      // fs.* call here would drown the signal.
      "security/detect-non-literal-fs-filename": "off",
      // `detect-non-literal-regexp`: the redactor and the cmdline
      // tokenizer build regexes from validated, escaped input (see
      // `escapeRegex` in `redactor.ts`). The rule has no way to see
      // that, and would force a disable on every dynamic-regex site.
      "security/detect-non-literal-regexp": "off",
    },
  },
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/*.js", "**/*.cjs", "**/*.mjs"],
  },
);
