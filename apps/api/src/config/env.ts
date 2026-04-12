import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const candidateEnvPaths = [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "apps/api/.env"),
  resolve(process.cwd(), "services/.env"),
  resolve(__dirname, "../../.env"),
  resolve(__dirname, "../../../../services/.env"),
];

for (const envPath of candidateEnvPaths) {
  if (existsSync(envPath)) {
    config({ path: envPath });
  }
}
