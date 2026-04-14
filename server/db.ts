import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient as createLibsqlWebClient } from "@libsql/client/web";
import { Pool } from "pg";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
// No importar `drizzle-orm/libsql` (index): su driver hace `import "@libsql/client"` al cargar el módulo
// y en Netlify/Lambda eso revienta con @libsql/linux-x64-gnu. `driver-core` solo construye la sesión con el client que vos pasás.
import { construct as constructLibsqlDb } from "drizzle-orm/libsql/driver-core";
import * as schema from "@shared/schema";

/**
 * `createRequire` debe anclarse al módulo actual para resolver `@libsql/client` (nativo)
 * al correr con `tsx` en Windows; `process.argv[1]` a veces apunta al launcher de tsx y rompe.
 * En el bundle CJS (`dist/index.cjs`) se usa el fallback por argv.
 */
function createProjectRequire(): ReturnType<typeof createRequire> {
  try {
    if (typeof import.meta !== "undefined" && import.meta.url) {
      return createRequire(fileURLToPath(import.meta.url));
    }
  } catch {
    /* seguir */
  }
  if (typeof process !== "undefined" && process.argv[1]) {
    return createRequire(path.resolve(process.argv[1]));
  }
  throw new Error(
    "[db] No se pudo inicializar createRequire (import.meta.url / process.argv[1]).",
  );
}

const require = createProjectRequire();

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const databaseUrl = process.env.DATABASE_URL;
const dbProvider = (process.env.DB_PROVIDER || "").toLowerCase();

const isPostgresUrl =
  databaseUrl.startsWith("postgres://") ||
  databaseUrl.startsWith("postgresql://");

// Neon serverless solo para hosts reales de Neon (Replit, etc.).
// Railway, Render, RDS, Postgres local → driver TCP "pg".
const useNeonServerless =
  databaseUrl.includes("neon.tech") || databaseUrl.includes(".neon.");
// Si la URL es Postgres, siempre driver `pg` (evita que un DB_PROVIDER=sqlite viejo rompa local).
const useLibsql =
  !isPostgresUrl &&
  (dbProvider === "sqlite" ||
    dbProvider === "turso" ||
    databaseUrl.startsWith("file:") ||
    databaseUrl.startsWith("libsql:"));

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

  // Turso remoto: import estático de `@libsql/client/web` para que el bundler de Netlify
  // incluya el módulo (require dinámico a `@libsql/client/web` falla en Lambda: módulo no encontrado).
  // SQLite local `file:`: cliente Node (nativo en tu máquina; no aplica en Netlify).
  const libsqlClient = isLocalSqliteFile
    ? (require("@libsql/client") as typeof import("@libsql/client")).createClient({
        url: databaseUrl,
        authToken,
      })
    : createLibsqlWebClient({ url: databaseUrl, authToken });

  pool = libsqlClient as unknown as Pool;
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
