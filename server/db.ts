import { Pool } from "pg";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "@shared/schema";

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

let db: ReturnType<typeof drizzlePg> | ReturnType<typeof drizzleNeon>;
let pool: Pool | NeonPool;

if (useNeonServerless) {
  console.log("[db] Connecting via Neon serverless");
  neonConfig.webSocketConstructor = ws;
  pool = new NeonPool({ connectionString: databaseUrl });
  db = drizzleNeon({ client: pool as NeonPool, schema });
} else {
  console.log("[db] Connecting to PostgreSQL via pg (TCP)");
  pool = new Pool({ connectionString: databaseUrl });
  db = drizzlePg(pool as Pool, { schema });
}

export { db, pool };
