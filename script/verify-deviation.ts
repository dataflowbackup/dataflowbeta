/**
 * Verifica el motor de desvío de mercadería.
 *
 * Parte 1: la ecuación pura, con casos armados a mano (signos, medido vs supuesto, tolerancia).
 * Parte 2: el camino completo contra la base LOCAL — siembra dos inventarios, una compra, un
 * traslado, un decomiso y una venta con receta, comprueba que el desvío da el número esperado,
 * y borra TODO lo que insertó.
 *
 *   npx tsx script/verify-deviation.ts
 */
import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.join(process.cwd(), ".env") });
dotenv.config({ path: path.join(process.cwd(), "env.local"), override: true });
dotenv.config({ path: path.join(process.cwd(), ".env.local"), override: true });
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "file:./data/dev.db";

const { computeDeviationRows, summarizeDeviation } = await import("../shared/deviationEngine");
type DeviationInput = import("../shared/deviationEngine").DeviationInput;

let failures = 0;
function check(label: string, actual: number | boolean | null, expected: number | boolean | null) {
  const ok =
    typeof actual === "number" && typeof expected === "number"
      ? Math.abs(actual - expected) < 0.0001
      : actual === expected;
  console.log(`   ${ok ? "✓" : "✗"} ${label}: ${actual}${ok ? "" : ` (esperado ${expected})`}`);
  if (!ok) failures++;
}

console.log("PARTE 1 — la ecuación pura\n");

const meta = new Map([
  [1, { name: "Lomo", unit: "GR" }],
  [2, { name: "Sal", unit: "GR" }],
  [3, { name: "Aceite", unit: "ML" }],
]);

const inputs: DeviationInput[] = [
  // Falta mercadería: teórico 115, contado 110 → −5 × $100 = −$500
  { supplyId: 1, openingQty: 100, purchases: 50, transfersIn: 0, transfersOut: 0, consumption: 30, decomisos: 5, closingQty: 110, unitCost: 100 },
  // Cierra perfecto: teórico 60, contado 60 → 0
  { supplyId: 2, openingQty: 40, purchases: 30, transfersIn: 10, transfersOut: 5, consumption: 15, decomisos: 0, closingQty: 60, unitCost: 2 },
  // No se contó a la apertura: se asume cero y el desvío es "supuesto", no medido
  { supplyId: 3, openingQty: null, purchases: 20, transfersIn: 0, transfersOut: 0, consumption: 5, decomisos: 0, closingQty: 12, unitCost: 10 },
];

const rows = computeDeviationRows(inputs, meta);
const lomo = rows.find((r) => r.supplyId === 1)!;
const sal = rows.find((r) => r.supplyId === 2)!;
const aceite = rows.find((r) => r.supplyId === 3)!;

console.log("Lomo — falta mercadería");
check("stock final teórico", lomo.theoreticalClosing, 115);
check("desvío en cantidad", lomo.deviationQty, -5);
check("desvío valorizado", lomo.deviationAmount, -500);
check("es medición real", lomo.measured, true);
check("% sobre lo que pasó por el insumo", lomo.deviationPct, (-5 / 150) * 100);

console.log("\nSal — cierra perfecto");
check("stock final teórico", sal.theoreticalClosing, 60);
check("desvío", sal.deviationQty, 0);
check("traslados aplicados con el signo correcto", sal.transfersIn - sal.transfersOut, 5);

console.log("\nAceite — sin conteo de apertura");
check("stock final teórico (apertura como cero)", aceite.theoreticalClosing, 15);
check("desvío", aceite.deviationQty, -3);
check("NO cuenta como medición", aceite.measured, false);
check("marca que falta la apertura", aceite.missingOpening, true);

console.log("\nOrden y resumen");
check("el que más plata mueve va primero", rows[0].supplyId, 1);

const summary = summarizeDeviation(rows, 0);
check("desvío medido (sólo contados en ambas puntas)", summary.measuredAmount, -500);
check("desvío supuesto (conteo faltante)", summary.assumedAmount, -30);
check("total = medido + supuesto", summary.totalAmount, -530);
check("insumos medidos", summary.measuredCount, 2);
check("insumos supuestos", summary.assumedCount, 1);
check("consumo valorizado", summary.consumptionAmount, 30 * 100 + 15 * 2 + 5 * 10);
check("desvío sobre consumo", summary.deviationOverConsumptionPct, (-500 / 3080) * 100);

console.log("\nTolerancia");
// Lomo desvía 3,33%; Sal no desvía. Con tolerancia 5% no debería quedar nadie para mirar.
check("con tolerancia 0% se muestra el lomo", summarizeDeviation(rows, 0).worstOffenders.length, 1);
check("con tolerancia 5% no queda nada", summarizeDeviation(rows, 5).worstOffenders.length, 0);
check("la tolerancia NO cambia los totales", summarizeDeviation(rows, 5).totalAmount, -530);

