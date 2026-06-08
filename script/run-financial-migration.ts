/**
 * Corre la migración de "Movimientos Financieros" contra PRODUCCIÓN (Turso).
 *
 * Carga env.turso AL FINAL con override, igual que script/backup-turso.ts, para apuntar a la
 * base remota (libsql://). Guard: aborta si DATABASE_URL no es libsql:// (evita correr en local).
 *
 * Uso:
 *   npx tsx script/run-financial-migration.ts --dry-run   # muestra el estado actual, no escribe
 *   npx tsx script/run-financial-migration.ts             # aplica (idempotente)
 */
import dotenv from "dotenv";
import path from "node:path";

const root = process.cwd();
dotenv.config({ path: path.join(root, ".env") });
dotenv.config({ path: path.join(root, "env.local"), override: true });
dotenv.config({ path: path.join(root, ".env.local"), override: true });
dotenv.config({ path: path.join(root, "env.turso"), override: true });

const url = process.env.DATABASE_URL ?? "";
if (!url.startsWith("libsql://")) {
  console.error(`[migración] ABORTADO: DATABASE_URL no es Turso (libsql://). Valor: ${url.slice(0, 30)}...`);
  process.exit(1);
}
console.log(`[migración] Apuntando a PRODUCCIÓN: ${url.slice(0, 45)}...`);

const dryRun = process.argv.includes("--dry-run");

// Import dinámico DESPUÉS de fijar el env, para que server/db tome la URL de Turso.
const { db } = await import("../server/db");
const { clients, financialGroups } = await import("@shared/schema");
const { eq } = await import("drizzle-orm");
const { restructureSpecialParentGroupsForClient } = await import("../server/seedFinancialData");

const MOV_FIN = "movimientos_financieros";

async function main() {
  const allClients = await db.select().from(clients);
  console.log(`[migración] ${allClients.length} empresas. ${dryRun ? "(DRY-RUN: solo muestra el estado actual)" : "(APLICANDO)"}`);

  if (dryRun) {
    for (const c of allClients) {
      const grps = await db.select().from(financialGroups).where(eq(financialGroups.clientId, c.id));
      const movFin = grps.filter((g) => String((g as any).type) === MOV_FIN).length;
      const transf = grps.some((g) => String((g as any).name ?? "").trim().toLowerCase() === "transferencias");
      console.log(`  - ${c.name}: ${grps.length} grupos, ${movFin} ya "Movimientos Financieros", Transferencias=${transf ? "SÍ (se borrará)" : "no"}`);
    }
    console.log("[migración] DRY-RUN listo. Nada se modificó.");
    process.exit(0);
  }

  let g = 0, mv = 0, rt = 0, tf = 0, fl = 0;
  for (const c of allClients) {
    const r = await restructureSpecialParentGroupsForClient(c.id);
    g += r.groupsCreated; mv += r.categoriesMoved; rt += r.retipados; tf += r.transferenciasBorradas; fl += r.flagged;
    console.log(`  - ${c.name}: ${r.groupsCreated} grupos nuevos, ${r.categoriesMoved} cat. movidas, ${r.retipados} re-tipados, ${r.transferenciasBorradas} transf. borradas, ${r.flagged} flags`);
  }
  console.log(`[migración] LISTO. ${g} grupos creados, ${mv} cat. movidas, ${rt} re-tipados, ${tf} transferencias borradas, ${fl} flags.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[migración] ERROR:", e?.message ?? e);
  process.exit(1);
});
