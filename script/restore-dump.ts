/**
 * Restaura un dump de `script/backup-turso.ts` en una base SQLite local descartable.
 *
 * Sirve para ensayar una migración sobre una copia fiel de producción sin tocar producción.
 * El archivo destino se borra y se crea de cero en cada corrida.
 *
 *   npx tsx script/restore-dump.ts backups/turso_2026-09-21_133035.sql backups/ensayo.db
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createClient } from "@libsql/client";

const [dumpArg, destArg] = process.argv.slice(2);
if (!dumpArg || !destArg) {
  console.error("Uso: npx tsx script/restore-dump.ts <dump.sql> <destino.db>");
  process.exit(1);
}
const dump = path.resolve(process.cwd(), dumpArg);
const dest = path.resolve(process.cwd(), destArg);
if (!fs.existsSync(dump)) throw new Error(`No existe el dump: ${dump}`);

// Base descartable: si quedó una corrida anterior, se tira.
for (const f of [dest, `${dest}-journal`, `${dest}-wal`, `${dest}-shm`]) {
  if (fs.existsSync(f)) fs.rmSync(f);
}

const db = createClient({ url: `file:${dest}` });
await db.execute("PRAGMA foreign_keys=OFF");

const rl = readline.createInterface({ input: fs.createReadStream(dump, { encoding: "utf8" }), crlfDelay: Infinity });

let buffer = "";
let lote: string[] = [];
let sentencias = 0;
let errores = 0;
const LOTE = 400;

const descargar = async () => {
  if (lote.length === 0) return;
  try {
    await db.batch(lote, "write");
  } catch {
    // Un lote puede fallar por una sola sentencia (índice duplicado, etc.): se reintenta de a una
    // para no perder las 399 buenas y poder señalar cuál falló.
    for (const s of lote) {
      try { await db.execute(s); } catch (e: any) {
        errores++;
        if (errores <= 5) console.warn(`\n  ! ${String(e.message).slice(0, 110)}\n    ${s.slice(0, 110)}`);
      }
    }
  }
  lote = [];
};

for await (const line of rl) {
  const t = line.trim();
  // Los BEGIN/COMMIT del dump no van: acá se escribe por lotes.
  if (!t || t.startsWith("--") || /^(BEGIN|COMMIT|PRAGMA)\b/i.test(t)) continue;
  buffer += (buffer ? "\n" : "") + line;
  if (!t.endsWith(";")) continue;

  lote.push(buffer);
  buffer = "";
  sentencias++;
  if (lote.length >= LOTE) {
    await descargar();
    if (sentencias % 20000 === 0) process.stdout.write(`\r  restaurando… ${sentencias.toLocaleString("es-AR")} sentencias`);
  }
}
await descargar();

console.log(`\n[restore] Listo: ${sentencias.toLocaleString("es-AR")} sentencias, ${errores} con error.`);
console.log(`[restore] Base de ensayo: ${dest}`);

for (const t of ["supplies", "invoice_items", "recipe_ingredients", "recipes", "units_of_measure", "stock_valuation_items"]) {
  const r = await db.execute(`select count(*) as n from ${t}`);
  console.log(`   ${t}: ${Number(r.rows[0].n).toLocaleString("es-AR")} filas`);
}
