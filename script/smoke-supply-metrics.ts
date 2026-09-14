/**
 * Prueba de humo de las métricas de insumos contra la base LOCAL.
 *
 * Solo lee: corre Compras, Consumo y la cola de mapeo sobre cada empresa y muestra los totales.
 *   npx tsx script/smoke-supply-metrics.ts
 */
import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.join(process.cwd(), ".env") });
dotenv.config({ path: path.join(process.cwd(), "env.local"), override: true });
dotenv.config({ path: path.join(process.cwd(), ".env.local"), override: true });
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "file:./data/dev.db";

const { storage } = await import("../server/storage");
const { getSupplyPurchases, getSupplyConsumption, getSoldProductMappings } = await import(
  "../server/supplyMetricsQueries"
);
const { db } = await import("../server/db");
const { clients } = await import("../shared/schema");

const money = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 2 });

const clientRows = await db.select({ id: clients.id, name: clients.name }).from(clients);
console.log(`Empresas: ${clientRows.map((c) => `${c.id}:${c.name}`).join(", ")}\n`);

for (const c of clientRows) {
  console.log(`===== ${c.name} (cliente ${c.id}) =====`);

  const purchases = await getSupplyPurchases(c.id, {});
  console.log(
    `COMPRAS  insumos=${purchases.supplyCount} facturas=${purchases.invoiceCount} ` +
      `cantidad=${money(purchases.totalQuantity)} monto=$${money(purchases.totalAmount)} detalle=${purchases.detail.length}`,
  );
  for (const r of purchases.rows.slice(0, 3)) {
    console.log(
      `   · ${r.supplyName}: ${money(r.quantity)} ${r.unit ?? ""} · $${money(r.amount)} · unit $${r.avgUnitPrice?.toFixed(4) ?? "-"}`,
    );
  }

  for (const source of ["fudo", "datalive", "shares"] as const) {
    const cons = await getSupplyConsumption(c.id, (cid, opts) => storage.getSoldProductsByPeriod(cid, opts), {
      source,
    });
    if (cons.unitsSold === 0) {
      console.log(`CONSUMO ${source}: sin ventas importadas`);
      continue;
    }
    console.log(
      `CONSUMO ${source}: vendidas=${money(cons.unitsSold)} conReceta=${money(cons.unitsWithRecipe)} ` +
        `cobertura=${cons.coveragePct?.toFixed(1) ?? "-"}% insumos=${cons.supplyCount} ` +
        `monto=$${money(cons.totalAmount)} sinMapear=${cons.unmappedCount} ciclos=${cons.cyclicRecipeIds.length}`,
    );
    for (const r of cons.rows.slice(0, 3)) {
      console.log(
        `   · ${r.supplyName}: ${money(r.quantity)} ${r.unit ?? ""} (merma ${money(r.quantityWithWaste)}) · $${money(r.amount)}`,
      );
    }
    for (const u of cons.topUnmapped.slice(0, 3)) {
      console.log(`   ! sin receta: ${u.producto} (${money(u.cantidad)} u.)`);
    }

    const mappings = await getSoldProductMappings(
      c.id,
      (cid, opts) => storage.getSoldProductsByPeriod(cid, opts),
      { source },
    );
    const conSugerencia = mappings.filter((m) => m.suggestedRecipeId != null).length;
    console.log(`   mapeo ${source}: productos=${mappings.length} con sugerencia=${conSugerencia}`);
    for (const m of mappings.filter((x) => x.suggestedRecipeId != null).slice(0, 3)) {
      console.log(`     ~ "${m.producto}" → "${m.suggestedRecipeName}" (${(m.suggestedScore ?? 0).toFixed(2)})`);
    }
  }
  console.log("");
}

process.exit(0);
