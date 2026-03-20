import { createRequire } from "node:module";
import path from "node:path";
import { Pool } from "pg";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

/**
 * Esbuild con format=cjs deja `import.meta` vacío; no usar `import.meta.url` aquí.
 * `process.argv[1]` apunta al .cjs (Railway) o al entry .ts con tsx (dev).
 */
function getCreateRequireFilename(): string {
  if (typeof process !== "undefined" && process.argv[1]) {
    return path.resolve(process.argv[1]);
  }
  throw new Error(
    "[db] No se pudo resolver la ruta para createRequire (process.argv[1] vacío).",
  );
}

const require = createRequire(getCreateRequireFilename());

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const databaseUrl = process.env.DATABASE_URL;

// Neon serverless solo para hosts reales de Neon (Replit, etc.).
// Railway, Render, RDS, Postgres local → driver TCP "pg".
const useNeonServerless =
  databaseUrl.includes("neon.tech") || databaseUrl.includes(".neon.");

type NeonPoolClass = import("@neondatabase/serverless").Pool;
type DrizzleNeonFn = typeof import("drizzle-orm/neon-serverless").drizzle;

let db: ReturnType<typeof drizzlePg> | ReturnType<DrizzleNeonFn>;
let pool: Pool | NeonPoolClass;

if (useNeonServerless) {
  console.log("[db] Connecting via Neon serverless");
  const { Pool: NeonPool, neonConfig } =
    require("@neondatabase/serverless") as typeof import("@neondatabase/serverless");
  const { drizzle: drizzleNeon } =
    require("drizzle-orm/neon-serverless") as typeof import("drizzle-orm/neon-serverless");
  const wsMod = require("ws") as typeof import("ws");
  const ws = (wsMod as { default?: typeof import("ws") }).default ?? wsMod;
  neonConfig.webSocketConstructor = ws;
  pool = new NeonPool({ connectionString: databaseUrl });
  db = drizzleNeon({ client: pool as NeonPoolClass, schema });
} else {
  console.log("[db] Connecting to PostgreSQL via pg (TCP)");
  pool = new Pool({ connectionString: databaseUrl });
  db = drizzlePg(pool as Pool, { schema });
}

export { db, pool };
