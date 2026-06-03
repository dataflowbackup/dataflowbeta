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
import { restructureSpecialParentGroupsForClient } from "../server/seedFinancialData";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const allClients = await db.select().from(clients);
  console.log(`[backfill] ${allClients.length} clientes. ${dryRun ? "(DRY-RUN)" : "(APLICANDO)"}`);

  let totalGroups = 0;
  let totalMoved = 0;
  let totalFlagged = 0;
  for (const c of allClients) {
    if (dryRun) {
      console.log(`  - cliente ${c.id} (${c.name}): pendiente de aplicar`);
      continue;
    }
    // Crea grupos padre Préstamos/Alivios, mueve categorías de préstamo y marca flags. Idempotente.
    const { groupsCreated, categoriesMoved, flagged } = await restructureSpecialParentGroupsForClient(c.id);
    totalGroups += groupsCreated;
    totalMoved += categoriesMoved;
    totalFlagged += flagged;
    console.log(`  - cliente ${c.id} (${c.name}): ${groupsCreated} grupos nuevos, ${categoriesMoved} cat. movidas, ${flagged} flags marcados`);
  }

  if (!dryRun) {
    console.log(`[backfill] LISTO. ${totalGroups} grupos creados, ${totalMoved} categorías movidas, ${totalFlagged} flags marcados.`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("[backfill] ERROR:", e?.message ?? e);
  process.exit(1);
});
