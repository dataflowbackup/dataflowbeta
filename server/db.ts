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

const isLocal =
  databaseUrl.includes("localhost") ||
  databaseUrl.includes("127.0.0.1");

let db: ReturnType<typeof drizzlePg> | ReturnType<typeof drizzleNeon>;
let pool: Pool | NeonPool;

if (isLocal) {
  console.log("[db] Connecting to local PostgreSQL via pg");
  pool = new Pool({ connectionString: databaseUrl });
  db = drizzlePg(pool as Pool, { schema });
} else {
  console.log("[db] Connecting to Replit Postgres (Neon)");
  neonConfig.webSocketConstructor = ws;
  pool = new NeonPool({ connectionString: databaseUrl });
  db = drizzleNeon({ client: pool as NeonPool, schema });
}

export { db, pool };
