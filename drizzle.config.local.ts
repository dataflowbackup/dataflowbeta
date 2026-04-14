import dotenv from "dotenv";
import path from "node:path";
import { defineConfig } from "drizzle-kit";

// Drizzle-kit ejecuta este archivo con su propio loader; evitamos importar otros .ts del proyecto.
dotenv.config({ path: path.join(process.cwd(), ".env") });
dotenv.config({ path: path.join(process.cwd(), "env.local"), override: true });
dotenv.config({ path: path.join(process.cwd(), ".env.local"), override: true });

const localUrl = process.env.DATABASE_URL || "file:./data/dev.db";

export default defineConfig({
  out: "./migrations/local",
  schema: "./shared/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: localUrl,
  },
});