// ==========================================
console.log("\n\nPARTE 2 — el camino completo contra la base\n");

const { db } = await import("../server/db");
const { storage } = await import("../server/storage");
const { computeDeviation, listDeviationPeriods } = await import("../server/deviationQueries");
const {
  locals, supplies, recipes, recipeIngredients, stockValuations, stockValuationItems,
  stockValuationSubRecipeItems, invoices, invoiceItems, suppliers, decomisos,
  merchandiseTransfers, merchandiseTransferItems, fudoProductos, productRecipeMappings,
} = await import("../shared/schema");
const { eq, and, inArray } = await import("drizzle-orm");

const CLIENT_ID = 3;
const OPEN_DATE = "2099-03-01";
const CLOSE_DATE = "2099-03-08";
const TAG = "__TEST_DESVIO__";

const [local] = await db.select().from(locals).where(eq(locals.clientId, CLIENT_ID));
const [supplier] = await db.select().from(suppliers).where(eq(suppliers.clientId, CLIENT_ID));
const testSupplies = await db.select().from(supplies).where(eq(supplies.clientId, CLIENT_ID));
const supplyA = testSupplies[0];
if (!local || !supplier || !supplyA) throw new Error("Faltan datos base en la copia local");

const created: { valuations: number[]; invoices: number[]; transfers: number[]; locals: number[] } = {
  valuations: [], invoices: [], transfers: [], locals: [],
};
let recipeId: number | null = null;

