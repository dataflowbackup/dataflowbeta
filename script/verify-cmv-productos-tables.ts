/**
 * Verificación puntual (aditiva, solo lectura) de que las 3 tablas del sub-módulo
 * "CMV Productos" quedaron creadas en Turso y están vacías, como corresponde a un alta.
 */
import dotenv from "dotenv";
import path from "node:path";
import { createClient } from "@libsql/client";

dotenv.config({ path: path.join(process.cwd(), ".env") });
dotenv.config({ path: path.join(process.cwd(), "env.turso"), override: true });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Falta DATABASE_URL");

const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

const TABLES = ["product_costs", "cmv_producto_calculations", "cmv_producto_lines"];

for (const t of TABLES) {
  const exists = await client.execute({
    sql: "select name from sqlite_master where type='table' and name = ?",
    args: [t],
  });
  if (exists.rows.length === 0) {
    console.log(`${t}: NO EXISTE`);
    continue;
  }
  const count = await client.execute(`select count(*) as n from ${t}`);
  console.log(`${t}: OK (${count.rows[0].n} filas)`);
}

// Control de que no se tocó nada de lo existente en el circuito de productos vendidos.
for (const t of ["fudo_productos", "datalive_productos", "shares_productos", "product_recipe_mappings", "cmv_calculations", "recipes"]) {
  const count = await client.execute(`select count(*) as n from ${t}`);
  console.log(`${t}: ${count.rows[0].n} filas`);
}
