import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const CONFIG_DIR = path.join(os.homedir(), ".pax8");
const CREDENTIALS_FILE = path.join(CONFIG_DIR, "credentials.json");

export interface Credentials {
  clientId: string;
  clientSecret: string;
}

export class CredentialStore {
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
   * Saves credentials to ~/.pax8/credentials.json.
   */
  async saveCredentials(clientId: string, clientSecret: string): Promise<void> {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    const data = JSON.stringify({ clientId, clientSecret }, null, 2);
    await fs.writeFile(CREDENTIALS_FILE, data, { mode: 0o600 });
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

  private getFromEnv(): Credentials | null {
    const clientId = process.env.PAX8_CLIENT_ID;
    const clientSecret = process.env.PAX8_CLIENT_SECRET;
    if (clientId && clientSecret) {
      return { clientId, clientSecret };
    }
    return null;
  }

  private async getFromFile(): Promise<Credentials | null> {
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
