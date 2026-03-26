import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const localUrl = process.env.DATABASE_URL || "file:./data/dev.db";

export default defineConfig({
  out: "./migrations/local",
  schema: "./shared/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: localUrl,
  },
});
