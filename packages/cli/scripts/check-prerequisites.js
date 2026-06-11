#!/usr/bin/env node
/**
 * Preinstall check for @pax8/cli.
 *
 * Fails the install with a clear error if Node.js is older than the required
 * floor. `package.json`'s `engines.node` will also nag, but a hard preinstall
 * fail is the strongest signal — it stops the install before partial state
 * lands under `node_modules`.
 *
 * Intentionally narrow scope: this checks Node only. An earlier draft also
 * required git, but the CLI does not shell out to git at runtime (no
 * `execSync("git …")` anywhere in `src/`), so requiring git would block npm
 * installs on locked-down endpoints — managed Windows servers, minimal CI
 * containers — for a dependency the runtime doesn't use. If a future feature
 * does shell out to git, add the check then with a runtime-driven rationale.
 */

function compareVersions(version, required) {
  const v = version.split('.').map(Number);
  const r = required.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (v[i] > r[i]) return true;
    if (v[i] < r[i]) return false;
  }
  return true;
}

const nodeVersion = process.versions.node;
const requiredNodeVersion = '20.0.0';

if (!compareVersions(nodeVersion, requiredNodeVersion)) {
  console.error(
    `\n❌ Node.js ${requiredNodeVersion}+ required, but ${nodeVersion} is installed.\n` +
    `   Install Node.js from: https://nodejs.org/\n` +
    `   See README "Prerequisites: Node.js" for OS-specific install shortcuts.\n`
  );
  process.exit(1);
}

console.log(`✓ Node.js ${nodeVersion}`);
