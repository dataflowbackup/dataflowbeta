/**
 * Verifica la explosión de recetas a insumos contra el costeo que ya vive en la base.
 *
 * La invariante: explotar una receta a insumos y valorizarla al costo vigente tiene que dar el
 * MISMO número que `recipes.total_cost`, que el costeo calculó por su cuenta. Si las dos cuentas
 * coinciden en recetas con sub-recetas incluidas, la explosión que usa el Consumo es correcta.
 *
 *   npx tsx script/verify-recipe-explosion.ts
 */
import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.join(process.cwd(), ".env") });
dotenv.config({ path: path.join(process.cwd(), "env.local"), override: true });
dotenv.config({ path: path.join(process.cwd(), ".env.local"), override: true });
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "file:./data/dev.db";

const { db } = await import("../server/db");
const { clients, recipes, recipeIngredients, supplies, invoices, invoiceItems } = await import(
  "../shared/schema"
);
const { eq, and, desc, isNotNull, inArray } = await import("drizzle-orm");
const { explodeRecipes } = await import("../shared/supplyMetrics");
type Node = import("../shared/supplyMetrics").RecipeIngredientNode;

const TOLERANCE = 0.01; // 1 centavo

for (const c of await db.select({ id: clients.id, name: clients.name }).from(clients)) {
  const recipeRows = await db
    .select({ id: recipes.id, name: recipes.name, usefulYield: recipes.usefulYield, totalCost: recipes.totalCost })
    .from(recipes)
    .where(eq(recipes.clientId, c.id));
  if (recipeRows.length === 0) continue;

  const recipeIds = recipeRows.map((r) => r.id);
  const ingredientsByRecipe = new Map<number, Node[]>();
  for (const id of recipeIds) ingredientsByRecipe.set(id, []);

  const ingRows = await db.select().from(recipeIngredients).where(inArray(recipeIngredients.recipeId, recipeIds));
  let subRecipeLinks = 0;
  for (const r of ingRows) {
    if (r.subRecipeId != null) subRecipeLinks++;
    const qt = parseFloat(String(r.quantityTotal ?? 0)) || 0;
    ingredientsByRecipe.get(r.recipeId)?.push({
      supplyId: r.supplyId ?? null,
      subRecipeId: r.subRecipeId ?? null,
      quantityTotal: qt,
      quantityWithWaste: parseFloat(String(r.quantityWithWaste ?? 0)) || qt,
    });
  }

  const usefulYieldByRecipe = new Map<number, number | null>(
    recipeRows.map((r) => [r.id, r.usefulYield != null ? parseFloat(String(r.usefulYield)) : null] as [number, number | null]),
  );
  const { byRecipe, cyclicRecipeIds } = explodeRecipes(ingredientsByRecipe, usefulYieldByRecipe);

  // Costo vigente por insumo, misma prioridad que el costeo: última compra > lastCost > unitCost.
  const supplyRows = await db
    .select({ id: supplies.id, lastCost: supplies.lastCost, unitCost: supplies.unitCost })
    .from(supplies)
    .where(eq(supplies.clientId, c.id));
  const latestRows = await db
    .select({ supplyId: invoiceItems.supplyId, unitPrice: invoiceItems.unitPrice })
    .from(invoiceItems)
    .innerJoin(invoices, eq(invoiceItems.invoiceId, invoices.id))
    .where(and(eq(invoices.clientId, c.id), isNotNull(invoiceItems.supplyId)))
    .orderBy(desc(invoices.invoiceDate), desc(invoiceItems.id));
  const latestBySupply = new Map<number, number>();
  for (const r of latestRows) {
    if (r.supplyId == null || latestBySupply.has(r.supplyId)) continue;
    latestBySupply.set(r.supplyId, parseFloat(String(r.unitPrice ?? 0)) || 0);
  }
  const unitCosts = new Map<number, number>();
  for (const s of supplyRows) {
    const latest = latestBySupply.get(s.id) || 0;
    const lastCost = parseFloat(String(s.lastCost ?? 0)) || 0;
    const cpp = parseFloat(String(s.unitCost ?? 0)) || 0;
    unitCosts.set(s.id, latest > 0 ? latest : lastCost > 0 ? lastCost : cpp);
  }

  /**
   * El costeo recorrido tal cual lo hace `storage` al guardar una receta, pero con los costos
   * de HOY. Es contra esto que hay que comparar: `recipes.total_cost` puede estar viejo, porque
   * sólo se reescribe cuando se recalcula esa receta.
   */
  const recomputeMemo = new Map<number, number>();
  const recompute = (recipeId: number, open: Set<number>): number => {
    const cached = recomputeMemo.get(recipeId);
    if (cached != null) return cached;
    if (open.has(recipeId)) return 0;
    open.add(recipeId);

    let total = 0;
    for (const ing of ingredientsByRecipe.get(recipeId) ?? []) {
      if (ing.supplyId != null) {
        total += (unitCosts.get(ing.supplyId) ?? 0) * ing.quantityTotal;
      } else if (ing.subRecipeId != null) {
        const subTotal = recompute(ing.subRecipeId, open);
        const y = usefulYieldByRecipe.get(ing.subRecipeId) ?? 0;
        total += (y && y > 0 ? subTotal / y : subTotal) * ing.quantityTotal;
      }
    }

    open.delete(recipeId);
    recomputeMemo.set(recipeId, total);
    return total;
  };

  let ok = 0;
  let staleStored = 0;
  const mismatches: Array<{ name: string; expected: number; exploded: number }> = [];
  for (const r of recipeRows) {
    const stored = parseFloat(String(r.totalCost ?? 0)) || 0;
    const expected = recompute(r.id, new Set());
    let exploded = 0;
    for (const ing of byRecipe.get(r.id) ?? []) {
      exploded += ing.quantityTotal * (unitCosts.get(ing.supplyId) ?? 0);
    }

    if (Math.abs(expected - exploded) <= TOLERANCE) ok++;
    else mismatches.push({ name: r.name, expected, exploded });
    // Informativo: el costeo guardado quedó viejo respecto de los costos actuales.
    if (Math.abs(stored - expected) > TOLERANCE) staleStored++;
  }

  console.log(
    `${c.name} (cliente ${c.id}): explosión = costeo en ${ok}/${recipeRows.length} recetas · ` +
      `${subRecipeLinks} enlaces de sub-receta · ${cyclicRecipeIds.length} ciclos · ` +
      `${staleStored} con total_cost desactualizado en la base`,
  );
  for (const m of mismatches.slice(0, 8)) {
    console.log(`   ✗ ${m.name}: costeo $${m.expected.toFixed(4)} vs explotado $${m.exploded.toFixed(4)}`);
  }
  if (mismatches.length > 8) console.log(`   … y ${mismatches.length - 8} más`);
}

process.exit(0);
