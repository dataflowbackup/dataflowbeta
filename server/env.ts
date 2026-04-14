import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Carga `.env`, luego overrides locales. Orden (último gana):
 * `env.local` (sin punto, cómodo en Windows) → `.env.local` (convención habitual).
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(rootDir, ".env") });
dotenv.config({ path: path.join(rootDir, "env.local"), override: true });
dotenv.config({ path: path.join(rootDir, ".env.local"), override: true });
