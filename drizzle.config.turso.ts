import dotenv from "dotenv";
import path from "node:path";
import { defineConfig } from "drizzle-kit";

// Drizzle-kit ejecuta este archivo con su propio loader; evitamos importar otros .ts del proyecto.
dotenv.config({ path: path.join(process.cwd(), ".env") });
dotenv.config({ path: path.join(process.cwd(), "env.local"), override: true });
dotenv.config({ path: path.join(process.cwd(), ".env.local"), override: true });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for Turso.");
}

export default defineConfig({
  out: "./migrations/turso",
  schema: "./shared/schema.ts",
  dialect: "turso",
  dbCredentials: {
    url: process.env.DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
});
