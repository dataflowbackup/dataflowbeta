/**
 * Pasa los grupos marcados como inversión (financial_groups.is_investment, sep-2026) al mecanismo
 * de "Categorías que SÍ computan" (oct-2026): el grupo deja de computar y cada una de sus
 * categorías de gasto recibe el destino "inversion". El Estado de Resultado da lo mismo que antes,
 * solo que la inversión ahora resta después del Resultado Operativo.
 *
 * Aditivo e idempotente: solo inserta destinos que no existen y apaga economic_computes del grupo.
 * NO toca is_investment (queda como dato histórico, el código ya no lo lee).
 *
 * Uso:
 *   npx tsx script/migrate-inversion-destinos.ts                 → simulacro contra Turso
 *   npx tsx script/migrate-inversion-destinos.ts --apply         → aplica en Turso
 *   npx tsx script/migrate-inversion-destinos.ts --db=<archivo>  → contra una copia SQLite
 */
import { readFileSync } from "fs";
import { createClient } from "@libsql/client";

const APPLY = process.argv.includes("--apply");
const dbArg = process.argv.find((a) => a.startsWith("--db="))?.slice(5);

function tursoClient() {
  const env = Object.fromEntries(
    readFileSync("env.turso", "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
  );
  return createClient({ url: env.DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
}

const db = dbArg ? createClient({ url: `file:${dbArg}` }) : tursoClient();

async function main() {
  console.log(`Base: ${dbArg ?? "TURSO (producción)"} · ${APPLY ? "APLICANDO" : "SIMULACRO"}`);
  const groups = (await db.execute(
    "select id, client_id, name, economic_computes from financial_groups where is_investment = 1 and type = 'expense'",
  )).rows;
  if (groups.length === 0) {
    console.log("No hay grupos marcados como inversión. Nada que hacer.");
    return;
  }

  let insertados = 0;
  let gruposApagados = 0;
  for (const g of groups) {
    const cats = (await db.execute({
      sql: "select id, name from transaction_categories where financial_group_id = ? and client_id = ?",
      args: [g.id, g.client_id],
    })).rows;
    console.log(`\nGrupo #${g.id} "${g.name}" (cliente ${g.client_id}) · computa=${g.economic_computes} · ${cats.length} categorías`);

    for (const c of cats) {
      const existing = (await db.execute({
        sql: "select destination from economic_category_destinations where client_id = ? and category_id = ?",
        args: [g.client_id, c.id],
      })).rows[0];
      if (existing) {
        console.log(`   = #${c.id} ${c.name}: ya tiene destino "${existing.destination}", no se toca`);
        continue;
      }
      console.log(`   + #${c.id} ${c.name} → inversion`);
      if (APPLY) {
        await db.execute({
          sql: "insert into economic_category_destinations (client_id, category_id, destination, tax_kind) values (?, ?, 'inversion', null)",
          args: [g.client_id, c.id],
        });
      }
      insertados++;
    }

    if (Number(g.economic_computes ?? 1) !== 0) {
      console.log(`   grupo #${g.id}: economic_computes 1 → 0`);
      if (APPLY) await db.execute({ sql: "update financial_groups set economic_computes = 0 where id = ?", args: [g.id] });
      gruposApagados++;
    }
  }
  console.log(`\n${APPLY ? "Aplicado" : "Simulado"}: ${insertados} destinos nuevos, ${gruposApagados} grupos dejan de computar.`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
