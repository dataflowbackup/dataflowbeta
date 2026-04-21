/**
 * Muestra que base usa tu entorno y si existe recipe_subcategories.
 *
 *   npm run turso:diag
 *
 * Carga: .env → env.local → .env.local → env.turso (el ultimo gana).
 * Para diagnosticar PRODUCCION: crea `env.turso` con DATABASE_URL de Netlify (ver env.turso.example).
 */
import dotenv from "dotenv";
import path from "node:path";
import { createClient as createWebClient } from "@libsql/client/web";
import { createClient as createFileClient } from "@libsql/client";

dotenv.config({ path: path.join(process.cwd(), ".env") });
dotenv.config({ path: path.join(process.cwd(), "env.local"), override: true });
dotenv.config({ path: path.join(process.cwd(), ".env.local"), override: true });
dotenv.config({ path: path.join(process.cwd(), "env.turso"), override: true });

const url = process.env.DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN || undefined;

if (!url) {
  console.error("Falta DATABASE_URL en .env / env.local / .env.local / env.turso");
  process.exit(1);
}

function redactDbUrl(u: string): string {
  let s = u;
  if (s.includes("?")) {
    const [base, q] = s.split("?", 2);
    const params = new URLSearchParams(q);
    if (params.has("authToken")) params.set("authToken", "REDACTED");
    s = `${base}?${params.toString()}`;
  }
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}

console.log("--- Base usada por ESTE entorno (ultimo .env que definio DATABASE_URL) ---");
console.log("DATABASE_URL (redactada):", redactDbUrl(url));
console.log("TURSO_AUTH_TOKEN:", authToken ? "definido" : "no definido");
console.log("DB_PROVIDER:", process.env.DB_PROVIDER || "(no set)");

if (url.startsWith("file:")) {
  console.log(
    "\n>>> ATENCION: estas usando SQLite LOCAL (dev.db), NO Turso remoto.\n" +
      "    El `npm run db:push:turso` con esta config solo toca el archivo local.\n" +
      "    Para arreglar Netlify: crea `env.turso` (copia de env.turso.example) con\n" +
      "    DATABASE_URL + TURSO_AUTH_TOKEN de Netlify y volve a correr db:push:turso.\n",
  );
}

const client = url.startsWith("file:")
  ? createFileClient({ url })
  : createWebClient({ url, authToken });

const tables = await client.execute({
  sql: `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%recipe%' ORDER BY name`,
  args: [],
});

console.log("\n--- Tablas que matchean %recipe% en ESA base ---");
const names: string[] = [];
for (const row of tables.rows) {
  const r = row as Record<string, unknown>;
  const n = String(r.name ?? Object.values(r)[0] ?? "");
  names.push(n);
  console.log(" -", n);
}
if (names.length === 0) {
  console.log("(ninguna — esto explicaria el error en la app si la app usa esta misma URL)");
}

const hasSub = names.includes("recipe_subcategories");
console.log("\nrecipe_subcategories existe:", hasSub ? "SI" : "NO");

if (!hasSub) {
  console.log(
    "\nSi Netlify sigue fallando pero aca dice NO: o bien Netlify usa OTRA DATABASE_URL,\n" +
      "o el push se hizo contra otro archivo/branch de Turso. Compará el host de la URL\n" +
      "de arriba con Site settings → Environment variables → DATABASE_URL en Netlify.",
  );
}

process.exit(0);
