import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

export async function execCli(args: string[]): Promise<string> {
  const { stdout } = await exec("pax8", args, { timeout: 30000 });
  return stdout;
}

export * from "./tools/index.js";
