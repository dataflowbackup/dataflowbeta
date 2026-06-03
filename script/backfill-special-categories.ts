/**
 * Backfill Fase 1 — marca isSpecial/specialType en las categorías "Otros Movimientos"
 * (Inicio de Mes, Otros Ingresos, Retiros Socios, Transferencias) de TODOS los clientes.
 *
 * SEGURO PARA PRODUCCIÓN: idempotente, solo hace UPDATE de flags (no borra/crea filas,
 * no toca transacciones ni montos). Re-ejecutable sin efectos secundarios.
 *
 * Uso:
 *   npx tsx script/backfill-special-categories.ts            # aplica
 *   npx tsx script/backfill-special-categories.ts --dry-run  # solo reporta
 */
import "../server/env";
import { db } from "../server/db";
import { clients } from "@shared/schema";
import { seedSpecialCategoryFlagsForClient } from "../server/seedFinancialData";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const allClients = await db.select().from(clients);
  console.log(`[backfill] ${allClients.length} clientes. ${dryRun ? "(DRY-RUN)" : "(APLICANDO)"}`);

  let totalUpdated = 0;
  let totalOk = 0;
  for (const c of allClients) {
    if (dryRun) {
      // En dry-run no escribimos: solo informamos cuántas quedarían por marcar no es trivial
      // sin replicar la lógica, así que reportamos por cliente al aplicar.
      console.log(`  - cliente ${c.id} (${c.name}): pendiente de aplicar`);
      continue;
    }
    const { updated, alreadyOk } = await seedSpecialCategoryFlagsForClient(c.id);
    totalUpdated += updated;
    totalOk += alreadyOk;
    console.log(`  - cliente ${c.id} (${c.name}): ${updated} marcadas, ${alreadyOk} ya OK`);
  }

  if (!dryRun) {
    console.log(`[backfill] LISTO. ${totalUpdated} categorías marcadas, ${totalOk} ya estaban OK.`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("[backfill] ERROR:", e?.message ?? e);
  process.exit(1);
});
