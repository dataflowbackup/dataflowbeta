import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Raíz del repo para resolver `.env`.
 * En bundles CJS (Netlify/esbuild) `import.meta.url` puede venir vacío y romper `fileURLToPath`.
 */
function projectRootDir(): string {
  try {
    const url = typeof import.meta !== "undefined" ? import.meta.url : undefined;
    if (url && typeof url === "string") {
      return path.resolve(path.dirname(fileURLToPath(url)), "..");
    }
  } catch {
    /* seguir */
  }
  return process.cwd();
}

/**
 * Carga `.env`, luego overrides locales. Orden (último gana):
 * `env.local` (sin punto, cómodo en Windows) → `.env.local` (convención habitual).
 */
const rootDir = projectRootDir();

dotenv.config({ path: path.join(rootDir, ".env") });
dotenv.config({ path: path.join(rootDir, "env.local"), override: true });
dotenv.config({ path: path.join(rootDir, ".env.local"), override: true });
