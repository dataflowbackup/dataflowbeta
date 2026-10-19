/**
 * Verifica Evolución de Costos contra el costeo que ya vive en la base.
 *
 * La invariante: con los sospechosos INCLUIDOS (el costeo no los filtra), el costo "hoy" que
 * reconstruye el tablero tiene que dar el mismo número que `recipes.total_cost`. Las diferencias
 * que queden tienen que explicarse por facturas anuladas o notas de crédito, que el costeo sí toma
 * como "último precio" y el tablero no.
 *
 *   DATABASE_URL=file:./backups/ensayo.db npx tsx script/verify-cost-evolution.ts
 */
import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.join(process.cwd(), ".env") });
dotenv.config({ path: path.join(process.cwd(), "env.local"), override: true });
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "file:./data/dev.db";

const { db } = await import("../server/db");
const { clients } = await import("../shared/schema");
const { getCostEvolution } = await import("../server/costEvolutionQueries");

const today = new Date();
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dateTo = ymd(today);
const dateFrom = ymd(new Date(today.getFullYear(), today.getMonth() - 5, 1));

for (const c of await db.select({ id: clients.id, name: clients.name }).from(clients)) {
  const t0 = Date.now();
  const withSusp = await getCostEvolution(c.id, {
    dateFrom,
    dateTo,
    granularity: "month",
    includeSuspicious: true,
    cmvObjetivo: 35,
  });
  const clean = await getCostEvolution(c.id, {
    dateFrom,
    dateTo,
    granularity: "month",
    includeSuspicious: false,
    cmvObjetivo: 35,
  });
  const ms = Date.now() - t0;
  const recipes = [...withSusp.subRecipes, ...withSusp.platos];
  if (recipes.length === 0 && withSusp.supplies.length === 0) continue;

  const differs = recipes.filter((r) => r.storedDiffers);
  console.log(`\n=== ${c.name} (#${c.id}) — ${ms} ms ===`);
  console.log(
    `  insumos con compras: ${clean.supplies.length} · sub-recetas: ${clean.subRecipes.length} · platos: ${clean.platos.length}`,
  );
  console.log(
    `  canasta: ${clean.totals.basketVariationPct}% (con sospechosos: ${withSusp.totals.basketVariationPct}%) · ` +
      `suben ${clean.totals.up} / bajan ${clean.totals.down} / igual ${clean.totals.flat}`,
  );
  console.log(
    `  sospechosos en período: ${clean.totals.suspiciousInPeriod} (históricos: ${clean.suspicious.length}) · ` +
      `platos sobre objetivo: ${clean.totals.platosOverTarget}/${clean.totals.platosWithPrice}`,
  );
  console.log(`  índice: ${clean.index.map((p) => `${p.label}=${p.general}`).join("  ")}`);
  console.log(`  recetas que NO coinciden con Carta (con sospechosos): ${differs.length}/${recipes.length}`);
  for (const r of differs.slice(0, 8)) {
    console.log(`    - ${r.name}: tablero ${r.costNow} vs carta ${r.storedTotalCost}`);
  }
  console.log("  top 5 suba:");
  for (const s of clean.supplies.slice(0, 5)) {
    console.log(`    ${s.name} [${s.unit}] ${s.basePrice} → ${s.lastPrice} (${s.variationPct?.toFixed(1)}%) compras=${s.purchases}`);
  }
}
process.exit(0);
