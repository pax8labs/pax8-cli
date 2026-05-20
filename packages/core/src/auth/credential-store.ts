// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { safeWriteFileSync } from "../security/safe-write.js";
import { getConfigDir } from "../config/loader.js";

const execFileAsync = promisify(execFile);

// #504: do NOT cache the config dir or credentials path at module load.
// `getConfigDir()` resolves `PAX8_CONFIG_DIR` lazily and validates it via
// `validateConfigDir` — capturing the home-dir-derived path at import
// time bypassed that env override silently (every other state writer in
// the CLI honored it; only credentials landed in the real `~/.pax8`).
// The single-file/dir helpers below resolve fresh on each call.
function configDir(): string {
  return getConfigDir();
}

function credentialsFile(): string {
  return path.join(configDir(), "credentials.json");
}

const isWindows = process.platform === "win32";

export interface Credentials {
  clientId: string;
  clientSecret: string;
}

export interface PermissionCheckResult {
  secure: boolean;
  detail: string;
}

export class CredentialStore {
  /**
   * Returns the path to the credentials file.
   */
  static get credentialsFilePath(): string {
    return credentialsFile();
  }

  /**
   * Returns the path to the config directory.
   */
  static get configDirPath(): string {
    return configDir();
  }

  /**
   * Returns credentials from the highest-priority source available.
   * Priority: env vars > file (~/.pax8/credentials.json)
   */
  async getCredentials(): Promise<Credentials | null> {
    // 1. Try environment variables
    const envCreds = this.getFromEnv();
    if (envCreds) return envCreds;

    // 2. Try file
    return this.getFromFile();
  }

