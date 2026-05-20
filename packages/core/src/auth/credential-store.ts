// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { safeWriteFileSync } from "../security/safe-write.js";

const execFileAsync = promisify(execFile);

const CONFIG_DIR = path.join(os.homedir(), ".pax8");
const CREDENTIALS_FILE = path.join(CONFIG_DIR, "credentials.json");

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
    return CREDENTIALS_FILE;
  }

  /**
   * Returns the path to the config directory.
   */
  static get configDirPath(): string {
    return CONFIG_DIR;
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
      await fs.access(CREDENTIALS_FILE, constants.F_OK);
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
    await fs.mkdir(CONFIG_DIR, { recursive: true });

    if (isWindows) {
      await this.secureDirectoryWindows(CONFIG_DIR);
    } else {
      // Secure the directory: owner-only access
      await fs.chmod(CONFIG_DIR, 0o700);
    }

    const data = JSON.stringify({ clientId, clientSecret }, null, 2);
    // #262: use the safe-write helper so an existing symlink at
    // CREDENTIALS_FILE causes the write to fail (ELOOP) rather than
    // landing the credentials at the symlink's target. The 0o600 mode is
    // applied atomically at file-creation time, eliminating the small
    // window where an old `writeFile + chmod` flow had default perms.
    safeWriteFileSync(CREDENTIALS_FILE, data);

    if (isWindows) {
      await this.secureFileWindows(CREDENTIALS_FILE);
    }
  }

  /**
   * Removes the credentials file.
   */
  async clearCredentials(): Promise<void> {
    try {
      await fs.unlink(CREDENTIALS_FILE);
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
      await fs.access(CREDENTIALS_FILE, constants.F_OK);
    } catch {
      return { secure: true, detail: "No credentials file (using env vars or not configured)" };
    }

    if (isWindows) {
      return this.checkPermissionsWindows();
    }
    return this.checkPermissionsUnix();
  }

  private async checkPermissionsUnix(): Promise<PermissionCheckResult> {
    try {
      const stat = await fs.stat(CREDENTIALS_FILE);
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
          detail: `Permissions ${perms.toString(8)} — group/other have access. Run: chmod 600 ${CREDENTIALS_FILE}`,
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
    try {
      // Use icacls to inspect ACLs
      const { stdout } = await execFileAsync("icacls", [CREDENTIALS_FILE]);
      // Check that the file is in a user-profile directory
      const homeDir = os.homedir();
      const inUserDir = CREDENTIALS_FILE.toLowerCase().startsWith(homeDir.toLowerCase());
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
          detail: `File may be readable by other users. Run: icacls "${CREDENTIALS_FILE}" /inheritance:r /grant:r "%USERNAME%:F"`,
        };
      }
      return { secure: true, detail: "File ACLs restrict access (Windows)" };
    } catch {
      // icacls not available or errored — fall back to directory check
      const homeDir = os.homedir();
      const inUserDir = CREDENTIALS_FILE.toLowerCase().startsWith(homeDir.toLowerCase());
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
    // Refuse to load credentials from a world-/group-readable file. Bumping
    // checkPermissions() from "warn via doctor" to "refuse at load time"
    // closes the window where a tampered or accidentally-loosened
    // ~/.pax8/credentials.json silently keeps working. Windows has no POSIX
    // mode bits, so skip the gate there — `checkPermissionsWindows` still
    // surfaces ACL issues via `pax8 doctor`.
    if (!isWindows) {
      try {
        const stat = await fs.stat(CREDENTIALS_FILE);
        if ((stat.mode & 0o077) !== 0) {
          const perms = (stat.mode & 0o777).toString(8);
          throw new Error(
            `Refusing to load credentials: ${CREDENTIALS_FILE} has mode ${perms} ` +
              `(group/other have access). Run: chmod 600 ${CREDENTIALS_FILE}`,
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
      const content = await fs.readFile(CREDENTIALS_FILE, "utf-8");
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
