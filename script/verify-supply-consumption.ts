/**
 * Verifica el Consumo de punta a punta contra la base LOCAL, con datos de prueba temporales.
 *
 * Siembra una venta sintética de un producto, lo mapea a una receta real (una que tenga
 * sub-recetas, para ejercitar la explosión), corre `getSupplyConsumption` y comprueba que el
 * consumo valorizado sea exactamente cantidad × costo de la receta. Al final borra TODO lo que
 * insertó — no toca ninguna fila preexistente.
 *
 *   npx tsx script/verify-supply-consumption.ts
 */
import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.join(process.cwd(), ".env") });
dotenv.config({ path: path.join(process.cwd(), "env.local"), override: true });
dotenv.config({ path: path.join(process.cwd(), ".env.local"), override: true });
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "file:./data/dev.db";

const { db } = await import("../server/db");
const { storage } = await import("../server/storage");
const { getSupplyConsumption } = await import("../server/supplyMetricsQueries");
const { recipes, recipeIngredients, fudoProductos, productRecipeMappings, locals } = await import(
  "../shared/schema"
);
const { eq, and, isNotNull, inArray } = await import("drizzle-orm");

const CLIENT_ID = 3;
const PRODUCT = "__TEST_CONSUMO__";
const FECHA = "2099-01-15"; // fuera de cualquier rango real, para no mezclarse con datos del usuario
const UNITS_SOLD = 7;

const local = (await db.select().from(locals).where(eq(locals.clientId, CLIENT_ID)))[0];
if (!local) throw new Error("No hay locales para el cliente de prueba");

// Una receta que use sub-recetas: es el caso que más puede romperse.
const withSub = await db
  .select({ recipeId: recipeIngredients.recipeId })
  .from(recipeIngredients)
  .where(isNotNull(recipeIngredients.subRecipeId));
const candidateIds = Array.from(new Set(withSub.map((r) => r.recipeId)));
const recipe = (
  await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.clientId, CLIENT_ID), inArray(recipes.id, candidateIds)))
)[0];
if (!recipe) throw new Error("No se encontró una receta con sub-recetas para probar");

console.log(`Receta de prueba: #${recipe.id} "${recipe.name}" (total_cost guardado $${recipe.totalCost})`);

let seeded = false;
try {
  await db.insert(fudoProductos).values({
    clientId: CLIENT_ID,
    localId: local.id,
    fecha: FECHA,
    producto: PRODUCT,
    cantidad: UNITS_SOLD,
  } as any);
  await db.insert(productRecipeMappings).values({
    clientId: CLIENT_ID,
    source: "fudo",
    productName: PRODUCT,
    recipeId: recipe.id,
  } as any);
  seeded = true;

  const result = await getSupplyConsumption(
    CLIENT_ID,
    (cid, opts) => storage.getSoldProductsByPeriod(cid, opts),
    { source: "fudo", dateFrom: FECHA, dateTo: FECHA },
  );

  console.log(`\nVendidas=${result.unitsSold} conReceta=${result.unitsWithRecipe} cobertura=${result.coveragePct}%`);
  console.log(`Insumos alcanzados: ${result.supplyCount} · líneas de detalle: ${result.detail.length}`);
  console.log(`Consumo valorizado: $${result.totalAmount.toFixed(4)}`);

  // El consumo de N unidades tiene que valer N × el costo de la receta según el costeo vigente.
  const oneUnit = await getSupplyConsumption(
    CLIENT_ID,
    async () => [{ producto: PRODUCT, categoria: null, cantidad: 1 }],
    { source: "fudo", dateFrom: FECHA, dateTo: FECHA },
  );
  const expected = oneUnit.totalAmount * UNITS_SOLD;
  const diff = Math.abs(expected - result.totalAmount);
  console.log(`Costo de 1 unidad: $${oneUnit.totalAmount.toFixed(4)} → ×${UNITS_SOLD} = $${expected.toFixed(4)}`);
  console.log(diff <= 0.0001 ? "✓ Escala lineal correcta" : `✗ DESVÍO de $${diff.toFixed(6)}`);

  // Filtrar por un insumo concreto tiene que devolver exactamente esa porción del total.
  const target = result.rows[0];
  if (target) {
    const filtered = await getSupplyConsumption(
      CLIENT_ID,
      (cid, opts) => storage.getSoldProductsByPeriod(cid, opts),
      { source: "fudo", dateFrom: FECHA, dateTo: FECHA, supplyId: target.supplyId },
    );
    const okFilter =
      filtered.supplyCount === 1 &&
      Math.abs(filtered.totalAmount - target.amount) <= 0.0001 &&
      Math.abs(filtered.totalQuantity - target.quantity) <= 0.0001;
    console.log(
      `Filtro por insumo "${target.supplyName}": ${filtered.supplyCount} insumo, ` +
        `$${filtered.totalAmount.toFixed(4)} vs $${target.amount.toFixed(4)} ${okFilter ? "✓" : "✗"}`,
    );
  }

  // Un rango que no incluye la fecha sembrada no debe devolver nada.
  const otherRange = await getSupplyConsumption(
    CLIENT_ID,
    (cid, opts) => storage.getSoldProductsByPeriod(cid, opts),
    { source: "fudo", dateFrom: "2098-01-01", dateTo: "2098-12-31" },
  );
  console.log(
    `Fuera del rango: vendidas=${otherRange.unitsSold} monto=$${otherRange.totalAmount} ` +
      `${otherRange.unitsSold === 0 ? "✓" : "✗"}`,
  );

  console.log("\nTop insumos consumidos:");
  for (const r of result.rows.slice(0, 5)) {
    console.log(
      `   · ${r.supplyName}: ${r.quantity.toFixed(4)} ${r.unit ?? ""} ` +
        `(merma ${r.quantityWithWaste.toFixed(4)}) × $${r.unitCost.toFixed(4)} = $${r.amount.toFixed(2)}`,
    );
  }
} finally {
  if (seeded) {
    await db
      .delete(fudoProductos)
      .where(and(eq(fudoProductos.clientId, CLIENT_ID), eq(fudoProductos.producto, PRODUCT)));
    await db
      .delete(productRecipeMappings)
      .where(and(eq(productRecipeMappings.clientId, CLIENT_ID), eq(productRecipeMappings.productName, PRODUCT)));
    const leftovers = await db
      .select()
      .from(fudoProductos)
      .where(and(eq(fudoProductos.clientId, CLIENT_ID), eq(fudoProductos.producto, PRODUCT)));
    console.log(`\nLimpieza: ${leftovers.length === 0 ? "✓ sin residuos" : "✗ quedaron filas"}`);
  }
}

process.exit(0);
