import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// npm workspaces run scripts with `cwd` set to the workspace directory, which
// means `dotenv/config` will not see a repo-root `.env`. Load both locations.
export function loadEnv(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(here, "../../..", ".env"),
  ];

  for (const envPath of candidates) {
    dotenv.config({ path: envPath, override: false });
  }
}

