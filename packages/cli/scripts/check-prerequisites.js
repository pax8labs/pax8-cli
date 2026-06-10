#!/usr/bin/env node
/**
 * Preinstall check for @pax8/cli
 * Verifies Node.js and Git are available before installation proceeds
 */

import { execSync } from 'child_process';

let hasErrors = false;

function checkCommand(command, versionFlag = '--version') {
  try {
    execSync(`${command} ${versionFlag}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function getVersion(command, versionFlag = '--version') {
  try {
    const output = execSync(`${command} ${versionFlag}`, { encoding: 'utf8' }).trim();
    const match = output.match(/v?(\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function compareVersions(version, required) {
  const v = version.split('.').map(Number);
  const r = required.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (v[i] > r[i]) return true;
    if (v[i] < r[i]) return false;
  }
  return true;
}

// Check Node.js
const nodeVersion = process.versions.node;
const requiredNodeVersion = '20.0.0';

if (!compareVersions(nodeVersion, requiredNodeVersion)) {
  console.error(
    `\n❌ Node.js version ${requiredNodeVersion}+ required, but ${nodeVersion} is installed\n` +
    `   Install Node.js from: https://nodejs.org/\n`
  );
  hasErrors = true;
} else {
  console.log(`✓ Node.js ${nodeVersion}`);
}

// Check Git
if (!checkCommand('git')) {
  console.error(
    `\n❌ Git is not installed or not in PATH\n` +
    `   Install Git from: https://git-scm.com/\n`
  );
  hasErrors = true;
} else {
  const gitVersion = getVersion('git');
  console.log(`✓ Git ${gitVersion}`);
}

if (hasErrors) {
  console.error(`Please install the missing prerequisites and try again.\n`);
  process.exit(1);
}

console.log('\n✓ All prerequisites met\n');
