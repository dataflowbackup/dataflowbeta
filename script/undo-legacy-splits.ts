/**
 * Deshace las divisiones creadas por la función VIEJA de "Dividir por local" (jul-29).
 *
 * La división vieja creaba las partes SIN cuenta ni entidad de banco y con importe NEGATIVO
 * (toda la base usa importe positivo + `type`), y no generaba los préstamos. Al reemplazarla por
 * la división entre locales, esas partes quedan huérfanas y mal formadas: este script las borra y
 * deja cada movimiento original como estaba (uno solo).
 *
 * Es idempotente y quirúrgico: solo toca partes con `source='split'` E importe negativo — la
 * firma exacta de la división vieja. Las partes de la división nueva (`source='local_split'`,
 * importe positivo) nunca matchean.
 *
 * Uso:  npx tsx script/undo-legacy-splits.ts          (dry-run: solo lista)
 *       npx tsx script/undo-legacy-splits.ts --apply  (borra)
 */
import dotenv from "dotenv";
import path from "node:path";
import { createClient } from "@libsql/client/web";

dotenv.config({ path: path.join(process.cwd(), ".env") });
dotenv.config({ path: path.join(process.cwd(), "env.local"), override: true });
dotenv.config({ path: path.join(process.cwd(), ".env.local"), override: true });
dotenv.config({ path: path.join(process.cwd(), "env.turso"), override: true });

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_URL;
const token = process.env.TURSO_AUTH_TOKEN;
if (!url) {
  console.error("ERROR: DATABASE_URL vacía");
  process.exit(1);
}

const client = createClient({ url, authToken: token });

async function main() {
  console.log(`[undo-legacy-splits] Base: ${url!.slice(0, 45)}...  modo: ${apply ? "APLICAR" : "DRY-RUN"}`);

  const legacy = await client.execute(`
    SELECT id, client_id, parent_transaction_id, amount, type, source, bank_account_id, category_id
    FROM transactions
    WHERE parent_transaction_id IS NOT NULL
      AND source = 'split'
      AND CAST(amount AS REAL) < 0
    ORDER BY parent_transaction_id, id
  `);

  if (legacy.rows.length === 0) {
    console.log("[undo-legacy-splits] No hay divisiones viejas. Nada que hacer.");
    return;
  }

  const parents = Array.from(new Set(legacy.rows.map((r) => Number(r.parent_transaction_id))));
  console.log(`[undo-legacy-splits] ${legacy.rows.length} partes viejas en ${parents.length} movimientos originales:`);
  for (const p of parents) {
    const hijos = legacy.rows.filter((r) => Number(r.parent_transaction_id) === p);
    const suma = hijos.reduce((s, r) => s + Math.abs(Number(r.amount) || 0), 0);
    console.log(`  - original ${p}: ${hijos.length} partes, suma ${suma.toFixed(2)} (ids ${hijos.map((h) => h.id).join(", ")})`);
  }

  // Candado: ningún original acá puede tener partes de la división NUEVA.
  const nuevas = await client.execute({
    sql: `SELECT COUNT(*) n FROM transactions
          WHERE source = 'local_split' AND parent_transaction_id IN (${parents.map(() => "?").join(",")})`,
    args: parents,
  });
  if (Number(nuevas.rows[0]?.n ?? 0) > 0) {
    console.error("ERROR: alguno de estos movimientos ya tiene partes de la división nueva. Abortado.");
    process.exit(1);
  }

  if (!apply) {
    console.log("[undo-legacy-splits] DRY-RUN: no se borró nada. Correlo con --apply para aplicar.");
    return;
  }

  const ids = legacy.rows.map((r) => Number(r.id));
  const del = await client.execute({
    sql: `DELETE FROM transactions WHERE id IN (${ids.map(() => "?").join(",")})`,
    args: ids,
  });
  // `invoiced` era la marca de "ya dividido" de la función vieja.
  const upd = await client.execute({
    sql: `UPDATE transactions SET invoiced = 0 WHERE id IN (${parents.map(() => "?").join(",")})`,
    args: parents,
  });

  console.log(`[undo-legacy-splits] OK: ${del.rowsAffected} partes borradas, ${upd.rowsAffected} originales restaurados.`);
}

main().catch((e) => {
  console.error("[undo-legacy-splits] FALLO:", e);
  process.exit(1);
});