  /**
   * Fast check for whether any credential source is configured. Does NOT
   * read or parse the file — just verifies the env vars or that the file
   * exists. Intended for UX branching on the welcome screen, where we
   * need a sub-millisecond answer and don't care about content validity.
   *
   * Returns false on any error (missing file, permission denied, etc.).
   */
  async hasCredentials(): Promise<boolean> {
    if (this.getFromEnv() !== null) return true;
    try {
      await fs.access(credentialsFile(), constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Saves credentials to ~/.pax8/credentials.json with secure permissions.
   * On Unix: chmod 700 on dir, chmod 600 on file.
   * On Windows: restrict ACLs to the current user via icacls.
   */
  async saveCredentials(clientId: string, clientSecret: string): Promise<void> {
    const dir = configDir();
    const file = credentialsFile();
    await fs.mkdir(dir, { recursive: true });

    if (isWindows) {
      await this.secureDirectoryWindows(dir);
    } else {
      // Secure the directory: owner-only access
      await fs.chmod(dir, 0o700);
    }

    const data = JSON.stringify({ clientId, clientSecret }, null, 2);
    // #262: use the safe-write helper so an existing symlink at the
    // credentials path causes the write to fail (ELOOP) rather than
    // landing the credentials at the symlink's target. The 0o600 mode is
    // applied atomically at file-creation time, eliminating the small
    // window where an old `writeFile + chmod` flow had default perms.
    safeWriteFileSync(file, data);

    if (isWindows) {
      await this.secureFileWindows(file);
    }
  }

  /**
   * Removes the credentials file.
   */
  async clearCredentials(): Promise<void> {
    try {
      await fs.unlink(credentialsFile());
    } catch (err) {
      // Ignore ENOENT — file doesn't exist, nothing to clear
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }

  /**
   * Checks whether the credential file has secure permissions.
   * Returns a result indicating whether the file is secure.
   */
  async checkPermissions(): Promise<PermissionCheckResult> {
    try {
      await fs.access(credentialsFile(), constants.F_OK);
    } catch {
      return { secure: true, detail: "No credentials file (using env vars or not configured)" };
    }

    if (isWindows) {
      return this.checkPermissionsWindows();
    }
    return this.checkPermissionsUnix();
  }

  private async checkPermissionsUnix(): Promise<PermissionCheckResult> {
    const file = credentialsFile();
    try {
      const stat = await fs.stat(file);
      // mode & 0o777 gives the permission bits
      const perms = stat.mode & 0o777;
      if (perms === 0o600) {
        return { secure: true, detail: "Permissions 600 (owner read/write only)" };
      }
      // Check if group or other have any access
      const groupOther = perms & 0o077;
      if (groupOther !== 0) {
        return {
          secure: false,
          detail: `Permissions ${perms.toString(8)} — group/other have access. Run: chmod 600 ${file}`,
        };
      }
      // Owner has execute but no group/other access — acceptable but not ideal
      return { secure: true, detail: `Permissions ${perms.toString(8)} (owner-only access)` };
    } catch (err) {
      return {
        secure: false,
        detail: `Could not stat credentials file: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private async checkPermissionsWindows(): Promise<PermissionCheckResult> {
    const file = credentialsFile();
    try {
      // Use icacls to inspect ACLs
      const { stdout } = await execFileAsync("icacls", [file]);
      // Check that the file is in a user-profile directory
      const homeDir = os.homedir();
      const inUserDir = file.toLowerCase().startsWith(homeDir.toLowerCase());
      if (!inUserDir) {
        return {
          secure: false,
          detail: "Credentials file is outside user home directory",
        };
      }
      // Check for BUILTIN\\Users or Everyone with access (common insecure patterns)
      const insecurePatterns = ["BUILTIN\\Users", "Everyone", "Authenticated Users"];
      const hasInsecureAcl = insecurePatterns.some(
        (pattern) => stdout.includes(pattern) && !stdout.includes(`${pattern}:(DENY)`),
      );
      if (hasInsecureAcl) {
        return {
          secure: false,
          detail: `File may be readable by other users. Run: icacls "${file}" /inheritance:r /grant:r "%USERNAME%:F"`,
        };
      }
      return { secure: true, detail: "File ACLs restrict access (Windows)" };
    } catch {
      // icacls not available or errored — fall back to directory check
      const homeDir = os.homedir();
      const inUserDir = file.toLowerCase().startsWith(homeDir.toLowerCase());
      if (inUserDir) {
        return {
          secure: true,
          detail: "In user home directory (could not verify ACLs)",
        };
      }
      return {
        secure: false,
        detail: "Credentials file is outside user home directory and ACLs could not be verified",
      };
    }
  }

  /**
   * On Windows, restrict file access to the current user using icacls.
   */
  private async secureFileWindows(filePath: string): Promise<void> {
    try {
      const username = os.userInfo().username;
      // Remove inherited permissions and grant only the current user full control
      await execFileAsync("icacls", [
        filePath,
        "/inheritance:r",
        "/grant:r",
        `${username}:(F)`,
      ]);
    } catch {
      // Best-effort: if icacls fails, the file is still written.
      // The doctor check will warn about insecure permissions.
    }
  }

  /**
   * On Windows, restrict directory access to the current user using icacls.
   */
  private async secureDirectoryWindows(dirPath: string): Promise<void> {
    try {
      const username = os.userInfo().username;
      await execFileAsync("icacls", [
        dirPath,
        "/inheritance:r",
        "/grant:r",
        `${username}:(OI)(CI)(F)`,
      ]);
    } catch {
      // Best-effort
    }
  }

  private getFromEnv(): Credentials | null {
    const clientId = process.env.PAX8_CLIENT_ID;
    const clientSecret = process.env.PAX8_CLIENT_SECRET;
    if (clientId && clientSecret) {
      return { clientId, clientSecret };
    }
    return null;
  }

  private async getFromFile(): Promise<Credentials | null> {
    const file = credentialsFile();
    // Refuse to load credentials from a world-/group-readable file. Bumping
    // checkPermissions() from "warn via doctor" to "refuse at load time"
    // closes the window where a tampered or accidentally-loosened
    // credentials file silently keeps working. Windows has no POSIX
    // mode bits, so skip the gate there — `checkPermissionsWindows` still
    // surfaces ACL issues via `pax8 doctor`.
    if (!isWindows) {
      try {
        const stat = await fs.stat(file);
        if ((stat.mode & 0o077) !== 0) {
          const perms = (stat.mode & 0o777).toString(8);
          throw new Error(
            `Refusing to load credentials: ${file} has mode ${perms} ` +
              `(group/other have access). Run: chmod 600 ${file}`,
          );
        }
      } catch (err) {
        // ENOENT — no file, nothing to load. Re-throw the explicit refusal
        // so the caller sees a clear error rather than a silent null.
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") return null;
        if (err instanceof Error && err.message.startsWith("Refusing to load credentials")) {
          throw err;
        }
        // Any other stat failure (EACCES, etc.) — treat as "no creds".
        return null;
      }
    }

    try {
      const content = await fs.readFile(file, "utf-8");
      const data = JSON.parse(content) as Record<string, unknown>;
      if (typeof data.clientId === "string" && typeof data.clientSecret === "string") {
        return { clientId: data.clientId, clientSecret: data.clientSecret };
      }
      return null;
    } catch {
      return null;
    }
  }
}
