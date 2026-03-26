import { createRequire } from "node:module";
import path from "node:path";
import { Pool } from "pg";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
// No importar `drizzle-orm/libsql` (index): su driver hace `import "@libsql/client"` al cargar el módulo
// y en Netlify/Lambda eso revienta con @libsql/linux-x64-gnu. `driver-core` solo construye la sesión con el client que vos pasás.
import { construct as constructLibsqlDb } from "drizzle-orm/libsql/driver-core";
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
const dbProvider = (process.env.DB_PROVIDER || "").toLowerCase();

// Neon serverless solo para hosts reales de Neon (Replit, etc.).
// Railway, Render, RDS, Postgres local → driver TCP "pg".
const useNeonServerless =
  databaseUrl.includes("neon.tech") || databaseUrl.includes(".neon.");
const useLibsql =
  dbProvider === "sqlite" ||
  dbProvider === "turso" ||
  databaseUrl.startsWith("file:") ||
  databaseUrl.startsWith("libsql:");

type NeonPoolClass = import("@neondatabase/serverless").Pool;
type DrizzleNeonFn = typeof import("drizzle-orm/neon-serverless").drizzle;

let db: ReturnType<typeof drizzlePg> | ReturnType<DrizzleNeonFn>;
let pool: Pool | NeonPoolClass;

if (useLibsql) {
  console.log(
    `[db] Connecting via libsql (${databaseUrl.startsWith("file:") ? "sqlite file" : "turso"})`,
  );
  const authToken = process.env.TURSO_AUTH_TOKEN || undefined;
  const isLocalSqliteFile = databaseUrl.startsWith("file:");

  // Para Turso/libSQL remoto (libsql:// o https://) usamos siempre el cliente web/HTTP
  // para evitar dependencias nativas (p.ej. @libsql/linux-x64-gnu) en runtimes serverless.
  // Para SQLite local por archivo sí necesitamos el cliente Node.
  const libsqlMod = isLocalSqliteFile
    ? (require("@libsql/client") as typeof import("@libsql/client"))
    : (require("@libsql/client/web") as typeof import("@libsql/client/web"));

  pool = (libsqlMod as any).createClient({ url: databaseUrl, authToken }) as unknown as Pool;
  db = constructLibsqlDb(pool as any, { schema: schema as any }) as unknown as ReturnType<typeof drizzlePg>;
} else if (useNeonServerless) {
  console.log("[db] Connecting via Neon serverless");
  const { Pool: NeonPool, neonConfig } =
    require("@neondatabase/serverless") as typeof import("@neondatabase/serverless");
  const { drizzle: drizzleNeon } =
    require("drizzle-orm/neon-serverless") as typeof import("drizzle-orm/neon-serverless");
  const wsMod = require("ws") as typeof import("ws");
  const ws = ((wsMod as unknown) as { default?: typeof import("ws") }).default ?? wsMod;
  neonConfig.webSocketConstructor = ws;
  pool = new NeonPool({ connectionString: databaseUrl });
  db = drizzleNeon({ client: pool as NeonPoolClass, schema });
} else {
  console.log("[db] Connecting to PostgreSQL via pg (TCP)");
  pool = new Pool({ connectionString: databaseUrl });
  db = drizzlePg(pool as Pool, { schema });
}

export { db, pool };