try {
  // Receta de prueba: 1 unidad vendida consume 2 de supplyA.
  const [recipe] = await db.insert(recipes).values({
    clientId: CLIENT_ID, name: TAG, recipeType: "plato", totalCost: "0", active: true,
  } as any).returning();
  recipeId = recipe.id;
  await db.insert(recipeIngredients).values({
    recipeId: recipe.id, supplyId: supplyA.id, quantityTotal: "2", quantityWithWaste: "2",
  } as any);
  await db.insert(productRecipeMappings).values({
    clientId: CLIENT_ID, source: "fudo", productName: TAG, recipeId: recipe.id,
  } as any);

  // Inventario de apertura: 100 unidades.
  const [openVal] = await db.insert(stockValuations).values({
    clientId: CLIENT_ID, localId: local.id, valuationDate: OPEN_DATE, totalValued: "0", status: "active", notes: TAG,
  } as any).returning();
  created.valuations.push(openVal.id);
  await db.insert(stockValuationItems).values({
    valuationId: openVal.id, supplyId: supplyA.id, quantity: "100", replacementUnitCost: "10", lineTotal: "1000",
  } as any);

  // Compra de 50 dentro del período.
  const [inv] = await db.insert(invoices).values({
    clientId: CLIENT_ID, localId: local.id, supplierId: supplier.id, invoiceNumber: "99999999",
    invoiceType: "A", invoiceDate: "2099-03-03", status: "active", total: "0", notes: TAG,
  } as any).returning();
  created.invoices.push(inv.id);
  await db.insert(invoiceItems).values({
    invoiceId: inv.id, supplyId: supplyA.id, quantity: "50", unitPrice: "10", subtotal: "500",
  } as any);

  // Traslado: entran 20 al local. Tiene que venir de OTRO local — un traslado de un local a sí
  // mismo se anula (entra y sale), que es justamente lo que el motor hace bien.
  const existingLocals = await db.select().from(locals).where(eq(locals.clientId, CLIENT_ID));
  let otherLocal = existingLocals.find((l) => l.id !== local.id) ?? null;
  if (!otherLocal) {
    const [tmp] = await db.insert(locals).values({
      clientId: CLIENT_ID, name: TAG, active: false,
    } as any).returning();
    otherLocal = tmp;
    created.locals.push(tmp.id);
  }
  const [tr] = await db.insert(merchandiseTransfers).values({
    clientId: CLIENT_ID, fromLocalId: otherLocal.id, toLocalId: local.id,
    transferDate: "2099-03-04", status: "active", totalValue: "0", notes: TAG,
  } as any).returning();
  created.transfers.push(tr.id);
  await db.insert(merchandiseTransferItems).values({
    transferId: tr.id, supplyId: supplyA.id, quantity: "20", unitCost: "10", lineTotal: "200",
  } as any);

  // Decomiso de 3.
  await db.insert(decomisos).values({
    clientId: CLIENT_ID, localId: local.id, supplyId: supplyA.id, fecha: "2099-03-05",
    codDecomiso: TAG, descripcionOriginal: TAG, cantidad: "3", unitCost: "10", valorizado: "30",
  } as any);

  // Venta: 10 unidades del producto → consume 10 × 2 = 20.
  await db.insert(fudoProductos).values({
    clientId: CLIENT_ID, localId: local.id, fecha: "2099-03-06", producto: TAG, cantidad: 10,
  } as any);

  // Inventario de cierre: contamos 140.
  const [closeVal] = await db.insert(stockValuations).values({
    clientId: CLIENT_ID, localId: local.id, valuationDate: CLOSE_DATE, totalValued: "0", status: "active", notes: TAG,
  } as any).returning();
  created.valuations.push(closeVal.id);
  await db.insert(stockValuationItems).values({
    valuationId: closeVal.id, supplyId: supplyA.id, quantity: "140", replacementUnitCost: "10", lineTotal: "1400",
  } as any);

  const periods = await listDeviationPeriods(CLIENT_ID, local.id);
  const period = periods.find(
    (p) => p.openingValuationId === openVal.id && p.closingValuationId === closeVal.id,
  );
  console.log(`Período detectado: ${period ? `${period.openingDate} → ${period.closingDate} (${period.days} días)` : "NO ENCONTRADO"}`);
  check("el par de inventarios aparece como período", period != null, true);

  const result = await computeDeviation(CLIENT_ID, (cid, opts) => storage.getSoldProductsByPeriod(cid, opts), {
    localId: local.id,
    openingValuationId: openVal.id,
    closingValuationId: closeVal.id,
    source: "fudo",
  });

  console.log(`Movimientos tomados: ${result.movementsFrom} → ${result.movementsTo}`);
  check("arranca el día siguiente al conteo de apertura", result.movementsFrom === "2099-03-02", true);

  const row = result.rows.find((r) => r.supplyId === supplyA.id);
  if (!row) throw new Error("El insumo sembrado no apareció en el resultado");

  console.log(`\nInsumo "${row.supplyName}":`);
  console.log(`   inicial ${row.openingQty} + compras ${row.purchases} + traslados ${row.transfersIn}`);
  console.log(`   − consumo ${row.consumption} − decomisos ${row.decomisos} = teórico ${row.theoreticalClosing}`);
  console.log(`   contado ${row.actualClosing} → desvío ${row.deviationQty}`);

  check("stock inicial", row.openingQty, 100);
  check("compras", row.purchases, 50);
  check("traslados recibidos", row.transfersIn, 20);
  check("traslados enviados", row.transfersOut, 0);
  check("consumo teórico (10 vendidas × 2)", row.consumption, 20);
  check("decomisos", row.decomisos, 3);
  check("stock final teórico", row.theoreticalClosing, 147);
  check("stock final contado", row.actualClosing, 140);
  check("desvío en cantidad", row.deviationQty, -7);
  check("es medición real", row.measured, true);
} finally {
  // Limpieza: todo lo sembrado se borra, nada preexistente se toca.
  for (const id of created.valuations) {
    await db.delete(stockValuationItems).where(eq(stockValuationItems.valuationId, id));
    await db.delete(stockValuationSubRecipeItems).where(eq(stockValuationSubRecipeItems.valuationId, id));
    await db.delete(stockValuations).where(eq(stockValuations.id, id));
  }
  for (const id of created.invoices) {
    await db.delete(invoiceItems).where(eq(invoiceItems.invoiceId, id));
    await db.delete(invoices).where(eq(invoices.id, id));
  }
  for (const id of created.transfers) {
    await db.delete(merchandiseTransferItems).where(eq(merchandiseTransferItems.transferId, id));
    await db.delete(merchandiseTransfers).where(eq(merchandiseTransfers.id, id));
  }
  await db.delete(decomisos).where(and(eq(decomisos.clientId, CLIENT_ID), eq(decomisos.codDecomiso, TAG)));
  for (const id of created.locals) await db.delete(locals).where(eq(locals.id, id));
  await db.delete(fudoProductos).where(and(eq(fudoProductos.clientId, CLIENT_ID), eq(fudoProductos.producto, TAG)));
  await db.delete(productRecipeMappings).where(and(eq(productRecipeMappings.clientId, CLIENT_ID), eq(productRecipeMappings.productName, TAG)));
  if (recipeId != null) {
    await db.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, recipeId));
    await db.delete(recipes).where(eq(recipes.id, recipeId));
  }
  const leftovers = await db.select().from(recipes).where(and(eq(recipes.clientId, CLIENT_ID), eq(recipes.name, TAG)));
  console.log(`\nLimpieza: ${leftovers.length === 0 ? "✓ sin residuos" : "✗ quedaron filas"}`);
}

console.log(failures === 0 ? "\n✓ TODO OK" : `\n✗ ${failures} comprobación(es) fallaron`);
process.exit(failures === 0 ? 0 : 1);
